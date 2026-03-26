
-- BLOCO 9.2 — Brain Decision Engine
-- Enums
DO $$ BEGIN
  CREATE TYPE public.decision_signal_type AS ENUM (
    'quality_issue','seo_opportunity','channel_rejection','missing_translation',
    'image_quality_problem','bundle_opportunity','upsell_opportunity','supplier_pattern',
    'pricing_opportunity','data_inconsistency','feed_error','schema_mismatch','duplicate_product'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.decision_priority_level AS ENUM ('low','medium','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.impact_dimension AS ENUM (
    'revenue','conversion','seo_visibility','channel_compliance','catalog_quality','automation_efficiency'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.decision_status AS ENUM ('pending','approved','rejected','executed','expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1. Decision Signals
CREATE TABLE IF NOT EXISTS public.catalog_decision_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type public.brain_entity_type,
  entity_id uuid,
  signal_type public.decision_signal_type NOT NULL,
  severity integer DEFAULT 50,
  confidence integer DEFAULT 50,
  payload jsonb,
  source text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decision_signals_ws ON public.catalog_decision_signals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_decision_signals_entity ON public.catalog_decision_signals(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_decision_signals_type ON public.catalog_decision_signals(signal_type);
ALTER TABLE public.catalog_decision_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage decision signals" ON public.catalog_decision_signals FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Impact Models
CREATE TABLE IF NOT EXISTS public.impact_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  model_name text NOT NULL,
  dimension public.impact_dimension NOT NULL,
  weight numeric DEFAULT 0.1,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.impact_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage impact models" ON public.impact_models FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Impact Evaluations
CREATE TABLE IF NOT EXISTS public.catalog_impact_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type public.brain_entity_type,
  entity_id uuid,
  signal_id uuid REFERENCES public.catalog_decision_signals(id) ON DELETE CASCADE,
  impact_dimension public.impact_dimension NOT NULL,
  impact_score numeric DEFAULT 0,
  confidence integer DEFAULT 50,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.catalog_impact_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage impact evaluations" ON public.catalog_impact_evaluations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. Decisions
CREATE TABLE IF NOT EXISTS public.catalog_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type public.brain_entity_type,
  entity_id uuid,
  decision_type text,
  priority_score numeric DEFAULT 0,
  impact_score numeric DEFAULT 0,
  confidence integer DEFAULT 50,
  priority_level public.decision_priority_level DEFAULT 'medium',
  status public.decision_status DEFAULT 'pending',
  decision_context jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decisions_ws ON public.catalog_decisions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_decisions_priority ON public.catalog_decisions(priority_level);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON public.catalog_decisions(status);
ALTER TABLE public.catalog_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage decisions" ON public.catalog_decisions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. Decision Policies
CREATE TABLE IF NOT EXISTS public.brain_decision_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  policy_name text NOT NULL,
  conditions jsonb DEFAULT '{}',
  allowed_actions jsonb DEFAULT '{}',
  requires_human_review boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.brain_decision_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage decision policies" ON public.brain_decision_policies FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. Economic Models
CREATE TABLE IF NOT EXISTS public.catalog_economic_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  model_name text NOT NULL,
  variables jsonb DEFAULT '{}',
  formula text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.catalog_economic_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage economic models" ON public.catalog_economic_models FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 7. Decision Explanations
CREATE TABLE IF NOT EXISTS public.decision_explanations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES public.catalog_decisions(id) ON DELETE CASCADE,
  explanation jsonb DEFAULT '{}',
  confidence integer DEFAULT 50,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.decision_explanations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage decision explanations" ON public.decision_explanations FOR ALL TO authenticated USING (true) WITH CHECK (true);
