-- Migration: ai_model_pricing
-- Dedicated pricing table separate from ai_model_catalog (which holds capability flags).
-- Costs are per 1 MILLION tokens (industry standard display unit).
-- Multiple rows per model are allowed (different effective_from dates) for price history.
-- Only rows where is_active=true are used for cost calculation.

CREATE TABLE IF NOT EXISTS ai_model_pricing (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id              TEXT        NOT NULL,
  model_id                 TEXT        NOT NULL,
  display_name             TEXT        NOT NULL,
  input_cost_per_1m        NUMERIC(12,6) NOT NULL DEFAULT 0,
  output_cost_per_1m       NUMERIC(12,6) NOT NULL DEFAULT 0,
  cached_input_cost_per_1m NUMERIC(12,6),
  currency                 TEXT        NOT NULL DEFAULT 'USD',
  effective_from           DATE        NOT NULL DEFAULT CURRENT_DATE,
  is_active                BOOLEAN     NOT NULL DEFAULT TRUE,
  source_url               TEXT,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (provider_id, model_id, effective_from)
);

-- Fast lookup for active pricing by provider+model
CREATE INDEX IF NOT EXISTS ai_model_pricing_active_idx
  ON ai_model_pricing (provider_id, model_id)
  WHERE is_active;

-- RLS: service_role full access, authenticated users can read
ALTER TABLE ai_model_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_ai_model_pricing"
  ON ai_model_pricing FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_ai_model_pricing"
  ON ai_model_pricing FOR SELECT
  TO authenticated USING (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_ai_model_pricing_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER ai_model_pricing_updated_at
  BEFORE UPDATE ON ai_model_pricing
  FOR EACH ROW EXECUTE FUNCTION update_ai_model_pricing_updated_at();
