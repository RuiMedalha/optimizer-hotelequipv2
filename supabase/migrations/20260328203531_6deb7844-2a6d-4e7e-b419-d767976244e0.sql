
-- Update existing Gemini models with correct pricing from Google's official pricing page
UPDATE public.ai_model_catalog SET 
  cost_input_per_mtok = 0.30,
  cost_output_per_mtok = 2.50
WHERE model_id = 'gemini-2.5-flash';

UPDATE public.ai_model_catalog SET 
  cost_input_per_mtok = 0.10,
  cost_output_per_mtok = 0.40
WHERE model_id = 'gemini-2.5-flash-lite';

-- gemini-2.0-flash and gemini-2.5-pro are already correct

-- Add new Gemini 3.x models and image models
-- Using workspace from existing records
INSERT INTO public.ai_model_catalog (
  model_id, display_name, provider_type, 
  cost_input_per_mtok, cost_output_per_mtok,
  supports_text, supports_vision, supports_tool_calls, supports_structured_output, supports_json_schema,
  speed_rating, accuracy_rating, max_context_tokens, is_global, workspace_id
)
SELECT 
  v.model_id, v.display_name, 'gemini_direct',
  v.cost_in, v.cost_out,
  v.supports_text, v.supports_vision, v.supports_tool_calls, v.supports_structured, v.supports_json,
  v.speed, v.accuracy, v.max_ctx, false, 
  (SELECT workspace_id FROM public.ai_model_catalog WHERE model_id = 'gemini-2.5-flash' LIMIT 1)
FROM (VALUES
  ('gemini-3-flash-preview', 'Gemini 3 Flash', 0.50, 3.00, true, true, true, true, true, 9, 9, 1000000),
  ('gemini-3.1-pro-preview', 'Gemini 3.1 Pro', 2.00, 12.00, true, true, true, true, true, 7, 10, 1000000),
  ('gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash Lite', 0.25, 1.50, true, true, true, true, true, 10, 7, 1000000),
  ('gemini-2.5-flash-image', 'Gemini 2.5 Flash Image', 0.30, 30.00, true, true, false, false, false, 8, 8, 1000000),
  ('gemini-3-pro-image-preview', 'Gemini 3 Pro Image', 2.00, 120.00, true, true, false, false, false, 6, 10, 1000000),
  ('gemini-3.1-flash-image-preview', 'Gemini 3.1 Flash Image', 0.50, 60.00, true, true, false, false, false, 8, 9, 1000000)
) AS v(model_id, display_name, cost_in, cost_out, supports_text, supports_vision, supports_tool_calls, supports_structured, supports_json, speed, accuracy, max_ctx)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_model_catalog c WHERE c.model_id = v.model_id
);
