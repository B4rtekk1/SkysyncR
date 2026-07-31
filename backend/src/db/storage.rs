use sqlx::{PgPool, Postgres, Transaction};
use std::time::Instant;
use uuid::Uuid;

use crate::observability::observe_db_latency;

pub struct StorageQuota {
    pub total_bytes: i64,
    pub used_bytes: i64,
}

pub struct StorageOverview {
    pub users: i64,
    pub total_bytes: i64,
    pub used_bytes: i64,
}

impl StorageOverview {
    pub fn usage_ratio(&self) -> Option<f64> {
        if self.total_bytes > 0 {
            Some(self.used_bytes as f64 / self.total_bytes as f64)
        } else {
            None
        }
    }
}

pub async fn ensure_storage_quota_row(pool: &PgPool, user_id: Uuid) -> Result<(), sqlx::Error> {
    let started = Instant::now();
    sqlx::query!(
        r#"
        INSERT INTO storage_quotas (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
        "#,
        user_id
    )
    .execute(pool)
    .await?;
    observe_db_latency("storage.ensure_quota", started.elapsed());

    Ok(())
}

pub async fn get_storage_quota(pool: &PgPool, user_id: Uuid) -> Result<StorageQuota, sqlx::Error> {
    ensure_storage_quota_row(pool, user_id).await?;

    let started = Instant::now();
    let row = sqlx::query!(
        r#"
        SELECT
            sq.max_bytes AS "total_bytes!: i64",
            sq.used_bytes AS "used_bytes!: i64"
        FROM storage_quotas sq
        WHERE sq.user_id = $1
        "#,
        user_id
    )
    .fetch_one(pool)
    .await?;
    observe_db_latency("storage.get_quota", started.elapsed());

    Ok(StorageQuota {
        total_bytes: row.total_bytes,
        used_bytes: row.used_bytes,
    })
}

pub async fn ensure_storage_quota_row_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    let started = Instant::now();
    sqlx::query(
        r#"
        INSERT INTO storage_quotas (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
        "#,
    )
    .bind(user_id)
    .execute(&mut **tx)
    .await?;
    observe_db_latency("storage.ensure_quota_tx", started.elapsed());

    Ok(())
}

pub async fn try_apply_storage_delta(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    delta_bytes: i64,
) -> Result<bool, sqlx::Error> {
    ensure_storage_quota_row_in_tx(tx, user_id).await?;

    let started = Instant::now();
    let row = sqlx::query(
        r#"
        UPDATE storage_quotas
        SET used_bytes = used_bytes + $2,
            updated_at = NOW()
        WHERE user_id = $1
          AND used_bytes + $2 >= 0
          AND used_bytes + $2 <= max_bytes
        RETURNING used_bytes
        "#,
    )
    .bind(user_id)
    .bind(delta_bytes)
    .fetch_optional(&mut **tx)
    .await?;
    observe_db_latency("storage.apply_delta", started.elapsed());

    Ok(row.is_some())
}

pub async fn reconcile_all_storage_quotas(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let started = Instant::now();
    let result = sqlx::query(
        r#"
        UPDATE storage_quotas sq
        SET used_bytes = usage.used_bytes,
            updated_at = NOW()
        FROM (
            SELECT sq_inner.user_id,
                   COALESCE(SUM(f.size_bytes), 0)::bigint AS used_bytes
            FROM storage_quotas sq_inner
            LEFT JOIN files f ON f.owner_id = sq_inner.user_id
            GROUP BY sq_inner.user_id
        ) usage
        WHERE usage.user_id = sq.user_id
          AND sq.used_bytes <> usage.used_bytes
        "#,
    )
    .execute(pool)
    .await?;
    observe_db_latency("storage.reconcile_all", started.elapsed());

    Ok(result.rows_affected())
}

pub async fn get_storage_overview(pool: &PgPool) -> Result<StorageOverview, sqlx::Error> {
    let started = Instant::now();
    let row = sqlx::query_as::<_, (i64, i64, i64)>(
        r#"
        SELECT
            COUNT(*)::bigint AS users,
            COALESCE(SUM(max_bytes), 0)::bigint AS total_bytes,
            COALESCE(SUM(used_bytes), 0)::bigint AS used_bytes
        FROM storage_quotas
        "#,
    )
    .fetch_one(pool)
    .await?;
    observe_db_latency("storage.overview", started.elapsed());

    Ok(StorageOverview {
        users: row.0,
        total_bytes: row.1,
        used_bytes: row.2,
    })
}
