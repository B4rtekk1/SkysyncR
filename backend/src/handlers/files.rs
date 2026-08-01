use axum::{
    Json,
    body::{Body, Bytes},
    extract::{Extension, Multipart, Path, Query, State},
    http::{
        HeaderMap, HeaderName, HeaderValue, StatusCode,
        header::{CONTENT_DISPOSITION, CONTENT_TYPE, USER_AGENT},
    },
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose};
use bcrypt::{DEFAULT_COST, hash};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path as FsPath, PathBuf};
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::db::files::{
    FileListPageCursor, FileListPageOptions, FileRecord, FileShareRecord, NewFileRecord,
    NewFileShare, ShareRecipientRecord, SharedFileRecord, UpdatedFileContent,
    add_user_file_favourite, consume_public_file_share_for_download, create_file_record,
    create_file_version_snapshot_in_tx, delete_user_file_share, expire_user_file_public_links,
    file_content_key_fingerprint_exists_in_tx, folder_belongs_to_user, get_file_share_recipient,
    get_user_file_for_content_update_in_tx, get_user_file_for_download, insert_file_audit_log,
    list_files_shared_with_user, list_public_file_share_access_events, list_user_file_audit_logs,
    list_user_file_shares, list_user_file_versions, list_user_files, list_user_files_page,
    move_user_file, remove_user_file_favourite, rename_user_file, restore_user_file,
    restore_user_file_version, soft_delete_user_file, update_user_file_content,
    update_user_file_note, update_user_file_share, update_user_file_share_keys_in_tx,
    upsert_user_file_share, user_file_exists,
};
use crate::db::notifications::NewNotification;
use crate::db::storage::try_apply_storage_delta;
use crate::observability::{RequestId, record_transfer_error, record_transfer_success};
use crate::security::{ReauthenticationRequest, verify_reauthentication};
use crate::services::notifications::create_and_publish_notification;
use crate::services::ransomware_detection::detect_and_alert_after_file_mutation;
use crate::services::trash::permanently_delete_user_file;
use crate::state::AppState;
use crate::utils::errors::{ApiError, internal_error};

const DEVICE_LABEL_HEADER: &str = "x-skysyncr-device-label";

#[derive(Deserialize)]
pub struct ListFilesQuery {
    pub folder_id: Option<String>,
    pub tag_id: Option<String>,
    #[serde(default)]
    pub trashed: bool,
    pub limit: Option<i64>,
    pub cursor: Option<String>,
    pub search: Option<String>,
}

#[derive(Deserialize)]
pub struct RenameFileRequest {
    pub filename: String,
}

#[derive(Deserialize)]
pub struct MoveFileRequest {
    pub folder_id: Option<String>,
}

#[derive(Deserialize)]
pub struct ShareFileRequest {
    pub is_public: bool,
    pub starts_at: Option<chrono::DateTime<Utc>>,
    pub expires_at: Option<chrono::DateTime<Utc>>,
    pub expires_in_seconds: Option<i64>,
    pub download_limit: Option<i32>,
    #[serde(default)]
    pub one_time: bool,
    pub password: Option<String>,
    pub recipient_email: Option<String>,
}

#[derive(Deserialize)]
pub struct PublicFileDownloadRequest {
    pub password: Option<String>,
    pub recipient_email: Option<String>,
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

#[derive(Deserialize)]
pub struct StartUploadRequest {
    pub upload_id: Uuid,
}

#[derive(Deserialize)]
pub struct CompleteUploadRequest {
    pub filename: String,
    pub mime_type: Option<String>,
    pub folder_id: Option<Uuid>,
    pub encrypted_key: String,
    pub encryption_nonce: String,
    pub content_key_fingerprint: Option<String>,
    pub size_bytes: u64,
}

#[derive(Serialize)]
pub struct UploadSessionStatus {
    pub upload_id: Uuid,
    pub offset: u64,
}

#[derive(Serialize)]
pub struct FileListPage {
    pub items: Vec<FileRecord>,
    pub next_cursor: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct FileCursorToken {
    updated_at: chrono::DateTime<Utc>,
    id: Uuid,
}

struct UploadPayload {
    filename: String,
    mime_type: Option<String>,
    file_size: u64,
    checksum: String,
    encrypted_key: Vec<u8>,
    encryption_nonce: Vec<u8>,
    content_key_fingerprint: Option<String>,
    folder_id: Option<Uuid>,
}

pub async fn start_resumable_upload(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<StartUploadRequest>,
) -> Result<(StatusCode, Json<UploadSessionStatus>), ApiError> {
    let temp_path =
        resumable_temp_storage_path_for(&state.config.upload_dir, auth.user_id, payload.upload_id);
    if let Some(parent) = temp_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| internal_error("create upload directory", e))?;
    }

    if !fs::try_exists(&temp_path)
        .await
        .map_err(|e| internal_error("check resumable upload", e))?
    {
        fs::File::create(&temp_path)
            .await
            .map_err(|e| internal_error("create resumable upload", e))?;
    }

    resumable_upload_status(State(state), auth, Path(payload.upload_id))
        .await
        .map(|status| (StatusCode::CREATED, status))
}

pub async fn resumable_upload_status(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(upload_id): Path<Uuid>,
) -> Result<Json<UploadSessionStatus>, ApiError> {
    let temp_path =
        resumable_temp_storage_path_for(&state.config.upload_dir, auth.user_id, upload_id);
    let offset = match fs::metadata(&temp_path).await {
        Ok(metadata) => metadata.len(),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => 0,
        Err(err) => return Err(internal_error("read resumable upload status", err)),
    };

    Ok(Json(UploadSessionStatus { upload_id, offset }))
}

