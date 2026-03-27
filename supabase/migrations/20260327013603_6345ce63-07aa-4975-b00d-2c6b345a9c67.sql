
-- Fix: Remove NULL branch from SELECT policy to prevent cross-tenant leakage
DROP POLICY IF EXISTS "workspace_select_pdf_layout_signatures" ON public.pdf_layout_signatures;

CREATE POLICY "workspace_select_pdf_layout_signatures"
ON public.pdf_layout_signatures FOR SELECT
TO authenticated
USING (
  workspace_id IS NOT NULL
  AND public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role)
);
