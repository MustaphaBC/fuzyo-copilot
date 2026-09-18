-- Thread pin support for sidebar Pinned / Recent sections.
ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS chat_threads_workspace_pinned_updated_idx
  ON chat_threads (workspace_id, is_pinned DESC, updated_at DESC);
