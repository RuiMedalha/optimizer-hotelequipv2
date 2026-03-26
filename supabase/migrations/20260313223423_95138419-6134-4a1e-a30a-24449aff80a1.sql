
-- Hybrid Layout Intelligence: enhance pdf_pages with zone/context data
ALTER TABLE public.pdf_pages
  ADD COLUMN IF NOT EXISTS zones jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS page_context jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS text_result jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS layout_zones jsonb DEFAULT '[]'::jsonb;

-- Enhance pdf_tables with semantic column classification and reconciliation
ALTER TABLE public.pdf_tables
  ADD COLUMN IF NOT EXISTS column_classifications jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS text_source_data jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS vision_source_data jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reconciled_data jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reconciliation_reasons jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS template_id uuid NULL;

-- Enhance pdf_table_rows with per-cell reconciliation
ALTER TABLE public.pdf_table_rows
  ADD COLUMN IF NOT EXISTS text_cells jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS vision_cells jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reconciled_cells jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS row_context jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS validation_errors jsonb DEFAULT '[]'::jsonb;

-- pdf_table_templates for supplier-adaptive OCR
CREATE TABLE public.pdf_table_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  supplier_name text NOT NULL,
  header_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  column_aliases jsonb NOT NULL DEFAULT '{}'::jsonb,
  parsing_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_boost_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pdf_templates_workspace ON public.pdf_table_templates(workspace_id);
CREATE INDEX idx_pdf_templates_supplier ON public.pdf_table_templates(supplier_name);
ALTER TABLE public.pdf_table_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view pdf templates" ON public.pdf_table_templates FOR SELECT TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE POLICY "Admins can manage pdf templates" ON public.pdf_table_templates FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'admin'))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'admin'));

-- Add FK from pdf_tables.template_id
ALTER TABLE public.pdf_tables
  ADD CONSTRAINT pdf_tables_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.pdf_table_templates(id) ON DELETE SET NULL;

-- Updated_at trigger for templates
CREATE TRIGGER update_pdf_table_templates_updated_at
  BEFORE UPDATE ON public.pdf_table_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
