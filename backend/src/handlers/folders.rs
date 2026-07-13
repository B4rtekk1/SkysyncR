use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::db::folders::{
    FolderRecord, NewFolderRecord, create_folder_record, folder_belongs_to_user, list_user_folders,
    update_user_folder_share,
};
use crate::state::AppState;
use crate::utils::errors::{ApiError, internal_error};

#[derive(Deserialize)]
pub struct ListFoldersQuery {
    pub parent_folder_id: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateFolderRequest {
    pub name: String,
    pub parent_folder_id: Option<String>,
}

#[derive(Deserialize)]
pub struct ShareFolderRequest {
    pub is_public: bool,
}

pub async fn list_folders(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListFoldersQuery>,
) -> Result<Json<Vec<FolderRecord>>, ApiError> {
    let parent_folder_id =
        parse_optional_uuid(query.parent_folder_id.as_deref(), "parent_folder_id")?;

    let folders = list_user_folders(&state.db_pool, auth.user_id, parent_folder_id)
        .await
        .map_err(|e| internal_error("list folders", e))?;

    Ok(Json(folders))
}

pub async fn create_folder(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<CreateFolderRequest>,
) -> Result<(StatusCode, Json<FolderRecord>), ApiError> {
    let name = validate_folder_name(&payload.name)?;
    let parent_folder_id =
        parse_optional_uuid(payload.parent_folder_id.as_deref(), "parent_folder_id")?;

    if let Some(parent_id) = parent_folder_id {
        let parent_exists = folder_belongs_to_user(&state.db_pool, auth.user_id, parent_id)
            .await
            .map_err(|e| internal_error("check parent folder", e))?;
        if !parent_exists {
            return Err(ApiError::BadRequest("Parent folder not found".into()));
        }
    }

    let folder = create_folder_record(
        &state.db_pool,
        NewFolderRecord {
            owner_id: auth.user_id,
            name,
            parent_folder_id,
        },
    )
    .await
    .map_err(|e| internal_error("create folder", e))?;

    Ok((StatusCode::CREATED, Json(folder)))
}

pub async fn share_folder(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
    Json(payload): Json<ShareFolderRequest>,
) -> Result<Json<FolderRecord>, ApiError> {
    let share_token = payload.is_public.then(|| Uuid::new_v4().to_string());
    let folder = update_user_folder_share(
        &state.db_pool,
        auth.user_id,
        folder_id,
        payload.is_public,
        share_token,
    )
    .await
    .map_err(|e| internal_error("share folder", e))?
    .ok_or_else(|| ApiError::BadRequest("Folder not found".into()))?;

    Ok(Json(folder))
}

fn parse_optional_uuid(value: Option<&str>, field_name: &str) -> Result<Option<Uuid>, ApiError> {
    value
        .filter(|raw| !raw.trim().is_empty())
        .map(|raw| {
            Uuid::parse_str(raw.trim())
                .map_err(|_| ApiError::BadRequest(format!("Invalid {field_name}")))
        })
        .transpose()
}

fn validate_folder_name(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::BadRequest("Missing folder name".into()));
    }
    if trimmed.len() > 255 {
        return Err(ApiError::BadRequest("Folder name is too large".into()));
    }
    if trimmed
        .chars()
        .any(|ch| ch == '/' || ch == '\\' || ch.is_control())
    {
        return Err(ApiError::BadRequest(
            "Folder name contains invalid characters".into(),
        ));
    }

    Ok(trimmed.to_string())
}
