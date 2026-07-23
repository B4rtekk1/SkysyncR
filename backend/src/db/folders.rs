use base64::{Engine as _, engine::general_purpose};
use chrono::{DateTime, Utc};
use serde::{Serialize, Serializer};
use sqlx::{FromRow, PgPool, Row};
use uuid::Uuid;

use super::file_records::{DownloadFileRecord, FileRecord};

fn serialize_optional_bytes_base64<S>(
    bytes: &Option<Vec<u8>>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match bytes {
        Some(bytes) => serializer.serialize_some(&general_purpose::STANDARD.encode(bytes)),
        None => serializer.serialize_none(),
    }
}

#[derive(FromRow, Serialize)]
pub struct FolderShareRecord {
    pub id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub permission: String,
    pub created_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize)]
pub struct FolderShareRecipientRecord {
    pub email: String,
    pub public_key: String,
}

#[derive(Clone, FromRow, Serialize)]
pub struct FolderRecord {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub parent_folder_id: Option<Uuid>,
    pub is_public: bool,
    pub share_token: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub is_deleted: bool,
    pub deleted_at: Option<DateTime<Utc>>,
    pub file_count: i64,
    pub is_favourite: bool,
    #[serde(serialize_with = "serialize_optional_bytes_base64")]
    pub encrypted_key: Option<Vec<u8>>,
}

pub struct NewFolderRecord {
    pub owner_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub parent_folder_id: Option<Uuid>,
    pub encrypted_key: Vec<u8>,
}

pub struct NewFolderShare {
    pub owner_id: Uuid,
    pub folder_id: Uuid,
    pub recipient_email: String,
    pub permission: String,
    pub encrypted_key: Vec<u8>,
}

pub async fn list_user_folders(
    pool: &PgPool,
    user_id: Uuid,
    parent_folder_id: Option<Uuid>,
    trashed: bool,
) -> Result<Vec<FolderRecord>, sqlx::Error> {
    sqlx::query_as::<_, FolderRecord>(
        r#"
        SELECT
            f.id,
            f.name,
            f.description,
            f.parent_folder_id,
            f.is_public,
            f.share_token,
            f.created_at,
            f.updated_at,
            f.is_deleted,
            f.deleted_at,
            COUNT(files.id)::bigint AS file_count,
            EXISTS (
                SELECT 1
                FROM favorites fav
                WHERE fav.user_id = $1
                  AND fav.folder_id = f.id
            ) AS is_favourite,
            f.encrypted_key
        FROM folders f
        LEFT JOIN files
         ON files.folder_id = f.id
         AND files.owner_id = f.owner_id
         AND files.is_deleted = f.is_deleted
        WHERE f.owner_id = $1
          AND f.is_deleted = $3
          AND (
              ($2::uuid IS NULL AND f.parent_folder_id IS NULL)
              OR f.parent_folder_id = $2
          )
        GROUP BY
            f.id,
            f.name,
            f.description,
            f.parent_folder_id,
            f.is_public,
            f.share_token,
            f.created_at,
            f.updated_at,
            f.encrypted_key
        ORDER BY f.name
        "#,
    )
    .bind(user_id)
    .bind(parent_folder_id)
    .bind(trashed)
    .fetch_all(pool)
    .await
}

