
-- ============================================================
-- EXTRACTION MEMORY ENGINE — All additive, backward compatible
-- ============================================================

-- 1. New enums
CREATE TYPE public.extraction_pattern_type AS ENUM (
  'column_mapping', 'header_alias', 'table_layout', 'unit_normalization',
  'attribute_mapping', 'category_mapping', 'grouping_rule', 'variation_rule',
  'image_association_rule', 'language_pattern', 'supplier_rule', 'pdf_section_rule'
);

CREATE TYPE public.extraction_pattern_source AS ENUM (
  'ai_inferred', 'human_confirmed', 'import_observed', 'publish_validated', 'system_generated'
);

CREATE TYPE public.correction_type AS ENUM (
  'value_fix', 'column_reassignment', 'category_fix', 'attribute_fix',
  'variation_fix', 'unit_fix', 'grouping_fix', 'image_fix'
);

CREATE TYPE public.normalization_type AS ENUM (
  'unit', 'material', 'color', 'category', 'attribute_name',
  'attribute_value', 'product_family', 'brand_alias'
);

CREATE TYPE public.extraction_decision_type AS ENUM (
  'category_assignment', 'schema_assignment', 'variation_grouping',
  'parent_child_resolution', 'attribute_selection', 'table_classification',
  'image_to_product_matching'
);

-- 2. extraction_memory_patterns
CREATE TABLE public.extraction_memory_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  supplier_name text,
  pattern_type public.extraction_pattern_type NOT NULL,
  pattern_key text NOT NULL,
  pattern_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence integer NOT NULL DEFAULT 50,
  usage_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  last_confirmed_at timestamptz,
  source_type public.extraction_pattern_source NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_emp_workspace ON public.extraction_memory_patterns(workspace_id);
CREATE INDEX idx_emp_supplier ON public.extraction_memory_patterns(supplier_name);
CREATE INDEX idx_emp_type_key ON public.extraction_memory_patterns(pattern_type, pattern_key);
CREATE INDEX idx_emp_confidence ON public.extraction_memory_patterns(confidence DESC);
ALTER TABLE public.extraction_memory_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view patterns" ON public.extraction_memory_patterns FOR SELECT TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE POLICY "Editors can manage patterns" ON public.extraction_memory_patterns FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'editor'))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'editor'));

CREATE TRIGGER update_extraction_memory_patterns_updated_at
  BEFORE UPDATE ON public.extraction_memory_patterns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. extraction_corrections
CREATE TABLE public.extraction_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  pdf_row_id uuid REFERENCES public.pdf_table_rows(id) ON DELETE SET NULL,
  pdf_table_id uuid REFERENCES public.pdf_tables(id) ON DELETE SET NULL,
  field_key text NOT NULL,
  raw_value text,
  corrected_value text,
  correction_type public.correction_type NOT NULL,
  applied_pattern_id uuid REFERENCES public.extraction_memory_patterns(id) ON DELETE SET NULL,
  reviewed_by uuid NOT NULL,
  review_context jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ec_workspace ON public.extraction_corrections(workspace_id);
CREATE INDEX idx_ec_product ON public.extraction_corrections(product_id);
CREATE INDEX idx_ec_pattern ON public.extraction_corrections(applied_pattern_id);
ALTER TABLE public.extraction_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view corrections" ON public.extraction_corrections FOR SELECT TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE POLICY "Editors can manage corrections" ON public.extraction_corrections FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'editor'))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'editor'));

-- 4. normalization_dictionary
CREATE TABLE public.normalization_dictionary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  dictionary_type public.normalization_type NOT NULL,
  source_term text NOT NULL,
  normalized_term text NOT NULL,
  language text,
  supplier_name text,
  confidence integer NOT NULL DEFAULT 80,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_nd_workspace ON public.normalization_dictionary(workspace_id);
CREATE INDEX idx_nd_type ON public.normalization_dictionary(dictionary_type);
CREATE INDEX idx_nd_source ON public.normalization_dictionary(source_term);
CREATE UNIQUE INDEX idx_nd_unique ON public.normalization_dictionary(workspace_id, dictionary_type, source_term, COALESCE(supplier_name, ''));
ALTER TABLE public.normalization_dictionary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view dictionary" ON public.normalization_dictionary FOR SELECT TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE POLICY "Editors can manage dictionary" ON public.normalization_dictionary FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'editor'))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'editor'));

CREATE TRIGGER update_normalization_dictionary_updated_at
  BEFORE UPDATE ON public.normalization_dictionary
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. extraction_decision_history
CREATE TABLE public.extraction_decision_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  decision_type public.extraction_decision_type NOT NULL,
  input_signature jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_output jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence integer NOT NULL DEFAULT 0,
  approved boolean NOT NULL DEFAULT false,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_edh_workspace ON public.extraction_decision_history(workspace_id);
CREATE INDEX idx_edh_type ON public.extraction_decision_history(decision_type);
CREATE INDEX idx_edh_approved ON public.extraction_decision_history(approved) WHERE approved = true;
ALTER TABLE public.extraction_decision_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view decisions" ON public.extraction_decision_history FOR SELECT TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE POLICY "Editors can manage decisions" ON public.extraction_decision_history FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'editor'))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'editor'));

-- 6. extraction_case_signatures
CREATE TABLE public.extraction_case_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  supplier_name text,
  signature_hash text NOT NULL,
  signature_embedding jsonb,
  layout_signature jsonb DEFAULT '{}'::jsonb,
  table_signature jsonb DEFAULT '{}'::jsonb,
  sample_payload jsonb DEFAULT '{}'::jsonb,
  resolved_output jsonb DEFAULT '{}'::jsonb,
  confidence integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ecs_workspace ON public.extraction_case_signatures(workspace_id);
CREATE INDEX idx_ecs_hash ON public.extraction_case_signatures(signature_hash);
CREATE INDEX idx_ecs_supplier ON public.extraction_case_signatures(supplier_name);
ALTER TABLE public.extraction_case_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view case signatures" ON public.extraction_case_signatures FOR SELECT TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE POLICY "Editors can manage case signatures" ON public.extraction_case_signatures FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'editor'))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'editor'));
