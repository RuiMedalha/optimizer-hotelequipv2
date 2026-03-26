
-- Enums
CREATE TYPE public.catalog_workflow_type_enum AS ENUM ('supplier_import','catalog_refresh','price_update','channel_republish','marketplace_export','full_catalog_cycle');
CREATE TYPE public.catalog_workflow_status_enum AS ENUM ('queued','running','paused','completed','partial','failed','cancelled');
CREATE TYPE public.catalog_step_type_enum AS ENUM ('intake','classification','matching','grouping','canonical_assembly','validation','review','asset_processing','payload_build','publish','sync','monitoring');
CREATE TYPE public.handoff_status_enum AS ENUM ('pending','completed','failed');

-- Tables
CREATE TABLE public.catalog_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  workflow_name TEXT NOT NULL,
  workflow_type public.catalog_workflow_type_enum NOT NULL DEFAULT 'full_catalog_cycle',
  workflow_status public.catalog_workflow_status_enum NOT NULL DEFAULT 'queued',
  workflow_config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.catalog_workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES public.catalog_workflows(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.supplier_profiles(id),
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  status public.catalog_workflow_status_enum NOT NULL DEFAULT 'queued',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  run_summary JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.catalog_workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES public.catalog_workflow_runs(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL DEFAULT 0,
  step_name TEXT NOT NULL,
  step_type public.catalog_step_type_enum NOT NULL,
  status public.catalog_workflow_status_enum NOT NULL DEFAULT 'queued',
  input_ref JSONB DEFAULT '{}',
  output_ref JSONB DEFAULT '{}',
  error_payload JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.workflow_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES public.catalog_workflow_runs(id) ON DELETE CASCADE,
  from_module TEXT NOT NULL,
  to_module TEXT NOT NULL,
  handoff_payload JSONB DEFAULT '{}',
  handoff_status public.handoff_status_enum NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.catalog_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace access catalog_workflows" ON public.catalog_workflows FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE POLICY "workspace access catalog_workflow_runs" ON public.catalog_workflow_runs FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE POLICY "workspace access catalog_workflow_steps" ON public.catalog_workflow_steps FOR ALL USING (EXISTS (SELECT 1 FROM public.catalog_workflow_runs r WHERE r.id = workflow_run_id AND public.has_workspace_access_hybrid(r.workspace_id, 'viewer')));
CREATE POLICY "workspace access workflow_handoffs" ON public.workflow_handoffs FOR ALL USING (EXISTS (SELECT 1 FROM public.catalog_workflow_runs r WHERE r.id = workflow_run_id AND public.has_workspace_access_hybrid(r.workspace_id, 'viewer')));
