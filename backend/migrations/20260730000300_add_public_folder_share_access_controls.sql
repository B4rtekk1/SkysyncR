ALTER TABLE folders ADD COLUMN IF NOT EXISTS share_password_hash TEXT;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS share_recipient_email TEXT;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS share_starts_at TIMESTAMPTZ;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS share_download_limit INT;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS share_download_count INT NOT NULL DEFAULT 0;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS share_one_time BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_folders_share_recipient_email
    ON folders (share_recipient_email)
    WHERE share_recipient_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_folders_public_share_window
    ON folders (share_token, share_starts_at, share_expires_at)
    WHERE is_public = TRUE;
