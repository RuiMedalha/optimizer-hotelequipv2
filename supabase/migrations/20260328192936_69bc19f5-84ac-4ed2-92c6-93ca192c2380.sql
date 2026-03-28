-- Add missing columns to ai_usage_logs for usage-logger.ts
ALTER TABLE public.ai_usage_logs
  ADD COLUMN IF NOT EXISTS task_type text,
  ADD COLUMN IF NOT EXISTS capability text,
  ADD COLUMN IF NOT EXISTS provider_id text,
  ADD COLUMN IF NOT EXISTS decision_source text,
  ADD COLUMN IF NOT EXISTS latency_ms integer,
  ADD COLUMN IF NOT EXISTS error_category text,
  ADD COLUMN IF NOT EXISTS is_shadow boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS prompt_version_id text,
  ADD COLUMN IF NOT EXISTS fallback_used boolean DEFAULT false;

-- Add missing columns to optimization_logs for optimize-product function
ALTER TABLE public.optimization_logs
  ADD COLUMN IF NOT EXISTS requested_model text,
  ADD COLUMN IF NOT EXISTS used_provider text,
  ADD COLUMN IF NOT EXISTS fallback_used boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS fallback_reason text,
  ADD COLUMN IF NOT EXISTS prompt_version_id text;