use crate::auth::AuthUser;
use crate::crypto::jwt::generate_access_token_capped;
use crate::crypto::refresh_token::generate_refresh_token;
use crate::crypto::totp::{
    decrypt_secret, encrypt_secret, generate_secret, otpauth_url, secret_base32, verify_code,
};
use crate::db::audit_logs::{NewAuditLog, insert_user_audit_log, list_user_operation_logs};
use crate::db::notifications::NewNotification;
use crate::db::refresh_tokens::{
    RefreshTokenAuth, RefreshTokenMetadata, ValidRefreshToken, authenticate_refresh_token,
    create_refresh_token, insert_refresh_token_activity, list_active_user_sessions,
    list_user_session_activity, revoke_all_user_refresh_tokens, revoke_refresh_token,
    revoke_user_device_refresh_tokens, revoke_user_session, rotate_recent_refresh_token_reuse,
    rotate_refresh_token, update_active_device_label, update_user_session_trust,
};
use crate::db::totp::{
    consume_login_challenge, create_login_challenge, delete_totp, enable_totp, get_login_challenge,
    get_user_totp, record_login_challenge_failure, save_pending_totp, update_last_used_counter,
};
use crate::db::users::*;
use crate::models::users::{
    ChangePasswordRequest, CurrentUserResponse, LoginRequest, LoginResponse, LoginResult,
    LoginTotpRequest, RefreshResponse, RegisterRequest, RegisterResponse, TotpCodeRequest,
    TotpSetupResponse, TotpStatusResponse, UpdateUserSettingsRequest, UserSettingsResponse,
};
use crate::services::notifications::create_and_publish_notification;
use crate::state::AppState;
use crate::utils::errors::{ApiError, internal_error, map_db_error};
use crate::utils::validation::{
    validate_display_name, validate_email, validate_password, validate_public_key,
};
use axum::{
    Json,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, HeaderName, HeaderValue, header},
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose};
use bcrypt::{DEFAULT_COST, hash, verify};
use chrono::Utc;
use serde::Deserialize;
use serde::Serialize;
use sqlx::Row;
use std::path::{Path as FsPath, PathBuf};
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::crypto::email::send_verification_email;

#[derive(Deserialize)]
pub struct VerifyParams {
    pub token: String,
}

#[derive(Deserialize)]
pub struct ResendVerificationRequest {
    pub email: String,
}

const REFRESH_TOKEN_COOKIE: &str = "skysyncr_refresh_token";
const REFRESH_PERSISTENCE_COOKIE: &str = "skysyncr_refresh_persistent";
const REFRESH_COOKIE_PATH: &str = "/";
const INVALID_LOGIN_MESSAGE: &str = "Invalid email or password";
const SESSION_ACTIVITY_LIMIT: i64 = 30;
const DEVICE_ID_HEADER: &str = "x-skysyncr-device-id";
const DEVICE_LABEL_HEADER: &str = "x-skysyncr-device-label";

#[derive(Serialize)]
pub struct SessionsResponse {
    pub sessions: Vec<crate::db::refresh_tokens::UserSession>,
    pub activity: Vec<crate::db::refresh_tokens::UserSessionActivity>,
}

#[derive(Serialize)]
pub struct OperationLogResponse {
    pub operations: Vec<crate::db::audit_logs::OperationLogRecord>,
}

struct ExportFilePayload {
    id: Uuid,
    filename: String,
    storage_path: String,
}

struct TarEntry {
    path: String,
    size: u64,
    source: TarEntrySource,
}

enum TarEntrySource {
    Bytes(Vec<u8>),
    File(PathBuf),
}

const EXPORT_FORMAT_VERSION: u32 = 1;
const EXPORT_RECOVERY_INSTRUCTIONS: &str = r#"SkysyncR user data export recovery instructions

This archive contains your server-side data export. Files in encrypted-files/ are the original encrypted blobs stored by SkysyncR; the server cannot decrypt them.

To recover data:
1. Open manifest.json and find the file entry by id or filename.
2. Use that entry's encrypted_key and encryption_nonce values. They are base64-encoded.
3. Unlock your private key using your SkysyncR password or account recovery flow.
4. Unwrap the file key locally with your private key, then decrypt the encrypted blob from encrypted-files/.
5. For files or folders shared with other users, shares.*.encrypted_key contains that recipient's wrapped key and can only be unwrapped by that recipient's private key.

The manifest also includes public share settings, private file and folder share recipients, folder hierarchy metadata, and the encrypted private-key recovery blob when one exists.
"#;

#[derive(Deserialize)]
pub struct UpdateSessionTrustRequest {
    pub trusted: bool,
}

async fn log_user_operation(
    state: &AppState,
    user_id: Uuid,
    operation: &str,
    device_label: Option<&str>,
    details: serde_json::Value,
) {
    if let Err(e) = insert_user_audit_log(
        &state.db_pool,
        &state.config.audit_log_encryption_key,
        NewAuditLog {
            user_id,
            action: operation,
            resource_id: None,
            resource_type: Some("account"),
            device_label,
            details,
        },
    )
    .await
    {
        tracing::warn!(error = %e, operation, "failed to write user operation log");
    }
}

async fn notify_new_login(
    state: &AppState,
    user_id: Uuid,
    session_id: Uuid,
    device_label: Option<&str>,
    ip_address: Option<&str>,
) {
    if let Err(e) = create_and_publish_notification(
        state,
        NewNotification {
            user_id,
            r#type: "security.new_login".into(),
            payload: serde_json::json!({
                "session_id": session_id,
                "device_label": device_label,
                "ip_address": ip_address,
                "created_at": Utc::now(),
            }),
        },
    )
    .await
    {
        tracing::warn!(error = %e, user_id = %user_id, "failed to create new login notification");
    }
}

fn refresh_token_cookie(
    token: &str,
    session_expires_at: chrono::DateTime<Utc>,
    is_dev: bool,
    persistent: bool,
) -> Result<HeaderValue, ApiError> {
    let max_age = (session_expires_at - Utc::now()).num_seconds().max(0);
    let max_age_attr = if persistent {
        format!("; Max-Age={max_age}")
    } else {
        String::new()
    };
    let secure = if is_dev { "" } else { "; Secure" };
    HeaderValue::from_str(&format!(
        "{REFRESH_TOKEN_COOKIE}={token}{max_age_attr}; Path={REFRESH_COOKIE_PATH}; HttpOnly; SameSite=Lax{secure}"
    ))
    .map_err(|e| internal_error("build refresh cookie", e))
}

fn refresh_persistence_cookie(is_dev: bool, persistent: bool) -> Result<HeaderValue, ApiError> {
    let secure = if is_dev { "" } else { "; Secure" };
    let max_age = if persistent {
        "; Max-Age=7776000"
    } else {
        "; Max-Age=0"
    };

    HeaderValue::from_str(&format!(
        "{REFRESH_PERSISTENCE_COOKIE}=1{max_age}; Path={REFRESH_COOKIE_PATH}; HttpOnly; SameSite=Lax{secure}"
    ))
    .map_err(|e| internal_error("build refresh cookie", e))
}

fn clear_cookie(name: &str, is_dev: bool) -> HeaderValue {
    let secure = if is_dev { "" } else { "; Secure" };
    HeaderValue::from_str(&format!(
        "{name}=; Max-Age=0; Path={REFRESH_COOKIE_PATH}; HttpOnly; SameSite=Lax{secure}"
    ))
    .expect("static clear cookie is valid")
}

