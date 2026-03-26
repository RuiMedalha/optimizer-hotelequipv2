
-- source_priority_profiles
CREATE TABLE public.source_priority_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  profile_name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.source_priority_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace access" ON public.source_priority_profiles FOR ALL TO authenticated USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- source_priority_rules
CREATE TABLE public.source_priority_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.source_priority_profiles(id) ON DELETE CASCADE NOT NULL,
  field_name text NOT NULL,
  primary_source text,
  secondary_source text,
  fallback_source text,
  confidence_weight numeric DEFAULT 1.0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.source_priority_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "access via profile" ON public.source_priority_rules FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.source_priority_profiles p WHERE p.id = profile_id AND public.has_workspace_access_hybrid(p.workspace_id, 'viewer')));

-- source_confidence_logs
CREATE TABLE public.source_confidence_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  source_name text NOT NULL,
  confidence_score numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.source_confidence_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "access via product" ON public.source_confidence_logs FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND p.user_id = auth.uid()));
