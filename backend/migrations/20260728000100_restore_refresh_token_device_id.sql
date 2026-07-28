ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS device_id TEXT;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_device_active
    ON refresh_tokens (user_id, device_id)
    WHERE device_id IS NOT NULL
      AND revoked = FALSE;

WITH ranked_legacy_sessions AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY user_id, COALESCE(device_label, ''), COALESCE(ip_address, '')
            ORDER BY last_used_at DESC, created_at DESC, id DESC
        ) AS row_number
    FROM refresh_tokens
    WHERE device_id IS NULL
      AND revoked = FALSE
      AND expires_at > NOW()
      AND session_expires_at > NOW()
)
UPDATE refresh_tokens
SET revoked = TRUE
FROM ranked_legacy_sessions
WHERE refresh_tokens.id = ranked_legacy_sessions.id
  AND ranked_legacy_sessions.row_number > 1;
