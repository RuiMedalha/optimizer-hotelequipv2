
-- ENUMS
CREATE TYPE public.strategy_plan_type AS ENUM ('quarterly_plan','category_strategy','launch_plan','promotion_strategy','channel_strategy');
CREATE TYPE public.strategy_action_type AS ENUM ('launch_product','expand_category','create_bundle','run_promotion','optimize_price','improve_content','add_cross_sell','add_upsell');
CREATE TYPE public.strategy_status AS ENUM ('draft','simulated','approved','scheduled','executing','completed','cancelled');

-- strategy_plans
CREATE TABLE public.strategy_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_type strategy_plan_type NOT NULL DEFAULT 'quarterly_plan',
  title text NOT NULL DEFAULT '',
  description text,
  planning_horizon_months integer DEFAULT 3,
  created_by uuid,
  status strategy_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.strategy_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage strategy_plans in their workspace" ON public.strategy_plans FOR ALL TO authenticated USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND status = 'active'));

-- strategy_actions
CREATE TABLE public.strategy_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.strategy_plans(id) ON DELETE CASCADE,
  action_type strategy_action_type NOT NULL,
  target_product_id uuid,
  target_category_id uuid,
  target_channel_id uuid,
  action_payload jsonb,
  expected_revenue numeric DEFAULT 0,
  expected_conversion numeric DEFAULT 0,
  expected_margin numeric DEFAULT 0,
  priority_score numeric DEFAULT 0,
  status strategy_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.strategy_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage strategy_actions in their workspace" ON public.strategy_actions FOR ALL TO authenticated USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND status = 'active'));

-- strategy_simulations
CREATE TABLE public.strategy_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.strategy_plans(id) ON DELETE CASCADE,
  simulation_payload jsonb,
  predicted_revenue numeric DEFAULT 0,
  predicted_margin numeric DEFAULT 0,
  predicted_conversion numeric DEFAULT 0,
  confidence numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.strategy_simulations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage strategy_simulations in their workspace" ON public.strategy_simulations FOR ALL TO authenticated USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND status = 'active'));

-- strategy_recommendations
CREATE TABLE public.strategy_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  recommendation_type text NOT NULL DEFAULT '',
  target_product_id uuid,
  target_category_id uuid,
  recommendation_payload jsonb,
  expected_impact numeric DEFAULT 0,
  confidence numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.strategy_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage strategy_recommendations in their workspace" ON public.strategy_recommendations FOR ALL TO authenticated USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND status = 'active'));

-- Indexes
CREATE INDEX idx_strategy_plans_workspace ON public.strategy_plans(workspace_id);
CREATE INDEX idx_strategy_actions_plan ON public.strategy_actions(plan_id);
CREATE INDEX idx_strategy_actions_workspace ON public.strategy_actions(workspace_id);
CREATE INDEX idx_strategy_simulations_plan ON public.strategy_simulations(plan_id);
CREATE INDEX idx_strategy_recommendations_workspace ON public.strategy_recommendations(workspace_id);
