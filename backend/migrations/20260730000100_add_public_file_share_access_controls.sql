ALTER TABLE files ADD COLUMN IF NOT EXISTS share_password_hash TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS share_recipient_email TEXT;

CREATE INDEX IF NOT EXISTS idx_files_share_recipient_email
    ON files (share_recipient_email)
    WHERE share_recipient_email IS NOT NULL;
