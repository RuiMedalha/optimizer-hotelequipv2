-- Backfill: insert owner into workspace_members for all existing workspaces
INSERT INTO public.workspace_members (workspace_id, user_id, email, role, status, accepted_at, invited_at)
SELECT 
  w.id,
  w.user_id,
  COALESCE(p.email, u.email, 'owner@workspace'),
  'owner'::workspace_role,
  'active'::workspace_member_status,
  w.created_at,
  w.created_at
FROM public.workspaces w
LEFT JOIN public.profiles p ON p.user_id = w.user_id
LEFT JOIN auth.users u ON u.id = w.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.workspace_members wm
  WHERE wm.workspace_id = w.id AND wm.user_id = w.user_id
);

-- Create trigger function to auto-insert owner when workspace is created
CREATE OR REPLACE FUNCTION public.auto_insert_workspace_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.workspace_members (workspace_id, user_id, email, role, status, accepted_at, invited_at)
  SELECT
    NEW.id,
    NEW.user_id,
    COALESCE(
      (SELECT email FROM public.profiles WHERE user_id = NEW.user_id LIMIT 1),
      (SELECT email FROM auth.users WHERE id = NEW.user_id LIMIT 1),
      'owner@workspace'
    ),
    'owner'::workspace_role,
    'active'::workspace_member_status,
    now(),
    now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = NEW.id AND user_id = NEW.user_id
  );
  RETURN NEW;
END;
$$;

-- Attach trigger
DROP TRIGGER IF EXISTS trg_auto_insert_workspace_owner ON public.workspaces;
CREATE TRIGGER trg_auto_insert_workspace_owner
  AFTER INSERT ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_insert_workspace_owner();