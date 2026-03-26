-- Seed ai_model_pricing with all models currently active in this project.
-- Prices are per 1M tokens in USD as of 2026-03-20.
-- model_id matches ai_model_catalog.model_id and ai_usage_logs.model_name exactly.
-- Idempotent: ON CONFLICT DO UPDATE.

INSERT INTO ai_model_pricing
  (provider_id, model_id, display_name,
   input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m,
   currency, effective_from, is_active, source_url, notes)
VALUES

  -- ── Anthropic ────────────────────────────────────────────────────────────
  ('anthropic', 'claude-sonnet-4-6', 'Claude Sonnet 4.6',
   3.00, 15.00, 0.30,
   'USD', '2026-03-20', true,
   'https://www.anthropic.com/pricing',
   'Primary model for content_generation, reasoning, extraction'),

  ('anthropic', 'claude-haiku-4-5-20251001', 'Claude Haiku 4.5',
   1.00, 5.00, 0.10,
   'USD', '2026-03-20', true,
   'https://www.anthropic.com/pricing',
   'Fast model for seo_generation, translation, summarization'),

  ('anthropic', 'claude-opus-4-6', 'Claude Opus 4.6',
   15.00, 75.00, 1.50,
   'USD', '2026-03-20', true,
   'https://www.anthropic.com/pricing',
   'Highest capability model for complex reasoning'),

  -- ── OpenAI ───────────────────────────────────────────────────────────────
  ('openai', 'gpt-4o', 'GPT-4o',
   5.00, 15.00, 2.50,
   'USD', '2026-03-20', true,
   'https://openai.com/api/pricing/',
   'Primary OpenAI model for extraction, multimodal vision'),

  ('openai', 'gpt-4o-mini', 'GPT-4o Mini',
   0.15, 0.60, 0.075,
   'USD', '2026-03-20', true,
   'https://openai.com/api/pricing/',
   'Fast/cheap model for classification, seo_generation'),

  -- ── Google Gemini ─────────────────────────────────────────────────────────
  ('gemini', 'gemini-2.5-pro', 'Gemini 2.5 Pro',
   1.25, 10.00, null,
   'USD', '2026-03-20', true,
   'https://ai.google.dev/pricing',
   'Primary Gemini model for web_research, reasoning. Pricing for ≤200k context.'),

  ('gemini', 'gemini-2.5-flash', 'Gemini 2.5 Flash',
   0.15, 0.60, null,
   'USD', '2026-03-20', true,
   'https://ai.google.dev/pricing',
   'Fast Gemini model for multimodal_vision, enrichment'),

  -- ── Legacy / alias entries used by optimize-product MODEL_MAP ─────────────
  -- optimize-product stores model names like "google/gemini-2.5-flash" in
  -- optimization_logs.model. These rows allow cost lookup for those old-format names.
  ('gemini', 'google/gemini-2.5-flash', 'Gemini 2.5 Flash (legacy alias)',
   0.15, 0.60, null,
   'USD', '2026-03-20', true, null,
   'Legacy alias: optimization_logs.model stores google/-prefixed names'),

  ('gemini', 'google/gemini-2.5-pro', 'Gemini 2.5 Pro (legacy alias)',
   1.25, 10.00, null,
   'USD', '2026-03-20', true, null,
   'Legacy alias: optimization_logs.model stores google/-prefixed names'),

  ('openai', 'openai/gpt-4o', 'GPT-4o (legacy alias)',
   5.00, 15.00, 2.50,
   'USD', '2026-03-20', true, null,
   'Legacy alias: optimization_logs.model stores openai/-prefixed names'),

  ('openai', 'openai/gpt-4o-mini', 'GPT-4o Mini (legacy alias)',
   0.15, 0.60, 0.075,
   'USD', '2026-03-20', true, null,
   'Legacy alias: optimization_logs.model stores openai/-prefixed names')

ON CONFLICT (provider_id, model_id, effective_from) DO UPDATE SET
  display_name             = EXCLUDED.display_name,
  input_cost_per_1m        = EXCLUDED.input_cost_per_1m,
  output_cost_per_1m       = EXCLUDED.output_cost_per_1m,
  cached_input_cost_per_1m = EXCLUDED.cached_input_cost_per_1m,
  is_active                = EXCLUDED.is_active,
  source_url               = EXCLUDED.source_url,
  notes                    = EXCLUDED.notes,
  updated_at               = now();
