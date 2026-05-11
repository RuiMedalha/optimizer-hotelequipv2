CREATE OR REPLACE FUNCTION get_products_page(
  _workspace_id UUID,
  _search TEXT DEFAULT '',
  _status TEXT DEFAULT 'all',
  _category TEXT DEFAULT 'all',
  _product_type TEXT DEFAULT 'all',
  _source_file TEXT DEFAULT 'all',
  _woo_filter TEXT DEFAULT 'all',
  _page INT DEFAULT 1,
  _page_size INT DEFAULT 100,
  _image_status TEXT DEFAULT 'all'
) RETURNS SETOF JSON AS $$
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
      AND (_status = 'all' OR p.status::text = _status)
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
$$ LANGUAGE plpgsql;