CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users
(
    id                              UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    email                           TEXT        NOT NULL UNIQUE,
    password_hash                   TEXT        NOT NULL,
    public_key                      TEXT,
    email_verified                  BOOLEAN     NOT NULL DEFAULT FALSE,
    verification_token              TEXT,
    verification_token_expires_at   timestamptz,
    display_name                    TEXT,
    avatar_url                      TEXT,
    default_view                    TEXT        NOT NULL DEFAULT 'all',
    layout_mode                     TEXT        NOT NULL DEFAULT 'grid',
    upload_protection               BOOLEAN     NOT NULL DEFAULT TRUE,
    compact_metadata                BOOLEAN     NOT NULL DEFAULT TRUE,
    device_lock                     BOOLEAN     NOT NULL DEFAULT FALSE,
    sync_on_metered                 BOOLEAN     NOT NULL DEFAULT FALSE,
    trash_retention_days            INT         NOT NULL DEFAULT 30,
    is_active                       BOOLEAN     NOT NULL DEFAULT TRUE,
    failed_login_attempts           INT         NOT NULL DEFAULT 0,
    locked_until                    timestamptz,
    password_reset_token            TEXT,
    password_reset_token_expiration timestamptz,
    encrypted_private_key_recovery  TEXT        NOT NULL DEFAULT '',
    created_at                      timestamptz NOT NULL DEFAULT NOW(),
    updated_at                      timestamptz NOT NULL DEFAULT NOW(),
    last_login_at                   timestamptz
);

CREATE TABLE IF NOT EXISTS folders
(
    id               UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    owner_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name             TEXT        NOT NULL,
    description      TEXT,
    parent_folder_id UUID        REFERENCES folders (id) ON DELETE SET NULL,
    encrypted_key    bytea,
    deleted_at       timestamptz,
    is_deleted       BOOLEAN     NOT NULL DEFAULT FALSE,
    is_public        BOOLEAN     NOT NULL DEFAULT FALSE,
    share_token      TEXT,
    created_at       timestamptz NOT NULL DEFAULT NOW(),
    updated_at       timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_folders_owner_id ON folders (owner_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders (parent_folder_id);

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

CREATE TABLE IF NOT EXISTS files
(
    id                   UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    owner_id             UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    filename             TEXT        NOT NULL,
    storage_path         TEXT        NOT NULL,
    mime_type            TEXT,
    size_bytes           BIGINT      NOT NULL,
    encrypted_key        bytea,
    encryption_nonce     bytea,
    checksum             TEXT,
    folder_id            UUID        REFERENCES folders (id) ON DELETE SET NULL,
    note                 TEXT,
    is_deleted           BOOLEAN     NOT NULL DEFAULT FALSE,
    is_public            BOOLEAN     NOT NULL DEFAULT FALSE,
    share_token          TEXT,
    share_expires_at     timestamptz,
    share_download_limit INT,
    share_download_count INT         NOT NULL DEFAULT 0,
    created_at           timestamptz NOT NULL DEFAULT NOW(),
    updated_at           timestamptz NOT NULL DEFAULT NOW(),
    deleted_at           timestamptz
);
CREATE INDEX IF NOT EXISTS idx_files_owner_id ON files (owner_id);
CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files (folder_id);
CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files (deleted_at) WHERE is_deleted = TRUE;

CREATE TABLE IF NOT EXISTS refresh_tokens
(
    id                 UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    user_id            UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash         TEXT        NOT NULL UNIQUE,
    expires_at         timestamptz NOT NULL,
    session_expires_at timestamptz NOT NULL DEFAULT (NOW() + interval '90 days'),
    revoked            BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at         timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens (user_id);

CREATE TABLE IF NOT EXISTS file_shares
(
    id                UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    file_id           UUID        NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    owner_id          UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    recipient_user_id UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    permission        TEXT        NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'download', 'write')),
    encrypted_key     BYTEA       NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT NOW(),
    updated_at        timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (file_id, recipient_user_id),
    CHECK (owner_id <> recipient_user_id)
);
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'file_shares'
          AND column_name = 'recipient_user_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_file_shares_recipient ON file_shares (recipient_user_id);
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'file_shares'
          AND column_name = 'owner_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_file_shares_owner_file ON file_shares (owner_id, file_id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS file_versions
(
    id           UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    file_id      UUID        NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    storage_path TEXT        NOT NULL,
    size_bytes   BIGINT      NOT NULL,
    checksum     TEXT,
    created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs
(
    id            UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    user_id       UUID        REFERENCES users (id) ON DELETE SET NULL,
    action        TEXT        NOT NULL,
    resource_id   UUID,
    resource_type TEXT,
    created_at    timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs (user_id);

CREATE TABLE IF NOT EXISTS groups
(
    id           UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    name         TEXT        NOT NULL,
    default_role TEXT        NOT NULL DEFAULT 'viewer',
    owner_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT NOW(),
    updated_at   timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_groups_owner_id ON groups (owner_id);

CREATE TABLE IF NOT EXISTS group_members
(
    id        UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    group_id  UUID        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    user_id   UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role      TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin', 'owner')),
    joined_at timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members (user_id);

CREATE TABLE IF NOT EXISTS group_invitations
(
    id                 UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    group_id           UUID        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    invited_email      TEXT        NOT NULL,
    invited_by_user_id UUID        NOT NULL REFERENCES users (id),
    role               TEXT        NOT NULL DEFAULT 'viewer',
    token              TEXT        NOT NULL UNIQUE,
    status             TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
    expires_at         timestamptz NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_group_invitations_group_id ON group_invitations (group_id);

CREATE TABLE IF NOT EXISTS tags
(
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    color    TEXT,
    UNIQUE (owner_id, name)
);

CREATE TABLE IF NOT EXISTS file_tags
(
    file_id UUID NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    tag_id  UUID NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    PRIMARY KEY (file_id, tag_id)
);

CREATE TABLE IF NOT EXISTS notifications
(
    id         UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type       TEXT        NOT NULL,
    payload    jsonb       NOT NULL,
    is_read    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id, is_read);

CREATE TABLE IF NOT EXISTS calendar_entries
(
    id         UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    owner_id   UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind       TEXT        NOT NULL CHECK (kind IN ('event', 'deadline')),
    date       TEXT        NOT NULL,
    time       TEXT        NOT NULL,
    title      TEXT        NOT NULL,
    note       TEXT        NOT NULL DEFAULT '',
    reminder   TEXT        NOT NULL DEFAULT '',
    file_id    UUID        REFERENCES files (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calendar_entries_owner_date ON calendar_entries (owner_id, date);

CREATE TABLE IF NOT EXISTS storage_quotas
(
    user_id    UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    max_bytes  BIGINT      NOT NULL DEFAULT 5368709120,
    used_bytes BIGINT      NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS favorites
(
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    file_id    UUID        NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, file_id)
);
