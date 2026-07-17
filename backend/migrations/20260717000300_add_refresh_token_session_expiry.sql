ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS session_expires_at timestamptz;

UPDATE refresh_tokens
SET session_expires_at = COALESCE(
    session_expires_at,
    created_at + interval '90 days',
    NOW() + interval '90 days'
)
WHERE session_expires_at IS NULL;

ALTER TABLE refresh_tokens ALTER COLUMN session_expires_at SET DEFAULT (NOW() + interval '90 days');
ALTER TABLE refresh_tokens ALTER COLUMN session_expires_at SET NOT NULL;