pub async fn append_resumable_upload_chunk(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(upload_id): Path<Uuid>,
    headers: HeaderMap,
    chunk: Bytes,
) -> Result<Json<UploadSessionStatus>, ApiError> {
    if chunk.is_empty() {
        record_transfer_error("resumable_upload_chunk", "empty_chunk");
        return Err(ApiError::BadRequest("Upload chunk is empty".into()));
    }

    let expected_offset = header_u64(&headers, "upload-offset")?;
    let temp_path =
        resumable_temp_storage_path_for(&state.config.upload_dir, auth.user_id, upload_id);
    if let Some(parent) = temp_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| internal_error("create upload directory", e))?;
    }

    let current_offset = match fs::metadata(&temp_path).await {
        Ok(metadata) => metadata.len(),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => 0,
        Err(err) => return Err(internal_error("read resumable upload offset", err)),
    };

    if current_offset != expected_offset {
        record_transfer_error("resumable_upload_chunk", "offset_mismatch");
        return Err(ApiError::Conflict(format!(
            "Upload offset mismatch: expected {current_offset}"
        )));
    }

    let next_offset = current_offset
        .checked_add(chunk.len() as u64)
        .ok_or_else(|| ApiError::BadRequest("File is too large".into()))?;
    if next_offset > state.config.max_file_size_bytes {
        record_transfer_error("resumable_upload_chunk", "file_too_large");
        return Err(ApiError::BadRequest("File is too large".into()));
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&temp_path)
        .await
        .map_err(|e| internal_error("open resumable upload", e))?;
    file.write_all(&chunk)
        .await
        .map_err(|e| internal_error("write resumable upload chunk", e))?;
    file.flush()
        .await
        .map_err(|e| internal_error("flush resumable upload chunk", e))?;
    record_transfer_success("resumable_upload_chunk", chunk.len() as i64);

    Ok(Json(UploadSessionStatus {
        upload_id,
        offset: next_offset,
    }))
}

pub async fn complete_resumable_upload(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
    auth: AuthUser,
    Path(upload_id): Path<Uuid>,
    Json(payload): Json<CompleteUploadRequest>,
) -> Result<(StatusCode, Json<FileRecord>), ApiError> {
    let temp_path =
        resumable_temp_storage_path_for(&state.config.upload_dir, auth.user_id, upload_id);
    let metadata = fs::metadata(&temp_path).await.map_err(|_| {
        record_transfer_error("resumable_upload", "session_not_found");
        ApiError::BadRequest("Upload session not found".into())
    })?;
    if metadata.len() == 0 {
        record_transfer_error("resumable_upload", "empty_file");
        return Err(ApiError::BadRequest("File is empty".into()));
    }
    if metadata.len() != payload.size_bytes {
        record_transfer_error("resumable_upload", "incomplete_upload");
        return Err(ApiError::BadRequest("Upload is incomplete".into()));
    }
    if payload.size_bytes > state.config.max_file_size_bytes {
        record_transfer_error("resumable_upload", "file_too_large");
        return Err(ApiError::BadRequest("File is too large".into()));
    }

    let filename = validate_upload_metadata("filename", &payload.filename)?;
    let mime_type = payload
        .mime_type
        .as_deref()
        .map(|value| validate_upload_metadata("mime_type", value))
        .transpose()?;
    let encrypted_key = decode_base64_field("encrypted_key", &payload.encrypted_key)?;
    if encrypted_key.len() < 128 {
        return Err(ApiError::BadRequest(
            "encrypted_key must be wrapped locally".into(),
        ));
    }
    let encryption_nonce = decode_base64_field("encryption_nonce", &payload.encryption_nonce)?;
    if !is_valid_file_encryption_nonce(&encryption_nonce) {
        return Err(ApiError::BadRequest("Invalid encryption_nonce".into()));
    }
    let content_key_fingerprint = payload
        .content_key_fingerprint
        .as_deref()
        .map(validate_content_key_fingerprint)
        .transpose()?;

    if let Some(folder_id) = payload.folder_id {
        let folder_exists = folder_belongs_to_user(&state.db_pool, auth.user_id, folder_id)
            .await
            .map_err(|e| internal_error("check upload folder", e))?;
        if !folder_exists {
            return Err(ApiError::BadRequest("Folder not found".into()));
        }
    }

    let checksum = sha256_file(&temp_path).await?;
    let file_size = i64::try_from(payload.size_bytes)
        .map_err(|_| ApiError::BadRequest("File is too large".into()))?;
    let mut tx = state
        .db_pool
        .begin()
        .await
        .map_err(|e| internal_error("begin resumable upload transaction", e))?;

    let quota_reserved = try_apply_storage_delta(&mut tx, auth.user_id, file_size)
        .await
        .map_err(|e| internal_error("reserve upload storage", e))?;
    if !quota_reserved {
        record_transfer_error("resumable_upload", "quota_exceeded");
        return Err(ApiError::BadRequest("Storage quota exceeded".into()));
    }

    let provisional_storage_path =
        storage_path_for(&state.config.upload_dir, auth.user_id, upload_id);
    let provisional_storage_path_string = provisional_storage_path.to_string_lossy().into_owned();
    let mut record = match create_file_record(
        &mut tx,
        NewFileRecord {
            owner_id: auth.user_id,
            filename,
            storage_path: provisional_storage_path_string,
            mime_type,
            size_bytes: file_size,
            encrypted_key,
            encryption_nonce,
            content_key_fingerprint: content_key_fingerprint.clone(),
            checksum: checksum.clone(),
            folder_id: payload.folder_id,
        },
    )
    .await
    {
        Ok(record) => record,
        Err(err) => return Err(internal_error("create resumable file record", err)),
    };

    let storage_path = storage_path_for(&state.config.upload_dir, auth.user_id, record.id);
    let storage_path_string = storage_path.to_string_lossy().into_owned();
    let updated_record = update_user_file_content(
        &mut tx,
        auth.user_id,
        record.id,
        UpdatedFileContent {
            storage_path: storage_path_string.clone(),
            size_bytes: file_size,
            encrypted_key: record.encrypted_key.clone(),
            encryption_nonce: record.encryption_nonce.clone(),
            content_key_fingerprint,
            checksum: Some(checksum),
        },
    )
    .await
    .map_err(|e| internal_error("align resumable file storage path", e))?;
    if let Some(updated_record) = updated_record {
        record = updated_record;
    }

    if let Err(err) = fs::rename(&temp_path, &storage_path).await {
        record_transfer_error("resumable_upload", "promote_failed");
        return Err(internal_error("promote resumable uploaded file", err));
    }

    if let Err(err) = tx.commit().await {
        let _ = fs::remove_file(&storage_path).await;
        return Err(internal_error("commit resumable upload transaction", err));
    }

    tracing::info!(
        request_id = %request_id.0,
        transfer_direction = "upload",
        user_id = %auth.user_id,
        file_id = %record.id,
        bytes = file_size,
        "file_transfer"
    );
    record_transfer_success("resumable_upload", file_size);

    log_file_audit(
        &state,
        auth.user_id,
        "file.upload",
        record.id,
        device_label_from_headers(&headers).as_deref(),
    )
    .await;
    notify_upload_completed(&state, auth.user_id, &record).await;

    Ok((StatusCode::CREATED, Json(record)))
}

