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
pub struct ShareRecipientRecord {
    pub email: String,
    pub public_key: String,
}

#[derive(FromRow)]
struct SharedFileRow {
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

pub async fn ensure_file_shares_table(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS file_shares
        (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            file_id           UUID        NOT NULL REFERENCES files (id) ON DELETE CASCADE,
            owner_id          UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            recipient_user_id UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            permission        TEXT        NOT NULL DEFAULT 'read',
            encrypted_key     BYTEA       NOT NULL,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'file_shares' AND column_name = 'shared_by_user_id'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'file_shares' AND column_name = 'owner_id'
            ) THEN
                ALTER TABLE file_shares RENAME COLUMN shared_by_user_id TO owner_id;
            END IF;

            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'file_shares' AND column_name = 'shared_with_user_id'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'file_shares' AND column_name = 'recipient_user_id'
            ) THEN
                ALTER TABLE file_shares RENAME COLUMN shared_with_user_id TO recipient_user_id;
            END IF;
        END $$;
        "#,
    )
    .execute(pool)
    .await?;
    sqlx::query("ALTER TABLE file_shares ADD COLUMN IF NOT EXISTS encrypted_key BYTEA")
        .execute(pool)
        .await?;
    sqlx::query("ALTER TABLE file_shares ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM file_shares WHERE encrypted_key IS NULL")
        .execute(pool)
        .await?;
    sqlx::query("ALTER TABLE file_shares ALTER COLUMN encrypted_key SET NOT NULL")
        .execute(pool)
        .await?;
    sqlx::query("ALTER TABLE file_shares DROP CONSTRAINT IF EXISTS file_shares_permission_check")
        .execute(pool)
        .await?;
    sqlx::query(
        "ALTER TABLE file_shares ADD CONSTRAINT file_shares_permission_check CHECK (permission IN ('read', 'download', 'write'))",
    )
    .execute(pool)
    .await?;
    sqlx::query("ALTER TABLE file_shares DROP CONSTRAINT IF EXISTS file_shares_not_self_check")
        .execute(pool)
        .await?;
    sqlx::query("ALTER TABLE file_shares ADD CONSTRAINT file_shares_not_self_check CHECK (owner_id <> recipient_user_id)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE UNIQUE INDEX IF NOT EXISTS idx_file_shares_unique_recipient ON file_shares (file_id, recipient_user_id)")
        .execute(pool)
        .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_file_shares_recipient ON file_shares (recipient_user_id)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_file_shares_owner_file ON file_shares (owner_id, file_id)",
    )
    .execute(pool)
    .await?;

    Ok(())
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
            share_download_limit,
            share_download_count,
            EXISTS (
                SELECT 1
                FROM favorites fav
                WHERE fav.user_id = $1
                  AND fav.file_id = files.id
            ) AS is_favourite,
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
            share_download_limit,
            share_download_count,
            FALSE AS is_favourite,
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
          AND (
              owner_id = $2
              OR EXISTS (
                  SELECT 1
                  FROM file_shares fs
                  WHERE fs.file_id = files.id
                    AND fs.recipient_user_id = $2
              )
          )
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
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<SharedFileRecord>, sqlx::Error> {
    let rows = sqlx::query_as::<_, SharedFileRow>(
        r#"
        SELECT
            f.id,
            f.filename,
            f.storage_path,
            f.mime_type,
            f.size_bytes,
            f.folder_id,
            f.note,
            f.is_deleted,
            f.is_public,
            f.share_token,
            f.share_expires_at,
            f.share_download_limit,
            f.share_download_count,
            EXISTS (
                SELECT 1
                FROM favorites fav
                WHERE fav.user_id = $1
                  AND fav.file_id = f.id
            ) AS is_favourite,
            fs.encrypted_key,
            f.encryption_nonce,
            f.created_at,
            f.updated_at,
            f.deleted_at,
            fs.permission AS permissions,
            fs.owner_id AS shared_by_user_id,
            owner.display_name AS shared_by_user_name
        FROM file_shares fs
        JOIN files f ON f.id = fs.file_id
        JOIN users owner ON owner.id = fs.owner_id
        WHERE fs.recipient_user_id = $1
          AND f.is_deleted = FALSE
          AND owner.is_active = TRUE
        ORDER BY fs.updated_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| SharedFileRecord {
            file: FileRecord {
                id: row.id,
                filename: row.filename,
                storage_path: row.storage_path,
                mime_type: row.mime_type,
                size_bytes: row.size_bytes,
                folder_id: row.folder_id,
                note: row.note,
                is_deleted: row.is_deleted,
                is_public: row.is_public,
                share_token: row.share_token,
                share_expires_at: row.share_expires_at,
                share_download_limit: row.share_download_limit,
                share_download_count: row.share_download_count,
                is_favourite: row.is_favourite,
                encrypted_key: row.encrypted_key,
                encryption_nonce: row.encryption_nonce,
                created_at: row.created_at,
                updated_at: row.updated_at,
                deleted_at: row.deleted_at,
            },
            permissions: row.permissions,
            shared_by_user_id: row.shared_by_user_id,
            shared_by_user_name: row.shared_by_user_name,
        })
        .collect())
}

