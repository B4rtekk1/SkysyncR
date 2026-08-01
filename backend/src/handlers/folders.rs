use axum::{
    Json,
    body::Body,
    extract::{Extension, Path, Query, State},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CONTENT_DISPOSITION, CONTENT_TYPE, USER_AGENT},
    },
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose};
use bcrypt::{DEFAULT_COST, hash};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::db::files::FileRecord;
use crate::db::folders::{
    FolderGroupShareEventRecord, FolderGroupShareRecord, FolderListPageCursor,
    FolderListPageOptions, FolderPointRestoreResult, FolderRecord, FolderShareRecipientRecord,
    FolderShareRecord, NewFolderGroupShare, NewFolderRecord, NewFolderShare,
    add_user_folder_favourite, create_folder_record, delete_user_folder_group_share,
    delete_user_folder_share, folder_belongs_to_user, folder_is_descendant_of,
    get_folder_share_recipient, get_public_folder_file_for_download, get_public_folder_tree,
    insert_folder_group_audit_log, list_public_folder_share_access_events,
    list_public_folder_tree_files, list_user_favourite_folders, list_user_favourite_folders_page,
    list_user_folder_group_share_events, list_user_folder_group_shares, list_user_folder_shares,
    list_user_folders, list_user_folders_page, move_user_folder,
    public_folder_share_access_allowed, remove_user_folder_favourite, rename_user_folder,
    restore_user_folder, restore_user_folder_to_point, soft_delete_user_folder,
    update_user_folder_share, upsert_user_folder_group_share, upsert_user_folder_share,
    user_folder_exists,
};
use crate::db::notifications::NewNotification;
use crate::observability::RequestId;
use crate::security::{ReauthenticationRequest, verify_reauthentication};
use crate::services::notifications::create_and_publish_notification;
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
    pub limit: Option<i64>,
    pub cursor: Option<String>,
    pub search: Option<String>,
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
    pub starts_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub expires_in_seconds: Option<i64>,
    pub download_limit: Option<i32>,
    #[serde(default)]
    pub one_time: bool,
    pub password: Option<String>,
    pub recipient_email: Option<String>,
}

