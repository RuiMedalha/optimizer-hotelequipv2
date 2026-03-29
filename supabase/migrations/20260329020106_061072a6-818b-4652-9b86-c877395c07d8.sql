-- Helper: determine whether the current authenticated actor may assign a given workspace role
CREATE OR REPLACE FUNCTION public.can_assign_workspace_role(_workspace_id uuid, _target_role public.workspace_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH actor AS (
    SELECT public.get_workspace_role(_workspace_id) AS actor_role
  )
  SELECT CASE
    WHEN (SELECT actor_role FROM actor) = 'owner'::public.workspace_role THEN true
    WHEN (SELECT actor_role FROM actor) = 'admin'::public.workspace_role
      THEN public.workspace_role_rank(_target_role) < public.workspace_role_rank('admin'::public.workspace_role)
    ELSE false
  END;
$$;

-- Helper: determine whether the current authenticated actor may manage an existing workspace member row
CREATE OR REPLACE FUNCTION public.can_manage_workspace_member_row(
  _workspace_id uuid,
  _member_role public.workspace_role,
  _member_user_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH actor AS (
    SELECT public.get_workspace_role(_workspace_id) AS actor_role
  )
  SELECT CASE
    WHEN (SELECT actor_role FROM actor) = 'owner'::public.workspace_role
      THEN COALESCE(_member_user_id <> auth.uid(), true)
    WHEN (SELECT actor_role FROM actor) = 'admin'::public.workspace_role
      THEN public.workspace_role_rank(_member_role) < public.workspace_role_rank('admin'::public.workspace_role)
        AND COALESCE(_member_user_id <> auth.uid(), true)
    ELSE false
  END;
$$;

-- Tighten workspace member policies to prevent privilege escalation
DROP POLICY IF EXISTS "Admins can insert workspace members" ON public.workspace_members;
CREATE POLICY "Managers can insert workspace members"
ON public.workspace_members
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_assign_workspace_role(workspace_id, role)
  AND COALESCE(user_id <> auth.uid(), true)
);

DROP POLICY IF EXISTS "Admins can update workspace members" ON public.workspace_members;
CREATE POLICY "Managers can update workspace members"
ON public.workspace_members
FOR UPDATE
TO authenticated
USING (
  public.can_manage_workspace_member_row(workspace_id, role, user_id)
)
WITH CHECK (
  public.can_assign_workspace_role(workspace_id, role)
  AND COALESCE(user_id <> auth.uid(), true)
);

DROP POLICY IF EXISTS "Owners can delete workspace members" ON public.workspace_members;
CREATE POLICY "Owners can delete workspace members"
ON public.workspace_members
FOR DELETE
TO authenticated
USING (
  public.is_workspace_owner(workspace_id)
  AND COALESCE(user_id <> auth.uid(), true)
);

-- Tighten notification settings visibility to admins/owners only
DROP POLICY IF EXISTS editors_can_select_notification_settings ON public.workspace_notification_settings;
CREATE POLICY admins_can_select_notification_settings
ON public.workspace_notification_settings
FOR SELECT
TO authenticated
USING (
  public.can_manage_workspace(workspace_id)
);