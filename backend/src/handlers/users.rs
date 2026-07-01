use crate::crypto::jwt::generate_jwt;
use crate::db::users::{NewUser, compare_passwords, create_user, is_user_verified, verify_email_token, update_last_login};
use crate::models::users::{LoginRequest, RegisterRequest};
use crate::models::users::{LoginResponse, RegisterResponse};
use crate::state::AppState;
use axum::http::StatusCode;
use axum::{Json, extract::{State, Query}};
use bcrypt::{DEFAULT_COST, hash};
use crate::crypto::email::send_verification_email;
use serde::Deserialize;

pub async fn register_user(
    State(state): State<AppState>,
    Json(payload): Json<RegisterRequest>,
) -> Result<Json<RegisterResponse>, (StatusCode, String)> {
    let hashed = hash(&payload.password, DEFAULT_COST)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (user_id, token) = create_user(&state.db_pool, NewUser {
        email: &payload.email,
        display_name: &payload.display_name,
        password_hash: &hashed,
        public_key: &payload.public_key,
    })
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Err(e) = send_verification_email(&payload.email, &token).await {
        eprintln!("Failed to send verification email: {e}");
    }

    Ok(Json(RegisterResponse { id: user_id.to_string() }))
}

pub async fn login_user(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, (StatusCode, String)> {
    let user_verified = is_user_verified(&state.db_pool, &payload.email)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let is_valid = compare_passwords(&state.db_pool, &payload.email, &payload.password)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !is_valid || !user_verified {
        return Err((StatusCode::UNAUTHORIZED, "Invalid credentials".into()));
    }

    let token = generate_jwt(&payload.email, &state.config.jwt_secret)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let _ = update_last_login(&state.db_pool, &payload.email)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(LoginResponse {
        token: token.to_string(),
    }))
}

#[derive(Deserialize)]
pub struct VerifyParams {
    pub token: String,
}

pub async fn verify_email(
    State(state): State<AppState>,
    Query(params): Query<VerifyParams>,
) -> Result<&'static str, (StatusCode, String)> {
    let verified = verify_email_token(&state.db_pool, &params.token)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if verified {
        Ok("Email verified successfully")
    } else {
        Err((StatusCode::BAD_REQUEST, "Invalid or expired token".to_string()))
    }
}
