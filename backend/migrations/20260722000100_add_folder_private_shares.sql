CREATE TABLE IF NOT EXISTS folder_shares
(
    id                UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    folder_id         UUID        NOT NULL REFERENCES folders (id) ON DELETE CASCADE,
    owner_id          UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    recipient_user_id UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    permission        TEXT        NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'download', 'write')),
    encrypted_key     BYTEA       NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT NOW(),
    updated_at        timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (folder_id, recipient_user_id),
    CHECK (owner_id <> recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_folder_shares_recipient ON folder_shares (recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_folder_shares_owner_folder ON folder_shares (owner_id, folder_id);
