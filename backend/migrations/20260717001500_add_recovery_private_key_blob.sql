ALTER TABLE users
    ADD COLUMN IF NOT EXISTS encrypted_private_key_recovery TEXT NOT NULL DEFAULT '';
