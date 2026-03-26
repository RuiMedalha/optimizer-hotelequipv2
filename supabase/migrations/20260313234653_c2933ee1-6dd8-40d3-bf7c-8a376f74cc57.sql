
-- PARTE A: REVENUE OPTIMIZATION ENUMS
CREATE TYPE public.product_relationship_type AS ENUM ('complementary','accessory','upgrade','substitute','bundle_candidate','cross_sell','upsell');
CREATE TYPE public.revenue_action_type AS ENUM ('create_bundle','add_cross_sell','add_upsell','adjust_price','launch_promotion','create_product_pack');
CREATE TYPE public.promotion_type AS ENUM ('discount','bundle_offer','limited_time_offer','volume_discount','channel_promotion');

-- PARTE B: DEMAND INTELLIGENCE ENUMS
CREATE TYPE public.demand_source_type AS ENUM ('search_console','google_ads','analytics','site_search','marketplace_search','external_keyword_data');
CREATE TYPE public.demand_signal_type AS ENUM ('search_volume','keyword_trend','click_through_rate','conversion_rate','ad_cost','keyword_gap','demand_spike');

-- PRODUCT RELATIONSHIPS
CREATE TABLE public.product_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_a_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  product_b_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  relationship_type public.product_relationship_type,
  confidence numeric,
  source text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.product_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_product_relationships" ON public.product_relationships FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- BUNDLE RECOMMENDATIONS
CREATE TABLE public.bundle_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  bundle_products jsonb,
  expected_conversion numeric,
  expected_revenue numeric,
  confidence numeric,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.bundle_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_bundle_recs" ON public.bundle_recommendations FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- PRICING RECOMMENDATIONS
CREATE TABLE public.pricing_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  current_price numeric,
  recommended_price numeric,
  minimum_price numeric,
  expected_margin numeric,
  confidence numeric,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.pricing_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_pricing_recs" ON public.pricing_recommendations FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- PROMOTION CANDIDATES
CREATE TABLE public.promotion_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  promotion_type public.promotion_type,
  estimated_revenue_gain numeric,
  confidence numeric,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.promotion_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_promo_candidates" ON public.promotion_candidates FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- REVENUE ACTIONS
CREATE TABLE public.revenue_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  action_type public.revenue_action_type,
  action_payload jsonb,
  expected_revenue numeric,
  status text DEFAULT 'pending',
  executed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.revenue_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_revenue_actions" ON public.revenue_actions FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- DEMAND SOURCES
CREATE TABLE public.demand_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_type public.demand_source_type,
  source_name text,
  config jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.demand_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_demand_sources" ON public.demand_sources FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- DEMAND SIGNALS
CREATE TABLE public.demand_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  keyword text,
  category_id uuid,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  signal_type public.demand_signal_type,
  signal_strength numeric,
  payload jsonb,
  detected_at timestamptz DEFAULT now()
);
ALTER TABLE public.demand_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_demand_signals" ON public.demand_signals FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- KEYWORD OPPORTUNITIES
CREATE TABLE public.keyword_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  keyword text,
  category_id uuid,
  estimated_search_volume numeric,
  competition_level numeric,
  opportunity_score numeric,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.keyword_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_keyword_opps" ON public.keyword_opportunities FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- DEMAND TRENDS
CREATE TABLE public.demand_trends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  keyword text,
  trend_direction text,
  trend_strength numeric,
  detected_at timestamptz
);
ALTER TABLE public.demand_trends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_demand_trends" ON public.demand_trends FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));
