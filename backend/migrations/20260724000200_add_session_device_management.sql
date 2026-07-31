ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS device_label TEXT;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS last_used_at timestamptz NOT NULL DEFAULT NOW();
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS trusted BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
    IF to_regclass('migration_backups.refresh_tokens_device_metadata_20260717000400') IS NOT NULL THEN
        EXECUTE $restore_backup$
            UPDATE refresh_tokens rt
            SET user_agent = COALESCE(rt.user_agent, backup.user_agent),
                ip_address = COALESCE(rt.ip_address, backup.ip_address),
                device_label = COALESCE(
                    rt.device_label,
                    NULLIF(backup.device_id, ''),
                    NULLIF(backup.user_agent, '')
                )
            FROM migration_backups.refresh_tokens_device_metadata_20260717000400 backup
            WHERE rt.id = backup.id
        $restore_backup$;
    END IF;
END $$;

UPDATE refresh_tokens
SET session_id = id
WHERE session_id IS NULL;

ALTER TABLE refresh_tokens ALTER COLUMN session_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_session
    ON refresh_tokens (user_id, session_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active
    ON refresh_tokens (user_id, revoked, session_expires_at, expires_at);

CREATE TABLE IF NOT EXISTS refresh_token_activity_logs
(
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    session_id   UUID        NOT NULL,
    action       TEXT        NOT NULL CHECK (action IN ('login', 'refresh', 'logout', 'logout_all', 'revoked', 'trust_changed')),
    device_label TEXT,
    ip_address   TEXT,
    created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_activity_user_created
    ON refresh_token_activity_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_refresh_token_activity_session
    ON refresh_token_activity_logs (session_id, created_at DESC);
