
-- Add prompt_source column to optimization_logs for transparency
ALTER TABLE public.optimization_logs ADD COLUMN IF NOT EXISTS prompt_source TEXT;
