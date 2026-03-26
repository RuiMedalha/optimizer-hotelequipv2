
-- ============================================================
-- BLOCO ORQ-8: Canonical Product Assembly Engine
-- ============================================================

-- 1. ENUMS
CREATE TYPE public.product_identity_status_enum AS ENUM ('unresolved','matched','merged','split_required','review_required');
CREATE TYPE public.assembly_status_enum AS ENUM ('queued','assembling','assembled','partially_assembled','error');
CREATE TYPE public.quality_status_enum AS ENUM ('unvalidated','valid','warning','invalid');
CREATE TYPE public.canonical_review_status_enum AS ENUM ('not_required','suggested','required','approved','rejected');
CREATE TYPE public.canonical_field_type_enum AS ENUM ('text','number','boolean','date','array','object','asset_reference','relationship_reference');
CREATE TYPE public.canonical_relationship_type_enum AS ENUM ('variation_parent','variation_child','accessory','bundle_component','bundle_parent','compatible_with','alternative','upsell_candidate','crosssell_candidate');
CREATE TYPE public.selection_reason_enum AS ENUM ('source_priority','confidence_win','human_override','schema_rule','supplier_rule','fallback_rule','merge_rule');

-- 2. canonical_products
CREATE TABLE public.canonical_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.supplier_profiles(id),
  canonical_key text,
  product_identity_status public.product_identity_status_enum DEFAULT 'unresolved',
  assembly_status public.assembly_status_enum DEFAULT 'queued',
  assembly_confidence_score numeric DEFAULT 0,
  quality_status public.quality_status_enum DEFAULT 'unvalidated',
  review_status public.canonical_review_status_enum DEFAULT 'not_required',
  product_type text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_canonical_products_ws ON public.canonical_products(workspace_id);
CREATE INDEX idx_canonical_products_supplier ON public.canonical_products(supplier_id);
CREATE INDEX idx_canonical_products_key ON public.canonical_products(canonical_key);
ALTER TABLE public.canonical_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "canonical_products_access" ON public.canonical_products FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- 3. canonical_product_sources
CREATE TABLE public.canonical_product_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_product_id uuid NOT NULL REFERENCES public.canonical_products(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_record_id uuid,
  source_name text,
  source_priority integer DEFAULT 5,
  source_confidence numeric DEFAULT 0.5,
  is_primary boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_canonical_sources_cpid ON public.canonical_product_sources(canonical_product_id);
ALTER TABLE public.canonical_product_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "canonical_sources_access" ON public.canonical_product_sources FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.canonical_products cp WHERE cp.id = canonical_product_id AND public.has_workspace_access_hybrid(cp.workspace_id, 'viewer')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.canonical_products cp WHERE cp.id = canonical_product_id AND public.has_workspace_access_hybrid(cp.workspace_id, 'editor')));

-- 4. canonical_product_fields
CREATE TABLE public.canonical_product_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_product_id uuid NOT NULL REFERENCES public.canonical_products(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  field_value jsonb,
  field_type public.canonical_field_type_enum DEFAULT 'text',
  confidence_score numeric DEFAULT 0,
  selected_source_type text,
  selected_source_record_id uuid,
  selection_reason public.selection_reason_enum DEFAULT 'source_priority',
  normalized_value jsonb,
  validation_status public.quality_status_enum DEFAULT 'unvalidated',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_canonical_fields_cpid ON public.canonical_product_fields(canonical_product_id);
CREATE INDEX idx_canonical_fields_name ON public.canonical_product_fields(field_name);
ALTER TABLE public.canonical_product_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "canonical_fields_access" ON public.canonical_product_fields FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.canonical_products cp WHERE cp.id = canonical_product_id AND public.has_workspace_access_hybrid(cp.workspace_id, 'viewer')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.canonical_products cp WHERE cp.id = canonical_product_id AND public.has_workspace_access_hybrid(cp.workspace_id, 'editor')));

