
-- Safe view for channel_connections (excludes credentials)
CREATE OR REPLACE VIEW public.channel_connections_safe AS
  SELECT id, workspace_id, channel_id, connection_name, status, 
         settings, last_sync_at, created_at,
         CASE WHEN credentials IS NOT NULL AND credentials::text != '{}' AND credentials::text != 'null'
              THEN true ELSE false END AS has_credentials
  FROM public.channel_connections;

-- Safe view for workspace_invitations (excludes token)
CREATE OR REPLACE VIEW public.workspace_invitations_safe AS
  SELECT id, workspace_id, email, role, invited_by, 
         created_at, expires_at, accepted_at, status
  FROM public.workspace_invitations;

-- Tighten workspace_invitations policies
DO $$ BEGIN
  DROP POLICY IF EXISTS "ws_invite_select" ON public.workspace_invitations;
  DROP POLICY IF EXISTS "Workspace admins can view invitations" ON public.workspace_invitations;
  DROP POLICY IF EXISTS "Workspace owners can manage invitations" ON public.workspace_invitations;
  DROP POLICY IF EXISTS "workspace_invitations_select" ON public.workspace_invitations;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE POLICY "wi_select_admin" ON public.workspace_invitations
  FOR SELECT TO authenticated
  USING (public.can_manage_workspace(workspace_id));

CREATE POLICY "wi_insert_admin" ON public.workspace_invitations
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_workspace(workspace_id));

CREATE POLICY "wi_update_admin" ON public.workspace_invitations
  FOR UPDATE TO authenticated
  USING (public.can_manage_workspace(workspace_id));
