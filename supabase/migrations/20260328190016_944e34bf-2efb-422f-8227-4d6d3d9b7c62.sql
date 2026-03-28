
-- ================================================================
-- Migration: Harden RLS policies (public → authenticated) + fix invitation SELECT
-- ================================================================

-- ──────── 1. Fix workspace_invitations SELECT policy ────────
-- Allow admins (not just owners) to read invitations they can manage
DROP POLICY IF EXISTS "Owners can view workspace invitations" ON public.workspace_invitations;
CREATE POLICY "Workspace managers can view invitations"
  ON public.workspace_invitations FOR SELECT TO authenticated
  USING (
    can_manage_workspace(workspace_id)
    OR EXISTS (
      SELECT 1 FROM workspaces WHERE workspaces.id = workspace_invitations.workspace_id AND workspaces.user_id = auth.uid()
    )
  );

-- ──────── 2. Migrate ALL-command policies from public → authenticated ────────

-- agent_run_feedback
DROP POLICY IF EXISTS "ar_feedback_ws" ON public.agent_run_feedback;
CREATE POLICY "ar_feedback_ws" ON public.agent_run_feedback FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM agent_runs ar WHERE ar.id = agent_run_feedback.agent_run_id AND has_workspace_access_hybrid(ar.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM agent_runs ar WHERE ar.id = agent_run_feedback.agent_run_id AND has_workspace_access_hybrid(ar.workspace_id, 'viewer'::workspace_role)));

-- agent_run_steps
DROP POLICY IF EXISTS "ar_steps_ws" ON public.agent_run_steps;
CREATE POLICY "ar_steps_ws" ON public.agent_run_steps FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM agent_runs ar WHERE ar.id = agent_run_steps.agent_run_id AND has_workspace_access_hybrid(ar.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM agent_runs ar WHERE ar.id = agent_run_steps.agent_run_id AND has_workspace_access_hybrid(ar.workspace_id, 'viewer'::workspace_role)));

-- catalog_brain_plan_steps
DROP POLICY IF EXISTS "brain_steps_ws" ON public.catalog_brain_plan_steps;
CREATE POLICY "brain_steps_ws" ON public.catalog_brain_plan_steps FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM catalog_brain_plans p WHERE p.id = catalog_brain_plan_steps.plan_id AND has_workspace_access_hybrid(p.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog_brain_plans p WHERE p.id = catalog_brain_plan_steps.plan_id AND has_workspace_access_hybrid(p.workspace_id, 'viewer'::workspace_role)));

-- catalog_workflow_steps
DROP POLICY IF EXISTS "workspace access catalog_workflow_steps" ON public.catalog_workflow_steps;
CREATE POLICY "workspace access catalog_workflow_steps" ON public.catalog_workflow_steps FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM catalog_workflow_runs r WHERE r.id = catalog_workflow_steps.workflow_run_id AND has_workspace_access_hybrid(r.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog_workflow_runs r WHERE r.id = catalog_workflow_steps.workflow_run_id AND has_workspace_access_hybrid(r.workspace_id, 'viewer'::workspace_role)));

-- channel_payload_assets
DROP POLICY IF EXISTS "Users can manage channel_payload_assets via payload" ON public.channel_payload_assets;
CREATE POLICY "Users can manage channel_payload_assets via payload" ON public.channel_payload_assets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM channel_payloads cp WHERE cp.id = channel_payload_assets.channel_payload_id AND has_workspace_access_hybrid(cp.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM channel_payloads cp WHERE cp.id = channel_payload_assets.channel_payload_id AND has_workspace_access_hybrid(cp.workspace_id, 'viewer'::workspace_role)));

-- channel_payload_fields
DROP POLICY IF EXISTS "Users can manage channel_payload_fields via payload" ON public.channel_payload_fields;
CREATE POLICY "Users can manage channel_payload_fields via payload" ON public.channel_payload_fields FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM channel_payloads cp WHERE cp.id = channel_payload_fields.channel_payload_id AND has_workspace_access_hybrid(cp.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM channel_payloads cp WHERE cp.id = channel_payload_fields.channel_payload_id AND has_workspace_access_hybrid(cp.workspace_id, 'viewer'::workspace_role)));

-- channel_payload_logs
DROP POLICY IF EXISTS "Users can manage channel_payload_logs via payload" ON public.channel_payload_logs;
CREATE POLICY "Users can manage channel_payload_logs via payload" ON public.channel_payload_logs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM channel_payloads cp WHERE cp.id = channel_payload_logs.channel_payload_id AND has_workspace_access_hybrid(cp.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM channel_payloads cp WHERE cp.id = channel_payload_logs.channel_payload_id AND has_workspace_access_hybrid(cp.workspace_id, 'viewer'::workspace_role)));

