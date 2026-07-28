use crate::auth::AuthUser;
use crate::crypto::jwt::generate_access_token_capped;
use crate::crypto::refresh_token::generate_refresh_token;
use crate::db::audit_logs::{insert_user_audit_log, list_user_operation_logs};
use crate::db::refresh_tokens::{
    RefreshTokenAuth, RefreshTokenMetadata, ValidRefreshToken, authenticate_refresh_token,
    create_refresh_token, insert_refresh_token_activity, list_active_user_sessions,
    list_user_session_activity, revoke_all_user_refresh_tokens, revoke_refresh_token,
    revoke_user_device_refresh_tokens, revoke_user_session, rotate_refresh_token,
};
use crate::db::users::*;
use crate::models::users::{
    ChangePasswordRequest, CurrentUserResponse, LoginRequest, LoginResponse, RefreshResponse,
    RegisterRequest, RegisterResponse, UpdateUserSettingsRequest, UserSettingsResponse,
};
use crate::state::AppState;
use crate::utils::errors::{ApiError, internal_error, map_db_error};
use crate::utils::validation::{
    validate_display_name, validate_email, validate_password, validate_public_key,
};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, HeaderName, HeaderValue, header},
    response::{IntoResponse, Response},
};
use bcrypt::{DEFAULT_COST, hash, verify};
use chrono::Utc;
use serde::Deserialize;
use serde::Serialize;
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
const INVALID_LOGIN_MESSAGE: &str = "Invalid email or password";
const SESSION_ACTIVITY_LIMIT: i64 = 30;
const DEVICE_ID_HEADER: &str = "x-skysyncr-device-id";

#[derive(Serialize)]
pub struct SessionsResponse {
    pub sessions: Vec<crate::db::refresh_tokens::UserSession>,
    pub activity: Vec<crate::db::refresh_tokens::UserSessionActivity>,
}

#[derive(Serialize)]
pub struct OperationLogResponse {
    pub operations: Vec<crate::db::audit_logs::OperationLogRecord>,
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
        user_id,
        operation,
        None,
        Some("account"),
        device_label,
        details,
    )
    .await
    {
        tracing::warn!(error = %e, operation, "failed to write user operation log");
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
        "{REFRESH_TOKEN_COOKIE}={token}{max_age_attr}; Path=/users; HttpOnly; SameSite=Lax{secure}"
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
        "{REFRESH_PERSISTENCE_COOKIE}=1{max_age}; Path=/users; HttpOnly; SameSite=Lax{secure}"
    ))
    .map_err(|e| internal_error("build refresh cookie", e))
}

fn clear_cookie(name: &str, is_dev: bool) -> HeaderValue {
    let secure = if is_dev { "" } else { "; Secure" };
    HeaderValue::from_str(&format!(
        "{name}=; Max-Age=0; Path=/users; HttpOnly; SameSite=Lax{secure}"
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

    let (access_token, refresh_token, expires_in, session_expires_at) =
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
) -> Result<(String, String, i64, chrono::DateTime<Utc>), ApiError> {
    let refresh_token = generate_refresh_token();
    let (device_id, device_label, user_agent, ip_address) = request_metadata_values(headers);
    if let Some(device_id) = device_id.as_deref() {
        revoke_user_device_refresh_tokens(&state.db_pool, user_id, device_id)
            .await
            .map_err(|e| internal_error("revoke previous device sessions", e))?;
    }
    let metadata = owned_refresh_metadata(&device_id, &device_label, &user_agent, &ip_address);
    let session_expires_at =
        create_refresh_token(&state.db_pool, user_id, &refresh_token, metadata)
            .await
            .map_err(|e| internal_error("create refresh token", e))?;

    let (access_token, expires_in) = generate_access_token_capped(
        &user_id.to_string(),
        &state.config.jwt_secret,
        session_expires_at,
    )
    .map_err(|e| internal_error("generate access token", e))?;

    Ok((access_token, refresh_token, expires_in, session_expires_at))
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

    let (access_token, refresh_token, expires_in, session_expires_at) =
        issue_token_pair(&state, auth_record.id, &headers).await?;

    update_last_login(&state.db_pool, &email)
        .await
        .map_err(|e| internal_error("update last login", e))?;

    let persistent = payload.remember.unwrap_or(true);
    let (_, device_label, _, _) = request_metadata_values(&headers);
    log_user_operation(
        &state,
        auth_record.id,
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

pub async fn refresh_tokens(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<Response, ApiError> {
    let refresh_token = refresh_token_from_cookie(&headers)?;
    let stored = require_refresh_token(&state, &refresh_token).await?;

    let (access_token, expires_in) = generate_access_token_capped(
        &stored.user_id.to_string(),
        &state.config.jwt_secret,
        stored.session_expires_at,
    )
    .map_err(|e| internal_error("generate access token", e))?;

    let new_refresh_token = generate_refresh_token();
    let persistent = has_cookie(&headers, REFRESH_PERSISTENCE_COOKIE);
    let (device_id, device_label, user_agent, ip_address) = request_metadata_values(&headers);
    let metadata = owned_refresh_metadata(&device_id, &device_label, &user_agent, &ip_address);
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
