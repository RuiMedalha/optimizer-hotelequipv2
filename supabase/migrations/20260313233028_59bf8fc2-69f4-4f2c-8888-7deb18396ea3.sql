
-- BLOCO 9.3 — Catalog Brain Learning Engine

-- Enums
DO $$ BEGIN CREATE TYPE public.learning_signal_type AS ENUM ('human_approval','human_rejection','performance_improvement','performance_degradation','channel_acceptance','channel_rejection','seo_improvement','conversion_change','revenue_change','workflow_speed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.learning_feedback_type AS ENUM ('explicit_feedback','implicit_feedback','system_observation'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.learning_outcome_type AS ENUM ('positive','neutral','negative'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.learning_model_type AS ENUM ('impact_weight_adjustment','decision_pattern_learning','supplier_pattern_learning','channel_behavior_learning','translation_quality_learning','bundle_success_learning'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1. Learning Signals
CREATE TABLE IF NOT EXISTS public.catalog_learning_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type public.brain_entity_type,
  entity_id uuid,
  signal_type public.learning_signal_type NOT NULL,
  feedback_type public.learning_feedback_type NOT NULL DEFAULT 'system_observation',
  signal_strength numeric DEFAULT 0,
  metadata jsonb,
  source text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_learning_signals_ws ON public.catalog_learning_signals(workspace_id);
ALTER TABLE public.catalog_learning_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage learning signals" ON public.catalog_learning_signals FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Outcome Tracking
CREATE TABLE IF NOT EXISTS public.catalog_outcome_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.catalog_brain_plans(id) ON DELETE SET NULL,
  entity_type public.brain_entity_type,
  entity_id uuid,
  metric_type public.learning_outcome_type DEFAULT 'neutral',
  baseline_value numeric,
  new_value numeric,
  delta numeric,
  confidence integer DEFAULT 50,
  measured_at timestamptz DEFAULT now(),
  metadata jsonb
);
ALTER TABLE public.catalog_outcome_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage outcome tracking" ON public.catalog_outcome_tracking FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Decision Performance History
CREATE TABLE IF NOT EXISTS public.decision_performance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.catalog_decisions(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES public.catalog_brain_plans(id) ON DELETE SET NULL,
  expected_impact numeric DEFAULT 0,
  actual_impact numeric DEFAULT 0,
  confidence integer DEFAULT 50,
  learning_outcome public.learning_outcome_type DEFAULT 'neutral',
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.decision_performance_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage perf history" ON public.decision_performance_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. Policy Adjustments
CREATE TABLE IF NOT EXISTS public.brain_policy_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES public.brain_decision_policies(id) ON DELETE SET NULL,
  adjustment_reason text,
  old_configuration jsonb,
  new_configuration jsonb,
  confidence integer DEFAULT 50,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.brain_policy_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage policy adjustments" ON public.brain_policy_adjustments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. Reinforcement Memory
CREATE TABLE IF NOT EXISTS public.catalog_reinforcement_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  decision_type text,
  context_features jsonb,
  action_taken text,
  reward numeric DEFAULT 0,
  confidence integer DEFAULT 50,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reinforcement_ws ON public.catalog_reinforcement_memory(workspace_id);
ALTER TABLE public.catalog_reinforcement_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage reinforcement memory" ON public.catalog_reinforcement_memory FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. Learning Models
CREATE TABLE IF NOT EXISTS public.catalog_learning_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  model_type public.learning_model_type NOT NULL,
  model_parameters jsonb DEFAULT '{}',
  last_trained_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.catalog_learning_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage learning models" ON public.catalog_learning_models FOR ALL TO authenticated USING (true) WITH CHECK (true);
