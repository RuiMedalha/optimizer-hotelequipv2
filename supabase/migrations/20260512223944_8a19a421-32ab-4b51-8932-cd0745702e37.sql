ALTER TABLE products
  ADD COLUMN IF NOT EXISTS publishability_score integer,
  ADD COLUMN IF NOT EXISTS publishability_reason text,
  ADD COLUMN IF NOT EXISTS publishability_decision text
    CHECK (publishability_decision IN ('publish', 'review', 'skip'));

CREATE INDEX IF NOT EXISTS idx_products_publishability
  ON products(publishability_decision);

ALTER TABLE supplier_profiles
  ADD COLUMN IF NOT EXISTS publishability_rules jsonb,
  ADD COLUMN IF NOT EXISTS publishability_last_run timestamptz,
  ADD COLUMN IF NOT EXISTS publishability_stats jsonb;