
-- =============================================
-- BLOCO 3B: Schema Engine, Validation & Review Queue
-- =============================================

-- 1. ENUMS
CREATE TYPE public.validation_rule_type AS ENUM (
  'required', 'regex', 'min_length', 'max_length',
  'min_value', 'max_value', 'min_items', 'max_items',
  'enum', 'not_empty', 'json_schema', 'custom'
);

CREATE TYPE public.validation_severity AS ENUM ('error', 'warning', 'info');

CREATE TYPE public.review_reason AS ENUM (
  'low_confidence', 'ai_generated', 'missing_fields',
  'quality_gate_fail', 'validation_fail', 'human_requested'
);

CREATE TYPE public.review_status AS ENUM ('pending', 'in_review', 'approved', 'rejected');

-- 2. TABLES

-- A) category_schemas
CREATE TABLE public.category_schemas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  schema_definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  required_fields text[] NOT NULL DEFAULT '{}',
  optional_fields text[] NOT NULL DEFAULT '{}',
  variation_attributes jsonb NOT NULL DEFAULT '[]'::jsonb,
  channel_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_category_schemas_workspace ON public.category_schemas(workspace_id);
CREATE INDEX idx_category_schemas_category ON public.category_schemas(category_id);
CREATE INDEX idx_category_schemas_active ON public.category_schemas(is_active);

-- B) validation_rules
CREATE TABLE public.validation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  schema_id uuid REFERENCES public.category_schemas(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  rule_type public.validation_rule_type NOT NULL,
  rule_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity public.validation_severity NOT NULL DEFAULT 'error',
  applies_to_channels text[],
  applies_to_product_types text[],
  error_message_template text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_validation_rules_workspace ON public.validation_rules(workspace_id);
CREATE INDEX idx_validation_rules_schema ON public.validation_rules(schema_id);
CREATE INDEX idx_validation_rules_active ON public.validation_rules(is_active);

-- C) validation_results
CREATE TABLE public.validation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.validation_rules(id) ON DELETE SET NULL,
  schema_id uuid REFERENCES public.category_schemas(id) ON DELETE SET NULL,
  channel_id uuid,
  passed boolean NOT NULL,
  actual_value text,
  expected text,
  severity public.validation_severity NOT NULL,
  validated_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_validation_results_product ON public.validation_results(product_id);
CREATE INDEX idx_validation_results_schema ON public.validation_results(schema_id);
CREATE INDEX idx_validation_results_date ON public.validation_results(validated_at DESC);
CREATE INDEX idx_validation_results_passed ON public.validation_results(passed);

-- D) review_queue
CREATE TABLE public.review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  reason public.review_reason NOT NULL,
  priority integer NOT NULL DEFAULT 50,
  assigned_to uuid,
  status public.review_status NOT NULL DEFAULT 'pending',
  reviewer_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX idx_review_queue_workspace ON public.review_queue(workspace_id);
CREATE INDEX idx_review_queue_product ON public.review_queue(product_id);
CREATE INDEX idx_review_queue_status ON public.review_queue(status);
CREATE INDEX idx_review_queue_priority ON public.review_queue(priority DESC);
CREATE INDEX idx_review_queue_assigned ON public.review_queue(assigned_to);

-- 3. UPDATED_AT TRIGGERS
CREATE TRIGGER set_category_schemas_updated_at
  BEFORE UPDATE ON public.category_schemas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_validation_rules_updated_at
  BEFORE UPDATE ON public.validation_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. RLS
ALTER TABLE public.category_schemas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.validation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.validation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_queue ENABLE ROW LEVEL SECURITY;

-- category_schemas: viewer+ read, admin+ write
CREATE POLICY "Members can view category schemas"
  ON public.category_schemas FOR SELECT TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'));

CREATE POLICY "Admins can manage category schemas"
  ON public.category_schemas FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'admin'))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'admin'));

