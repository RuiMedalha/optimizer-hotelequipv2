-- ============================================================
-- Fix overly permissive RLS policies (USING(true)/WITH CHECK(true))
-- Replace with workspace-scoped policies using has_workspace_access_hybrid
-- ============================================================

-- 1. Tables with direct workspace_id column

-- brain_decision_policies
DROP POLICY IF EXISTS "Users can manage decision policies" ON public.brain_decision_policies;
CREATE POLICY "workspace_select" ON public.brain_decision_policies FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.brain_decision_policies FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.brain_decision_policies FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.brain_decision_policies FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- brain_policy_adjustments
DROP POLICY IF EXISTS "Users can manage policy adjustments" ON public.brain_policy_adjustments;
CREATE POLICY "workspace_select" ON public.brain_policy_adjustments FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.brain_policy_adjustments FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.brain_policy_adjustments FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.brain_policy_adjustments FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- catalog_action_simulations
DROP POLICY IF EXISTS "Users can manage action simulations" ON public.catalog_action_simulations;
CREATE POLICY "workspace_select" ON public.catalog_action_simulations FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.catalog_action_simulations FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.catalog_action_simulations FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.catalog_action_simulations FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- catalog_decision_signals
DROP POLICY IF EXISTS "Users can manage decision signals" ON public.catalog_decision_signals;
CREATE POLICY "workspace_select" ON public.catalog_decision_signals FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.catalog_decision_signals FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.catalog_decision_signals FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.catalog_decision_signals FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- catalog_decisions
DROP POLICY IF EXISTS "Users can manage decisions" ON public.catalog_decisions;
CREATE POLICY "workspace_select" ON public.catalog_decisions FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.catalog_decisions FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.catalog_decisions FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.catalog_decisions FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- catalog_economic_models
DROP POLICY IF EXISTS "Users can manage economic models" ON public.catalog_economic_models;
CREATE POLICY "workspace_select" ON public.catalog_economic_models FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.catalog_economic_models FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.catalog_economic_models FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.catalog_economic_models FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- catalog_expected_value_models
DROP POLICY IF EXISTS "Users can manage EV models" ON public.catalog_expected_value_models;
CREATE POLICY "workspace_select" ON public.catalog_expected_value_models FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.catalog_expected_value_models FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.catalog_expected_value_models FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.catalog_expected_value_models FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- catalog_impact_evaluations
DROP POLICY IF EXISTS "Users can manage impact evaluations" ON public.catalog_impact_evaluations;
CREATE POLICY "workspace_select" ON public.catalog_impact_evaluations FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.catalog_impact_evaluations FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.catalog_impact_evaluations FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.catalog_impact_evaluations FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- catalog_learning_models
DROP POLICY IF EXISTS "Users can manage learning models" ON public.catalog_learning_models;
CREATE POLICY "workspace_select" ON public.catalog_learning_models FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.catalog_learning_models FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.catalog_learning_models FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.catalog_learning_models FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- catalog_learning_signals
DROP POLICY IF EXISTS "Users can manage learning signals" ON public.catalog_learning_signals;
CREATE POLICY "workspace_select" ON public.catalog_learning_signals FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.catalog_learning_signals FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.catalog_learning_signals FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.catalog_learning_signals FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- catalog_outcome_tracking
DROP POLICY IF EXISTS "Users can manage outcome tracking" ON public.catalog_outcome_tracking;
CREATE POLICY "workspace_select" ON public.catalog_outcome_tracking FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.catalog_outcome_tracking FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.catalog_outcome_tracking FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.catalog_outcome_tracking FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- catalog_reinforcement_memory
DROP POLICY IF EXISTS "Users can manage reinforcement memory" ON public.catalog_reinforcement_memory;
CREATE POLICY "workspace_select" ON public.catalog_reinforcement_memory FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.catalog_reinforcement_memory FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.catalog_reinforcement_memory FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.catalog_reinforcement_memory FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- catalog_simulation_runs
DROP POLICY IF EXISTS "Users can manage simulation runs" ON public.catalog_simulation_runs;
CREATE POLICY "workspace_select" ON public.catalog_simulation_runs FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.catalog_simulation_runs FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.catalog_simulation_runs FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.catalog_simulation_runs FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- catalog_simulation_scenarios
DROP POLICY IF EXISTS "Users can manage simulation scenarios" ON public.catalog_simulation_scenarios;
CREATE POLICY "workspace_select" ON public.catalog_simulation_scenarios FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.catalog_simulation_scenarios FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.catalog_simulation_scenarios FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.catalog_simulation_scenarios FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- decision_performance_history
DROP POLICY IF EXISTS "Users can manage perf history" ON public.decision_performance_history;
CREATE POLICY "workspace_select" ON public.decision_performance_history FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.decision_performance_history FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.decision_performance_history FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.decision_performance_history FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- impact_models
DROP POLICY IF EXISTS "Users can manage impact models" ON public.impact_models;
CREATE POLICY "workspace_select" ON public.impact_models FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.impact_models FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.impact_models FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.impact_models FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'editor'::workspace_role));

