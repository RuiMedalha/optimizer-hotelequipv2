
-- =============================================
-- BLOCO 5: DAM Enterprise + Image Pipeline
-- =============================================

-- 1. ENUMS
CREATE TYPE public.asset_type_enum AS ENUM ('original','optimized','lifestyle','technical','packshot','derived');
CREATE TYPE public.asset_source_enum AS ENUM ('upload','scrape','ai_generated','api','ocr');
CREATE TYPE public.background_enum AS ENUM ('white','transparent','lifestyle','custom','unknown');
CREATE TYPE public.asset_status_enum AS ENUM ('active','archived','processing','error','pending_review');
CREATE TYPE public.asset_review_status_enum AS ENUM ('unreviewed','approved','rejected');
CREATE TYPE public.asset_usage_enum AS ENUM ('main','gallery','lifestyle','technical','seo','social');
CREATE TYPE public.asset_variant_enum AS ENUM ('thumbnail','medium','large','social','marketplace');
CREATE TYPE public.image_operation_enum AS ENUM ('download','optimize','background_remove','resize');
CREATE TYPE public.image_job_status AS ENUM ('queued','processing','done','error');
CREATE TYPE public.image_job_item_status AS ENUM ('queued','processing','done','error','skipped');

-- 2. IMAGE_JOBS (must be created before asset_library due to FK)
CREATE TABLE public.image_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status image_job_status NOT NULL DEFAULT 'queued',
  total_items integer NOT NULL DEFAULT 0,
  processed_items integer NOT NULL DEFAULT 0,
  failed_items integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_image_jobs_workspace ON public.image_jobs(workspace_id);
CREATE INDEX idx_image_jobs_status ON public.image_jobs(status);

CREATE TRIGGER trg_image_jobs_updated_at BEFORE UPDATE ON public.image_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.image_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view image jobs" ON public.image_jobs
  FOR SELECT TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'));

CREATE POLICY "Editors can manage image jobs" ON public.image_jobs
  FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'editor'))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'editor'));

-- 3. ASSET_LIBRARY
CREATE TABLE public.asset_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  original_filename text,
  storage_path text,
  public_url text,
  file_hash text,
  mime_type text,
  width integer,
  height integer,
  file_size bigint,
  format text,
  asset_type asset_type_enum NOT NULL DEFAULT 'original',
  source_kind asset_source_enum NOT NULL DEFAULT 'upload',
  provider text,
  background_type background_enum DEFAULT 'unknown',
  generation_prompt text,
  processing_job_id uuid REFERENCES public.image_jobs(id) ON DELETE SET NULL,
  quality_score integer,
  ai_alt_text text,
  ai_tags text[] DEFAULT '{}',
  parent_asset_id uuid REFERENCES public.asset_library(id) ON DELETE SET NULL,
  family_shared boolean NOT NULL DEFAULT false,
  status asset_status_enum NOT NULL DEFAULT 'active',
  review_status asset_review_status_enum NOT NULL DEFAULT 'unreviewed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_asset_library_workspace ON public.asset_library(workspace_id);
CREATE INDEX idx_asset_library_hash ON public.asset_library(file_hash);
CREATE INDEX idx_asset_library_status ON public.asset_library(status);
CREATE UNIQUE INDEX idx_asset_library_dedup ON public.asset_library(workspace_id, file_hash) WHERE file_hash IS NOT NULL;

CREATE TRIGGER trg_asset_library_updated_at BEFORE UPDATE ON public.asset_library
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.asset_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view assets" ON public.asset_library
  FOR SELECT TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'));

CREATE POLICY "Editors can insert assets" ON public.asset_library
  FOR INSERT TO authenticated
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'editor'));

CREATE POLICY "Editors can update assets" ON public.asset_library
  FOR UPDATE TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'editor'));

CREATE POLICY "Admins can delete assets" ON public.asset_library
  FOR DELETE TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'admin'));

-- 4. ASSET_PRODUCT_LINKS
CREATE TABLE public.asset_product_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.asset_library(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  usage_context asset_usage_enum NOT NULL DEFAULT 'gallery',
  sort_order integer NOT NULL DEFAULT 0,
  channel_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_asset_product_links_product ON public.asset_product_links(product_id);
CREATE INDEX idx_asset_product_links_asset ON public.asset_product_links(asset_id);
CREATE UNIQUE INDEX idx_asset_product_links_unique ON public.asset_product_links(product_id, asset_id, usage_context) WHERE channel_id IS NULL;

ALTER TABLE public.asset_product_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view asset links" ON public.asset_product_links
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.asset_library a
    WHERE a.id = asset_product_links.asset_id
    AND has_workspace_access_hybrid(a.workspace_id, 'viewer')
  ));

CREATE POLICY "Editors can manage asset links" ON public.asset_product_links
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.asset_library a
    WHERE a.id = asset_product_links.asset_id
    AND has_workspace_access_hybrid(a.workspace_id, 'editor')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.asset_library a
    WHERE a.id = asset_product_links.asset_id
    AND has_workspace_access_hybrid(a.workspace_id, 'editor')
  ));

-- 5. ASSET_VARIANTS
CREATE TABLE public.asset_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_asset_id uuid NOT NULL REFERENCES public.asset_library(id) ON DELETE CASCADE,
  channel_id uuid,
  variant_type asset_variant_enum NOT NULL,
  width integer,
  height integer,
  format text,
  storage_path text,
  public_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_asset_variants_source ON public.asset_variants(source_asset_id);
CREATE INDEX idx_asset_variants_channel ON public.asset_variants(channel_id);

ALTER TABLE public.asset_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view variants" ON public.asset_variants
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.asset_library a
    WHERE a.id = asset_variants.source_asset_id
    AND has_workspace_access_hybrid(a.workspace_id, 'viewer')
  ));

CREATE POLICY "Editors can manage variants" ON public.asset_variants
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.asset_library a
    WHERE a.id = asset_variants.source_asset_id
    AND has_workspace_access_hybrid(a.workspace_id, 'editor')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.asset_library a
    WHERE a.id = asset_variants.source_asset_id
    AND has_workspace_access_hybrid(a.workspace_id, 'editor')
  ));

-- 6. IMAGE_JOB_ITEMS
CREATE TABLE public.image_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.image_jobs(id) ON DELETE CASCADE,
  image_id uuid REFERENCES public.asset_library(id) ON DELETE SET NULL,
  operation image_operation_enum NOT NULL,
  input_url text,
  output_url text,
  status image_job_item_status NOT NULL DEFAULT 'queued',
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  error_message text,
  error_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_image_job_items_job ON public.image_job_items(job_id);

ALTER TABLE public.image_job_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view image job items" ON public.image_job_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.image_jobs j
    WHERE j.id = image_job_items.job_id
    AND has_workspace_access_hybrid(j.workspace_id, 'viewer')
  ));

CREATE POLICY "Editors can manage image job items" ON public.image_job_items
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.image_jobs j
    WHERE j.id = image_job_items.job_id
    AND has_workspace_access_hybrid(j.workspace_id, 'editor')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.image_jobs j
    WHERE j.id = image_job_items.job_id
    AND has_workspace_access_hybrid(j.workspace_id, 'editor')
  ));

-- 7. ALTER EXISTING TABLES (backward compatible)
ALTER TABLE public.images ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.asset_library(id) ON DELETE SET NULL;
ALTER TABLE public.images ADD COLUMN IF NOT EXISTS usage_context asset_usage_enum;

-- Enable realtime for image_jobs
ALTER PUBLICATION supabase_realtime ADD TABLE public.image_jobs;