-- channel_publish_job_items
DROP POLICY IF EXISTS "workspace_access_channel_publish_job_items" ON public.channel_publish_job_items;
CREATE POLICY "workspace_access_channel_publish_job_items" ON public.channel_publish_job_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM channel_publish_jobs j WHERE j.id = channel_publish_job_items.job_id AND has_workspace_access_hybrid(j.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM channel_publish_jobs j WHERE j.id = channel_publish_job_items.job_id AND has_workspace_access_hybrid(j.workspace_id, 'viewer'::workspace_role)));

-- conflict_case_items
DROP POLICY IF EXISTS "Users can manage conflict_case_items via case" ON public.conflict_case_items;
CREATE POLICY "Users can manage conflict_case_items via case" ON public.conflict_case_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM conflict_cases cc WHERE cc.id = conflict_case_items.conflict_case_id AND has_workspace_access_hybrid(cc.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM conflict_cases cc WHERE cc.id = conflict_case_items.conflict_case_id AND has_workspace_access_hybrid(cc.workspace_id, 'viewer'::workspace_role)));

-- execution_outcomes
DROP POLICY IF EXISTS "Users can manage execution_outcomes via plan" ON public.execution_outcomes;
CREATE POLICY "Users can manage execution_outcomes via plan" ON public.execution_outcomes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM execution_plans ep WHERE ep.id = execution_outcomes.plan_id AND has_workspace_access_hybrid(ep.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM execution_plans ep WHERE ep.id = execution_outcomes.plan_id AND has_workspace_access_hybrid(ep.workspace_id, 'viewer'::workspace_role)));

-- execution_plan_steps
DROP POLICY IF EXISTS "Users can manage execution_plan_steps via plan" ON public.execution_plan_steps;
CREATE POLICY "Users can manage execution_plan_steps via plan" ON public.execution_plan_steps FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM execution_plans ep WHERE ep.id = execution_plan_steps.plan_id AND has_workspace_access_hybrid(ep.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM execution_plans ep WHERE ep.id = execution_plan_steps.plan_id AND has_workspace_access_hybrid(ep.workspace_id, 'viewer'::workspace_role)));

-- images (4 separate policies)
DROP POLICY IF EXISTS "Users can create images for their products" ON public.images;
CREATE POLICY "Users can create images for their products" ON public.images FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM products WHERE products.id = images.product_id AND products.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete images of their products" ON public.images;
CREATE POLICY "Users can delete images of their products" ON public.images FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM products WHERE products.id = images.product_id AND products.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update images of their products" ON public.images;
CREATE POLICY "Users can update images of their products" ON public.images FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM products WHERE products.id = images.product_id AND products.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view images of their products" ON public.images;
CREATE POLICY "Users can view images of their products" ON public.images FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM products WHERE products.id = images.product_id AND products.user_id = auth.uid()));

-- locale_style_guides
DROP POLICY IF EXISTS "Users can manage own workspace style guides" ON public.locale_style_guides;
CREATE POLICY "Users can manage own workspace style guides" ON public.locale_style_guides FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

-- optimization_savings_logs
DROP POLICY IF EXISTS "savings_logs_access" ON public.optimization_savings_logs;
CREATE POLICY "savings_logs_access" ON public.optimization_savings_logs FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

-- product_dna_profiles
DROP POLICY IF EXISTS "product_dna_ws" ON public.product_dna_profiles;
CREATE POLICY "product_dna_ws" ON public.product_dna_profiles FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

-- product_localizations
DROP POLICY IF EXISTS "Users can manage own workspace localizations" ON public.product_localizations;
CREATE POLICY "Users can manage own workspace localizations" ON public.product_localizations FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

-- products (4 separate policies)
DROP POLICY IF EXISTS "Users can create their own products" ON public.products;
CREATE POLICY "Users can create their own products" ON public.products FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own products" ON public.products;
CREATE POLICY "Users can delete their own products" ON public.products FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own products" ON public.products;
CREATE POLICY "Users can update their own products" ON public.products FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own products" ON public.products;
CREATE POLICY "Users can view their own products" ON public.products FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- publish_approval_rules
DROP POLICY IF EXISTS "Users can manage publish_approval_rules in workspace" ON public.publish_approval_rules;
CREATE POLICY "Users can manage publish_approval_rules in workspace" ON public.publish_approval_rules FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

-- resolution_history
DROP POLICY IF EXISTS "Users can manage resolution_history via case" ON public.resolution_history;
CREATE POLICY "Users can manage resolution_history via case" ON public.resolution_history FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM conflict_cases cc WHERE cc.id = resolution_history.conflict_case_id AND has_workspace_access_hybrid(cc.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM conflict_cases cc WHERE cc.id = resolution_history.conflict_case_id AND has_workspace_access_hybrid(cc.workspace_id, 'viewer'::workspace_role)));

