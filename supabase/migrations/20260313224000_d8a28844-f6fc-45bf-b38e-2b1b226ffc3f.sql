
-- ============================================================
-- BLOCO 6 EXPANSION: Document Intelligence Tables & Enums
-- All additive, backward compatible
-- ============================================================

-- 1. New enums
CREATE TYPE public.pdf_block_type AS ENUM ('header', 'section_title', 'paragraph', 'table', 'image', 'caption', 'footer', 'note');
CREATE TYPE public.pdf_block_role AS ENUM ('product_family', 'product_group', 'table_header', 'table_row', 'table_cell', 'description', 'attribute', 'context_label');
CREATE TYPE public.pdf_image_type AS ENUM ('product', 'lifestyle', 'technical', 'icon', 'logo', 'unknown');
CREATE TYPE public.pdf_table_type AS ENUM ('product_table', 'technical_specs', 'pricing_table', 'accessories', 'compatibility', 'spare_parts');

-- 2. pdf_page_blocks (Page Layout Graph)
CREATE TABLE public.pdf_page_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.pdf_pages(id) ON DELETE CASCADE,
  block_type public.pdf_block_type NOT NULL,
  bbox jsonb DEFAULT '{}'::jsonb,
  text_content text,
  parent_block_id uuid REFERENCES public.pdf_page_blocks(id) ON DELETE SET NULL,
  reading_order integer NOT NULL DEFAULT 0,
  semantic_role public.pdf_block_role,
  confidence integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pdf_page_blocks_page ON public.pdf_page_blocks(page_id);
CREATE INDEX idx_pdf_page_blocks_parent ON public.pdf_page_blocks(parent_block_id);
ALTER TABLE public.pdf_page_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view pdf page blocks" ON public.pdf_page_blocks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM pdf_pages p JOIN pdf_extractions e ON e.id = p.extraction_id WHERE p.id = pdf_page_blocks.page_id AND has_workspace_access_hybrid(e.workspace_id, 'viewer')));
CREATE POLICY "Editors can manage pdf page blocks" ON public.pdf_page_blocks FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM pdf_pages p JOIN pdf_extractions e ON e.id = p.extraction_id WHERE p.id = pdf_page_blocks.page_id AND has_workspace_access_hybrid(e.workspace_id, 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM pdf_pages p JOIN pdf_extractions e ON e.id = p.extraction_id WHERE p.id = pdf_page_blocks.page_id AND has_workspace_access_hybrid(e.workspace_id, 'editor')));

-- 3. pdf_detected_images (Image Detection & Association)
CREATE TABLE public.pdf_detected_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.pdf_pages(id) ON DELETE CASCADE,
  image_url text,
  bbox jsonb DEFAULT '{}'::jsonb,
  nearest_table_id uuid REFERENCES public.pdf_tables(id) ON DELETE SET NULL,
  nearest_row_id uuid REFERENCES public.pdf_table_rows(id) ON DELETE SET NULL,
  image_type public.pdf_image_type NOT NULL DEFAULT 'unknown',
  confidence integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pdf_detected_images_page ON public.pdf_detected_images(page_id);
ALTER TABLE public.pdf_detected_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view pdf detected images" ON public.pdf_detected_images FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM pdf_pages p JOIN pdf_extractions e ON e.id = p.extraction_id WHERE p.id = pdf_detected_images.page_id AND has_workspace_access_hybrid(e.workspace_id, 'viewer')));
CREATE POLICY "Editors can manage pdf detected images" ON public.pdf_detected_images FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM pdf_pages p JOIN pdf_extractions e ON e.id = p.extraction_id WHERE p.id = pdf_detected_images.page_id AND has_workspace_access_hybrid(e.workspace_id, 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM pdf_pages p JOIN pdf_extractions e ON e.id = p.extraction_id WHERE p.id = pdf_detected_images.page_id AND has_workspace_access_hybrid(e.workspace_id, 'editor')));

-- 4. supplier_layout_profiles (Supplier Layout Learning)
CREATE TABLE public.supplier_layout_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  supplier_name text NOT NULL,
  header_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  column_aliases jsonb NOT NULL DEFAULT '{}'::jsonb,
  table_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  layout_signature jsonb NOT NULL DEFAULT '{}'::jsonb,
  language text DEFAULT 'pt',
  confidence_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_supplier_layout_profiles_ws ON public.supplier_layout_profiles(workspace_id);
CREATE INDEX idx_supplier_layout_profiles_name ON public.supplier_layout_profiles(supplier_name);
ALTER TABLE public.supplier_layout_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view supplier profiles" ON public.supplier_layout_profiles FOR SELECT TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE POLICY "Admins can manage supplier profiles" ON public.supplier_layout_profiles FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'admin'))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'admin'));

CREATE TRIGGER update_supplier_layout_profiles_updated_at
  BEFORE UPDATE ON public.supplier_layout_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. technical_symbol_dictionary (Numeric Intelligence)
