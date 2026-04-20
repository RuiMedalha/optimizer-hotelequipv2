UPDATE public.ai_routing_rules
SET task_type = 'uso_profissional_generation'
WHERE task_type = 'uso_profissional'
  AND display_name = 'Uso Profissional (HORECA Editorial)';