pub async fn cancel_resumable_upload(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(upload_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let temp_path =
        resumable_temp_storage_path_for(&state.config.upload_dir, auth.user_id, upload_id);
    match fs::remove_file(&temp_path).await {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(StatusCode::NO_CONTENT),
        Err(err) => Err(internal_error("cancel resumable upload", err)),
    }
}

struct UpdateContentPayload {
    file_size: u64,
    checksum: String,
    encrypted_key: Vec<u8>,
    encryption_nonce: Vec<u8>,
    content_key_fingerprint: String,
    share_keys: Vec<FileShareKeyPayload>,
    base_updated_at: Option<chrono::DateTime<Utc>>,
    force: bool,
}

#[derive(Deserialize)]
struct FileShareKeyPayload {
    share_id: Uuid,
    encrypted_key: String,
}

pub async fn list_files(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListFilesQuery>,
) -> Result<Response, ApiError> {
    let root_only = query
        .folder_id
        .as_deref()
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("root"));
    let folder_id = if root_only {
        None
    } else {
        query
            .folder_id
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|_| ApiError::BadRequest("Invalid folder_id".into()))?
    };
    let tag_id = query
        .tag_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| ApiError::BadRequest("Invalid tag_id".into()))?;

    if query.limit.is_some() || query.cursor.is_some() || query.search.is_some() {
        let limit = validate_page_limit(query.limit)?;
        let cursor = query
            .cursor
            .as_deref()
            .map(decode_file_cursor)
            .transpose()?;
        let search = normalize_search_query(query.search.as_deref())?;
        let (items, has_more) = list_user_files_page(
            &state.db_pool,
            auth.user_id,
            folder_id,
            tag_id,
            query.trashed,
            root_only,
            FileListPageOptions {
                limit,
                cursor,
                search,
            },
        )
        .await
        .map_err(|e| internal_error("list files page", e))?;
        let next_cursor = has_more
            .then(|| items.last())
            .flatten()
            .map(encode_file_cursor)
            .transpose()?;
        return Ok(Json(FileListPage { items, next_cursor }).into_response());
    }

    let files = list_user_files(
        &state.db_pool,
        auth.user_id,
        folder_id,
        tag_id,
        query.trashed,
        root_only,
    )
    .await
    .map_err(|e| internal_error("list files", e))?;

    Ok(Json(files).into_response())
}

pub async fn upload_file(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
    auth: AuthUser,
    multipart: Multipart,
) -> Result<(StatusCode, Json<FileRecord>), ApiError> {
    let file_id = Uuid::new_v4();
    let storage_path = storage_path_for(&state.config.upload_dir, auth.user_id, file_id);
    let temp_path = temp_storage_path_for(&state.config.upload_dir, auth.user_id, file_id);
    if let Some(parent) = storage_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| internal_error("create upload directory", e))?;
    }

    let payload =
        match parse_upload_payload(multipart, state.config.max_file_size_bytes, &temp_path).await {
            Ok(payload) => payload,
            Err(err) => {
                let _ = fs::remove_file(&temp_path).await;
                record_transfer_error("upload", "invalid_payload");
                return Err(err);
            }
        };
    let file_size = i64::try_from(payload.file_size)
        .map_err(|_| ApiError::BadRequest("File is too large".into()))?;

    if let Some(folder_id) = payload.folder_id {
        let folder_exists = folder_belongs_to_user(&state.db_pool, auth.user_id, folder_id)
            .await
            .map_err(|e| internal_error("check upload folder", e))?;
        if !folder_exists {
            return Err(ApiError::BadRequest("Folder not found".into()));
        }
    }

    let storage_path_string = storage_path.to_string_lossy().into_owned();
    let mut tx = state
        .db_pool
        .begin()
        .await
        .map_err(|e| internal_error("begin upload transaction", e))?;

    let quota_reserved = try_apply_storage_delta(&mut tx, auth.user_id, file_size)
        .await
        .map_err(|e| internal_error("reserve upload storage", e))?;
    if !quota_reserved {
        let _ = fs::remove_file(&temp_path).await;
        record_transfer_error("upload", "quota_exceeded");
        return Err(ApiError::BadRequest("Storage quota exceeded".into()));
    }

    let record = match create_file_record(
        &mut tx,
        NewFileRecord {
            owner_id: auth.user_id,
            filename: payload.filename,
            storage_path: storage_path_string,
            mime_type: payload.mime_type,
            size_bytes: file_size,
            encrypted_key: payload.encrypted_key,
            encryption_nonce: payload.encryption_nonce,
            content_key_fingerprint: payload.content_key_fingerprint,
            checksum: payload.checksum,
            folder_id: payload.folder_id,
        },
    )
    .await
    {
        Ok(record) => record,
        Err(err) => {
            let _ = fs::remove_file(&temp_path).await;
            record_transfer_error("upload", "record_create_failed");
            return Err(internal_error("create file record", err));
        }
    };

    if let Err(err) = fs::rename(&temp_path, &storage_path).await {
        let _ = fs::remove_file(&temp_path).await;
        record_transfer_error("upload", "promote_failed");
        return Err(internal_error("promote uploaded file", err));
    }

    if let Err(err) = tx.commit().await {
        let _ = fs::remove_file(&storage_path).await;
        return Err(internal_error("commit upload transaction", err));
    }

    tracing::info!(
        request_id = %request_id.0,
        transfer_direction = "upload",
        user_id = %auth.user_id,
        file_id = %record.id,
        bytes = file_size,
        "file_transfer"
    );
    record_transfer_success("upload", file_size);

    log_file_audit(
        &state,
        auth.user_id,
        "file.upload",
        record.id,
        device_label_from_headers(&headers).as_deref(),
    )
    .await;
    notify_upload_completed(&state, auth.user_id, &record).await;

    Ok((StatusCode::CREATED, Json(record)))
}

