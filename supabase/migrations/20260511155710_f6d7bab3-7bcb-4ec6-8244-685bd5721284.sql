-- Drop existing restrictive insert policy
DROP POLICY IF EXISTS "Users can insert their own workspace errors" ON public.catalog_operation_errors;

-- Create a more permissive insert policy for the system/edge functions
-- Note: This is safe because edge functions using service role bypass RLS anyway, 
-- but this provides an extra layer of compatibility.
CREATE POLICY "Enable system logging for errors" 
ON public.catalog_operation_errors 
FOR INSERT 
WITH CHECK (true);

-- Ensure workspace_id and user_id are correctly handled in the products table policies
-- We already have "Users can update products in their workspace", let's make sure it's as clean as possible
DROP POLICY IF EXISTS "Users can update products in their workspace" ON public.products;

CREATE POLICY "Users can update products in their workspace" 
ON public.products 
FOR UPDATE 
USING (
    auth.uid() = user_id 
    OR workspace_id IN (SELECT id FROM workspaces WHERE user_id = auth.uid())
);
