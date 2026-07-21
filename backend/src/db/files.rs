use chrono::{DateTime, Utc};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use super::file_records::SharedFileRow;
pub use super::file_records::{
    DownloadFileRecord, FileAuditRecord, FilePurgeTarget, FileRecord, FileShareRecord,
    FileVersionRecord, NewFileRecord, NewFileShare, ShareRecipientRecord, SharedFileRecord,
    UpdateFileContentTarget,
};
use super::storage::try_apply_storage_delta;

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
    tx: &mut Transaction<'_, Postgres>,
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
    .fetch_one(&mut **tx)
    .await
}

pub async fn get_user_file_for_download(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
) -> Result<Option<DownloadFileRecord>, sqlx::Error> {
    sqlx::query_as::<_, DownloadFileRecord>(
        r#"
        SELECT filename, mime_type, storage_path, size_bytes, checksum, encryption_nonce
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

pub async fn consume_public_file_share_for_download(
    pool: &PgPool,
    share_token: &str,
) -> Result<Option<DownloadFileRecord>, sqlx::Error> {
    sqlx::query_as::<_, DownloadFileRecord>(
        r#"
        UPDATE files
        SET share_download_count = share_download_count + 1,
            updated_at = NOW()
        WHERE share_token = $1
          AND is_public = TRUE
          AND is_deleted = FALSE
          AND (share_expires_at IS NULL OR share_expires_at > NOW())
          AND (
              share_download_limit IS NULL
              OR share_download_count < share_download_limit
          )
        RETURNING filename, mime_type, storage_path, size_bytes, checksum, encryption_nonce
        "#,
    )
    .bind(share_token)
    .fetch_optional(pool)
    .await
}

pub async fn get_user_file_for_content_update_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    file_id: Uuid,
) -> Result<Option<UpdateFileContentTarget>, sqlx::Error> {
    sqlx::query_as::<_, UpdateFileContentTarget>(
        r#"
        SELECT storage_path, size_bytes, checksum, encrypted_key, encryption_nonce
        FROM files
        WHERE id = $1
          AND owner_id = $2
          AND is_deleted = FALSE
        FOR UPDATE
        "#,
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn create_file_version_snapshot_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    file_id: Uuid,
    target: &UpdateFileContentTarget,
    created_by_user_id: Uuid,
    device_label: Option<&str>,
    action: &str,
) -> Result<FileVersionRecord, sqlx::Error> {
    sqlx::query_as::<_, FileVersionRecord>(
        r#"
        WITH next_version AS (
            SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number
            FROM file_versions
            WHERE file_id = $1
        )
        INSERT INTO file_versions (
            file_id,
            version_number,
            storage_path,
            size_bytes,
            checksum,
            encrypted_key,
            encryption_nonce,
            created_by_user_id,
            device_label,
            action
        )
        SELECT
            $1,
            next_version.version_number,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9
        FROM next_version
        RETURNING id, file_id, version_number, size_bytes, checksum, device_label, action, created_at
        "#,
    )
    .bind(file_id)
    .bind(&target.storage_path)
    .bind(target.size_bytes)
    .bind(&target.checksum)
    .bind(&target.encrypted_key)
    .bind(&target.encryption_nonce)
    .bind(created_by_user_id)
    .bind(device_label)
    .bind(action)
    .fetch_one(&mut **tx)
    .await
}

pub async fn list_user_file_versions(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
) -> Result<Vec<FileVersionRecord>, sqlx::Error> {
    sqlx::query_as::<_, FileVersionRecord>(
        r#"
        SELECT
            fv.id,
            fv.file_id,
            fv.version_number,
            fv.size_bytes,
            fv.checksum,
            fv.device_label,
            fv.action,
            fv.created_at
        FROM file_versions fv
        JOIN files f ON f.id = fv.file_id
        WHERE fv.file_id = $1
          AND f.owner_id = $2
        ORDER BY fv.version_number DESC
        "#,
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn restore_user_file_version(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
    version_id: Uuid,
    device_label: Option<&str>,
) -> Result<Option<FileRecord>, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let current = get_user_file_for_content_update_in_tx(&mut tx, user_id, file_id).await?;
    let Some(current) = current else {
        tx.commit().await?;
        return Ok(None);
    };

    let version = sqlx::query_as::<_, UpdateFileContentTarget>(
        r#"
        SELECT storage_path, size_bytes, checksum, encrypted_key, encryption_nonce
        FROM file_versions
        WHERE id = $1
          AND file_id = $2
        FOR UPDATE
        "#,
    )
    .bind(version_id)
    .bind(file_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(version) = version else {
        tx.commit().await?;
        return Ok(None);
    };

    create_file_version_snapshot_in_tx(
        &mut tx,
        file_id,
        &current,
        user_id,
        device_label,
        "restore-snapshot",
    )
    .await?;

    let restored = update_user_file_content(
        &mut tx,
        user_id,
        file_id,
        version.storage_path,
        version.size_bytes,
        version.encrypted_key,
        version.encryption_nonce,
        version.checksum,
    )
    .await?;

    tx.commit().await?;

    Ok(restored)
}

pub async fn insert_file_audit_log(
    pool: &PgPool,
    user_id: Uuid,
    action: &str,
    file_id: Uuid,
    device_label: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO audit_logs (user_id, action, resource_id, resource_type, device_label)
        VALUES ($1, $2, $3, 'file', $4)
        "#,
    )
    .bind(user_id)
    .bind(action)
    .bind(file_id)
    .bind(device_label)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn list_user_file_audit_logs(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
) -> Result<Vec<FileAuditRecord>, sqlx::Error> {
    sqlx::query_as::<_, FileAuditRecord>(
        r#"
        SELECT id, action, resource_id, resource_type, device_label, created_at
        FROM audit_logs
        WHERE user_id = $1
          AND resource_type = 'file'
          AND resource_id = $2
        ORDER BY created_at DESC
        LIMIT 100
        "#,
    )
    .bind(user_id)
    .bind(file_id)
    .fetch_all(pool)
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
    let mut tx = pool.begin().await?;

    let result = sqlx::query(
        r#"
        UPDATE files
        SET is_deleted = TRUE,
            deleted_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
          AND owner_id = $2
          AND is_deleted = FALSE
        RETURNING size_bytes
        "#,
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(row) = result else {
        tx.commit().await?;
        return Ok(0);
    };

    let size_bytes: i64 = row.try_get("size_bytes")?;
    try_apply_storage_delta(&mut tx, user_id, -size_bytes).await?;
    tx.commit().await?;

    Ok(1)
}

pub async fn restore_user_file(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let target = sqlx::query(
        r#"
        SELECT size_bytes
        FROM files
        WHERE id = $1
          AND owner_id = $2
          AND is_deleted = TRUE
        FOR UPDATE
        "#,
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(target) = target else {
        tx.commit().await?;
        return Ok(0);
    };

    let size_bytes: i64 = target.try_get("size_bytes")?;
    if !try_apply_storage_delta(&mut tx, user_id, size_bytes).await? {
        tx.commit().await?;
        return Ok(0);
    }

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
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

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

pub async fn list_file_version_storage_paths(
    pool: &PgPool,
    file_id: Uuid,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        r#"
        SELECT storage_path
        FROM file_versions
        WHERE file_id = $1
        "#,
    )
    .bind(file_id)
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
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    file_id: Uuid,
    storage_path: String,
    size_bytes: i64,
    encrypted_key: Vec<u8>,
    encryption_nonce: Vec<u8>,
    checksum: Option<String>,
) -> Result<Option<FileRecord>, sqlx::Error> {
    sqlx::query_as::<_, FileRecord>(
        r#"
        UPDATE files
        SET storage_path = $1,
            size_bytes = $2,
            encrypted_key = $3,
            encryption_nonce = $4,
            checksum = $5,
            updated_at = NOW()
        WHERE id = $6
          AND owner_id = $7
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
                WHERE fav.user_id = $7
                  AND fav.file_id = files.id
            ) AS is_favourite,
            encrypted_key,
            encryption_nonce,
            created_at,
            updated_at,
            deleted_at
        "#,
    )
    .bind(storage_path)
    .bind(size_bytes)
    .bind(encrypted_key)
    .bind(encryption_nonce)
    .bind(checksum)
    .bind(file_id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
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
        ON CONFLICT DO NOTHING
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
