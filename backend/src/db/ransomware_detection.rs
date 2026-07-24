use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, FromRow)]
pub struct SuspiciousFileActivitySummary {
    pub user_id: Uuid,
    pub device_label: Option<String>,
    pub window_started_at: DateTime<Utc>,
    pub window_ended_at: DateTime<Utc>,
    pub delete_count: i64,
    pub rename_count: i64,
    pub update_count: i64,
    pub affected_file_count: i64,
}

pub async fn summarize_recent_file_mutations(
    pool: &PgPool,
    user_id: Uuid,
    device_label: Option<&str>,
    window_minutes: i32,
) -> Result<SuspiciousFileActivitySummary, sqlx::Error> {
    sqlx::query_as::<_, SuspiciousFileActivitySummary>(
        r#"
        WITH recent AS (
            SELECT action, resource_id, created_at
            FROM audit_logs
            WHERE user_id = $1
              AND resource_type = 'file'
              AND device_label IS NOT DISTINCT FROM $2
              AND action IN ('file.delete', 'file.rename', 'file.update')
              AND created_at >= NOW() - ($3::int * interval '1 minute')
        )
        SELECT
            $1 AS user_id,
            $2 AS device_label,
            COALESCE(MIN(created_at), NOW()) AS window_started_at,
            COALESCE(MAX(created_at), NOW()) AS window_ended_at,
            COUNT(*) FILTER (WHERE action = 'file.delete')::bigint AS delete_count,
            COUNT(*) FILTER (WHERE action = 'file.rename')::bigint AS rename_count,
            COUNT(*) FILTER (WHERE action = 'file.update')::bigint AS update_count,
            COUNT(DISTINCT resource_id)::bigint AS affected_file_count
        FROM recent
        "#,
    )
    .bind(user_id)
    .bind(device_label)
    .bind(window_minutes)
    .fetch_one(pool)
    .await
}
