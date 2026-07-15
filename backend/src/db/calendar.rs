use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(FromRow, Serialize)]
pub struct CalendarEntryRecord {
    pub id: Uuid,
    pub kind: String,
    pub date: String,
    pub time: String,
    pub title: String,
    pub note: String,
    pub reminder: String,
    pub file_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct NewCalendarEntry {
    pub owner_id: Uuid,
    pub kind: String,
    pub date: String,
    pub time: String,
    pub title: String,
    pub note: String,
    pub reminder: String,
    pub file_id: Option<Uuid>,
}

pub struct CalendarEntryUpdate {
    pub kind: String,
    pub date: String,
    pub time: String,
    pub title: String,
    pub note: String,
    pub reminder: String,
    pub file_id: Option<Uuid>,
}

pub async fn ensure_calendar_entries_table(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS calendar_entries
        (
            id         UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
            owner_id   UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            kind       TEXT        NOT NULL CHECK (kind IN ('event', 'deadline')),
            date       TEXT        NOT NULL,
            time       TEXT        NOT NULL,
            title      TEXT        NOT NULL,
            note       TEXT        NOT NULL DEFAULT '',
            reminder   TEXT        NOT NULL DEFAULT '',
            file_id    UUID        REFERENCES files (id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT NOW(),
            updated_at timestamptz NOT NULL DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_calendar_entries_owner_date
        ON calendar_entries (owner_id, date)
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn list_calendar_entries(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<CalendarEntryRecord>, sqlx::Error> {
    sqlx::query_as::<_, CalendarEntryRecord>(
        r#"
        SELECT id, kind, date, time, title, note, reminder, file_id, created_at, updated_at
        FROM calendar_entries
        WHERE owner_id = $1
        ORDER BY date ASC, time ASC, created_at ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn create_calendar_entry(
    pool: &PgPool,
    entry: NewCalendarEntry,
) -> Result<CalendarEntryRecord, sqlx::Error> {
    sqlx::query_as::<_, CalendarEntryRecord>(
        r#"
        INSERT INTO calendar_entries (owner_id, kind, date, time, title, note, reminder, file_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, kind, date, time, title, note, reminder, file_id, created_at, updated_at
        "#,
    )
    .bind(entry.owner_id)
    .bind(entry.kind)
    .bind(entry.date)
    .bind(entry.time)
    .bind(entry.title)
    .bind(entry.note)
    .bind(entry.reminder)
    .bind(entry.file_id)
    .fetch_one(pool)
    .await
}

pub async fn update_calendar_entry(
    pool: &PgPool,
    user_id: Uuid,
    entry_id: Uuid,
    entry: CalendarEntryUpdate,
) -> Result<Option<CalendarEntryRecord>, sqlx::Error> {
    sqlx::query_as::<_, CalendarEntryRecord>(
        r#"
        UPDATE calendar_entries
        SET kind = $1,
            date = $2,
            time = $3,
            title = $4,
            note = $5,
            reminder = $6,
            file_id = $7,
            updated_at = NOW()
        WHERE id = $8
          AND owner_id = $9
        RETURNING id, kind, date, time, title, note, reminder, file_id, created_at, updated_at
        "#,
    )
    .bind(entry.kind)
    .bind(entry.date)
    .bind(entry.time)
    .bind(entry.title)
    .bind(entry.note)
    .bind(entry.reminder)
    .bind(entry.file_id)
    .bind(entry_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn delete_calendar_entry(
    pool: &PgPool,
    user_id: Uuid,
    entry_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        DELETE FROM calendar_entries
        WHERE id = $1
          AND owner_id = $2
        "#,
    )
    .bind(entry_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn file_belongs_to_user(
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
