
-- Enums
CREATE TYPE public.orchestration_run_type AS ENUM ('supplier_import', 'catalog_update', 'channel_sync');
CREATE TYPE public.orchestration_step_status AS ENUM ('pending', 'running', 'completed', 'failed', 'skipped');
CREATE TYPE public.orchestration_run_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

-- orchestration_runs
CREATE TABLE public.orchestration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  run_type orchestration_run_type NOT NULL,
  status orchestration_run_status NOT NULL DEFAULT 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  trigger_source text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.orchestration_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage orchestration_runs in their workspace" ON public.orchestration_runs FOR ALL TO authenticated USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- orchestration_steps
CREATE TABLE public.orchestration_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.orchestration_runs(id) ON DELETE CASCADE NOT NULL,
  step_type text NOT NULL,
  step_order int NOT NULL DEFAULT 0,
  status orchestration_step_status NOT NULL DEFAULT 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  result_payload jsonb,
  confidence_score numeric,
  error_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.orchestration_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage orchestration_steps via run" ON public.orchestration_steps FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.orchestration_runs r WHERE r.id = run_id AND public.has_workspace_access_hybrid(r.workspace_id, 'viewer')));

-- orchestration_policies
CREATE TABLE public.orchestration_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  policy_name text NOT NULL,
  policy_config jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.orchestration_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage orchestration_policies in their workspace" ON public.orchestration_policies FOR ALL TO authenticated USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- execution_decisions
CREATE TABLE public.execution_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.orchestration_runs(id) ON DELETE CASCADE NOT NULL,
  decision_type text NOT NULL,
  decision_reason text,
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.execution_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage execution_decisions via run" ON public.execution_decisions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.orchestration_runs r WHERE r.id = run_id AND public.has_workspace_access_hybrid(r.workspace_id, 'viewer')));
