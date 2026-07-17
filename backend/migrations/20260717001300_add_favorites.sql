CREATE TABLE IF NOT EXISTS favorites
(
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    file_id    UUID        NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, file_id)
);
