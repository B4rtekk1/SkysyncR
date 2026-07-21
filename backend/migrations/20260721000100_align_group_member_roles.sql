ALTER TABLE group_members DROP CONSTRAINT IF EXISTS group_members_role_check;

UPDATE group_members
SET role = CASE role
    WHEN 'owner' THEN 'admin'
    WHEN 'member' THEN 'viewer'
    ELSE role
END;

ALTER TABLE group_members ALTER COLUMN role SET DEFAULT 'viewer';
ALTER TABLE group_members
    ADD CONSTRAINT group_members_role_check CHECK (role IN ('viewer', 'editor', 'admin'));
