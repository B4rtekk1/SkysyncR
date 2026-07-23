use axum::{
    Json,
    body::Body,
    extract::{Extension, Path, Query, State},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CONTENT_DISPOSITION, CONTENT_TYPE},
    },
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::db::files::FileRecord;
use crate::db::folders::{
    FolderRecord, FolderShareRecipientRecord, FolderShareRecord, NewFolderRecord, NewFolderShare,
    add_user_folder_favourite, create_folder_record, delete_user_folder_share,
    folder_belongs_to_user, folder_is_descendant_of, get_folder_share_recipient,
    get_public_folder_file_for_download, get_public_folder_tree, list_public_folder_tree_files,
    list_user_favourite_folders, list_user_folder_shares, list_user_folders, move_user_folder,
    remove_user_folder_favourite, rename_user_folder, restore_user_folder, soft_delete_user_folder,
    update_user_folder_share, upsert_user_folder_share, user_folder_exists,
};
use crate::observability::RequestId;
use crate::services::trash::permanently_delete_user_folder;
use crate::state::AppState;
use crate::utils::errors::{ApiError, internal_error};

#[derive(Deserialize)]
pub struct ListFoldersQuery {
    pub parent_folder_id: Option<String>,
    #[serde(default)]
    pub favourite: bool,
    #[serde(default)]
    pub trashed: bool,
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
pub struct ShareRecipientQuery {
    pub email: String,
}

#[derive(Deserialize)]
pub struct CreateFolderShareRequest {
    pub email: String,
    pub permission: String,
    pub encrypted_key: String,
}

#[derive(Deserialize)]
pub struct RenameFolderRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Deserialize)]
pub struct MoveFolderRequest {
    pub parent_folder_id: Option<String>,
}

#[derive(Serialize)]
pub struct PublicFolderManifest {
    pub root: FolderRecord,
    pub folders: Vec<FolderRecord>,
    pub files: Vec<FileRecord>,
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
        list_user_folders(
            &state.db_pool,
            auth.user_id,
            parent_folder_id,
            query.trashed,
        )
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

pub async fn get_public_folder_manifest(
    State(state): State<AppState>,
    Path(share_token): Path<String>,
) -> Result<Json<PublicFolderManifest>, ApiError> {
    let share_token = validate_share_token(&share_token)?;
    let folders = get_public_folder_tree(&state.db_pool, &share_token)
        .await
        .map_err(|e| internal_error("get public folder tree", e))?;
    let root = folders
        .iter()
        .find(|folder| folder.share_token.as_deref() == Some(share_token.as_str()))
        .cloned()
        .ok_or_else(|| ApiError::BadRequest("This share link is invalid or has expired".into()))?;
    let files = list_public_folder_tree_files(&state.db_pool, &share_token)
        .await
        .map_err(|e| internal_error("list public folder files", e))?;

    Ok(Json(PublicFolderManifest {
        root,
        folders,
        files,
    }))
}

pub async fn download_public_folder_file(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path((share_token, file_id)): Path<(String, Uuid)>,
) -> Result<Response, ApiError> {
    let share_token = validate_share_token(&share_token)?;
    let file = get_public_folder_file_for_download(&state.db_pool, &share_token, file_id)
        .await
        .map_err(|e| internal_error("get public folder download file", e))?
        .ok_or_else(|| ApiError::BadRequest("File not found in this shared folder".into()))?;

    let download = fs::File::open(&file.storage_path)
        .await
        .map_err(|e| internal_error("open public folder download file", e))?;

    let mut headers = HeaderMap::new();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    if let Ok(value) = HeaderValue::from_str(&file.size_bytes.to_string()) {
        headers.insert(axum::http::header::CONTENT_LENGTH, value);
    }
    if let Some(checksum) = file.checksum.as_deref() {
        if let Ok(value) = HeaderValue::from_str(checksum) {
            headers.insert("x-skysyncr-sha256", value);
        }
    }
    if let Ok(value) =
        HeaderValue::from_str(&general_purpose::STANDARD.encode(file.filename.as_bytes()))
    {
        headers.insert("x-skysyncr-filename-b64", value);
    }
    if let Ok(value) =
        HeaderValue::from_str(&general_purpose::STANDARD.encode(&file.encryption_nonce))
    {
        headers.insert("x-skysyncr-encryption-nonce", value);
    }
    if let Some(mime_type) = file.mime_type.as_deref() {
        if let Ok(value) = HeaderValue::from_str(mime_type) {
            headers.insert("x-skysyncr-mime-type", value);
        }
    }
    let disposition = format!(
        "attachment; filename=\"{}\"",
        sanitize_download_filename(&file.filename)
    );
    headers.insert(
        CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition)
            .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
    );

    tracing::info!(
        request_id = %request_id.0,
        transfer_direction = "public_folder_download",
        share_token = %share_token,
        file_id = %file_id,
        bytes = file.size_bytes,
        "file_transfer"
    );

    Ok((headers, Body::from_stream(ReaderStream::new(download))).into_response())
}

