CREATE TABLE IF NOT EXISTS file_version_shares
(
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_version_id   UUID  NOT NULL REFERENCES file_versions (id) ON DELETE CASCADE,
    file_share_id     UUID  REFERENCES file_shares (id) ON DELETE SET NULL,
    recipient_user_id UUID  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    permission        TEXT  NOT NULL CHECK (permission IN ('read', 'download', 'write')),
    encrypted_key     BYTEA NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (file_version_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_file_version_shares_version ON file_version_shares (file_version_id);
