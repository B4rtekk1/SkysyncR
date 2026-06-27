use axum::{Json, extract::State};
use axum::http::StatusCode;
use crate::state::AppState;
use crate::models::users::RegisterRequest;
use crate::db::users::create_user;

pub async fn register_user(
    State(state): State<AppState>,
    Json(payload): Json<RegisterRequest>,
) -> Result<&'static str, (StatusCode, String)> {
    match create_user(&state.db_pool, &payload.email, &payload.password).await {
        Ok(_) => Ok("User registered successfully"),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}