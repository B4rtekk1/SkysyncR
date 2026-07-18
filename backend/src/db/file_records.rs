use base64::{Engine as _, engine::general_purpose};
use chrono::{DateTime, Utc};
use serde::{Serialize, Serializer};
use sqlx::FromRow;
use uuid::Uuid;

fn serialize_bytes_base64<S>(bytes: &Vec<u8>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(&general_purpose::STANDARD.encode(bytes))
}

#[derive(FromRow, Serialize)]
pub struct FileRecord {
    pub id: Uuid,
    pub filename: String,
    pub storage_path: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub folder_id: Option<Uuid>,
    pub note: Option<String>,
    pub is_deleted: bool,
    pub is_public: bool,
    pub share_token: Option<String>,
    pub share_expires_at: Option<DateTime<Utc>>,
    pub share_download_limit: Option<i32>,
    pub share_download_count: i32,
    pub is_favourite: bool,
    #[serde(serialize_with = "serialize_bytes_base64")]
    pub encrypted_key: Vec<u8>,
    #[serde(serialize_with = "serialize_bytes_base64")]
    pub encryption_nonce: Vec<u8>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
pub struct SharedFileRecord {
    #[serde(flatten)]
    pub file: FileRecord,
    pub permissions: String,
    pub shared_by_user_id: Uuid,
    pub shared_by_user_name: Option<String>,
}

#[derive(FromRow, Serialize)]
pub struct FileShareRecord {
    pub id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub permission: String,
    pub created_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize)]
pub struct FileVersionRecord {
    pub id: Uuid,
    pub file_id: Uuid,
    pub version_number: i32,
    pub size_bytes: i64,
    pub checksum: Option<String>,
    pub device_label: Option<String>,
    pub action: String,
    pub created_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize)]
pub struct FileAuditRecord {
    pub id: Uuid,
    pub action: String,
    pub resource_id: Option<Uuid>,
    pub resource_type: Option<String>,
    pub device_label: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize)]
pub struct ShareRecipientRecord {
    pub email: String,
    pub public_key: String,
}

#[derive(FromRow)]
pub(super) struct SharedFileRow {
    pub id: Uuid,
    pub filename: String,
    pub storage_path: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub folder_id: Option<Uuid>,
    pub note: Option<String>,
    pub is_deleted: bool,
    pub is_public: bool,
    pub share_token: Option<String>,
    pub share_expires_at: Option<DateTime<Utc>>,
    pub share_download_limit: Option<i32>,
    pub share_download_count: i32,
    pub is_favourite: bool,
    pub encrypted_key: Vec<u8>,
    pub encryption_nonce: Vec<u8>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
    pub permissions: String,
    pub shared_by_user_id: Uuid,
    pub shared_by_user_name: Option<String>,
}

pub struct NewFileRecord {
    pub owner_id: Uuid,
    pub filename: String,
    pub storage_path: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub encrypted_key: Vec<u8>,
    pub encryption_nonce: Vec<u8>,
    pub checksum: String,
    pub folder_id: Option<Uuid>,
}

pub struct NewFileShare {
    pub owner_id: Uuid,
    pub file_id: Uuid,
    pub recipient_email: String,
    pub permission: String,
    pub encrypted_key: Vec<u8>,
}

#[derive(FromRow)]
pub struct DownloadFileRecord {
    pub filename: String,
    pub storage_path: String,
    pub size_bytes: i64,
    pub checksum: Option<String>,
}

#[derive(FromRow)]
pub struct UpdateFileContentTarget {
    pub storage_path: String,
    pub size_bytes: i64,
    pub checksum: Option<String>,
    pub encrypted_key: Vec<u8>,
    pub encryption_nonce: Vec<u8>,
}

#[derive(FromRow)]
pub struct FilePurgeTarget {
    pub id: Uuid,
    pub storage_path: String,
}
