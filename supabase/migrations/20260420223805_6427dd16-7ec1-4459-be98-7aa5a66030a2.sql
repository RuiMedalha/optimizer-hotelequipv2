INSERT INTO public.ai_routing_rules (
  task_type,
  display_name,
  model_override,
  recommended_model,
  fallback_model,
  workspace_id,
  is_active,
  execution_priority
) VALUES (
  'uso_profissional',
  'Uso Profissional (HORECA Editorial)',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',
  NULL,
  true,
  100
);