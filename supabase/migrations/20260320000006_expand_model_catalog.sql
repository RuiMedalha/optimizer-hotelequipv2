-- Expand model catalog with additional OpenAI, Anthropic, Gemini, and DeepSeek models.
-- All entries include full metadata JSONB.
-- Idempotent: ON CONFLICT (provider_id, model_id, effective_from) DO UPDATE.

INSERT INTO ai_model_pricing
  (provider_id, model_id, display_name,
   input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m,
   currency, effective_from, is_active, source_url, notes, metadata)
VALUES

  -- ── OpenAI ───────────────────────────────────────────────────────────────────
  ('openai', 'o3-mini', 'o3 Mini',
   1.10, 4.40, null,
   'USD', '2026-03-20', true,
   'https://openai.com/api/pricing/',
   'Reasoning model; fast and cost-effective for structured tasks',
   '{"best_for":"Raciocínio eficiente, classificação avançada","strengths":["Raciocínio encadeado","Custo baixo","Velocidade"],"speed_tier":"fast","quality_tier":"high","cost_tier":"cheap","recommended_tasks":["reasoning","classification","extraction"]}'),

  ('openai', 'o1-mini', 'o1 Mini',
   1.10, 4.40, null,
   'USD', '2026-03-20', true,
   'https://openai.com/api/pricing/',
   'Compact reasoning model; predecessor to o3-mini',
   '{"best_for":"Raciocínio compacto, análise estruturada","strengths":["Raciocínio","Velocidade moderada"],"speed_tier":"medium","quality_tier":"high","cost_tier":"cheap","recommended_tasks":["reasoning","extraction"]}'),

  ('openai', 'gpt-4-turbo', 'GPT-4 Turbo',
   10.00, 30.00, 5.00,
   'USD', '2026-03-20', true,
   'https://openai.com/api/pricing/',
   'High-capability model with 128k context',
   '{"best_for":"Tarefas de alta qualidade, contexto longo","strengths":["Qualidade premium","Contexto 128k","Multimodal"],"speed_tier":"medium","quality_tier":"premium","cost_tier":"expensive","recommended_tasks":["reasoning","content_generation","long_context"]}'),

  -- ── Anthropic ─────────────────────────────────────────────────────────────────
  ('anthropic', 'claude-3-opus-20240229', 'Claude 3 Opus',
   15.00, 75.00, 1.50,
   'USD', '2026-03-20', true,
   'https://www.anthropic.com/pricing',
   'Highest quality Anthropic model (Claude 3 generation); use claude-opus-4-6 for newer',
   '{"best_for":"Análise profunda, raciocínio complexo (geração Claude 3)","strengths":["Qualidade máxima","Raciocínio","Análise detalhada"],"speed_tier":"slow","quality_tier":"premium","cost_tier":"expensive","recommended_tasks":["reasoning","complex_analysis","content_generation"]}'),

  -- ── Google Gemini ─────────────────────────────────────────────────────────────
  ('gemini', 'gemini-2.0-flash', 'Gemini 2.0 Flash',
   0.10, 0.40, null,
   'USD', '2026-03-20', true,
   'https://ai.google.dev/pricing',
   'Stable fast model; great balance speed/quality before 2.5 Flash',
   '{"best_for":"Tarefas rápidas, enriquecimento, visão","strengths":["Velocidade","Multimodal","Custo baixo"],"speed_tier":"fast","quality_tier":"high","cost_tier":"cheap","recommended_tasks":["enrichment","multimodal_vision","summarization"]}'),

  ('gemini', 'gemini-2.0-flash-lite', 'Gemini 2.0 Flash Lite',
   0.075, 0.30, null,
   'USD', '2026-03-20', true,
   'https://ai.google.dev/pricing',
   'Lightest 2.0 variant; ultra-high-volume tasks',
   '{"best_for":"Alto volume, classificação simples","strengths":["Ultra-rápido","Custo mínimo","Throughput"],"speed_tier":"fast","quality_tier":"standard","cost_tier":"cheap","recommended_tasks":["classification","seo_generation"]}'),

  -- ── DeepSeek ─────────────────────────────────────────────────────────────────
  -- NOTE: is_active = false until resolve-ai-route supports DeepSeek provider.
  -- These rows are for pricing reference only; they will NOT appear in the
  -- AiComparisonWizard model picker until activated.
  ('deepseek', 'deepseek-v3', 'DeepSeek V3',
   0.27, 1.10, null,
   'USD', '2026-03-20', false,
   'https://platform.deepseek.com/docs',
   'Strong open-source model; INACTIVE until DeepSeek provider wired in resolve-ai-route',
   '{"best_for":"Raciocínio, geração de conteúdo, custo baixo","strengths":["Qualidade alta","Custo baixíssimo","Open-source"],"speed_tier":"medium","quality_tier":"high","cost_tier":"cheap","recommended_tasks":["content_generation","reasoning","extraction"]}'),

  ('deepseek', 'deepseek-r1', 'DeepSeek R1',
   0.55, 2.19, null,
   'USD', '2026-03-20', false,
   'https://platform.deepseek.com/docs',
   'Reasoning-focused model; INACTIVE until DeepSeek provider wired in resolve-ai-route',
   '{"best_for":"Raciocínio avançado, análise de dados","strengths":["Raciocínio encadeado","Qualidade premium","Open-source"],"speed_tier":"medium","quality_tier":"premium","cost_tier":"cheap","recommended_tasks":["reasoning","complex_analysis"]}')

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
