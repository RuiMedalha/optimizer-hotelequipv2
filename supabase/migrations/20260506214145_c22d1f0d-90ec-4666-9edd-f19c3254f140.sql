ALTER TABLE public.supplier_profiles
  ADD COLUMN IF NOT EXISTS connector_config jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS feed_url_xml text,
  ADD COLUMN IF NOT EXISTS feed_url_csv text,
  ADD COLUMN IF NOT EXISTS feed_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS feed_auth_config jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.supplier_profiles.connector_config IS 
  'Stores column mapping, transformation rules, SKU prefix/suffix, and match strategy for automatic file processing';
COMMENT ON COLUMN public.supplier_profiles.feed_url_xml IS 
  'Direct URL to supplier XML feed (authenticated or public)';
COMMENT ON COLUMN public.supplier_profiles.feed_url_csv IS 
  'Direct URL to supplier CSV feed (authenticated or public)';