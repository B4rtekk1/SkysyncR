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
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
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