-- Seed v2: adds previously missing models + sets metadata on all rows.
-- Missing models were written to optimization_logs/ai_usage_logs but had no
-- pricing entry, causing "sem preço" in the dashboard.
--
-- New rows:
--   gemini-2.5-flash-lite     — used in optimize-product MODEL_MAP (lines 715, 1513)
--   gemini-3-flash-preview    — default fallback in optimize-product MODEL_MAP
--   gemini-3-pro-preview      — in optimize-product MODEL_MAP
--   gemini-3.1-flash-image-preview — used in process-product-images
--   claude-3-5-sonnet-20241022 — system fallback in provider-registry.ts
--
-- Prices are per 1M tokens (USD). Preview/lite models use Google's published
-- preview pricing tiers; claude-3-5-sonnet uses Anthropic published pricing.
-- Idempotent: ON CONFLICT DO UPDATE.

INSERT INTO ai_model_pricing
  (provider_id, model_id, display_name,
   input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m,
   currency, effective_from, is_active, source_url, notes, metadata)
VALUES

  -- ── Anthropic ────────────────────────────────────────────────────────────
  ('anthropic', 'claude-sonnet-4-6', 'Claude Sonnet 4.6',
   3.00, 15.00, 0.30,
   'USD', '2026-03-20', true,
   'https://www.anthropic.com/pricing',
   'Primary model for content_generation, reasoning, extraction',
   '{"best_for":"Geração de conteúdo, raciocínio, extração estruturada","strengths":["Instruções complexas","Texto estruturado","Seguimento de formato"],"speed_tier":"medium","quality_tier":"high","cost_tier":"medium","recommended_tasks":["content_generation","reasoning","extraction"]}'),

  ('anthropic', 'claude-haiku-4-5-20251001', 'Claude Haiku 4.5',
   1.00, 5.00, 0.10,
   'USD', '2026-03-20', true,
   'https://www.anthropic.com/pricing',
   'Fast model for seo_generation, translation, summarization',
   '{"best_for":"SEO, tradução, sumarização rápida","strengths":["Velocidade","Custo baixo","Volume alto"],"speed_tier":"fast","quality_tier":"standard","cost_tier":"cheap","recommended_tasks":["seo_generation","translation","summarization"]}'),

  ('anthropic', 'claude-opus-4-6', 'Claude Opus 4.6',
   15.00, 75.00, 1.50,
   'USD', '2026-03-20', true,
   'https://www.anthropic.com/pricing',
   'Highest capability model for complex reasoning',
   '{"best_for":"Raciocínio avançado, análise profunda","strengths":["Qualidade máxima","Lógica complexa","Análise detalhada"],"speed_tier":"slow","quality_tier":"premium","cost_tier":"expensive","recommended_tasks":["reasoning","complex_analysis"]}'),

  -- Legacy: provider-registry.ts fallback still uses this ID
  ('anthropic', 'claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet (legado)',
   3.00, 15.00, 0.30,
   'USD', '2026-03-20', true,
   'https://www.anthropic.com/pricing',
   'Legacy fallback ID used by provider-registry.ts; prefer claude-sonnet-4-6',
   '{"best_for":"Fallback de raciocínio (modelo legado)","strengths":["Raciocínio","Texto"],"speed_tier":"medium","quality_tier":"high","cost_tier":"medium","recommended_tasks":["reasoning","content_generation"]}'),

  -- ── OpenAI ───────────────────────────────────────────────────────────────
  ('openai', 'gpt-4o', 'GPT-4o',
   5.00, 15.00, 2.50,
   'USD', '2026-03-20', true,
   'https://openai.com/api/pricing/',
   'Primary OpenAI model for extraction, multimodal vision',
   '{"best_for":"Extração, visão multimodal, pesquisa web","strengths":["Multimodal","Instruções precisas","Extração estruturada"],"speed_tier":"medium","quality_tier":"high","cost_tier":"medium","recommended_tasks":["extraction","multimodal_vision","web_research"]}'),

  ('openai', 'gpt-4o-mini', 'GPT-4o Mini',
   0.15, 0.60, 0.075,
   'USD', '2026-03-20', true,
   'https://openai.com/api/pricing/',
   'Fast/cheap model for classification, seo_generation',
   '{"best_for":"Classificação, SEO, tarefas de alto volume","strengths":["Velocidade","Custo mínimo","Volume alto"],"speed_tier":"fast","quality_tier":"standard","cost_tier":"cheap","recommended_tasks":["classification","seo_generation"]}'),

  -- ── Google Gemini ─────────────────────────────────────────────────────────
  ('gemini', 'gemini-2.5-pro', 'Gemini 2.5 Pro',
   1.25, 10.00, null,
   'USD', '2026-03-20', true,
   'https://ai.google.dev/pricing',
   'Primary Gemini model for web_research, reasoning. Pricing for ≤200k context.',
   '{"best_for":"Pesquisa web, contexto longo, raciocínio","strengths":["Contexto de 1M tokens","Raciocínio multimodal","Pesquisa avançada"],"speed_tier":"medium","quality_tier":"premium","cost_tier":"medium","recommended_tasks":["web_research","reasoning","long_context"]}'),

  ('gemini', 'gemini-2.5-flash', 'Gemini 2.5 Flash',
   0.15, 0.60, null,
   'USD', '2026-03-20', true,
   'https://ai.google.dev/pricing',
   'Fast Gemini model for multimodal_vision, enrichment',
   '{"best_for":"Enriquecimento, visão, sumarização rápida","strengths":["Rápido","Multimodal","Contexto longo"],"speed_tier":"fast","quality_tier":"high","cost_tier":"cheap","recommended_tasks":["multimodal_vision","enrichment","summarization"]}'),

  -- NEW: used in optimize-product MODEL_MAP (lines 715, 1513)
  ('gemini', 'gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite',
   0.10, 0.40, null,
   'USD', '2026-03-20', true,
   'https://ai.google.dev/pricing',
   'Lightest Gemini variant; used for high-volume simple tasks',
   '{"best_for":"Tarefas simples, classificação, alto volume","strengths":["Ultra-rápido","Custo mínimo","Throughput máximo"],"speed_tier":"fast","quality_tier":"standard","cost_tier":"cheap","recommended_tasks":["classification","seo_generation","summarization"]}'),

  -- NEW: default fallback in optimize-product MODEL_MAP
  ('gemini', 'gemini-3-flash-preview', 'Gemini 3 Flash (preview)',
   0.15, 0.60, null,
   'USD', '2026-03-20', true,
   'https://ai.google.dev/pricing',
   'Preview pricing; verify at ai.google.dev/pricing when GA. Default fallback in optimize-product.',
   '{"best_for":"Otimização de produtos, geração rápida","strengths":["Velocidade","Qualidade melhorada vs 2.5 Flash"],"speed_tier":"fast","quality_tier":"high","cost_tier":"cheap","recommended_tasks":["content_generation","enrichment"]}'),

  -- NEW: in optimize-product MODEL_MAP
  ('gemini', 'gemini-3-pro-preview', 'Gemini 3 Pro (preview)',
   1.25, 10.00, null,
   'USD', '2026-03-20', true,
   'https://ai.google.dev/pricing',
   'Preview pricing; verify at ai.google.dev/pricing when GA.',
   '{"best_for":"Raciocínio avançado, contexto longo","strengths":["Qualidade máxima","Contexto enorme","Raciocínio"],"speed_tier":"medium","quality_tier":"premium","cost_tier":"medium","recommended_tasks":["reasoning","web_research","long_context"]}'),

  -- NEW: used in process-product-images
  ('gemini', 'gemini-3.1-flash-image-preview', 'Gemini 3.1 Flash Image (preview)',
   0.15, 0.60, null,
   'USD', '2026-03-20', true,
   'https://ai.google.dev/pricing',
   'Vision/image specialized preview model; used by process-product-images.',
   '{"best_for":"Processamento de imagens, análise visual de produtos","strengths":["Multimodal","Análise de imagem","Geração alt-text"],"speed_tier":"fast","quality_tier":"high","cost_tier":"cheap","recommended_tasks":["multimodal_vision","image_processing"]}'),

  -- ── Legacy / alias entries ─────────────────────────────────────────────────
  ('gemini', 'google/gemini-2.5-flash', 'Gemini 2.5 Flash (legacy alias)',
   0.15, 0.60, null,
   'USD', '2026-03-20', true, null,
   'Legacy alias: optimization_logs.model stores google/-prefixed names',
   '{"best_for":"Enriquecimento, visão, sumarização rápida","strengths":["Rápido","Multimodal"],"speed_tier":"fast","quality_tier":"high","cost_tier":"cheap","recommended_tasks":["multimodal_vision","enrichment"]}'),

  ('gemini', 'google/gemini-2.5-pro', 'Gemini 2.5 Pro (legacy alias)',
   1.25, 10.00, null,
   'USD', '2026-03-20', true, null,
   'Legacy alias: optimization_logs.model stores google/-prefixed names',
   '{"best_for":"Pesquisa web, contexto longo, raciocínio","strengths":["Contexto de 1M tokens","Raciocínio"],"speed_tier":"medium","quality_tier":"premium","cost_tier":"medium","recommended_tasks":["web_research","reasoning"]}'),

  ('gemini', 'google/gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite (legacy alias)',
   0.10, 0.40, null,
   'USD', '2026-03-20', true, null,
   'Legacy alias: optimization_logs.model stores google/-prefixed names',
   '{"best_for":"Tarefas simples, classificação, alto volume","strengths":["Ultra-rápido","Custo mínimo"],"speed_tier":"fast","quality_tier":"standard","cost_tier":"cheap","recommended_tasks":["classification","seo_generation"]}'),

  ('gemini', 'google/gemini-3-flash-preview', 'Gemini 3 Flash Preview (legacy alias)',
   0.15, 0.60, null,
   'USD', '2026-03-20', true, null,
   'Legacy alias: optimize-product MODEL_MAP stores google/-prefixed names',
   '{"best_for":"Otimização de produtos, geração rápida","strengths":["Velocidade","Qualidade melhorada"],"speed_tier":"fast","quality_tier":"high","cost_tier":"cheap","recommended_tasks":["content_generation","enrichment"]}'),

  ('gemini', 'google/gemini-3-pro-preview', 'Gemini 3 Pro Preview (legacy alias)',
   1.25, 10.00, null,
   'USD', '2026-03-20', true, null,
   'Legacy alias: optimize-product MODEL_MAP stores google/-prefixed names',
   '{"best_for":"Raciocínio avançado, contexto longo","strengths":["Qualidade máxima","Contexto enorme"],"speed_tier":"medium","quality_tier":"premium","cost_tier":"medium","recommended_tasks":["reasoning","web_research"]}'),

  ('gemini', 'google/gemini-3.1-flash-image-preview', 'Gemini 3.1 Flash Image Preview (legacy alias)',
   0.15, 0.60, null,
   'USD', '2026-03-20', true, null,
   'Legacy alias: process-product-images stores google/-prefixed names',
   '{"best_for":"Processamento de imagens, análise visual","strengths":["Multimodal","Análise de imagem"],"speed_tier":"fast","quality_tier":"high","cost_tier":"cheap","recommended_tasks":["multimodal_vision","image_processing"]}'),

  ('openai', 'openai/gpt-4o', 'GPT-4o (legacy alias)',
   5.00, 15.00, 2.50,
   'USD', '2026-03-20', true, null,
   'Legacy alias: optimization_logs.model stores openai/-prefixed names',
   '{"best_for":"Extração, visão multimodal, pesquisa web","strengths":["Multimodal","Extração estruturada"],"speed_tier":"medium","quality_tier":"high","cost_tier":"medium","recommended_tasks":["extraction","multimodal_vision"]}'),

  ('openai', 'openai/gpt-4o-mini', 'GPT-4o Mini (legacy alias)',
   0.15, 0.60, 0.075,
   'USD', '2026-03-20', true, null,
   'Legacy alias: optimization_logs.model stores openai/-prefixed names',
   '{"best_for":"Classificação, SEO, tarefas de alto volume","strengths":["Velocidade","Custo mínimo"],"speed_tier":"fast","quality_tier":"standard","cost_tier":"cheap","recommended_tasks":["classification","seo_generation"]}')

ON CONFLICT (provider_id, model_id, effective_from) DO UPDATE SET
  display_name             = EXCLUDED.display_name,
  input_cost_per_1m        = EXCLUDED.input_cost_per_1m,
  output_cost_per_1m       = EXCLUDED.output_cost_per_1m,
  cached_input_cost_per_1m = EXCLUDED.cached_input_cost_per_1m,
  is_active                = EXCLUDED.is_active,
  source_url               = EXCLUDED.source_url,
  notes                    = EXCLUDED.notes,
  metadata                 = EXCLUDED.metadata,
  updated_at               = now();
