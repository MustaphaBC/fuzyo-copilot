-- Bind workspaces to Supabase Auth users.
-- Apply in Supabase SQL Editor after prior migrations.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS workspaces_owner_idx
  ON workspaces (owner_id);

-- Orphan rows (owner_id IS NULL) remain but are invisible to authenticated API lists.
