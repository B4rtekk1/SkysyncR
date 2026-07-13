use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(FromRow, Serialize)]
pub struct FolderRecord {
    pub id: Uuid,
    pub name: String,
    pub parent_folder_id: Option<Uuid>,
    pub is_public: bool,
    pub share_token: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub is_deleted: bool,
    pub deleted_at: Option<DateTime<Utc>>,
    pub file_count: i64,
}

pub struct NewFolderRecord {
    pub owner_id: Uuid,
    pub name: String,
    pub parent_folder_id: Option<Uuid>,
}

pub async fn list_user_folders(
    pool: &PgPool,
    user_id: Uuid,
    parent_folder_id: Option<Uuid>,
) -> Result<Vec<FolderRecord>, sqlx::Error> {
    sqlx::query_as::<_, FolderRecord>(
        r#"
        SELECT
            f.id,
            f.name,
            f.parent_folder_id,
            f.is_public,
            f.share_token,
            f.created_at,
            f.updated_at,
            FALSE AS is_deleted,
            NULL::timestamptz AS deleted_at,
            COUNT(files.id)::bigint AS file_count
        FROM folders f
        LEFT JOIN files
          ON files.folder_id = f.id
         AND files.owner_id = f.owner_id
         AND files.is_deleted = FALSE
        WHERE f.owner_id = $1
          AND (
              ($2::uuid IS NULL AND f.parent_folder_id IS NULL)
              OR f.parent_folder_id = $2
          )
        GROUP BY
            f.id,
            f.name,
            f.parent_folder_id,
            f.is_public,
            f.share_token,
            f.created_at,
            f.updated_at
        ORDER BY f.name
        "#,
    )
    .bind(user_id)
    .bind(parent_folder_id)
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
            parent_folder_id
        )
        VALUES ($1, $2, $3)
        RETURNING
            id,
            name,
            parent_folder_id,
            is_public,
            share_token,
            created_at,
            updated_at,
            FALSE AS is_deleted,
            NULL::timestamptz AS deleted_at,
            0::bigint AS file_count
        "#,
    )
    .bind(folder.owner_id)
    .bind(folder.name)
    .bind(folder.parent_folder_id)
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
            ) AS file_count
        "#,
    )
    .bind(is_public)
    .bind(share_token)
    .bind(folder_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}
