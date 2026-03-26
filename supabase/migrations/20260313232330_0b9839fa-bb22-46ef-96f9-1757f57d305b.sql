
-- BLOCO 9.1: Add missing columns and indexes (fixed)

-- catalog_brain_entities
ALTER TABLE public.catalog_brain_entities ADD COLUMN IF NOT EXISTS canonical_label text;
UPDATE public.catalog_brain_entities SET canonical_label = entity_label WHERE canonical_label IS NULL AND entity_label IS NOT NULL;

-- catalog_brain_relations
ALTER TABLE public.catalog_brain_relations ADD COLUMN IF NOT EXISTS from_entity_id uuid;
ALTER TABLE public.catalog_brain_relations ADD COLUMN IF NOT EXISTS to_entity_id uuid;
ALTER TABLE public.catalog_brain_relations ADD COLUMN IF NOT EXISTS confidence integer DEFAULT 0;
ALTER TABLE public.catalog_brain_relations ADD COLUMN IF NOT EXISTS source text;
UPDATE public.catalog_brain_relations SET from_entity_id = source_entity_id WHERE from_entity_id IS NULL;
UPDATE public.catalog_brain_relations SET to_entity_id = target_entity_id WHERE to_entity_id IS NULL;

-- catalog_brain_observations: add entity_type, signal_strength, source
ALTER TABLE public.catalog_brain_observations ADD COLUMN IF NOT EXISTS entity_type brain_entity_type;
ALTER TABLE public.catalog_brain_observations ADD COLUMN IF NOT EXISTS signal_strength integer DEFAULT 50;
ALTER TABLE public.catalog_brain_observations ADD COLUMN IF NOT EXISTS source text;
UPDATE public.catalog_brain_observations SET signal_strength = severity WHERE signal_strength = 50 AND severity IS NOT NULL AND severity != 50;
UPDATE public.catalog_brain_observations SET source = signal_source WHERE source IS NULL AND signal_source IS NOT NULL;

-- catalog_brain_plans
ALTER TABLE public.catalog_brain_plans ADD COLUMN IF NOT EXISTS target_entity_type brain_entity_type;
ALTER TABLE public.catalog_brain_plans ADD COLUMN IF NOT EXISTS target_entity_id uuid;
ALTER TABLE public.catalog_brain_plans ADD COLUMN IF NOT EXISTS objective text;
ALTER TABLE public.catalog_brain_plans ADD COLUMN IF NOT EXISTS priority_score integer DEFAULT 0;
ALTER TABLE public.catalog_brain_plans ADD COLUMN IF NOT EXISTS created_by text;

-- catalog_brain_plan_steps
ALTER TABLE public.catalog_brain_plan_steps ADD COLUMN IF NOT EXISTS depends_on_step_id uuid REFERENCES public.catalog_brain_plan_steps(id);
ALTER TABLE public.catalog_brain_plan_steps ADD COLUMN IF NOT EXISTS assigned_agent_type text;
ALTER TABLE public.catalog_brain_plan_steps ADD COLUMN IF NOT EXISTS confidence integer DEFAULT 0;
ALTER TABLE public.catalog_brain_plan_steps ADD COLUMN IF NOT EXISTS result jsonb;

-- catalog_brain_outcomes
ALTER TABLE public.catalog_brain_outcomes ADD COLUMN IF NOT EXISTS baseline_value numeric;
ALTER TABLE public.catalog_brain_outcomes ADD COLUMN IF NOT EXISTS final_value numeric;
ALTER TABLE public.catalog_brain_outcomes ADD COLUMN IF NOT EXISTS delta numeric;

-- product_dna_profiles
ALTER TABLE public.product_dna_profiles ADD COLUMN IF NOT EXISTS family_id uuid;
ALTER TABLE public.product_dna_profiles ADD COLUMN IF NOT EXISTS category_cluster text;
ALTER TABLE public.product_dna_profiles ADD COLUMN IF NOT EXISTS technical_identity jsonb DEFAULT '{}';
ALTER TABLE public.product_dna_profiles ADD COLUMN IF NOT EXISTS commercial_identity jsonb DEFAULT '{}';
ALTER TABLE public.product_dna_profiles ADD COLUMN IF NOT EXISTS visual_identity jsonb DEFAULT '{}';
ALTER TABLE public.product_dna_profiles ADD COLUMN IF NOT EXISTS linguistic_identity jsonb DEFAULT '{}';
ALTER TABLE public.product_dna_profiles ADD COLUMN IF NOT EXISTS channel_identity jsonb DEFAULT '{}';

-- catalog_clusters
ALTER TABLE public.catalog_clusters ADD COLUMN IF NOT EXISTS description text;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_brain_entities_ws_type ON public.catalog_brain_entities(workspace_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_brain_entities_entity ON public.catalog_brain_entities(entity_id);
CREATE INDEX IF NOT EXISTS idx_brain_relations_from ON public.catalog_brain_relations(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_brain_relations_to ON public.catalog_brain_relations(to_entity_id);
CREATE INDEX IF NOT EXISTS idx_brain_observations_ws_type ON public.catalog_brain_observations(workspace_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_brain_observations_entity ON public.catalog_brain_observations(entity_id);
CREATE INDEX IF NOT EXISTS idx_brain_plans_ws_target ON public.catalog_brain_plans(workspace_id, target_entity_type);
CREATE INDEX IF NOT EXISTS idx_brain_plans_target_entity ON public.catalog_brain_plans(target_entity_id);
