
-- Enums for BLOCO 7.1
CREATE TYPE public.channel_rule_type_enum AS ENUM (
  'title_template','description_template','exclude_product','require_attribute',
  'fallback_attribute','category_override','price_adjustment','image_selection',
  'variant_strategy','feed_cleanup','stock_policy','shipping_policy','validation_rule'
);

CREATE TYPE public.feed_type_enum AS ENUM (
  'marketplace','merchant_feed','partner_csv','internal_api','retailer_feed'
);

CREATE TYPE public.learning_source_enum AS ENUM (
  'rejection_pattern','validation_failure','manual_review','ai_detection','feed_analysis'
);

-- 1. Channel Rules
CREATE TABLE public.channel_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  rule_name text NOT NULL,
  rule_type public.channel_rule_type_enum NOT NULL,
  priority integer DEFAULT 100,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  actions jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.channel_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage channel_rules via workspace" ON public.channel_rules FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- 2. Feed Profiles
CREATE TABLE public.channel_feed_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  profile_name text NOT NULL,
  feed_type public.feed_type_enum,
  locale text,
  currency text,
  title_template text,
  description_template text,
  attribute_whitelist text[],
  attribute_blacklist text[],
  image_strategy jsonb,
  price_strategy jsonb,
  validation_profile jsonb,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.channel_feed_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage feed_profiles via workspace" ON public.channel_feed_profiles FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- 3. Rejections
CREATE TABLE public.channel_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  external_code text,
  external_message text,
  rejection_type text,
  field_impacted text,
  resolved boolean DEFAULT false,
  resolution_note text,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE public.channel_rejections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage rejections via workspace" ON public.channel_rejections FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- 4. Rule Learning
CREATE TABLE public.channel_rule_learning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  pattern_detected text NOT NULL,
  source_type public.learning_source_enum,
  frequency integer DEFAULT 1,
  suggested_rule jsonb,
  accepted_by_user boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.channel_rule_learning ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage rule_learning via workspace" ON public.channel_rule_learning FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));
