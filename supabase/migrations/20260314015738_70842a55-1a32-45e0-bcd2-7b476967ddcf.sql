
-- ORQ-15: Agent Runtime Console

DO $$ BEGIN CREATE TYPE public.agent_run_status_enum AS ENUM ('queued','running','completed','partial','failed','fallback_completed','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.feedback_type_enum AS ENUM ('human_approved','human_rejected','auto_low_confidence','schema_fail','publish_fail','cost_too_high','latency_too_high'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.agent_alert_type_enum AS ENUM ('failure_spike','cost_spike','latency_spike','low_confidence_rate','fallback_rate_high'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  run_id uuid,
  agent_id uuid,
  agent_name text NOT NULL,
  agent_version text,
  prompt_version_id uuid,
  status public.agent_run_status_enum DEFAULT 'queued',
  input_payload jsonb DEFAULT '{}',
  output_payload jsonb DEFAULT '{}',
  confidence_score numeric,
  cost_estimate numeric,
  latency_ms integer,
  fallback_used boolean DEFAULT false,
  fallback_reason text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.agent_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id uuid REFERENCES public.agent_runs(id) ON DELETE CASCADE NOT NULL,
  step_name text NOT NULL,
  step_order integer DEFAULT 0,
  status text DEFAULT 'pending',
  input_payload jsonb DEFAULT '{}',
  output_payload jsonb DEFAULT '{}',
  error_payload jsonb,
  latency_ms integer,
  cost_estimate numeric,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_run_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id uuid REFERENCES public.agent_runs(id) ON DELETE CASCADE NOT NULL,
  feedback_type public.feedback_type_enum NOT NULL,
  feedback_score numeric,
  feedback_payload jsonb DEFAULT '{}',
  provided_by uuid,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_runtime_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  agent_id uuid,
  alert_type public.agent_alert_type_enum NOT NULL,
  severity integer DEFAULT 1,
  message text,
  status text DEFAULT 'open',
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_run_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runtime_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ar_runs_ws" ON public.agent_runs FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE POLICY "ar_steps_ws" ON public.agent_run_steps FOR ALL USING (
  EXISTS (SELECT 1 FROM public.agent_runs ar WHERE ar.id = agent_run_id AND public.has_workspace_access_hybrid(ar.workspace_id, 'viewer'))
);
CREATE POLICY "ar_feedback_ws" ON public.agent_run_feedback FOR ALL USING (
  EXISTS (SELECT 1 FROM public.agent_runs ar WHERE ar.id = agent_run_id AND public.has_workspace_access_hybrid(ar.workspace_id, 'viewer'))
);
CREATE POLICY "ar_alerts_ws" ON public.agent_runtime_alerts FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
