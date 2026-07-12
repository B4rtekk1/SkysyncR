use crate::auth::AuthUser;
use crate::crypto::jwt::generate_access_token_capped;
use crate::crypto::refresh_token::generate_refresh_token;
use crate::db::refresh_tokens::{
    RefreshTokenAuth, ValidRefreshToken, authenticate_refresh_token, create_refresh_token,
    revoke_all_user_refresh_tokens, revoke_refresh_token, rotate_refresh_token,
};
use crate::db::users::*;
use crate::models::users::{
    CurrentUserResponse, LoginRequest, LoginResponse, LogoutRequest, RefreshRequest,
    RefreshResponse, RegisterRequest, RegisterResponse,
};
use crate::state::AppState;
use crate::utils::device::DeviceContext;
use crate::utils::errors::{ApiError, internal_error, map_db_error};
use crate::utils::validation::{
    validate_display_name, validate_email, validate_password, validate_public_key,
};
use axum::{
    Json,
    extract::{ConnectInfo, Query, State},
    http::HeaderMap,
};
use bcrypt::{DEFAULT_COST, hash};
use serde::Deserialize;
use std::net::SocketAddr;

use crate::crypto::email::send_verification_email;

#[derive(Deserialize)]
pub struct VerifyParams {
    pub token: String,
}

