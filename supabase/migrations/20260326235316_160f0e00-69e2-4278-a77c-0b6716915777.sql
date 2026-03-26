-- 1. FIX: channel_connections credentials readable by all viewers
DROP POLICY IF EXISTS "workspace_access_channel_connections" ON public.channel_connections;

CREATE POLICY "editors_can_read_channel_connections"
ON public.channel_connections FOR SELECT
TO authenticated
USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

CREATE POLICY "admins_can_insert_channel_connections"
ON public.channel_connections FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_workspace(workspace_id));

CREATE POLICY "admins_can_update_channel_connections"
ON public.channel_connections FOR UPDATE
TO authenticated
USING (public.can_manage_workspace(workspace_id))
WITH CHECK (public.can_manage_workspace(workspace_id));

CREATE POLICY "admins_can_delete_channel_connections"
ON public.channel_connections FOR DELETE
TO authenticated
USING (public.can_manage_workspace(workspace_id));

-- 2. FIX: workspace_invitations tokens readable by all viewers
DROP POLICY IF EXISTS "Members can view workspace invitations" ON public.workspace_invitations;

CREATE POLICY "Admins can view workspace invitations"
ON public.workspace_invitations FOR SELECT
TO authenticated
USING (
  public.can_manage_workspace(workspace_id)
  OR EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE workspaces.id = workspace_invitations.workspace_id
      AND workspaces.user_id = auth.uid()
  )
);

-- 3. FIX: ai_providers config readable by all viewers
DROP POLICY IF EXISTS "Users can manage workspace ai_providers" ON public.ai_providers;

CREATE POLICY "editors_can_read_ai_providers"
ON public.ai_providers FOR SELECT
TO authenticated
USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

CREATE POLICY "admins_can_write_ai_providers"
ON public.ai_providers FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_workspace(workspace_id));

CREATE POLICY "admins_can_update_ai_providers"
ON public.ai_providers FOR UPDATE
TO authenticated
USING (public.can_manage_workspace(workspace_id))
WITH CHECK (public.can_manage_workspace(workspace_id));

CREATE POLICY "admins_can_delete_ai_providers"
ON public.ai_providers FOR DELETE
TO authenticated
USING (public.can_manage_workspace(workspace_id));