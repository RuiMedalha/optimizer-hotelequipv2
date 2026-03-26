
CREATE TYPE public.autonomous_action_type AS ENUM ('create_bundle','update_price','create_promotion','add_cross_sell','add_upsell','create_product_pack','expand_category','optimize_listing');
CREATE TYPE public.autonomous_execution_mode AS ENUM ('manual','semi_autonomous','fully_autonomous');
CREATE TYPE public.autonomous_action_status AS ENUM ('pending','approved','scheduled','executing','completed','failed','cancelled');

CREATE TABLE public.autonomous_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  action_type autonomous_action_type NOT NULL,
  execution_mode autonomous_execution_mode NOT NULL DEFAULT 'manual',
  target_product_id uuid,
  target_category_id uuid,
  target_channel_id uuid,
  action_payload jsonb,
  expected_revenue numeric DEFAULT 0,
  expected_conversion numeric DEFAULT 0,
  confidence numeric DEFAULT 0,
  status autonomous_action_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  scheduled_at timestamptz,
  executed_at timestamptz
);
ALTER TABLE public.autonomous_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage autonomous_actions in workspace" ON public.autonomous_actions FOR ALL TO authenticated USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND status = 'active'));
CREATE INDEX idx_autonomous_actions_workspace ON public.autonomous_actions(workspace_id);
CREATE INDEX idx_autonomous_actions_status ON public.autonomous_actions(status);

CREATE TABLE public.autonomous_execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  action_id uuid NOT NULL REFERENCES public.autonomous_actions(id) ON DELETE CASCADE,
  execution_result jsonb,
  duration_ms integer DEFAULT 0,
  error_payload jsonb,
  executed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.autonomous_execution_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage autonomous_execution_logs in workspace" ON public.autonomous_execution_logs FOR ALL TO authenticated USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND status = 'active'));

CREATE TABLE public.autonomous_guardrails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  guardrail_type text NOT NULL DEFAULT '',
  rule_payload jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.autonomous_guardrails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage autonomous_guardrails in workspace" ON public.autonomous_guardrails FOR ALL TO authenticated USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid() AND status = 'active'));
