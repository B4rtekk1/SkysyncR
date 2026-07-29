CREATE TABLE IF NOT EXISTS folder_metadata_snapshots
(
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id        UUID        NOT NULL REFERENCES folders (id) ON DELETE CASCADE,
    owner_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name             TEXT        NOT NULL,
    description      TEXT,
    parent_folder_id UUID,
    encrypted_key    BYTEA,
    is_deleted       BOOLEAN     NOT NULL,
    deleted_at       timestamptz,
    folder_created_at timestamptz NOT NULL,
    captured_at      timestamptz NOT NULL DEFAULT NOW(),
    action           TEXT        NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folder_metadata_snapshots_folder_captured
    ON folder_metadata_snapshots (folder_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_folder_metadata_snapshots_owner_captured
    ON folder_metadata_snapshots (owner_id, captured_at);

CREATE TABLE IF NOT EXISTS file_metadata_snapshots
(
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id         UUID        NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    owner_id        UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    filename        TEXT        NOT NULL,
    folder_id       UUID,
    note            TEXT,
    is_deleted      BOOLEAN     NOT NULL,
    deleted_at      timestamptz,
    file_created_at timestamptz NOT NULL,
    captured_at     timestamptz NOT NULL DEFAULT NOW(),
    action          TEXT        NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_metadata_snapshots_file_captured
    ON file_metadata_snapshots (file_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_file_metadata_snapshots_owner_captured
    ON file_metadata_snapshots (owner_id, captured_at);

INSERT INTO folder_metadata_snapshots (
    folder_id,
    owner_id,
    name,
    description,
    parent_folder_id,
    encrypted_key,
    is_deleted,
    deleted_at,
    folder_created_at,
    captured_at,
    action
)
SELECT
    id,
    owner_id,
    name,
    description,
    parent_folder_id,
    encrypted_key,
    is_deleted,
    deleted_at,
    created_at,
    NOW(),
    'baseline'
FROM folders
ON CONFLICT DO NOTHING;

INSERT INTO file_metadata_snapshots (
    file_id,
    owner_id,
    filename,
    folder_id,
    note,
    is_deleted,
    deleted_at,
    file_created_at,
    captured_at,
    action
)
SELECT
    id,
    owner_id,
    filename,
    folder_id,
    note,
    is_deleted,
    deleted_at,
    created_at,
    NOW(),
    'baseline'
FROM files
ON CONFLICT DO NOTHING;
