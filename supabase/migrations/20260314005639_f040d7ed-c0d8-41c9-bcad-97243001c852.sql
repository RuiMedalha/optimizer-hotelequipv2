
-- prompt_templates
CREATE TABLE public.prompt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  prompt_name text NOT NULL,
  prompt_type text NOT NULL DEFAULT 'general',
  base_prompt text NOT NULL DEFAULT '',
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prompt_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws access" ON public.prompt_templates FOR ALL TO authenticated USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- prompt_versions
CREATE TABLE public.prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES public.prompt_templates(id) ON DELETE CASCADE NOT NULL,
  version_number int NOT NULL DEFAULT 1,
  prompt_text text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "access via template" ON public.prompt_versions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.prompt_templates t WHERE t.id = template_id AND public.has_workspace_access_hybrid(t.workspace_id, 'viewer')));

-- prompt_usage_logs
CREATE TABLE public.prompt_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_version_id uuid REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  agent_name text,
  input_size int,
  output_size int,
  execution_time int,
  confidence_score numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prompt_usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "access via version" ON public.prompt_usage_logs FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.prompt_versions v JOIN public.prompt_templates t ON t.id = v.template_id WHERE v.id = prompt_version_id AND public.has_workspace_access_hybrid(t.workspace_id, 'viewer')));

-- prompt_overrides
CREATE TABLE public.prompt_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  supplier_id text,
  category_id uuid,
  prompt_version_id uuid REFERENCES public.prompt_versions(id) ON DELETE CASCADE,
  override_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prompt_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws access" ON public.prompt_overrides FOR ALL TO authenticated USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
