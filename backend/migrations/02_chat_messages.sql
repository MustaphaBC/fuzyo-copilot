-- Chat message history (thread list remains client-side localStorage).
-- Apply in Supabase SQL Editor after 01_init_schema.sql.

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL DEFAULT '',
  routing_badge TEXT NULL,
  sdlc_phase INT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sort_index INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS chat_messages_thread_idx
  ON chat_messages (workspace_id, thread_id, sort_index);
