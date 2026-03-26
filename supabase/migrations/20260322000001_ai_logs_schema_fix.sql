-- supabase/migrations/20260322000001_ai_logs_schema_fix.sql
--
-- Adds two missing tracing columns:
--   1. ai_usage_logs.prompt_version_id — code already writes this; column was never created
--   2. optimization_logs.provider_id   — tracks which provider actually ran (not just model)
--
-- Idempotent (uses ADD COLUMN IF NOT EXISTS).

ALTER TABLE public.ai_usage_logs
  ADD COLUMN IF NOT EXISTS prompt_version_id uuid
    REFERENCES public.prompt_versions(id) ON DELETE SET NULL;

ALTER TABLE public.optimization_logs
  ADD COLUMN IF NOT EXISTS provider_id text;
