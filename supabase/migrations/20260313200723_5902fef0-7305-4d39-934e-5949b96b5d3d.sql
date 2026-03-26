
-- =============================================
-- BLOCO 1: Enterprise Foundation Migration
-- =============================================

-- 1. New enum for workflow states
CREATE TYPE public.product_workflow AS ENUM (
  'draft', 'enriching', 'review', 'approved', 'publishing', 'published', 'archived', 'rejected'
);

-- 2. New enum for audit actions
CREATE TYPE public.audit_action AS ENUM (
  'create', 'update', 'delete', 'publish', 'approve', 'reject', 'restore', 'optimize', 'enrich', 'import'
);

-- 3. New enum for audit entity types
CREATE TYPE public.audit_entity_type AS ENUM (
  'product', 'category', 'channel', 'settings', 'member', 'workspace', 'asset', 'job'
);

-- 4. New enum for job item status
CREATE TYPE public.job_item_status AS ENUM (
  'queued', 'processing', 'done', 'error', 'skipped'
);

-- 5. Add workflow columns to products (ADDITIVE - no breaking changes)
ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS workflow_state public.product_workflow DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS workflow_changed_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS workflow_changed_by uuid;

-- 6. Add change tracking to product_versions
ALTER TABLE public.product_versions
  ADD COLUMN IF NOT EXISTS change_source text DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS change_reason text;

-- =============================================
-- 7. workspace_ai_settings
-- =============================================
CREATE TABLE public.workspace_ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  default_model text DEFAULT 'google/gemini-2.5-flash',
  temperature numeric DEFAULT 0.7,
  max_tokens integer DEFAULT 4096,
  language text DEFAULT 'pt',
  tone text DEFAULT 'professional',
  brand_voice text,
  custom_instructions text,
  fallback_model text DEFAULT 'google/gemini-2.5-flash-lite',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id)
);

ALTER TABLE public.workspace_ai_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their workspace AI settings"
  ON public.workspace_ai_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_ai_settings.workspace_id AND w.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_ai_settings.workspace_id AND w.user_id = auth.uid()));

-- =============================================
-- 8. workspace_notification_settings
-- =============================================
CREATE TABLE public.workspace_notification_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  telegram_enabled boolean DEFAULT false,
  telegram_chat_id text,
  email_enabled boolean DEFAULT false,
  email_recipients text[] DEFAULT '{}',
  webhook_url text,
  notify_on_publish boolean DEFAULT true,
  notify_on_error boolean DEFAULT true,
  notify_on_job_complete boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id)
);

ALTER TABLE public.workspace_notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their workspace notification settings"
  ON public.workspace_notification_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_notification_settings.workspace_id AND w.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_notification_settings.workspace_id AND w.user_id = auth.uid()));

-- =============================================
-- 9. workspace_supplier_configs
-- =============================================
CREATE TABLE public.workspace_supplier_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  supplier_name text NOT NULL,
  supplier_url text,
  scrape_config jsonb DEFAULT '{}',
  field_mappings jsonb DEFAULT '{}',
  auto_enrich boolean DEFAULT false,
  schedule_cron text,
  last_run_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_supplier_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their workspace supplier configs"
  ON public.workspace_supplier_configs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_supplier_configs.workspace_id AND w.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_supplier_configs.workspace_id AND w.user_id = auth.uid()));

-- =============================================
-- 10. workspace_prompt_profiles
-- =============================================
CREATE TABLE public.workspace_prompt_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  field_key text NOT NULL,
  system_prompt text,
  user_prompt_template text,
  examples jsonb DEFAULT '[]',
  is_default boolean DEFAULT false,
  language text DEFAULT 'pt',
  tone text DEFAULT 'professional',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_prompt_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their workspace prompt profiles"
  ON public.workspace_prompt_profiles FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_prompt_profiles.workspace_id AND w.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_prompt_profiles.workspace_id AND w.user_id = auth.uid()));

-- =============================================
-- 11. workspace_publish_profiles
-- =============================================
CREATE TABLE public.workspace_publish_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  publish_fields text[] DEFAULT '{}',
  pricing_rules jsonb DEFAULT '{}',
  sku_prefix_rules jsonb DEFAULT '{}',
  is_default boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_publish_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their workspace publish profiles"
  ON public.workspace_publish_profiles FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_publish_profiles.workspace_id AND w.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_publish_profiles.workspace_id AND w.user_id = auth.uid()));

-- =============================================
-- 12. audit_trail
-- =============================================
CREATE TABLE public.audit_trail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  entity_type public.audit_entity_type NOT NULL,
  entity_id uuid NOT NULL,
  action public.audit_action NOT NULL,
  field_changes jsonb DEFAULT '{}',
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_trail ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own audit trail"
  ON public.audit_trail FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own audit trail"
  ON public.audit_trail FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Index for fast queries
CREATE INDEX idx_audit_trail_entity ON public.audit_trail(entity_type, entity_id);
CREATE INDEX idx_audit_trail_workspace ON public.audit_trail(workspace_id, created_at DESC);
CREATE INDEX idx_audit_trail_user ON public.audit_trail(user_id, created_at DESC);

-- =============================================
-- 13. workflow_transitions
-- =============================================
CREATE TABLE public.workflow_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  from_state public.product_workflow,
  to_state public.product_workflow NOT NULL,
  triggered_by uuid NOT NULL,
  trigger_source text DEFAULT 'manual',
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workflow_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own workflow transitions"
  ON public.workflow_transitions FOR SELECT TO authenticated
  USING (auth.uid() = triggered_by);

CREATE POLICY "Users can insert their own workflow transitions"
  ON public.workflow_transitions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = triggered_by);

CREATE INDEX idx_workflow_transitions_product ON public.workflow_transitions(product_id, created_at DESC);

-- =============================================
-- 14. optimization_job_items
-- =============================================
CREATE TABLE public.optimization_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.optimization_jobs(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  status public.job_item_status NOT NULL DEFAULT 'queued',
  fields_optimized text[] DEFAULT '{}',
  model_used text,
  tokens_used integer DEFAULT 0,
  rag_chunks_used integer DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 3,
  error_message text,
  error_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.optimization_job_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own optimization job items"
  ON public.optimization_job_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.optimization_jobs j WHERE j.id = optimization_job_items.job_id AND j.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.optimization_jobs j WHERE j.id = optimization_job_items.job_id AND j.user_id = auth.uid()));

CREATE INDEX idx_opt_job_items_job ON public.optimization_job_items(job_id, created_at);
CREATE INDEX idx_opt_job_items_product ON public.optimization_job_items(product_id);

-- =============================================
-- 15. publish_job_items
-- =============================================
CREATE TABLE public.publish_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.publish_jobs(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  status public.job_item_status NOT NULL DEFAULT 'queued',
  woocommerce_id bigint,
  publish_fields text[] DEFAULT '{}',
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 3,
  error_message text,
  error_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.publish_job_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own publish job items"
  ON public.publish_job_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.publish_jobs j WHERE j.id = publish_job_items.job_id AND j.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.publish_jobs j WHERE j.id = publish_job_items.job_id AND j.user_id = auth.uid()));

CREATE INDEX idx_pub_job_items_job ON public.publish_job_items(job_id, created_at);
CREATE INDEX idx_pub_job_items_product ON public.publish_job_items(product_id);

-- =============================================
-- 16. Enable realtime for job items
-- =============================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.optimization_job_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.publish_job_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.workflow_transitions;

-- =============================================
-- 17. Index on products.workflow_state
-- =============================================
CREATE INDEX idx_products_workflow_state ON public.products(workflow_state);
