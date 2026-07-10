use axum::{Json, extract::State};
use serde::Serialize;

use crate::auth::AuthUser;
use crate::db::storage::get_storage_quota;
use crate::state::AppState;
use crate::utils::errors::{ApiError, internal_error};

#[derive(Serialize)]
pub struct StorageQuotaResponse {
    pub total_bytes: i64,
    pub used_bytes: i64,
}

pub async fn get_quota(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<StorageQuotaResponse>, ApiError> {
    let quota = get_storage_quota(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("get storage quota", e))?;

    Ok(Json(StorageQuotaResponse {
        total_bytes: quota.total_bytes,
        used_bytes: quota.used_bytes,
    }))
}
