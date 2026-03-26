-- Migration 2: ai_model_catalog
-- Depends on ai_provider_registry (Migration 1). Additive only.

CREATE TABLE IF NOT EXISTS ai_model_catalog (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id               TEXT NOT NULL REFERENCES ai_provider_registry(id),
  model_id                  TEXT NOT NULL,
  display_name              TEXT NOT NULL,
  context_window            INT,
  max_output_tokens         INT,
  supports_vision           BOOLEAN DEFAULT FALSE,
  supports_function_calling BOOLEAN DEFAULT FALSE,
  supports_json_mode        BOOLEAN DEFAULT FALSE,
  input_cost_per_1k         NUMERIC,
  output_cost_per_1k        NUMERIC,
  status                    TEXT NOT NULL DEFAULT 'active',
  recommended_for           TEXT[],
  enabled                   BOOLEAN DEFAULT TRUE,
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now(),
  UNIQUE(provider_id, model_id)
);

ALTER TABLE ai_model_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_catalog"
  ON ai_model_catalog FOR ALL TO service_role USING (true);

CREATE POLICY "authenticated_read_catalog"
  ON ai_model_catalog FOR SELECT TO authenticated USING (true);
