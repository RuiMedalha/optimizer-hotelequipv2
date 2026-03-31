
-- Create product_uso_profissional table
CREATE TABLE public.product_uso_profissional (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
  workspace_id uuid NOT NULL,
  intro text,
  use_cases jsonb DEFAULT '[]'::jsonb,
  professional_tips jsonb DEFAULT '[]'::jsonb,
  target_profiles jsonb DEFAULT '[]'::jsonb,
  publish_enabled boolean DEFAULT false,
  placement text DEFAULT 'before_faq',
  generated_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(product_id, workspace_id)
);

-- Enable RLS
ALTER TABLE public.product_uso_profissional ENABLE ROW LEVEL SECURITY;

-- RLS policies: workspace-scoped via workspace_members
CREATE POLICY "Users can view uso profissional in their workspaces"
  ON public.product_uso_profissional
  FOR SELECT
  TO authenticated
  USING (public.has_workspace_access(workspace_id, 'viewer'));

CREATE POLICY "Editors can insert uso profissional"
  ON public.product_uso_profissional
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_edit_workspace_content(workspace_id));

CREATE POLICY "Editors can update uso profissional"
  ON public.product_uso_profissional
  FOR UPDATE
  TO authenticated
  USING (public.can_edit_workspace_content(workspace_id))
  WITH CHECK (public.can_edit_workspace_content(workspace_id));

CREATE POLICY "Editors can delete uso profissional"
  ON public.product_uso_profissional
  FOR DELETE
  TO authenticated
  USING (public.can_edit_workspace_content(workspace_id));

-- Updated_at trigger
CREATE TRIGGER update_product_uso_profissional_updated_at
  BEFORE UPDATE ON public.product_uso_profissional
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
