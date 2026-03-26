-- Non-destructive AI model comparison engine.
-- Stores comparison runs and per-result outputs without touching products table.

CREATE TABLE IF NOT EXISTS ai_comparison_runs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL,
  created_by    UUID        NOT NULL,
  product_ids   JSONB       NOT NULL,  -- string[]
  model_ids     JSONB       NOT NULL,  -- string[]
  sections      JSONB       NOT NULL,  -- string[]
  product_count INTEGER     NOT NULL,
  model_count   INTEGER     NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running', 'completed', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ai_comparison_results (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID        NOT NULL REFERENCES ai_comparison_runs(id) ON DELETE CASCADE,
  product_id     UUID        NOT NULL,
  model_id       TEXT        NOT NULL,
  provider_id    TEXT        NOT NULL,
  section        TEXT        NOT NULL,
  output_text    TEXT        NOT NULL,
  input_tokens   INTEGER     NOT NULL DEFAULT 0,
  output_tokens  INTEGER     NOT NULL DEFAULT 0,
  estimated_cost NUMERIC(12,6) NOT NULL DEFAULT 0,
  latency_ms     INTEGER     NOT NULL DEFAULT 0,
  score          NUMERIC(5,2),
  selected       BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_comparison_results_run_product_idx
  ON ai_comparison_results (run_id, product_id);

CREATE INDEX IF NOT EXISTS ai_comparison_results_run_section_idx
  ON ai_comparison_results (run_id, product_id, section);

CREATE INDEX IF NOT EXISTS ai_comparison_runs_workspace_idx
  ON ai_comparison_runs (workspace_id);

-- RLS
ALTER TABLE ai_comparison_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_comparison_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_comparison_runs"
  ON ai_comparison_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_comparison_runs"
  ON ai_comparison_runs FOR SELECT TO authenticated
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "authenticated_insert_comparison_runs"
  ON ai_comparison_runs FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "service_role_all_comparison_results"
  ON ai_comparison_results FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_comparison_results"
  ON ai_comparison_results FOR SELECT TO authenticated
  USING (run_id IN (
    SELECT id FROM ai_comparison_runs
    WHERE workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  ));
