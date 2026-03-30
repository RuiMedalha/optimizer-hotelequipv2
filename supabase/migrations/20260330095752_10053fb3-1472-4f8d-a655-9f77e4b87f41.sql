
-- Table to store detected changes between scraping runs
CREATE TABLE public.scraping_change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES public.scraping_schedules(id) ON DELETE CASCADE NOT NULL,
  run_id uuid REFERENCES public.scraping_schedule_runs(id) ON DELETE SET NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('new_product', 'removed_product', 'price_change', 'stock_change', 'title_change', 'other')),
  product_sku text,
  product_title text,
  field_name text,
  old_value text,
  new_value text,
  change_magnitude numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scraping_change_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view changes in their workspace"
  ON public.scraping_change_logs FOR SELECT TO authenticated
  USING (public.has_workspace_access(workspace_id, 'viewer'));

CREATE POLICY "Service can insert changes"
  ON public.scraping_change_logs FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access(workspace_id, 'editor'));

CREATE INDEX idx_scraping_change_logs_schedule ON public.scraping_change_logs(schedule_id, created_at DESC);
CREATE INDEX idx_scraping_change_logs_workspace ON public.scraping_change_logs(workspace_id, created_at DESC);
