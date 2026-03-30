
CREATE TABLE public.category_architect_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  source_category_name text NOT NULL,
  action text NOT NULL CHECK (action IN ('keep', 'convert_to_attribute', 'merge_into')),
  target_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  attribute_slug text,
  attribute_name text,
  attribute_values text[] DEFAULT '{}',
  attribute_woo_id integer,
  migration_status text NOT NULL DEFAULT 'pending' CHECK (migration_status IN ('pending', 'attribute_created', 'migrating', 'migrated', 'error')),
  migration_progress integer DEFAULT 0,
  migration_total integer DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.category_architect_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workspace rules"
  ON public.category_architect_rules FOR SELECT
  TO authenticated
  USING (public.has_workspace_access(workspace_id, 'viewer'));

CREATE POLICY "Editors can insert rules"
  ON public.category_architect_rules FOR INSERT
  TO authenticated
  WITH CHECK (public.has_workspace_access(workspace_id, 'editor'));

CREATE POLICY "Editors can update rules"
  ON public.category_architect_rules FOR UPDATE
  TO authenticated
  USING (public.has_workspace_access(workspace_id, 'editor'));

CREATE POLICY "Editors can delete rules"
  ON public.category_architect_rules FOR DELETE
  TO authenticated
  USING (public.has_workspace_access(workspace_id, 'editor'));