-- 5. canonical_product_candidates
CREATE TABLE public.canonical_product_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.supplier_profiles(id),
  candidate_group_key text,
  source_type text NOT NULL,
  source_record_id uuid,
  candidate_payload jsonb DEFAULT '{}',
  match_confidence numeric DEFAULT 0,
  match_status text DEFAULT 'pending',
  canonical_product_id uuid REFERENCES public.canonical_products(id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_canonical_candidates_ws ON public.canonical_product_candidates(workspace_id);
CREATE INDEX idx_canonical_candidates_cpid ON public.canonical_product_candidates(canonical_product_id);
CREATE INDEX idx_canonical_candidates_group ON public.canonical_product_candidates(candidate_group_key);
ALTER TABLE public.canonical_product_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "canonical_candidates_access" ON public.canonical_product_candidates FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- 6. canonical_product_relationships
CREATE TABLE public.canonical_product_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_product_id uuid NOT NULL REFERENCES public.canonical_products(id) ON DELETE CASCADE,
  relationship_type public.canonical_relationship_type_enum NOT NULL,
  related_canonical_product_id uuid NOT NULL REFERENCES public.canonical_products(id) ON DELETE CASCADE,
  relationship_reason text,
  confidence_score numeric DEFAULT 0.5,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_canonical_rels_cpid ON public.canonical_product_relationships(canonical_product_id);
CREATE INDEX idx_canonical_rels_related ON public.canonical_product_relationships(related_canonical_product_id);
ALTER TABLE public.canonical_product_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "canonical_rels_access" ON public.canonical_product_relationships FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.canonical_products cp WHERE cp.id = canonical_product_id AND public.has_workspace_access_hybrid(cp.workspace_id, 'viewer')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.canonical_products cp WHERE cp.id = canonical_product_id AND public.has_workspace_access_hybrid(cp.workspace_id, 'editor')));

-- 7. canonical_product_assets
CREATE TABLE public.canonical_product_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_product_id uuid NOT NULL REFERENCES public.canonical_products(id) ON DELETE CASCADE,
  asset_id uuid,
  usage_context text DEFAULT 'gallery',
  sort_order integer DEFAULT 0,
  is_primary boolean DEFAULT false,
  source_type text,
  confidence_score numeric DEFAULT 0.5,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_canonical_assets_cpid ON public.canonical_product_assets(canonical_product_id);
ALTER TABLE public.canonical_product_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "canonical_assets_access" ON public.canonical_product_assets FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.canonical_products cp WHERE cp.id = canonical_product_id AND public.has_workspace_access_hybrid(cp.workspace_id, 'viewer')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.canonical_products cp WHERE cp.id = canonical_product_id AND public.has_workspace_access_hybrid(cp.workspace_id, 'editor')));

-- 8. canonical_assembly_logs
CREATE TABLE public.canonical_assembly_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_product_id uuid NOT NULL REFERENCES public.canonical_products(id) ON DELETE CASCADE,
  run_id uuid,
  assembly_step text NOT NULL,
  status text DEFAULT 'started',
  input_summary jsonb DEFAULT '{}',
  output_summary jsonb DEFAULT '{}',
  confidence_before numeric,
  confidence_after numeric,
  error_payload jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_canonical_logs_cpid ON public.canonical_assembly_logs(canonical_product_id);
CREATE INDEX idx_canonical_logs_created ON public.canonical_assembly_logs(created_at);
ALTER TABLE public.canonical_assembly_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "canonical_logs_access" ON public.canonical_assembly_logs FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.canonical_products cp WHERE cp.id = canonical_product_id AND public.has_workspace_access_hybrid(cp.workspace_id, 'viewer')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.canonical_products cp WHERE cp.id = canonical_product_id AND public.has_workspace_access_hybrid(cp.workspace_id, 'editor')));

-- 9. ALTER existing tables
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS canonical_product_id uuid REFERENCES public.canonical_products(id);
ALTER TABLE public.uploaded_files ADD COLUMN IF NOT EXISTS canonicalization_status text;
CREATE INDEX IF NOT EXISTS idx_products_canonical ON public.products(canonical_product_id);
