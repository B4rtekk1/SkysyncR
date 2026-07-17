CREATE TABLE IF NOT EXISTS file_shares
(
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id           UUID        NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    owner_id          UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    recipient_user_id UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    permission        TEXT        NOT NULL DEFAULT 'read',
    encrypted_key     BYTEA,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'file_shares'
          AND column_name = 'shared_by_user_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'file_shares'
          AND column_name = 'owner_id'
    ) THEN
        ALTER TABLE file_shares RENAME COLUMN shared_by_user_id TO owner_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'file_shares'
          AND column_name = 'shared_with_user_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'file_shares'
          AND column_name = 'recipient_user_id'
    ) THEN
        ALTER TABLE file_shares RENAME COLUMN shared_with_user_id TO recipient_user_id;
    END IF;
END $$;

ALTER TABLE file_shares ADD COLUMN IF NOT EXISTS encrypted_key BYTEA;
ALTER TABLE file_shares ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE SCHEMA IF NOT EXISTS migration_backups;

CREATE TABLE IF NOT EXISTS migration_backups.file_shares_missing_encrypted_key_20260717001400
(
    id UUID,
    file_id UUID,
    owner_id UUID,
    recipient_user_id UUID,
    permission TEXT,
    encrypted_key BYTEA,
    created_at timestamptz,
    updated_at timestamptz,
    backed_up_at timestamptz NOT NULL
);

INSERT INTO migration_backups.file_shares_missing_encrypted_key_20260717001400 (
    id,
    file_id,
    owner_id,
    recipient_user_id,
    permission,
    encrypted_key,
    created_at,
    updated_at,
    backed_up_at
)
SELECT
    id,
    file_id,
    owner_id,
    recipient_user_id,
    permission,
    encrypted_key,
    created_at,
    updated_at,
    NOW()
FROM file_shares
WHERE encrypted_key IS NULL;

DELETE FROM file_shares WHERE encrypted_key IS NULL;

ALTER TABLE file_shares ALTER COLUMN encrypted_key SET NOT NULL;
ALTER TABLE file_shares DROP CONSTRAINT IF EXISTS file_shares_permission_check;
ALTER TABLE file_shares ADD CONSTRAINT file_shares_permission_check CHECK (permission IN ('read', 'download', 'write'));
ALTER TABLE file_shares DROP CONSTRAINT IF EXISTS file_shares_not_self_check;
ALTER TABLE file_shares ADD CONSTRAINT file_shares_not_self_check CHECK (owner_id <> recipient_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_shares_unique_recipient ON file_shares (file_id, recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_file_shares_recipient ON file_shares (recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_file_shares_owner_file ON file_shares (owner_id, file_id);
