use base64::{Engine as _, engine::general_purpose};
use chrono::{DateTime, Utc};
use serde::{Serialize, Serializer};
use sqlx::{FromRow, PgPool};
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

#[derive(FromRow)]
pub struct DownloadFileRecord {
    pub filename: String,
    pub storage_path: String,
}

#[derive(FromRow)]
pub struct UpdateFileContentTarget {
    pub storage_path: String,
    pub size_bytes: i64,
}

#[derive(FromRow)]
pub struct FilePurgeTarget {
    pub id: Uuid,
    pub storage_path: String,
}

pub async fn list_user_files(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Option<Uuid>,
    trashed: bool,
) -> Result<Vec<FileRecord>, sqlx::Error> {
    sqlx::query_as::<_, FileRecord>(
        r#"
        SELECT
            id,
            filename,
            storage_path,
            mime_type,
            size_bytes,
            folder_id,
            note,
            is_deleted,
            is_public,
            share_token,
            share_expires_at,
            encrypted_key,
            encryption_nonce,
            created_at,
            updated_at,
            deleted_at
        FROM files
        WHERE owner_id = $1
          AND is_deleted = $2
          AND ($3::uuid IS NULL OR folder_id = $3)
        ORDER BY updated_at DESC
        "#,
    )
    .bind(user_id)
    .bind(trashed)
    .bind(folder_id)
    .fetch_all(pool)
    .await
}

