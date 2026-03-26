
-- ENUMS
CREATE TYPE public.twin_entity_type AS ENUM ('product','product_family','variant','category','asset','channel','schema','bundle','translation');
CREATE TYPE public.twin_scenario_type AS ENUM ('seo_optimization','bundle_creation','price_adjustment','taxonomy_change','translation_rollout','image_replacement','channel_publish','schema_update','catalog_reorganization');
CREATE TYPE public.twin_scenario_status AS ENUM ('draft','running','completed','failed','promoted');
CREATE TYPE public.twin_result_type AS ENUM ('expected_improvement','expected_decline','neutral');

-- TWIN SNAPSHOTS
CREATE TABLE public.catalog_twin_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  snapshot_name text,
  snapshot_metadata jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.catalog_twin_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own workspace twin snapshots" ON public.catalog_twin_snapshots FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- CATALOG TWINS
CREATE TABLE public.catalog_twins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  twin_name text,
  description text,
  source_snapshot_id uuid REFERENCES public.catalog_twin_snapshots(id),
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.catalog_twins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own workspace twins" ON public.catalog_twins FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- TWIN ENTITIES
CREATE TABLE public.catalog_twin_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twin_id uuid NOT NULL REFERENCES public.catalog_twins(id) ON DELETE CASCADE,
  entity_type public.twin_entity_type,
  entity_id uuid,
  canonical_data jsonb,
  channel_data jsonb,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_twin_entities_lookup ON public.catalog_twin_entities(twin_id, entity_type, entity_id);
ALTER TABLE public.catalog_twin_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage twin entities via twin" ON public.catalog_twin_entities FOR ALL TO authenticated USING (twin_id IN (SELECT id FROM public.catalog_twins WHERE workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()))) WITH CHECK (twin_id IN (SELECT id FROM public.catalog_twins WHERE workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())));

-- TWIN RELATIONS
CREATE TABLE public.catalog_twin_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twin_id uuid NOT NULL REFERENCES public.catalog_twins(id) ON DELETE CASCADE,
  from_entity_id uuid,
  to_entity_id uuid,
  relation_type text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.catalog_twin_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage twin relations via twin" ON public.catalog_twin_relations FOR ALL TO authenticated USING (twin_id IN (SELECT id FROM public.catalog_twins WHERE workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()))) WITH CHECK (twin_id IN (SELECT id FROM public.catalog_twins WHERE workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())));

-- TWIN SCENARIOS
CREATE TABLE public.catalog_twin_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twin_id uuid NOT NULL REFERENCES public.catalog_twins(id) ON DELETE CASCADE,
  scenario_type public.twin_scenario_type,
  scenario_name text,
  input_parameters jsonb,
  status public.twin_scenario_status DEFAULT 'draft',
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.catalog_twin_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage twin scenarios via twin" ON public.catalog_twin_scenarios FOR ALL TO authenticated USING (twin_id IN (SELECT id FROM public.catalog_twins WHERE workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()))) WITH CHECK (twin_id IN (SELECT id FROM public.catalog_twins WHERE workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())));

-- TWIN ACTIONS
CREATE TABLE public.catalog_twin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL REFERENCES public.catalog_twin_scenarios(id) ON DELETE CASCADE,
  action_type text,
  target_entity_type public.twin_entity_type,
  target_entity_id uuid,
  action_payload jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.catalog_twin_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage twin actions via scenario" ON public.catalog_twin_actions FOR ALL TO authenticated USING (scenario_id IN (SELECT id FROM public.catalog_twin_scenarios WHERE twin_id IN (SELECT id FROM public.catalog_twins WHERE workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())))) WITH CHECK (scenario_id IN (SELECT id FROM public.catalog_twin_scenarios WHERE twin_id IN (SELECT id FROM public.catalog_twins WHERE workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()))));

-- TWIN RESULTS
CREATE TABLE public.catalog_twin_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL REFERENCES public.catalog_twin_scenarios(id) ON DELETE CASCADE,
  metric_type public.learning_outcome_type,
  baseline_value numeric,
  predicted_value numeric,
  delta numeric,
  result_type public.twin_result_type,
  confidence integer,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.catalog_twin_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage twin results via scenario" ON public.catalog_twin_results FOR ALL TO authenticated USING (scenario_id IN (SELECT id FROM public.catalog_twin_scenarios WHERE twin_id IN (SELECT id FROM public.catalog_twins WHERE workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())))) WITH CHECK (scenario_id IN (SELECT id FROM public.catalog_twin_scenarios WHERE twin_id IN (SELECT id FROM public.catalog_twins WHERE workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()))));

-- TWIN COMPARISONS
CREATE TABLE public.catalog_twin_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twin_id uuid NOT NULL REFERENCES public.catalog_twins(id) ON DELETE CASCADE,
  scenario_a_id uuid,
  scenario_b_id uuid,
  comparison_result jsonb,
  recommended_scenario uuid,
  confidence integer,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.catalog_twin_comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage twin comparisons via twin" ON public.catalog_twin_comparisons FOR ALL TO authenticated USING (twin_id IN (SELECT id FROM public.catalog_twins WHERE workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()))) WITH CHECK (twin_id IN (SELECT id FROM public.catalog_twins WHERE workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())));
