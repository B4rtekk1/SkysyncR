use sqlx::PgPool;
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
            COALESCE((
                SELECT SUM(f.size_bytes)::bigint
                FROM files f
                WHERE f.owner_id = $1 AND f.is_deleted = FALSE
            ), 0) AS "used_bytes!: i64"
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
