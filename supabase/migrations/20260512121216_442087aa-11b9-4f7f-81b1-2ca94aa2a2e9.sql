UPDATE products
SET min_order_quantity = CAST(
  source_confidence_profile->'meta_data'->>'_min_purchase_quantity' 
  AS integer
)
WHERE source_confidence_profile->'meta_data'->>'_min_purchase_quantity' IS NOT NULL
AND (min_order_quantity IS NULL OR min_order_quantity = 1);

UPDATE products
SET min_order_quantity = CAST(
  (regexp_match(original_description, 
    'QUANTIDADE\s+M[IÍ]NIMA[^:]*:\s*(\d+)')
  )[1] AS integer
)
WHERE original_description ~* 'QUANTIDADE\s+M[IÍ]NIMA'
AND (min_order_quantity IS NULL OR min_order_quantity = 1);

UPDATE products
SET min_order_quantity = CAST(
  (regexp_match(short_description, 
    'QUANTIDADE\s+M[IÍ]NIMA[^:]*:\s*(\d+)')
  )[1] AS integer
)
WHERE short_description ~* 'QUANTIDADE\s+M[IÍ]NIMA'
AND (min_order_quantity IS NULL OR min_order_quantity = 1);

SELECT COUNT(*) as total, min_order_quantity 
FROM products 
WHERE min_order_quantity > 1 
GROUP BY min_order_quantity 
ORDER BY min_order_quantity;