pub async fn get_file_share_recipient(
    pool: &PgPool,
    owner_id: Uuid,
    file_id: Uuid,
    email: &str,
) -> Result<Option<ShareRecipientRecord>, sqlx::Error> {
    sqlx::query_as::<_, ShareRecipientRecord>(
        r#"
        SELECT recipient.email, recipient.public_key
        FROM files f
        JOIN users recipient ON recipient.email = $3
        WHERE f.id = $1
          AND f.owner_id = $2
          AND f.is_deleted = FALSE
          AND recipient.is_active = TRUE
          AND recipient.public_key IS NOT NULL
          AND recipient.id <> $2
        "#,
    )
    .bind(file_id)
    .bind(owner_id)
    .bind(email)
    .fetch_optional(pool)
    .await
}

pub async fn list_user_file_shares(
    pool: &PgPool,
    owner_id: Uuid,
    file_id: Uuid,
) -> Result<Vec<FileShareRecord>, sqlx::Error> {
    sqlx::query_as::<_, FileShareRecord>(
        r#"
        SELECT
            fs.id,
            recipient.email,
            recipient.display_name,
            fs.permission,
            fs.created_at
        FROM file_shares fs
        JOIN files f ON f.id = fs.file_id
        JOIN users recipient ON recipient.id = fs.recipient_user_id
        WHERE fs.file_id = $1
          AND fs.owner_id = $2
          AND f.owner_id = $2
          AND f.is_deleted = FALSE
        ORDER BY fs.created_at DESC
        "#,
    )
    .bind(file_id)
    .bind(owner_id)
    .fetch_all(pool)
    .await
}

pub async fn upsert_user_file_share(
    pool: &PgPool,
    share: NewFileShare,
) -> Result<Option<FileShareRecord>, sqlx::Error> {
    sqlx::query_as::<_, FileShareRecord>(
        r#"
        WITH target AS (
            SELECT f.id AS file_id, recipient.id AS recipient_user_id
            FROM files f
            JOIN users recipient ON recipient.email = $3
            WHERE f.id = $2
              AND f.owner_id = $1
              AND f.is_deleted = FALSE
              AND recipient.is_active = TRUE
              AND recipient.id <> $1
        ),
        upserted AS (
            INSERT INTO file_shares (
                file_id,
                owner_id,
                recipient_user_id,
                permission,
                encrypted_key
            )
            SELECT file_id, $1, recipient_user_id, $4, $5
            FROM target
            ON CONFLICT (file_id, recipient_user_id)
            DO UPDATE SET
                permission = EXCLUDED.permission,
                encrypted_key = EXCLUDED.encrypted_key,
                updated_at = NOW()
            RETURNING id, recipient_user_id, permission, created_at
        )
        SELECT
            upserted.id,
            recipient.email,
            recipient.display_name,
            upserted.permission,
            upserted.created_at
        FROM upserted
        JOIN users recipient ON recipient.id = upserted.recipient_user_id
        "#,
    )
    .bind(share.owner_id)
    .bind(share.file_id)
    .bind(share.recipient_email)
    .bind(share.permission)
    .bind(share.encrypted_key)
    .fetch_optional(pool)
    .await
}

pub async fn delete_user_file_share(
    pool: &PgPool,
    owner_id: Uuid,
    file_id: Uuid,
    share_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        DELETE FROM file_shares
        WHERE id = $1
          AND file_id = $2
          AND owner_id = $3
        "#,
    )
    .bind(share_id)
    .bind(file_id)
    .bind(owner_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
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
            share_download_limit,
            share_download_count,
            EXISTS (
                SELECT 1
                FROM favorites fav
                WHERE fav.user_id = $3
                  AND fav.file_id = files.id
            ) AS is_favourite,
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
            share_download_limit,
            share_download_count,
            EXISTS (
                SELECT 1
                FROM favorites fav
                WHERE fav.user_id = $6
                  AND fav.file_id = files.id
            ) AS is_favourite,
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
    share_download_limit: Option<i32>,
) -> Result<Option<FileRecord>, sqlx::Error> {
    sqlx::query_as::<_, FileRecord>(
        r#"
        UPDATE files
        SET is_public = $1,
            share_token = $2,
            share_expires_at = $3,
            share_download_limit = $4,
            share_download_count = 0,
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
            share_download_limit,
            share_download_count,
            EXISTS (
                SELECT 1
                FROM favorites fav
                WHERE fav.user_id = $6
                  AND fav.file_id = files.id
            ) AS is_favourite,
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
    .bind(share_download_limit)
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
            share_download_limit,
            share_download_count,
            EXISTS (
                SELECT 1
                FROM favorites fav
                WHERE fav.user_id = $3
                  AND fav.file_id = files.id
            ) AS is_favourite,
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

pub async fn user_file_exists(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM files
            WHERE id = $1
              AND owner_id = $2
              AND is_deleted = FALSE
        )
        "#,
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
}

pub async fn add_user_file_favourite(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO favorites (user_id, file_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, file_id) DO NOTHING
        "#,
    )
    .bind(user_id)
    .bind(file_id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn remove_user_file_favourite(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        DELETE FROM favorites
        WHERE user_id = $1
          AND file_id = $2
        "#,
    )
    .bind(user_id)
    .bind(file_id)
    .execute(pool)
    .await?;

    Ok(())
}
