CREATE TABLE IF NOT EXISTS folder_group_shares
(
    id                 UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    folder_id          UUID        NOT NULL REFERENCES folders (id) ON DELETE CASCADE,
    owner_id           UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    group_id           UUID        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    permission         TEXT        NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'edit', 'manage')),
    created_by_user_id UUID        REFERENCES users (id) ON DELETE SET NULL,
    updated_by_user_id UUID        REFERENCES users (id) ON DELETE SET NULL,
    created_at         timestamptz NOT NULL DEFAULT NOW(),
    updated_at         timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (folder_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_folder_group_shares_owner_folder
    ON folder_group_shares (owner_id, folder_id);

CREATE INDEX IF NOT EXISTS idx_folder_group_shares_group
    ON folder_group_shares (group_id);

CREATE TABLE IF NOT EXISTS folder_group_share_events
(
    id                  UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    folder_id           UUID        NOT NULL REFERENCES folders (id) ON DELETE CASCADE,
    group_id            UUID        REFERENCES groups (id) ON DELETE SET NULL,
    actor_user_id       UUID        REFERENCES users (id) ON DELETE SET NULL,
    action              TEXT        NOT NULL CHECK (action IN ('grant', 'update', 'revoke')),
    previous_permission TEXT        CHECK (previous_permission IN ('read', 'edit', 'manage')),
    new_permission      TEXT        CHECK (new_permission IN ('read', 'edit', 'manage')),
    created_at          timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_folder_group_share_events_folder_created
    ON folder_group_share_events (folder_id, created_at DESC);
