use axum::{
    Json,
    extract::{Multipart, Path, Query, State},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CONTENT_DISPOSITION, CONTENT_TYPE},
    },
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose};
use chrono::{Duration, Utc};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tokio::fs;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::db::files::{
    FileRecord, FileShareRecord, NewFileRecord, NewFileShare, ShareRecipientRecord,
    SharedFileRecord, add_user_file_favourite, create_file_record, delete_user_file_share,
    folder_belongs_to_user, get_file_share_recipient, get_user_file_for_content_update,
    get_user_file_for_download, list_files_shared_with_user, list_user_file_shares,
    list_user_files, remove_user_file_favourite, rename_user_file, restore_user_file,
    soft_delete_user_file, update_user_file_content, update_user_file_note, update_user_file_share,
    upsert_user_file_share, user_file_exists,
};
use crate::db::storage::get_storage_quota;
use crate::services::trash::permanently_delete_user_file;
use crate::state::AppState;
use crate::utils::errors::{ApiError, internal_error};

#[derive(Deserialize)]
pub struct ListFilesQuery {
    pub folder_id: Option<String>,
    #[serde(default)]
    pub trashed: bool,
}

#[derive(Deserialize)]
pub struct RenameFileRequest {
    pub filename: String,
}

#[derive(Deserialize)]
pub struct ShareFileRequest {
    pub is_public: bool,
    pub expires_in_seconds: Option<i64>,
    pub download_limit: Option<i32>,
}

#[derive(Deserialize)]
pub struct ShareRecipientQuery {
    pub email: String,
}

#[derive(Deserialize)]
pub struct CreateFileShareRequest {
    pub email: String,
    pub permission: String,
    pub encrypted_key: String,
}

#[derive(Deserialize)]
pub struct UpdateFileNoteRequest {
    pub note: String,
}

struct UploadPayload {
    filename: String,
    mime_type: Option<String>,
    bytes: Vec<u8>,
    encrypted_key: Vec<u8>,
    encryption_nonce: Vec<u8>,
    folder_id: Option<Uuid>,
}

struct UpdateContentPayload {
    bytes: Vec<u8>,
    encrypted_key: Vec<u8>,
    encryption_nonce: Vec<u8>,
}

pub async fn list_files(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListFilesQuery>,
) -> Result<Json<Vec<FileRecord>>, ApiError> {
    let folder_id = query
        .folder_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| ApiError::BadRequest("Invalid folder_id".into()))?;

    let files = list_user_files(&state.db_pool, auth.user_id, folder_id, query.trashed)
        .await
        .map_err(|e| internal_error("list files", e))?;

    Ok(Json(files))
}

pub async fn upload_file(
    State(state): State<AppState>,
    auth: AuthUser,
    multipart: Multipart,
) -> Result<(StatusCode, Json<FileRecord>), ApiError> {
    let payload = parse_upload_payload(multipart, state.config.max_file_size_bytes).await?;
    let file_size = i64::try_from(payload.bytes.len())
        .map_err(|_| ApiError::BadRequest("File is too large".into()))?;

    let quota = get_storage_quota(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("get storage quota", e))?;
    if quota.used_bytes.saturating_add(file_size) > quota.total_bytes {
        return Err(ApiError::BadRequest("Storage quota exceeded".into()));
    }

    if let Some(folder_id) = payload.folder_id {
        let folder_exists = folder_belongs_to_user(&state.db_pool, auth.user_id, folder_id)
            .await
            .map_err(|e| internal_error("check upload folder", e))?;
        if !folder_exists {
            return Err(ApiError::BadRequest("Folder not found".into()));
        }
    }

    let file_id = Uuid::new_v4();
    let storage_path = storage_path_for(&state.config.upload_dir, auth.user_id, file_id);
    if let Some(parent) = storage_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| internal_error("create upload directory", e))?;
    }

    fs::write(&storage_path, &payload.bytes)
        .await
        .map_err(|e| internal_error("write uploaded file", e))?;

    let checksum = hex::encode(Sha256::digest(&payload.bytes));
    let storage_path_string = storage_path.to_string_lossy().into_owned();
    let record = match create_file_record(
        &state.db_pool,
        NewFileRecord {
            owner_id: auth.user_id,
            filename: payload.filename,
            storage_path: storage_path_string,
            mime_type: payload.mime_type,
            size_bytes: file_size,
            encrypted_key: payload.encrypted_key,
            encryption_nonce: payload.encryption_nonce,
            checksum,
            folder_id: payload.folder_id,
        },
    )
    .await
    {
        Ok(record) => record,
        Err(err) => {
            let _ = fs::remove_file(&storage_path).await;
            return Err(internal_error("create file record", err));
        }
    };

    Ok((StatusCode::CREATED, Json(record)))
}

