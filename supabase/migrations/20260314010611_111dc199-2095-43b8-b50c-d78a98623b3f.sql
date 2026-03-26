
-- ============================================================
-- BLOCO ORQ-7: Supplier Intelligence Layer
-- ============================================================

-- 1. ENUMS
CREATE TYPE public.supplier_source_type_enum AS ENUM ('excel','pdf','website','xml','api','woo_export','image_pack');
CREATE TYPE public.supplier_source_role_enum AS ENUM ('commercial','technical','taxonomy','assets','pricing','stock','enrichment');
CREATE TYPE public.taxonomy_mode_enum AS ENUM ('strict','mapped','inferred','hybrid');
CREATE TYPE public.supplier_match_type_enum AS ENUM ('sku_exact','sku_normalized','ean_exact','supplier_ref','title_similarity','family_match','dimensions_match');
CREATE TYPE public.supplier_grouping_type_enum AS ENUM ('variation','pack','accessory','kit','family');
CREATE TYPE public.mapping_source_enum AS ENUM ('manual','ai','learned','rule');
CREATE TYPE public.learning_outcome_enum AS ENUM ('success','corrected','rejected','confirmed');

-- 2. supplier_profiles
CREATE TABLE public.supplier_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  supplier_name text NOT NULL,
  supplier_code text,
  base_url text,
  search_url_template text,
  website_language text DEFAULT 'pt',
  default_currency text DEFAULT 'EUR',
  country_code text DEFAULT 'PT',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_supplier_profiles_ws ON public.supplier_profiles(workspace_id);
ALTER TABLE public.supplier_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_profiles_access" ON public.supplier_profiles FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- 3. supplier_source_profiles
CREATE TABLE public.supplier_source_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  source_type public.supplier_source_type_enum NOT NULL,
  source_role public.supplier_source_role_enum NOT NULL,
  reliability_score numeric DEFAULT 0.5,
  priority_rank integer DEFAULT 5,
  parsing_strategy text,
  matching_strategy text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_supplier_source_profiles_sid ON public.supplier_source_profiles(supplier_id);
ALTER TABLE public.supplier_source_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_source_profiles_access" ON public.supplier_source_profiles FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'viewer')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'editor')));

-- 4. supplier_field_trust_rules
CREATE TABLE public.supplier_field_trust_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  primary_source_type public.supplier_source_type_enum,
  secondary_source_type public.supplier_source_type_enum,
  fallback_source_type public.supplier_source_type_enum,
  trust_score numeric DEFAULT 0.5,
  conflict_strategy text DEFAULT 'prefer_primary',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_supplier_field_trust_sid ON public.supplier_field_trust_rules(supplier_id);
ALTER TABLE public.supplier_field_trust_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_field_trust_access" ON public.supplier_field_trust_rules FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'viewer')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'editor')));

-- 5. supplier_matching_rules
CREATE TABLE public.supplier_matching_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  rule_name text NOT NULL,
  match_type public.supplier_match_type_enum NOT NULL,
  rule_weight numeric DEFAULT 1.0,
  is_active boolean DEFAULT true,
  rule_config jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_supplier_matching_sid ON public.supplier_matching_rules(supplier_id);
ALTER TABLE public.supplier_matching_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_matching_access" ON public.supplier_matching_rules FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'viewer')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'editor')));

-- 6. supplier_grouping_rules
CREATE TABLE public.supplier_grouping_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  grouping_type public.supplier_grouping_type_enum NOT NULL,
  discriminator_fields text[],
  parent_detection_strategy text,
  child_detection_strategy text,
  confidence_threshold numeric DEFAULT 0.7,
  review_threshold numeric DEFAULT 0.5,
  rule_config jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_supplier_grouping_sid ON public.supplier_grouping_rules(supplier_id);
ALTER TABLE public.supplier_grouping_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_grouping_access" ON public.supplier_grouping_rules FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'viewer')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'editor')));

-- 7. supplier_taxonomy_profiles
CREATE TABLE public.supplier_taxonomy_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  taxonomy_mode public.taxonomy_mode_enum DEFAULT 'hybrid',
  default_category_strategy text,
  attribute_strategy text,
  filterable_attribute_strategy text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_supplier_taxonomy_sid ON public.supplier_taxonomy_profiles(supplier_id);
ALTER TABLE public.supplier_taxonomy_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_taxonomy_profiles_access" ON public.supplier_taxonomy_profiles FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'viewer')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'editor')));

