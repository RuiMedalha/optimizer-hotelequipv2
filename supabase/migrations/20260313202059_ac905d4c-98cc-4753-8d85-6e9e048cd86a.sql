
-- Fix workspace_role_rank search_path
CREATE OR REPLACE FUNCTION public.workspace_role_rank(_role public.workspace_role)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _role
    WHEN 'owner' THEN 4
    WHEN 'admin' THEN 3
    WHEN 'editor' THEN 2
    WHEN 'viewer' THEN 1
    ELSE 0
  END;
$$;
