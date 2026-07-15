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
    trash_retention_days            INT         NOT NULL DEFAULT 30,
    is_active                       BOOLEAN     NOT NULL DEFAULT TRUE,
    failed_login_attempts           INT         NOT NULL DEFAULT 0,
    locked_until                    timestamptz,
    password_reset_token            TEXT,
    password_reset_token_expiration timestamptz,
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
    deleted_at        timestamptz,
    is_deleted       BOOLEAN     NOT NULL DEFAULT FALSE,
    is_public        BOOLEAN     NOT NULL DEFAULT FALSE,
    share_token      TEXT,
    created_at       timestamptz NOT NULL DEFAULT NOW(),
    updated_at       timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_folders_owner_id ON folders (owner_id);
CREATE INDEX idx_folders_parent ON folders (parent_folder_id);

CREATE TABLE IF NOT EXISTS files
(
    id               UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    owner_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    filename         TEXT        NOT NULL,
    storage_path     TEXT        NOT NULL,
    mime_type        TEXT,
    size_bytes       BIGINT      NOT NULL,
    encrypted_key    bytea,
    encryption_nonce bytea,
    checksum         TEXT,
    folder_id        UUID        REFERENCES folders (id) ON DELETE SET NULL,
    note             TEXT,
    is_deleted       BOOLEAN     NOT NULL DEFAULT FALSE,
    is_public        BOOLEAN     NOT NULL DEFAULT FALSE,
    share_token      TEXT,
    share_expires_at timestamptz,
    share_download_limit INT,
    share_download_count INT         NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT NOW(),
    updated_at       timestamptz NOT NULL DEFAULT NOW(),
    deleted_at       timestamptz
);
CREATE INDEX idx_files_owner_id ON files (owner_id);
CREATE INDEX idx_files_folder_id ON files (folder_id);
CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files (deleted_at) WHERE is_deleted = TRUE;

CREATE TABLE IF NOT EXISTS refresh_tokens
(
    id         UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash TEXT        NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    session_expires_at timestamptz NOT NULL DEFAULT (NOW() + interval '90 days'),
    revoked    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens (user_id);

CREATE TABLE IF NOT EXISTS file_shares
(
    id                  UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    file_id             UUID        NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    shared_with_user_id UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    permission          TEXT        NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'write')),
    shared_by_user_id   UUID        NOT NULL REFERENCES users (id),
    created_at          timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (file_id, shared_with_user_id)
);

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
CREATE INDEX idx_audit_logs_user_id ON audit_logs (user_id);

CREATE TABLE IF NOT EXISTS groups
(
    id         UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    name       TEXT        NOT NULL,
    owner_id   UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members
(
    id        UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    group_id  UUID        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    user_id   UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role      TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin', 'owner')),
    joined_at timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (group_id, user_id)
);
CREATE INDEX idx_group_members_user_id ON group_members (user_id);

CREATE TABLE IF NOT EXISTS group_invitations
(
    id                 UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    group_id           UUID        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    invited_email      TEXT        NOT NULL,
    invited_by_user_id UUID        NOT NULL REFERENCES users (id),
    token              TEXT        NOT NULL UNIQUE,
    status             TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
    expires_at         timestamptz NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT NOW()
);

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
CREATE INDEX idx_notifications_user_id ON notifications (user_id, is_read);

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
    max_bytes  BIGINT      NOT NULL DEFAULT 5368709120, -- 5 GB
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

-- Migrations for existing dev databases
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token_expires_at timestamptz;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS session_expires_at timestamptz;
UPDATE refresh_tokens
SET session_expires_at = COALESCE(session_expires_at, created_at + interval '90 days', NOW() + interval '90 days')
WHERE session_expires_at IS NULL;
ALTER TABLE refresh_tokens ALTER COLUMN session_expires_at SET DEFAULT (NOW() + interval '90 days');
ALTER TABLE refresh_tokens ALTER COLUMN session_expires_at SET NOT NULL;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS user_agent;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS ip_address;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS device_id;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS ip_address;
ALTER TABLE files ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS share_expires_at timestamptz;
ALTER TABLE files ADD COLUMN IF NOT EXISTS share_download_limit INT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS share_download_count INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trash_retention_days INT NOT NULL DEFAULT 30;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS encrypted_key bytea;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS share_token TEXT;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS description TEXT;
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
CREATE TABLE IF NOT EXISTS favorites
(
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    file_id    UUID        NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, file_id)
);
