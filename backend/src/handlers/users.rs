use crate::auth::AuthUser;
use crate::crypto::jwt::generate_access_token_capped;
use crate::crypto::refresh_token::generate_refresh_token;
use crate::db::refresh_tokens::{
    RefreshTokenAuth, ValidRefreshToken, authenticate_refresh_token, create_refresh_token,
    revoke_all_user_refresh_tokens, revoke_refresh_token, rotate_refresh_token,
};
use crate::db::users::*;
use crate::models::users::{
    CurrentUserResponse, LoginRequest, LoginResponse, RefreshResponse, RegisterRequest,
    RegisterResponse, UpdateUserSettingsRequest, UserSettingsResponse,
};
use crate::state::AppState;
use crate::utils::errors::{ApiError, internal_error, map_db_error};
use crate::utils::validation::{
    validate_display_name, validate_email, validate_password, validate_public_key,
};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, HeaderValue, header},
    response::{IntoResponse, Response},
};
use bcrypt::{DEFAULT_COST, hash};
use chrono::Utc;
use serde::Deserialize;

use crate::crypto::email::send_verification_email;

#[derive(Deserialize)]
pub struct VerifyParams {
    pub token: String,
}

const REFRESH_TOKEN_COOKIE: &str = "skysyncr_refresh_token";
const REFRESH_PERSISTENCE_COOKIE: &str = "skysyncr_refresh_persistent";

fn refresh_token_cookie(
    token: &str,
    session_expires_at: chrono::DateTime<Utc>,
    is_dev: bool,
    persistent: bool,
) -> Result<HeaderValue, ApiError> {
    let max_age = (session_expires_at - Utc::now()).num_seconds().max(0);
    let max_age_attr = if persistent {
        format!("; Max-Age={max_age}")
    } else {
        String::new()
    };
    let secure = if is_dev { "" } else { "; Secure" };
    HeaderValue::from_str(&format!(
        "{REFRESH_TOKEN_COOKIE}={token}{max_age_attr}; Path=/users; HttpOnly; SameSite=Lax{secure}"
    ))
    .map_err(|e| internal_error("build refresh cookie", e))
}

fn refresh_persistence_cookie(is_dev: bool, persistent: bool) -> Result<HeaderValue, ApiError> {
    let secure = if is_dev { "" } else { "; Secure" };
    let max_age = if persistent {
        "; Max-Age=7776000"
    } else {
        "; Max-Age=0"
    };

    HeaderValue::from_str(&format!(
        "{REFRESH_PERSISTENCE_COOKIE}=1{max_age}; Path=/users; HttpOnly; SameSite=Lax{secure}"
    ))
    .map_err(|e| internal_error("build refresh cookie", e))
}

fn clear_cookie(name: &str, is_dev: bool) -> HeaderValue {
    let secure = if is_dev { "" } else { "; Secure" };
    HeaderValue::from_str(&format!(
        "{name}=; Max-Age=0; Path=/users; HttpOnly; SameSite=Lax{secure}"
    ))
    .expect("static clear cookie is valid")
}

fn refresh_token_from_cookie(headers: &HeaderMap) -> Result<String, ApiError> {
    for value in headers.get_all(header::COOKIE) {
        let Ok(raw) = value.to_str() else {
            continue;
        };

        for cookie in raw.split(';') {
            let cookie = cookie.trim();
            if let Some(token) = cookie.strip_prefix(&format!("{REFRESH_TOKEN_COOKIE}=")) {
                if token.is_empty() || token.len() > 128 {
                    return Err(ApiError::BadRequest("Invalid refresh token".into()));
                }
                return Ok(token.to_string());
            }
        }
    }

    Err(ApiError::Unauthorized("Missing refresh token".into()))
}

fn has_cookie(headers: &HeaderMap, name: &str) -> bool {
    let prefix = format!("{name}=");

    headers.get_all(header::COOKIE).iter().any(|value| {
        value.to_str().is_ok_and(|raw| {
            raw.split(';')
                .map(str::trim)
                .any(|cookie| cookie.starts_with(&prefix))
        })
    })
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
        trash_retention_days: profile.trash_retention_days,
    }))
}

pub async fn update_user_settings(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<UpdateUserSettingsRequest>,
) -> Result<Json<UserSettingsResponse>, ApiError> {
    if !(1..=365).contains(&payload.trash_retention_days) {
        return Err(ApiError::BadRequest(
            "Trash retention must be between 1 and 365 days".into(),
        ));
    }

    let trash_retention_days = update_user_trash_retention_days(
        &state.db_pool,
        auth.user_id,
        payload.trash_retention_days,
    )
    .await
    .map_err(|e| internal_error("update user settings", e))?
    .ok_or_else(|| ApiError::Unauthorized("User not found".into()))?;

    Ok(Json(UserSettingsResponse {
        trash_retention_days,
    }))
}

