ALTER TABLE favorites
    DROP CONSTRAINT IF EXISTS favorites_pkey;

ALTER TABLE favorites
    ALTER COLUMN file_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders (id) ON DELETE CASCADE;

ALTER TABLE favorites
    DROP CONSTRAINT IF EXISTS favorites_one_target;

ALTER TABLE favorites
    ADD CONSTRAINT favorites_one_target CHECK (
        (file_id IS NOT NULL AND folder_id IS NULL)
        OR (file_id IS NULL AND folder_id IS NOT NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_file_unique
    ON favorites (user_id, file_id)
    WHERE file_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_folder_unique
    ON favorites (user_id, folder_id)
    WHERE folder_id IS NOT NULL;
