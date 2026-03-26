
-- ENUMS
CREATE TYPE public.market_source_type AS ENUM ('competitor_site','google_serp','google_shopping','marketplace','supplier_feed','public_catalog','price_comparison');
CREATE TYPE public.market_signal_type AS ENUM ('price_competitiveness','seo_alignment','content_gap','image_gap','bundle_opportunity','pricing_opportunity','category_gap','attribute_gap','keyword_opportunity','market_trend');
CREATE TYPE public.market_opportunity_type AS ENUM ('price_adjustment','seo_improvement','content_enrichment','image_upgrade','bundle_creation','taxonomy_update','channel_expansion');
CREATE TYPE public.benchmark_metric AS ENUM ('median_price','average_title_length','average_description_length','image_count','attribute_coverage','keyword_density','bundle_frequency');

-- MARKET SOURCES
CREATE TABLE public.market_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_type public.market_source_type,
  source_name text,
  base_url text,
  config jsonb,
  crawl_frequency text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.market_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_market_sources" ON public.market_sources FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- MARKET OBSERVATIONS
CREATE TABLE public.market_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.market_sources(id) ON DELETE SET NULL,
  observed_url text,
  observed_title text,
  observed_price numeric,
  observed_sale_price numeric,
  observed_brand text,
  observed_category text,
  observed_attributes jsonb,
  observed_images jsonb,
  observed_rating numeric,
  observed_reviews_count integer,
  observed_availability text,
  observed_at timestamptz
);
CREATE INDEX idx_market_obs_ws ON public.market_observations(workspace_id);
CREATE INDEX idx_market_obs_src ON public.market_observations(source_id);
CREATE INDEX idx_market_obs_cat ON public.market_observations(observed_category);
ALTER TABLE public.market_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_market_observations" ON public.market_observations FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- PRODUCT MATCHING
CREATE TABLE public.market_product_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  market_observation_id uuid REFERENCES public.market_observations(id) ON DELETE CASCADE,
  match_confidence integer,
  match_reason text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.market_product_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_market_matches" ON public.market_product_matches FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- MARKET SIGNALS
CREATE TABLE public.market_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  category_id uuid,
  signal_type public.market_signal_type,
  signal_strength integer,
  signal_payload jsonb,
  detected_at timestamptz DEFAULT now()
);
ALTER TABLE public.market_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_market_signals" ON public.market_signals FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- MARKET BENCHMARKS
CREATE TABLE public.market_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category_id uuid,
  channel_type text,
  median_price numeric,
  average_title_length numeric,
  average_description_length numeric,
  average_image_count numeric,
  common_attributes jsonb,
  common_keywords jsonb,
  benchmark_date timestamptz
);
ALTER TABLE public.market_benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_market_benchmarks" ON public.market_benchmarks FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- MARKET OPPORTUNITIES
CREATE TABLE public.market_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  category_id uuid,
  opportunity_type public.market_opportunity_type,
  priority_score numeric,
  estimated_revenue_impact numeric,
  confidence_score integer,
  recommendation_payload jsonb,
  status text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.market_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_market_opportunities" ON public.market_opportunities FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));

-- MARKET TRENDS
CREATE TABLE public.market_trends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category_id uuid,
  trend_type text,
  trend_signal jsonb,
  trend_strength numeric,
  detected_at timestamptz
);
ALTER TABLE public.market_trends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_market_trends" ON public.market_trends FOR ALL TO authenticated USING (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT id FROM public.workspaces WHERE user_id = auth.uid()));
