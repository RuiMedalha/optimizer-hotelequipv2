
-- Fix privilege escalation: prevent admins from setting role higher than their own
DROP POLICY IF EXISTS "Admins can update workspace members" ON public.workspace_members;

CREATE POLICY "Admins can update workspace members" ON public.workspace_members
FOR UPDATE
TO authenticated
USING (
  can_manage_workspace(workspace_id) 
  OR EXISTS (
    SELECT 1 FROM workspaces 
    WHERE workspaces.id = workspace_members.workspace_id 
    AND workspaces.user_id = auth.uid()
  )
)
WITH CHECK (
  -- True workspace owner (from workspaces table) can set any role
  EXISTS (
    SELECT 1 FROM workspaces 
    WHERE workspaces.id = workspace_members.workspace_id 
    AND workspaces.user_id = auth.uid()
  )
  OR (
    -- Non-owners: cannot set role to 'owner' and cannot modify their own role
    can_manage_workspace(workspace_id)
    AND role != 'owner'
    AND user_id != auth.uid()
  )
);
