use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::db::groups::{
    GroupInviteRecord, GroupRecord, GroupShareRecipientRecord, GroupUpdate, NewGroup,
    NewGroupInvite, create_group_invite_record, create_group_record, delete_group_invite_record,
    delete_group_record, group_belongs_to_user, list_group_share_recipients, list_user_groups,
    update_group_record,
};
use crate::state::AppState;
use crate::utils::errors::{ApiError, internal_error};
use crate::utils::validation::validate_email;

#[derive(Deserialize)]
pub struct GroupRequest {
    pub name: String,
    pub default_role: String,
}

#[derive(Deserialize)]
pub struct GroupInviteRequest {
    pub email: String,
    pub role: String,
}

pub async fn list_groups(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<GroupRecord>>, ApiError> {
    let groups = list_user_groups(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("list groups", e))?;

    Ok(Json(groups))
}

pub async fn create_group(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<GroupRequest>,
) -> Result<(StatusCode, Json<GroupRecord>), ApiError> {
    let name = validate_group_name(&payload.name)?;
    let default_role = validate_group_role(&payload.default_role)?;
    let group = create_group_record(
        &state.db_pool,
        NewGroup {
            owner_id: auth.user_id,
            name,
            default_role,
        },
    )
    .await
    .map_err(|e| internal_error("create group", e))?;

    Ok((StatusCode::CREATED, Json(group)))
}

pub async fn update_group(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(group_id): Path<Uuid>,
    Json(payload): Json<GroupRequest>,
) -> Result<Json<GroupRecord>, ApiError> {
    let name = validate_group_name(&payload.name)?;
    let default_role = validate_group_role(&payload.default_role)?;
    let group = update_group_record(
        &state.db_pool,
        auth.user_id,
        group_id,
        GroupUpdate { name, default_role },
    )
    .await
    .map_err(|e| internal_error("update group", e))?
    .ok_or_else(|| ApiError::BadRequest("Group not found".into()))?;

    Ok(Json(group))
}

pub async fn delete_group(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(group_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let rows = delete_group_record(&state.db_pool, auth.user_id, group_id)
        .await
        .map_err(|e| internal_error("delete group", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("Group not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_group_recipients(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(group_id): Path<Uuid>,
) -> Result<Json<Vec<GroupShareRecipientRecord>>, ApiError> {
    let recipients = list_group_share_recipients(&state.db_pool, auth.user_id, group_id)
        .await
        .map_err(|e| internal_error("list group recipients", e))?;

    Ok(Json(recipients))
}

pub async fn create_group_invite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(group_id): Path<Uuid>,
    Json(payload): Json<GroupInviteRequest>,
) -> Result<(StatusCode, Json<GroupInviteRecord>), ApiError> {
    let exists = group_belongs_to_user(&state.db_pool, auth.user_id, group_id)
        .await
        .map_err(|e| internal_error("check group", e))?;
    if !exists {
        return Err(ApiError::BadRequest("Group not found".into()));
    }

    let email = payload.email.trim().to_lowercase();
    validate_email(&email).map_err(|msg| ApiError::BadRequest(msg.into()))?;
    let role = validate_group_role(&payload.role)?;
    let invite = create_group_invite_record(
        &state.db_pool,
        NewGroupInvite {
            group_id,
            invited_email: email,
            invited_by_user_id: auth.user_id,
            role,
        },
    )
    .await
    .map_err(|e| internal_error("create group invite", e))?;

    Ok((StatusCode::CREATED, Json(invite)))
}

pub async fn delete_group_invite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((group_id, invite_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let rows = delete_group_invite_record(&state.db_pool, auth.user_id, group_id, invite_id)
        .await
        .map_err(|e| internal_error("delete group invite", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("Group invite not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

fn validate_group_name(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::BadRequest("Missing group name".into()));
    }
    if trimmed.len() > 120 {
        return Err(ApiError::BadRequest("Group name is too large".into()));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(ApiError::BadRequest(
            "Group name contains invalid characters".into(),
        ));
    }
    Ok(trimmed.to_string())
}

fn validate_group_role(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if matches!(trimmed, "viewer" | "editor" | "admin") {
        return Ok(trimmed.to_string());
    }

    Err(ApiError::BadRequest("Invalid group role".into()))
}