-- validation_rules: viewer+ read, admin+ write
CREATE POLICY "Members can view validation rules"
  ON public.validation_rules FOR SELECT TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'viewer'));

CREATE POLICY "Admins can manage validation rules"
  ON public.validation_rules FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'admin'))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'admin'));

-- validation_results: via product ownership
CREATE POLICY "Users can manage validation results"
  ON public.validation_results FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM products p WHERE p.id = validation_results.product_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM products p WHERE p.id = validation_results.product_id AND p.user_id = auth.uid()));

-- review_queue: editor+ read/write, admin+ manage
CREATE POLICY "Members can view review queue"
  ON public.review_queue FOR SELECT TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'editor'));

CREATE POLICY "Editors can manage review queue"
  ON public.review_queue FOR ALL TO authenticated
  USING (has_workspace_access_hybrid(workspace_id, 'editor'))
  WITH CHECK (has_workspace_access_hybrid(workspace_id, 'editor'));

-- 5. SQL FUNCTIONS

-- Get active schema for a product (specific category first, then global fallback)
CREATE OR REPLACE FUNCTION public.get_active_schema_for_product(_product_id uuid)
RETURNS public.category_schemas
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT cs.* FROM public.category_schemas cs
  JOIN public.products p ON p.workspace_id = cs.workspace_id
  WHERE p.id = _product_id AND cs.is_active = true
  AND (cs.category_id = p.category_id OR cs.category_id IS NULL)
  ORDER BY cs.category_id IS NULL ASC  -- specific category first
  LIMIT 1;
$$;

-- Compute product completeness score
CREATE OR REPLACE FUNCTION public.compute_product_completeness_score(_product_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT ROUND(
      (CASE WHEN p.optimized_title IS NOT NULL AND p.optimized_title != '' THEN 10 ELSE 0 END
      + CASE WHEN p.optimized_description IS NOT NULL AND p.optimized_description != '' THEN 10 ELSE 0 END
      + CASE WHEN p.optimized_short_description IS NOT NULL AND p.optimized_short_description != '' THEN 10 ELSE 0 END
      + CASE WHEN p.meta_title IS NOT NULL AND p.meta_title != '' THEN 10 ELSE 0 END
      + CASE WHEN p.meta_description IS NOT NULL AND p.meta_description != '' THEN 10 ELSE 0 END
      + CASE WHEN p.seo_slug IS NOT NULL AND p.seo_slug != '' THEN 10 ELSE 0 END
      + CASE WHEN p.image_urls IS NOT NULL AND array_length(p.image_urls, 1) > 0 THEN 10 ELSE 0 END
      + CASE WHEN p.category_id IS NOT NULL OR (p.category IS NOT NULL AND p.category != '') THEN 10 ELSE 0 END
      + CASE WHEN COALESCE(p.optimized_price, p.original_price) > 0 THEN 10 ELSE 0 END
      + CASE WHEN p.tags IS NOT NULL AND array_length(p.tags, 1) > 0 THEN 10 ELSE 0 END
      )
    )::integer
    FROM public.products p WHERE p.id = _product_id
  ), 0);
$$;

-- Enqueue product for review (avoid duplicates)
CREATE OR REPLACE FUNCTION public.enqueue_product_for_review(
  _workspace_id uuid,
  _product_id uuid,
  _reason public.review_reason,
  _priority integer DEFAULT 50
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _existing_id uuid;
  _new_id uuid;
BEGIN
  SELECT id INTO _existing_id FROM public.review_queue
  WHERE workspace_id = _workspace_id
    AND product_id = _product_id
    AND reason = _reason
    AND status IN ('pending', 'in_review')
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    RETURN _existing_id;
  END IF;

  INSERT INTO public.review_queue (workspace_id, product_id, reason, priority)
  VALUES (_workspace_id, _product_id, _reason, _priority)
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$$;

-- Enable realtime for review_queue
ALTER PUBLICATION supabase_realtime ADD TABLE public.review_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE public.validation_results;
