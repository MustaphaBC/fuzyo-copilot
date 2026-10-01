-- Per-user UI / privacy preferences (Settings page).
-- Apply after 06_enterprise_features.sql. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_settings_self_select ON public.user_settings;
CREATE POLICY user_settings_self_select ON public.user_settings
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_settings_self_upsert ON public.user_settings;
CREATE POLICY user_settings_self_upsert ON public.user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_settings_self_update ON public.user_settings;
CREATE POLICY user_settings_self_update ON public.user_settings
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
