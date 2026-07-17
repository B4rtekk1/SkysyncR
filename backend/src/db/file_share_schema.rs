use sqlx::PgPool;

pub async fn ensure_file_shares_table(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS file_shares
        (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            file_id           UUID        NOT NULL REFERENCES files (id) ON DELETE CASCADE,
            owner_id          UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            recipient_user_id UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            permission        TEXT        NOT NULL DEFAULT 'read',
            encrypted_key     BYTEA       NOT NULL,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'file_shares' AND column_name = 'shared_by_user_id'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'file_shares' AND column_name = 'owner_id'
            ) THEN
                ALTER TABLE file_shares RENAME COLUMN shared_by_user_id TO owner_id;
            END IF;

            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'file_shares' AND column_name = 'shared_with_user_id'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'file_shares' AND column_name = 'recipient_user_id'
            ) THEN
                ALTER TABLE file_shares RENAME COLUMN shared_with_user_id TO recipient_user_id;
            END IF;
        END $$;
        "#,
    )
    .execute(pool)
    .await?;
    sqlx::query("ALTER TABLE file_shares ADD COLUMN IF NOT EXISTS encrypted_key BYTEA")
        .execute(pool)
        .await?;
    sqlx::query("ALTER TABLE file_shares ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM file_shares WHERE encrypted_key IS NULL")
        .execute(pool)
        .await?;
    sqlx::query("ALTER TABLE file_shares ALTER COLUMN encrypted_key SET NOT NULL")
        .execute(pool)
        .await?;
    sqlx::query("ALTER TABLE file_shares DROP CONSTRAINT IF EXISTS file_shares_permission_check")
        .execute(pool)
        .await?;
    sqlx::query(
        "ALTER TABLE file_shares ADD CONSTRAINT file_shares_permission_check CHECK (permission IN ('read', 'download', 'write'))",
    )
    .execute(pool)
    .await?;
    sqlx::query("ALTER TABLE file_shares DROP CONSTRAINT IF EXISTS file_shares_not_self_check")
        .execute(pool)
        .await?;
    sqlx::query("ALTER TABLE file_shares ADD CONSTRAINT file_shares_not_self_check CHECK (owner_id <> recipient_user_id)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE UNIQUE INDEX IF NOT EXISTS idx_file_shares_unique_recipient ON file_shares (file_id, recipient_user_id)")
        .execute(pool)
        .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_file_shares_recipient ON file_shares (recipient_user_id)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_file_shares_owner_file ON file_shares (owner_id, file_id)",
    )
    .execute(pool)
    .await?;

    Ok(())
}
