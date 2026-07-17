CREATE SCHEMA IF NOT EXISTS migration_backups;

CREATE TABLE IF NOT EXISTS migration_backups.refresh_tokens_device_metadata_20260717000400
(
    id UUID,
    user_agent TEXT,
    ip_address TEXT,
    device_id TEXT,
    backed_up_at timestamptz NOT NULL
);

DO $$
DECLARE
    user_agent_expr TEXT := 'NULL::TEXT';
    ip_address_expr TEXT := 'NULL::TEXT';
    device_id_expr TEXT := 'NULL::TEXT';
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'refresh_tokens'
          AND column_name = 'user_agent'
    ) THEN
        user_agent_expr := 'user_agent';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'refresh_tokens'
          AND column_name = 'ip_address'
    ) THEN
        ip_address_expr := 'ip_address';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'refresh_tokens'
          AND column_name = 'device_id'
    ) THEN
        device_id_expr := 'device_id';
    END IF;

    IF user_agent_expr <> 'NULL::TEXT'
        OR ip_address_expr <> 'NULL::TEXT'
        OR device_id_expr <> 'NULL::TEXT'
    THEN
        EXECUTE '
            INSERT INTO migration_backups.refresh_tokens_device_metadata_20260717000400 (
                id, user_agent, ip_address, device_id, backed_up_at
            )
            SELECT id, '
                || user_agent_expr || ', '
                || ip_address_expr || ', '
                || device_id_expr || ', NOW()
            FROM refresh_tokens
        ';
    END IF;
END $$;

ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS user_agent;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS ip_address;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS device_id;
