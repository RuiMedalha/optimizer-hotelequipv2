-- supabase/migrations/20260322000002_comparison_lifecycle.sql
--
-- Extends the AI comparison engine:
--   1. Adds 'failed' and 'partial' to ai_comparison_runs status enum
--   2. Adds error_message column to ai_comparison_runs
--   3. Creates ai_comparison_applications for audit trail of applied results
--
-- Idempotent.

-- 1. Extend status constraint
ALTER TABLE public.ai_comparison_runs
  DROP CONSTRAINT IF EXISTS ai_comparison_runs_status_check;

ALTER TABLE public.ai_comparison_runs
  ADD CONSTRAINT ai_comparison_runs_status_check
  CHECK (status IN ('running', 'completed', 'cancelled', 'failed', 'partial'));

-- 2. Add error_message
ALTER TABLE public.ai_comparison_runs
  ADD COLUMN IF NOT EXISTS error_message text;

-- 3. Audit trail table
CREATE TABLE IF NOT EXISTS public.ai_comparison_applications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES public.ai_comparison_runs(id)    ON DELETE CASCADE,
  result_id    uuid NOT NULL REFERENCES public.ai_comparison_results(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL,
  field_name   text NOT NULL,
  model_id     text NOT NULL,
  provider_id  text NOT NULL,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  applied_by   uuid
);

-- RLS
ALTER TABLE public.ai_comparison_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can view comparison applications"
  ON public.ai_comparison_applications FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_comparison_runs r
      WHERE r.id = run_id
        AND public.has_workspace_access(r.workspace_id, 'viewer')
    )
  );

CREATE POLICY "workspace members can insert comparison applications"
  ON public.ai_comparison_applications FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ai_comparison_runs r
      WHERE r.id = run_id
        AND public.has_workspace_access(r.workspace_id, 'editor')
    )
  );
