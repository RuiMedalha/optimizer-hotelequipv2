
-- =============================================
-- BLOCO 2: Trust Layer, Quality Gates, Publish Locks
-- =============================================

-- 1. Enum for confidence source
CREATE TYPE public.confidence_source AS ENUM ('ai', 'human', 'import', 'scrape', 'ocr', 'api');

-- 2. Enum for lock type
CREATE TYPE public.publish_lock_type AS ENUM ('quality_gate', 'manual', 'validation', 'missing_data');

-- 3. Enum for validation status
CREATE TYPE public.field_validation_status AS ENUM ('valid', 'invalid', 'unvalidated');

-- 4. Enum for gate rule severity
CREATE TYPE public.gate_severity AS ENUM ('error', 'warning', 'info');

-- =============================================
-- 5. quality_gates
-- =============================================
CREATE TABLE public.quality_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean DEFAULT true,
  block_publish boolean DEFAULT true,
  rules jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quality_gates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their workspace quality gates"
  ON public.quality_gates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = quality_gates.workspace_id AND w.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = quality_gates.workspace_id AND w.user_id = auth.uid()));

-- =============================================
-- 6. quality_gate_results
-- =============================================
CREATE TABLE public.quality_gate_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  gate_id uuid NOT NULL REFERENCES public.quality_gates(id) ON DELETE CASCADE,
  passed boolean NOT NULL DEFAULT false,
  score integer DEFAULT 0,
  failures jsonb DEFAULT '[]',
  evaluated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quality_gate_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their quality gate results"
  ON public.quality_gate_results FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = quality_gate_results.product_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p WHERE p.id = quality_gate_results.product_id AND p.user_id = auth.uid()));

CREATE INDEX idx_qg_results_product ON public.quality_gate_results(product_id, evaluated_at DESC);
CREATE INDEX idx_qg_results_gate ON public.quality_gate_results(gate_id);

-- =============================================
-- 7. publish_locks
-- =============================================
CREATE TABLE public.publish_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  reason text NOT NULL,
  lock_type public.publish_lock_type NOT NULL DEFAULT 'quality_gate',
  locked_by uuid,
  locked_at timestamptz NOT NULL DEFAULT now(),
  unlocked_by uuid,
  unlocked_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.publish_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their product publish locks"
  ON public.publish_locks FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = publish_locks.product_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p WHERE p.id = publish_locks.product_id AND p.user_id = auth.uid()));

CREATE INDEX idx_publish_locks_product_active ON public.publish_locks(product_id) WHERE is_active = true;

-- =============================================
-- 8. product_field_confidence
-- =============================================
CREATE TABLE public.product_field_confidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  confidence_score integer NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 100),
  source public.confidence_source NOT NULL DEFAULT 'import',
  extraction_method text,
  source_attribution jsonb DEFAULT '{}',
  validation_status public.field_validation_status DEFAULT 'unvalidated',
  validation_reason text,
  validated_by uuid,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, field_key)
);

ALTER TABLE public.product_field_confidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their product field confidence"
  ON public.product_field_confidence FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_field_confidence.product_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_field_confidence.product_id AND p.user_id = auth.uid()));

CREATE INDEX idx_pfc_product ON public.product_field_confidence(product_id);

-- =============================================
-- 9. product_quality_scores
-- =============================================
CREATE TABLE public.product_quality_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  overall_score integer DEFAULT 0,
  title_score integer DEFAULT 0,
  description_score integer DEFAULT 0,
  seo_score integer DEFAULT 0,
  image_score integer DEFAULT 0,
  completeness_score integer DEFAULT 0,
  schema_match_score integer DEFAULT 0,
  price_score integer DEFAULT 0,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id)
);

ALTER TABLE public.product_quality_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their product quality scores"
  ON public.product_quality_scores FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_quality_scores.product_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_quality_scores.product_id AND p.user_id = auth.uid()));

-- =============================================
-- 10. Additive columns on products
-- =============================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS quality_score integer,
  ADD COLUMN IF NOT EXISTS locked_for_publish boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS validation_status text DEFAULT 'unvalidated',
  ADD COLUMN IF NOT EXISTS validation_errors jsonb DEFAULT '[]';

CREATE INDEX idx_products_locked ON public.products(locked_for_publish) WHERE locked_for_publish = true;
CREATE INDEX idx_products_quality_score ON public.products(quality_score);

-- =============================================
-- 11. Realtime for quality gate results and publish locks
-- =============================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.quality_gate_results;
ALTER PUBLICATION supabase_realtime ADD TABLE public.publish_locks;