-- review_assignments
DROP POLICY IF EXISTS "Users can manage review_assignments via task" ON public.review_assignments;
CREATE POLICY "Users can manage review_assignments via task" ON public.review_assignments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM human_review_tasks t WHERE t.id = review_assignments.review_task_id AND has_workspace_access_hybrid(t.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM human_review_tasks t WHERE t.id = review_assignments.review_task_id AND has_workspace_access_hybrid(t.workspace_id, 'viewer'::workspace_role)));

-- review_decisions
DROP POLICY IF EXISTS "Users can manage review_decisions via task" ON public.review_decisions;
CREATE POLICY "Users can manage review_decisions via task" ON public.review_decisions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM human_review_tasks t WHERE t.id = review_decisions.review_task_id AND has_workspace_access_hybrid(t.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM human_review_tasks t WHERE t.id = review_decisions.review_task_id AND has_workspace_access_hybrid(t.workspace_id, 'viewer'::workspace_role)));

-- settings (4 separate policies)
DROP POLICY IF EXISTS "Users can create their own settings" ON public.settings;
CREATE POLICY "Users can create their own settings" ON public.settings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own settings" ON public.settings;
CREATE POLICY "Users can delete their own settings" ON public.settings FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own settings" ON public.settings;
CREATE POLICY "Users can update their own settings" ON public.settings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own settings" ON public.settings;
CREATE POLICY "Users can view their own settings" ON public.settings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- supplier_connector_setups
DROP POLICY IF EXISTS "sp_connsetups_ws" ON public.supplier_connector_setups;
CREATE POLICY "sp_connsetups_ws" ON public.supplier_connector_setups FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

-- supplier_data_quality_scores
DROP POLICY IF EXISTS "Users can manage supplier_data_quality_scores" ON public.supplier_data_quality_scores;
CREATE POLICY "Users can manage supplier_data_quality_scores" ON public.supplier_data_quality_scores FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = supplier_data_quality_scores.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active'::workspace_member_status))
  WITH CHECK (EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = supplier_data_quality_scores.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active'::workspace_member_status));

-- supplier_knowledge_graph
DROP POLICY IF EXISTS "Users can manage supplier_knowledge_graph" ON public.supplier_knowledge_graph;
CREATE POLICY "Users can manage supplier_knowledge_graph" ON public.supplier_knowledge_graph FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = supplier_knowledge_graph.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active'::workspace_member_status))
  WITH CHECK (EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = supplier_knowledge_graph.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active'::workspace_member_status));

-- supplier_lookup_strategies
DROP POLICY IF EXISTS "sp_lookup_ws" ON public.supplier_lookup_strategies;
CREATE POLICY "sp_lookup_ws" ON public.supplier_lookup_strategies FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM supplier_profiles sp WHERE sp.id = supplier_lookup_strategies.supplier_id AND has_workspace_access_hybrid(sp.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM supplier_profiles sp WHERE sp.id = supplier_lookup_strategies.supplier_id AND has_workspace_access_hybrid(sp.workspace_id, 'viewer'::workspace_role)));

-- supplier_mapping_suggestions
DROP POLICY IF EXISTS "Users can manage supplier_mapping_suggestions" ON public.supplier_mapping_suggestions;
CREATE POLICY "Users can manage supplier_mapping_suggestions" ON public.supplier_mapping_suggestions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM supplier_profiles sp JOIN workspace_members wm ON wm.workspace_id = sp.workspace_id WHERE sp.id = supplier_mapping_suggestions.supplier_id AND wm.user_id = auth.uid() AND wm.status = 'active'::workspace_member_status))
  WITH CHECK (EXISTS (SELECT 1 FROM supplier_profiles sp JOIN workspace_members wm ON wm.workspace_id = sp.workspace_id WHERE sp.id = supplier_mapping_suggestions.supplier_id AND wm.user_id = auth.uid() AND wm.status = 'active'::workspace_member_status));

-- supplier_patterns
DROP POLICY IF EXISTS "Users can manage supplier_patterns" ON public.supplier_patterns;
CREATE POLICY "Users can manage supplier_patterns" ON public.supplier_patterns FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM supplier_profiles sp JOIN workspace_members wm ON wm.workspace_id = sp.workspace_id WHERE sp.id = supplier_patterns.supplier_id AND wm.user_id = auth.uid() AND wm.status = 'active'::workspace_member_status))
  WITH CHECK (EXISTS (SELECT 1 FROM supplier_profiles sp JOIN workspace_members wm ON wm.workspace_id = sp.workspace_id WHERE sp.id = supplier_patterns.supplier_id AND wm.user_id = auth.uid() AND wm.status = 'active'::workspace_member_status));