pub async fn soft_delete_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let rows = soft_delete_user_file(&state.db_pool, auth.user_id, file_id)
        .await
        .map_err(|e| internal_error("soft delete file", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("File not found".into()));
    }

    log_file_audit(
        &state,
        auth.user_id,
        "file.delete",
        file_id,
        device_label_from_headers(&headers).as_deref(),
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn restore_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let rows = restore_user_file(&state.db_pool, auth.user_id, file_id)
        .await
        .map_err(|e| internal_error("restore file", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("File not found".into()));
    }

    log_file_audit(
        &state,
        auth.user_id,
        "file.restore",
        file_id,
        device_label_from_headers(&headers).as_deref(),
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn permanent_delete_file(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
    Json(reauth): Json<ReauthenticationRequest>,
) -> Result<StatusCode, ApiError> {
    verify_reauthentication(&state, auth.user_id, &reauth).await?;

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
    headers: HeaderMap,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
    Json(payload): Json<RenameFileRequest>,
) -> Result<Json<FileRecord>, ApiError> {
    let filename = validate_upload_metadata("filename", &payload.filename)?;
    let file = rename_user_file(&state.db_pool, auth.user_id, file_id, filename)
        .await
        .map_err(|e| internal_error("rename file", e))?
        .ok_or_else(|| ApiError::BadRequest("File not found".into()))?;

    log_file_audit(
        &state,
        auth.user_id,
        "file.rename",
        file_id,
        device_label_from_headers(&headers).as_deref(),
    )
    .await;

    Ok(Json(file))
}

pub async fn update_file_content(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
    multipart: Multipart,
) -> Result<Json<FileRecord>, ApiError> {
    let temp_path = temp_storage_path_for(&state.config.upload_dir, auth.user_id, file_id);
    if let Some(parent) = temp_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| internal_error("create upload directory", e))?;
    }
    let payload =
        match parse_update_content_payload(multipart, state.config.max_file_size_bytes, &temp_path)
            .await
        {
            Ok(payload) => payload,
            Err(err) => {
                let _ = fs::remove_file(&temp_path).await;
                record_transfer_error("update", "invalid_payload");
                return Err(err);
            }
        };
    let file_size = i64::try_from(payload.file_size)
        .map_err(|_| ApiError::BadRequest("File is too large".into()))?;

    let mut tx = state
        .db_pool
        .begin()
        .await
        .map_err(|e| internal_error("begin file update transaction", e))?;

    let target = match get_user_file_for_content_update_in_tx(&mut tx, auth.user_id, file_id).await
    {
        Ok(Some(target)) => target,
        Ok(None) => {
            let _ = fs::remove_file(&temp_path).await;
            record_transfer_error("update", "file_not_found");
            return Err(ApiError::BadRequest("File not found".into()));
        }
        Err(err) => {
            let _ = fs::remove_file(&temp_path).await;
            record_transfer_error("update", "record_lookup_failed");
            return Err(internal_error("get file for content update", err));
        }
    };

    if !payload.force {
        let Some(base_updated_at) = payload.base_updated_at else {
            let _ = fs::remove_file(&temp_path).await;
            record_transfer_error("update", "missing_base_version");
            return Err(ApiError::BadRequest("Missing base_updated_at".into()));
        };

        if base_updated_at != target.updated_at {
            let _ = fs::remove_file(&temp_path).await;
            record_transfer_error("update", "version_conflict");
            return Err(ApiError::Conflict(
                "File changed since you opened it. Refresh the preview or force save to create another version.".into(),
            ));
        }
    }

    let size_delta =
        file_size.saturating_sub(target.size_bytes) - target.size_bytes.saturating_sub(file_size);
    let quota_reserved = try_apply_storage_delta(&mut tx, target.owner_id, size_delta)
        .await
        .map_err(|e| internal_error("reserve updated file storage", e))?;
    if !quota_reserved {
        let _ = fs::remove_file(&temp_path).await;
        record_transfer_error("update", "quota_exceeded");
        return Err(ApiError::BadRequest("Storage quota exceeded".into()));
    }

    let new_storage_path =
        updated_storage_path_for(&state.config.upload_dir, auth.user_id, file_id);
    let new_storage_path_string = new_storage_path.to_string_lossy().into_owned();
    if let Err(err) = fs::rename(&temp_path, &new_storage_path).await {
        let _ = fs::remove_file(&temp_path).await;
        record_transfer_error("update", "promote_failed");
        return Err(internal_error("promote updated file", err));
    }

    let device_label = device_label_from_headers(&headers);
    let key_already_used = file_content_key_fingerprint_exists_in_tx(
        &mut tx,
        auth.user_id,
        file_id,
        &payload.content_key_fingerprint,
    )
    .await
    .map_err(|e| {
        let _ = std::fs::remove_file(&new_storage_path);
        internal_error("check file content key rotation", e)
    })?;
    if key_already_used {
        let _ = fs::remove_file(&new_storage_path).await;
        record_transfer_error("update", "reused_content_key");
        return Err(ApiError::BadRequest(
            "A new file encryption key is required for each file version".into(),
        ));
    }

    create_file_version_snapshot_in_tx(
        &mut tx,
        file_id,
        &target,
        auth.user_id,
        device_label.as_deref(),
        "update",
    )
    .await
    .map_err(|e| {
        let _ = std::fs::remove_file(&new_storage_path);
        internal_error("create file version", e)
    })?;

    let share_keys = payload
        .share_keys
        .into_iter()
        .map(|share_key| {
            let encrypted_key =
                decode_base64_field("share_keys.encrypted_key", &share_key.encrypted_key)?;
            if encrypted_key.len() < 128 {
                return Err(ApiError::BadRequest(
                    "share_keys encrypted_key must be wrapped for the recipient".into(),
                ));
            }
            Ok((share_key.share_id, encrypted_key))
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    let share_keys_updated =
        update_user_file_share_keys_in_tx(&mut tx, auth.user_id, file_id, share_keys)
            .await
            .map_err(|e| {
                let _ = std::fs::remove_file(&new_storage_path);
                internal_error("update file share keys", e)
            })?;
    if !share_keys_updated {
        let _ = fs::remove_file(&new_storage_path).await;
        record_transfer_error("update", "missing_share_keys");
        return Err(ApiError::BadRequest(
            "Missing rotated keys for one or more file shares".into(),
        ));
    }

    let file = update_user_file_content(
        &mut tx,
        auth.user_id,
        file_id,
        UpdatedFileContent {
            storage_path: new_storage_path_string,
            size_bytes: file_size,
            encrypted_key: payload.encrypted_key,
            encryption_nonce: payload.encryption_nonce,
            content_key_fingerprint: Some(payload.content_key_fingerprint),
            checksum: Some(payload.checksum),
        },
    )
    .await
    .map_err(|e| {
        let _ = std::fs::remove_file(&new_storage_path);
        internal_error("update file content", e)
    })?
    .ok_or_else(|| {
        let _ = std::fs::remove_file(&new_storage_path);
        ApiError::BadRequest("File not found".into())
    })?;

    if let Err(err) = tx.commit().await {
        let _ = fs::remove_file(&new_storage_path).await;
        return Err(internal_error("commit file update transaction", err));
    }

    tracing::info!(
        request_id = %request_id.0,
        transfer_direction = "update",
        user_id = %auth.user_id,
        file_id = %file.id,
        bytes = file_size,
        "file_transfer"
    );
    record_transfer_success("update", file_size);

    log_file_audit(
        &state,
        auth.user_id,
        "file.update",
        file.id,
        device_label.as_deref(),
    )
    .await;

    Ok(Json(file))
}

pub async fn list_file_versions(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Vec<crate::db::files::FileVersionRecord>>, ApiError> {
    ensure_user_file_exists(&state, auth.user_id, file_id).await?;
    let versions = list_user_file_versions(&state.db_pool, auth.user_id, file_id)
        .await
        .map_err(|e| internal_error("list file versions", e))?;

    Ok(Json(versions))
}

pub async fn restore_file_version(
    State(state): State<AppState>,
    headers: HeaderMap,
    auth: AuthUser,
    Path((file_id, version_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<FileRecord>, ApiError> {
    let device_label = device_label_from_headers(&headers);
    let file = restore_user_file_version(
        &state.db_pool,
        auth.user_id,
        file_id,
        version_id,
        device_label.as_deref(),
    )
    .await
    .map_err(|e| internal_error("restore file version", e))?
    .ok_or_else(|| ApiError::BadRequest("File version not found".into()))?;

    log_file_audit(
        &state,
        auth.user_id,
        "file.version.restore",
        file_id,
        device_label.as_deref(),
    )
    .await;

    Ok(Json(file))
}

pub async fn list_file_activity(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Vec<crate::db::files::FileAuditRecord>>, ApiError> {
    ensure_user_file_exists(&state, auth.user_id, file_id).await?;
    let logs = list_user_file_audit_logs(&state.db_pool, auth.user_id, file_id)
        .await
        .map_err(|e| internal_error("list file activity", e))?;

    Ok(Json(logs))
}

pub async fn list_public_file_share_access(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Vec<crate::db::files::PublicFileShareAccessRecord>>, ApiError> {
    ensure_user_file_exists(&state, auth.user_id, file_id).await?;
    let events = list_public_file_share_access_events(&state.db_pool, auth.user_id, file_id)
        .await
        .map_err(|e| internal_error("list public share access", e))?;

    Ok(Json(events))
}

pub async fn share_file(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
    Json(payload): Json<ShareFileRequest>,
) -> Result<Json<FileRecord>, ApiError> {
    let share_token = payload.is_public.then(|| Uuid::new_v4().to_string());
    let share_starts_at = if payload.is_public {
        validate_share_starts_at(payload.starts_at)?
    } else {
        None
    };
    let share_expires_at = if payload.is_public {
        validate_share_expires_at(
            payload.expires_at,
            payload.expires_in_seconds,
            share_starts_at,
        )?
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
    let update_share_password = payload.password.is_some();
    let share_password_hash = if payload.is_public {
        validate_share_password(payload.password.as_deref())?
            .map(|password| hash(password, DEFAULT_COST))
            .transpose()
            .map_err(|e| internal_error("hash share password", e))?
    } else {
        None
    };
    let share_recipient_email = if payload.is_public {
        payload
            .recipient_email
            .as_deref()
            .map(str::trim)
            .filter(|email| !email.is_empty())
            .map(normalize_share_email)
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
        share_starts_at,
        share_expires_at,
        share_download_limit,
        payload.is_public && payload.one_time,
        update_share_password,
        share_password_hash,
        share_recipient_email,
    )
    .await
    .map_err(|e| internal_error("share file", e))?
    .ok_or_else(|| ApiError::BadRequest("File not found".into()))?;

    Ok(Json(file))
}

pub async fn expire_public_file_links(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
) -> Result<Json<FileRecord>, ApiError> {
    let file = expire_user_file_public_links(&state.db_pool, auth.user_id, file_id)
        .await
        .map_err(|e| internal_error("expire public file links", e))?
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

    if let Err(e) = create_and_publish_notification(
        &state,
        NewNotification {
            user_id: share.recipient_user_id,
            r#type: "share.file_created".into(),
            payload: serde_json::json!({
                "file_id": file_id,
                "owner_id": auth.user_id,
                "permission": share.permission,
                "created_at": Utc::now(),
            }),
        },
    )
    .await
    {
        tracing::warn!(error = %e, file_id = %file_id, recipient_user_id = %share.recipient_user_id, "failed to create file share notification");
    }

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

fn validate_share_starts_at(
    starts_at: Option<chrono::DateTime<Utc>>,
) -> Result<Option<chrono::DateTime<Utc>>, ApiError> {
    let Some(starts_at) = starts_at else {
        return Ok(None);
    };

    let now = Utc::now();
    if starts_at < now - Duration::minutes(5) {
        return Err(ApiError::BadRequest(
            "Activation date cannot be in the past".into(),
        ));
    }
    if starts_at > now + Duration::days(365) {
        return Err(ApiError::BadRequest(
            "Activation date must be within 365 days".into(),
        ));
    }

    Ok(Some(starts_at))
}

fn validate_share_expires_at(
    expires_at: Option<chrono::DateTime<Utc>>,
    expires_in_seconds: Option<i64>,
    starts_at: Option<chrono::DateTime<Utc>>,
) -> Result<Option<chrono::DateTime<Utc>>, ApiError> {
    let expiry = if let Some(expires_at) = expires_at {
        Some(expires_at)
    } else {
        expires_in_seconds
            .map(validate_share_duration)
            .transpose()?
            .map(|duration| Utc::now() + duration)
    };

    let Some(expires_at) = expiry else {
        return Ok(None);
    };
    let activation = starts_at.unwrap_or_else(Utc::now);
    if expires_at <= activation {
        return Err(ApiError::BadRequest(
            "Expiration date must be after activation date".into(),
        ));
    }
    if expires_at > activation + Duration::days(365) {
        return Err(ApiError::BadRequest(
            "Expiration date must be within 365 days of activation".into(),
        ));
    }

    Ok(Some(expires_at))
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

fn validate_share_password(value: Option<&str>) -> Result<Option<&str>, ApiError> {
    const MIN_SHARE_PASSWORD_LEN: usize = 8;
    const MAX_SHARE_PASSWORD_LEN: usize = 128;

    let Some(password) = value.map(str::trim).filter(|password| !password.is_empty()) else {
        return Ok(None);
    };
    if !(MIN_SHARE_PASSWORD_LEN..=MAX_SHARE_PASSWORD_LEN).contains(&password.len()) {
        return Err(ApiError::BadRequest(
            "Share password must be between 8 and 128 characters".into(),
        ));
    }

    Ok(Some(password))
}

fn validate_share_token(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    Uuid::parse_str(trimmed).map_err(|_| ApiError::BadRequest("Invalid share token".into()))?;
    Ok(trimmed.to_string())
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

pub async fn move_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
    Json(payload): Json<MoveFileRequest>,
) -> Result<Json<FileRecord>, ApiError> {
    let folder_id = parse_optional_uuid(payload.folder_id.as_deref(), "folder_id")?;
    if let Some(target_folder_id) = folder_id {
        let folder_exists = folder_belongs_to_user(&state.db_pool, auth.user_id, target_folder_id)
            .await
            .map_err(|e| internal_error("check move folder", e))?;
        if !folder_exists {
            return Err(ApiError::BadRequest("Destination folder not found".into()));
        }
    }

    let file = move_user_file(&state.db_pool, auth.user_id, file_id, folder_id)
        .await
        .map_err(|e| internal_error("move file", e))?
        .ok_or_else(|| ApiError::BadRequest("File not found".into()))?;

    log_file_audit(
        &state,
        auth.user_id,
        "file.move",
        file_id,
        device_label_from_headers(&headers).as_deref(),
    )
    .await;

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
    Extension(request_id): Extension<RequestId>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let file = get_user_file_for_download(&state.db_pool, auth.user_id, file_id)
        .await
        .map_err(|e| internal_error("get download file", e))?
        .ok_or_else(|| {
            record_transfer_error("download", "file_not_found");
            ApiError::BadRequest("File not found".into())
        })?;

    let download = fs::File::open(&file.storage_path).await.map_err(|e| {
        record_transfer_error("download", "open_failed");
        internal_error("open download file", e)
    })?;

    let mut headers = HeaderMap::new();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    if let Ok(value) = HeaderValue::from_str(&file.size_bytes.to_string()) {
        headers.insert(axum::http::header::CONTENT_LENGTH, value);
    }
    if let Some(checksum) = file.checksum.as_deref()
        && let Ok(value) = HeaderValue::from_str(checksum)
    {
        headers.insert("x-skysyncr-sha256", value);
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
    if let Some(mime_type) = file.mime_type.as_deref()
        && let Ok(value) = HeaderValue::from_str(mime_type)
    {
        headers.insert("x-skysyncr-mime-type", value);
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
        transfer_direction = "download",
        user_id = %auth.user_id,
        file_id = %file_id,
        bytes = file.size_bytes,
        "file_transfer"
    );
    record_transfer_success("download", file.size_bytes);

    Ok((headers, Body::from_stream(ReaderStream::new(download))).into_response())
}

pub async fn download_public_file(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
    Path(share_token): Path<String>,
    payload: Option<Json<PublicFileDownloadRequest>>,
) -> Result<Response, ApiError> {
    let share_token = validate_share_token(&share_token)?;
    let password = payload
        .as_ref()
        .and_then(|Json(payload)| payload.password.as_deref());
    let recipient_email = payload
        .as_ref()
        .and_then(|Json(payload)| payload.recipient_email.as_deref())
        .map(str::trim)
        .filter(|email| !email.is_empty())
        .map(normalize_share_email)
        .transpose()?;
    let file = consume_public_file_share_for_download(
        &state.db_pool,
        &share_token,
        password,
        recipient_email.as_deref(),
        headers
            .get(USER_AGENT)
            .and_then(|value| value.to_str().ok()),
    )
    .await
    .map_err(|e| internal_error("get public download file", e))?
    .ok_or_else(|| {
        record_transfer_error("public_download", "share_unavailable");
        ApiError::BadRequest(
            "This share link is invalid, expired, or requires valid access details".into(),
        )
    })?;

    let download = fs::File::open(&file.storage_path).await.map_err(|e| {
        record_transfer_error("public_download", "open_failed");
        internal_error("open public download file", e)
    })?;

    let mut headers = HeaderMap::new();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    if let Ok(value) = HeaderValue::from_str(&file.size_bytes.to_string()) {
        headers.insert(axum::http::header::CONTENT_LENGTH, value);
    }
    if let Some(checksum) = file.checksum.as_deref()
        && let Ok(value) = HeaderValue::from_str(checksum)
    {
        headers.insert("x-skysyncr-sha256", value);
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
    if let Some(mime_type) = file.mime_type.as_deref()
        && let Ok(value) = HeaderValue::from_str(mime_type)
    {
        headers.insert("x-skysyncr-mime-type", value);
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
        transfer_direction = "public_download",
        share_token = %share_token,
        bytes = file.size_bytes,
        "file_transfer"
    );
    record_transfer_success("public_download", file.size_bytes);

    Ok((headers, Body::from_stream(ReaderStream::new(download))).into_response())
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
    temp_path: &FsPath,
) -> Result<UpdateContentPayload, ApiError> {
    let mut file_info: Option<(u64, String)> = None;
    let mut encrypted_key: Option<Vec<u8>> = None;
    let mut encryption_nonce: Option<Vec<u8>> = None;
    let mut content_key_fingerprint: Option<String> = None;
    let mut share_keys: Option<Vec<FileShareKeyPayload>> = None;
    let mut base_updated_at: Option<chrono::DateTime<Utc>> = None;
    let mut force = false;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| ApiError::BadRequest("Invalid multipart body".into()))?
    {
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "file" => {
                file_info =
                    Some(write_multipart_file_field(field, temp_path, max_file_size_bytes).await?);
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
                if !is_valid_file_encryption_nonce(&decoded) {
                    return Err(ApiError::BadRequest("Invalid encryption_nonce".into()));
                }
                encryption_nonce = Some(decoded);
            }
            "content_key_fingerprint" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| ApiError::BadRequest("Invalid content_key_fingerprint".into()))?;
                content_key_fingerprint = Some(validate_content_key_fingerprint(&value)?);
            }
            "share_keys" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| ApiError::BadRequest("Invalid share_keys".into()))?;
                share_keys = Some(
                    serde_json::from_str(value.trim())
                        .map_err(|_| ApiError::BadRequest("Invalid share_keys".into()))?,
                );
            }
            "base_updated_at" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| ApiError::BadRequest("Invalid base_updated_at".into()))?;
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    base_updated_at = Some(
                        chrono::DateTime::parse_from_rfc3339(trimmed)
                            .map_err(|_| ApiError::BadRequest("Invalid base_updated_at".into()))?
                            .with_timezone(&Utc),
                    );
                }
            }
            "force" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| ApiError::BadRequest("Invalid force".into()))?;
                force = value.trim().eq_ignore_ascii_case("true") || value.trim() == "1";
            }
            _ => {}
        }
    }

    Ok(UpdateContentPayload {
        file_size: file_info
            .as_ref()
            .map(|(size, _)| *size)
            .ok_or_else(|| ApiError::BadRequest("Missing file".into()))?,
        checksum: file_info
            .map(|(_, checksum)| checksum)
            .ok_or_else(|| ApiError::BadRequest("Missing file".into()))?,
        encrypted_key: encrypted_key
            .ok_or_else(|| ApiError::BadRequest("Missing encrypted_key".into()))?,
        encryption_nonce: encryption_nonce
            .ok_or_else(|| ApiError::BadRequest("Missing encryption_nonce".into()))?,
        content_key_fingerprint: content_key_fingerprint
            .ok_or_else(|| ApiError::BadRequest("Missing content_key_fingerprint".into()))?,
        share_keys: share_keys.unwrap_or_default(),
        base_updated_at,
        force,
    })
}

async fn parse_upload_payload(
    mut multipart: Multipart,
    max_file_size_bytes: u64,
    temp_path: &FsPath,
) -> Result<UploadPayload, ApiError> {
    let mut filename: Option<String> = None;
    let mut mime_type: Option<String> = None;
    let mut file_info: Option<(u64, String)> = None;
    let mut encrypted_key: Option<Vec<u8>> = None;
    let mut encryption_nonce: Option<Vec<u8>> = None;
    let mut content_key_fingerprint: Option<String> = None;
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
                file_info =
                    Some(write_multipart_file_field(field, temp_path, max_file_size_bytes).await?);
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
                if !is_valid_file_encryption_nonce(&decoded) {
                    return Err(ApiError::BadRequest("Invalid encryption_nonce".into()));
                }
                encryption_nonce = Some(decoded);
            }
            "content_key_fingerprint" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| ApiError::BadRequest("Invalid content_key_fingerprint".into()))?;
                content_key_fingerprint = Some(validate_content_key_fingerprint(&value)?);
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
        file_size: file_info
            .as_ref()
            .map(|(size, _)| *size)
            .ok_or_else(|| ApiError::BadRequest("Missing file".into()))?,
        checksum: file_info
            .map(|(_, checksum)| checksum)
            .ok_or_else(|| ApiError::BadRequest("Missing file".into()))?,
        encrypted_key: encrypted_key
            .ok_or_else(|| ApiError::BadRequest("Missing encrypted_key".into()))?,
        encryption_nonce: encryption_nonce
            .ok_or_else(|| ApiError::BadRequest("Missing encryption_nonce".into()))?,
        content_key_fingerprint,
        folder_id,
    })
}

