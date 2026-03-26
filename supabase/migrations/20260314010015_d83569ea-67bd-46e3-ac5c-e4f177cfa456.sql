
-- product_identity_rules
CREATE TABLE public.product_identity_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  rule_name text NOT NULL,
  rule_config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_identity_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws access" ON public.product_identity_rules FOR ALL TO authenticated USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- variation_policies
CREATE TABLE public.variation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  policy_name text NOT NULL,
  attribute_keys text[] NOT NULL DEFAULT '{}',
  variation_strategy text NOT NULL DEFAULT 'auto',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.variation_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws access" ON public.variation_policies FOR ALL TO authenticated USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- product_groupings
CREATE TABLE public.product_groupings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  group_type text NOT NULL DEFAULT 'variation',
  parent_product_id uuid REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
  child_product_id uuid REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
  group_reason text,
  confidence_score numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_groupings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws access" ON public.product_groupings FOR ALL TO authenticated USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
