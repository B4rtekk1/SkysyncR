use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::db::groups::{
    GroupIncomingInviteRecord, GroupInviteRecord, GroupRecord, GroupShareRecipientRecord,
    GroupUpdate, NewGroup, NewGroupInvite, accept_group_invite_record, create_group_invite_record,
    create_group_record, decline_group_invite_record, delete_group_invite_record,
    delete_group_member_record, delete_group_record, group_belongs_to_user,
    group_invite_target_available, leave_group_record, list_group_share_recipients,
    list_incoming_group_invites, list_user_groups, update_group_member_role_record,
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

#[derive(Deserialize)]
pub struct GroupMemberRoleRequest {
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

pub async fn list_incoming_invites(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<GroupIncomingInviteRecord>>, ApiError> {
    let invites = list_incoming_group_invites(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("list incoming group invites", e))?;

    Ok(Json(invites))
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
    let available = group_invite_target_available(&state.db_pool, group_id, &email)
        .await
        .map_err(|e| internal_error("check group invite target", e))?;
    if !available {
        return Err(ApiError::BadRequest(
            "This person is already a member or has a pending invitation".into(),
        ));
    }

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

pub async fn accept_group_invite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(invite_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let rows = accept_group_invite_record(&state.db_pool, auth.user_id, invite_id)
        .await
        .map_err(|e| internal_error("accept group invite", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("Group invite not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn decline_group_invite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(invite_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let rows = decline_group_invite_record(&state.db_pool, auth.user_id, invite_id)
        .await
        .map_err(|e| internal_error("decline group invite", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("Group invite not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn update_group_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((group_id, member_user_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<GroupMemberRoleRequest>,
) -> Result<StatusCode, ApiError> {
    let role = validate_group_role(&payload.role)?;
    let rows = update_group_member_role_record(
        &state.db_pool,
        auth.user_id,
        group_id,
        member_user_id,
        role,
    )
    .await
    .map_err(|e| internal_error("update group member", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("Group member not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_group_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((group_id, member_user_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let rows = delete_group_member_record(&state.db_pool, auth.user_id, group_id, member_user_id)
        .await
        .map_err(|e| internal_error("delete group member", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("Group member not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn leave_group(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(group_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let rows = leave_group_record(&state.db_pool, auth.user_id, group_id)
        .await
        .map_err(|e| internal_error("leave group", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("Group membership not found".into()));
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
