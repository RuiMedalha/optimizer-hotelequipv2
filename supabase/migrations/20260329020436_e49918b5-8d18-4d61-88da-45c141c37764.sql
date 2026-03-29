DO $$
DECLARE
  rec record;
  write_role text;
BEGIN
  FOR rec IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd = 'ALL'
      AND roles @> ARRAY['authenticated']::name[]
      AND qual = 'has_workspace_access_hybrid(workspace_id, ''viewer''::workspace_role)'
      AND COALESCE(with_check, qual) = 'has_workspace_access_hybrid(workspace_id, ''viewer''::workspace_role)'
  LOOP
    write_role := CASE
      WHEN rec.tablename IN (
        'agent_policies',
        'agent_profiles',
        'catalog_agents',
        'ai_execution_profiles',
        'ai_retry_policies',
        'ai_routing_policies',
        'publish_approval_rules',
        'workspace_budgets',
        'workspace_usage_profiles'
      ) THEN 'admin'
      ELSE 'editor'
    END;

    EXECUTE format('DROP POLICY %I ON public.%I', rec.policyname, rec.tablename);
    EXECUTE format('DROP POLICY IF EXISTS viewer_select ON public.%I', rec.tablename);
    EXECUTE format('DROP POLICY IF EXISTS writer_insert ON public.%I', rec.tablename);
    EXECUTE format('DROP POLICY IF EXISTS writer_update ON public.%I', rec.tablename);
    EXECUTE format('DROP POLICY IF EXISTS writer_delete ON public.%I', rec.tablename);

    EXECUTE format(
      'CREATE POLICY viewer_select ON public.%I FOR SELECT TO authenticated USING (has_workspace_access_hybrid(workspace_id, ''viewer''::workspace_role))',
      rec.tablename
    );
    EXECUTE format(
      'CREATE POLICY writer_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (has_workspace_access_hybrid(workspace_id, %L::workspace_role))',
      rec.tablename,
      write_role
    );
    EXECUTE format(
      'CREATE POLICY writer_update ON public.%I FOR UPDATE TO authenticated USING (has_workspace_access_hybrid(workspace_id, %L::workspace_role)) WITH CHECK (has_workspace_access_hybrid(workspace_id, %L::workspace_role))',
      rec.tablename,
      write_role,
      write_role
    );
    EXECUTE format(
      'CREATE POLICY writer_delete ON public.%I FOR DELETE TO authenticated USING (has_workspace_access_hybrid(workspace_id, %L::workspace_role))',
      rec.tablename,
      write_role
    );
  END LOOP;
END $$;