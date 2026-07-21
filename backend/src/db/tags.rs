use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(FromRow, Serialize)]
pub struct TagRecord {
    pub id: Uuid,
    pub name: String,
    pub color: Option<String>,
}

#[derive(FromRow, Serialize)]
pub struct FileTagRecord {
    pub file_id: Uuid,
    pub tag_id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
}

pub struct NewTag {
    pub owner_id: Uuid,
    pub name: String,
    pub color: Option<String>,
}

pub async fn list_user_tags(pool: &PgPool, user_id: Uuid) -> Result<Vec<TagRecord>, sqlx::Error> {
    sqlx::query_as::<_, TagRecord>(
        r#"
        SELECT id, name, color
        FROM tags
        WHERE owner_id = $1
        ORDER BY lower(name), name
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn create_user_tag(pool: &PgPool, tag: NewTag) -> Result<TagRecord, sqlx::Error> {
    sqlx::query_as::<_, TagRecord>(
        r#"
        INSERT INTO tags (owner_id, name, color)
        VALUES ($1, $2, $3)
        RETURNING id, name, color
        "#,
    )
    .bind(tag.owner_id)
    .bind(tag.name)
    .bind(tag.color)
    .fetch_one(pool)
    .await
}

pub async fn update_user_tag(
    pool: &PgPool,
    user_id: Uuid,
    tag_id: Uuid,
    name: String,
    color: Option<String>,
) -> Result<Option<TagRecord>, sqlx::Error> {
    sqlx::query_as::<_, TagRecord>(
        r#"
        UPDATE tags
        SET name = $1,
            color = $2
        WHERE id = $3
          AND owner_id = $4
        RETURNING id, name, color
        "#,
    )
    .bind(name)
    .bind(color)
    .bind(tag_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn delete_user_tag(
    pool: &PgPool,
    user_id: Uuid,
    tag_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        DELETE FROM tags
        WHERE id = $1
          AND owner_id = $2
        "#,
    )
    .bind(tag_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn list_file_tags(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
) -> Result<Vec<FileTagRecord>, sqlx::Error> {
    sqlx::query_as::<_, FileTagRecord>(
        r#"
        SELECT ft.file_id, t.id AS tag_id, t.name, t.color, NULL::timestamptz AS created_at
        FROM file_tags ft
        JOIN tags t ON t.id = ft.tag_id
        JOIN files f ON f.id = ft.file_id
        WHERE ft.file_id = $1
          AND t.owner_id = $2
          AND f.owner_id = $2
          AND f.is_deleted = FALSE
        ORDER BY lower(t.name), t.name
        "#,
    )
    .bind(file_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn add_file_tag(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
    tag_id: Uuid,
) -> Result<Option<FileTagRecord>, sqlx::Error> {
    sqlx::query_as::<_, FileTagRecord>(
        r#"
        WITH allowed AS (
            SELECT f.id AS file_id, t.id AS tag_id
            FROM files f
            JOIN tags t ON t.id = $3
            WHERE f.id = $2
              AND f.owner_id = $1
              AND f.is_deleted = FALSE
              AND t.owner_id = $1
        ),
        inserted AS (
            INSERT INTO file_tags (file_id, tag_id)
            SELECT file_id, tag_id
            FROM allowed
            ON CONFLICT DO NOTHING
            RETURNING file_id, tag_id
        )
        SELECT allowed.file_id, t.id AS tag_id, t.name, t.color, NULL::timestamptz AS created_at
        FROM allowed
        JOIN tags t ON t.id = allowed.tag_id
        LEFT JOIN inserted ON inserted.file_id = allowed.file_id AND inserted.tag_id = allowed.tag_id
        "#,
    )
    .bind(user_id)
    .bind(file_id)
    .bind(tag_id)
    .fetch_optional(pool)
    .await
}

pub async fn remove_file_tag(
    pool: &PgPool,
    user_id: Uuid,
    file_id: Uuid,
    tag_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        DELETE FROM file_tags ft
        USING tags t, files f
        WHERE ft.file_id = $1
          AND ft.tag_id = $2
          AND t.id = ft.tag_id
          AND f.id = ft.file_id
          AND t.owner_id = $3
          AND f.owner_id = $3
        "#,
    )
    .bind(file_id)
    .bind(tag_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}