fn refresh_token_from_cookie(headers: &HeaderMap) -> Result<String, ApiError> {
    for value in headers.get_all(header::COOKIE) {
        let Ok(raw) = value.to_str() else {
            continue;
        };

        for cookie in raw.split(';') {
            let cookie = cookie.trim();
            if let Some(token) = cookie.strip_prefix(&format!("{REFRESH_TOKEN_COOKIE}=")) {
                if token.is_empty() || token.len() > 128 {
                    return Err(ApiError::BadRequest("Invalid refresh token".into()));
                }
                return Ok(token.to_string());
            }
        }
    }

    Err(ApiError::Unauthorized("Missing refresh token".into()))
}

fn has_cookie(headers: &HeaderMap, name: &str) -> bool {
    let prefix = format!("{name}=");

    headers.get_all(header::COOKIE).iter().any(|value| {
        value.to_str().is_ok_and(|raw| {
            raw.split(';')
                .map(str::trim)
                .any(|cookie| cookie.starts_with(&prefix))
        })
    })
}

fn header_string(headers: &HeaderMap, name: HeaderName, max_len: usize) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(max_len).collect())
}

fn request_ip(headers: &HeaderMap) -> Option<String> {
    header_string(headers, HeaderName::from_static("x-forwarded-for"), 128)
        .and_then(|value| value.split(',').next().map(str::trim).map(str::to_string))
        .filter(|value| !value.is_empty())
        .or_else(|| header_string(headers, HeaderName::from_static("x-real-ip"), 128))
}

fn browser_name(user_agent: &str) -> &'static str {
    if user_agent.contains("Edg/") {
        "Microsoft Edge"
    } else if user_agent.contains("OPR/") || user_agent.contains("Opera/") {
        "Opera"
    } else if user_agent.contains("Firefox/") {
        "Firefox"
    } else if user_agent.contains("Chrome/") || user_agent.contains("CriOS/") {
        "Chrome"
    } else if user_agent.contains("Safari/") {
        "Safari"
    } else {
        "Browser"
    }
}

fn platform_name(user_agent: &str) -> &'static str {
    if user_agent.contains("Windows") {
        "Windows"
    } else if user_agent.contains("iPhone") {
        "iPhone"
    } else if user_agent.contains("iPad") {
        "iPad"
    } else if user_agent.contains("Android") {
        "Android"
    } else if user_agent.contains("Mac OS X") || user_agent.contains("Macintosh") {
        "macOS"
    } else if user_agent.contains("Linux") {
        "Linux"
    } else {
        "Unknown device"
    }
}

fn device_label_from_headers(headers: &HeaderMap) -> Option<String> {
    if let Some(label) = header_string(headers, HeaderName::from_static(DEVICE_LABEL_HEADER), 80) {
        return Some(label);
    }

    let user_agent = header_string(headers, header::USER_AGENT, 512)?;
    let browser = browser_name(&user_agent);
    let platform = platform_name(&user_agent);

    if platform == "Unknown device" && browser == "Browser" {
        Some("Unknown browser".into())
    } else {
        Some(format!("{browser} on {platform}"))
    }
}

fn request_metadata_values(
    headers: &HeaderMap,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    (
        header_string(headers, HeaderName::from_static(DEVICE_ID_HEADER), 128),
        device_label_from_headers(headers),
        header_string(headers, header::USER_AGENT, 512),
        request_ip(headers),
    )
}

fn owned_refresh_metadata<'a>(
    device_id: &'a Option<String>,
    device_label: &'a Option<String>,
    user_agent: &'a Option<String>,
    ip_address: &'a Option<String>,
) -> RefreshTokenMetadata<'a> {
    RefreshTokenMetadata {
        device_id: device_id.as_deref(),
        device_label: device_label.as_deref(),
        user_agent: user_agent.as_deref(),
        ip_address: ip_address.as_deref(),
    }
}

async fn current_refresh_session_id(
    state: &AppState,
    headers: &HeaderMap,
    expected_user_id: Uuid,
) -> Result<Option<Uuid>, ApiError> {
    let Ok(refresh_token) = refresh_token_from_cookie(headers) else {
        return Ok(None);
    };

    match authenticate_refresh_token(&state.db_pool, &refresh_token)
        .await
        .map_err(|e| internal_error("authenticate current session token", e))?
    {
        RefreshTokenAuth::Valid(token) if token.user_id == expected_user_id => {
            Ok(Some(token.session_id))
        }
        RefreshTokenAuth::ReuseDetected { user_id } => {
            revoke_all_user_refresh_tokens(&state.db_pool, user_id)
                .await
                .map_err(|e| internal_error("revoke sessions after token anomaly", e))?;
            Err(ApiError::Unauthorized("Session invalid".into()))
        }
        _ => Ok(None),
    }
}

pub async fn current_user(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<CurrentUserResponse>, ApiError> {
    let profile = get_current_user_crypto_profile(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("get current user", e))?
        .ok_or_else(|| ApiError::Unauthorized("User not found".into()))?;

    Ok(Json(CurrentUserResponse {
        id: profile.id,
        email: profile.email,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        public_key: profile.public_key,
        default_view: profile.default_view,
        layout_mode: profile.layout_mode,
        upload_protection: profile.upload_protection,
        compact_metadata: profile.compact_metadata,
        device_lock: profile.device_lock,
        sync_on_metered: profile.sync_on_metered,
        trash_retention_days: profile.trash_retention_days,
    }))
}

pub async fn export_user_data(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Response, ApiError> {
    let export_id = Uuid::new_v4();
    let (manifest, files) = build_user_export_manifest(&state, auth.user_id, export_id).await?;
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| internal_error("serialize user export manifest", e))?;

    let export_filename = format!("skysyncr-export-{}-{export_id}.tar", auth.user_id);
    let export_path = user_export_path(&state.config.upload_dir, auth.user_id, export_id);
    if let Some(parent) = export_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| internal_error("create user export directory", e))?;
    }

    let mut entries = Vec::with_capacity(files.len() + 2);
    entries.push(TarEntry {
        path: "manifest.json".into(),
        size: manifest_bytes.len() as u64,
        source: TarEntrySource::Bytes(manifest_bytes),
    });
    entries.push(TarEntry {
        path: "recovery-instructions.txt".into(),
        size: EXPORT_RECOVERY_INSTRUCTIONS.len() as u64,
        source: TarEntrySource::Bytes(EXPORT_RECOVERY_INSTRUCTIONS.as_bytes().to_vec()),
    });
    for file in files {
        let source_path = PathBuf::from(&file.storage_path);
        let size = fs::metadata(&source_path)
            .await
            .map_err(|e| internal_error("read export file metadata", e))?
            .len();
        entries.push(TarEntry {
            path: format!(
                "encrypted-files/{}-{}",
                file.id,
                sanitize_export_path_component(&file.filename)
            ),
            size,
            source: TarEntrySource::File(source_path),
        });
    }

    write_tar_archive(&export_path, entries).await?;
    let archive_size = fs::metadata(&export_path)
        .await
        .map_err(|e| internal_error("read user export archive metadata", e))?
        .len();
    let archive = fs::File::open(&export_path)
        .await
        .map_err(|e| internal_error("open user export archive", e))?;

    log_user_operation(
        &state,
        auth.user_id,
        "user.data_export.download",
        None,
        serde_json::json!({ "export_id": export_id, "archive_size_bytes": archive_size }),
    )
    .await;

    let cleanup_path = export_path.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30 * 60)).await;
        let _ = fs::remove_file(cleanup_path).await;
    });

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/x-tar"),
    );
    if let Ok(value) = HeaderValue::from_str(&archive_size.to_string()) {
        headers.insert(header::CONTENT_LENGTH, value);
    }
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{export_filename}\""))
            .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
    );

    Ok((headers, Body::from_stream(ReaderStream::new(archive))).into_response())
}