pub async fn create_file_record(
    pool: &PgPool,
    file: NewFileRecord,
) -> Result<FileRecord, sqlx::Error> {
    sqlx::query_as::<_, FileRecord>(
        r#"
        INSERT INTO files (
            owner_id,
            filename,
            storage_path,
            mime_type,
            size_bytes,
            encrypted_key,
            encryption_nonce,
            checksum,
            folder_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING
            id,
            filename,
            storage_path,
            mime_type,
            size_bytes,
            folder_id,
            note,
            is_deleted,
            is_public,
            share_token,
            share_expires_at,
            encrypted_key,
            encryption_nonce,
            created_at,
            updated_at,
            deleted_at
        "#,
    )
    .bind(file.owner_id)
    .bind(file.filename)
    .bind(file.storage_path)
    .bind(file.mime_type)
    .bind(file.size_bytes)
    .bind(file.encrypted_key)
    .bind(file.encryption_nonce)
    .bind(file.checksum)
    .bind(file.folder_id)
    .fetch_one(pool)
    .await
}

pub async fn get_user_file_for_download(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
) -> Result<Option<DownloadFileRecord>, sqlx::Error> {
    sqlx::query_as::<_, DownloadFileRecord>(
        r#"
        SELECT filename, storage_path
        FROM files
        WHERE id = $1
          AND owner_id = $2
          AND is_deleted = FALSE
        "#,
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn get_user_file_for_content_update(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
) -> Result<Option<UpdateFileContentTarget>, sqlx::Error> {
    sqlx::query_as::<_, UpdateFileContentTarget>(
        r#"
        SELECT storage_path, size_bytes
        FROM files
        WHERE id = $1
          AND owner_id = $2
          AND is_deleted = FALSE
        "#,
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn folder_belongs_to_user(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM folders
            WHERE id = $1
              AND owner_id = $2
        )
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(exists)
}

pub async fn list_files_shared_with_user(
    _pool: &PgPool,
    _user_id: Uuid,
) -> Result<Vec<SharedFileRecord>, sqlx::Error> {
    Ok(Vec::new())
}

pub async fn soft_delete_user_file(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE files
        SET is_deleted = TRUE,
            deleted_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
          AND owner_id = $2
          AND is_deleted = FALSE
        "#,
    )
    .bind(file_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn restore_user_file(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE files
        SET is_deleted = FALSE,
            deleted_at = NULL,
            updated_at = NOW()
        WHERE id = $1
          AND owner_id = $2
          AND is_deleted = TRUE
        "#,
    )
    .bind(file_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn get_user_file_for_permanent_delete(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
) -> Result<Option<FilePurgeTarget>, sqlx::Error> {
    sqlx::query_as::<_, FilePurgeTarget>(
        r#"
        SELECT id, storage_path
        FROM files
        WHERE id = $1
          AND owner_id = $2
          AND is_deleted = TRUE
        "#,
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn list_expired_deleted_files(
    pool: &PgPool,
    retention_days: i64,
    limit: i64,
) -> Result<Vec<FilePurgeTarget>, sqlx::Error> {
    sqlx::query_as::<_, FilePurgeTarget>(
        r#"
        SELECT f.id, f.storage_path
        FROM files f
        JOIN users u ON u.id = f.owner_id
        WHERE f.is_deleted = TRUE
          AND f.deleted_at IS NOT NULL
          AND f.deleted_at <= NOW() - (COALESCE(u.trash_retention_days, $1::int)::int * interval '1 day')
        ORDER BY f.deleted_at ASC
        LIMIT $2
        "#,
    )
    .bind(retention_days as i32)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn hard_delete_file_record(pool: &PgPool, file_id: Uuid) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        DELETE FROM files
        WHERE id = $1
          AND is_deleted = TRUE
        "#,
    )
    .bind(file_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn rename_user_file(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
    filename: String,
) -> Result<Option<FileRecord>, sqlx::Error> {
    sqlx::query_as::<_, FileRecord>(
        r#"
        UPDATE files
        SET filename = $1,
            updated_at = NOW()
        WHERE id = $2
          AND owner_id = $3
          AND is_deleted = FALSE
        RETURNING
            id,
            filename,
            storage_path,
            mime_type,
            size_bytes,
            folder_id,
            note,
            is_deleted,
            is_public,
            share_token,
            share_expires_at,
            encrypted_key,
            encryption_nonce,
            created_at,
            updated_at,
            deleted_at
        "#,
    )
    .bind(filename)
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn update_user_file_content(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
    size_bytes: i64,
    encrypted_key: Vec<u8>,
    encryption_nonce: Vec<u8>,
    checksum: String,
) -> Result<Option<FileRecord>, sqlx::Error> {
    sqlx::query_as::<_, FileRecord>(
        r#"
        UPDATE files
        SET size_bytes = $1,
            encrypted_key = $2,
            encryption_nonce = $3,
            checksum = $4,
            updated_at = NOW()
        WHERE id = $5
          AND owner_id = $6
          AND is_deleted = FALSE
        RETURNING
            id,
            filename,
            storage_path,
            mime_type,
            size_bytes,
            folder_id,
            note,
            is_deleted,
            is_public,
            share_token,
            share_expires_at,
            encrypted_key,
            encryption_nonce,
            created_at,
            updated_at,
            deleted_at
        "#,
    )
    .bind(size_bytes)
    .bind(encrypted_key)
    .bind(encryption_nonce)
    .bind(checksum)
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn update_user_file_share(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
    is_public: bool,
    share_token: Option<String>,
    share_expires_at: Option<DateTime<Utc>>,
) -> Result<Option<FileRecord>, sqlx::Error> {
    sqlx::query_as::<_, FileRecord>(
        r#"
        UPDATE files
        SET is_public = $1,
            share_token = $2,
            share_expires_at = $3,
            updated_at = NOW()
        WHERE id = $4
          AND owner_id = $5
          AND is_deleted = FALSE
        RETURNING
            id,
            filename,
            storage_path,
            mime_type,
            size_bytes,
            folder_id,
            note,
            is_deleted,
            is_public,
            share_token,
            share_expires_at,
            encrypted_key,
            encryption_nonce,
            created_at,
            updated_at,
            deleted_at
        "#,
    )
    .bind(is_public)
    .bind(share_token)
    .bind(share_expires_at)
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn update_user_file_note(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
    note: Option<String>,
) -> Result<Option<FileRecord>, sqlx::Error> {
    sqlx::query_as::<_, FileRecord>(
        r#"
        UPDATE files
        SET note = $1,
            updated_at = NOW()
        WHERE id = $2
          AND owner_id = $3
          AND is_deleted = FALSE
        RETURNING
            id,
            filename,
            storage_path,
            mime_type,
            size_bytes,
            folder_id,
            note,
            is_deleted,
            is_public,
            share_token,
            share_expires_at,
            encrypted_key,
            encryption_nonce,
            created_at,
            updated_at,
            deleted_at
        "#,
    )
    .bind(note)
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}
