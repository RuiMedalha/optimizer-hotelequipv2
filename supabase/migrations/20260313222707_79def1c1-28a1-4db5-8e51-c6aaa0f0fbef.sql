
-- Add is_primary to asset_product_links
ALTER TABLE public.asset_product_links
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- Composite indexes for priority resolution
CREATE INDEX IF NOT EXISTS idx_apl_product_channel_usage_primary
  ON public.asset_product_links (product_id, channel_id, usage_context, is_primary DESC);

CREATE INDEX IF NOT EXISTS idx_av_source_channel_type
  ON public.asset_variants (source_asset_id, channel_id, variant_type);

CREATE INDEX IF NOT EXISTS idx_al_workspace_hash_type_status
  ON public.asset_library (workspace_id, file_hash, asset_type, status);

-- Unique: one primary per product+context+channel
CREATE UNIQUE INDEX IF NOT EXISTS idx_apl_unique_primary
  ON public.asset_product_links (product_id, usage_context, channel_id)
  WHERE is_primary = true;

-- Unique: no duplicate asset-product-context-channel links
CREATE UNIQUE INDEX IF NOT EXISTS idx_apl_unique_link
  ON public.asset_product_links (asset_id, product_id, usage_context, COALESCE(channel_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Unique: no duplicate variant per source+channel+type
CREATE UNIQUE INDEX IF NOT EXISTS idx_av_unique_variant
  ON public.asset_variants (source_asset_id, variant_type, COALESCE(channel_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Helper: resolve assets for a product with channel priority + family inheritance
CREATE OR REPLACE FUNCTION public.get_product_assets(
  _product_id uuid,
  _channel_id uuid DEFAULT NULL,
  _usage_context asset_usage_enum DEFAULT NULL
)
RETURNS TABLE (
  asset_id uuid,
  public_url text,
  usage_context asset_usage_enum,
  sort_order integer,
  is_primary boolean,
  asset_type asset_type_enum,
  ai_alt_text text,
  source text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH direct_assets AS (
    SELECT apl.asset_id, al.public_url, apl.usage_context, apl.sort_order, apl.is_primary,
           al.asset_type, al.ai_alt_text, 'direct'::text AS source,
           CASE WHEN apl.channel_id IS NOT NULL THEN 1 ELSE 2 END AS priority
    FROM asset_product_links apl
    JOIN asset_library al ON al.id = apl.asset_id AND al.status = 'active'
    WHERE apl.product_id = _product_id
      AND (_usage_context IS NULL OR apl.usage_context = _usage_context)
      AND (apl.channel_id IS NULL OR apl.channel_id = _channel_id)
  ),
  inherited_assets AS (
    SELECT apl.asset_id, al.public_url, apl.usage_context, apl.sort_order, apl.is_primary,
           al.asset_type, al.ai_alt_text, 'inherited'::text AS source,
           CASE WHEN apl.channel_id IS NOT NULL THEN 3 ELSE 4 END AS priority
    FROM products p
    JOIN asset_product_links apl ON apl.product_id = p.parent_product_id
    JOIN asset_library al ON al.id = apl.asset_id AND al.status = 'active' AND al.family_shared = true
    WHERE p.id = _product_id
      AND p.parent_product_id IS NOT NULL
      AND (_usage_context IS NULL OR apl.usage_context = _usage_context)
      AND (apl.channel_id IS NULL OR apl.channel_id = _channel_id)
      AND NOT EXISTS (
        SELECT 1 FROM asset_product_links d
        WHERE d.product_id = _product_id AND d.usage_context = apl.usage_context
      )
  ),
  all_assets AS (
    SELECT * FROM direct_assets
    UNION ALL
    SELECT * FROM inherited_assets
  )
  SELECT DISTINCT ON (a.asset_id) a.asset_id, a.public_url, a.usage_context, a.sort_order, a.is_primary, a.asset_type, a.ai_alt_text, a.source
  FROM all_assets a
  ORDER BY a.asset_id, a.priority ASC, a.sort_order ASC;
$$;
