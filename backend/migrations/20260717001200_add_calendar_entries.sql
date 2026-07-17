CREATE TABLE IF NOT EXISTS calendar_entries
(
    id         UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    owner_id   UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind       TEXT        NOT NULL CHECK (kind IN ('event', 'deadline')),
    date       TEXT        NOT NULL,
    time       TEXT        NOT NULL,
    title      TEXT        NOT NULL,
    note       TEXT        NOT NULL DEFAULT '',
    reminder   TEXT        NOT NULL DEFAULT '',
    file_id    UUID        REFERENCES files (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_entries_owner_date ON calendar_entries (owner_id, date);
