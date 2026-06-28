use axum::{Json, extract::State};
use axum::http::StatusCode;
use bcrypt::{hash, DEFAULT_COST};
use serde::Serialize;
use crate::state::AppState;
use crate::models::users::{RegisterRequest, LoginRequest};
use crate::db::users::{create_user, compare_passwords};
use crate::crypto::jwt::generate_jwt;

#[derive(Serialize)]
pub struct RegisterResponse {
    id: String,
}
pub struct LoginResponse {
    token: String,
}

pub async fn register_user(
    State(state): State<AppState>,
    Json(payload): Json<RegisterRequest>,
) -> Result<Json<RegisterResponse>, (StatusCode, String)> {
    let hashed = hash(&payload.password, DEFAULT_COST)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let user_id = create_user(&state.db_pool, &payload.email, &payload.display_name, &hashed, &payload.public_key)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(RegisterResponse { id: user_id.to_string() }))
}

pub async fn login_user(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, (StatusCode, String)> {

    let is_valid = compare_passwords(
        &state.db_pool,
        &payload.email,
        &payload.password,
    )
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !is_valid {
        return Err((StatusCode::UNAUTHORIZED, "Invalid credentials".into()));
    }

    let token = generate_jwt(&payload.email, &state.config.jwt_secret)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(LoginResponse { token }))
}