pub async fn update_user_settings(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<UpdateUserSettingsRequest>,
) -> Result<Json<UserSettingsResponse>, ApiError> {
    let display_name = payload
        .display_name
        .as_deref()
        .map(validate_optional_display_name)
        .transpose()?
        .flatten();
    let avatar_url = payload
        .avatar_url
        .as_deref()
        .map(validate_avatar_url)
        .transpose()?
        .flatten();
    let default_view = payload
        .default_view
        .as_deref()
        .map(validate_default_view)
        .transpose()?
        .flatten();
    let layout_mode = payload
        .layout_mode
        .as_deref()
        .map(validate_layout_mode)
        .transpose()?
        .flatten();

    if let Some(trash_retention_days) = payload.trash_retention_days
        && !(1..=365).contains(&trash_retention_days)
    {
        return Err(ApiError::BadRequest(
            "Trash retention must be between 1 and 365 days".into(),
        ));
    }

    let settings = update_user_settings_record(
        &state.db_pool,
        auth.user_id,
        UserSettingsUpdate {
            display_name,
            avatar_url,
            default_view,
            layout_mode,
            upload_protection: payload.upload_protection,
            compact_metadata: payload.compact_metadata,
            device_lock: payload.device_lock,
            sync_on_metered: payload.sync_on_metered,
            trash_retention_days: payload.trash_retention_days,
        },
    )
    .await
    .map_err(|e| internal_error("update user settings", e))?
    .ok_or_else(|| ApiError::Unauthorized("User not found".into()))?;

    log_user_operation(
        &state,
        auth.user_id,
        "user.settings.update",
        None,
        serde_json::json!({
            "changed": {
                "display_name": payload.display_name.is_some(),
                "avatar_url": payload.avatar_url.is_some(),
                "default_view": payload.default_view.is_some(),
                "layout_mode": payload.layout_mode.is_some(),
                "upload_protection": payload.upload_protection.is_some(),
                "compact_metadata": payload.compact_metadata.is_some(),
                "device_lock": payload.device_lock.is_some(),
                "sync_on_metered": payload.sync_on_metered.is_some(),
                "trash_retention_days": payload.trash_retention_days.is_some(),
            }
        }),
    )
    .await;

    Ok(Json(UserSettingsResponse {
        display_name: settings.display_name,
        avatar_url: settings.avatar_url,
        default_view: settings.default_view,
        layout_mode: settings.layout_mode,
        upload_protection: settings.upload_protection,
        compact_metadata: settings.compact_metadata,
        device_lock: settings.device_lock,
        sync_on_metered: settings.sync_on_metered,
        trash_retention_days: settings.trash_retention_days,
    }))
}

pub async fn change_password(
    headers: HeaderMap,
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<ChangePasswordRequest>,
) -> Result<Response, ApiError> {
    if payload.current_password.len() > 128 {
        return Err(ApiError::BadRequest("Current password is too long".into()));
    }
    validate_password(&payload.new_password).map_err(|msg| ApiError::BadRequest(msg.into()))?;

    let password_hash = get_password_hash_by_id(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("get password hash", e))?
        .ok_or_else(|| ApiError::Unauthorized("User not found".into()))?;

    if !verify(&payload.current_password, &password_hash).unwrap_or(false) {
        return Err(ApiError::Unauthorized(
            "Current password is incorrect".into(),
        ));
    }

    let new_hash = hash(&payload.new_password, DEFAULT_COST)
        .map_err(|e| internal_error("password hash", e))?;

    let updated = update_user_password_hash(&state.db_pool, auth.user_id, &new_hash)
        .await
        .map_err(|e| internal_error("update password", e))?;
    if !updated {
        return Err(ApiError::Unauthorized("User not found".into()));
    }

    revoke_all_user_refresh_tokens(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("revoke sessions after password change", e))?;

    let (_, device_label, _, _) = request_metadata_values(&headers);
    log_user_operation(
        &state,
        auth.user_id,
        "user.password.change",
        device_label.as_deref(),
        serde_json::json!({ "sessions_revoked": true }),
    )
    .await;

    let (access_token, refresh_token, expires_in, session_expires_at, _) =
        issue_token_pair(&state, auth.user_id, &headers).await?;

    let persistent = has_cookie(&headers, REFRESH_PERSISTENCE_COOKIE);
    let mut response_headers = HeaderMap::new();
    response_headers.append(
        header::SET_COOKIE,
        refresh_token_cookie(
            &refresh_token,
            session_expires_at,
            state.config.is_dev,
            persistent,
        )?,
    );
    response_headers.append(
        header::SET_COOKIE,
        refresh_persistence_cookie(state.config.is_dev, persistent)?,
    );

    Ok((
        response_headers,
        Json(LoginResponse {
            access_token,
            expires_in,
        }),
    )
        .into_response())
}

fn validate_optional_display_name(value: &str) -> Result<Option<String>, ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    validate_display_name(trimmed).map_err(|msg| ApiError::BadRequest(msg.into()))?;
    Ok(Some(trimmed.to_string()))
}

fn validate_avatar_url(value: &str) -> Result<Option<String>, ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(Some(String::new()));
    }

    if trimmed.len() > 3_000_000 {
        return Err(ApiError::BadRequest("Avatar image is too large".into()));
    }
    if !trimmed.starts_with("data:image/") {
        return Err(ApiError::BadRequest(
            "Avatar must be an image data URL".into(),
        ));
    }

    Ok(Some(trimmed.to_string()))
}

fn validate_default_view(value: &str) -> Result<Option<String>, ApiError> {
    let trimmed = value.trim();
    if matches!(
        trimmed,
        "all" | "favourites" | "shared" | "groups" | "calendar" | "trash"
    ) {
        return Ok(Some(trimmed.to_string()));
    }

    Err(ApiError::BadRequest("Invalid default view".into()))
}

fn validate_layout_mode(value: &str) -> Result<Option<String>, ApiError> {
    let trimmed = value.trim();
    if matches!(trimmed, "grid" | "list") {
        return Ok(Some(trimmed.to_string()));
    }

    Err(ApiError::BadRequest("Invalid layout mode".into()))
}

async fn require_refresh_token(
    state: &AppState,
    raw_token: &str,
) -> Result<ValidRefreshToken, ApiError> {
    let auth = authenticate_refresh_token(&state.db_pool, raw_token)
        .await
        .map_err(|e| internal_error("authenticate refresh token", e))?;

    match auth {
        RefreshTokenAuth::Valid(token) => Ok(token),
        RefreshTokenAuth::ReuseDetected { user_id } => {
            revoke_all_user_refresh_tokens(&state.db_pool, user_id)
                .await
                .map_err(|e| internal_error("revoke sessions after token anomaly", e))?;
            Err(ApiError::Unauthorized("Session invalid".into()))
        }
        RefreshTokenAuth::NotFound => Err(ApiError::Unauthorized(
            "Invalid or expired refresh token".into(),
        )),
    }
}

