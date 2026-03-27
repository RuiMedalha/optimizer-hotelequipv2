
-- ═══ BATCH 1: Fix RLS policies from public to authenticated (agent/ai tables) ═══

DROP POLICY IF EXISTS "Users can create their own activity" ON public.activity_log;
CREATE POLICY "Users can create their own activity" ON public.activity_log FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own activity" ON public.activity_log;
CREATE POLICY "Users can view their own activity" ON public.activity_log FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can manage own workspace agent actions" ON public.agent_actions;
CREATE POLICY "Users can manage own workspace agent actions" ON public.agent_actions FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "Users can manage own workspace agent memory" ON public.agent_decision_memory;
CREATE POLICY "Users can manage own workspace agent memory" ON public.agent_decision_memory FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "Users can manage own workspace agent policies" ON public.agent_policies;
CREATE POLICY "Users can manage own workspace agent policies" ON public.agent_policies FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "ar_runs_ws" ON public.agent_runs;
CREATE POLICY "ar_runs_ws" ON public.agent_runs FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "ar_alerts_ws" ON public.agent_runtime_alerts;
CREATE POLICY "ar_alerts_ws" ON public.agent_runtime_alerts FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "Users can manage own workspace agent schedules" ON public.agent_schedules;
CREATE POLICY "Users can manage own workspace agent schedules" ON public.agent_schedules FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "Users can manage own workspace agent tasks" ON public.agent_tasks;
CREATE POLICY "Users can manage own workspace agent tasks" ON public.agent_tasks FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "Users can manage ai_routing_policies in their workspace" ON public.ai_routing_policies;
CREATE POLICY "Users can manage ai_routing_policies in their workspace" ON public.ai_routing_policies FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "Users can manage own workspace agents" ON public.catalog_agents;
CREATE POLICY "Users can manage own workspace agents" ON public.catalog_agents FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "brain_entities_ws" ON public.catalog_brain_entities;
CREATE POLICY "brain_entities_ws" ON public.catalog_brain_entities FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "brain_observations_ws" ON public.catalog_brain_observations;
CREATE POLICY "brain_observations_ws" ON public.catalog_brain_observations FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "brain_outcomes_ws" ON public.catalog_brain_outcomes;
CREATE POLICY "brain_outcomes_ws" ON public.catalog_brain_outcomes FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "brain_plans_ws" ON public.catalog_brain_plans;
CREATE POLICY "brain_plans_ws" ON public.catalog_brain_plans FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "brain_relations_ws" ON public.catalog_brain_relations;
CREATE POLICY "brain_relations_ws" ON public.catalog_brain_relations FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "catalog_clusters_ws" ON public.catalog_clusters;
CREATE POLICY "catalog_clusters_ws" ON public.catalog_clusters FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "workspace access catalog_workflow_runs" ON public.catalog_workflow_runs;
CREATE POLICY "workspace access catalog_workflow_runs" ON public.catalog_workflow_runs FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "workspace access catalog_workflows" ON public.catalog_workflows;
CREATE POLICY "workspace access catalog_workflows" ON public.catalog_workflows FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
