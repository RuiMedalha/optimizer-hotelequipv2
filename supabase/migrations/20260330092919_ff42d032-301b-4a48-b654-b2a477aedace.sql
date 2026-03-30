
-- Scraping schedules table
CREATE TABLE public.scraping_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  schedule_name text NOT NULL,
  source_url text NOT NULL,
  selectors jsonb DEFAULT '{}'::jsonb,
  field_mapping jsonb DEFAULT '{}'::jsonb,
  cron_expression text NOT NULL DEFAULT '0 6 * * 1',
  frequency text NOT NULL DEFAULT 'weekly',
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_run_status text,
  last_run_products_count integer DEFAULT 0,
  next_run_at timestamptz,
  notify_on_changes boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scraping_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view scraping schedules in their workspace"
  ON public.scraping_schedules FOR SELECT TO authenticated
  USING (public.has_workspace_access(workspace_id, 'viewer'));

CREATE POLICY "Editors can create scraping schedules"
  ON public.scraping_schedules FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access(workspace_id, 'editor'));

CREATE POLICY "Editors can update scraping schedules"
  ON public.scraping_schedules FOR UPDATE TO authenticated
  USING (public.has_workspace_access(workspace_id, 'editor'));

CREATE POLICY "Admins can delete scraping schedules"
  ON public.scraping_schedules FOR DELETE TO authenticated
  USING (public.has_workspace_access(workspace_id, 'admin'));

-- Scraping schedule runs (history)
CREATE TABLE public.scraping_schedule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.scraping_schedules(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  products_found integer DEFAULT 0,
  products_new integer DEFAULT 0,
  products_updated integer DEFAULT 0,
  products_removed integer DEFAULT 0,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  run_payload jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.scraping_schedule_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view schedule runs in their workspace"
  ON public.scraping_schedule_runs FOR SELECT TO authenticated
  USING (public.has_workspace_access(workspace_id, 'viewer'));

CREATE POLICY "System can insert schedule runs"
  ON public.scraping_schedule_runs FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access(workspace_id, 'editor'));
