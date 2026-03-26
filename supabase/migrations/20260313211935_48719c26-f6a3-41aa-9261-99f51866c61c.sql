
-- ============================================
-- BLOCO 4: Ingestion Hub Enterprise
-- ============================================

-- 1. ENUMS
CREATE TYPE public.ingestion_source_type AS ENUM ('csv','xlsx','xml','json','google_sheets','api','webhook','supplier_feed');
CREATE TYPE public.ingestion_job_status AS ENUM ('queued','parsing','mapping','dry_run','importing','done','error');
CREATE TYPE public.ingestion_mode AS ENUM ('dry_run','live');
CREATE TYPE public.ingestion_item_status AS ENUM ('queued','parsed','mapped','processed','skipped','error');
CREATE TYPE public.ingestion_merge_strategy AS ENUM ('insert_only','update_only','merge','replace');
CREATE TYPE public.ingestion_action_type AS ENUM ('insert','update','skip','merge','duplicate');

-- 2. ingestion_sources
CREATE TABLE public.ingestion_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  source_type ingestion_source_type NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  field_mappings jsonb NOT NULL DEFAULT '{}'::jsonb,
  schedule_cron text,
  merge_strategy ingestion_merge_strategy NOT NULL DEFAULT 'merge',
  duplicate_detection_fields text[] NOT NULL DEFAULT '{}',
  grouping_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingestion_sources_workspace ON public.ingestion_sources(workspace_id);

-- 3. ingestion_jobs
CREATE TABLE public.ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid,
  source_id uuid REFERENCES public.ingestion_sources(id) ON DELETE SET NULL,
  source_type ingestion_source_type,
  file_name text,
  status ingestion_job_status NOT NULL DEFAULT 'queued',
  mode ingestion_mode NOT NULL DEFAULT 'dry_run',
  merge_strategy ingestion_merge_strategy NOT NULL DEFAULT 'merge',
  total_rows int NOT NULL DEFAULT 0,
  parsed_rows int NOT NULL DEFAULT 0,
  imported_rows int NOT NULL DEFAULT 0,
  updated_rows int NOT NULL DEFAULT 0,
  skipped_rows int NOT NULL DEFAULT 0,
  failed_rows int NOT NULL DEFAULT 0,
  duplicate_rows int NOT NULL DEFAULT 0,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingestion_jobs_workspace ON public.ingestion_jobs(workspace_id);
CREATE INDEX idx_ingestion_jobs_status ON public.ingestion_jobs(status);
CREATE INDEX idx_ingestion_jobs_source ON public.ingestion_jobs(source_id);

-- 4. ingestion_job_items
CREATE TABLE public.ingestion_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.ingestion_jobs(id) ON DELETE CASCADE,
  status ingestion_item_status NOT NULL DEFAULT 'queued',
  source_row_index int,
  source_data jsonb,
  mapped_data jsonb,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  matched_existing_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  action ingestion_action_type,
  match_confidence int,
  parent_group_key text,
  is_parent boolean DEFAULT false,
  grouping_confidence int,
  error_message text,
  error_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingestion_job_items_job ON public.ingestion_job_items(job_id);
CREATE INDEX idx_ingestion_job_items_status ON public.ingestion_job_items(status);

-- 5. RLS
ALTER TABLE public.ingestion_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_job_items ENABLE ROW LEVEL SECURITY;

-- ingestion_sources: viewer+ read, admin+ write
CREATE POLICY "Members can view ingestion sources" ON public.ingestion_sources
  FOR SELECT TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'));

CREATE POLICY "Admins can manage ingestion sources" ON public.ingestion_sources
  FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'admin'))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'admin'));

-- ingestion_jobs: viewer+ read, editor+ write
CREATE POLICY "Members can view ingestion jobs" ON public.ingestion_jobs
  FOR SELECT TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'));

CREATE POLICY "Editors can manage ingestion jobs" ON public.ingestion_jobs
  FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'editor'))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'editor'));

-- ingestion_job_items: via job
CREATE POLICY "Members can view ingestion job items" ON public.ingestion_job_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ingestion_jobs j WHERE j.id = ingestion_job_items.job_id AND has_workspace_access_hybrid(j.workspace_id, 'viewer')));

CREATE POLICY "Editors can manage ingestion job items" ON public.ingestion_job_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ingestion_jobs j WHERE j.id = ingestion_job_items.job_id AND has_workspace_access_hybrid(j.workspace_id, 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ingestion_jobs j WHERE j.id = ingestion_job_items.job_id AND has_workspace_access_hybrid(j.workspace_id, 'editor')));

-- updated_at triggers
CREATE TRIGGER set_ingestion_sources_updated_at BEFORE UPDATE ON public.ingestion_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_ingestion_jobs_updated_at BEFORE UPDATE ON public.ingestion_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for ingestion_jobs
ALTER PUBLICATION supabase_realtime ADD TABLE public.ingestion_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ingestion_job_items;
