ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS encrypted_details bytea;

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
    ON audit_logs (user_id, created_at DESC);