pub async fn register_user(
    State(state): State<AppState>,
    Json(payload): Json<RegisterRequest>,
) -> Result<Json<RegisterResponse>, ApiError> {
    let email = payload.email.trim().to_lowercase();
    validate_email(&email).map_err(|msg| ApiError::BadRequest(msg.into()))?;
    validate_password(&payload.password).map_err(|msg| ApiError::BadRequest(msg.into()))?;
    validate_display_name(&payload.display_name).map_err(|msg| ApiError::BadRequest(msg.into()))?;
    validate_public_key(&payload.public_key).map_err(|msg| ApiError::BadRequest(msg.into()))?;
    if payload.encrypted_private_key_recovery.len() < 64
        || payload.encrypted_private_key_recovery.len() > 20_000
    {
        return Err(ApiError::BadRequest(
            "Invalid recovery private key backup".into(),
        ));
    }

    let hashed =
        hash(&payload.password, DEFAULT_COST).map_err(|e| internal_error("password hash", e))?;

    let display_name = payload.display_name.trim();

    let (user_id, token) = create_user(
        &state.db_pool,
        NewUser {
            email: &email,
            display_name,
            password_hash: &hashed,
            public_key: &payload.public_key,
            encrypted_private_key_recovery: &payload.encrypted_private_key_recovery,
        },
        state.config.verification_token_ttl_hours,
    )
    .await
    .map_err(|e| map_db_error("create user", e))?;

    let verification_email = email.clone();
    tokio::spawn(async move {
        if let Err(e) = send_verification_email(&verification_email, &token).await {
            tracing::error!(error = %e, "failed to send verification email");
        }
    });

    Ok(Json(RegisterResponse {
        id: user_id.to_string(),
    }))
}

async fn issue_token_pair(
    state: &AppState,
    user_id: uuid::Uuid,
    headers: &HeaderMap,
) -> Result<(String, String, i64, chrono::DateTime<Utc>, Uuid), ApiError> {
    let refresh_token = generate_refresh_token();
    let (device_id, device_label, user_agent, ip_address) = request_metadata_values(headers);
    if let Some(device_id) = device_id.as_deref() {
        revoke_user_device_refresh_tokens(&state.db_pool, user_id, device_id)
            .await
            .map_err(|e| internal_error("revoke previous device sessions", e))?;
    }
    let metadata = owned_refresh_metadata(&device_id, &device_label, &user_agent, &ip_address);
    let (session_id, session_expires_at) =
        create_refresh_token(&state.db_pool, user_id, &refresh_token, metadata)
            .await
            .map_err(|e| internal_error("create refresh token", e))?;

    let (access_token, expires_in) = generate_access_token_capped(
        &user_id.to_string(),
        &state.config.jwt_secret,
        session_expires_at,
    )
    .map_err(|e| internal_error("generate access token", e))?;

    Ok((
        access_token,
        refresh_token,
        expires_in,
        session_expires_at,
        session_id,
    ))
}

async fn complete_login(
    state: &AppState,
    user_id: Uuid,
    email: &str,
    headers: &HeaderMap,
    persistent: bool,
) -> Result<Response, ApiError> {
    let (access_token, refresh_token, expires_in, session_expires_at, session_id) =
        issue_token_pair(state, user_id, headers).await?;
    update_last_login(&state.db_pool, email)
        .await
        .map_err(|e| internal_error("update last login", e))?;
    let (_, device_label, _, ip_address) = request_metadata_values(headers);
    notify_new_login(
        state,
        user_id,
        session_id,
        device_label.as_deref(),
        ip_address.as_deref(),
    )
    .await;
    log_user_operation(
        state,
        user_id,
        "user.login",
        device_label.as_deref(),
        serde_json::json!({ "remember": persistent }),
    )
    .await;

    let mut response_headers = HeaderMap::new();
    response_headers.append(
        header::SET_COOKIE,
        refresh_token_cookie(
            &refresh_token,
            session_expires_at,
            state.config.is_dev,
            persistent,
        )?,
    );
    response_headers.append(
        header::SET_COOKIE,
        refresh_persistence_cookie(state.config.is_dev, persistent)?,
    );
    Ok((
        response_headers,
        Json(LoginResponse {
            access_token,
            expires_in,
        }),
    )
        .into_response())
}

