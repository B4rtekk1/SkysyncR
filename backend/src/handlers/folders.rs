use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use base64::{Engine as _, engine::general_purpose};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::db::folders::{
    FolderRecord, NewFolderRecord, add_user_folder_favourite, create_folder_record,
    folder_belongs_to_user, list_user_favourite_folders, list_user_folders,
    remove_user_folder_favourite, rename_user_folder, update_user_folder_share, user_folder_exists,
};
use crate::state::AppState;
use crate::utils::errors::{ApiError, internal_error};

#[derive(Deserialize)]
pub struct ListFoldersQuery {
    pub parent_folder_id: Option<String>,
    #[serde(default)]
    pub favourite: bool,
}

#[derive(Deserialize)]
pub struct CreateFolderRequest {
    pub name: String,
    pub description: Option<String>,
    pub parent_folder_id: Option<String>,
    pub encrypted_key: String,
}

#[derive(Deserialize)]
pub struct ShareFolderRequest {
    pub is_public: bool,
}

#[derive(Deserialize)]
pub struct RenameFolderRequest {
    pub name: String,
    pub description: Option<String>,
}

pub async fn list_folders(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListFoldersQuery>,
) -> Result<Json<Vec<FolderRecord>>, ApiError> {
    let folders = if query.favourite {
        list_user_favourite_folders(&state.db_pool, auth.user_id)
            .await
            .map_err(|e| internal_error("list favourite folders", e))?
    } else {
        let parent_folder_id =
            parse_optional_uuid(query.parent_folder_id.as_deref(), "parent_folder_id")?;
        list_user_folders(&state.db_pool, auth.user_id, parent_folder_id)
            .await
            .map_err(|e| internal_error("list folders", e))?
    };

    Ok(Json(folders))
}

pub async fn create_folder(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<CreateFolderRequest>,
) -> Result<(StatusCode, Json<FolderRecord>), ApiError> {
    let name = validate_folder_name(&payload.name)?;
    let description = validate_folder_description(payload.description.as_deref())?;
    let encrypted_key = decode_folder_key(&payload.encrypted_key)?;
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
            description,
            parent_folder_id,
            encrypted_key,
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

pub async fn rename_folder(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
    Json(payload): Json<RenameFolderRequest>,
) -> Result<Json<FolderRecord>, ApiError> {
    let name = validate_folder_name(&payload.name)?;
    let description = validate_folder_description(payload.description.as_deref())?;
    let folder = rename_user_folder(&state.db_pool, auth.user_id, folder_id, name, description)
        .await
        .map_err(|e| internal_error("rename folder", e))?
        .ok_or_else(|| ApiError::BadRequest("Folder not found".into()))?;

    Ok(Json(folder))
}

pub async fn add_folder_favourite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    ensure_user_folder_exists(&state, auth.user_id, folder_id).await?;

    add_user_folder_favourite(&state.db_pool, auth.user_id, folder_id)
        .await
        .map_err(|e| internal_error("add folder favourite", e))?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_folder_favourite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    ensure_user_folder_exists(&state, auth.user_id, folder_id).await?;

    remove_user_folder_favourite(&state.db_pool, auth.user_id, folder_id)
        .await
        .map_err(|e| internal_error("remove folder favourite", e))?;

    Ok(StatusCode::NO_CONTENT)
}

async fn ensure_user_folder_exists(
    state: &AppState,
    user_id: Uuid,
    folder_id: Uuid,
) -> Result<(), ApiError> {
    let exists = user_folder_exists(&state.db_pool, user_id, folder_id)
        .await
        .map_err(|e| internal_error("check favourite folder", e))?;

    if exists {
        Ok(())
    } else {
        Err(ApiError::BadRequest("Folder not found".into()))
    }
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

    if trimmed.starts_with("aes-gcm:v1:") {
        if trimmed.len() > 4096 {
            return Err(ApiError::BadRequest("Folder name is too large".into()));
        }
        if trimmed.chars().any(char::is_control) {
            return Err(ApiError::BadRequest(
                "Folder name contains invalid characters".into(),
            ));
        }
        return Ok(trimmed.to_string());
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

fn validate_folder_description(value: Option<&str>) -> Result<Option<String>, ApiError> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if trimmed.starts_with("aes-gcm:v1:") {
        if trimmed.len() > 4096 {
            return Err(ApiError::BadRequest(
                "Folder description is too large".into(),
            ));
        }
        if trimmed.chars().any(char::is_control) {
            return Err(ApiError::BadRequest(
                "Folder description contains invalid characters".into(),
            ));
        }
        return Ok(Some(trimmed.to_string()));
    }

    if trimmed.len() > 1000 {
        return Err(ApiError::BadRequest(
            "Folder description is too large".into(),
        ));
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_control() && ch != '\n' && ch != '\r' && ch != '\t')
    {
        return Err(ApiError::BadRequest(
            "Folder description contains invalid characters".into(),
        ));
    }

    Ok(Some(trimmed.to_string()))
}

fn decode_folder_key(value: &str) -> Result<Vec<u8>, ApiError> {
    let decoded = general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|_| ApiError::BadRequest("Invalid encrypted_key".into()))?;
    if decoded.len() < 128 {
        return Err(ApiError::BadRequest(
            "encrypted_key must be wrapped locally".into(),
        ));
    }
    Ok(decoded)
}