-- 8. supplier_taxonomy_mappings
CREATE TABLE public.supplier_taxonomy_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  external_family text,
  external_category text,
  external_subcategory text,
  internal_category_id uuid,
  mapping_confidence numeric DEFAULT 0.5,
  mapping_source public.mapping_source_enum DEFAULT 'ai',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_supplier_taxonomy_map_sid ON public.supplier_taxonomy_mappings(supplier_id);
ALTER TABLE public.supplier_taxonomy_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_taxonomy_mappings_access" ON public.supplier_taxonomy_mappings FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'viewer')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'editor')));

-- 9. supplier_attribute_patterns
CREATE TABLE public.supplier_attribute_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  pattern_name text NOT NULL,
  source_type public.supplier_source_type_enum,
  attribute_name text NOT NULL,
  pattern_regex text,
  normalization_rule text,
  unit_rule text,
  is_variation_candidate boolean DEFAULT false,
  is_filter_candidate boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_supplier_attr_patterns_sid ON public.supplier_attribute_patterns(supplier_id);
ALTER TABLE public.supplier_attribute_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_attr_patterns_access" ON public.supplier_attribute_patterns FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'viewer')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'editor')));

-- 10. supplier_prompt_profiles
CREATE TABLE public.supplier_prompt_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  agent_name text NOT NULL,
  prompt_template_id uuid,
  override_prompt text,
  usage_scope text DEFAULT 'global',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_supplier_prompt_sid ON public.supplier_prompt_profiles(supplier_id);
ALTER TABLE public.supplier_prompt_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_prompt_access" ON public.supplier_prompt_profiles FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'viewer')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'editor')));

-- 11. supplier_learning_events
CREATE TABLE public.supplier_learning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  source_type public.supplier_source_type_enum,
  entity_type text,
  entity_id uuid,
  event_payload jsonb DEFAULT '{}',
  outcome public.learning_outcome_enum DEFAULT 'success',
  confidence_before numeric,
  confidence_after numeric,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_supplier_learning_sid ON public.supplier_learning_events(supplier_id);
CREATE INDEX idx_supplier_learning_created ON public.supplier_learning_events(created_at);
ALTER TABLE public.supplier_learning_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_learning_access" ON public.supplier_learning_events FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'viewer')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'editor')));

-- 12. supplier_decision_memory
CREATE TABLE public.supplier_decision_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  decision_type text NOT NULL,
  decision_key text NOT NULL,
  decision_value jsonb DEFAULT '{}',
  times_used integer DEFAULT 1,
  success_rate numeric DEFAULT 1.0,
  last_used_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_supplier_decision_sid ON public.supplier_decision_memory(supplier_id);
ALTER TABLE public.supplier_decision_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_decision_access" ON public.supplier_decision_memory FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'viewer')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'editor')));

-- 13. supplier_extraction_benchmarks
CREATE TABLE public.supplier_extraction_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  source_type public.supplier_source_type_enum,
  pages_processed integer DEFAULT 0,
  rows_processed integer DEFAULT 0,
  successful_matches integer DEFAULT 0,
  manual_reviews integer DEFAULT 0,
  average_confidence numeric DEFAULT 0,
  average_cost numeric DEFAULT 0,
  average_latency_ms numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_supplier_benchmarks_sid ON public.supplier_extraction_benchmarks(supplier_id);
CREATE INDEX idx_supplier_benchmarks_created ON public.supplier_extraction_benchmarks(created_at);
ALTER TABLE public.supplier_extraction_benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_benchmarks_access" ON public.supplier_extraction_benchmarks FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'viewer')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'editor')));

-- 14. ALTER existing tables
ALTER TABLE public.uploaded_files ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.supplier_profiles(id);
ALTER TABLE public.uploaded_files ADD COLUMN IF NOT EXISTS source_type public.supplier_source_type_enum;
ALTER TABLE public.uploaded_files ADD COLUMN IF NOT EXISTS source_role public.supplier_source_role_enum;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.supplier_profiles(id);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS canonical_supplier_family text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS canonical_supplier_model text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS source_confidence_profile jsonb;

ALTER TABLE public.knowledge_chunks ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.supplier_profiles(id);
ALTER TABLE public.knowledge_chunks ADD COLUMN IF NOT EXISTS source_type public.supplier_source_type_enum;

ALTER TABLE public.optimization_logs ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.supplier_profiles(id);
ALTER TABLE public.optimization_logs ADD COLUMN IF NOT EXISTS supplier_profile_version text;

-- Indexes on altered tables
CREATE INDEX IF NOT EXISTS idx_uploaded_files_supplier ON public.uploaded_files(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON public.products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_supplier ON public.knowledge_chunks(supplier_id);
CREATE INDEX IF NOT EXISTS idx_optlogs_supplier ON public.optimization_logs(supplier_id);
