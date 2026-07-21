use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(FromRow, Serialize)]
pub struct NotificationRecord {
    pub id: Uuid,
    pub r#type: String,
    pub payload: Value,
    pub is_read: bool,
    pub created_at: DateTime<Utc>,
}

pub struct NewNotification {
    pub user_id: Uuid,
    pub r#type: String,
    pub payload: Value,
}

pub async fn list_user_notifications(
    pool: &PgPool,
    user_id: Uuid,
    unread_only: bool,
    limit: i64,
) -> Result<Vec<NotificationRecord>, sqlx::Error> {
    sqlx::query_as::<_, NotificationRecord>(
        r#"
        SELECT id, type, payload, is_read, created_at
        FROM notifications
        WHERE user_id = $1
          AND ($2 = FALSE OR is_read = FALSE)
        ORDER BY created_at DESC
        LIMIT $3
        "#,
    )
    .bind(user_id)
    .bind(unread_only)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn create_notification(
    pool: &PgPool,
    notification: NewNotification,
) -> Result<NotificationRecord, sqlx::Error> {
    sqlx::query_as::<_, NotificationRecord>(
        r#"
        INSERT INTO notifications (user_id, type, payload)
        VALUES ($1, $2, $3)
        RETURNING id, type, payload, is_read, created_at
        "#,
    )
    .bind(notification.user_id)
    .bind(notification.r#type)
    .bind(notification.payload)
    .fetch_one(pool)
    .await
}

pub async fn mark_notification_read(
    pool: &PgPool,
    user_id: Uuid,
    notification_id: Uuid,
) -> Result<Option<NotificationRecord>, sqlx::Error> {
    sqlx::query_as::<_, NotificationRecord>(
        r#"
        UPDATE notifications
        SET is_read = TRUE
        WHERE id = $1
          AND user_id = $2
        RETURNING id, type, payload, is_read, created_at
        "#,
    )
    .bind(notification_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn mark_all_notifications_read(pool: &PgPool, user_id: Uuid) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE notifications
        SET is_read = TRUE
        WHERE user_id = $1
          AND is_read = FALSE
        "#,
    )
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn delete_notification(
    pool: &PgPool,
    user_id: Uuid,
    notification_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        DELETE FROM notifications
        WHERE id = $1
          AND user_id = $2
        "#,
    )
    .bind(notification_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn create_due_reminder_notifications(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<NotificationRecord>, sqlx::Error> {
    sqlx::query_as::<_, NotificationRecord>(
        r#"
        WITH due_entries AS (
            SELECT id, kind, date, time, title, note, reminder, file_id
            FROM calendar_entries
            WHERE owner_id = $1
              AND reminder <> ''
              AND ((date || ' ' || time)::timestamp AT TIME ZONE 'UTC') <= NOW()
              AND NOT EXISTS (
                  SELECT 1
                  FROM notifications n
                  WHERE n.user_id = $1
                    AND n.type = 'calendar.reminder'
                    AND n.payload->>'calendar_entry_id' = calendar_entries.id::text
              )
        ),
        inserted AS (
            INSERT INTO notifications (user_id, type, payload)
            SELECT
                $1,
                'calendar.reminder',
                jsonb_build_object(
                    'calendar_entry_id', id,
                    'kind', kind,
                    'date', date,
                    'time', time,
                    'title', title,
                    'note', note,
                    'reminder', reminder,
                    'file_id', file_id
                )
            FROM due_entries
            RETURNING id, type, payload, is_read, created_at
        )
        SELECT id, type, payload, is_read, created_at
        FROM inserted
        ORDER BY created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}