-- supplier_playbooks
DROP POLICY IF EXISTS "sp_playbooks_ws" ON public.supplier_playbooks;
CREATE POLICY "sp_playbooks_ws" ON public.supplier_playbooks FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

-- supplier_schema_profiles
DROP POLICY IF EXISTS "Users can manage supplier_schema_profiles" ON public.supplier_schema_profiles;
CREATE POLICY "Users can manage supplier_schema_profiles" ON public.supplier_schema_profiles FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM supplier_profiles sp JOIN workspace_members wm ON wm.workspace_id = sp.workspace_id WHERE sp.id = supplier_schema_profiles.supplier_id AND wm.user_id = auth.uid() AND wm.status = 'active'::workspace_member_status))
  WITH CHECK (EXISTS (SELECT 1 FROM supplier_profiles sp JOIN workspace_members wm ON wm.workspace_id = sp.workspace_id WHERE sp.id = supplier_schema_profiles.supplier_id AND wm.user_id = auth.uid() AND wm.status = 'active'::workspace_member_status));

-- supplier_setup_checklists
DROP POLICY IF EXISTS "sp_checklists_ws" ON public.supplier_setup_checklists;
CREATE POLICY "sp_checklists_ws" ON public.supplier_setup_checklists FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM supplier_profiles sp WHERE sp.id = supplier_setup_checklists.supplier_id AND has_workspace_access_hybrid(sp.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM supplier_profiles sp WHERE sp.id = supplier_setup_checklists.supplier_id AND has_workspace_access_hybrid(sp.workspace_id, 'viewer'::workspace_role)));

-- supplier_test_runs
DROP POLICY IF EXISTS "sp_testruns_ws" ON public.supplier_test_runs;
CREATE POLICY "sp_testruns_ws" ON public.supplier_test_runs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM supplier_profiles sp WHERE sp.id = supplier_test_runs.supplier_id AND has_workspace_access_hybrid(sp.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM supplier_profiles sp WHERE sp.id = supplier_test_runs.supplier_id AND has_workspace_access_hybrid(sp.workspace_id, 'viewer'::workspace_role)));

-- terminology_dictionaries
DROP POLICY IF EXISTS "Users can manage own workspace terminology" ON public.terminology_dictionaries;
CREATE POLICY "Users can manage own workspace terminology" ON public.terminology_dictionaries FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

-- translation_job_items
DROP POLICY IF EXISTS "Users can manage translation job items" ON public.translation_job_items;
CREATE POLICY "Users can manage translation job items" ON public.translation_job_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM translation_jobs tj WHERE tj.id = translation_job_items.job_id AND has_workspace_access_hybrid(tj.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM translation_jobs tj WHERE tj.id = translation_job_items.job_id AND has_workspace_access_hybrid(tj.workspace_id, 'viewer'::workspace_role)));

-- translation_jobs
DROP POLICY IF EXISTS "Users can manage own workspace translation jobs" ON public.translation_jobs;
CREATE POLICY "Users can manage own workspace translation jobs" ON public.translation_jobs FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

-- translation_memories
DROP POLICY IF EXISTS "Users can manage own workspace translation memories" ON public.translation_memories;
CREATE POLICY "Users can manage own workspace translation memories" ON public.translation_memories FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

-- usage_cost_records
DROP POLICY IF EXISTS "usage_cost_access" ON public.usage_cost_records;
CREATE POLICY "usage_cost_access" ON public.usage_cost_records FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

-- workflow_handoffs
DROP POLICY IF EXISTS "workspace access workflow_handoffs" ON public.workflow_handoffs;
CREATE POLICY "workspace access workflow_handoffs" ON public.workflow_handoffs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM catalog_workflow_runs r WHERE r.id = workflow_handoffs.workflow_run_id AND has_workspace_access_hybrid(r.workspace_id, 'viewer'::workspace_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM catalog_workflow_runs r WHERE r.id = workflow_handoffs.workflow_run_id AND has_workspace_access_hybrid(r.workspace_id, 'viewer'::workspace_role)));

-- workspace_budgets
DROP POLICY IF EXISTS "ws_budgets_access" ON public.workspace_budgets;
CREATE POLICY "ws_budgets_access" ON public.workspace_budgets FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));

-- workspace_usage_profiles
DROP POLICY IF EXISTS "ws_usage_profiles_access" ON public.workspace_usage_profiles;
CREATE POLICY "ws_usage_profiles_access" ON public.workspace_usage_profiles FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
