use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,

    pub email: String,
    pub password_hash: String,

    pub is_active: bool,

    pub is_admin: bool,

    pub storage_quota_bytes: i64,
    pub used_storage_bytes: i64,

    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub display_name: String,
    pub password: String,
    pub public_key: String,
    pub encrypted_private_key_recovery: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
    pub remember: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Serialize)]
pub struct RegisterResponse {
    pub id: String,
}
#[derive(Serialize)]
pub struct LoginResponse {
    pub access_token: String,
    pub expires_in: i64,
}

#[derive(Serialize)]
pub struct RefreshResponse {
    pub access_token: String,
    pub expires_in: i64,
}

#[derive(Debug, Deserialize)]
pub struct DeleteUserRequest {}

#[derive(Debug, Deserialize)]
pub struct UpdateUserAvatarRequest {
    pub avatar_url: String,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub email: String,
    pub is_active: bool,
    pub is_admin: bool,
    pub storage_quota_bytes: i64,
    pub used_storage_bytes: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct CurrentUserResponse {
    pub id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub public_key: Option<String>,
    pub default_view: String,
    pub layout_mode: String,
    pub upload_protection: bool,
    pub compact_metadata: bool,
    pub device_lock: bool,
    pub sync_on_metered: bool,
    pub trash_retention_days: i32,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserSettingsRequest {
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub default_view: Option<String>,
    pub layout_mode: Option<String>,
    pub upload_protection: Option<bool>,
    pub compact_metadata: Option<bool>,
    pub device_lock: Option<bool>,
    pub sync_on_metered: Option<bool>,
    pub trash_retention_days: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct UserSettingsResponse {
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub default_view: String,
    pub layout_mode: String,
    pub upload_protection: bool,
    pub compact_metadata: bool,
    pub device_lock: bool,
    pub sync_on_metered: bool,
    pub trash_retention_days: i32,
}

impl From<User> for UserResponse {
    fn from(user: User) -> Self {
        UserResponse {
            id: user.id,
            email: user.email,
            is_active: user.is_active,
            is_admin: user.is_admin,
            storage_quota_bytes: user.storage_quota_bytes,
            used_storage_bytes: user.used_storage_bytes,
            created_at: user.created_at,
            updated_at: user.updated_at,
        }
    }
}