async fn write_multipart_file_field(
    mut field: axum::extract::multipart::Field<'_>,
    temp_path: &FsPath,
    max_file_size_bytes: u64,
) -> Result<(u64, String), ApiError> {
    let mut file = fs::File::create(temp_path)
        .await
        .map_err(|e| internal_error("create temporary upload file", e))?;
    let mut hasher = Sha256::new();
    let mut file_size = 0_u64;

    while let Some(chunk) = field
        .chunk()
        .await
        .map_err(|_| ApiError::BadRequest("Invalid uploaded file".into()))?
    {
        file_size = file_size
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| ApiError::BadRequest("File is too large".into()))?;
        if file_size > max_file_size_bytes {
            let _ = fs::remove_file(temp_path).await;
            return Err(ApiError::BadRequest("File is too large".into()));
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|e| internal_error("write uploaded file", e))?;
    }

    if file_size == 0 {
        let _ = fs::remove_file(temp_path).await;
        return Err(ApiError::BadRequest("File is empty".into()));
    }

    file.flush()
        .await
        .map_err(|e| internal_error("flush uploaded file", e))?;

    Ok((file_size, hex::encode(hasher.finalize())))
}

fn storage_path_for(upload_dir: &FsPath, user_id: Uuid, file_id: Uuid) -> PathBuf {
    upload_dir
        .join(user_id.to_string())
        .join(format!("{file_id}.bin"))
}

