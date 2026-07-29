ALTER TABLE files ADD COLUMN IF NOT EXISTS content_key_fingerprint TEXT;
ALTER TABLE file_versions ADD COLUMN IF NOT EXISTS content_key_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_file_versions_file_key_fingerprint
    ON file_versions (file_id, content_key_fingerprint)
    WHERE content_key_fingerprint IS NOT NULL;
