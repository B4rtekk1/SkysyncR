/*
use axum::{extract::{Query, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::crypto::email::send_password_reset_email; // adjust to your actual mailer module
use crate::db::users::{
    get_recovery_blob_by_token, reset_password_with_token, set_password_reset_token,
};

#[derive(Deserialize)]
pub struct ForgotPasswordBody {
    pub email: String,
}

/// POST /api/users/forgot-password
/// Always returns 200 regardless of whether the email exists, to avoid
/// leaking which addresses are registered.
pub async fn forgot_password_handler(
    State(pool): State<PgPool>,
    Json(body): Json<ForgotPasswordBody>,
) -> StatusCode {
    if let Ok(Some(token)) = set_password_reset_token(&pool, &body.email).await {
        let _ = send_password_reset_email(&body.email, &token).await;
    }
    StatusCode::OK
}

#[derive(Deserialize)]
pub struct RecoveryBlobQuery {
    pub token: String,
}

#[derive(Serialize)]
pub struct RecoveryBlobResponse {
    pub encrypted_private_key_recovery: Option<String>,
}

/// GET /api/users/recovery-blob?token=...
/// The client fetches this after landing on the reset-password page, to
/// decrypt the private key locally using the recovery code before setting
/// a new password.
pub async fn get_recovery_blob_handler(
    State(pool): State<PgPool>,
    Query(params): Query<RecoveryBlobQuery>,
) -> Result<Json<RecoveryBlobResponse>, StatusCode> {
    let blob = get_recovery_blob_by_token(&pool, &params.token)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(RecoveryBlobResponse {
        encrypted_private_key_recovery: blob,
    }))
}

#[derive(Deserialize)]
pub struct ResetPasswordBody {
    pub token: String,
    pub new_password: String,
}

#[derive(Serialize)]
pub struct ErrorBody {
    pub message: String,
}

/// POST /api/users/reset-password
pub async fn reset_password_handler(
    State(pool): State<PgPool>,
    Json(body): Json<ResetPasswordBody>,
) -> Result<StatusCode, (StatusCode, Json<ErrorBody>)> {
    let hash = bcrypt::hash(&body.new_password, bcrypt::DEFAULT_COST).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorBody { message: "Could not process password".into() }),
        )
    })?;

    let updated = reset_password_with_token(&pool, &body.token, &hash)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorBody { message: "Database error".into() }),
            )
        })?;

    if !updated {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorBody { message: "This reset link is invalid or has expired.".into() }),
        ));
    }

    Ok(StatusCode::OK)
}
 */