fn temp_storage_path_for(upload_dir: &FsPath, user_id: Uuid, file_id: Uuid) -> PathBuf {
    upload_dir
        .join(user_id.to_string())
        .join(format!("{file_id}.{}.tmp", Uuid::new_v4()))
}

fn resumable_temp_storage_path_for(upload_dir: &FsPath, user_id: Uuid, upload_id: Uuid) -> PathBuf {
    upload_dir
        .join(user_id.to_string())
        .join(format!("{upload_id}.upload.tmp"))
}

fn updated_storage_path_for(upload_dir: &FsPath, user_id: Uuid, file_id: Uuid) -> PathBuf {
    upload_dir
        .join(user_id.to_string())
        .join(format!("{file_id}.{}.bin", Uuid::new_v4()))
}

fn header_u64(headers: &HeaderMap, name: &str) -> Result<u64, ApiError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| ApiError::BadRequest(format!("Missing {name} header")))
}

async fn sha256_file(path: &FsPath) -> Result<String, ApiError> {
    let mut file = fs::File::open(path)
        .await
        .map_err(|e| internal_error("open uploaded file for checksum", e))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|e| internal_error("read uploaded file for checksum", e))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(hex::encode(hasher.finalize()))
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

fn validate_content_key_fingerprint(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    let is_sha256_hex = trimmed.len() == 64 && trimmed.bytes().all(|byte| byte.is_ascii_hexdigit());
    if !is_sha256_hex {
        return Err(ApiError::BadRequest(
            "Invalid content_key_fingerprint".into(),
        ));
    }

    Ok(trimmed.to_ascii_lowercase())
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

fn validate_page_limit(value: Option<i64>) -> Result<i64, ApiError> {
    const DEFAULT_LIMIT: i64 = 100;
    const MAX_LIMIT: i64 = 500;

    let limit = value.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(ApiError::BadRequest(format!(
            "limit must be between 1 and {MAX_LIMIT}"
        )));
    }
    Ok(limit)
}

