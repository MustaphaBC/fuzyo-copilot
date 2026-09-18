-- Enterprise features: profiles sync + SDLC audit report on workspaces.
-- Apply after 05_thread_pins.sql.
-- Safe to re-run on DBs that already have a partial profiles table.

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  role VARCHAR(50) NOT NULL DEFAULT 'developer',
  organization TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Harden existing profiles rows created before migration 06 defaults.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role VARCHAR(50);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS organization TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.profiles
SET role = 'developer'
WHERE role IS NULL OR TRIM(role) = '';

ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'developer';

ALTER TABLE public.profiles
  ALTER COLUMN role SET NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, organization)
  VALUES (
    NEW.id,
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), ''),
    LOWER(
      COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), ''),
        'developer'
      )
    ),
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'organization', '')), '')
  )
  ON CONFLICT (id) DO UPDATE
    SET
      full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
      role = COALESCE(EXCLUDED.role, public.profiles.role),
      organization = COALESCE(EXCLUDED.organization, public.profiles.organization),
      updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS sdlc_audit_report JSONB;
