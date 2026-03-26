
-- BLOCO 9.4 — Catalog Brain Simulation Engine

DO $$ BEGIN CREATE TYPE public.simulation_type AS ENUM ('seo_simulation','feed_validation_simulation','conversion_simulation','pricing_simulation','bundle_simulation','translation_quality_simulation','image_quality_simulation','schema_validation_simulation'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.simulation_status AS ENUM ('pending','running','completed','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.simulation_result_type AS ENUM ('expected_improvement','expected_decline','neutral'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.risk_level AS ENUM ('low','medium','high'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1. Simulation Scenarios
CREATE TABLE IF NOT EXISTS public.catalog_simulation_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type public.brain_entity_type,
  entity_id uuid,
  simulation_type public.simulation_type NOT NULL,
  scenario_name text NOT NULL,
  input_data jsonb DEFAULT '{}',
  expected_changes jsonb DEFAULT '{}',
  created_by text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sim_scenarios_ws ON public.catalog_simulation_scenarios(workspace_id);
ALTER TABLE public.catalog_simulation_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage simulation scenarios" ON public.catalog_simulation_scenarios FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Simulation Runs
CREATE TABLE IF NOT EXISTS public.catalog_simulation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scenario_id uuid REFERENCES public.catalog_simulation_scenarios(id) ON DELETE CASCADE,
  status public.simulation_status DEFAULT 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  simulation_output jsonb,
  confidence integer DEFAULT 50,
  risk_level public.risk_level DEFAULT 'medium',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.catalog_simulation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage simulation runs" ON public.catalog_simulation_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Simulation Results
CREATE TABLE IF NOT EXISTS public.catalog_simulation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_run_id uuid NOT NULL REFERENCES public.catalog_simulation_runs(id) ON DELETE CASCADE,
  metric_type public.brain_outcome_type DEFAULT 'quality_score',
  baseline_value numeric DEFAULT 0,
  predicted_value numeric DEFAULT 0,
  delta numeric DEFAULT 0,
  result_type public.simulation_result_type DEFAULT 'neutral',
  confidence integer DEFAULT 50,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.catalog_simulation_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage simulation results" ON public.catalog_simulation_results FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. Expected Value Models
CREATE TABLE IF NOT EXISTS public.catalog_expected_value_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  model_name text NOT NULL,
  variables jsonb DEFAULT '{}',
  formula text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.catalog_expected_value_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage EV models" ON public.catalog_expected_value_models FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. Action Simulations
CREATE TABLE IF NOT EXISTS public.catalog_action_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.catalog_decisions(id) ON DELETE SET NULL,
  simulation_run_id uuid REFERENCES public.catalog_simulation_runs(id) ON DELETE SET NULL,
  expected_value numeric DEFAULT 0,
  risk_level public.risk_level DEFAULT 'medium',
  recommended boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.catalog_action_simulations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage action simulations" ON public.catalog_action_simulations FOR ALL TO authenticated USING (true) WITH CHECK (true);
