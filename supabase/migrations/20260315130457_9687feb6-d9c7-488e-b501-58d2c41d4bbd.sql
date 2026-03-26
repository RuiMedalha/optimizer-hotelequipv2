
-- Website Extraction Agent: Configs per domain/supplier
CREATE TABLE public.website_extraction_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.supplier_profiles(id) ON DELETE SET NULL,
  domain text NOT NULL,
  display_name text,
  layout_signature text,
  learned_selectors jsonb DEFAULT '{}',
  learned_url_patterns jsonb DEFAULT '{}',
  product_page_heuristics jsonb DEFAULT '{}',
  field_mappings jsonb DEFAULT '{}',
  last_discovery_at timestamptz,
  total_pages_discovered integer DEFAULT 0,
  total_products_extracted integer DEFAULT 0,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.website_extraction_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their workspace configs"
  ON public.website_extraction_configs FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- Website Extraction Agent: Runs
CREATE TABLE public.website_extraction_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  config_id uuid REFERENCES public.website_extraction_configs(id) ON DELETE SET NULL,
  phase text NOT NULL DEFAULT 'discovery',
  status text DEFAULT 'pending',
  target_url text,
  pages_discovered integer DEFAULT 0,
  pages_extracted integer DEFAULT 0,
  pages_failed integer DEFAULT 0,
  extraction_engine text DEFAULT 'dom',
  cost_estimate numeric DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  error_payload jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.website_extraction_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their workspace runs"
  ON public.website_extraction_runs FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- Website Extraction Agent: Discovered/classified pages
CREATE TABLE public.website_extraction_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.website_extraction_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  url text NOT NULL,
  page_type text DEFAULT 'unknown',
  classification_confidence numeric DEFAULT 0,
  classification_signals jsonb DEFAULT '{}',
  extraction_status text DEFAULT 'pending',
  extracted_data jsonb,
  field_confidence jsonb DEFAULT '{}',
  warnings text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.website_extraction_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their workspace pages"
  ON public.website_extraction_pages FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- Website Extraction Agent: Learned patterns per domain
CREATE TABLE public.website_extraction_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  config_id uuid REFERENCES public.website_extraction_configs(id) ON DELETE SET NULL,
  domain text NOT NULL,
  learning_type text NOT NULL,
  pattern_key text,
  pattern_value jsonb,
  confidence numeric DEFAULT 0.5,
  usage_count integer DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.website_extraction_learnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their workspace learnings"
  ON public.website_extraction_learnings FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- Indexes
CREATE INDEX idx_wec_workspace ON public.website_extraction_configs(workspace_id);
CREATE INDEX idx_wec_domain ON public.website_extraction_configs(domain);
CREATE INDEX idx_wer_workspace ON public.website_extraction_runs(workspace_id);
CREATE INDEX idx_wer_config ON public.website_extraction_runs(config_id);
CREATE INDEX idx_wep_run ON public.website_extraction_pages(run_id);
CREATE INDEX idx_wep_workspace ON public.website_extraction_pages(workspace_id);
CREATE INDEX idx_wel_workspace ON public.website_extraction_learnings(workspace_id);
CREATE INDEX idx_wel_domain ON public.website_extraction_learnings(domain);
