
-- ===== SEO LIFECYCLE MODULE =====

-- 1. Workspace SEO config
CREATE TABLE public.seo_lifecycle_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  default_days_before_redirect INTEGER NOT NULL DEFAULT 10,
  discontinued_keep_index_days INTEGER NOT NULL DEFAULT 7,
  default_redirect_target_type TEXT NOT NULL DEFAULT 'category',
  fallback_redirect_url TEXT NOT NULL DEFAULT '/loja/',
  enable_ai_alternatives BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id)
);

ALTER TABLE public.seo_lifecycle_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seo_lifecycle_config_select" ON public.seo_lifecycle_config
  FOR SELECT TO authenticated
  USING (public.has_workspace_access(workspace_id, 'viewer'));

CREATE POLICY "seo_lifecycle_config_insert" ON public.seo_lifecycle_config
  FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access(workspace_id, 'admin'));

CREATE POLICY "seo_lifecycle_config_update" ON public.seo_lifecycle_config
  FOR UPDATE TO authenticated
  USING (public.has_workspace_access(workspace_id, 'admin'));

-- 2. Product SEO Lifecycle tracking
CREATE TABLE public.product_seo_lifecycle (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku TEXT,
  lifecycle_phase TEXT NOT NULL DEFAULT 'active',
  discontinued_at TIMESTAMPTZ,
  pending_redirect_at TIMESTAMPTZ,
  redirect_target_type TEXT,
  redirect_target_url TEXT,
  days_before_redirect INTEGER,
  noindex_at TIMESTAMPTZ,
  previous_slug TEXT,
  previous_url TEXT,
  current_url TEXT,
  alternative_product_ids UUID[],
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id)
);

ALTER TABLE public.product_seo_lifecycle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_seo_lifecycle_select" ON public.product_seo_lifecycle
  FOR SELECT TO authenticated
  USING (public.has_workspace_access(workspace_id, 'viewer'));

CREATE POLICY "product_seo_lifecycle_insert" ON public.product_seo_lifecycle
  FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access(workspace_id, 'editor'));

CREATE POLICY "product_seo_lifecycle_update" ON public.product_seo_lifecycle
  FOR UPDATE TO authenticated
  USING (public.has_workspace_access(workspace_id, 'editor'));

CREATE POLICY "product_seo_lifecycle_delete" ON public.product_seo_lifecycle
  FOR DELETE TO authenticated
  USING (public.has_workspace_access(workspace_id, 'admin'));

CREATE INDEX idx_seo_lifecycle_workspace ON public.product_seo_lifecycle(workspace_id);
CREATE INDEX idx_seo_lifecycle_phase ON public.product_seo_lifecycle(lifecycle_phase);
CREATE INDEX idx_seo_lifecycle_discontinued ON public.product_seo_lifecycle(discontinued_at) WHERE lifecycle_phase = 'discontinued';

-- 3. Product Redirects
CREATE TABLE public.product_redirects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  redirect_type INTEGER NOT NULL DEFAULT 301,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ
);

ALTER TABLE public.product_redirects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_redirects_select" ON public.product_redirects
  FOR SELECT TO authenticated
  USING (public.has_workspace_access(workspace_id, 'viewer'));

CREATE POLICY "product_redirects_insert" ON public.product_redirects
  FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access(workspace_id, 'editor'));

CREATE POLICY "product_redirects_update" ON public.product_redirects
  FOR UPDATE TO authenticated
  USING (public.has_workspace_access(workspace_id, 'editor'));

CREATE INDEX idx_redirects_workspace ON public.product_redirects(workspace_id);
CREATE INDEX idx_redirects_source ON public.product_redirects(source_url);
CREATE INDEX idx_redirects_status ON public.product_redirects(status);

-- 4. SEO Lifecycle Logs
CREATE TABLE public.seo_lifecycle_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  old_phase TEXT,
  new_phase TEXT,
  details JSONB,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.seo_lifecycle_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seo_lifecycle_logs_select" ON public.seo_lifecycle_logs
  FOR SELECT TO authenticated
  USING (public.has_workspace_access(workspace_id, 'viewer'));

CREATE POLICY "seo_lifecycle_logs_insert" ON public.seo_lifecycle_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access(workspace_id, 'editor'));

CREATE INDEX idx_seo_logs_workspace ON public.seo_lifecycle_logs(workspace_id);
CREATE INDEX idx_seo_logs_product ON public.seo_lifecycle_logs(product_id);

-- Trigger for updated_at
CREATE TRIGGER set_seo_lifecycle_updated_at
  BEFORE UPDATE ON public.product_seo_lifecycle
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_seo_lifecycle_config_updated_at
  BEFORE UPDATE ON public.seo_lifecycle_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
