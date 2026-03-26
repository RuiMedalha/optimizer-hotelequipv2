-- Migration 3: extend ai_usage_logs with new observability columns
-- Additive only — all columns nullable with safe defaults.

ALTER TABLE ai_usage_logs
  ADD COLUMN IF NOT EXISTS task_type       TEXT,
  ADD COLUMN IF NOT EXISTS capability      TEXT,
  ADD COLUMN IF NOT EXISTS provider_id     TEXT,
  ADD COLUMN IF NOT EXISTS fallback_used   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS decision_source TEXT,
  ADD COLUMN IF NOT EXISTS latency_ms      INT,
  ADD COLUMN IF NOT EXISTS error_category  TEXT,
  ADD COLUMN IF NOT EXISTS is_shadow       BOOLEAN DEFAULT FALSE;

-- is_shadow: marks calls made during AI_ROUTER_SHADOW_MODE=true.
-- Use for cost analysis and confirming zero shadow traffic before
-- decommissioning a provider (Phase 4 gate).
