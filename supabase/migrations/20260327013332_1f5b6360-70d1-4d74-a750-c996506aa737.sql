
-- 1. Add workspace_id column to pdf_layout_signatures
ALTER TABLE public.pdf_layout_signatures
  ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

-- 2. Drop old permissive policies
DROP POLICY IF EXISTS "active_member_select" ON public.pdf_layout_signatures;
DROP POLICY IF EXISTS "active_member_insert" ON public.pdf_layout_signatures;

-- 3. Create workspace-scoped RLS policies
CREATE POLICY "workspace_select_pdf_layout_signatures"
ON public.pdf_layout_signatures FOR SELECT
TO authenticated
USING (
  workspace_id IS NULL
  OR public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role)
);

CREATE POLICY "workspace_insert_pdf_layout_signatures"
ON public.pdf_layout_signatures FOR INSERT
TO authenticated
WITH CHECK (
  workspace_id IS NOT NULL
  AND public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role)
);

CREATE POLICY "workspace_update_pdf_layout_signatures"
ON public.pdf_layout_signatures FOR UPDATE
TO authenticated
USING (
  workspace_id IS NOT NULL
  AND public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role)
)
WITH CHECK (
  workspace_id IS NOT NULL
  AND public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role)
);

CREATE POLICY "workspace_delete_pdf_layout_signatures"
ON public.pdf_layout_signatures FOR DELETE
TO authenticated
USING (
  workspace_id IS NOT NULL
  AND public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role)
);
