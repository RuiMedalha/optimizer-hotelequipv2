
-- ============================================
-- AI PROVIDER CENTER: Unified provider management
-- ============================================

CREATE TABLE IF NOT EXISTS public.ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider_name text NOT NULL,
  provider_type text NOT NULL DEFAULT 'lovable_gateway',
  base_url text,
  organization_id text,
  default_model text,
  fallback_model text,
  timeout_seconds integer NOT NULL DEFAULT 60,
  priority_order integer NOT NULL DEFAULT 10,
  is_active boolean NOT NULL DEFAULT true,
  supports_text boolean NOT NULL DEFAULT true,
  supports_vision boolean NOT NULL DEFAULT false,
  supports_json_schema boolean NOT NULL DEFAULT false,
  supports_translation boolean NOT NULL DEFAULT false,
  supports_embeddings boolean NOT NULL DEFAULT false,
  supports_audio boolean NOT NULL DEFAULT false,
  supports_function_calling boolean NOT NULL DEFAULT false,
  last_health_check timestamptz,
  last_health_status text,
  last_error text,
  avg_latency_ms numeric,
  success_rate numeric,
  config jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage workspace ai_providers"
  ON public.ai_providers FOR ALL TO authenticated
  USING (public.has_workspace_access(workspace_id, 'viewer'))
  WITH CHECK (public.can_manage_workspace(workspace_id));

-- ============================================
-- MODEL CATALOG: Global model metadata
-- ============================================

CREATE TABLE IF NOT EXISTS public.ai_model_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider_type text NOT NULL,
  model_id text NOT NULL,
  display_name text NOT NULL,
  supports_text boolean NOT NULL DEFAULT true,
  supports_vision boolean NOT NULL DEFAULT false,
  supports_structured_output boolean NOT NULL DEFAULT false,
  supports_json_schema boolean NOT NULL DEFAULT false,
  supports_tool_calls boolean NOT NULL DEFAULT false,
  cost_input_per_mtok numeric DEFAULT 0,
  cost_output_per_mtok numeric DEFAULT 0,
  speed_rating integer DEFAULT 5 CHECK (speed_rating BETWEEN 1 AND 10),
  accuracy_rating integer DEFAULT 5 CHECK (accuracy_rating BETWEEN 1 AND 10),
  max_context_tokens integer,
  is_global boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_model_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view model catalog"
  ON public.ai_model_catalog FOR SELECT TO authenticated
  USING (is_global = true OR public.has_workspace_access(workspace_id, 'viewer'));

CREATE POLICY "Admins can manage model catalog"
  ON public.ai_model_catalog FOR ALL TO authenticated
  USING (is_global = true OR public.can_manage_workspace(workspace_id))
  WITH CHECK (public.can_manage_workspace(workspace_id));

-- ============================================
-- AI ROUTING TABLE: task_type → prompt + provider + model
-- ============================================

CREATE TABLE IF NOT EXISTS public.ai_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  display_name text NOT NULL,
  prompt_template_id uuid REFERENCES public.prompt_templates(id),
  provider_id uuid REFERENCES public.ai_providers(id),
  model_override text,
  recommended_model text,
  fallback_provider_id uuid REFERENCES public.ai_providers(id),
  fallback_model text,
  is_active boolean NOT NULL DEFAULT true,
  execution_priority integer NOT NULL DEFAULT 50,
  config jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, task_type)
);

ALTER TABLE public.ai_routing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage workspace ai_routing_rules"
  ON public.ai_routing_rules FOR ALL TO authenticated
  USING (public.has_workspace_access(workspace_id, 'viewer'))
  WITH CHECK (public.can_manage_workspace(workspace_id));

-- ============================================
-- AI PROVIDER HEALTH LOG
-- ============================================

CREATE TABLE IF NOT EXISTS public.ai_provider_health_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.ai_providers(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status text NOT NULL,
  latency_ms integer,
  error_message text,
  model_tested text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_provider_health_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view provider health logs"
  ON public.ai_provider_health_log FOR SELECT TO authenticated
  USING (public.has_workspace_access(workspace_id, 'viewer'));

CREATE POLICY "System can insert health logs"
  ON public.ai_provider_health_log FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access(workspace_id, 'viewer'));
