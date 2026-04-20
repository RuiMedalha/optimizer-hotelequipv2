UPDATE public.optimization_jobs 
SET status = 'queued', 
    updated_at = NOW(), 
    current_product_name = NULL 
WHERE id = '3cc31a51-9eec-4790-aee2-3dd99492b274' 
  AND status = 'processing';