pub async fn get_folder_share_recipient_profile(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
    Query(query): Query<ShareRecipientQuery>,
) -> Result<Json<FolderShareRecipientRecord>, ApiError> {
    let email = normalize_share_email(&query.email)?;
    let recipient = get_folder_share_recipient(&state.db_pool, auth.user_id, folder_id, &email)
        .await
        .map_err(|e| internal_error("get folder share recipient", e))?
        .ok_or_else(|| ApiError::BadRequest("User not found or cannot receive shares".into()))?;

    Ok(Json(recipient))
}

pub async fn list_folder_shares(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
) -> Result<Json<Vec<FolderShareRecord>>, ApiError> {
    ensure_user_folder_exists(&state, auth.user_id, folder_id).await?;
    let shares = list_user_folder_shares(&state.db_pool, auth.user_id, folder_id)
        .await
        .map_err(|e| internal_error("list folder shares", e))?;

    Ok(Json(shares))
}

pub async fn create_folder_share(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
    Json(payload): Json<CreateFolderShareRequest>,
) -> Result<(StatusCode, Json<FolderShareRecord>), ApiError> {
    let email = normalize_share_email(&payload.email)?;
    let permission = validate_share_permission(&payload.permission)?;
    let encrypted_key = decode_folder_key(&payload.encrypted_key)?;

    let share = upsert_user_folder_share(
        &state.db_pool,
        NewFolderShare {
            owner_id: auth.user_id,
            folder_id,
            recipient_email: email,
            permission,
            encrypted_key,
        },
    )
    .await
    .map_err(|e| internal_error("create folder share", e))?
    .ok_or_else(|| ApiError::BadRequest("User not found or cannot receive shares".into()))?;

    Ok((StatusCode::CREATED, Json(share)))
}

pub async fn delete_folder_share(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((folder_id, share_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let rows = delete_user_folder_share(&state.db_pool, auth.user_id, folder_id, share_id)
        .await
        .map_err(|e| internal_error("delete folder share", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("Folder share not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
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

pub async fn move_folder(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
    Json(payload): Json<MoveFolderRequest>,
) -> Result<Json<FolderRecord>, ApiError> {
    let parent_folder_id =
        parse_optional_uuid(payload.parent_folder_id.as_deref(), "parent_folder_id")?;

    if parent_folder_id == Some(folder_id) {
        return Err(ApiError::BadRequest(
            "Folder cannot be moved into itself".into(),
        ));
    }

    if let Some(parent_id) = parent_folder_id {
        let parent_exists = folder_belongs_to_user(&state.db_pool, auth.user_id, parent_id)
            .await
            .map_err(|e| internal_error("check move parent folder", e))?;
        if !parent_exists {
            return Err(ApiError::BadRequest("Destination folder not found".into()));
        }

        let would_create_cycle =
            folder_is_descendant_of(&state.db_pool, auth.user_id, parent_id, folder_id)
                .await
                .map_err(|e| internal_error("check folder move cycle", e))?;
        if would_create_cycle {
            return Err(ApiError::BadRequest(
                "Folder cannot be moved into its own subfolder".into(),
            ));
        }
    }

    let folder = move_user_folder(&state.db_pool, auth.user_id, folder_id, parent_folder_id)
        .await
        .map_err(|e| internal_error("move folder", e))?
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

pub async fn soft_delete_folder(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let rows = soft_delete_user_folder(&state.db_pool, auth.user_id, folder_id)
        .await
        .map_err(|e| internal_error("soft delete folder", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("Folder not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn restore_folder(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let rows = restore_user_folder(&state.db_pool, auth.user_id, folder_id)
        .await
        .map_err(|e| internal_error("restore folder", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest(
            "Folder not found in trash or storage quota exceeded".into(),
        ));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn permanent_delete_folder(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let deleted = permanently_delete_user_folder(&state.db_pool, auth.user_id, folder_id)
        .await
        .map_err(|e| internal_error("permanently delete folder", e))?;

    if !deleted {
        return Err(ApiError::BadRequest("Folder not found in trash".into()));
    }

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

fn validate_share_token(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    Uuid::parse_str(trimmed).map_err(|_| ApiError::BadRequest("Invalid share token".into()))?;
    Ok(trimmed.to_string())
}

fn sanitize_download_filename(filename: &str) -> String {
    let sanitized: String = filename
        .chars()
        .map(|ch| match ch {
            '"' | '\\' | '/' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect();

    if sanitized.trim().is_empty() {
        "download.bin".into()
    } else {
        sanitized
    }
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

fn normalize_share_email(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim().to_lowercase();
    if trimmed.is_empty() || !trimmed.contains('@') || trimmed.len() > 320 {
        return Err(ApiError::BadRequest("Enter a valid email address".into()));
    }
    Ok(trimmed)
}

fn validate_share_permission(value: &str) -> Result<String, ApiError> {
    match value {
        "read" | "download" | "write" => Ok(value.to_string()),
        _ => Err(ApiError::BadRequest("Invalid share permission".into())),
    }
}
