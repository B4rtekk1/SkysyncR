ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS trusted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE refresh_token_activity_logs
    DROP CONSTRAINT IF EXISTS refresh_token_activity_logs_action_check;

ALTER TABLE refresh_token_activity_logs
    ADD CONSTRAINT refresh_token_activity_logs_action_check
    CHECK (action IN ('login', 'refresh', 'logout', 'logout_all', 'revoked', 'trust_changed'));
