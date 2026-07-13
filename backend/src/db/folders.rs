use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(FromRow, Serialize)]
pub struct FolderRecord {
    pub id: Uuid,
    pub name: String,
    pub parent_folder_id: Option<Uuid>,
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
