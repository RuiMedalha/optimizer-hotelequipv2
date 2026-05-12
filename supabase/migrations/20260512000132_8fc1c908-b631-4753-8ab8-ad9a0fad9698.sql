ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_migration_status jsonb DEFAULT '{}'::jsonb;