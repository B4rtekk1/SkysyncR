use axum::{Json, extract::State};
use axum::http::StatusCode;
use bcrypt::{hash,DEFAULT_COST};
use crate::state::AppState;
use crate::models::users::RegisterRequest;
use crate::db::users::create_user;

pub async fn register_user(
    State(state): State<AppState>,
    Json(payload): Json<RegisterRequest>,
) -> Result<&'static str, (StatusCode, String)> {
    let hashed = hash(&payload.password, DEFAULT_COST).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    create_user(&state.db_pool, &payload.email, &hashed, &payload.public_key).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok("User registered successfully")
}