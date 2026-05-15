CREATE OR REPLACE FUNCTION public.get_products_page(
  _workspace_id uuid,
  _search text DEFAULT ''::text,
  _status text DEFAULT 'all'::text,
  _category text DEFAULT 'all'::text,
  _product_type text DEFAULT 'all'::text,
  _source_file text DEFAULT 'all'::text,
  _woo_filter text DEFAULT 'all'::text,
  _image_status text DEFAULT 'all'::text,
  _publishability_decision text DEFAULT 'all'::text,
  _page integer DEFAULT 1,
  _page_size integer DEFAULT 100,
  _published_to_url text DEFAULT 'all'::text
)
 RETURNS SETOF record
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  _offset integer;
BEGIN
  _offset := (_page - 1) * _page_size;

  RETURN QUERY
  SELECT 
    p.*,
    COUNT(*) OVER() as total_count
  FROM products p
  WHERE p.workspace_id = _workspace_id
    AND (_search = '' OR (
      p.original_title ILIKE '%' || _search || '%' OR 
      p.optimized_title ILIKE '%' || _search || '%' OR 
      p.sku ILIKE '%' || _search || '%'
    ))
    AND (
      _status = 'all' OR 
      (_status = 'discontinued' AND p.is_discontinued = true) OR 
      (_status != 'discontinued' AND p.status = _status::product_status AND p.is_discontinued = false)
    )
    AND (_category = 'all' OR p.category = _category OR p.suggested_category = _category)
    AND (_product_type = 'all' OR p.product_type = _product_type::product_type)
    AND (_source_file = 'all' OR p.source_file = _source_file)
    AND (_publishability_decision = 'all' OR p.publishability_decision = _publishability_decision::publish_decision)
    AND (
      _published_to_url = 'all' OR 
      p.published_to_url = _published_to_url
    )
    AND (
      _image_status = 'all' OR 
      (_image_status = 'ok' AND p.image_status = 'ok') OR
      (_image_status = 'failed' AND p.image_status = 'failed') OR
      (_image_status = 'missing' AND p.image_status = 'missing') OR
      (_image_status = 'any_issue' AND (p.image_status = 'failed' OR p.image_status = 'missing'))
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