pub async fn list_user_favourite_folders(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<FolderRecord>, sqlx::Error> {
    sqlx::query_as::<_, FolderRecord>(
        r#"
        SELECT
            f.id,
            f.name,
            f.description,
            f.parent_folder_id,
            f.is_public,
            f.share_token,
            f.created_at,
            f.updated_at,
            FALSE AS is_deleted,
            NULL::timestamptz AS deleted_at,
            COUNT(files.id)::bigint AS file_count,
            TRUE AS is_favourite,
            f.encrypted_key
        FROM favorites fav
        JOIN folders f ON f.id = fav.folder_id
        LEFT JOIN files
          ON files.folder_id = f.id
         AND files.owner_id = f.owner_id
         AND files.is_deleted = FALSE
        WHERE fav.user_id = $1
          AND f.owner_id = $1
          AND f.is_deleted = FALSE
        GROUP BY
            f.id,
            f.name,
            f.description,
            f.parent_folder_id,
            f.is_public,
            f.share_token,
            f.created_at,
            f.updated_at,
            f.encrypted_key
        ORDER BY f.name
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn create_folder_record(
    pool: &PgPool,
    folder: NewFolderRecord,
) -> Result<FolderRecord, sqlx::Error> {
    sqlx::query_as::<_, FolderRecord>(
        r#"
        INSERT INTO folders (
            owner_id,
            name,
            description,
            parent_folder_id,
            encrypted_key
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
            id,
            name,
            description,
            parent_folder_id,
            is_public,
            share_token,
            created_at,
            updated_at,
            FALSE AS is_deleted,
            NULL::timestamptz AS deleted_at,
            0::bigint AS file_count,
            FALSE AS is_favourite,
            encrypted_key
        "#,
    )
    .bind(folder.owner_id)
    .bind(folder.name)
    .bind(folder.description)
    .bind(folder.parent_folder_id)
    .bind(folder.encrypted_key)
    .fetch_one(pool)
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
              AND is_deleted = FALSE
        )
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(exists)
}

pub async fn update_user_folder_share(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Uuid,
    is_public: bool,
    share_token: Option<String>,
) -> Result<Option<FolderRecord>, sqlx::Error> {
    sqlx::query_as::<_, FolderRecord>(
        r#"
        UPDATE folders
        SET is_public = $1,
            share_token = $2,
            updated_at = NOW()
        WHERE id = $3
          AND owner_id = $4
          AND is_deleted = FALSE
        RETURNING
            id,
            name,
            description,
            parent_folder_id,
            is_public,
            share_token,
            created_at,
            updated_at,
            is_deleted,
            deleted_at,
            (
                SELECT COUNT(files.id)::bigint
                FROM files
                WHERE files.folder_id = folders.id
                  AND files.owner_id = folders.owner_id
                  AND files.is_deleted = FALSE
            ) AS file_count,
            EXISTS (
                SELECT 1
                FROM favorites fav
                WHERE fav.user_id = $4
                  AND fav.folder_id = folders.id
            ) AS is_favourite,
            encrypted_key
        "#,
    )
    .bind(is_public)
    .bind(share_token)
    .bind(folder_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn get_public_folder_tree(
    pool: &PgPool,
    share_token: &str,
) -> Result<Vec<FolderRecord>, sqlx::Error> {
    sqlx::query_as::<_, FolderRecord>(
        r#"
        WITH RECURSIVE folder_tree AS (
            SELECT id
            FROM folders
            WHERE share_token = $1
              AND is_public = TRUE
              AND is_deleted = FALSE

            UNION ALL

            SELECT child.id
            FROM folders child
            JOIN folder_tree ft ON child.parent_folder_id = ft.id
            WHERE child.owner_id = (
                SELECT owner_id
                FROM folders
                WHERE share_token = $1
                  AND is_public = TRUE
                  AND is_deleted = FALSE
                LIMIT 1
            )
              AND child.is_deleted = FALSE
        )
        SELECT
            f.id,
            f.name,
            f.description,
            f.parent_folder_id,
            f.is_public,
            f.share_token,
            f.created_at,
            f.updated_at,
            f.is_deleted,
            f.deleted_at,
            (
                SELECT COUNT(files.id)::bigint
                FROM files
                WHERE files.folder_id = f.id
                  AND files.owner_id = f.owner_id
                  AND files.is_deleted = FALSE
            ) AS file_count,
            FALSE AS is_favourite,
            f.encrypted_key
        FROM folders f
        JOIN folder_tree ft ON ft.id = f.id
        ORDER BY f.created_at
        "#,
    )
    .bind(share_token)
    .fetch_all(pool)
    .await
}

pub async fn list_public_folder_tree_files(
    pool: &PgPool,
    share_token: &str,
) -> Result<Vec<FileRecord>, sqlx::Error> {
    sqlx::query_as::<_, FileRecord>(
        r#"
        WITH RECURSIVE folder_tree AS (
            SELECT id, owner_id
            FROM folders
            WHERE share_token = $1
              AND is_public = TRUE
              AND is_deleted = FALSE

            UNION ALL

            SELECT child.id, child.owner_id
            FROM folders child
            JOIN folder_tree ft ON child.parent_folder_id = ft.id
            WHERE child.owner_id = ft.owner_id
              AND child.is_deleted = FALSE
        )
        SELECT
            files.id,
            files.filename,
            ''::text AS storage_path,
            files.mime_type,
            files.size_bytes,
            files.folder_id,
            files.note,
            files.is_deleted,
            files.is_public,
            files.share_token,
            files.share_expires_at,
            files.share_download_limit,
            files.share_download_count,
            FALSE AS is_favourite,
            files.encrypted_key,
            files.encryption_nonce,
            files.created_at,
            files.updated_at,
            files.deleted_at
        FROM files
        JOIN folder_tree ft ON ft.id = files.folder_id
        WHERE files.owner_id = ft.owner_id
          AND files.is_deleted = FALSE
        ORDER BY files.updated_at DESC
        "#,
    )
    .bind(share_token)
    .fetch_all(pool)
    .await
}

pub async fn get_public_folder_file_for_download(
    pool: &PgPool,
    share_token: &str,
    file_id: Uuid,
) -> Result<Option<DownloadFileRecord>, sqlx::Error> {
    sqlx::query_as::<_, DownloadFileRecord>(
        r#"
        WITH RECURSIVE folder_tree AS (
            SELECT id, owner_id
            FROM folders
            WHERE share_token = $1
              AND is_public = TRUE
              AND is_deleted = FALSE

            UNION ALL

            SELECT child.id, child.owner_id
            FROM folders child
            JOIN folder_tree ft ON child.parent_folder_id = ft.id
            WHERE child.owner_id = ft.owner_id
              AND child.is_deleted = FALSE
        )
        SELECT filename, mime_type, storage_path, size_bytes, checksum, encryption_nonce
        FROM files
        JOIN folder_tree ft ON ft.id = files.folder_id
        WHERE files.id = $2
          AND files.owner_id = ft.owner_id
          AND files.is_deleted = FALSE
        "#,
    )
    .bind(share_token)
    .bind(file_id)
    .fetch_optional(pool)
    .await
}

pub async fn get_folder_share_recipient(
    pool: &PgPool,
    owner_id: Uuid,
    folder_id: Uuid,
    email: &str,
) -> Result<Option<FolderShareRecipientRecord>, sqlx::Error> {
    sqlx::query_as::<_, FolderShareRecipientRecord>(
        r#"
        SELECT recipient.email, recipient.public_key
        FROM folders f
        JOIN users recipient ON recipient.email = $3
        WHERE f.id = $1
          AND f.owner_id = $2
          AND f.is_deleted = FALSE
          AND recipient.is_active = TRUE
          AND recipient.public_key IS NOT NULL
          AND recipient.id <> $2
        "#,
    )
    .bind(folder_id)
    .bind(owner_id)
    .bind(email)
    .fetch_optional(pool)
    .await
}

pub async fn list_user_folder_shares(
    pool: &PgPool,
    owner_id: Uuid,
    folder_id: Uuid,
) -> Result<Vec<FolderShareRecord>, sqlx::Error> {
    sqlx::query_as::<_, FolderShareRecord>(
        r#"
        SELECT
            fs.id,
            recipient.email,
            recipient.display_name,
            fs.permission,
            fs.created_at
        FROM folder_shares fs
        JOIN folders f ON f.id = fs.folder_id
        JOIN users recipient ON recipient.id = fs.recipient_user_id
        WHERE fs.folder_id = $1
          AND fs.owner_id = $2
          AND f.owner_id = $2
          AND f.is_deleted = FALSE
        ORDER BY fs.created_at DESC
        "#,
    )
    .bind(folder_id)
    .bind(owner_id)
    .fetch_all(pool)
    .await
}

pub async fn upsert_user_folder_share(
    pool: &PgPool,
    share: NewFolderShare,
) -> Result<Option<FolderShareRecord>, sqlx::Error> {
    sqlx::query_as::<_, FolderShareRecord>(
        r#"
        WITH target AS (
            SELECT f.id AS folder_id, recipient.id AS recipient_user_id
            FROM folders f
            JOIN users recipient ON recipient.email = $3
            WHERE f.id = $2
              AND f.owner_id = $1
              AND f.is_deleted = FALSE
              AND recipient.is_active = TRUE
              AND recipient.id <> $1
        ),
        upserted AS (
            INSERT INTO folder_shares (
                folder_id,
                owner_id,
                recipient_user_id,
                permission,
                encrypted_key
            )
            SELECT folder_id, $1, recipient_user_id, $4, $5
            FROM target
            ON CONFLICT (folder_id, recipient_user_id)
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
    .bind(share.folder_id)
    .bind(share.recipient_email)
    .bind(share.permission)
    .bind(share.encrypted_key)
    .fetch_optional(pool)
    .await
}

pub async fn delete_user_folder_share(
    pool: &PgPool,
    owner_id: Uuid,
    folder_id: Uuid,
    share_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        DELETE FROM folder_shares
        WHERE id = $1
          AND folder_id = $2
          AND owner_id = $3
        "#,
    )
    .bind(share_id)
    .bind(folder_id)
    .bind(owner_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn rename_user_folder(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Uuid,
    name: String,
    description: Option<String>,
) -> Result<Option<FolderRecord>, sqlx::Error> {
    sqlx::query_as::<_, FolderRecord>(
        r#"
        UPDATE folders
        SET name = $1,
            description = $2,
            updated_at = NOW()
        WHERE id = $3
          AND owner_id = $4
          AND is_deleted = FALSE
        RETURNING
            id,
            name,
            description,
            parent_folder_id,
            is_public,
            share_token,
            created_at,
            updated_at,
            is_deleted,
            deleted_at,
            (
                SELECT COUNT(files.id)::bigint
                FROM files
                WHERE files.folder_id = folders.id
                  AND files.owner_id = folders.owner_id
                  AND files.is_deleted = FALSE
            ) AS file_count,
            EXISTS (
                SELECT 1
                FROM favorites fav
                WHERE fav.user_id = $4
                  AND fav.folder_id = folders.id
            ) AS is_favourite,
            encrypted_key
        "#,
    )
    .bind(name)
    .bind(description)
    .bind(folder_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn move_user_folder(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Uuid,
    parent_folder_id: Option<Uuid>,
) -> Result<Option<FolderRecord>, sqlx::Error> {
    sqlx::query_as::<_, FolderRecord>(
        r#"
        UPDATE folders
        SET parent_folder_id = $1,
            updated_at = NOW()
        WHERE id = $2
          AND owner_id = $3
          AND is_deleted = FALSE
        RETURNING
            id,
            name,
            description,
            parent_folder_id,
            is_public,
            share_token,
            created_at,
            updated_at,
            is_deleted,
            deleted_at,
            (
                SELECT COUNT(files.id)::bigint
                FROM files
                WHERE files.folder_id = folders.id
                  AND files.owner_id = folders.owner_id
                  AND files.is_deleted = FALSE
            ) AS file_count,
            EXISTS (
                SELECT 1
                FROM favorites fav
                WHERE fav.user_id = $3
                  AND fav.folder_id = folders.id
            ) AS is_favourite,
            encrypted_key
        "#,
    )
    .bind(parent_folder_id)
    .bind(folder_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn folder_is_descendant_of(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Uuid,
    possible_ancestor_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let exists = sqlx::query_scalar::<_, bool>(
        r#"
        WITH RECURSIVE folder_tree AS (
            SELECT id, parent_folder_id
            FROM folders
            WHERE id = $1
              AND owner_id = $2
              AND is_deleted = FALSE

            UNION ALL

            SELECT f.id, f.parent_folder_id
            FROM folders f
            JOIN folder_tree ft ON f.id = ft.parent_folder_id
            WHERE f.owner_id = $2
              AND f.is_deleted = FALSE
        )
        SELECT EXISTS (
            SELECT 1
            FROM folder_tree
            WHERE id = $3
        )
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .bind(possible_ancestor_id)
    .fetch_one(pool)
    .await?;

    Ok(exists)
}

pub async fn user_folder_exists(
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
              AND is_deleted = FALSE
        )
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(exists)
}

pub async fn add_user_folder_favourite(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO favorites (user_id, folder_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(user_id)
    .bind(folder_id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn remove_user_folder_favourite(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        DELETE FROM favorites
        WHERE user_id = $1
          AND folder_id = $2
        "#,
    )
    .bind(user_id)
    .bind(folder_id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn soft_delete_user_folder(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let row = sqlx::query(
        r#"
        WITH RECURSIVE folder_tree AS (
            SELECT id
            FROM folders
            WHERE id = $1
              AND owner_id = $2
              AND is_deleted = FALSE

            UNION ALL

            SELECT f.id
            FROM folders f
            JOIN folder_tree ft ON f.parent_folder_id = ft.id
            WHERE f.owner_id = $2
              AND f.is_deleted = FALSE
        ),
        updated_folders AS (
            UPDATE folders
            SET is_deleted = TRUE,
                deleted_at = NOW(),
                updated_at = NOW()
            WHERE owner_id = $2
              AND id IN (SELECT id FROM folder_tree)
              AND is_deleted = FALSE
            RETURNING id
        ),
        updated_files AS (
            UPDATE files
            SET is_deleted = TRUE,
                deleted_at = NOW(),
                updated_at = NOW()
            WHERE owner_id = $2
              AND folder_id IN (SELECT id FROM folder_tree)
              AND is_deleted = FALSE
            RETURNING size_bytes
        )
        SELECT
            (SELECT COUNT(*)::bigint FROM updated_folders) AS folder_count,
            COALESCE((SELECT SUM(size_bytes)::bigint FROM updated_files), 0)::bigint AS file_bytes
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;

    let folder_count: i64 = row.try_get("folder_count")?;
    let file_bytes: i64 = row.try_get("file_bytes")?;
    if file_bytes > 0 {
        super::storage::try_apply_storage_delta(&mut tx, user_id, -file_bytes).await?;
    }

    tx.commit().await?;
    Ok(folder_count as u64)
}

pub async fn restore_user_folder(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let target = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM folders
            WHERE id = $1
              AND owner_id = $2
              AND is_deleted = TRUE
        )
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;

    if !target {
        tx.commit().await?;
        return Ok(0);
    }

    let file_bytes = sqlx::query_scalar::<_, i64>(
        r#"
        WITH RECURSIVE folder_tree AS (
            SELECT id
            FROM folders
            WHERE id = $1
              AND owner_id = $2
              AND is_deleted = TRUE

            UNION ALL

            SELECT f.id
            FROM folders f
            JOIN folder_tree ft ON f.parent_folder_id = ft.id
            WHERE f.owner_id = $2
              AND f.is_deleted = TRUE
        )
        SELECT COALESCE(SUM(size_bytes), 0)::bigint
        FROM files
        WHERE owner_id = $2
          AND folder_id IN (SELECT id FROM folder_tree)
          AND is_deleted = TRUE
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;

    if file_bytes > 0
        && !super::storage::try_apply_storage_delta(&mut tx, user_id, file_bytes).await?
    {
        tx.commit().await?;
        return Ok(0);
    }

    let row = sqlx::query(
        r#"
        WITH RECURSIVE folder_tree AS (
            SELECT id
            FROM folders
            WHERE id = $1
              AND owner_id = $2
              AND is_deleted = TRUE

            UNION ALL

            SELECT f.id
            FROM folders f
            JOIN folder_tree ft ON f.parent_folder_id = ft.id
            WHERE f.owner_id = $2
              AND f.is_deleted = TRUE
        ),
        updated_folders AS (
            UPDATE folders
            SET is_deleted = FALSE,
                deleted_at = NULL,
                updated_at = NOW()
            WHERE owner_id = $2
              AND id IN (SELECT id FROM folder_tree)
              AND is_deleted = TRUE
            RETURNING id
        ),
        updated_files AS (
            UPDATE files
            SET is_deleted = FALSE,
                deleted_at = NULL,
                updated_at = NOW()
            WHERE owner_id = $2
              AND folder_id IN (SELECT id FROM folder_tree)
              AND is_deleted = TRUE
            RETURNING id
        )
        SELECT (SELECT COUNT(*)::bigint FROM updated_folders) AS folder_count
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;

    let folder_count: i64 = row.try_get("folder_count")?;
    tx.commit().await?;
    Ok(folder_count as u64)
}

pub async fn list_deleted_folder_file_targets(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Uuid,
) -> Result<Vec<super::files::FilePurgeTarget>, sqlx::Error> {
    sqlx::query_as::<_, super::files::FilePurgeTarget>(
        r#"
        WITH RECURSIVE folder_tree AS (
            SELECT id
            FROM folders
            WHERE id = $1
              AND owner_id = $2
              AND is_deleted = TRUE

            UNION ALL

            SELECT f.id
            FROM folders f
            JOIN folder_tree ft ON f.parent_folder_id = ft.id
            WHERE f.owner_id = $2
              AND f.is_deleted = TRUE
        )
        SELECT id, storage_path
        FROM files
        WHERE owner_id = $2
          AND folder_id IN (SELECT id FROM folder_tree)
          AND is_deleted = TRUE
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn hard_delete_folder_tree(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        WITH RECURSIVE folder_tree AS (
            SELECT id
            FROM folders
            WHERE id = $1
              AND owner_id = $2
              AND is_deleted = TRUE

            UNION ALL

            SELECT f.id
            FROM folders f
            JOIN folder_tree ft ON f.parent_folder_id = ft.id
            WHERE f.owner_id = $2
              AND f.is_deleted = TRUE
        )
        DELETE FROM folders
        WHERE owner_id = $2
          AND id IN (SELECT id FROM folder_tree)
          AND is_deleted = TRUE
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}