pub async fn soft_delete_file(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let rows = soft_delete_user_file(&state.db_pool, auth.user_id, file_id)
        .await
        .map_err(|e| internal_error("soft delete file", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("File not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn restore_file(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let rows = restore_user_file(&state.db_pool, auth.user_id, file_id)
        .await
        .map_err(|e| internal_error("restore file", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("File not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn permanent_delete_file(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let deleted = permanently_delete_user_file(&state.db_pool, auth.user_id, file_id)
        .await
        .map_err(|e| internal_error("permanently delete file", e))?;

    if !deleted {
        return Err(ApiError::BadRequest("File not found in trash".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn rename_file(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
    Json(payload): Json<RenameFileRequest>,
) -> Result<Json<FileRecord>, ApiError> {
    let filename = validate_upload_metadata("filename", &payload.filename)?;
    let file = rename_user_file(&state.db_pool, auth.user_id, file_id, filename)
        .await
        .map_err(|e| internal_error("rename file", e))?
        .ok_or_else(|| ApiError::BadRequest("File not found".into()))?;

    Ok(Json(file))
}

pub async fn update_file_content(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
    multipart: Multipart,
) -> Result<Json<FileRecord>, ApiError> {
    let payload = parse_update_content_payload(multipart, state.config.max_file_size_bytes).await?;
    let file_size = i64::try_from(payload.bytes.len())
        .map_err(|_| ApiError::BadRequest("File is too large".into()))?;

    let target = get_user_file_for_content_update(&state.db_pool, auth.user_id, file_id)
        .await
        .map_err(|e| internal_error("get file for content update", e))?
        .ok_or_else(|| ApiError::BadRequest("File not found".into()))?;

    let quota = get_storage_quota(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("get storage quota", e))?;
    let size_delta = file_size.saturating_sub(target.size_bytes);
    if quota.used_bytes.saturating_add(size_delta) > quota.total_bytes {
        return Err(ApiError::BadRequest("Storage quota exceeded".into()));
    }

    fs::write(&target.storage_path, &payload.bytes)
        .await
        .map_err(|e| internal_error("write updated file", e))?;

    let checksum = hex::encode(Sha256::digest(&payload.bytes));
    let file = update_user_file_content(
        &state.db_pool,
        auth.user_id,
        file_id,
        file_size,
        payload.encrypted_key,
        payload.encryption_nonce,
        checksum,
    )
    .await
    .map_err(|e| internal_error("update file content", e))?
    .ok_or_else(|| ApiError::BadRequest("File not found".into()))?;

    Ok(Json(file))
}

pub async fn share_file(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
    Json(payload): Json<ShareFileRequest>,
) -> Result<Json<FileRecord>, ApiError> {
    let share_token = payload.is_public.then(|| Uuid::new_v4().to_string());
    let share_expires_at = if payload.is_public {
        payload
            .expires_in_seconds
            .map(validate_share_duration)
            .transpose()?
            .map(|duration| Utc::now() + duration)
    } else {
        None
    };
    let share_download_limit = if payload.is_public {
        payload
            .download_limit
            .map(validate_share_download_limit)
            .transpose()?
    } else {
        None
    };
    let file = update_user_file_share(
        &state.db_pool,
        auth.user_id,
        file_id,
        payload.is_public,
        share_token,
        share_expires_at,
        share_download_limit,
    )
    .await
    .map_err(|e| internal_error("share file", e))?
    .ok_or_else(|| ApiError::BadRequest("File not found".into()))?;

    Ok(Json(file))
}

pub async fn get_file_share_recipient_profile(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
    Query(query): Query<ShareRecipientQuery>,
) -> Result<Json<ShareRecipientRecord>, ApiError> {
    let email = normalize_share_email(&query.email)?;
    let recipient = get_file_share_recipient(&state.db_pool, auth.user_id, file_id, &email)
        .await
        .map_err(|e| internal_error("get share recipient", e))?
        .ok_or_else(|| ApiError::BadRequest("User not found or cannot receive shares".into()))?;

    Ok(Json(recipient))
}

pub async fn list_file_shares(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Vec<FileShareRecord>>, ApiError> {
    ensure_user_file_exists(&state, auth.user_id, file_id).await?;
    let shares = list_user_file_shares(&state.db_pool, auth.user_id, file_id)
        .await
        .map_err(|e| internal_error("list file shares", e))?;

    Ok(Json(shares))
}

pub async fn create_file_share(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
    Json(payload): Json<CreateFileShareRequest>,
) -> Result<(StatusCode, Json<FileShareRecord>), ApiError> {
    let email = normalize_share_email(&payload.email)?;
    let permission = validate_share_permission(&payload.permission)?;
    let encrypted_key = decode_base64_field("encrypted_key", &payload.encrypted_key)?;
    if encrypted_key.len() < 128 {
        return Err(ApiError::BadRequest(
            "encrypted_key must be wrapped for the recipient".into(),
        ));
    }

    let share = upsert_user_file_share(
        &state.db_pool,
        NewFileShare {
            owner_id: auth.user_id,
            file_id,
            recipient_email: email,
            permission,
            encrypted_key,
        },
    )
    .await
    .map_err(|e| internal_error("create file share", e))?
    .ok_or_else(|| ApiError::BadRequest("User not found or cannot receive shares".into()))?;

    Ok((StatusCode::CREATED, Json(share)))
}

pub async fn delete_file_share(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((file_id, share_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let rows = delete_user_file_share(&state.db_pool, auth.user_id, file_id, share_id)
        .await
        .map_err(|e| internal_error("delete file share", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("File share not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

fn validate_share_duration(seconds: i64) -> Result<Duration, ApiError> {
    const MIN_SHARE_SECONDS: i64 = 60;
    const MAX_SHARE_SECONDS: i64 = 60 * 60 * 24 * 365;

    if !(MIN_SHARE_SECONDS..=MAX_SHARE_SECONDS).contains(&seconds) {
        return Err(ApiError::BadRequest(
            "Share duration must be between 1 minute and 365 days".into(),
        ));
    }

    Ok(Duration::seconds(seconds))
}

fn validate_share_download_limit(limit: i32) -> Result<i32, ApiError> {
    const MIN_DOWNLOAD_LIMIT: i32 = 1;
    const MAX_DOWNLOAD_LIMIT: i32 = 1_000_000;

    if !(MIN_DOWNLOAD_LIMIT..=MAX_DOWNLOAD_LIMIT).contains(&limit) {
        return Err(ApiError::BadRequest(
            "Download limit must be between 1 and 1000000".into(),
        ));
    }

    Ok(limit)
}

fn normalize_share_email(value: &str) -> Result<String, ApiError> {
    let email = value.trim().to_lowercase();
    crate::utils::validation::validate_email(&email)
        .map_err(|msg| ApiError::BadRequest(msg.into()))?;
    Ok(email)
}

fn validate_share_permission(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if matches!(trimmed, "read" | "download" | "write") {
        return Ok(trimmed.to_string());
    }

    Err(ApiError::BadRequest("Invalid share permission".into()))
}

pub async fn update_file_note(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
    Json(payload): Json<UpdateFileNoteRequest>,
) -> Result<Json<FileRecord>, ApiError> {
    let note = normalize_file_note(&payload.note)?;
    let file = update_user_file_note(&state.db_pool, auth.user_id, file_id, note)
        .await
        .map_err(|e| internal_error("update file note", e))?
        .ok_or_else(|| ApiError::BadRequest("File not found".into()))?;

    Ok(Json(file))
}

pub async fn add_file_favourite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    ensure_user_file_exists(&state, auth.user_id, file_id).await?;

    add_user_file_favourite(&state.db_pool, auth.user_id, file_id)
        .await
        .map_err(|e| internal_error("add file favourite", e))?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_file_favourite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    ensure_user_file_exists(&state, auth.user_id, file_id).await?;

    remove_user_file_favourite(&state.db_pool, auth.user_id, file_id)
        .await
        .map_err(|e| internal_error("remove file favourite", e))?;

    Ok(StatusCode::NO_CONTENT)
}

async fn ensure_user_file_exists(
    state: &AppState,
    user_id: Uuid,
    file_id: Uuid,
) -> Result<(), ApiError> {
    let exists = user_file_exists(&state.db_pool, user_id, file_id)
        .await
        .map_err(|e| internal_error("check favourite file", e))?;

    if exists {
        Ok(())
    } else {
        Err(ApiError::BadRequest("File not found".into()))
    }
}

pub async fn download_file(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let file = get_user_file_for_download(&state.db_pool, auth.user_id, file_id)
        .await
        .map_err(|e| internal_error("get download file", e))?
        .ok_or_else(|| ApiError::BadRequest("File not found".into()))?;

    let bytes = fs::read(&file.storage_path)
        .await
        .map_err(|e| internal_error("read download file", e))?;

    let mut headers = HeaderMap::new();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    let disposition = format!(
        "attachment; filename=\"{}\"",
        sanitize_download_filename(&file.filename)
    );
    headers.insert(
        CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition)
            .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
    );

    Ok((headers, bytes).into_response())
}

pub async fn list_shared_files_with_me(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<SharedFileRecord>>, ApiError> {
    let files = list_files_shared_with_user(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("list shared files", e))?;

    Ok(Json(files))
}

async fn parse_update_content_payload(
    mut multipart: Multipart,
    max_file_size_bytes: u64,
) -> Result<UpdateContentPayload, ApiError> {
    let mut bytes: Option<Vec<u8>> = None;
    let mut encrypted_key: Option<Vec<u8>> = None;
    let mut encryption_nonce: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| ApiError::BadRequest("Invalid multipart body".into()))?
    {
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "file" => {
                let data = field
                    .bytes()
                    .await
                    .map_err(|_| ApiError::BadRequest("Invalid uploaded file".into()))?;
                if data.len() as u64 > max_file_size_bytes {
                    return Err(ApiError::BadRequest("File is too large".into()));
                }
                if data.is_empty() {
                    return Err(ApiError::BadRequest("File is empty".into()));
                }
                bytes = Some(data.to_vec());
            }
            "encrypted_key" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| ApiError::BadRequest("Invalid encrypted_key".into()))?;
                let decoded = decode_base64_field("encrypted_key", &value)?;
                if decoded.len() < 128 {
                    return Err(ApiError::BadRequest(
                        "encrypted_key must be wrapped locally".into(),
                    ));
                }
                encrypted_key = Some(decoded);
            }
            "encryption_nonce" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| ApiError::BadRequest("Invalid encryption_nonce".into()))?;
                let decoded = decode_base64_field("encryption_nonce", &value)?;
                if decoded.len() != 12 {
                    return Err(ApiError::BadRequest("Invalid encryption_nonce".into()));
                }
                encryption_nonce = Some(decoded);
            }
            _ => {}
        }
    }

    Ok(UpdateContentPayload {
        bytes: bytes.ok_or_else(|| ApiError::BadRequest("Missing file".into()))?,
        encrypted_key: encrypted_key
            .ok_or_else(|| ApiError::BadRequest("Missing encrypted_key".into()))?,
        encryption_nonce: encryption_nonce
            .ok_or_else(|| ApiError::BadRequest("Missing encryption_nonce".into()))?,
    })
}

async fn parse_upload_payload(
    mut multipart: Multipart,
    max_file_size_bytes: u64,
) -> Result<UploadPayload, ApiError> {
    let mut filename: Option<String> = None;
    let mut mime_type: Option<String> = None;
    let mut bytes: Option<Vec<u8>> = None;
    let mut encrypted_key: Option<Vec<u8>> = None;
    let mut encryption_nonce: Option<Vec<u8>> = None;
    let mut folder_id: Option<Uuid> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| ApiError::BadRequest("Invalid multipart body".into()))?
    {
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "file" => {
                let content_type = field.content_type().map(|value| value.to_string());
                let data = field
                    .bytes()
                    .await
                    .map_err(|_| ApiError::BadRequest("Invalid uploaded file".into()))?;
                if data.len() as u64 > max_file_size_bytes {
                    return Err(ApiError::BadRequest("File is too large".into()));
                }
                if data.is_empty() {
                    return Err(ApiError::BadRequest("File is empty".into()));
                }
                bytes = Some(data.to_vec());
                mime_type = content_type;
            }
            "filename" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| ApiError::BadRequest("Invalid filename".into()))?;
                filename = Some(validate_upload_metadata("filename", &value)?);
            }
            "mime_type" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| ApiError::BadRequest("Invalid mime_type".into()))?;
                let trimmed = validate_upload_metadata("mime_type", &value)?;
                mime_type = Some(trimmed);
            }
            "encrypted_key" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| ApiError::BadRequest("Invalid encrypted_key".into()))?;
                let decoded = decode_base64_field("encrypted_key", &value)?;
                if decoded.len() < 128 {
                    return Err(ApiError::BadRequest(
                        "encrypted_key must be wrapped locally".into(),
                    ));
                }
                encrypted_key = Some(decoded);
            }
            "encryption_nonce" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| ApiError::BadRequest("Invalid encryption_nonce".into()))?;
                let decoded = decode_base64_field("encryption_nonce", &value)?;
                if decoded.len() != 12 {
                    return Err(ApiError::BadRequest("Invalid encryption_nonce".into()));
                }
                encryption_nonce = Some(decoded);
            }
            "folder_id" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| ApiError::BadRequest("Invalid folder_id".into()))?;
                if !value.trim().is_empty() {
                    folder_id = Some(
                        Uuid::parse_str(value.trim())
                            .map_err(|_| ApiError::BadRequest("Invalid folder_id".into()))?,
                    );
                }
            }
            _ => {}
        }
    }

    Ok(UploadPayload {
        filename: filename
            .filter(|value| !value.is_empty())
            .ok_or_else(|| ApiError::BadRequest("Missing filename".into()))?,
        mime_type,
        bytes: bytes.ok_or_else(|| ApiError::BadRequest("Missing file".into()))?,
        encrypted_key: encrypted_key
            .ok_or_else(|| ApiError::BadRequest("Missing encrypted_key".into()))?,
        encryption_nonce: encryption_nonce
            .ok_or_else(|| ApiError::BadRequest("Missing encryption_nonce".into()))?,
        folder_id,
    })
}

fn storage_path_for(upload_dir: &PathBuf, user_id: Uuid, file_id: Uuid) -> PathBuf {
    upload_dir
        .join(user_id.to_string())
        .join(format!("{file_id}.bin"))
}

fn validate_upload_metadata(field_name: &str, value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::BadRequest(format!("Missing {field_name}")));
    }
    let max_len = if field_name == "filename" { 4096 } else { 1024 };
    if trimmed.len() > max_len {
        return Err(ApiError::BadRequest(format!("{field_name} is too large")));
    }

    Ok(trimmed.to_string())
}

fn normalize_file_note(value: &str) -> Result<Option<String>, ApiError> {
    const MAX_NOTE_LEN: usize = 40_000;
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > MAX_NOTE_LEN {
        return Err(ApiError::BadRequest("Note is too large".into()));
    }

    Ok(Some(trimmed.to_string()))
}

fn decode_base64_field(field_name: &str, value: &str) -> Result<Vec<u8>, ApiError> {
    general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|_| ApiError::BadRequest(format!("Invalid {field_name}")))
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
