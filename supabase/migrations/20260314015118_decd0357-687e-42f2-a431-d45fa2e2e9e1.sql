
-- ORQ-13: Catalog Operations Control Tower

-- Enums
DO $$ BEGIN
  CREATE TYPE public.ct_view_type_enum AS ENUM ('operations','supplier','review','quality','publish','costs','executions');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.ct_widget_type_enum AS ENUM ('kpi_card','status_board','queue_list','timeline','chart','table','heatmap','alert_list');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.ct_alert_scope_enum AS ENUM ('workspace','supplier','job','product','channel','asset','review_queue');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.ct_alert_status_enum AS ENUM ('open','acknowledged','resolved');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.ct_snapshot_type_enum AS ENUM ('hourly','daily','manual','pre_release');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tables
CREATE TABLE IF NOT EXISTS public.control_tower_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  view_name text NOT NULL,
  view_type public.ct_view_type_enum NOT NULL DEFAULT 'operations',
  layout_config jsonb DEFAULT '{}',
  filter_config jsonb DEFAULT '{}',
  is_default boolean DEFAULT false,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.control_tower_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  widget_name text NOT NULL,
  widget_type public.ct_widget_type_enum NOT NULL DEFAULT 'kpi_card',
  widget_config jsonb DEFAULT '{}',
  data_source text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.control_tower_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  alert_type text NOT NULL,
  alert_scope public.ct_alert_scope_enum NOT NULL DEFAULT 'workspace',
  entity_type text,
  entity_id uuid,
  severity integer DEFAULT 1,
  title text NOT NULL,
  message text,
  status public.ct_alert_status_enum DEFAULT 'open',
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.control_tower_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  snapshot_type public.ct_snapshot_type_enum NOT NULL DEFAULT 'manual',
  snapshot_payload jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.control_tower_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_tower_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_tower_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_tower_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ct_views_workspace" ON public.control_tower_views FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE POLICY "ct_widgets_workspace" ON public.control_tower_widgets FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE POLICY "ct_alerts_workspace" ON public.control_tower_alerts FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE POLICY "ct_snapshots_workspace" ON public.control_tower_snapshots FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
