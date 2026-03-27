
-- ═══ BATCH 2: Fix RLS policies - categories, channels, conflicts, control tower, costs ═══

DROP POLICY IF EXISTS "Users can create their own categories" ON public.categories;
CREATE POLICY "Users can create their own categories" ON public.categories FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete their own categories" ON public.categories;
CREATE POLICY "Users can delete their own categories" ON public.categories FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update their own categories" ON public.categories;
CREATE POLICY "Users can update their own categories" ON public.categories FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own categories" ON public.categories;
CREATE POLICY "Users can view their own categories" ON public.categories FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "workspace_access_channel_attribute_mappings" ON public.channel_attribute_mappings;
CREATE POLICY "workspace_access_channel_attribute_mappings" ON public.channel_attribute_mappings FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "workspace_access_channel_category_mappings" ON public.channel_category_mappings;
CREATE POLICY "workspace_access_channel_category_mappings" ON public.channel_category_mappings FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "workspace_access_channel_field_mappings" ON public.channel_field_mappings;
CREATE POLICY "workspace_access_channel_field_mappings" ON public.channel_field_mappings FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "Users can manage channel_payloads in workspace" ON public.channel_payloads;
CREATE POLICY "Users can manage channel_payloads in workspace" ON public.channel_payloads FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "workspace_access_channel_product_data" ON public.channel_product_data;
CREATE POLICY "workspace_access_channel_product_data" ON public.channel_product_data FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "workspace_access_channel_publish_jobs" ON public.channel_publish_jobs;
CREATE POLICY "workspace_access_channel_publish_jobs" ON public.channel_publish_jobs FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "Users can manage channel_sync_snapshots in workspace" ON public.channel_sync_snapshots;
CREATE POLICY "Users can manage channel_sync_snapshots in workspace" ON public.channel_sync_snapshots FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "workspace_access_channels" ON public.channels;
CREATE POLICY "workspace_access_channels" ON public.channels FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "Users can manage conflict_cases in their workspace" ON public.conflict_cases;
CREATE POLICY "Users can manage conflict_cases in their workspace" ON public.conflict_cases FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "Users can manage conflict_resolution_rules in workspace" ON public.conflict_resolution_rules;
CREATE POLICY "Users can manage conflict_resolution_rules in workspace" ON public.conflict_resolution_rules FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "ct_alerts_workspace" ON public.control_tower_alerts;
CREATE POLICY "ct_alerts_workspace" ON public.control_tower_alerts FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "ct_snapshots_workspace" ON public.control_tower_snapshots;
CREATE POLICY "ct_snapshots_workspace" ON public.control_tower_snapshots FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "ct_views_workspace" ON public.control_tower_views;
CREATE POLICY "ct_views_workspace" ON public.control_tower_views FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "ct_widgets_workspace" ON public.control_tower_widgets;
CREATE POLICY "ct_widgets_workspace" ON public.control_tower_widgets FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "cost_alerts_access" ON public.cost_alerts;
CREATE POLICY "cost_alerts_access" ON public.cost_alerts FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "cost_forecasts_access" ON public.cost_forecasts;
CREATE POLICY "cost_forecasts_access" ON public.cost_forecasts FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "cost_opt_rules_access" ON public.cost_optimization_rules;
CREATE POLICY "cost_opt_rules_access" ON public.cost_optimization_rules FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "Users can manage execution_fallback_rules in their workspace" ON public.execution_fallback_rules;
CREATE POLICY "Users can manage execution_fallback_rules in their workspace" ON public.execution_fallback_rules FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "Users can manage execution_plans in their workspace" ON public.execution_plans;
CREATE POLICY "Users can manage execution_plans in their workspace" ON public.execution_plans FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

DROP POLICY IF EXISTS "Users can manage human_review_tasks in workspace" ON public.human_review_tasks;
CREATE POLICY "Users can manage human_review_tasks in workspace" ON public.human_review_tasks FOR ALL TO authenticated USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
