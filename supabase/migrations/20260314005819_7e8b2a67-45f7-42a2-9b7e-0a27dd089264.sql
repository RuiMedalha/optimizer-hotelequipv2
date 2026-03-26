
-- agent_profiles
CREATE TABLE public.agent_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  agent_name text NOT NULL,
  agent_type text NOT NULL DEFAULT 'general',
  description text,
  default_prompt_template uuid REFERENCES public.prompt_templates(id) ON DELETE SET NULL,
  model_preference text DEFAULT 'google/gemini-2.5-flash',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws access" ON public.agent_profiles FOR ALL TO authenticated USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- agent_execution_logs
CREATE TABLE public.agent_execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agent_profiles(id) ON DELETE CASCADE NOT NULL,
  run_id uuid REFERENCES public.orchestration_runs(id) ON DELETE SET NULL,
  input_payload jsonb,
  output_payload jsonb,
  confidence_score numeric,
  execution_time int,
  cost_estimate numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_execution_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "access via agent" ON public.agent_execution_logs FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.agent_profiles a WHERE a.id = agent_id AND public.has_workspace_access_hybrid(a.workspace_id, 'viewer')));

-- agent_capabilities
CREATE TABLE public.agent_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agent_profiles(id) ON DELETE CASCADE NOT NULL,
  capability_name text NOT NULL,
  capability_description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_capabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "access via agent" ON public.agent_capabilities FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.agent_profiles a WHERE a.id = agent_id AND public.has_workspace_access_hybrid(a.workspace_id, 'viewer')));
