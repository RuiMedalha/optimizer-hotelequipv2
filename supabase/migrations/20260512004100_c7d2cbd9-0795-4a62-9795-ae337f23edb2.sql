DROP FUNCTION IF EXISTS public.get_products_page(uuid,text,text,text,text,text,text,integer,integer,text);

CREATE OR REPLACE FUNCTION public.get_products_page(
    _workspace_id uuid,
    _search text DEFAULT '',
    _status text DEFAULT 'all',
    _category text DEFAULT 'all',
    _product_type text DEFAULT 'all',
    _source_file text DEFAULT 'all',
    _woo_filter text DEFAULT 'all',
    _page integer DEFAULT 1,
    _page_size integer DEFAULT 100,
    _image_status text DEFAULT 'all'
)
RETURNS SETOF json
LANGUAGE plpgsql
AS $$
DECLARE
  _offset INT;
BEGIN
  _offset := (_page - 1) * _page_size;

  RETURN QUERY
  WITH filtered_products AS (
    SELECT 
      p.*,
      COUNT(*) OVER() as total_count
    FROM products p
    WHERE p.workspace_id = _workspace_id
      AND (
        _search = '' OR 
        p.original_title ILIKE '%' || _search || '%' OR 
        p.optimized_title ILIKE '%' || _search || '%' OR 
        p.sku ILIKE '%' || _search || '%'
      )
      AND (
        (_status = 'all' AND p.is_discontinued = false) OR 
        (_status = 'discontinued' AND p.is_discontinued = true) OR
        (_status NOT IN ('all', 'discontinued') AND p.status::text = _status AND p.is_discontinued = false)
      )
      AND (_category = 'all' OR p.category = _category)
      AND (_product_type = 'all' OR p.product_type = _product_type)
      AND (_source_file = 'all' OR p.source_file = _source_file)
      AND (
        _woo_filter = 'all' OR 
        (_woo_filter = 'published' AND p.woocommerce_id IS NOT NULL) OR 
        (_woo_filter = 'not_published' AND p.woocommerce_id IS NULL)
      )
      AND (
        _image_status = 'all' OR 
        (_image_status = 'failed' AND p.image_status = 'failed') OR
        (_image_status = 'missing' AND p.image_status = 'missing') OR
        (_image_status = 'any_issue' AND p.image_status IN ('failed', 'missing'))
      )
    ORDER BY p.updated_at DESC
    LIMIT _page_size
    OFFSET _offset
  )
  SELECT row_to_json(fp) FROM filtered_products fp;
END;
$$;