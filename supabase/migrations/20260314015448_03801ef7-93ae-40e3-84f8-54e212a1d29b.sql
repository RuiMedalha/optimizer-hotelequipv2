
-- ORQ-14: Supplier Playbooks & Connector Setup

DO $$ BEGIN CREATE TYPE public.playbook_type_enum AS ENUM ('manufacturer_catalog','distributor_feed','excel_only','pdf_plus_excel','website_plus_excel','xml_feed','api_catalog','hybrid_supplier'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.setup_status_enum AS ENUM ('draft','configuring','testing','ready','active','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.supplier_test_type_enum AS ENUM ('lookup_test','matching_test','grouping_test','taxonomy_test','pricing_test','asset_test','full_pipeline_test'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.supplier_result_status_enum AS ENUM ('success','partial','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.checklist_type_enum AS ENUM ('technical_setup','data_quality','taxonomy_mapping','go_live_readiness'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.supplier_playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  supplier_id uuid REFERENCES public.supplier_profiles(id) ON DELETE SET NULL,
  playbook_name text NOT NULL,
  playbook_type public.playbook_type_enum NOT NULL DEFAULT 'excel_only',
  description text,
  is_template boolean DEFAULT false,
  is_active boolean DEFAULT true,
  version_number integer DEFAULT 1,
  playbook_config jsonb DEFAULT '{}',
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_connector_setups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  supplier_id uuid REFERENCES public.supplier_profiles(id) ON DELETE CASCADE NOT NULL,
  setup_status public.setup_status_enum DEFAULT 'draft',
  setup_config jsonb DEFAULT '{}',
  tested_successfully boolean DEFAULT false,
  last_tested_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_lookup_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.supplier_profiles(id) ON DELETE CASCADE NOT NULL,
  strategy_name text NOT NULL,
  lookup_order jsonb DEFAULT '["sku","supplier_ref","ean","title"]',
  search_url_template text,
  fallback_rules jsonb DEFAULT '{}',
  is_default boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.supplier_profiles(id) ON DELETE CASCADE NOT NULL,
  playbook_id uuid REFERENCES public.supplier_playbooks(id) ON DELETE SET NULL,
  test_type public.supplier_test_type_enum NOT NULL,
  test_payload jsonb DEFAULT '{}',
  result_status public.supplier_result_status_enum,
  result_payload jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_setup_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.supplier_profiles(id) ON DELETE CASCADE NOT NULL,
  checklist_type public.checklist_type_enum NOT NULL DEFAULT 'technical_setup',
  checklist_items jsonb DEFAULT '[]',
  completion_status text DEFAULT 'incomplete',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.supplier_playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_connector_setups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_lookup_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_setup_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sp_playbooks_ws" ON public.supplier_playbooks FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE POLICY "sp_connsetups_ws" ON public.supplier_connector_setups FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE POLICY "sp_lookup_ws" ON public.supplier_lookup_strategies FOR ALL USING (
  EXISTS (SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'viewer'))
);
CREATE POLICY "sp_testruns_ws" ON public.supplier_test_runs FOR ALL USING (
  EXISTS (SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'viewer'))
);
CREATE POLICY "sp_checklists_ws" ON public.supplier_setup_checklists FOR ALL USING (
  EXISTS (SELECT 1 FROM public.supplier_profiles sp WHERE sp.id = supplier_id AND public.has_workspace_access_hybrid(sp.workspace_id, 'viewer'))
);
