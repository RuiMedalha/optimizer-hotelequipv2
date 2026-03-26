-- Add 4 tracing columns to optimization_logs.
-- These are already written by optimize-product/index.ts (lines 1801-1804)
-- but were never created, causing the entire insert to fail silently.
-- Idempotent (ADD COLUMN IF NOT EXISTS).

ALTER TABLE public.optimization_logs
  ADD COLUMN IF NOT EXISTS requested_model text,
  ADD COLUMN IF NOT EXISTS used_provider text,
  ADD COLUMN IF NOT EXISTS fallback_used boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS fallback_reason text;
