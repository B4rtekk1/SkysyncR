CREATE TABLE IF NOT EXISTS file_versions
(
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id      UUID        NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    storage_path TEXT        NOT NULL,
    size_bytes   BIGINT      NOT NULL,
    checksum     TEXT,
    created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs
(
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users (id) ON DELETE SET NULL,
    action        TEXT NOT NULL,
    resource_id   UUID,
    resource_type TEXT,
    created_at    timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE file_versions ADD COLUMN IF NOT EXISTS version_number INT;
ALTER TABLE file_versions ADD COLUMN IF NOT EXISTS encrypted_key bytea;
ALTER TABLE file_versions ADD COLUMN IF NOT EXISTS encryption_nonce bytea;
ALTER TABLE file_versions ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE file_versions ADD COLUMN IF NOT EXISTS device_label TEXT;
ALTER TABLE file_versions ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'update';
ALTER TABLE file_versions ADD COLUMN IF NOT EXISTS restored_from_version_id UUID REFERENCES file_versions (id) ON DELETE SET NULL;

WITH numbered AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY file_id ORDER BY created_at, id)::INT AS row_number
    FROM file_versions
    WHERE version_number IS NULL
)
UPDATE file_versions
SET version_number = numbered.row_number
FROM numbered
WHERE file_versions.id = numbered.id;

ALTER TABLE file_versions ALTER COLUMN version_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_versions_file_version_number ON file_versions (file_id, version_number);
CREATE INDEX IF NOT EXISTS idx_file_versions_file_created_at ON file_versions (file_id, created_at DESC);

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS device_label TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs (resource_type, resource_id, created_at DESC);
