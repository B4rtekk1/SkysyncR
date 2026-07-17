CREATE INDEX IF NOT EXISTS idx_groups_owner_id ON groups (owner_id);
CREATE INDEX IF NOT EXISTS idx_group_invitations_group_id ON group_invitations (group_id);
