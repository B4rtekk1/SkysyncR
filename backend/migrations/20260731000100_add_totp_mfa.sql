CREATE TABLE IF NOT EXISTS user_totp (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_ciphertext BYTEA NOT NULL,
    secret_nonce BYTEA NOT NULL,
    enabled_at timestamptz,
    last_used_counter BIGINT,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS login_totp_challenges (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    remember BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at timestamptz NOT NULL,
    attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_totp_challenges_lookup
    ON login_totp_challenges (id, expires_at) WHERE used_at IS NULL;
