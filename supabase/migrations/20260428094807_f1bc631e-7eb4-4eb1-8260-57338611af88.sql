-- 1. Converter atributos que não são arrays para arrays vazios no workspace Clima
UPDATE public.products 
SET attributes = '[]'::jsonb 
WHERE workspace_id = 'f9a73174-9b0c-4b0c-a2b0-a1e9adc0141f' 
AND (jsonb_typeof(attributes) != 'array' OR attributes IS NULL);

-- 2. Limpeza adicional de campos que podem estar com dados inconsistentes após cancelamento
UPDATE public.products
SET 
  validation_errors = NULL,
  locked_for_publish = false
WHERE workspace_id = 'f9a73174-9b0c-4b0c-a2b0-a1e9adc0141f'
AND status = 'published';