fn normalize_search_query(value: Option<&str>) -> Result<Option<String>, ApiError> {
    const MAX_SEARCH_LEN: usize = 200;

    let Some(search) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if search.len() > MAX_SEARCH_LEN {
        return Err(ApiError::BadRequest("search is too large".into()));
    }
    Ok(Some(search.to_string()))
}

fn decode_file_cursor(value: &str) -> Result<FileListPageCursor, ApiError> {
    let decoded = general_purpose::URL_SAFE_NO_PAD
        .decode(value.trim())
        .map_err(|_| ApiError::BadRequest("Invalid cursor".into()))?;
    let token: FileCursorToken = serde_json::from_slice(&decoded)
        .map_err(|_| ApiError::BadRequest("Invalid cursor".into()))?;
    Ok(FileListPageCursor {
        updated_at: token.updated_at,
        id: token.id,
    })
}

fn encode_file_cursor(file: &FileRecord) -> Result<String, ApiError> {
    let token = FileCursorToken {
        updated_at: file.updated_at,
        id: file.id,
    };
    let serialized =
        serde_json::to_vec(&token).map_err(|e| internal_error("encode file cursor", e))?;
    Ok(general_purpose::URL_SAFE_NO_PAD.encode(serialized))
}

fn is_valid_file_encryption_nonce(value: &[u8]) -> bool {
    value.len() == 12 || value == b"skysyncr-file:v2"
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

fn device_label_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get(HeaderName::from_static(DEVICE_LABEL_HEADER))
        .or_else(|| headers.get(USER_AGENT))
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(256).collect())
}

