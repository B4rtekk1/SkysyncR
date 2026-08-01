use crate::crypto::totp::{decrypt_secret, verify_code};
use crate::db::totp::{get_user_totp, update_last_used_counter};
use crate::db::users::get_password_hash_by_id;
use crate::state::AppState;
use crate::utils::errors::{ApiError, internal_error};
use bcrypt::verify;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ReauthenticationRequest {
    pub password: String,
    pub totp_code: Option<String>,
}

pub async fn verify_reauthentication(
    state: &AppState,
    user_id: Uuid,
    payload: &ReauthenticationRequest,
) -> Result<(), ApiError> {
    if payload.password.is_empty() || payload.password.len() > 128 {
        return Err(ApiError::Unauthorized(
            "Password confirmation failed".into(),
        ));
    }

    let password_hash = get_password_hash_by_id(&state.db_pool, user_id)
        .await
        .map_err(|e| internal_error("load password hash for reauthentication", e))?
        .ok_or_else(|| ApiError::Unauthorized("User not found".into()))?;

    if !verify(&payload.password, &password_hash).unwrap_or(false) {
        return Err(ApiError::Unauthorized(
            "Password confirmation failed".into(),
        ));
    }

    let Some(record) = get_user_totp(&state.db_pool, user_id)
        .await
        .map_err(|e| internal_error("load TOTP for reauthentication", e))?
        .filter(|record| record.enabled_at.is_some())
    else {
        return Ok(());
    };

    let code = payload
        .totp_code
        .as_deref()
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .ok_or_else(|| ApiError::Unauthorized("Two-factor code is required".into()))?;

    let secret = decrypt_secret(
        &state.config.totp_encryption_key,
        user_id,
        &record.secret_ciphertext,
        &record.secret_nonce,
    )
    .map_err(ApiError::Internal)?;

    let Some(counter) = verify_code(
        &secret,
        code,
        Utc::now().timestamp(),
        record.last_used_counter,
    ) else {
        return Err(ApiError::Unauthorized("Invalid verification code".into()));
    };

    if !update_last_used_counter(&state.db_pool, user_id, counter)
        .await
        .map_err(|e| internal_error("consume reauthentication TOTP code", e))?
    {
        return Err(ApiError::Unauthorized(
            "Verification code has already been used".into(),
        ));
    }

    Ok(())
}
