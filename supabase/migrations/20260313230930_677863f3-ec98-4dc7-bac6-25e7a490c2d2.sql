
-- Enums for BLOCO 8
CREATE TYPE public.insight_type_enum AS ENUM (
  'seo_improvement','title_optimization','description_improvement','missing_attribute',
  'image_quality_issue','category_mismatch','bundle_opportunity','upsell_opportunity',
  'cross_sell_opportunity','price_anomaly','channel_rejection_risk','missing_translation',
  'catalog_gap','keyword_opportunity'
);

CREATE TYPE public.insight_status_enum AS ENUM ('open','accepted','ignored','implemented');

CREATE TYPE public.gap_type_enum AS ENUM (
  'missing_product_family','missing_variation','missing_accessory','missing_bundle','missing_supplier_range'
);

CREATE TYPE public.bundle_type_enum AS ENUM (
  'frequently_bought_together','accessory_bundle','starter_kit','professional_bundle','upsell_bundle'
);

CREATE TYPE public.opportunity_type_enum AS ENUM (
  'missing_upsell','missing_cross_sell','missing_bundle','low_visibility','low_conversion','underpriced_product'
);

-- 1. Product Performance Metrics
CREATE TABLE public.product_performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  views integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cart_additions integer DEFAULT 0,
  orders integer DEFAULT 0,
  revenue numeric,
  conversion_rate numeric,
  avg_position numeric,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz
);
ALTER TABLE public.product_performance_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace access for perf metrics" ON public.product_performance_metrics FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- 2. Product Insights
CREATE TABLE public.product_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  insight_type public.insight_type_enum NOT NULL,
  insight_payload jsonb,
  confidence integer DEFAULT 0,
  priority integer DEFAULT 50,
  status public.insight_status_enum DEFAULT 'open',
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE public.product_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace access for insights" ON public.product_insights FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- 3. Catalog Gap Analysis
CREATE TABLE public.catalog_gap_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category_id uuid,
  supplier_id uuid,
  gap_type public.gap_type_enum NOT NULL,
  gap_description text,
  suggested_products jsonb,
  confidence integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.catalog_gap_analysis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace access for gaps" ON public.catalog_gap_analysis FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- 4. Bundle Suggestions
CREATE TABLE public.bundle_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  bundle_type public.bundle_type_enum NOT NULL,
  primary_product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  suggested_products uuid[],
  bundle_reason text,
  confidence integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  accepted boolean DEFAULT false
);
ALTER TABLE public.bundle_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace access for bundles" ON public.bundle_suggestions FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- 5. SEO Recommendations
CREATE TABLE public.seo_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  locale text,
  recommended_title text,
  recommended_meta_description text,
  recommended_keywords text[],
  keyword_volume integer,
  difficulty_score integer,
  confidence integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.seo_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace access for seo recs" ON public.seo_recommendations FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- 6. Channel Performance Predictions
CREATE TABLE public.channel_performance_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  predicted_ctr numeric,
  predicted_conversion numeric,
  predicted_revenue numeric,
  confidence integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.channel_performance_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace access for predictions" ON public.channel_performance_predictions FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- 7. Monetization Opportunities
CREATE TABLE public.monetization_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  opportunity_type public.opportunity_type_enum NOT NULL,
  description text,
  estimated_revenue_gain numeric,
  confidence integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.monetization_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace access for monetization" ON public.monetization_opportunities FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- 8. Attribute Completeness Scores
CREATE TABLE public.attribute_completeness_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  category_id uuid,
  required_attributes integer DEFAULT 0,
  present_attributes integer DEFAULT 0,
  completeness_score numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.attribute_completeness_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace access for completeness" ON public.attribute_completeness_scores FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));
