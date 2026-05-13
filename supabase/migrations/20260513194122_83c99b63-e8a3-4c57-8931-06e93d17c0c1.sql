
DROP POLICY IF EXISTS "Users can manage their workspace aliases" ON public.sku_aliases;
CREATE POLICY "Users can manage their workspace aliases"
ON public.sku_aliases FOR ALL TO authenticated
USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role))
WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

DROP POLICY IF EXISTS "Users can manage their workspace field rules" ON public.field_rules;
CREATE POLICY "Users can manage their workspace field rules"
ON public.field_rules FOR ALL TO authenticated
USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role))
WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

DROP POLICY IF EXISTS "Users can manage their workspace sync staging" ON public.sync_staging;
CREATE POLICY "Users can manage their workspace sync staging"
ON public.sync_staging FOR ALL TO authenticated
USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role))
WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- category_learning has no workspace_id; restrict to authenticated read-only, block client writes.
DROP POLICY IF EXISTS "Authenticated users can manage learning patterns" ON public.category_learning;
DROP POLICY IF EXISTS "Everyone can view learning patterns" ON public.category_learning;
CREATE POLICY "Authenticated users can read learning patterns"
ON public.category_learning FOR SELECT TO authenticated
USING (true);

-- catalog_operation_errors
DROP POLICY IF EXISTS "Enable system logging for errors" ON public.catalog_operation_errors;
DROP POLICY IF EXISTS "Users can delete their own workspace errors" ON public.catalog_operation_errors;
DROP POLICY IF EXISTS "Users can update their own workspace errors" ON public.catalog_operation_errors;
DROP POLICY IF EXISTS "Users can view their own workspace errors" ON public.catalog_operation_errors;
CREATE POLICY "Users can insert their own error logs"
ON public.catalog_operation_errors FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view their own error logs"
ON public.catalog_operation_errors FOR SELECT TO authenticated
USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own error logs"
ON public.catalog_operation_errors FOR UPDATE TO authenticated
USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own error logs"
ON public.catalog_operation_errors FOR DELETE TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update products in their workspace" ON public.products;
CREATE POLICY "Users can update products in their workspace"
ON public.products FOR UPDATE TO authenticated
USING (
  (auth.uid() = user_id) OR
  (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()))
);

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'workspace_settings' AND schemaname = 'public' LOOP
    EXECUTE format('ALTER POLICY %I ON public.workspace_settings TO authenticated', r.policyname);
  END LOOP;
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'category_learning_patterns' AND schemaname = 'public' LOOP
    EXECUTE format('ALTER POLICY %I ON public.category_learning_patterns TO authenticated', r.policyname);
  END LOOP;
END $$;
