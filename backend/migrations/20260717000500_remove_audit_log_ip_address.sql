CREATE SCHEMA IF NOT EXISTS migration_backups;

CREATE TABLE IF NOT EXISTS migration_backups.audit_logs_ip_address_20260717000500
(
    id UUID,
    ip_address TEXT,
    backed_up_at timestamptz NOT NULL
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'audit_logs'
          AND column_name = 'ip_address'
    ) THEN
        EXECUTE '
            INSERT INTO migration_backups.audit_logs_ip_address_20260717000500 (
                id, ip_address, backed_up_at
            )
            SELECT id, ip_address, NOW()
            FROM audit_logs
        ';
    END IF;
END $$;

ALTER TABLE audit_logs DROP COLUMN IF EXISTS ip_address;