-- 2. Tables that need join-based workspace scoping

-- Helper function for decision_explanations
CREATE OR REPLACE FUNCTION public.get_decision_workspace_id(_decision_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id FROM public.catalog_decisions WHERE id = _decision_id LIMIT 1;
$$;

-- decision_explanations
DROP POLICY IF EXISTS "Users can manage decision explanations" ON public.decision_explanations;
CREATE POLICY "workspace_select" ON public.decision_explanations FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(public.get_decision_workspace_id(decision_id), 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.decision_explanations FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(public.get_decision_workspace_id(decision_id), 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.decision_explanations FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(public.get_decision_workspace_id(decision_id), 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(public.get_decision_workspace_id(decision_id), 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.decision_explanations FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(public.get_decision_workspace_id(decision_id), 'editor'::workspace_role));

-- Helper function for catalog_simulation_results
CREATE OR REPLACE FUNCTION public.get_simulation_run_workspace_id(_run_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id FROM public.catalog_simulation_runs WHERE id = _run_id LIMIT 1;
$$;

-- catalog_simulation_results
DROP POLICY IF EXISTS "Users can manage simulation results" ON public.catalog_simulation_results;
CREATE POLICY "workspace_select" ON public.catalog_simulation_results FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(public.get_simulation_run_workspace_id(simulation_run_id), 'viewer'::workspace_role));
CREATE POLICY "workspace_insert" ON public.catalog_simulation_results FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_access_hybrid(public.get_simulation_run_workspace_id(simulation_run_id), 'editor'::workspace_role));
CREATE POLICY "workspace_update" ON public.catalog_simulation_results FOR UPDATE TO authenticated
  USING (public.has_workspace_access_hybrid(public.get_simulation_run_workspace_id(simulation_run_id), 'editor'::workspace_role))
  WITH CHECK (public.has_workspace_access_hybrid(public.get_simulation_run_workspace_id(simulation_run_id), 'editor'::workspace_role));
CREATE POLICY "workspace_delete" ON public.catalog_simulation_results FOR DELETE TO authenticated
  USING (public.has_workspace_access_hybrid(public.get_simulation_run_workspace_id(simulation_run_id), 'editor'::workspace_role));

-- 3. channel_cost_profiles
CREATE OR REPLACE FUNCTION public.get_channel_workspace_id(_channel_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id FROM public.channels WHERE id = _channel_id LIMIT 1;
$$;

DROP POLICY IF EXISTS "channel_cost_read" ON public.channel_cost_profiles;
CREATE POLICY "workspace_select" ON public.channel_cost_profiles FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(public.get_channel_workspace_id(channel_id), 'viewer'::workspace_role));

-- 4. supplier_cost_profiles
CREATE OR REPLACE FUNCTION public.get_supplier_workspace_id(_supplier_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id FROM public.supplier_profiles WHERE id = _supplier_id LIMIT 1;
$$;

DROP POLICY IF EXISTS "supplier_cost_read" ON public.supplier_cost_profiles;
CREATE POLICY "workspace_select" ON public.supplier_cost_profiles FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(public.get_supplier_workspace_id(supplier_id), 'viewer'::workspace_role));

-- 5. pdf_layout_signatures
DROP POLICY IF EXISTS "Anyone authenticated can insert layout signatures" ON public.pdf_layout_signatures;
DROP POLICY IF EXISTS "Anyone authenticated can view layout signatures" ON public.pdf_layout_signatures;
CREATE POLICY "active_member_select" ON public.pdf_layout_signatures FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id = auth.uid() AND status = 'active'));
CREATE POLICY "active_member_insert" ON public.pdf_layout_signatures FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id = auth.uid() AND status = 'active'));