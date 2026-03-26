
-- BLOCO 9: Autonomous Catalog Agent

-- Enums
CREATE TYPE public.agent_type_enum AS ENUM (
  'seo_optimizer','catalog_gap_detector','bundle_generator','attribute_completeness_agent',
  'feed_optimizer','translation_agent','image_optimizer','supplier_learning_agent',
  'pricing_analyzer','channel_performance_agent'
);

CREATE TYPE public.agent_status_enum AS ENUM ('active','paused','disabled');

CREATE TYPE public.agent_task_status_enum AS ENUM ('queued','running','completed','failed','cancelled');

CREATE TYPE public.agent_action_type_enum AS ENUM (
  'update_title','update_description','update_attributes','create_bundle',
  'add_upsell','add_cross_sell','update_seo_fields','publish_to_channel',
  'generate_translation','optimize_images','suggest_price_change'
);

CREATE TYPE public.agent_schedule_enum AS ENUM ('manual','hourly','daily','weekly');

-- 1. catalog_agents
CREATE TABLE public.catalog_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_name text NOT NULL,
  agent_type agent_type_enum NOT NULL,
  status agent_status_enum NOT NULL DEFAULT 'active',
  configuration jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catalog_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own workspace agents" ON public.catalog_agents FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 2. agent_tasks
CREATE TABLE public.agent_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.catalog_agents(id) ON DELETE CASCADE,
  task_type text,
  payload jsonb DEFAULT '{}',
  priority integer NOT NULL DEFAULT 100,
  status agent_task_status_enum NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  error_message text
);
ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own workspace agent tasks" ON public.agent_tasks FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 3. agent_actions
CREATE TABLE public.agent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.catalog_agents(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  action_type agent_action_type_enum NOT NULL,
  action_payload jsonb DEFAULT '{}',
  action_result jsonb,
  confidence integer DEFAULT 0,
  approved_by_user boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own workspace agent actions" ON public.agent_actions FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 4. agent_decision_memory
CREATE TABLE public.agent_decision_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_type agent_type_enum NOT NULL,
  decision_context jsonb DEFAULT '{}',
  decision_action jsonb DEFAULT '{}',
  confidence integer DEFAULT 0,
  approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_decision_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own workspace agent memory" ON public.agent_decision_memory FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 5. agent_policies
CREATE TABLE public.agent_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_type agent_type_enum NOT NULL,
  policy_name text NOT NULL,
  conditions jsonb DEFAULT '{}',
  actions jsonb DEFAULT '{}',
  requires_approval boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own workspace agent policies" ON public.agent_policies FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 6. agent_schedules
CREATE TABLE public.agent_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.catalog_agents(id) ON DELETE CASCADE,
  schedule_type agent_schedule_enum NOT NULL DEFAULT 'manual',
  schedule_config jsonb DEFAULT '{}',
  last_run timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own workspace agent schedules" ON public.agent_schedules FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
