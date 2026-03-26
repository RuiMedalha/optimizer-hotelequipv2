
-- ORQ-12: Cost Intelligence & Usage Optimizer

-- Enums
CREATE TYPE public.budget_period_enum AS ENUM ('monthly','quarterly','yearly');
CREATE TYPE public.budget_type_enum AS ENUM ('ai','scraping','images','translation','publishing','global');
CREATE TYPE public.cost_category_enum AS ENUM ('ai_text','ai_vision','ocr','scraping','image_processing','translation','payload_build','publish_api','sync_api','storage','review_ops');
CREATE TYPE public.forecast_type_enum AS ENUM ('job_forecast','import_forecast','supplier_forecast','channel_forecast','workspace_forecast');
CREATE TYPE public.cost_scope_type_enum AS ENUM ('workspace','supplier','channel','job','product','pdf_batch','asset_batch');
CREATE TYPE public.cost_alert_type_enum AS ENUM ('budget_warning','budget_exceeded','cost_spike','inefficient_supplier','inefficient_channel','high_review_cost');
CREATE TYPE public.cost_alert_status_enum AS ENUM ('open','acknowledged','resolved');

-- workspace_budgets
CREATE TABLE public.workspace_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  budget_period public.budget_period_enum NOT NULL DEFAULT 'monthly',
  budget_type public.budget_type_enum NOT NULL DEFAULT 'global',
  budget_limit NUMERIC NOT NULL DEFAULT 100,
  warning_threshold_percent INTEGER NOT NULL DEFAULT 80,
  hard_limit_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workspace_budgets_ws ON public.workspace_budgets(workspace_id);
ALTER TABLE public.workspace_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_budgets_access" ON public.workspace_budgets FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- usage_cost_records
CREATE TABLE public.usage_cost_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.supplier_profiles(id) ON DELETE SET NULL,
  channel_id UUID,
  job_type TEXT NOT NULL DEFAULT 'unknown',
  job_id UUID,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  agent_id UUID,
  model_name TEXT,
  cost_category public.cost_category_enum NOT NULL DEFAULT 'ai_text',
  units_consumed NUMERIC NOT NULL DEFAULT 1,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  cost_metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_cost_records_ws ON public.usage_cost_records(workspace_id);
CREATE INDEX idx_usage_cost_records_cat ON public.usage_cost_records(cost_category);
CREATE INDEX idx_usage_cost_records_created ON public.usage_cost_records(created_at);
ALTER TABLE public.usage_cost_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usage_cost_access" ON public.usage_cost_records FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- cost_forecasts
CREATE TABLE public.cost_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  forecast_type public.forecast_type_enum NOT NULL DEFAULT 'job_forecast',
  scope_type public.cost_scope_type_enum NOT NULL DEFAULT 'workspace',
  scope_id UUID,
  estimated_cost NUMERIC NOT NULL DEFAULT 0,
  forecast_confidence NUMERIC DEFAULT 0.7,
  forecast_payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cost_forecasts_ws ON public.cost_forecasts(workspace_id);
ALTER TABLE public.cost_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cost_forecasts_access" ON public.cost_forecasts FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- cost_optimization_rules
CREATE TABLE public.cost_optimization_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  scope_type public.cost_scope_type_enum NOT NULL DEFAULT 'workspace',
  trigger_condition JSONB DEFAULT '{}',
  optimization_action JSONB DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cost_optimization_rules_ws ON public.cost_optimization_rules(workspace_id);
ALTER TABLE public.cost_optimization_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cost_opt_rules_access" ON public.cost_optimization_rules FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- workspace_usage_profiles
CREATE TABLE public.workspace_usage_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  profile_name TEXT NOT NULL DEFAULT 'default',
  default_execution_mode public.execution_mode_enum NOT NULL DEFAULT 'balanced',
  max_cost_per_product NUMERIC,
  max_cost_per_job NUMERIC,
  max_cost_per_pdf_page NUMERIC,
  max_cost_per_asset NUMERIC,
  review_before_expensive_run BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workspace_usage_profiles_ws ON public.workspace_usage_profiles(workspace_id);
ALTER TABLE public.workspace_usage_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_usage_profiles_access" ON public.workspace_usage_profiles FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- cost_alerts
CREATE TABLE public.cost_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  alert_type public.cost_alert_type_enum NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  message TEXT NOT NULL,
  current_value NUMERIC NOT NULL DEFAULT 0,
  threshold_value NUMERIC NOT NULL DEFAULT 0,
  status public.cost_alert_status_enum NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX idx_cost_alerts_ws ON public.cost_alerts(workspace_id);
CREATE INDEX idx_cost_alerts_status ON public.cost_alerts(status);
ALTER TABLE public.cost_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cost_alerts_access" ON public.cost_alerts FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- supplier_cost_profiles
CREATE TABLE public.supplier_cost_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
  average_cost_per_product NUMERIC DEFAULT 0,
  average_cost_per_import NUMERIC DEFAULT 0,
  average_cost_per_pdf_page NUMERIC DEFAULT 0,
  average_review_rate NUMERIC DEFAULT 0,
  cost_efficiency_score NUMERIC DEFAULT 5,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_supplier_cost_profiles_supplier ON public.supplier_cost_profiles(supplier_id);
ALTER TABLE public.supplier_cost_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_cost_read" ON public.supplier_cost_profiles FOR SELECT TO authenticated USING (true);

-- channel_cost_profiles
CREATE TABLE public.channel_cost_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL,
  average_cost_per_publish NUMERIC DEFAULT 0,
  average_cost_per_sync NUMERIC DEFAULT 0,
  average_payload_build_cost NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_channel_cost_profiles_channel ON public.channel_cost_profiles(channel_id);
ALTER TABLE public.channel_cost_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channel_cost_read" ON public.channel_cost_profiles FOR SELECT TO authenticated USING (true);

-- optimization_savings_logs
CREATE TABLE public.optimization_savings_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES public.cost_optimization_rules(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  estimated_saving NUMERIC NOT NULL DEFAULT 0,
  actual_saving NUMERIC,
  saving_scope TEXT,
  saving_scope_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_optimization_savings_ws ON public.optimization_savings_logs(workspace_id);
ALTER TABLE public.optimization_savings_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "savings_logs_access" ON public.optimization_savings_logs FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
