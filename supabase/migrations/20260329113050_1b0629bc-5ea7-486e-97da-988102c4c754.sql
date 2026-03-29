
-- Fix workspace_members INSERT policy: require user_id NOT NULL and explicit admin+ check
DROP POLICY IF EXISTS "Managers can insert workspace members" ON public.workspace_members;
CREATE POLICY "Managers can insert workspace members"
ON public.workspace_members
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_workspace_access(workspace_id, 'admin'::workspace_role)
  AND public.can_assign_workspace_role(workspace_id, role)
  AND user_id IS NOT NULL
  AND user_id <> auth.uid()
);

-- Fix workspace_members UPDATE policy: require user_id NOT NULL
DROP POLICY IF EXISTS "Managers can update workspace members" ON public.workspace_members;
CREATE POLICY "Managers can update workspace members"
ON public.workspace_members
FOR UPDATE
TO authenticated
USING (
  public.can_manage_workspace_member_row(workspace_id, role, user_id)
)
WITH CHECK (
  public.can_assign_workspace_role(workspace_id, role)
  AND user_id IS NOT NULL
  AND user_id <> auth.uid()
);
