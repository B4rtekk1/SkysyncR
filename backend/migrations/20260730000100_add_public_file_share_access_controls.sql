ALTER TABLE files ADD COLUMN IF NOT EXISTS share_password_hash TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS share_recipient_email TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS share_starts_at TIMESTAMPTZ;
ALTER TABLE files ADD COLUMN IF NOT EXISTS share_one_time BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_files_share_recipient_email
    ON files (share_recipient_email)
    WHERE share_recipient_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_files_public_share_window
    ON files (share_token, share_starts_at, share_expires_at)
    WHERE is_public = TRUE;
