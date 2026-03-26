
-- Document AI Providers configuration table
CREATE TABLE public.document_ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  provider_name TEXT NOT NULL,
  provider_type TEXT NOT NULL DEFAULT 'lovable_gateway',
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority_order INTEGER NOT NULL DEFAULT 10,
  default_model TEXT,
  supports_vision BOOLEAN NOT NULL DEFAULT true,
  supports_tables BOOLEAN NOT NULL DEFAULT true,
  supports_json_schema BOOLEAN NOT NULL DEFAULT false,
  max_pages INTEGER DEFAULT 50,
  timeout_seconds INTEGER DEFAULT 120,
  estimated_cost_per_page NUMERIC DEFAULT 0,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.document_ai_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage doc AI providers for their workspaces"
  ON public.document_ai_providers
  FOR ALL
  TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- Add provider tracking columns to pdf_extractions
ALTER TABLE public.pdf_extractions
  ADD COLUMN IF NOT EXISTS provider_used TEXT,
  ADD COLUMN IF NOT EXISTS provider_model TEXT,
  ADD COLUMN IF NOT EXISTS extraction_mode TEXT DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cost NUMERIC,
  ADD COLUMN IF NOT EXISTS fallback_used BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS fallback_provider TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