#[derive(Deserialize)]
pub struct PublicFolderAccessRequest {
    pub password: Option<String>,
    pub recipient_email: Option<String>,
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
pub struct FolderGroupShareRequest {
    pub group_id: Uuid,
    pub permission: String,
}

#[derive(Deserialize)]
pub struct FolderGroupShareUpdateRequest {
    pub permission: String,
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

#[derive(Deserialize)]
pub struct RestoreFolderPointRequest {
    pub restore_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct PublicFolderManifest {
    pub root: FolderRecord,
    pub folders: Vec<FolderRecord>,
    pub files: Vec<FileRecord>,
}

#[derive(Serialize)]
pub struct FolderListPage {
    pub items: Vec<FolderRecord>,
    pub next_cursor: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct FolderCursorToken {
    name: String,
    id: Uuid,
}

pub async fn list_folders(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListFoldersQuery>,
) -> Result<Response, ApiError> {
    if query.limit.is_some() || query.cursor.is_some() || query.search.is_some() {
        let limit = validate_page_limit(query.limit)?;
        let cursor = query
            .cursor
            .as_deref()
            .map(decode_folder_cursor)
            .transpose()?;
        let search = normalize_search_query(query.search.as_deref())?;
        let options = FolderListPageOptions {
            limit,
            cursor,
            search,
        };
        let (items, has_more) = if query.favourite {
            list_user_favourite_folders_page(&state.db_pool, auth.user_id, options)
                .await
                .map_err(|e| internal_error("list favourite folders page", e))?
        } else {
            let parent_folder_id =
                parse_optional_uuid(query.parent_folder_id.as_deref(), "parent_folder_id")?;
            list_user_folders_page(
                &state.db_pool,
                auth.user_id,
                parent_folder_id,
                query.trashed,
                options,
            )
            .await
            .map_err(|e| internal_error("list folders page", e))?
        };
        let next_cursor = has_more
            .then(|| items.last())
            .flatten()
            .map(encode_folder_cursor)
            .transpose()?;
        return Ok(Json(FolderListPage { items, next_cursor }).into_response());
    }

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

    Ok(Json(folders).into_response())
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
            .map_err(|e| internal_error("hash folder share password", e))?
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
    let folder = update_user_folder_share(
        &state.db_pool,
        auth.user_id,
        folder_id,
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
    .map_err(|e| internal_error("share folder", e))?
    .ok_or_else(|| ApiError::BadRequest("Folder not found".into()))?;

    Ok(Json(folder))
}

pub async fn get_public_folder_manifest(
    State(state): State<AppState>,
    Path(share_token): Path<String>,
    payload: Option<Json<PublicFolderAccessRequest>>,
) -> Result<Json<PublicFolderManifest>, ApiError> {
    let share_token = validate_share_token(&share_token)?;
    let (password, recipient_email) = public_folder_access_details(payload.as_ref())?;
    let allowed = public_folder_share_access_allowed(
        &state.db_pool,
        &share_token,
        password,
        recipient_email.as_deref(),
    )
    .await
    .map_err(|e| internal_error("check public folder access", e))?;
    if !allowed {
        return Err(ApiError::BadRequest(
            "This share link is invalid, expired, or requires valid access details".into(),
        ));
    }
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
    headers: HeaderMap,
    Path((share_token, file_id)): Path<(String, Uuid)>,
    payload: Option<Json<PublicFolderAccessRequest>>,
) -> Result<Response, ApiError> {
    let share_token = validate_share_token(&share_token)?;
    let (password, recipient_email) = public_folder_access_details(payload.as_ref())?;
    let file = get_public_folder_file_for_download(
        &state.db_pool,
        &share_token,
        file_id,
        password,
        recipient_email.as_deref(),
        headers
            .get(USER_AGENT)
            .and_then(|value| value.to_str().ok()),
    )
    .await
    .map_err(|e| internal_error("get public folder download file", e))?
    .ok_or_else(|| {
        ApiError::BadRequest(
            "File not found in this shared folder or requires valid access details".into(),
        )
    })?;

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
        transfer_direction = "public_folder_download",
        share_token = %share_token,
        file_id = %file_id,
        bytes = file.size_bytes,
        "file_transfer"
    );

    Ok((headers, Body::from_stream(ReaderStream::new(download))).into_response())
}

pub async fn list_public_folder_share_access(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
) -> Result<Json<Vec<crate::db::folders::PublicFolderShareAccessRecord>>, ApiError> {
    ensure_user_folder_exists(&state, auth.user_id, folder_id).await?;
    let events = list_public_folder_share_access_events(&state.db_pool, auth.user_id, folder_id)
        .await
        .map_err(|e| internal_error("list public folder share access", e))?;

    Ok(Json(events))
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

    if let Err(e) = create_and_publish_notification(
        &state,
        NewNotification {
            user_id: share.recipient_user_id,
            r#type: "share.folder_created".into(),
            payload: serde_json::json!({
                "folder_id": folder_id,
                "owner_id": auth.user_id,
                "permission": share.permission,
                "created_at": Utc::now(),
            }),
        },
    )
    .await
    {
        tracing::warn!(error = %e, folder_id = %folder_id, recipient_user_id = %share.recipient_user_id, "failed to create folder share notification");
    }

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

pub async fn list_folder_group_shares(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
) -> Result<Json<Vec<FolderGroupShareRecord>>, ApiError> {
    ensure_user_folder_exists(&state, auth.user_id, folder_id).await?;
    let shares = list_user_folder_group_shares(&state.db_pool, auth.user_id, folder_id)
        .await
        .map_err(|e| internal_error("list folder group shares", e))?;

    Ok(Json(shares))
}

pub async fn create_folder_group_share(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
    Json(payload): Json<FolderGroupShareRequest>,
) -> Result<(StatusCode, Json<FolderGroupShareRecord>), ApiError> {
    let permission = validate_folder_group_permission(&payload.permission)?;
    let share = upsert_user_folder_group_share(
        &state.db_pool,
        NewFolderGroupShare {
            owner_id: auth.user_id,
            folder_id,
            group_id: payload.group_id,
            permission,
            actor_user_id: auth.user_id,
        },
    )
    .await
    .map_err(|e| internal_error("create folder group share", e))?
    .ok_or_else(|| ApiError::BadRequest("Folder or group not found".into()))?;

    log_folder_group_audit(
        &state,
        auth.user_id,
        "folder.group_share.grant",
        folder_id,
        share.group_id,
        Some(&share.permission),
    )
    .await;

    Ok((StatusCode::CREATED, Json(share)))
}

pub async fn update_folder_group_share(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((folder_id, group_share_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<FolderGroupShareUpdateRequest>,
) -> Result<Json<FolderGroupShareRecord>, ApiError> {
    let permission = validate_folder_group_permission(&payload.permission)?;
    let current = list_user_folder_group_shares(&state.db_pool, auth.user_id, folder_id)
        .await
        .map_err(|e| internal_error("load folder group shares", e))?
        .into_iter()
        .find(|share| share.id == group_share_id)
        .ok_or_else(|| ApiError::BadRequest("Folder group share not found".into()))?;

    let share = upsert_user_folder_group_share(
        &state.db_pool,
        NewFolderGroupShare {
            owner_id: auth.user_id,
            folder_id,
            group_id: current.group_id,
            permission,
            actor_user_id: auth.user_id,
        },
    )
    .await
    .map_err(|e| internal_error("update folder group share", e))?
    .ok_or_else(|| ApiError::BadRequest("Folder group share not found".into()))?;

    log_folder_group_audit(
        &state,
        auth.user_id,
        "folder.group_share.update",
        folder_id,
        share.group_id,
        Some(&share.permission),
    )
    .await;

    Ok(Json(share))
}

pub async fn delete_folder_group_share(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((folder_id, group_share_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let current = list_user_folder_group_shares(&state.db_pool, auth.user_id, folder_id)
        .await
        .map_err(|e| internal_error("load folder group share", e))?
        .into_iter()
        .find(|share| share.id == group_share_id)
        .ok_or_else(|| ApiError::BadRequest("Folder group share not found".into()))?;

    let rows = delete_user_folder_group_share(
        &state.db_pool,
        auth.user_id,
        folder_id,
        group_share_id,
        auth.user_id,
    )
    .await
    .map_err(|e| internal_error("delete folder group share", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("Folder group share not found".into()));
    }

    log_folder_group_audit(
        &state,
        auth.user_id,
        "folder.group_share.revoke",
        folder_id,
        current.group_id,
        Some(&current.permission),
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_folder_group_share_events(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
) -> Result<Json<Vec<FolderGroupShareEventRecord>>, ApiError> {
    ensure_user_folder_exists(&state, auth.user_id, folder_id).await?;
    let events = list_user_folder_group_share_events(&state.db_pool, auth.user_id, folder_id)
        .await
        .map_err(|e| internal_error("list folder group share events", e))?;

    Ok(Json(events))
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

pub async fn restore_folder_point(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
    Json(payload): Json<RestoreFolderPointRequest>,
) -> Result<Json<FolderPointRestoreResult>, ApiError> {
    if payload.restore_at > Utc::now() {
        return Err(ApiError::BadRequest(
            "restore_at cannot be in the future".into(),
        ));
    }

    let result =
        restore_user_folder_to_point(&state.db_pool, auth.user_id, folder_id, payload.restore_at)
            .await
            .map_err(|e| internal_error("restore folder point", e))?
            .ok_or_else(|| {
                ApiError::BadRequest(
                    "Folder restore point not found or storage quota exceeded".into(),
                )
            })?;

    Ok(Json(result))
}

pub async fn permanent_delete_folder(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(folder_id): Path<Uuid>,
    Json(reauth): Json<ReauthenticationRequest>,
) -> Result<StatusCode, ApiError> {
    verify_reauthentication(&state, auth.user_id, &reauth).await?;

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

fn public_folder_access_details<'a>(
    payload: Option<&'a Json<PublicFolderAccessRequest>>,
) -> Result<(Option<&'a str>, Option<String>), ApiError> {
    let password = payload.and_then(|Json(payload)| payload.password.as_deref());
    let recipient_email = payload
        .and_then(|Json(payload)| payload.recipient_email.as_deref())
        .map(str::trim)
        .filter(|email| !email.is_empty())
        .map(normalize_share_email)
        .transpose()?;

    Ok((password, recipient_email))
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

fn decode_folder_cursor(value: &str) -> Result<FolderListPageCursor, ApiError> {
    let decoded = general_purpose::URL_SAFE_NO_PAD
        .decode(value.trim())
        .map_err(|_| ApiError::BadRequest("Invalid cursor".into()))?;
    let token: FolderCursorToken = serde_json::from_slice(&decoded)
        .map_err(|_| ApiError::BadRequest("Invalid cursor".into()))?;
    Ok(FolderListPageCursor {
        name: token.name,
        id: token.id,
    })
}

fn encode_folder_cursor(folder: &FolderRecord) -> Result<String, ApiError> {
    let token = FolderCursorToken {
        name: folder.name.clone(),
        id: folder.id,
    };
    let serialized =
        serde_json::to_vec(&token).map_err(|e| internal_error("encode folder cursor", e))?;
    Ok(general_purpose::URL_SAFE_NO_PAD.encode(serialized))
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

fn validate_share_starts_at(
    starts_at: Option<DateTime<Utc>>,
) -> Result<Option<DateTime<Utc>>, ApiError> {
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
    expires_at: Option<DateTime<Utc>>,
    expires_in_seconds: Option<i64>,
    starts_at: Option<DateTime<Utc>>,
) -> Result<Option<DateTime<Utc>>, ApiError> {
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

fn validate_folder_group_permission(value: &str) -> Result<String, ApiError> {
    match value.trim() {
        "read" | "edit" | "manage" => Ok(value.trim().to_string()),
        _ => Err(ApiError::BadRequest(
            "Invalid folder group permission".into(),
        )),
    }
}

async fn log_folder_group_audit(
    state: &AppState,
    user_id: Uuid,
    operation: &str,
    folder_id: Uuid,
    group_id: Uuid,
    permission: Option<&str>,
) {
    if let Err(e) = insert_folder_group_audit_log(
        &state.db_pool,
        &state.config.audit_log_encryption_key,
        user_id,
        operation,
        folder_id,
        group_id,
        permission,
    )
    .await
    {
        tracing::warn!(error = %e, operation, folder_id = %folder_id, group_id = %group_id, "failed to write folder group audit log");
    }
}
