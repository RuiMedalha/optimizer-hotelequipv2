
-- Add soft-delete / archive columns to prompt_templates
ALTER TABLE public.prompt_templates 
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT null,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Add version_notes to prompt_versions
ALTER TABLE public.prompt_versions
  ADD COLUMN IF NOT EXISTS version_notes text DEFAULT null,
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT null;

-- Add cost_estimate and status to prompt_usage_logs for performance tracking
ALTER TABLE public.prompt_usage_logs
  ADD COLUMN IF NOT EXISTS cost_estimate numeric DEFAULT null,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS fallback_used boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) DEFAULT null;
