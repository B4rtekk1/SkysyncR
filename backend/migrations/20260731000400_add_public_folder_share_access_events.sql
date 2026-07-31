CREATE TABLE IF NOT EXISTS public_folder_share_access_events
(
    id              UUID PRIMARY KEY,
    folder_id       UUID        NOT NULL REFERENCES folders (id) ON DELETE CASCADE,
    file_id         UUID        REFERENCES files (id) ON DELETE SET NULL,
    share_token     TEXT        NOT NULL,
    recipient_email TEXT,
    user_agent      TEXT,
    accessed_at     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_folder_share_access_events_folder_accessed
    ON public_folder_share_access_events (folder_id, accessed_at DESC);
