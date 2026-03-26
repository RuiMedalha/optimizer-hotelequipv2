
-- ORQ-11: Execution Planner & AI Routing

-- Enums
CREATE TYPE public.plan_type_enum AS ENUM ('ingestion','canonical_assembly','enrichment','validation','translation','asset_processing','publish','sync','review_support');
CREATE TYPE public.execution_mode_enum AS ENUM ('economic','balanced','premium','manual_safe','auto_fast');
CREATE TYPE public.executor_type_enum AS ENUM ('rules_engine','ai_text','ai_vision','ocr','human_review','api_connector','internal_function');
CREATE TYPE public.failure_type_enum AS ENUM ('timeout','low_confidence','schema_failure','provider_error','rate_limit','invalid_output','missing_assets','conflict_unresolved');
CREATE TYPE public.outcome_type_enum AS ENUM ('success','partial_success','fallback_used','retry_used','escalated_to_human','blocked');

-- execution_plans
CREATE TABLE public.execution_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.orchestration_runs(id) ON DELETE SET NULL,
  plan_type public.plan_type_enum NOT NULL DEFAULT 'enrichment',
  execution_mode public.execution_mode_enum NOT NULL DEFAULT 'balanced',
  status TEXT NOT NULL DEFAULT 'pending',
  estimated_cost NUMERIC DEFAULT 0,
  estimated_duration_ms INTEGER DEFAULT 0,
  actual_cost NUMERIC,
  actual_duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_execution_plans_workspace ON public.execution_plans(workspace_id);
CREATE INDEX idx_execution_plans_run ON public.execution_plans(run_id);
CREATE INDEX idx_execution_plans_status ON public.execution_plans(status);
ALTER TABLE public.execution_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage execution_plans in their workspace" ON public.execution_plans FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- execution_plan_steps
CREATE TABLE public.execution_plan_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.execution_plans(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL DEFAULT 0,
  step_name TEXT NOT NULL,
  executor_type public.executor_type_enum NOT NULL DEFAULT 'rules_engine',
  executor_target TEXT NOT NULL DEFAULT '',
  model_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  estimated_cost NUMERIC DEFAULT 0,
  actual_cost NUMERIC,
  estimated_duration_ms INTEGER DEFAULT 0,
  actual_duration_ms INTEGER,
  input_scope JSONB DEFAULT '{}',
  output_scope JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_execution_plan_steps_plan ON public.execution_plan_steps(plan_id);
ALTER TABLE public.execution_plan_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage execution_plan_steps via plan" ON public.execution_plan_steps FOR ALL USING (
  EXISTS (SELECT 1 FROM public.execution_plans ep WHERE ep.id = plan_id AND public.has_workspace_access_hybrid(ep.workspace_id, 'viewer'))
);

-- ai_routing_policies
CREATE TABLE public.ai_routing_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  policy_name TEXT NOT NULL,
  context_type TEXT NOT NULL DEFAULT 'enrichment',
  routing_rules JSONB DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_routing_policies_workspace ON public.ai_routing_policies(workspace_id);
ALTER TABLE public.ai_routing_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage ai_routing_policies in their workspace" ON public.ai_routing_policies FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- execution_fallback_rules
CREATE TABLE public.execution_fallback_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  failure_type public.failure_type_enum NOT NULL,
  primary_executor TEXT NOT NULL,
  fallback_executor TEXT NOT NULL,
  max_retries INTEGER NOT NULL DEFAULT 2,
  cooldown_seconds INTEGER NOT NULL DEFAULT 5,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_execution_fallback_rules_workspace ON public.execution_fallback_rules(workspace_id);
ALTER TABLE public.execution_fallback_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage execution_fallback_rules in their workspace" ON public.execution_fallback_rules FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- model_capability_matrix
CREATE TABLE public.model_capability_matrix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name TEXT NOT NULL,
  provider_name TEXT NOT NULL DEFAULT 'lovable',
  supports_text BOOLEAN NOT NULL DEFAULT true,
  supports_vision BOOLEAN NOT NULL DEFAULT false,
  supports_json_schema BOOLEAN NOT NULL DEFAULT false,
  supports_translation BOOLEAN NOT NULL DEFAULT false,
  supports_image_generation BOOLEAN NOT NULL DEFAULT false,
  relative_cost_score NUMERIC NOT NULL DEFAULT 5,
  relative_latency_score NUMERIC NOT NULL DEFAULT 5,
  quality_score NUMERIC NOT NULL DEFAULT 5,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_model_capability_matrix_model ON public.model_capability_matrix(model_name);
ALTER TABLE public.model_capability_matrix ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read model_capability_matrix" ON public.model_capability_matrix FOR SELECT TO authenticated USING (true);

-- execution_outcomes
CREATE TABLE public.execution_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.execution_plans(id) ON DELETE CASCADE,
  step_id UUID REFERENCES public.execution_plan_steps(id) ON DELETE SET NULL,
  outcome_type public.outcome_type_enum NOT NULL DEFAULT 'success',
  success BOOLEAN NOT NULL DEFAULT true,
  confidence_score NUMERIC,
  cost NUMERIC,
  latency_ms INTEGER,
  error_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_execution_outcomes_plan ON public.execution_outcomes(plan_id);
ALTER TABLE public.execution_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage execution_outcomes via plan" ON public.execution_outcomes FOR ALL USING (
  EXISTS (SELECT 1 FROM public.execution_plans ep WHERE ep.id = plan_id AND public.has_workspace_access_hybrid(ep.workspace_id, 'viewer'))
);

-- Seed model capability matrix
INSERT INTO public.model_capability_matrix (model_name, provider_name, supports_text, supports_vision, supports_json_schema, supports_translation, supports_image_generation, relative_cost_score, relative_latency_score, quality_score) VALUES
('google/gemini-2.5-flash-lite', 'google', true, false, true, true, false, 1, 1, 5),
('google/gemini-2.5-flash', 'google', true, true, true, true, false, 3, 3, 7),
('google/gemini-2.5-pro', 'google', true, true, true, true, false, 8, 7, 9),
('google/gemini-3-flash-preview', 'google', true, true, true, true, false, 4, 3, 8),
('openai/gpt-5-nano', 'openai', true, false, true, true, false, 2, 2, 5),
('openai/gpt-5-mini', 'openai', true, true, true, true, false, 4, 4, 7),
('openai/gpt-5', 'openai', true, true, true, true, false, 9, 8, 9);
