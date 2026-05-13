-- Update get_product_stats to return is_discontinued status
DROP FUNCTION IF EXISTS public.get_product_stats(uuid);

CREATE OR REPLACE FUNCTION public.get_product_stats(_workspace_id uuid)
 RETURNS TABLE(status text, count bigint, publishability_decision text, is_discontinued boolean)
 LANGUAGE sql
AS $function$
  SELECT 
    status::text, 
    COUNT(*), 
    COALESCE(publishability_decision, 'null'),
    is_discontinued
  FROM products
  WHERE workspace_id = _workspace_id
  GROUP BY status, publishability_decision, is_discontinued;
$function$;