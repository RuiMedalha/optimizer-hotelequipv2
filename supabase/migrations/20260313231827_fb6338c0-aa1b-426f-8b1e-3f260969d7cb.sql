
-- BLOCO 9 Extension: AI Catalog Brain Core

-- Enums
CREATE TYPE public.brain_entity_type AS ENUM (
  'product','category','supplier','channel','bundle','cluster','attribute','image','translation'
);
CREATE TYPE public.brain_relation_type AS ENUM (
  'belongs_to','similar_to','complementary','competes_with','variant_of','accessory_for',
  'bundled_with','upsell_for','cross_sell_for','same_supplier','same_category'
);
CREATE TYPE public.brain_observation_type AS ENUM (
  'quality_gate_fail','review_correction','seo_weakness','missing_attribute',
  'channel_rejection','low_conversion','price_anomaly','image_issue',
  'translation_gap','feed_error','duplicate_detected','supplier_signal'
);
CREATE TYPE public.brain_plan_status AS ENUM ('draft','ready','running','completed','failed','cancelled');
CREATE TYPE public.brain_step_status AS ENUM ('pending','running','completed','failed','skipped');
CREATE TYPE public.brain_outcome_type AS ENUM (
  'improvement','degradation','neutral','pending_measurement'
);
CREATE TYPE public.brain_cluster_type AS ENUM (
  'performance_cluster','attribute_cluster','price_cluster','category_cluster',
  'supplier_cluster','behavior_cluster','opportunity_cluster'
);

-- 1. catalog_brain_entities
CREATE TABLE public.catalog_brain_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type brain_entity_type NOT NULL,
  entity_id uuid NOT NULL,
  entity_label text,
  metadata jsonb DEFAULT '{}',
  embedding jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catalog_brain_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brain_entities_ws" ON public.catalog_brain_entities FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 2. catalog_brain_relations
CREATE TABLE public.catalog_brain_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_entity_id uuid NOT NULL REFERENCES public.catalog_brain_entities(id) ON DELETE CASCADE,
  target_entity_id uuid NOT NULL REFERENCES public.catalog_brain_entities(id) ON DELETE CASCADE,
  relation_type brain_relation_type NOT NULL,
  weight numeric DEFAULT 1.0,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catalog_brain_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brain_relations_ws" ON public.catalog_brain_relations FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 3. catalog_brain_observations
CREATE TABLE public.catalog_brain_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  observation_type brain_observation_type NOT NULL,
  entity_id uuid REFERENCES public.catalog_brain_entities(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  signal_source text,
  signal_payload jsonb DEFAULT '{}',
  severity integer DEFAULT 50,
  processed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catalog_brain_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brain_observations_ws" ON public.catalog_brain_observations FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 4. catalog_brain_plans
CREATE TABLE public.catalog_brain_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_name text NOT NULL,
  plan_description text,
  status brain_plan_status NOT NULL DEFAULT 'draft',
  priority integer DEFAULT 100,
  estimated_impact jsonb DEFAULT '{}',
  confidence integer DEFAULT 0,
  policy_checks jsonb DEFAULT '{}',
  requires_approval boolean NOT NULL DEFAULT true,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
ALTER TABLE public.catalog_brain_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brain_plans_ws" ON public.catalog_brain_plans FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 5. catalog_brain_plan_steps
CREATE TABLE public.catalog_brain_plan_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.catalog_brain_plans(id) ON DELETE CASCADE,
  step_order integer NOT NULL DEFAULT 1,
  step_type text NOT NULL,
  step_description text,
  status brain_step_status NOT NULL DEFAULT 'pending',
  depends_on uuid[] DEFAULT '{}',
  input_payload jsonb DEFAULT '{}',
  output_payload jsonb,
  agent_id uuid REFERENCES public.catalog_agents(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text
);
ALTER TABLE public.catalog_brain_plan_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brain_steps_ws" ON public.catalog_brain_plan_steps FOR ALL USING (
  EXISTS (SELECT 1 FROM public.catalog_brain_plans p WHERE p.id = plan_id AND public.has_workspace_access_hybrid(p.workspace_id, 'viewer'))
);

-- 6. catalog_brain_outcomes
CREATE TABLE public.catalog_brain_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.catalog_brain_plans(id) ON DELETE SET NULL,
  step_id uuid REFERENCES public.catalog_brain_plan_steps(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  outcome_type brain_outcome_type NOT NULL DEFAULT 'pending_measurement',
  metrics_before jsonb DEFAULT '{}',
  metrics_after jsonb DEFAULT '{}',
  impact_score numeric DEFAULT 0,
  feedback_human text,
  feedback_rating integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  measured_at timestamptz
);
ALTER TABLE public.catalog_brain_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brain_outcomes_ws" ON public.catalog_brain_outcomes FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 7. product_dna_profiles
CREATE TABLE public.product_dna_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  technical_dna jsonb DEFAULT '{}',
  commercial_dna jsonb DEFAULT '{}',
  visual_dna jsonb DEFAULT '{}',
  linguistic_dna jsonb DEFAULT '{}',
  channel_dna jsonb DEFAULT '{}',
  completeness_score numeric DEFAULT 0,
  quality_score numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id)
);
ALTER TABLE public.product_dna_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_dna_ws" ON public.product_dna_profiles FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 8. catalog_clusters
CREATE TABLE public.catalog_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  cluster_type brain_cluster_type NOT NULL,
  cluster_name text NOT NULL,
  cluster_description text,
  product_ids uuid[] DEFAULT '{}',
  centroid jsonb DEFAULT '{}',
  metrics jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catalog_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "catalog_clusters_ws" ON public.catalog_clusters FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
