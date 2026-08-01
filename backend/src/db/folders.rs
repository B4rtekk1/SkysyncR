use base64::{Engine as _, engine::general_purpose};
use chrono::{DateTime, Utc};
use serde::{Serialize, Serializer};
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder, Row, Transaction};
use uuid::Uuid;

use super::audit_logs::{NewAuditLog, insert_user_audit_log};
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
    #[serde(skip_serializing)]
    pub recipient_user_id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub public_key: String,
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
    pub share_starts_at: Option<DateTime<Utc>>,
    pub share_expires_at: Option<DateTime<Utc>>,
    pub share_download_limit: Option<i32>,
    pub share_download_count: i32,
    pub share_one_time: bool,
    pub share_password_enabled: bool,
    pub share_recipient_email: Option<String>,
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

pub struct NewFolderGroupShare {
    pub owner_id: Uuid,
    pub folder_id: Uuid,
    pub group_id: Uuid,
    pub permission: String,
    pub actor_user_id: Uuid,
}

#[derive(FromRow, Serialize)]
pub struct FolderGroupShareRecord {
    pub id: Uuid,
    pub folder_id: Uuid,
    pub group_id: Uuid,
    pub group_name: String,
    pub permission: String,
    pub created_by_email: Option<String>,
    pub updated_by_email: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize)]