async fn log_file_audit(
    state: &AppState,
    user_id: Uuid,
    action: &str,
    file_id: Uuid,
    device_label: Option<&str>,
) {
    if let Err(err) = insert_file_audit_log(
        &state.db_pool,
        &state.config.audit_log_encryption_key,
        user_id,
        action,
        file_id,
        device_label,
    )
    .await
    {
        tracing::warn!(
            error = %err,
            user_id = %user_id,
            file_id = %file_id,
            action,
            "failed to write file audit log"
        );
        return;
    }

    if matches!(action, "file.delete" | "file.rename" | "file.update") {
        match detect_and_alert_after_file_mutation(&state.db_pool, user_id, device_label).await {
            Ok(Some(notification)) => state
                .notification_broadcaster
                .publish(user_id, notification),
            Ok(None) => {}
            Err(err) => {
                tracing::warn!(
                    error = %err,
                    user_id = %user_id,
                    file_id = %file_id,
                    action,
                    "failed to evaluate ransomware activity"
                );
            }
        }
    }
}

async fn notify_upload_completed(state: &AppState, user_id: Uuid, file: &FileRecord) {
    if let Err(err) = create_and_publish_notification(
        state,
        NewNotification {
            user_id,
            r#type: "transfer.upload_completed".into(),
            payload: serde_json::json!({
                "file_id": file.id,
                "filename": file.filename,
                "size_bytes": file.size_bytes,
                "created_at": Utc::now(),
            }),
        },
    )
    .await
    {
        tracing::warn!(
            error = %err,
            user_id = %user_id,
            file_id = %file.id,
            "failed to create upload completion notification"
        );
    }
}
