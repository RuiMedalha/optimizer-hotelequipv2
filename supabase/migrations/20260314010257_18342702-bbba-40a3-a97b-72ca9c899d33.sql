
-- ai_usage_logs
CREATE TABLE public.ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  agent_id uuid REFERENCES public.agent_profiles(id) ON DELETE SET NULL,
  model_name text,
  input_tokens int DEFAULT 0,
  output_tokens int DEFAULT 0,
  vision_pages int DEFAULT 0,
  images_generated int DEFAULT 0,
  estimated_cost numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws access" ON public.ai_usage_logs FOR ALL TO authenticated USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- ai_execution_profiles
CREATE TABLE public.ai_execution_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  profile_name text NOT NULL,
  mode text NOT NULL DEFAULT 'balanced',
  model_preferences jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_execution_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws access" ON public.ai_execution_profiles FOR ALL TO authenticated USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- ai_retry_policies
CREATE TABLE public.ai_retry_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  policy_name text NOT NULL,
  retry_limit int NOT NULL DEFAULT 3,
  fallback_model text DEFAULT 'google/gemini-2.5-flash-lite',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_retry_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws access" ON public.ai_retry_policies FOR ALL TO authenticated USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
