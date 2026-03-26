
-- BLOCO 6: PDF Vision / OCR Extraction Engine

-- Enums
CREATE TYPE public.pdf_extraction_status AS ENUM ('queued','extracting','reviewing','done','error');
CREATE TYPE public.pdf_extraction_method AS ENUM ('text_only','vision_only','hybrid');
CREATE TYPE public.pdf_page_status AS ENUM ('extracted','reviewed','approved');
CREATE TYPE public.pdf_row_status AS ENUM ('unmapped','mapped','skipped','error');

-- pdf_extractions
CREATE TABLE public.pdf_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES public.uploaded_files(id) ON DELETE CASCADE,
  status public.pdf_extraction_status NOT NULL DEFAULT 'queued',
  total_pages integer DEFAULT 0,
  processed_pages integer DEFAULT 0,
  extraction_method public.pdf_extraction_method DEFAULT 'hybrid',
  model_used text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX idx_pdf_extractions_workspace ON public.pdf_extractions(workspace_id);
CREATE INDEX idx_pdf_extractions_status ON public.pdf_extractions(status);
ALTER TABLE public.pdf_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view pdf extractions" ON public.pdf_extractions FOR SELECT TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE POLICY "Editors can insert pdf extractions" ON public.pdf_extractions FOR INSERT TO authenticated
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'editor'));
CREATE POLICY "Editors can update pdf extractions" ON public.pdf_extractions FOR UPDATE TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'editor'));
CREATE POLICY "Admins can delete pdf extractions" ON public.pdf_extractions FOR DELETE TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'admin'));

-- pdf_pages
CREATE TABLE public.pdf_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_id uuid NOT NULL REFERENCES public.pdf_extractions(id) ON DELETE CASCADE,
  page_number integer NOT NULL,
  page_image_url text,
  raw_text text,
  vision_result jsonb DEFAULT '{}'::jsonb,
  reconciled_result jsonb DEFAULT '{}'::jsonb,
  confidence_score integer DEFAULT 0,
  has_tables boolean DEFAULT false,
  has_images boolean DEFAULT false,
  status public.pdf_page_status NOT NULL DEFAULT 'extracted'
);
CREATE INDEX idx_pdf_pages_extraction ON public.pdf_pages(extraction_id);
ALTER TABLE public.pdf_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view pdf pages" ON public.pdf_pages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pdf_extractions e WHERE e.id = pdf_pages.extraction_id AND has_workspace_access_hybrid(e.workspace_id, 'viewer')));
CREATE POLICY "Editors can manage pdf pages" ON public.pdf_pages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pdf_extractions e WHERE e.id = pdf_pages.extraction_id AND has_workspace_access_hybrid(e.workspace_id, 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pdf_extractions e WHERE e.id = pdf_pages.extraction_id AND has_workspace_access_hybrid(e.workspace_id, 'editor')));

-- pdf_tables
CREATE TABLE public.pdf_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.pdf_pages(id) ON DELETE CASCADE,
  table_index integer NOT NULL DEFAULT 0,
  bounding_box jsonb DEFAULT '{}'::jsonb,
  headers text[] DEFAULT '{}',
  rows jsonb DEFAULT '[]'::jsonb,
  confidence_score integer DEFAULT 0,
  row_count integer DEFAULT 0,
  col_count integer DEFAULT 0,
  mapped_to_products boolean DEFAULT false
);
CREATE INDEX idx_pdf_tables_page ON public.pdf_tables(page_id);
ALTER TABLE public.pdf_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view pdf tables" ON public.pdf_tables FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pdf_pages p JOIN public.pdf_extractions e ON e.id = p.extraction_id WHERE p.id = pdf_tables.page_id AND has_workspace_access_hybrid(e.workspace_id, 'viewer')));
CREATE POLICY "Editors can manage pdf tables" ON public.pdf_tables FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pdf_pages p JOIN public.pdf_extractions e ON e.id = p.extraction_id WHERE p.id = pdf_tables.page_id AND has_workspace_access_hybrid(e.workspace_id, 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pdf_pages p JOIN public.pdf_extractions e ON e.id = p.extraction_id WHERE p.id = pdf_tables.page_id AND has_workspace_access_hybrid(e.workspace_id, 'editor')));

-- pdf_table_rows
CREATE TABLE public.pdf_table_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES public.pdf_tables(id) ON DELETE CASCADE,
  row_index integer NOT NULL DEFAULT 0,
  cells jsonb NOT NULL DEFAULT '[]'::jsonb,
  mapped_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  mapping_confidence integer DEFAULT 0,
  status public.pdf_row_status NOT NULL DEFAULT 'unmapped'
);
CREATE INDEX idx_pdf_table_rows_table ON public.pdf_table_rows(table_id);
CREATE INDEX idx_pdf_table_rows_status ON public.pdf_table_rows(status);
ALTER TABLE public.pdf_table_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view pdf table rows" ON public.pdf_table_rows FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pdf_tables t JOIN public.pdf_pages p ON p.id = t.page_id JOIN public.pdf_extractions e ON e.id = p.extraction_id WHERE t.id = pdf_table_rows.table_id AND has_workspace_access_hybrid(e.workspace_id, 'viewer')));
CREATE POLICY "Editors can manage pdf table rows" ON public.pdf_table_rows FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pdf_tables t JOIN public.pdf_pages p ON p.id = t.page_id JOIN public.pdf_extractions e ON e.id = p.extraction_id WHERE t.id = pdf_table_rows.table_id AND has_workspace_access_hybrid(e.workspace_id, 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pdf_tables t JOIN public.pdf_pages p ON p.id = t.page_id JOIN public.pdf_extractions e ON e.id = p.extraction_id WHERE t.id = pdf_table_rows.table_id AND has_workspace_access_hybrid(e.workspace_id, 'editor')));
