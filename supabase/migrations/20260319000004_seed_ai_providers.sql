-- Migration 4: seed ai_provider_registry and ai_model_catalog
-- Idempotent — safe to re-run. Uses ON CONFLICT DO UPDATE / DO NOTHING.

-- ── Provider registry ──────────────────────────────────────────────────────

INSERT INTO ai_provider_registry
  (id, display_name, api_base_url, api_key_env_var, auth_scheme, request_format, enabled, is_legacy, priority)
VALUES
  ('anthropic',
   'Anthropic (Claude)',
   'https://api.anthropic.com/v1/messages',
   'ANTHROPIC_API_KEY', 'x-api-key', 'anthropic',
   true, false, 1),

  ('openai',
   'OpenAI',
   'https://api.openai.com/v1/chat/completions',
   'OPENAI_API_KEY', 'bearer', 'openai_compatible',
   true, false, 2),

  ('gemini',
   'Google Gemini',
   'https://generativelanguage.googleapis.com/v1beta',
   'GEMINI_API_KEY', 'query_param', 'gemini',
   true, false, 3),

  ('mistral',
   'Mistral',
   'https://api.mistral.ai/v1/chat/completions',
   'MISTRAL_API_KEY', 'bearer', 'openai_compatible',
   false, false, 10),

  ('perplexity',
   'Perplexity',
   'https://api.perplexity.ai/chat/completions',
   'PERPLEXITY_API_KEY', 'bearer', 'openai_compatible',
   false, false, 11),

  ('deepseek',
   'DeepSeek',
   'https://api.deepseek.com/v1/chat/completions',
   'DEEPSEEK_API_KEY', 'bearer', 'openai_compatible',
   false, false, 12),

  ('grok',
   'Grok (xAI)',
   'https://api.x.ai/v1/chat/completions',
   'GROK_API_KEY', 'bearer', 'openai_compatible',
   false, false, 13),

  ('lovable_gateway',
   'Lovable Gateway',
   'https://ai.gateway.lovable.dev/v1/chat/completions',
   'LOVABLE_API_KEY', 'bearer', 'openai_compatible',
   false, true, 99)

ON CONFLICT (id) DO UPDATE SET
  enabled    = EXCLUDED.enabled,
  is_legacy  = EXCLUDED.is_legacy,
  updated_at = now();

-- ── Model catalog ──────────────────────────────────────────────────────────

INSERT INTO ai_model_catalog
  (provider_id, model_id, display_name,
   context_window, max_output_tokens,
   supports_vision, supports_function_calling, supports_json_mode,
   input_cost_per_1k, output_cost_per_1k,
   status, recommended_for, enabled)
VALUES
  -- Anthropic
  ('anthropic', 'claude-sonnet-4-6', 'Claude Sonnet 4.6',
   200000, 8192, true,  true,  false, 0.003,   0.015,
   'active', ARRAY['content_generation','reasoning','extraction'], true),

  ('anthropic', 'claude-haiku-4-5-20251001', 'Claude Haiku 4.5',
   200000, 8192, false, true,  false, 0.001,   0.005,
   'active', ARRAY['seo_generation','translation','summarization'], true),

  ('anthropic', 'claude-opus-4-6', 'Claude Opus 4.6',
   200000, 4096, true,  true,  false, 0.015,   0.075,
   'active', ARRAY['reasoning'], true),

  -- OpenAI
  ('openai', 'gpt-4o', 'GPT-4o',
   128000, 4096, true,  true,  true,  0.005,   0.015,
   'active', ARRAY['extraction','reasoning','multimodal_vision'], true),

  ('openai', 'gpt-4o-mini', 'GPT-4o Mini',
   128000, 4096, false, true,  true,  0.00015, 0.0006,
   'active', ARRAY['classification','seo_generation'], true),

  -- Gemini
  ('gemini', 'gemini-2.5-pro', 'Gemini 2.5 Pro',
   1000000, 8192, true, true, true,  0.00125, 0.005,
   'active', ARRAY['web_research','reasoning'], true),

  ('gemini', 'gemini-2.5-flash', 'Gemini 2.5 Flash',
   1000000, 8192, true, true, true,  0.00015, 0.0006,
   'active', ARRAY['multimodal_vision','enrichment'], true),

  ('gemini', 'gemini-1.5-pro', 'Gemini 1.5 Pro (Legacy)',
   1000000, 8192, true, true, true,  0.00125, 0.005,
   'deprecated', ARRAY[]::TEXT[], false),

  -- Mistral (prepared — enabled=false)
  ('mistral', 'mistral-large-latest', 'Mistral Large',
   131072, 4096, false, true, true,  0.003,   0.009,
   'active', ARRAY['content_generation'], false),

  ('mistral', 'mistral-small-latest', 'Mistral Small',
   131072, 4096, false, true, true,  0.001,   0.003,
   'active', ARRAY['classification'], false),

  -- Perplexity (prepared — enabled=false)
  ('perplexity', 'sonar-pro', 'Sonar Pro',
   200000, 8000, false, false, false, 0.003,  0.015,
   'active', ARRAY['web_research'], false),

  ('perplexity', 'sonar', 'Sonar',
   127072, 8000, false, false, false, 0.001,  0.001,
   'active', ARRAY['web_research'], false),

  -- DeepSeek (prepared — enabled=false)
  ('deepseek', 'deepseek-chat', 'DeepSeek Chat',
   64000, 4096, false, false, true,  0.00014, 0.00028,
   'active', ARRAY['content_generation'], false),

  ('deepseek', 'deepseek-reasoner', 'DeepSeek Reasoner',
   64000, 4096, false, false, true,  0.00055, 0.00219,
   'active', ARRAY['reasoning'], false),

  -- Grok (prepared — enabled=false)
  ('grok', 'grok-2', 'Grok 2',
   131072, 4096, true, true, false,  0.002,   0.010,
   'active', ARRAY['reasoning'], false)

ON CONFLICT (provider_id, model_id) DO NOTHING;
