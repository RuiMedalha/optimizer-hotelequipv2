
-- Extraction mapping rules: human-in-the-loop field mappings per supplier/document
CREATE TABLE IF NOT EXISTS public.extraction_mapping_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  supplier_id uuid REFERENCES public.supplier_profiles(id) ON DELETE SET NULL,
  extraction_id uuid REFERENCES public.pdf_extractions(id) ON DELETE SET NULL,
  playbook_id uuid,
  document_type text DEFAULT 'catalog',
  layout_signature text,
  field_label text NOT NULL,
  field_type text NOT NULL DEFAULT 'text',
  mapped_to text NOT NULL,
  zone_type text,
  bounding_box jsonb,
  column_index integer,
  table_index integer,
  confidence numeric DEFAULT 100,
  source text DEFAULT 'human',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.extraction_mapping_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage extraction mapping rules in their workspace"
ON public.extraction_mapping_rules
FOR ALL
TO authenticated
USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- Add layout_analysis columns to pdf_extractions
ALTER TABLE public.pdf_extractions 
  ADD COLUMN IF NOT EXISTS layout_analysis jsonb,
  ADD COLUMN IF NOT EXISTS engine_recommendation jsonb,
  ADD COLUMN IF NOT EXISTS detected_products jsonb,
  ADD COLUMN IF NOT EXISTS sent_to_ingestion boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ingestion_job_id uuid;
