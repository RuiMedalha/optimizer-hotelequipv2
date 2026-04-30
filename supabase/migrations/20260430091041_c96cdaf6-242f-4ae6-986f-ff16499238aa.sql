-- Update get_products_page to handle is_discontinued
CREATE OR REPLACE FUNCTION public.get_products_page(_workspace_id uuid, _search text DEFAULT ''::text, _status text DEFAULT 'all'::text, _category text DEFAULT 'all'::text, _product_type text DEFAULT 'all'::text, _source_file text DEFAULT 'all'::text, _woo_filter text DEFAULT 'all'::text, _page integer DEFAULT 1, _page_size integer DEFAULT 100)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      (_status = 'all' AND p.is_discontinued = false) OR 
      (_status = 'discontinued' AND p.is_discontinued = true) OR
      (p.status = _status::product_status AND p.is_discontinued = false)
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
      (_status = 'all' AND p.is_discontinued = false) OR 
      (_status = 'discontinued' AND p.is_discontinued = true) OR
      (p.status = _status::product_status AND p.is_discontinued = false)
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
$function$;

-- Update get_product_stats to handle is_discontinued
CREATE OR REPLACE FUNCTION public.get_product_stats(_workspace_id uuid)
 RETURNS TABLE(status text, count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    'discontinued'::text as status,
    COUNT(*) as count
  FROM products p
  WHERE p.workspace_id = _workspace_id AND p.is_discontinued = true
  UNION ALL
  SELECT 
    p.status::text,
    COUNT(*) as count
  FROM products p
  WHERE p.workspace_id = _workspace_id AND p.is_discontinued = false
  GROUP BY p.status;
END;
$function$;
