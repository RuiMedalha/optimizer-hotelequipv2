-- Drop existing functions to change return types
DROP FUNCTION IF EXISTS public.get_products_page(uuid, text, text, text, text, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.get_product_filter_options(uuid);
DROP FUNCTION IF EXISTS public.get_product_stats(uuid);

-- Function to get paginated products with filters
CREATE OR REPLACE FUNCTION public.get_products_page(
  _workspace_id UUID,
  _search TEXT DEFAULT '',
  _status TEXT DEFAULT 'all',
  _category TEXT DEFAULT 'all',
  _product_type TEXT DEFAULT 'all',
  _source_file TEXT DEFAULT 'all',
  _woo_filter TEXT DEFAULT 'all',
  _page INTEGER DEFAULT 1,
  _page_size INTEGER DEFAULT 100
)
RETURNS SETOF JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _offset INTEGER;
  _total_count BIGINT;
BEGIN
  _offset := (_page - 1) * _page_size;

  -- Get total count for the filtered query
  SELECT COUNT(*)
  INTO _total_count
  FROM products p
  WHERE p.workspace_id = _workspace_id
    AND (
      _search = '' OR 
      p.sku ILIKE '%' || _search || '%' OR 
      p.original_title ILIKE '%' || _search || '%' OR 
      p.optimized_title ILIKE '%' || _search || '%'
    )
    AND (
      _status = 'all' OR 
      p.status = _status::product_status
    )
    AND (
      _category = 'all' OR 
      p.category = _category
    )
    AND (
      _product_type = 'all' OR 
      p.product_type = _product_type
    )
    AND (
      _source_file = 'all' OR 
      p.source_file = _source_file
    )
    AND (
      _woo_filter = 'all' OR 
      (_woo_filter = 'published' AND p.woocommerce_id IS NOT NULL) OR 
      (_woo_filter = 'not_published' AND p.woocommerce_id IS NULL)
    );

  RETURN QUERY
  SELECT 
    to_jsonb(p.*) || jsonb_build_object('total_count', _total_count)
  FROM products p
  WHERE p.workspace_id = _workspace_id
    AND (
      _search = '' OR 
      p.sku ILIKE '%' || _search || '%' OR 
      p.original_title ILIKE '%' || _search || '%' OR 
      p.optimized_title ILIKE '%' || _search || '%'
    )
    AND (
      _status = 'all' OR 
      p.status = _status::product_status
    )
    AND (
      _category = 'all' OR 
      p.category = _category
    )
    AND (
      _product_type = 'all' OR 
      p.product_type = _product_type
    )
    AND (
      _source_file = 'all' OR 
      p.source_file = _source_file
    )
    AND (
      _woo_filter = 'all' OR 
      (_woo_filter = 'published' AND p.woocommerce_id IS NOT NULL) OR 
      (_woo_filter = 'not_published' AND p.woocommerce_id IS NULL)
    )
  ORDER BY p.updated_at DESC
  LIMIT _page_size
  OFFSET _offset;
END;
$$;

-- Function to get unique filter options
CREATE OR REPLACE FUNCTION public.get_product_filter_options(_workspace_id UUID)
RETURNS TABLE (filter_type TEXT, filter_value TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 'category'::TEXT, category
  FROM (
    SELECT DISTINCT category 
    FROM products 
    WHERE workspace_id = _workspace_id AND category IS NOT NULL
  ) c
  UNION ALL
  SELECT 'source_file'::TEXT, source_file
  FROM (
    SELECT DISTINCT source_file 
    FROM products 
    WHERE workspace_id = _workspace_id AND source_file IS NOT NULL
  ) s;
END;
$$;

-- Function to get product status statistics
CREATE OR REPLACE FUNCTION public.get_product_stats(_workspace_id UUID)
RETURNS TABLE (status TEXT, count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT p.status::TEXT, COUNT(*)
  FROM products p
  WHERE (_workspace_id IS NULL OR p.workspace_id = _workspace_id)
  GROUP BY p.status;
END;
$$;
