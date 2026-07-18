use crate::crypto::email::send_password_reset_email;
use crate::db::refresh_tokens::revoke_all_user_refresh_tokens;
use crate::db::users::{
    get_recovery_blob_by_token, reset_password_with_token, set_password_reset_token,
};
use crate::state::AppState;
use crate::utils::errors::{ApiError, internal_error};
use crate::utils::validation::{validate_email, validate_password};
use axum::{
    Json,
    extract::{Query, State},
};
use bcrypt::{DEFAULT_COST, hash};
use serde::{Deserialize, Serialize};

const RESET_TOKEN_TTL_MINUTES: i32 = 30;

#[derive(Deserialize)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Deserialize)]
pub struct RecoveryBlobQuery {
    pub token: String,
}

#[derive(Serialize)]
pub struct RecoveryBlobResponse {
    pub user_id: String,
    pub encrypted_private_key_recovery: String,
}

#[derive(Deserialize)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub new_password: String,
}

pub async fn forgot_password(
    State(state): State<AppState>,
    Json(payload): Json<ForgotPasswordRequest>,
) -> Result<&'static str, ApiError> {
    let email = payload.email.trim().to_lowercase();
    if validate_email(&email).is_err() {
        return Ok("If the email exists, a reset link has been sent");
    }

    let token = set_password_reset_token(&state.db_pool, &email, RESET_TOKEN_TTL_MINUTES)
        .await
        .map_err(|e| internal_error("set password reset token", e))?;

    if let Some(token) = token {
        tokio::spawn(async move {
            if let Err(e) = send_password_reset_email(&email, &token).await {
                tracing::error!(error = %e, "failed to send password reset email");
            }
        });
    }

    Ok("If the email exists, a reset link has been sent")
}

pub async fn get_recovery_blob(
    State(state): State<AppState>,
    Query(params): Query<RecoveryBlobQuery>,
) -> Result<Json<RecoveryBlobResponse>, ApiError> {
    if params.token.is_empty() || params.token.len() > 128 {
        return Err(ApiError::BadRequest("Invalid reset token".into()));
    }

    let record = get_recovery_blob_by_token(&state.db_pool, &params.token)
        .await
        .map_err(|e| internal_error("get recovery blob", e))?
        .ok_or_else(|| ApiError::BadRequest("This reset link is invalid or has expired".into()))?;

    Ok(Json(RecoveryBlobResponse {
        user_id: record.user_id.to_string(),
        encrypted_private_key_recovery: record.encrypted_private_key_recovery,
    }))
}

pub async fn reset_password(
    State(state): State<AppState>,
    Json(payload): Json<ResetPasswordRequest>,
) -> Result<&'static str, ApiError> {
    if payload.token.is_empty() || payload.token.len() > 128 {
        return Err(ApiError::BadRequest("Invalid reset token".into()));
    }
    validate_password(&payload.new_password).map_err(|msg| ApiError::BadRequest(msg.into()))?;

    let password_hash = hash(&payload.new_password, DEFAULT_COST)
        .map_err(|e| internal_error("password hash", e))?;

    let user_id = reset_password_with_token(&state.db_pool, &payload.token, &password_hash)
        .await
        .map_err(|e| internal_error("reset password", e))?
        .ok_or_else(|| ApiError::BadRequest("This reset link is invalid or has expired".into()))?;

    revoke_all_user_refresh_tokens(&state.db_pool, user_id)
        .await
        .map_err(|e| internal_error("revoke sessions after password reset", e))?;

    Ok("Password reset")
}
