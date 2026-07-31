CREATE TABLE IF NOT EXISTS public_file_share_access_events
(
    id              UUID PRIMARY KEY,
    file_id         UUID        NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    share_token     TEXT        NOT NULL,
    recipient_email TEXT,
    user_agent      TEXT,
    accessed_at     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_file_share_access_events_file_accessed
    ON public_file_share_access_events (file_id, accessed_at DESC);

