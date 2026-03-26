
-- Supplier auto-detections
CREATE TABLE public.supplier_auto_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  file_name TEXT,
  source_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'excel',
  detected_supplier_name TEXT,
  detected_domain TEXT,
  detected_brand TEXT,
  detection_signals JSONB DEFAULT '{}',
  matched_supplier_id UUID REFERENCES public.supplier_profiles(id),
  confidence NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_auto_detections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_access_supplier_auto_detections" ON public.supplier_auto_detections
  FOR ALL TO authenticated USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- Supplier column inferences
CREATE TABLE public.supplier_column_inferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.supplier_profiles(id),
  detection_id UUID REFERENCES public.supplier_auto_detections(id),
  file_name TEXT,
  headers TEXT[] DEFAULT '{}',
  inferred_mapping JSONB DEFAULT '{}',
  mapping_confidence NUMERIC DEFAULT 0,
  mapping_warnings TEXT[] DEFAULT '{}',
  sample_data JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_column_inferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_access_supplier_column_inferences" ON public.supplier_column_inferences
  FOR ALL TO authenticated USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- Supplier playbook drafts (auto-generated)
CREATE TABLE public.supplier_playbook_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.supplier_profiles(id),
  detection_id UUID REFERENCES public.supplier_auto_detections(id),
  playbook_name TEXT NOT NULL,
  playbook_config JSONB DEFAULT '{}',
  column_mapping JSONB DEFAULT '{}',
  matching_rules JSONB DEFAULT '[]',
  grouping_rules JSONB DEFAULT '[]',
  taxonomy_suggestion JSONB DEFAULT '{}',
  image_strategy JSONB DEFAULT '{}',
  validation_profile JSONB DEFAULT '{}',
  confidence_score NUMERIC DEFAULT 0,
  needs_review_fields TEXT[] DEFAULT '{}',
  auto_generated BOOLEAN DEFAULT true,
  status TEXT NOT NULL DEFAULT 'draft',
  promoted_playbook_id UUID REFERENCES public.supplier_playbooks(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_playbook_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_access_supplier_playbook_drafts" ON public.supplier_playbook_drafts
  FOR ALL TO authenticated USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- Supplier overrides (human corrections)
CREATE TABLE public.supplier_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.supplier_profiles(id),
  override_type TEXT NOT NULL,
  override_key TEXT NOT NULL,
  override_value JSONB NOT NULL DEFAULT '{}',
  instruction TEXT,
  source TEXT DEFAULT 'manual',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_access_supplier_overrides" ON public.supplier_overrides
  FOR ALL TO authenticated USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
