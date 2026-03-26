-- Add metadata JSONB column to ai_model_pricing.
-- Stores per-model guidance: best_for, strengths, speed_tier, quality_tier, cost_tier.
-- Seeded by 20260320000004_seed_ai_model_pricing_v2.sql.

ALTER TABLE ai_model_pricing
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