pub async fn login_user(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Response, ApiError> {
    let email = payload.email.trim().to_lowercase();
    validate_email(&email).map_err(|msg| ApiError::BadRequest(msg.into()))?;

    if payload.password.len() > 128 {
        return Err(ApiError::BadRequest("Password is too long".into()));
    }

    let auth_record = get_login_auth_record(&state.db_pool, &email)
        .await
        .map_err(|e| internal_error("get login auth record", e))?;

    let password_hash = auth_record
        .as_ref()
        .map(|record| record.password_hash.as_str())
        .unwrap_or(DUMMY_PASSWORD_HASH);
    let password_valid = verify(&payload.password, password_hash).unwrap_or(false);

    if !password_valid {
        if auth_record
            .as_ref()
            .is_some_and(|record| record.login_allowed)
        {
            record_failed_login(
                &state.db_pool,
                &email,
                state.config.max_failed_login_attempts,
                state.config.lockout_duration_minutes,
            )
            .await
            .map_err(|e| internal_error("record failed login", e))?;
        }

        return Err(ApiError::Unauthorized(INVALID_LOGIN_MESSAGE.into()));
    }

    let Some(auth_record) = auth_record else {
        return Err(ApiError::Unauthorized(INVALID_LOGIN_MESSAGE.into()));
    };

    if !auth_record.email_verified {
        return Err(ApiError::Forbidden("Email is not verified".into()));
    }

    if !auth_record.login_allowed {
        return Err(ApiError::Unauthorized(INVALID_LOGIN_MESSAGE.into()));
    }

    reset_failed_login(&state.db_pool, &email)
        .await
        .map_err(|e| internal_error("reset failed login", e))?;

    let persistent = payload.remember.unwrap_or(true);
    if auth_record.totp_enabled {
        let challenge_id = create_login_challenge(&state.db_pool, auth_record.id, persistent)
            .await
            .map_err(|e| internal_error("create TOTP login challenge", e))?;
        return Ok(Json(LoginResult::TotpRequired {
            totp_required: true,
            challenge_id: challenge_id.to_string(),
        })
        .into_response());
    }
    complete_login(&state, auth_record.id, &email, &headers, persistent).await
}

pub async fn login_totp(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<LoginTotpRequest>,
) -> Result<Response, ApiError> {
    let challenge_id = Uuid::parse_str(payload.challenge_id.trim())
        .map_err(|_| ApiError::Unauthorized("Invalid or expired verification request".into()))?;
    let Some(challenge) = get_login_challenge(&state.db_pool, challenge_id)
        .await
        .map_err(|e| internal_error("get TOTP login challenge", e))?
    else {
        return Err(ApiError::Unauthorized(
            "Invalid or expired verification request".into(),
        ));
    };
    let Some(record) = get_user_totp(&state.db_pool, challenge.user_id)
        .await
        .map_err(|e| internal_error("get TOTP configuration", e))?
    else {
        return Err(ApiError::Unauthorized(
            "Invalid or expired verification request".into(),
        ));
    };
    let secret = decrypt_secret(
        &state.config.totp_encryption_key,
        challenge.user_id,
        &record.secret_ciphertext,
        &record.secret_nonce,
    )
    .map_err(ApiError::Internal)?;
    let Some(counter) = verify_code(
        &secret,
        &payload.code,
        Utc::now().timestamp(),
        record.last_used_counter,
    ) else {
        record_login_challenge_failure(&state.db_pool, challenge_id)
            .await
            .map_err(|e| internal_error("record TOTP login failure", e))?;
        return Err(ApiError::Unauthorized("Invalid verification code".into()));
    };
    if !update_last_used_counter(&state.db_pool, challenge.user_id, counter)
        .await
        .map_err(|e| internal_error("consume TOTP code", e))?
        || !consume_login_challenge(&state.db_pool, challenge_id)
            .await
            .map_err(|e| internal_error("consume TOTP login challenge", e))?
    {
        return Err(ApiError::Unauthorized(
            "Verification code has already been used".into(),
        ));
    }
    let profile = get_current_user_crypto_profile(&state.db_pool, challenge.user_id)
        .await
        .map_err(|e| internal_error("get user profile", e))?
        .ok_or_else(|| ApiError::Unauthorized("User not found".into()))?;
    complete_login(
        &state,
        challenge.user_id,
        &profile.email,
        &headers,
        challenge.remember,
    )
    .await
}

pub async fn totp_status(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<TotpStatusResponse>, ApiError> {
    let record = get_user_totp(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("get TOTP status", e))?;
    Ok(Json(TotpStatusResponse {
        enabled: record
            .as_ref()
            .is_some_and(|item| item.enabled_at.is_some()),
        pending: record
            .as_ref()
            .is_some_and(|item| item.enabled_at.is_none()),
    }))
}

pub async fn setup_totp(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<TotpSetupResponse>, ApiError> {
    if get_user_totp(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("get TOTP configuration", e))?
        .is_some_and(|item| item.enabled_at.is_some())
    {
        return Err(ApiError::Conflict(
            "Two-factor authentication is already enabled".into(),
        ));
    }
    let profile = get_current_user_crypto_profile(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("get user profile", e))?
        .ok_or_else(|| ApiError::Unauthorized("User not found".into()))?;
    let secret = generate_secret();
    let (ciphertext, nonce) =
        encrypt_secret(&state.config.totp_encryption_key, auth.user_id, &secret)
            .map_err(ApiError::Internal)?;
    save_pending_totp(&state.db_pool, auth.user_id, &ciphertext, &nonce)
        .await
        .map_err(|e| internal_error("save TOTP setup", e))?;
    Ok(Json(TotpSetupResponse {
        secret: secret_base32(&secret),
        otpauth_url: otpauth_url(&profile.email, &secret),
    }))
}

pub async fn confirm_totp(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<TotpCodeRequest>,
) -> Result<Json<TotpStatusResponse>, ApiError> {
    let record = get_user_totp(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("get TOTP setup", e))?
        .ok_or_else(|| ApiError::BadRequest("Start TOTP setup first".into()))?;
    if record.enabled_at.is_some() {
        return Err(ApiError::Conflict(
            "Two-factor authentication is already enabled".into(),
        ));
    }
    let secret = decrypt_secret(
        &state.config.totp_encryption_key,
        auth.user_id,
        &record.secret_ciphertext,
        &record.secret_nonce,
    )
    .map_err(ApiError::Internal)?;
    let counter = verify_code(&secret, &payload.code, Utc::now().timestamp(), None)
        .ok_or_else(|| ApiError::BadRequest("Invalid verification code".into()))?;
    if !enable_totp(&state.db_pool, auth.user_id, counter)
        .await
        .map_err(|e| internal_error("enable TOTP", e))?
    {
        return Err(ApiError::BadRequest(
            "Could not enable two-factor authentication".into(),
        ));
    }
    log_user_operation(
        &state,
        auth.user_id,
        "user.totp.enable",
        None,
        serde_json::json!({}),
    )
    .await;
    Ok(Json(TotpStatusResponse {
        enabled: true,
        pending: false,
    }))
}

pub async fn disable_totp(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<TotpCodeRequest>,
) -> Result<Json<TotpStatusResponse>, ApiError> {
    let record = get_user_totp(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("get TOTP configuration", e))?
        .filter(|item| item.enabled_at.is_some())
        .ok_or_else(|| ApiError::BadRequest("Two-factor authentication is not enabled".into()))?;
    let secret = decrypt_secret(
        &state.config.totp_encryption_key,
        auth.user_id,
        &record.secret_ciphertext,
        &record.secret_nonce,
    )
    .map_err(ApiError::Internal)?;
    let counter = verify_code(
        &secret,
        &payload.code,
        Utc::now().timestamp(),
        record.last_used_counter,
    )
    .ok_or_else(|| ApiError::BadRequest("Invalid verification code".into()))?;
    if !update_last_used_counter(&state.db_pool, auth.user_id, counter)
        .await
        .map_err(|e| internal_error("consume TOTP code", e))?
    {
        return Err(ApiError::BadRequest(
            "Verification code has already been used".into(),
        ));
    }
    delete_totp(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("disable TOTP", e))?;
    log_user_operation(
        &state,
        auth.user_id,
        "user.totp.disable",
        None,
        serde_json::json!({}),
    )
    .await;
    Ok(Json(TotpStatusResponse {
        enabled: false,
        pending: false,
    }))
}

pub async fn refresh_tokens(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<Response, ApiError> {
    let refresh_token = refresh_token_from_cookie(&headers)?;
    let new_refresh_token = generate_refresh_token();
    let persistent = has_cookie(&headers, REFRESH_PERSISTENCE_COOKIE);
    let (device_id, device_label, user_agent, ip_address) = request_metadata_values(&headers);
    let metadata = owned_refresh_metadata(&device_id, &device_label, &user_agent, &ip_address);

    let stored = match authenticate_refresh_token(&state.db_pool, &refresh_token)
        .await
        .map_err(|e| internal_error("authenticate refresh token", e))?
    {
        RefreshTokenAuth::Valid(stored) => {
            rotate_refresh_token(
                &state.db_pool,
                stored.id,
                stored.user_id,
                stored.session_id,
                &new_refresh_token,
                stored.session_expires_at,
                metadata,
            )
            .await
            .map_err(|e| internal_error("rotate refresh token", e))?;
            stored
        }
        RefreshTokenAuth::ReuseDetected { user_id } => match rotate_recent_refresh_token_reuse(
            &state.db_pool,
            &refresh_token,
            &new_refresh_token,
            metadata,
        )
        .await
        .map_err(|e| internal_error("recover refresh token race", e))?
        {
            Some(stored) => stored,
            None => {
                revoke_all_user_refresh_tokens(&state.db_pool, user_id)
                    .await
                    .map_err(|e| internal_error("revoke sessions after token anomaly", e))?;
                return Err(ApiError::Unauthorized("Session invalid".into()));
            }
        },
        RefreshTokenAuth::NotFound => {
            return Err(ApiError::Unauthorized(
                "Invalid or expired refresh token".into(),
            ));
        }
    };

    let (access_token, expires_in) = generate_access_token_capped(
        &stored.user_id.to_string(),
        &state.config.jwt_secret,
        stored.session_expires_at,
    )
    .map_err(|e| internal_error("generate access token", e))?;

    let mut response_headers = HeaderMap::new();
    response_headers.append(
        header::SET_COOKIE,
        refresh_token_cookie(
            &new_refresh_token,
            stored.session_expires_at,
            state.config.is_dev,
            persistent,
        )?,
    );
    response_headers.append(
        header::SET_COOKIE,
        refresh_persistence_cookie(state.config.is_dev, persistent)?,
    );

    Ok((
        response_headers,
        Json(RefreshResponse {
            access_token,
            expires_in,
        }),
    )
        .into_response())
}

pub async fn logout_user(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<Response, ApiError> {
    if let Ok(refresh_token) = refresh_token_from_cookie(&headers)
        && let Ok(stored) = require_refresh_token(&state, &refresh_token).await
    {
        revoke_refresh_token(&state.db_pool, stored.id)
            .await
            .map_err(|e| internal_error("revoke refresh token", e))?;
        let (device_id, device_label, user_agent, ip_address) = request_metadata_values(&headers);
        let metadata = owned_refresh_metadata(&device_id, &device_label, &user_agent, &ip_address);
        insert_refresh_token_activity(
            &state.db_pool,
            stored.user_id,
            stored.session_id,
            "logout",
            metadata,
        )
        .await
        .map_err(|e| internal_error("record logout activity", e))?;
        log_user_operation(
            &state,
            stored.user_id,
            "user.logout",
            device_label.as_deref(),
            serde_json::json!({ "session_id": stored.session_id }),
        )
        .await;
    }

    let mut response_headers = HeaderMap::new();
    response_headers.append(
        header::SET_COOKIE,
        clear_cookie(REFRESH_TOKEN_COOKIE, state.config.is_dev),
    );
    response_headers.append(
        header::SET_COOKIE,
        clear_cookie(REFRESH_PERSISTENCE_COOKIE, state.config.is_dev),
    );

    Ok((response_headers, "Logged out").into_response())
}

pub async fn logout_all_sessions(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<Response, ApiError> {
    if let Ok(refresh_token) = refresh_token_from_cookie(&headers)
        && let Ok(stored) = require_refresh_token(&state, &refresh_token).await
    {
        revoke_all_user_refresh_tokens(&state.db_pool, stored.user_id)
            .await
            .map_err(|e| internal_error("revoke all refresh tokens", e))?;
        let (device_id, device_label, user_agent, ip_address) = request_metadata_values(&headers);
        let metadata = owned_refresh_metadata(&device_id, &device_label, &user_agent, &ip_address);
        insert_refresh_token_activity(
            &state.db_pool,
            stored.user_id,
            stored.session_id,
            "logout_all",
            metadata,
        )
        .await
        .map_err(|e| internal_error("record logout all activity", e))?;
        log_user_operation(
            &state,
            stored.user_id,
            "user.logout_all",
            device_label.as_deref(),
            serde_json::json!({ "session_id": stored.session_id }),
        )
        .await;
    }

    let mut response_headers = HeaderMap::new();
    response_headers.append(
        header::SET_COOKIE,
        clear_cookie(REFRESH_TOKEN_COOKIE, state.config.is_dev),
    );
    response_headers.append(
        header::SET_COOKIE,
        clear_cookie(REFRESH_PERSISTENCE_COOKIE, state.config.is_dev),
    );

    Ok((response_headers, "All sessions revoked").into_response())
}

pub async fn list_sessions(
    headers: HeaderMap,
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<SessionsResponse>, ApiError> {
    let current_session_id = current_refresh_session_id(&state, &headers, auth.user_id).await?;
    let (device_id, device_label, _, _) = request_metadata_values(&headers);
    if let (Some(device_id), Some(device_label)) = (device_id.as_deref(), device_label.as_deref()) {
        update_active_device_label(&state.db_pool, auth.user_id, device_id, device_label)
            .await
            .map_err(|e| internal_error("update active device label", e))?;
    }
    let sessions = list_active_user_sessions(&state.db_pool, auth.user_id, current_session_id)
        .await
        .map_err(|e| internal_error("list sessions", e))?;
    let activity = list_user_session_activity(&state.db_pool, auth.user_id, SESSION_ACTIVITY_LIMIT)
        .await
        .map_err(|e| internal_error("list session activity", e))?;

    Ok(Json(SessionsResponse { sessions, activity }))
}

pub async fn list_operation_log(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<OperationLogResponse>, ApiError> {
    let operations = list_user_operation_logs(
        &state.db_pool,
        &state.config.audit_log_encryption_key,
        auth.user_id,
        100,
    )
    .await
    .map_err(|e| internal_error("list operation log", e))?;

    Ok(Json(OperationLogResponse { operations }))
}

pub async fn revoke_session(
    headers: HeaderMap,
    State(state): State<AppState>,
    auth: AuthUser,
    Path(session_id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let current_session_id = current_refresh_session_id(&state, &headers, auth.user_id).await?;
    let revoked = revoke_user_session(&state.db_pool, auth.user_id, session_id)
        .await
        .map_err(|e| internal_error("revoke session", e))?;

    if !revoked {
        return Err(ApiError::BadRequest("Session not found".into()));
    }

    let (device_id, device_label, user_agent, ip_address) = request_metadata_values(&headers);
    let metadata = owned_refresh_metadata(&device_id, &device_label, &user_agent, &ip_address);
    insert_refresh_token_activity(
        &state.db_pool,
        auth.user_id,
        session_id,
        "revoked",
        metadata,
    )
    .await
    .map_err(|e| internal_error("record session revocation activity", e))?;

    log_user_operation(
        &state,
        auth.user_id,
        "user.session.revoke",
        device_label.as_deref(),
        serde_json::json!({
            "session_id": session_id,
            "current_session": current_session_id == Some(session_id),
        }),
    )
    .await;

    if current_session_id == Some(session_id) {
        let mut response_headers = HeaderMap::new();
        response_headers.append(
            header::SET_COOKIE,
            clear_cookie(REFRESH_TOKEN_COOKIE, state.config.is_dev),
        );
        response_headers.append(
            header::SET_COOKIE,
            clear_cookie(REFRESH_PERSISTENCE_COOKIE, state.config.is_dev),
        );

        Ok((response_headers, "Session revoked").into_response())
    } else {
        Ok("Session revoked".into_response())
    }
}

pub async fn update_session_trust(
    headers: HeaderMap,
    State(state): State<AppState>,
    auth: AuthUser,
    Path(session_id): Path<Uuid>,
    Json(payload): Json<UpdateSessionTrustRequest>,
) -> Result<Json<crate::db::refresh_tokens::UserSession>, ApiError> {
    let current_session_id = current_refresh_session_id(&state, &headers, auth.user_id).await?;
    let updated =
        update_user_session_trust(&state.db_pool, auth.user_id, session_id, payload.trusted)
            .await
            .map_err(|e| internal_error("update session trust", e))?;

    if !updated {
        return Err(ApiError::BadRequest("Session not found".into()));
    }

    let (device_id, device_label, user_agent, ip_address) = request_metadata_values(&headers);
    let metadata = owned_refresh_metadata(&device_id, &device_label, &user_agent, &ip_address);
    insert_refresh_token_activity(
        &state.db_pool,
        auth.user_id,
        session_id,
        "trust_changed",
        metadata,
    )
    .await
    .map_err(|e| internal_error("record session trust activity", e))?;

    log_user_operation(
        &state,
        auth.user_id,
        "user.session.trust",
        device_label.as_deref(),
        serde_json::json!({
            "session_id": session_id,
            "current_session": current_session_id == Some(session_id),
            "trusted": payload.trusted,
        }),
    )
    .await;

    let session = list_active_user_sessions(&state.db_pool, auth.user_id, current_session_id)
        .await
        .map_err(|e| internal_error("list sessions after trust update", e))?
        .into_iter()
        .find(|session| session.id == session_id)
        .ok_or_else(|| ApiError::BadRequest("Session not found".into()))?;

    Ok(Json(session))
}

pub async fn verify_email(
    State(state): State<AppState>,
    Json(params): Json<VerifyParams>,
) -> Result<&'static str, ApiError> {
    if params.token.is_empty() || params.token.len() > 128 {
        return Err(ApiError::BadRequest("Invalid verification token".into()));
    }

    let verified = verify_email_token(&state.db_pool, &params.token)
        .await
        .map_err(|e| internal_error("verify email token", e))?;

    if verified {
        Ok("Email verified successfully")
    } else {
        Err(ApiError::BadRequest("Invalid or expired token".into()))
    }
}

pub async fn resend_verification_email(
    State(state): State<AppState>,
    Json(payload): Json<ResendVerificationRequest>,
) -> Result<&'static str, ApiError> {
    let email = payload.email.trim().to_lowercase();
    if validate_email(&email).is_err() {
        return Ok("If this account needs verification, a new link has been sent");
    }

    let token = set_verification_token(
        &state.db_pool,
        &email,
        state.config.verification_token_ttl_hours,
    )
    .await
    .map_err(|e| internal_error("set verification token", e))?;

    if let Some(token) = token {
        tokio::spawn(async move {
            if let Err(e) = send_verification_email(&email, &token).await {
                tracing::error!(error = %e, "failed to resend verification email");
            }
        });
    }

    Ok("If this account needs verification, a new link has been sent")
}

async fn build_user_export_manifest(
    state: &AppState,
    user_id: Uuid,
    export_id: Uuid,
) -> Result<(serde_json::Value, Vec<ExportFilePayload>), ApiError> {
    let profile = sqlx::query(
        r#"
        SELECT
            id,
            email,
            display_name,
            avatar_url,
            public_key,
            email_verified,
            default_view,
            layout_mode,
            upload_protection,
            compact_metadata,
            device_lock,
            sync_on_metered,
            trash_retention_days,
            encrypted_private_key_recovery,
            created_at,
            updated_at,
            last_login_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| internal_error("load user export profile", e))?
    .ok_or_else(|| ApiError::Unauthorized("User not found".into()))?;

    let file_rows = sqlx::query(
        r#"
        SELECT
            id,
            filename,
            storage_path,
            mime_type,
            size_bytes,
            encrypted_key,
            encryption_nonce,
            content_key_fingerprint,
            checksum,
            folder_id,
            note,
            is_deleted,
            is_public,
            share_token,
            share_starts_at,
            share_expires_at,
            share_download_limit,
            share_download_count,
            share_one_time,
            (share_password_hash IS NOT NULL) AS share_password_enabled,
            share_recipient_email,
            created_at,
            updated_at,
            deleted_at
        FROM files
        WHERE owner_id = $1
        ORDER BY created_at ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| internal_error("load user export files", e))?;

    let mut files = Vec::with_capacity(file_rows.len());
    let mut file_manifest = Vec::with_capacity(file_rows.len());
    for row in file_rows {
        let id: Uuid = row.get("id");
        let filename: String = row.get("filename");
        let storage_path: String = row.get("storage_path");
        let encrypted_key: Vec<u8> = row.get("encrypted_key");
        let encryption_nonce: Vec<u8> = row.get("encryption_nonce");
        files.push(ExportFilePayload {
            id,
            filename: filename.clone(),
            storage_path,
        });
        file_manifest.push(serde_json::json!({
            "id": id,
            "filename": filename,
            "archive_path": format!("encrypted-files/{}-{}", id, sanitize_export_path_component(row.get::<String, _>("filename").as_str())),
            "mime_type": row.get::<Option<String>, _>("mime_type"),
            "size_bytes": row.get::<i64, _>("size_bytes"),
            "encrypted_key": general_purpose::STANDARD.encode(encrypted_key),
            "encryption_nonce": general_purpose::STANDARD.encode(encryption_nonce),
            "content_key_fingerprint": row.get::<Option<String>, _>("content_key_fingerprint"),
            "checksum_sha256": row.get::<Option<String>, _>("checksum"),
            "folder_id": row.get::<Option<Uuid>, _>("folder_id"),
            "note": row.get::<Option<String>, _>("note"),
            "is_deleted": row.get::<bool, _>("is_deleted"),
            "deleted_at": row.get::<Option<chrono::DateTime<Utc>>, _>("deleted_at"),
            "created_at": row.get::<chrono::DateTime<Utc>, _>("created_at"),
            "updated_at": row.get::<chrono::DateTime<Utc>, _>("updated_at"),
            "public_share": {
                "is_public": row.get::<bool, _>("is_public"),
                "share_token": row.get::<Option<String>, _>("share_token"),
                "starts_at": row.get::<Option<chrono::DateTime<Utc>>, _>("share_starts_at"),
                "expires_at": row.get::<Option<chrono::DateTime<Utc>>, _>("share_expires_at"),
                "download_limit": row.get::<Option<i32>, _>("share_download_limit"),
                "download_count": row.get::<i32, _>("share_download_count"),
                "one_time": row.get::<bool, _>("share_one_time"),
                "password_enabled": row.get::<bool, _>("share_password_enabled"),
                "recipient_email": row.get::<Option<String>, _>("share_recipient_email"),
            }
        }));
    }

    let folders = export_query_json(
        &state.db_pool,
        user_id,
        r#"
        SELECT COALESCE(jsonb_agg(to_jsonb(folder_row) ORDER BY folder_row.created_at), '[]'::jsonb)
        FROM (
            SELECT
                id,
                name,
                description,
                parent_folder_id,
                encode(encrypted_key, 'base64') AS encrypted_key,
                is_deleted,
                deleted_at,
                is_public,
                share_token,
                share_starts_at,
                share_expires_at,
                share_download_limit,
                share_download_count,
                share_one_time,
                (share_password_hash IS NOT NULL) AS share_password_enabled,
                share_recipient_email,
                created_at,
                updated_at
            FROM folders
            WHERE owner_id = $1
        ) folder_row
        "#,
    )
    .await?;
    let file_shares = export_query_json(
        &state.db_pool,
        user_id,
        r#"
        SELECT COALESCE(jsonb_agg(to_jsonb(share_row) ORDER BY share_row.created_at), '[]'::jsonb)
        FROM (
            SELECT
                fs.id,
                fs.file_id,
                fs.recipient_user_id,
                recipient.email AS recipient_email,
                recipient.display_name AS recipient_display_name,
                fs.permission,
                encode(fs.encrypted_key, 'base64') AS encrypted_key,
                fs.created_at,
                fs.updated_at
            FROM file_shares fs
            JOIN users recipient ON recipient.id = fs.recipient_user_id
            WHERE fs.owner_id = $1
        ) share_row
        "#,
    )
    .await?;
    let folder_shares = export_query_json(
        &state.db_pool,
        user_id,
        r#"
        SELECT COALESCE(jsonb_agg(to_jsonb(share_row) ORDER BY share_row.created_at), '[]'::jsonb)
        FROM (
            SELECT
                fs.id,
                fs.folder_id,
                fs.recipient_user_id,
                recipient.email AS recipient_email,
                recipient.display_name AS recipient_display_name,
                fs.permission,
                encode(fs.encrypted_key, 'base64') AS encrypted_key,
                fs.created_at,
                fs.updated_at
            FROM folder_shares fs
            JOIN users recipient ON recipient.id = fs.recipient_user_id
            WHERE fs.owner_id = $1
        ) share_row
        "#,
    )
    .await?;
    let tags = export_query_json(
        &state.db_pool,
        user_id,
        r#"
        SELECT COALESCE(jsonb_agg(to_jsonb(tag_row) ORDER BY tag_row.name), '[]'::jsonb)
        FROM (
            SELECT id, name, color
            FROM tags
            WHERE owner_id = $1
        ) tag_row
        "#,
    )
    .await?;
    let file_tags = export_query_json(
        &state.db_pool,
        user_id,
        r#"
        SELECT COALESCE(jsonb_agg(to_jsonb(file_tag_row) ORDER BY file_tag_row.file_id), '[]'::jsonb)
        FROM (
            SELECT ft.file_id, ft.tag_id
            FROM file_tags ft
            JOIN files f ON f.id = ft.file_id
            JOIN tags t ON t.id = ft.tag_id
            WHERE f.owner_id = $1
              AND t.owner_id = $1
        ) file_tag_row
        "#,
    )
    .await?;

    let manifest = serde_json::json!({
        "format": "skysyncr-user-data-export",
        "format_version": EXPORT_FORMAT_VERSION,
        "export_id": export_id,
        "exported_at": Utc::now(),
        "recovery_instructions_path": "recovery-instructions.txt",
        "user": {
            "id": profile.get::<Uuid, _>("id"),
            "email": profile.get::<String, _>("email"),
            "display_name": profile.get::<Option<String>, _>("display_name"),
            "avatar_url": profile.get::<Option<String>, _>("avatar_url"),
            "public_key": profile.get::<Option<String>, _>("public_key"),
            "email_verified": profile.get::<bool, _>("email_verified"),
            "settings": {
                "default_view": profile.get::<String, _>("default_view"),
                "layout_mode": profile.get::<String, _>("layout_mode"),
                "upload_protection": profile.get::<bool, _>("upload_protection"),
                "compact_metadata": profile.get::<bool, _>("compact_metadata"),
                "device_lock": profile.get::<bool, _>("device_lock"),
                "sync_on_metered": profile.get::<bool, _>("sync_on_metered"),
                "trash_retention_days": profile.get::<i32, _>("trash_retention_days"),
            },
            "encrypted_private_key_recovery": profile.get::<String, _>("encrypted_private_key_recovery"),
            "created_at": profile.get::<chrono::DateTime<Utc>, _>("created_at"),
            "updated_at": profile.get::<chrono::DateTime<Utc>, _>("updated_at"),
            "last_login_at": profile.get::<Option<chrono::DateTime<Utc>>, _>("last_login_at"),
        },
        "files": file_manifest,
        "folders": folders,
        "shares": {
            "files": file_shares,
            "folders": folder_shares,
        },
        "tags": tags,
        "file_tags": file_tags,
    });

    Ok((manifest, files))
}

async fn export_query_json(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    sql: &'static str,
) -> Result<serde_json::Value, ApiError> {
    sqlx::query_scalar::<_, serde_json::Value>(sql)
        .bind(user_id)
        .fetch_one(pool)
        .await
        .map_err(|e| internal_error("load user export section", e))
}

fn user_export_path(upload_dir: &FsPath, user_id: Uuid, export_id: Uuid) -> PathBuf {
    upload_dir
        .join(user_id.to_string())
        .join("exports")
        .join(format!("{export_id}.tar"))
}

async fn write_tar_archive(path: &FsPath, entries: Vec<TarEntry>) -> Result<(), ApiError> {
    let mut archive = fs::File::create(path)
        .await
        .map_err(|e| internal_error("create user export archive", e))?;
    let mut buffer = vec![0_u8; 1024 * 1024];

    for entry in entries {
        archive
            .write_all(&tar_header(&entry.path, entry.size)?)
            .await
            .map_err(|e| internal_error("write user export tar header", e))?;

        match entry.source {
            TarEntrySource::Bytes(bytes) => {
                archive
                    .write_all(&bytes)
                    .await
                    .map_err(|e| internal_error("write user export manifest", e))?;
            }
            TarEntrySource::File(source_path) => {
                let mut source = fs::File::open(&source_path)
                    .await
                    .map_err(|e| internal_error("open user export source file", e))?;
                loop {
                    let read = source
                        .read(&mut buffer)
                        .await
                        .map_err(|e| internal_error("read user export source file", e))?;
                    if read == 0 {
                        break;
                    }
                    archive
                        .write_all(&buffer[..read])
                        .await
                        .map_err(|e| internal_error("write user export file", e))?;
                }
            }
        }

        let padding = (512 - (entry.size % 512)) % 512;
        if padding > 0 {
            archive
                .write_all(&vec![0_u8; padding as usize])
                .await
                .map_err(|e| internal_error("write user export tar padding", e))?;
        }
    }

    archive
        .write_all(&[0_u8; 1024])
        .await
        .map_err(|e| internal_error("finish user export archive", e))?;
    archive
        .flush()
        .await
        .map_err(|e| internal_error("flush user export archive", e))?;
    Ok(())
}

fn tar_header(path: &str, size: u64) -> Result<[u8; 512], ApiError> {
    let (name, prefix) = split_tar_path(path)?;
    if name.len() > 100 || prefix.len() > 155 {
        return Err(ApiError::BadRequest("Export path is too long".into()));
    }

    let mut header = [0_u8; 512];
    write_tar_bytes(&mut header[0..100], name.as_bytes());
    write_tar_octal(&mut header[100..108], 0o644);
    write_tar_octal(&mut header[108..116], 0);
    write_tar_octal(&mut header[116..124], 0);
    write_tar_octal(&mut header[124..136], size);
    write_tar_octal(&mut header[136..148], Utc::now().timestamp().max(0) as u64);
    for byte in &mut header[148..156] {
        *byte = b' ';
    }
    header[156] = b'0';
    write_tar_bytes(&mut header[257..263], b"ustar\0");
    write_tar_bytes(&mut header[263..265], b"00");
    write_tar_bytes(&mut header[345..500], prefix.as_bytes());

    let checksum: u32 = header.iter().map(|byte| u32::from(*byte)).sum();
    let checksum_value = format!("{checksum:06o}\0 ");
    write_tar_bytes(&mut header[148..156], checksum_value.as_bytes());
    Ok(header)
}

fn split_tar_path(path: &str) -> Result<(&str, &str), ApiError> {
    if path.len() <= 100 {
        return Ok((path, ""));
    }

    let Some(split_at) = path.rfind('/') else {
        return Err(ApiError::BadRequest("Export path is too long".into()));
    };
    let prefix = &path[..split_at];
    let name = &path[split_at + 1..];

    if name.is_empty() || name.len() > 100 || prefix.len() > 155 {
        return Err(ApiError::BadRequest("Export path is too long".into()));
    }

    Ok((name, prefix))
}

fn write_tar_octal(field: &mut [u8], value: u64) {
    let width = field.len();
    let encoded = format!("{value:0width$o}\0", width = width - 1);
    write_tar_bytes(field, encoded.as_bytes());
}

fn write_tar_bytes(field: &mut [u8], bytes: &[u8]) {
    let len = field.len().min(bytes.len());
    field[..len].copy_from_slice(&bytes[..len]);
}

fn sanitize_export_path_component(value: &str) -> String {
    let mut sanitized: String = value
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '_' | '-' => ch,
            _ => '_',
        })
        .take(56)
        .collect();

    if sanitized.trim_matches('_').is_empty() {
        sanitized = "encrypted-file.bin".into();
    }
    sanitized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refresh_cookies_are_available_to_api_proxy_paths() {
        let expires_at = Utc::now() + chrono::Duration::hours(1);

        let refresh = refresh_token_cookie("refresh-token", expires_at, true, true)
            .expect("refresh cookie")
            .to_str()
            .expect("refresh cookie header")
            .to_string();
        let persistence = refresh_persistence_cookie(true, true)
            .expect("persistence cookie")
            .to_str()
            .expect("persistence cookie header")
            .to_string();
        let cleared = clear_cookie(REFRESH_TOKEN_COOKIE, true)
            .to_str()
            .expect("clear cookie header")
            .to_string();

        assert!(refresh.contains("Path=/;"));
        assert!(persistence.contains("Path=/;"));
        assert!(cleared.contains("Path=/;"));
        assert!(!refresh.contains("Path=/users"));
        assert!(!persistence.contains("Path=/users"));
        assert!(!cleared.contains("Path=/users"));
    }

    #[test]
    fn tar_header_supports_export_file_paths_with_prefix() {
        let path = "encrypted-files/00000000-0000-0000-0000-000000000000-very-long-exported-file-name-with-safe-suffix.bin";
        let header = tar_header(path, 128).expect("tar header");

        assert_eq!(
            std::str::from_utf8(&header[345..360]).expect("prefix"),
            "encrypted-files"
        );
        assert!(
            std::str::from_utf8(&header[0..100])
                .expect("name")
                .starts_with("00000000-0000-0000-0000-000000000000-very-long")
        );
    }
}