async fn require_refresh_token(
    state: &AppState,
    raw_token: &str,
) -> Result<ValidRefreshToken, ApiError> {
    let auth = authenticate_refresh_token(&state.db_pool, raw_token)
        .await
        .map_err(|e| internal_error("authenticate refresh token", e))?;

    match auth {
        RefreshTokenAuth::Valid(token) => Ok(token),
        RefreshTokenAuth::ReuseDetected { user_id } => {
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
) -> Result<(String, String, i64, chrono::DateTime<Utc>), ApiError> {
    let refresh_token = generate_refresh_token();
    let session_expires_at = create_refresh_token(&state.db_pool, user_id, &refresh_token)
        .await
        .map_err(|e| internal_error("create refresh token", e))?;

    let (access_token, expires_in) = generate_access_token_capped(
        &user_id.to_string(),
        &state.config.jwt_secret,
        session_expires_at,
    )
    .map_err(|e| internal_error("generate access token", e))?;

    Ok((access_token, refresh_token, expires_in, session_expires_at))
}

pub async fn login_user(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Response, ApiError> {
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

    let (access_token, refresh_token, expires_in, session_expires_at) =
        issue_token_pair(&state, user_id).await?;

    update_last_login(&state.db_pool, &email)
        .await
        .map_err(|e| internal_error("update last login", e))?;

    let mut response_headers = HeaderMap::new();
    let persistent = payload.remember.unwrap_or(true);
    response_headers.append(
        header::SET_COOKIE,
        refresh_token_cookie(
            &refresh_token,
            session_expires_at,
            state.config.is_dev,
            persistent,
        )?,
    );
    response_headers.append(
        header::SET_COOKIE,
        refresh_persistence_cookie(state.config.is_dev, persistent)?,
    );

    Ok((
        response_headers,
        Json(LoginResponse {
            access_token,
            expires_in,
        }),
    )
        .into_response())
}

pub async fn refresh_tokens(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<Response, ApiError> {
    let refresh_token = refresh_token_from_cookie(&headers)?;
    let stored = require_refresh_token(&state, &refresh_token).await?;

    let (access_token, expires_in) = generate_access_token_capped(
        &stored.user_id.to_string(),
        &state.config.jwt_secret,
        stored.session_expires_at,
    )
    .map_err(|e| internal_error("generate access token", e))?;

    let new_refresh_token = generate_refresh_token();
    let persistent = has_cookie(&headers, REFRESH_PERSISTENCE_COOKIE);
    rotate_refresh_token(
        &state.db_pool,
        stored.id,
        stored.user_id,
        &new_refresh_token,
        stored.session_expires_at,
    )
    .await
    .map_err(|e| internal_error("rotate refresh token", e))?;

    let mut response_headers = HeaderMap::new();
    response_headers.append(
        header::SET_COOKIE,
        refresh_token_cookie(
            &new_refresh_token,
            stored.session_expires_at,
            state.config.is_dev,
            persistent,
        )?,
    );
    response_headers.append(
        header::SET_COOKIE,
        refresh_persistence_cookie(state.config.is_dev, persistent)?,
    );

    Ok((
        response_headers,
        Json(RefreshResponse {
            access_token,
            expires_in,
        }),
    )
        .into_response())
}

pub async fn logout_user(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<Response, ApiError> {
    if let Ok(refresh_token) = refresh_token_from_cookie(&headers)
        && let Ok(stored) = require_refresh_token(&state, &refresh_token).await
    {
        revoke_refresh_token(&state.db_pool, stored.id)
            .await
            .map_err(|e| internal_error("revoke refresh token", e))?;
    }

    let mut response_headers = HeaderMap::new();
    response_headers.append(
        header::SET_COOKIE,
        clear_cookie(REFRESH_TOKEN_COOKIE, state.config.is_dev),
    );
    response_headers.append(
        header::SET_COOKIE,
        clear_cookie(REFRESH_PERSISTENCE_COOKIE, state.config.is_dev),
    );

    Ok((response_headers, "Logged out").into_response())
}

pub async fn logout_all_sessions(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<Response, ApiError> {
    if let Ok(refresh_token) = refresh_token_from_cookie(&headers)
        && let Ok(stored) = require_refresh_token(&state, &refresh_token).await
    {
        revoke_all_user_refresh_tokens(&state.db_pool, stored.user_id)
            .await
            .map_err(|e| internal_error("revoke all refresh tokens", e))?;
    }

    let mut response_headers = HeaderMap::new();
    response_headers.append(
        header::SET_COOKIE,
        clear_cookie(REFRESH_TOKEN_COOKIE, state.config.is_dev),
    );
    response_headers.append(
        header::SET_COOKIE,
        clear_cookie(REFRESH_PERSISTENCE_COOKIE, state.config.is_dev),
    );

    Ok((response_headers, "All sessions revoked").into_response())
}

pub async fn verify_email(
    State(state): State<AppState>,
    Json(params): Json<VerifyParams>,
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