pub async fn current_user(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<CurrentUserResponse>, ApiError> {
    let profile = get_current_user_crypto_profile(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("get current user", e))?
        .ok_or_else(|| ApiError::Unauthorized("User not found".into()))?;

    Ok(Json(CurrentUserResponse {
        id: profile.id,
        email: profile.email,
        display_name: profile.display_name,
        public_key: profile.public_key,
    }))
}

async fn require_refresh_token(
    state: &AppState,
    raw_token: &str,
    device: &DeviceContext,
) -> Result<ValidRefreshToken, ApiError> {
    let auth = authenticate_refresh_token(&state.db_pool, raw_token, device)
        .await
        .map_err(|e| internal_error("authenticate refresh token", e))?;

    match auth {
        RefreshTokenAuth::Valid(token) => Ok(token),
        RefreshTokenAuth::ReuseDetected { user_id }
        | RefreshTokenAuth::DeviceMismatch { user_id } => {
            revoke_all_user_refresh_tokens(&state.db_pool, user_id)
                .await
                .map_err(|e| internal_error("revoke sessions after token anomaly", e))?;
            Err(ApiError::Unauthorized("Session invalid".into()))
        }
        RefreshTokenAuth::NotFound => Err(ApiError::Unauthorized(
            "Invalid or expired refresh token".into(),
        )),
    }
}

pub async fn register_user(
    State(state): State<AppState>,
    Json(payload): Json<RegisterRequest>,
) -> Result<Json<RegisterResponse>, ApiError> {
    let email = payload.email.trim().to_lowercase();
    validate_email(&email).map_err(|msg| ApiError::BadRequest(msg.into()))?;
    validate_password(&payload.password).map_err(|msg| ApiError::BadRequest(msg.into()))?;
    validate_display_name(&payload.display_name).map_err(|msg| ApiError::BadRequest(msg.into()))?;
    validate_public_key(&payload.public_key).map_err(|msg| ApiError::BadRequest(msg.into()))?;

    let hashed =
        hash(&payload.password, DEFAULT_COST).map_err(|e| internal_error("password hash", e))?;

    let display_name = payload.display_name.trim();

    let (user_id, token) = create_user(
        &state.db_pool,
        NewUser {
            email: &email,
            display_name,
            password_hash: &hashed,
            public_key: &payload.public_key,
        },
        state.config.verification_token_ttl_hours,
    )
    .await
    .map_err(|e| map_db_error("create user", e))?;

    if let Err(e) = send_verification_email(&email, &token).await {
        eprintln!("Failed to send verification email: {e}");
    }

    Ok(Json(RegisterResponse {
        id: user_id.to_string(),
    }))
}

async fn issue_token_pair(
    state: &AppState,
    user_id: uuid::Uuid,
    device: &DeviceContext,
) -> Result<(String, String, i64), ApiError> {
    let refresh_token = generate_refresh_token();
    let session_expires_at = create_refresh_token(&state.db_pool, user_id, &refresh_token, device)
        .await
        .map_err(|e| internal_error("create refresh token", e))?;

    let (access_token, expires_in) = generate_access_token_capped(
        &user_id.to_string(),
        &device.device_id,
        &state.config.jwt_secret,
        session_expires_at,
    )
    .map_err(|e| internal_error("generate access token", e))?;

    Ok((access_token, refresh_token, expires_in))
}

pub async fn login_user(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let device = DeviceContext::from_headers(&headers, Some(peer.ip()))?;
    let email = payload.email.trim().to_lowercase();
    validate_email(&email).map_err(|msg| ApiError::BadRequest(msg.into()))?;

    if payload.password.len() > 128 {
        return Err(ApiError::BadRequest("Password is too long".into()));
    }

    let login_allowed = is_login_allowed(&state.db_pool, &email)
        .await
        .map_err(|e| internal_error("check login lockout", e))?;

    if !login_allowed {
        return Err(ApiError::TooManyRequests(
            "Too many failed login attempts. Try again later.".into(),
        ));
    }

    let user_verified = is_user_verified(&state.db_pool, &email)
        .await
        .map_err(|e| internal_error("check email verification", e))?;

    if !user_verified {
        return Err(ApiError::Forbidden("Email not verified".into()));
    }

    let is_valid = compare_passwords(&state.db_pool, &email, &payload.password)
        .await
        .map_err(|e| internal_error("compare passwords", e))?;

    if !is_valid {
        record_failed_login(
            &state.db_pool,
            &email,
            state.config.max_failed_login_attempts,
            state.config.lockout_duration_minutes,
        )
        .await
        .map_err(|e| internal_error("record failed login", e))?;

        return Err(ApiError::Unauthorized("Invalid email or password".into()));
    }

    let user_id = get_user_id_by_email(&state.db_pool, &email)
        .await
        .map_err(|e| internal_error("get user id", e))?
        .ok_or_else(|| ApiError::Unauthorized("Invalid email or password".into()))?;

    reset_failed_login(&state.db_pool, &email)
        .await
        .map_err(|e| internal_error("reset failed login", e))?;

    let (access_token, refresh_token, expires_in) =
        issue_token_pair(&state, user_id, &device).await?;

    update_last_login(&state.db_pool, &email)
        .await
        .map_err(|e| internal_error("update last login", e))?;

    Ok(Json(LoginResponse {
        access_token,
        refresh_token,
        expires_in,
    }))
}

pub async fn refresh_tokens(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<RefreshRequest>,
) -> Result<Json<RefreshResponse>, ApiError> {
    if payload.refresh_token.is_empty() || payload.refresh_token.len() > 128 {
        return Err(ApiError::BadRequest("Invalid refresh token".into()));
    }

    let device = DeviceContext::from_headers(&headers, Some(peer.ip()))?;
    let stored = require_refresh_token(&state, &payload.refresh_token, &device).await?;

    let (access_token, expires_in) = generate_access_token_capped(
        &stored.user_id.to_string(),
        &device.device_id,
        &state.config.jwt_secret,
        stored.session_expires_at,
    )
    .map_err(|e| internal_error("generate access token", e))?;

    let new_refresh_token = generate_refresh_token();
    rotate_refresh_token(
        &state.db_pool,
        stored.id,
        stored.user_id,
        &new_refresh_token,
        stored.session_expires_at,
        &device,
    )
    .await
    .map_err(|e| internal_error("rotate refresh token", e))?;

    Ok(Json(RefreshResponse {
        access_token,
        refresh_token: new_refresh_token,
        expires_in,
    }))
}

pub async fn logout_user(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<LogoutRequest>,
) -> Result<&'static str, ApiError> {
    let device = DeviceContext::from_headers(&headers, Some(peer.ip()))?;

    if let Ok(stored) = require_refresh_token(&state, &payload.refresh_token, &device).await {
        revoke_refresh_token(&state.db_pool, stored.id)
            .await
            .map_err(|e| internal_error("revoke refresh token", e))?;
    }

    Ok("Logged out")
}

pub async fn logout_all_sessions(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<LogoutRequest>,
) -> Result<&'static str, ApiError> {
    let device = DeviceContext::from_headers(&headers, Some(peer.ip()))?;

    if let Ok(stored) = require_refresh_token(&state, &payload.refresh_token, &device).await {
        revoke_all_user_refresh_tokens(&state.db_pool, stored.user_id)
            .await
            .map_err(|e| internal_error("revoke all refresh tokens", e))?;
    }

    Ok("All sessions revoked")
}

pub async fn verify_email(
    State(state): State<AppState>,
    Query(params): Query<VerifyParams>,
) -> Result<&'static str, ApiError> {
    if params.token.is_empty() || params.token.len() > 128 {
        return Err(ApiError::BadRequest("Invalid verification token".into()));
    }

    let verified = verify_email_token(&state.db_pool, &params.token)
        .await
        .map_err(|e| internal_error("verify email token", e))?;

    if verified {
        Ok("Email verified successfully")
    } else {
        Err(ApiError::BadRequest("Invalid or expired token".into()))
    }
}