pub struct FolderGroupShareEventRecord {
    pub id: Uuid,
    pub folder_id: Uuid,
    pub group_id: Option<Uuid>,
    pub group_name: Option<String>,
    pub actor_email: Option<String>,
    pub action: String,
    pub previous_permission: Option<String>,
    pub new_permission: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub struct FolderListPageCursor {
    pub name: String,
    pub id: Uuid,
}

pub struct FolderListPageOptions {
    pub limit: i64,
    pub cursor: Option<FolderListPageCursor>,
    pub search: Option<String>,
}

#[derive(FromRow)]
struct PublicFolderShareAccessRow {
    id: Uuid,
    share_one_time: bool,
    share_password_hash: Option<String>,
    share_recipient_email: Option<String>,
}

#[derive(FromRow, Serialize)]
pub struct PublicFolderShareAccessRecord {
    pub id: Uuid,
    pub folder_id: Uuid,
    pub file_id: Option<Uuid>,
    pub share_token: String,
    pub recipient_email: Option<String>,
    pub user_agent: Option<String>,
    pub accessed_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct FolderPointRestoreResult {
    pub restored_at: DateTime<Utc>,
    pub folder_count: i64,
    pub file_count: i64,
    pub deleted_folder_count: i64,
    pub deleted_file_count: i64,
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
            f.share_starts_at,
            f.share_expires_at,
            f.share_download_limit,
            f.share_download_count,
            f.share_one_time,
            (f.share_password_hash IS NOT NULL) AS share_password_enabled,
            f.share_recipient_email,
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
            f.share_starts_at,
            f.share_expires_at,
            f.share_download_limit,
            f.share_download_count,
            f.share_one_time,
            f.share_password_hash,
            f.share_recipient_email,
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

pub async fn list_user_folders_page(
    pool: &PgPool,
    user_id: Uuid,
    parent_folder_id: Option<Uuid>,
    trashed: bool,
    options: FolderListPageOptions,
) -> Result<(Vec<FolderRecord>, bool), sqlx::Error> {
    let fetch_limit = options.limit + 1;
    let mut query_builder = folder_page_query(user_id);
    query_builder.push(" WHERE f.owner_id = ");
    query_builder.push_bind(user_id);
    query_builder.push(" AND f.is_deleted = ");
    query_builder.push_bind(trashed);
    query_builder.push(" AND ((");
    query_builder.push_bind(parent_folder_id);
    query_builder.push("::uuid IS NULL AND f.parent_folder_id IS NULL) OR f.parent_folder_id = ");
    query_builder.push_bind(parent_folder_id);
    query_builder.push(")");
    append_folder_page_filters(&mut query_builder, options, fetch_limit);
    fetch_folder_page(pool, query_builder, fetch_limit).await
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
            f.share_starts_at,
            f.share_expires_at,
            f.share_download_limit,
            f.share_download_count,
            f.share_one_time,
            (f.share_password_hash IS NOT NULL) AS share_password_enabled,
            f.share_recipient_email,
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
            f.share_starts_at,
            f.share_expires_at,
            f.share_download_limit,
            f.share_download_count,
            f.share_one_time,
            f.share_password_hash,
            f.share_recipient_email,
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

pub async fn list_user_favourite_folders_page(
    pool: &PgPool,
    user_id: Uuid,
    options: FolderListPageOptions,
) -> Result<(Vec<FolderRecord>, bool), sqlx::Error> {
    let fetch_limit = options.limit + 1;
    let mut query_builder = folder_page_query(user_id);
    query_builder.push(
        r#"
        JOIN favorites fav_match ON fav_match.folder_id = f.id AND fav_match.user_id = "#,
    );
    query_builder.push_bind(user_id);
    query_builder.push(" WHERE f.owner_id = ");
    query_builder.push_bind(user_id);
    query_builder.push(" AND f.is_deleted = FALSE");
    append_folder_page_filters(&mut query_builder, options, fetch_limit);
    fetch_folder_page(pool, query_builder, fetch_limit).await
}

fn folder_page_query(user_id: Uuid) -> QueryBuilder<Postgres> {
    let mut query_builder = QueryBuilder::<Postgres>::new(
        r#"
        SELECT
            f.id,
            f.name,
            f.description,
            f.parent_folder_id,
            f.is_public,
            f.share_token,
            f.share_starts_at,
            f.share_expires_at,
            f.share_download_limit,
            f.share_download_count,
            f.share_one_time,
            (f.share_password_hash IS NOT NULL) AS share_password_enabled,
            f.share_recipient_email,
            f.created_at,
            f.updated_at,
            f.is_deleted,
            f.deleted_at,
            COUNT(files.id)::bigint AS file_count,
            EXISTS (
                SELECT 1
                FROM favorites fav
                WHERE fav.user_id = "#,
    );
    query_builder.push_bind(user_id);
    query_builder.push(
        r#"
                  AND fav.folder_id = f.id
            ) AS is_favourite,
            f.encrypted_key
        FROM folders f
        LEFT JOIN files
          ON files.folder_id = f.id
         AND files.owner_id = f.owner_id
         AND files.is_deleted = f.is_deleted
        "#,
    );
    query_builder
}

fn append_folder_page_filters(
    query_builder: &mut QueryBuilder<Postgres>,
    options: FolderListPageOptions,
    limit: i64,
) {
    if let Some(search) = options.search.as_deref() {
        query_builder.push(" AND (f.name ILIKE ");
        query_builder.push_bind(format!("%{search}%"));
        query_builder.push(" OR f.description ILIKE ");
        query_builder.push_bind(format!("%{search}%"));
        query_builder.push(")");
    }

    if let Some(cursor) = options.cursor {
        query_builder.push(" AND (f.name, f.id) > (");
        query_builder.push_bind(cursor.name);
        query_builder.push(", ");
        query_builder.push_bind(cursor.id);
        query_builder.push(")");
    }

    query_builder.push(
        r#"
        GROUP BY
            f.id,
            f.name,
            f.description,
            f.parent_folder_id,
            f.is_public,
            f.share_token,
            f.share_starts_at,
            f.share_expires_at,
            f.share_download_limit,
            f.share_download_count,
            f.share_one_time,
            f.share_password_hash,
            f.share_recipient_email,
            f.created_at,
            f.updated_at,
            f.encrypted_key
        ORDER BY f.name ASC, f.id ASC
        LIMIT "#,
    );
    query_builder.push_bind(limit);
}

async fn fetch_folder_page(
    pool: &PgPool,
    mut query_builder: QueryBuilder<Postgres>,
    fetch_limit: i64,
) -> Result<(Vec<FolderRecord>, bool), sqlx::Error> {
    let page_limit = fetch_limit - 1;
    let mut rows = query_builder
        .build_query_as::<FolderRecord>()
        .fetch_all(pool)
        .await?;
    let has_more = rows.len() > page_limit as usize;
    if has_more {
        rows.truncate(page_limit as usize);
    }
    Ok((rows, has_more))
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
            NULL::timestamptz AS share_starts_at,
            NULL::timestamptz AS share_expires_at,
            NULL::int AS share_download_limit,
            0 AS share_download_count,
            FALSE AS share_one_time,
            FALSE AS share_password_enabled,
            NULL::text AS share_recipient_email,
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
    share_starts_at: Option<DateTime<Utc>>,
    share_expires_at: Option<DateTime<Utc>>,
    share_download_limit: Option<i32>,
    share_one_time: bool,
    update_share_password: bool,
    share_password_hash: Option<String>,
    share_recipient_email: Option<String>,
) -> Result<Option<FolderRecord>, sqlx::Error> {
    sqlx::query_as::<_, FolderRecord>(
        r#"
        UPDATE folders
        SET is_public = $1,
            share_token = $2,
            share_starts_at = $3,
            share_expires_at = $4,
            share_download_limit = $5,
            share_one_time = $6,
            share_password_hash = CASE
                WHEN $1 = FALSE THEN NULL
                WHEN $7 = TRUE THEN $8
                ELSE share_password_hash
            END,
            share_recipient_email = $9,
            share_download_count = 0,
            updated_at = NOW()
        WHERE id = $10
          AND owner_id = $11
          AND is_deleted = FALSE
        RETURNING
            id,
            name,
            description,
            parent_folder_id,
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
                WHERE fav.user_id = $11
                  AND fav.folder_id = folders.id
            ) AS is_favourite,
            encrypted_key
        "#,
    )
    .bind(is_public)
    .bind(share_token)
    .bind(share_starts_at)
    .bind(share_expires_at)
    .bind(share_download_limit)
    .bind(share_one_time)
    .bind(update_share_password)
    .bind(share_password_hash)
    .bind(share_recipient_email)
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
            f.share_starts_at,
            f.share_expires_at,
            f.share_download_limit,
            f.share_download_count,
            f.share_one_time,
            (f.share_password_hash IS NOT NULL) AS share_password_enabled,
            f.share_recipient_email,
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

pub async fn public_folder_share_access_allowed(
    pool: &PgPool,
    share_token: &str,
    password: Option<&str>,
    recipient_email: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let row = sqlx::query_as::<_, PublicFolderShareAccessRow>(
        r#"
        SELECT
            id,
            share_one_time,
            share_password_hash,
            share_recipient_email
        FROM folders
        WHERE share_token = $1
          AND is_public = TRUE
          AND is_deleted = FALSE
          AND (share_starts_at IS NULL OR share_starts_at <= NOW())
          AND (share_expires_at IS NULL OR share_expires_at > NOW())
          AND (
              share_download_limit IS NULL
              OR share_download_count < share_download_limit
          )
        "#,
    )
    .bind(share_token)
    .fetch_optional(pool)
    .await?;

    Ok(row.is_some_and(|row| public_folder_share_row_matches(&row, password, recipient_email)))
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
            files.share_starts_at,
            files.share_expires_at,
            files.share_download_limit,
            files.share_download_count,
            files.share_one_time,
            (files.share_password_hash IS NOT NULL) AS share_password_enabled,
            files.share_recipient_email,
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
    password: Option<&str>,
    recipient_email: Option<&str>,
    user_agent: Option<&str>,
) -> Result<Option<DownloadFileRecord>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let share_row = sqlx::query_as::<_, PublicFolderShareAccessRow>(
        r#"
        SELECT
            id,
            share_one_time,
            share_password_hash,
            share_recipient_email
        FROM folders
        WHERE share_token = $1
          AND is_public = TRUE
          AND is_deleted = FALSE
          AND (share_starts_at IS NULL OR share_starts_at <= NOW())
          AND (share_expires_at IS NULL OR share_expires_at > NOW())
          AND (
              share_download_limit IS NULL
              OR share_download_count < share_download_limit
          )
        FOR UPDATE
        "#,
    )
    .bind(share_token)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(share_row) = share_row else {
        tx.commit().await?;
        return Ok(None);
    };
    if !public_folder_share_row_matches(&share_row, password, recipient_email) {
        tx.rollback().await?;
        return Ok(None);
    }

    let file = sqlx::query_as::<_, DownloadFileRecord>(
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
    .fetch_optional(&mut *tx)
    .await?;

    if file.is_some() {
        sqlx::query(
            r#"
            INSERT INTO public_folder_share_access_events (
                id,
                folder_id,
                file_id,
                share_token,
                recipient_email,
                user_agent
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(share_row.id)
        .bind(file_id)
        .bind(share_token)
        .bind(recipient_email)
        .bind(user_agent)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            r#"
            UPDATE folders
            SET share_download_count = share_download_count + 1,
                is_public = CASE WHEN $2 THEN FALSE ELSE is_public END,
                share_token = CASE WHEN $2 THEN NULL ELSE share_token END,
                updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(share_row.id)
        .bind(share_row.share_one_time)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(file)
}

pub async fn list_public_folder_share_access_events(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Uuid,
) -> Result<Vec<PublicFolderShareAccessRecord>, sqlx::Error> {
    sqlx::query_as::<_, PublicFolderShareAccessRecord>(
        r#"
        SELECT
            events.id,
            events.folder_id,
            events.file_id,
            events.share_token,
            events.recipient_email,
            events.user_agent,
            events.accessed_at
        FROM public_folder_share_access_events events
        JOIN folders ON folders.id = events.folder_id
        WHERE events.folder_id = $1
          AND folders.owner_id = $2
        ORDER BY events.accessed_at DESC
        LIMIT 100
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
}

fn public_folder_share_row_matches(
    row: &PublicFolderShareAccessRow,
    password: Option<&str>,
    recipient_email: Option<&str>,
) -> bool {
    if let Some(expected_email) = row.share_recipient_email.as_deref() {
        let Some(provided_email) = recipient_email else {
            return false;
        };
        if provided_email.trim().to_lowercase() != expected_email {
            return false;
        }
    }

    if let Some(password_hash) = row.share_password_hash.as_deref() {
        let Some(provided_password) = password else {
            return false;
        };
        if !bcrypt::verify(provided_password, password_hash).unwrap_or(false) {
            return false;
        }
    }

    true
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
            fs.recipient_user_id,
            recipient.email,
            recipient.display_name,
            recipient.public_key,
            fs.permission,
            fs.created_at
        FROM folder_shares fs
        JOIN folders f ON f.id = fs.folder_id
        JOIN users recipient ON recipient.id = fs.recipient_user_id
        WHERE fs.folder_id = $1
          AND fs.owner_id = $2
          AND f.owner_id = $2
          AND f.is_deleted = FALSE
          AND recipient.public_key IS NOT NULL
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
              AND recipient.public_key IS NOT NULL
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
            upserted.recipient_user_id,
            recipient.email,
            recipient.display_name,
            recipient.public_key,
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

pub async fn list_user_folder_group_shares(
    pool: &PgPool,
    owner_id: Uuid,
    folder_id: Uuid,
) -> Result<Vec<FolderGroupShareRecord>, sqlx::Error> {
    sqlx::query_as::<_, FolderGroupShareRecord>(
        r#"
        SELECT
            fgs.id,
            fgs.folder_id,
            fgs.group_id,
            groups.name AS group_name,
            fgs.permission,
            creator.email AS created_by_email,
            updater.email AS updated_by_email,
            fgs.created_at,
            fgs.updated_at
        FROM folder_group_shares fgs
        JOIN folders f ON f.id = fgs.folder_id
        JOIN groups ON groups.id = fgs.group_id
        LEFT JOIN users creator ON creator.id = fgs.created_by_user_id
        LEFT JOIN users updater ON updater.id = fgs.updated_by_user_id
        WHERE fgs.folder_id = $1
          AND fgs.owner_id = $2
          AND f.owner_id = $2
          AND f.is_deleted = FALSE
        ORDER BY fgs.updated_at DESC
        "#,
    )
    .bind(folder_id)
    .bind(owner_id)
    .fetch_all(pool)
    .await
}

pub async fn upsert_user_folder_group_share(
    pool: &PgPool,
    share: NewFolderGroupShare,
) -> Result<Option<FolderGroupShareRecord>, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let previous_permission = sqlx::query_scalar::<_, String>(
        r#"
        SELECT fgs.permission
        FROM folder_group_shares fgs
        JOIN folders f ON f.id = fgs.folder_id
        JOIN groups g ON g.id = fgs.group_id
        WHERE fgs.folder_id = $1
          AND fgs.group_id = $2
          AND fgs.owner_id = $3
          AND f.owner_id = $3
          AND g.owner_id = $3
          AND f.is_deleted = FALSE
        "#,
    )
    .bind(share.folder_id)
    .bind(share.group_id)
    .bind(share.owner_id)
    .fetch_optional(&mut *tx)
    .await?;

    let row = sqlx::query_as::<_, FolderGroupShareRecord>(
        r#"
        WITH target AS (
            SELECT f.id AS folder_id, g.id AS group_id
            FROM folders f
            JOIN groups g ON g.id = $3
            WHERE f.id = $2
              AND f.owner_id = $1
              AND g.owner_id = $1
              AND f.is_deleted = FALSE
        ),
        upserted AS (
            INSERT INTO folder_group_shares (
                folder_id,
                owner_id,
                group_id,
                permission,
                created_by_user_id,
                updated_by_user_id
            )
            SELECT folder_id, $1, group_id, $4, $5, $5
            FROM target
            ON CONFLICT (folder_id, group_id)
            DO UPDATE SET
                permission = EXCLUDED.permission,
                updated_by_user_id = EXCLUDED.updated_by_user_id,
                updated_at = NOW()
            RETURNING *
        )
        SELECT
            upserted.id,
            upserted.folder_id,
            upserted.group_id,
            groups.name AS group_name,
            upserted.permission,
            creator.email AS created_by_email,
            updater.email AS updated_by_email,
            upserted.created_at,
            upserted.updated_at
        FROM upserted
        JOIN groups ON groups.id = upserted.group_id
        LEFT JOIN users creator ON creator.id = upserted.created_by_user_id
        LEFT JOIN users updater ON updater.id = upserted.updated_by_user_id
        "#,
    )
    .bind(share.owner_id)
    .bind(share.folder_id)
    .bind(share.group_id)
    .bind(&share.permission)
    .bind(share.actor_user_id)
    .fetch_optional(&mut *tx)
    .await?;

    if row.is_some() {
        sqlx::query(
            r#"
            INSERT INTO folder_group_share_events (
                folder_id,
                group_id,
                actor_user_id,
                action,
                previous_permission,
                new_permission
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(share.folder_id)
        .bind(share.group_id)
        .bind(share.actor_user_id)
        .bind(if previous_permission.is_some() {
            "update"
        } else {
            "grant"
        })
        .bind(previous_permission)
        .bind(&share.permission)
        .execute(&mut *tx)
        .await?;

        let person_permission = folder_group_permission_to_person_permission(&share.permission);
        sqlx::query(
            r#"
            UPDATE folder_shares fs
            SET permission = $4,
                updated_at = NOW()
            FROM group_members gm
            WHERE fs.folder_id = $1
              AND fs.owner_id = $2
              AND gm.group_id = $3
              AND gm.user_id = fs.recipient_user_id
            "#,
        )
        .bind(share.folder_id)
        .bind(share.owner_id)
        .bind(share.group_id)
        .bind(person_permission)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(row)
}

pub async fn delete_user_folder_group_share(
    pool: &PgPool,
    owner_id: Uuid,
    folder_id: Uuid,
    group_share_id: Uuid,
    actor_user_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let removed = sqlx::query_as::<_, (Uuid, String)>(
        r#"
        DELETE FROM folder_group_shares
        WHERE id = $1
          AND folder_id = $2
          AND owner_id = $3
        RETURNING group_id, permission
        "#,
    )
    .bind(group_share_id)
    .bind(folder_id)
    .bind(owner_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some((group_id, previous_permission)) = removed else {
        tx.commit().await?;
        return Ok(0);
    };

    sqlx::query(
        r#"
        INSERT INTO folder_group_share_events (
            folder_id,
            group_id,
            actor_user_id,
            action,
            previous_permission,
            new_permission
        )
        VALUES ($1, $2, $3, 'revoke', $4, NULL)
        "#,
    )
    .bind(folder_id)
    .bind(group_id)
    .bind(actor_user_id)
    .bind(previous_permission)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        DELETE FROM folder_shares fs
        USING group_members gm
        WHERE fs.folder_id = $1
          AND fs.owner_id = $2
          AND gm.group_id = $3
          AND gm.user_id = fs.recipient_user_id
        "#,
    )
    .bind(folder_id)
    .bind(owner_id)
    .bind(group_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(1)
}

pub async fn list_user_folder_group_share_events(
    pool: &PgPool,
    owner_id: Uuid,
    folder_id: Uuid,
) -> Result<Vec<FolderGroupShareEventRecord>, sqlx::Error> {
    sqlx::query_as::<_, FolderGroupShareEventRecord>(
        r#"
        SELECT
            events.id,
            events.folder_id,
            events.group_id,
            groups.name AS group_name,
            actor.email AS actor_email,
            events.action,
            events.previous_permission,
            events.new_permission,
            events.created_at
        FROM folder_group_share_events events
        JOIN folders f ON f.id = events.folder_id
        LEFT JOIN groups ON groups.id = events.group_id
        LEFT JOIN users actor ON actor.id = events.actor_user_id
        WHERE events.folder_id = $1
          AND f.owner_id = $2
        ORDER BY events.created_at DESC
        LIMIT 100
        "#,
    )
    .bind(folder_id)
    .bind(owner_id)
    .fetch_all(pool)
    .await
}

pub async fn insert_folder_group_audit_log(
    pool: &PgPool,
    encryption_key: &str,
    user_id: Uuid,
    action: &str,
    folder_id: Uuid,
    group_id: Uuid,
    permission: Option<&str>,
) -> Result<(), sqlx::Error> {
    insert_user_audit_log(
        pool,
        encryption_key,
        NewAuditLog {
            user_id,
            action,
            resource_id: Some(folder_id),
            resource_type: Some("folder"),
            device_label: None,
            details: serde_json::json!({
                "resource_id": folder_id,
                "resource_type": "folder",
                "group_id": group_id,
                "permission": permission,
            }),
        },
    )
    .await
}

fn folder_group_permission_to_person_permission(permission: &str) -> &'static str {
    match permission {
        "read" => "read",
        "edit" | "manage" => "write",
        _ => "read",
    }
}

pub async fn rename_user_folder(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Uuid,
    name: String,
    description: Option<String>,
) -> Result<Option<FolderRecord>, sqlx::Error> {
    let mut tx = pool.begin().await?;

    snapshot_user_folder_metadata_in_tx(&mut tx, user_id, folder_id, "rename").await?;

    let folder = sqlx::query_as::<_, FolderRecord>(
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
            share_starts_at,
            share_expires_at,
            share_download_limit,
            share_download_count,
            share_one_time,
            (share_password_hash IS NOT NULL) AS share_password_enabled,
            share_recipient_email,
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
    .fetch_optional(&mut *tx)
    .await?;

    if folder.is_none() {
        tx.rollback().await?;
        return Ok(None);
    }

    tx.commit().await?;
    Ok(folder)
}

pub async fn move_user_folder(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Uuid,
    parent_folder_id: Option<Uuid>,
) -> Result<Option<FolderRecord>, sqlx::Error> {
    let mut tx = pool.begin().await?;

    snapshot_user_folder_metadata_in_tx(&mut tx, user_id, folder_id, "move").await?;

    let folder = sqlx::query_as::<_, FolderRecord>(
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
            share_starts_at,
            share_expires_at,
            share_download_limit,
            share_download_count,
            share_one_time,
            (share_password_hash IS NOT NULL) AS share_password_enabled,
            share_recipient_email,
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
    .fetch_optional(&mut *tx)
    .await?;

    if folder.is_none() {
        tx.rollback().await?;
        return Ok(None);
    }

    tx.commit().await?;
    Ok(folder)
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

    snapshot_user_folder_tree_metadata_in_tx(&mut tx, user_id, folder_id, "delete").await?;
    snapshot_user_folder_tree_files_metadata_in_tx(&mut tx, user_id, folder_id, "delete").await?;

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
            RETURNING id
        )
        SELECT
            (SELECT COUNT(*)::bigint FROM updated_folders) AS folder_count,
            (SELECT COUNT(*)::bigint FROM updated_files) AS file_count
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;

    let folder_count: i64 = row.try_get("folder_count")?;
    if folder_count == 0 {
        tx.rollback().await?;
        return Ok(0);
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

    snapshot_user_folder_tree_metadata_in_tx(&mut tx, user_id, folder_id, "restore").await?;
    snapshot_user_folder_tree_files_metadata_in_tx(&mut tx, user_id, folder_id, "restore").await?;

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
        tx.rollback().await?;
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

pub async fn restore_user_folder_to_point(
    pool: &PgPool,
    user_id: Uuid,
    folder_id: Uuid,
    restore_at: DateTime<Utc>,
) -> Result<Option<FolderPointRestoreResult>, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let root_known = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM folders
            WHERE id = $1
              AND owner_id = $2
            UNION
            SELECT 1
            FROM folder_metadata_snapshots
            WHERE folder_id = $1
              AND owner_id = $2
        )
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;

    if !root_known {
        tx.commit().await?;
        return Ok(None);
    }

    snapshot_user_folder_tree_metadata_in_tx(&mut tx, user_id, folder_id, "point-restore").await?;
    snapshot_user_folder_tree_files_metadata_in_tx(&mut tx, user_id, folder_id, "point-restore")
        .await?;

    sqlx::query(
        r#"
        CREATE TEMP TABLE current_folder_tree (
            id UUID NOT NULL PRIMARY KEY
        ) ON COMMIT DROP
        "#,
    )
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO current_folder_tree (id)
        WITH RECURSIVE tree AS (
            SELECT id
            FROM folders
            WHERE id = $1
              AND owner_id = $2

            UNION ALL

            SELECT child.id
            FROM folders child
            JOIN tree parent ON child.parent_folder_id = parent.id
            WHERE child.owner_id = $2
        )
        SELECT id FROM tree
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        CREATE TEMP TABLE restore_folder_state (
            folder_id UUID NOT NULL PRIMARY KEY,
            owner_id UUID NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            parent_folder_id UUID,
            encrypted_key BYTEA,
            is_deleted BOOLEAN NOT NULL,
            deleted_at timestamptz,
            folder_created_at timestamptz NOT NULL
        ) ON COMMIT DROP
        "#,
    )
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO restore_folder_state (
            folder_id,
            owner_id,
            name,
            description,
            parent_folder_id,
            encrypted_key,
            is_deleted,
            deleted_at,
            folder_created_at
        )
        WITH RECURSIVE effective AS (
            SELECT
                f.id AS folder_id,
                CASE WHEN s.id IS NULL THEN f.owner_id ELSE s.owner_id END AS owner_id,
                CASE WHEN s.id IS NULL THEN f.name ELSE s.name END AS name,
                CASE WHEN s.id IS NULL THEN f.description ELSE s.description END AS description,
                CASE WHEN s.id IS NULL THEN f.parent_folder_id ELSE s.parent_folder_id END AS parent_folder_id,
                CASE WHEN s.id IS NULL THEN f.encrypted_key ELSE s.encrypted_key END AS encrypted_key,
                CASE WHEN s.id IS NULL THEN f.is_deleted ELSE s.is_deleted END AS is_deleted,
                CASE WHEN s.id IS NULL THEN f.deleted_at ELSE s.deleted_at END AS deleted_at,
                CASE WHEN s.id IS NULL THEN f.created_at ELSE s.folder_created_at END AS folder_created_at
            FROM folders f
            LEFT JOIN LATERAL (
                SELECT *
                FROM folder_metadata_snapshots snapshot
                WHERE snapshot.folder_id = f.id
                  AND snapshot.owner_id = $2
                  AND snapshot.captured_at > $3
                ORDER BY snapshot.captured_at ASC
                LIMIT 1
            ) s ON TRUE
            WHERE f.owner_id = $2
        ),
        tree AS (
            SELECT *
            FROM effective
            WHERE folder_id = $1
              AND folder_created_at <= $3
              AND is_deleted = FALSE

            UNION ALL

            SELECT child.*
            FROM effective child
            JOIN tree parent ON child.parent_folder_id = parent.folder_id
            WHERE child.folder_created_at <= $3
              AND child.is_deleted = FALSE
        )
        SELECT * FROM tree
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .bind(restore_at)
    .execute(&mut *tx)
    .await?;

    let folder_count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*)::bigint FROM restore_folder_state")
            .fetch_one(&mut *tx)
            .await?;
    if folder_count == 0 {
        tx.commit().await?;
        return Ok(None);
    }

    sqlx::query(
        r#"
        CREATE TEMP TABLE restore_file_state (
            file_id UUID NOT NULL PRIMARY KEY,
            owner_id UUID NOT NULL,
            filename TEXT NOT NULL,
            folder_id UUID NOT NULL,
            note TEXT,
            storage_path TEXT NOT NULL,
            size_bytes BIGINT NOT NULL,
            encrypted_key BYTEA NOT NULL,
            encryption_nonce BYTEA NOT NULL,
            checksum TEXT
        ) ON COMMIT DROP
        "#,
    )
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO restore_file_state (
            file_id,
            owner_id,
            filename,
            folder_id,
            note,
            storage_path,
            size_bytes,
            encrypted_key,
            encryption_nonce,
            checksum
        )
        WITH effective AS (
            SELECT
                f.id AS file_id,
                CASE WHEN s.id IS NULL THEN f.owner_id ELSE s.owner_id END AS owner_id,
                CASE WHEN s.id IS NULL THEN f.filename ELSE s.filename END AS filename,
                CASE WHEN s.id IS NULL THEN f.folder_id ELSE s.folder_id END AS folder_id,
                CASE WHEN s.id IS NULL THEN f.note ELSE s.note END AS note,
                CASE WHEN s.id IS NULL THEN f.is_deleted ELSE s.is_deleted END AS is_deleted,
                CASE WHEN s.id IS NULL THEN f.deleted_at ELSE s.deleted_at END AS deleted_at,
                CASE WHEN s.id IS NULL THEN f.created_at ELSE s.file_created_at END AS file_created_at
            FROM files f
            LEFT JOIN LATERAL (
                SELECT *
                FROM file_metadata_snapshots snapshot
                WHERE snapshot.file_id = f.id
                  AND snapshot.owner_id = $2
                  AND snapshot.captured_at > $3
                ORDER BY snapshot.captured_at ASC
                LIMIT 1
            ) s ON TRUE
            WHERE f.owner_id = $2
        )
        SELECT
            e.file_id,
            e.owner_id,
            e.filename,
            e.folder_id,
            e.note,
            CASE WHEN v.file_version_id IS NULL THEN f.storage_path ELSE v.storage_path END AS storage_path,
            CASE WHEN v.file_version_id IS NULL THEN f.size_bytes ELSE v.size_bytes END AS size_bytes,
            CASE WHEN v.file_version_id IS NULL THEN f.encrypted_key ELSE COALESCE(v.encrypted_key, f.encrypted_key) END AS encrypted_key,
            CASE WHEN v.file_version_id IS NULL THEN f.encryption_nonce ELSE COALESCE(v.encryption_nonce, f.encryption_nonce) END AS encryption_nonce,
            CASE WHEN v.file_version_id IS NULL THEN f.checksum ELSE v.checksum END AS checksum
        FROM effective e
        JOIN files f ON f.id = e.file_id
        JOIN restore_folder_state rfs ON rfs.folder_id = e.folder_id
        LEFT JOIN LATERAL (
            SELECT
                id AS file_version_id,
                storage_path,
                size_bytes,
                encrypted_key,
                encryption_nonce,
                checksum
            FROM file_versions version
            WHERE version.file_id = e.file_id
              AND version.created_at > $3
            ORDER BY version.created_at ASC
            LIMIT 1
        ) v ON TRUE
        WHERE e.file_created_at <= $3
          AND e.is_deleted = FALSE
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .bind(restore_at)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        CREATE TEMP TABLE affected_file_ids (
            file_id UUID NOT NULL PRIMARY KEY
        ) ON COMMIT DROP
        "#,
    )
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO affected_file_ids (file_id)
        SELECT id AS file_id
        FROM files
        WHERE owner_id = $1
          AND folder_id IN (SELECT id FROM current_folder_tree)
        UNION
        SELECT file_id
        FROM restore_file_state
        "#,
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    let current_active_bytes = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COALESCE(SUM(size_bytes), 0)::bigint
        FROM files
        WHERE owner_id = $1
          AND is_deleted = FALSE
          AND id IN (SELECT file_id FROM affected_file_ids)
        "#,
    )
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;
    let desired_active_bytes = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(size_bytes), 0)::bigint FROM restore_file_state",
    )
    .fetch_one(&mut *tx)
    .await?;
    let storage_delta = desired_active_bytes - current_active_bytes;
    if storage_delta != 0
        && !super::storage::try_apply_storage_delta(&mut tx, user_id, storage_delta).await?
    {
        tx.commit().await?;
        return Ok(None);
    }

    let restored_folders = sqlx::query(
        r#"
        UPDATE folders f
        SET name = r.name,
            description = r.description,
            parent_folder_id = r.parent_folder_id,
            encrypted_key = r.encrypted_key,
            is_deleted = FALSE,
            deleted_at = NULL,
            updated_at = NOW()
        FROM restore_folder_state r
        WHERE f.id = r.folder_id
          AND f.owner_id = $1
        "#,
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;

    let restored_files = sqlx::query(
        r#"
        UPDATE files f
        SET filename = r.filename,
            folder_id = r.folder_id,
            note = r.note,
            storage_path = r.storage_path,
            size_bytes = r.size_bytes,
            encrypted_key = r.encrypted_key,
            encryption_nonce = r.encryption_nonce,
            checksum = r.checksum,
            is_deleted = FALSE,
            deleted_at = NULL,
            updated_at = NOW()
        FROM restore_file_state r
        WHERE f.id = r.file_id
          AND f.owner_id = $1
        "#,
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;

    let deleted_files = sqlx::query(
        r#"
        UPDATE files
        SET is_deleted = TRUE,
            deleted_at = COALESCE(deleted_at, NOW()),
            updated_at = NOW()
        WHERE owner_id = $1
          AND is_deleted = FALSE
          AND id IN (SELECT file_id FROM affected_file_ids)
          AND id NOT IN (SELECT file_id FROM restore_file_state)
        "#,
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;

    let deleted_folders = sqlx::query(
        r#"
        UPDATE folders
        SET is_deleted = TRUE,
            deleted_at = COALESCE(deleted_at, NOW()),
            updated_at = NOW()
        WHERE owner_id = $1
          AND is_deleted = FALSE
          AND id IN (SELECT id FROM current_folder_tree)
          AND id NOT IN (SELECT folder_id FROM restore_folder_state)
        "#,
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;

    tx.commit().await?;

    Ok(Some(FolderPointRestoreResult {
        restored_at: restore_at,
        folder_count: restored_folders,
        file_count: restored_files,
        deleted_folder_count: deleted_folders,
        deleted_file_count: deleted_files,
    }))
}

pub async fn snapshot_user_folder_metadata_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    folder_id: Uuid,
    action: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        INSERT INTO folder_metadata_snapshots (
            folder_id,
            owner_id,
            name,
            description,
            parent_folder_id,
            encrypted_key,
            is_deleted,
            deleted_at,
            folder_created_at,
            action
        )
        SELECT
            id,
            owner_id,
            name,
            description,
            parent_folder_id,
            encrypted_key,
            is_deleted,
            deleted_at,
            created_at,
            $3
        FROM folders
        WHERE id = $1
          AND owner_id = $2
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .bind(action)
    .execute(&mut **tx)
    .await?;

    Ok(result.rows_affected())
}

async fn snapshot_user_folder_tree_metadata_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    folder_id: Uuid,
    action: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        WITH RECURSIVE folder_tree AS (
            SELECT id
            FROM folders
            WHERE id = $1
              AND owner_id = $2

            UNION ALL

            SELECT child.id
            FROM folders child
            JOIN folder_tree parent ON child.parent_folder_id = parent.id
            WHERE child.owner_id = $2
        )
        INSERT INTO folder_metadata_snapshots (
            folder_id,
            owner_id,
            name,
            description,
            parent_folder_id,
            encrypted_key,
            is_deleted,
            deleted_at,
            folder_created_at,
            action
        )
        SELECT
            id,
            owner_id,
            name,
            description,
            parent_folder_id,
            encrypted_key,
            is_deleted,
            deleted_at,
            created_at,
            $3
        FROM folders
        WHERE owner_id = $2
          AND id IN (SELECT id FROM folder_tree)
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .bind(action)
    .execute(&mut **tx)
    .await?;

    Ok(result.rows_affected())
}

async fn snapshot_user_folder_tree_files_metadata_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    folder_id: Uuid,
    action: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        WITH RECURSIVE folder_tree AS (
            SELECT id
            FROM folders
            WHERE id = $1
              AND owner_id = $2

            UNION ALL

            SELECT child.id
            FROM folders child
            JOIN folder_tree parent ON child.parent_folder_id = parent.id
            WHERE child.owner_id = $2
        )
        INSERT INTO file_metadata_snapshots (
            file_id,
            owner_id,
            filename,
            folder_id,
            note,
            is_deleted,
            deleted_at,
            file_created_at,
            action
        )
        SELECT
            id,
            owner_id,
            filename,
            folder_id,
            note,
            is_deleted,
            deleted_at,
            created_at,
            $3
        FROM files
        WHERE owner_id = $2
          AND folder_id IN (SELECT id FROM folder_tree)
        "#,
    )
    .bind(folder_id)
    .bind(user_id)
    .bind(action)
    .execute(&mut **tx)
    .await?;

    Ok(result.rows_affected())
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
        SELECT id, owner_id, storage_path, size_bytes
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
