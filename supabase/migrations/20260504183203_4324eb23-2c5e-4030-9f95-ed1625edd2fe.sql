-- Drop the old restrictive policy
DROP POLICY IF EXISTS "Users can view their own categories" ON public.categories;

-- Create a more permissive policy that checks for workspace membership
CREATE POLICY "Users can view workspace categories" ON public.categories
FOR SELECT
TO authenticated
USING (
  workspace_id IS NULL OR 
  workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  )
);

-- Also allow all authenticated users to see the public categories if they are shared
-- (The above already handles it if workspace_id is NULL)
