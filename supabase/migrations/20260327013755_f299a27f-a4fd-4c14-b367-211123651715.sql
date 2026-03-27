
-- 1. FIX: channel_connections credentials - restrict SELECT to admins only
DROP POLICY IF EXISTS "editors_can_read_channel_connections" ON public.channel_connections;

CREATE POLICY "admins_can_read_channel_connections"
ON public.channel_connections FOR SELECT
TO authenticated
USING (public.can_manage_workspace(workspace_id));

-- 2. FIX: workspace_notification_settings - restrict to editors+
DROP POLICY IF EXISTS "Users can manage their workspace notification settings" ON public.workspace_notification_settings;

CREATE POLICY "editors_can_select_notification_settings"
ON public.workspace_notification_settings FOR SELECT
TO authenticated
USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

CREATE POLICY "admins_can_insert_notification_settings"
ON public.workspace_notification_settings FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_workspace(workspace_id));

CREATE POLICY "admins_can_update_notification_settings"
ON public.workspace_notification_settings FOR UPDATE
TO authenticated
USING (public.can_manage_workspace(workspace_id))
WITH CHECK (public.can_manage_workspace(workspace_id));

CREATE POLICY "admins_can_delete_notification_settings"
ON public.workspace_notification_settings FOR DELETE
TO authenticated
USING (public.can_manage_workspace(workspace_id));

-- 3. FIX: workspace_invitations - exclude token from reads via view approach
-- Since we can't do column-level security with RLS, we'll restrict SELECT to owners only
DROP POLICY IF EXISTS "Admins can view workspace invitations" ON public.workspace_invitations;

CREATE POLICY "Owners can view workspace invitations"
ON public.workspace_invitations FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE workspaces.id = workspace_invitations.workspace_id
      AND workspaces.user_id = auth.uid()
  )
);