CREATE TABLE public.technical_symbol_dictionary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  normalized_field text NOT NULL,
  unit text,
  examples jsonb DEFAULT '[]'::jsonb
);
ALTER TABLE public.technical_symbol_dictionary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can view symbols" ON public.technical_symbol_dictionary FOR SELECT TO authenticated USING (true);

-- 6. pdf_language_segments (Multi-Language Detection)
CREATE TABLE public.pdf_language_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.pdf_pages(id) ON DELETE CASCADE,
  language text NOT NULL,
  bbox jsonb DEFAULT '{}'::jsonb,
  confidence integer DEFAULT 0
);
CREATE INDEX idx_pdf_language_segments_page ON public.pdf_language_segments(page_id);
ALTER TABLE public.pdf_language_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view language segments" ON public.pdf_language_segments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM pdf_pages p JOIN pdf_extractions e ON e.id = p.extraction_id WHERE p.id = pdf_language_segments.page_id AND has_workspace_access_hybrid(e.workspace_id, 'viewer')));
CREATE POLICY "Editors can manage language segments" ON public.pdf_language_segments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM pdf_pages p JOIN pdf_extractions e ON e.id = p.extraction_id WHERE p.id = pdf_language_segments.page_id AND has_workspace_access_hybrid(e.workspace_id, 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM pdf_pages p JOIN pdf_extractions e ON e.id = p.extraction_id WHERE p.id = pdf_language_segments.page_id AND has_workspace_access_hybrid(e.workspace_id, 'editor')));

-- 7. pdf_layout_signatures (Layout Fingerprinting)
CREATE TABLE public.pdf_layout_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_hash text NOT NULL,
  layout_structure jsonb DEFAULT '{}'::jsonb,
  table_positions jsonb DEFAULT '[]'::jsonb,
  image_positions jsonb DEFAULT '[]'::jsonb,
  column_count integer DEFAULT 0,
  supplier_guess text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pdf_layout_signatures_hash ON public.pdf_layout_signatures(page_hash);
ALTER TABLE public.pdf_layout_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can view layout signatures" ON public.pdf_layout_signatures FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anyone authenticated can insert layout signatures" ON public.pdf_layout_signatures FOR INSERT TO authenticated WITH CHECK (true);

-- 8. pdf_extraction_metrics (OCR Quality Monitoring)
CREATE TABLE public.pdf_extraction_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_id uuid NOT NULL REFERENCES public.pdf_extractions(id) ON DELETE CASCADE,
  avg_confidence integer DEFAULT 0,
  tables_detected integer DEFAULT 0,
  rows_extracted integer DEFAULT 0,
  mapping_success_rate numeric DEFAULT 0,
  processing_time integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pdf_extraction_metrics_ext ON public.pdf_extraction_metrics(extraction_id);
ALTER TABLE public.pdf_extraction_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view extraction metrics" ON public.pdf_extraction_metrics FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM pdf_extractions e WHERE e.id = pdf_extraction_metrics.extraction_id AND has_workspace_access_hybrid(e.workspace_id, 'viewer')));
CREATE POLICY "Editors can manage extraction metrics" ON public.pdf_extraction_metrics FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM pdf_extractions e WHERE e.id = pdf_extraction_metrics.extraction_id AND has_workspace_access_hybrid(e.workspace_id, 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM pdf_extractions e WHERE e.id = pdf_extraction_metrics.extraction_id AND has_workspace_access_hybrid(e.workspace_id, 'editor')));

-- 9. pdf_sections (Catalog Section Detection)
CREATE TABLE public.pdf_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.pdf_pages(id) ON DELETE CASCADE,
  section_title text NOT NULL,
  bbox jsonb DEFAULT '{}'::jsonb,
  confidence integer DEFAULT 0
);
CREATE INDEX idx_pdf_sections_page ON public.pdf_sections(page_id);
ALTER TABLE public.pdf_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view pdf sections" ON public.pdf_sections FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM pdf_pages p JOIN pdf_extractions e ON e.id = p.extraction_id WHERE p.id = pdf_sections.page_id AND has_workspace_access_hybrid(e.workspace_id, 'viewer')));
CREATE POLICY "Editors can manage pdf sections" ON public.pdf_sections FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM pdf_pages p JOIN pdf_extractions e ON e.id = p.extraction_id WHERE p.id = pdf_sections.page_id AND has_workspace_access_hybrid(e.workspace_id, 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM pdf_pages p JOIN pdf_extractions e ON e.id = p.extraction_id WHERE p.id = pdf_sections.page_id AND has_workspace_access_hybrid(e.workspace_id, 'editor')));

-- 10. Add table_type to pdf_tables
ALTER TABLE public.pdf_tables ADD COLUMN IF NOT EXISTS table_type public.pdf_table_type DEFAULT 'product_table';
