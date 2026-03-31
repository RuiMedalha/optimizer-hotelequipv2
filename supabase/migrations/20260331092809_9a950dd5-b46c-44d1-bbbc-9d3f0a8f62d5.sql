
CREATE TABLE public.category_architect_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.category_architect_rules(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  woo_product_id bigint NOT NULL,
  product_name text,
  product_sku text,
  original_categories jsonb NOT NULL DEFAULT '[]',
  original_attributes jsonb NOT NULL DEFAULT '[]',
  rollback_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.category_architect_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workspace snapshots"
  ON public.category_architect_snapshots FOR SELECT
  TO authenticated
  USING (public.has_workspace_access(workspace_id, 'viewer'));

CREATE POLICY "Service can insert snapshots"
  ON public.category_architect_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (public.has_workspace_access(workspace_id, 'editor'));

CREATE POLICY "Editors can update snapshots"
  ON public.category_architect_snapshots FOR UPDATE
  TO authenticated
  USING (public.has_workspace_access(workspace_id, 'editor'));

CREATE POLICY "Editors can delete snapshots"
  ON public.category_architect_snapshots FOR DELETE
  TO authenticated
  USING (public.has_workspace_access(workspace_id, 'editor'));

CREATE INDEX idx_snapshots_rule_id ON public.category_architect_snapshots(rule_id);
CREATE INDEX idx_snapshots_workspace ON public.category_architect_snapshots(workspace_id);
