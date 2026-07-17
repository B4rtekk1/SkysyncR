use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

pub struct StorageQuota {
    pub total_bytes: i64,
    pub used_bytes: i64,
}

pub async fn ensure_storage_quota_row(pool: &PgPool, user_id: Uuid) -> Result<(), sqlx::Error> {
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

    Ok(())
}

pub async fn get_storage_quota(pool: &PgPool, user_id: Uuid) -> Result<StorageQuota, sqlx::Error> {
    ensure_storage_quota_row(pool, user_id).await?;

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

    Ok(StorageQuota {
        total_bytes: row.total_bytes,
        used_bytes: row.used_bytes,
    })
}

pub async fn ensure_storage_quota_row_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
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

    Ok(())
}

pub async fn try_apply_storage_delta(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    delta_bytes: i64,
) -> Result<bool, sqlx::Error> {
    ensure_storage_quota_row_in_tx(tx, user_id).await?;

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

    Ok(row.is_some())
}

pub async fn reconcile_all_storage_quotas(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE storage_quotas sq
        SET used_bytes = usage.used_bytes,
            updated_at = NOW()
        FROM (
            SELECT sq_inner.user_id,
                   COALESCE(SUM(f.size_bytes) FILTER (WHERE f.is_deleted = FALSE), 0)::bigint AS used_bytes
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

    Ok(result.rows_affected())
}
