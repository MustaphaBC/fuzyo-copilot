-- Server-side chat threads + FK from chat_messages.
-- Apply in Supabase SQL Editor after 02_chat_messages.sql.

CREATE TABLE IF NOT EXISTS chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_threads_workspace_updated_idx
  ON chat_threads (workspace_id, updated_at DESC);

-- Backfill threads from existing message thread_ids (if any).
INSERT INTO chat_threads (id, workspace_id, title, created_at, updated_at)
SELECT
  cm.thread_id,
  cm.workspace_id,
  'Imported chat',
  MIN(cm.created_at),
  MAX(cm.created_at)
FROM chat_messages cm
WHERE NOT EXISTS (
  SELECT 1 FROM chat_threads ct WHERE ct.id = cm.thread_id
)
GROUP BY cm.thread_id, cm.workspace_id
ON CONFLICT (id) DO NOTHING;

-- Link messages to threads (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chat_messages_thread_id_fkey'
  ) THEN
    ALTER TABLE chat_messages
      ADD CONSTRAINT chat_messages_thread_id_fkey
      FOREIGN KEY (thread_id)
      REFERENCES chat_threads(id)
      ON DELETE CASCADE;
  END IF;
END $$;
