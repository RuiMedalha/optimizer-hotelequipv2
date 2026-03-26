# AI Provider Layer — Design Spec

**Date:** 2026-03-19
**Status:** Approved

---

## Goal

Remove operational dependency on `LOVABLE_API_KEY` / Lovable AI Gateway and replace it with a
self-owned, extensible AI provider layer. Preserve existing UI, prompts, workflows, Supabase
tables, auth, WooCommerce integrations, and the deployed domain setup. The new architecture must
be production-grade, workspace-aware, and easy to extend with new providers without touching
business logic.

---

## Scope

### In Scope

- `supabase/functions/_shared/ai/` — new shared module (9 files)
- `supabase/functions/resolve-ai-route/index.ts` — refactored as thin HTTP wrapper
- `supabase/functions/translate-product/index.ts` — Phase 2 migration
- `supabase/functions/enrich-products/index.ts` — Phase 2 migration
- `supabase/functions/analyze-product-page/index.ts` — Phase 2 migration
- `supabase/functions/optimize-product/index.ts` — Phase 2 (uses resolve-ai-route; minimal change)
- `supabase/functions/parse-catalog/index.ts` — Phase 3
- `supabase/functions/vision-parse-pdf/index.ts` — Phase 3
- `supabase/functions/run-document-intelligence/index.ts` — Phase 3
- `supabase/functions/extract-pdf-pages/index.ts` — Phase 3
- 4 SQL migration files (2 new tables + 1 table extension + 1 seed)
- Seed data for `ai_provider_registry` and `ai_model_catalog`

### Out of Scope

- Frontend UI components (no visual changes)
- Supabase auth, workspaces, WooCommerce publish logic
- `ai_providers`, `ai_routing_rules`, `ai_usage_logs`, `prompt_templates` — kept as-is
- Non-AI edge functions (publish, sync, workflow orchestration)

---

## Active Providers (Production)

| Provider  | Status  | Deno.env Secret     | Priority |
|-----------|---------|---------------------|----------|
| Anthropic | active  | `ANTHROPIC_API_KEY` | 1        |
| OpenAI    | active  | `OPENAI_API_KEY`    | 2        |
| Gemini    | active  | `GEMINI_API_KEY`    | 3        |

## Prepared Providers (Disabled Until Keys Available)

| Provider   | Status   | Deno.env Secret      |
|------------|----------|----------------------|
| Mistral    | prepared | `MISTRAL_API_KEY`    |
| Perplexity | prepared | `PERPLEXITY_API_KEY` |
| DeepSeek   | prepared | `DEEPSEEK_API_KEY`   |
| Grok       | prepared | `GROK_API_KEY`       |

## Legacy Provider (Disabled, Not In Fallback)

| Provider         | Status  | Deno.env Secret  |
|------------------|---------|------------------|
| Lovable Gateway  | legacy  | `LOVABLE_API_KEY` |

---

## `_shared/ai/` Module Architecture

### File List

```
supabase/functions/_shared/ai/
├── provider-types.ts       Core types and interfaces — zero logic
├── error-classifier.ts     Classifies HTTP/provider errors into enum
├── provider-registry.ts    Resolves full route: provider, model, fallback chain
├── model-catalog.ts        Central model catalog (DB + static fallback)
├── capability-matrix.ts    Static capability → provider/model defaults
├── invoke-provider.ts      Low-level HTTP calls (3 format adapters)
├── fallback-policy.ts      Retry + fallback orchestration (separated concerns)
├── usage-logger.ts         Logs to ai_usage_logs (decoupled from prompt-runner)
└── prompt-runner.ts        High-level orchestrator — single entry point for all functions
```

---

## Types — `provider-types.ts`

### CapabilityType

```typescript
export type CapabilityType =
  | 'content_generation'   // product titles, descriptions
  | 'seo_generation'       // meta, slug, focus keywords
  | 'classification'       // product type, category assignment
  | 'extraction'           // structured data from unstructured text/HTML
  | 'reasoning'            // analysis, bundles, pricing logic
  | 'multimodal_vision'    // PDF pages, product images, page screenshots
  | 'web_research'         // web-grounded search (Gemini, Perplexity)
  | 'enrichment'           // product enrichment from scraped web content
  | 'translation'          // multilingual translation
  | 'summarization';       // catalog analysis, document summaries
```

### ProviderFormat

```typescript
export type ProviderFormat =
  | 'openai_compatible'    // OpenAI, Mistral, Perplexity, DeepSeek, Grok
  | 'anthropic'            // Anthropic native
  | 'gemini';              // Google Gemini native
```

### ModelStatus

```typescript
export type ModelStatus = 'active' | 'deprecated' | 'experimental';
```

### ErrorCategory

```typescript
export type ErrorCategory =
  | 'auth_error'          // 401, invalid API key
  | 'rate_limit'          // 429, quota exceeded
  | 'provider_overload'   // 503, 529, provider capacity
  | 'network_error'       // fetch failure, timeout
  | 'invalid_request'     // 400, malformed payload
  | 'parse_error'         // response not parseable
  | 'policy_error'        // content filtered, safety block
  | 'unknown_error';
```

### ProviderConfig

```typescript
export interface ProviderConfig {
  id: string;               // 'openai', 'anthropic', 'gemini', ...
  displayName: string;
  format: ProviderFormat;
  apiBaseUrl: string;
  apiKeyEnvVar: string;     // name of Deno.env secret
  authScheme: 'bearer' | 'x-api-key' | 'query_param';
  enabled: boolean;
  isLegacy: boolean;
  priority: number;
}
```

### ModelConfig

```typescript
export interface ModelConfig {
  providerId: string;
  modelId: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  supportsJsonMode: boolean;
  inputCostPer1k: number;   // USD
  outputCostPer1k: number;  // USD
  status: ModelStatus;
  recommendedFor: CapabilityType[];
  enabled: boolean;
}
```

### InvokeParams

```typescript
export interface InvokeParams {
  provider: ProviderConfig;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  tools?: any[];
  toolChoice?: any;
}
```

### InvokeResult

```typescript
export interface InvokeResult {
  // Normalized fields — always present
  content: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown';
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
  latencyMs: number;

  // Full raw response from provider — preserved for callers that need it
  rawResponse: unknown;

  // Normalized response in OpenAI message format — for backward compat
  normalizedResponse: {
    choices: Array<{
      message: { role: string; content: string; tool_calls?: any[] };
      finish_reason: string;
    }>;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    model: string;
  };
}
```

### ResolvedRoute

```typescript
export interface ResolvedRoute {
  selectedProvider: ProviderConfig;
  selectedModel: string;
  fallbackChain: Array<{ provider: ProviderConfig; model: string }>;
  finalParams: Partial<RunPromptParams>;
  decisionSource:
    | 'routing_rule'           // from ai_routing_rules
    | 'workspace_preference'   // from workspace_ai_preferences
    | 'capability_default'     // from CAPABILITY_DEFAULTS static map
    | 'system_default';        // hardcoded last resort
}
```

### RunPromptParams

```typescript
export interface RunPromptParams {
  workspaceId: string;
  capability: CapabilityType;
  taskType?: string;
  systemPrompt: string;
  userPrompt?: string;
  messages?: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  modelOverride?: string;
  providerOverride?: string;
  tools?: any[];
  toolChoice?: any;
}
```

### RunMeta

```typescript
export interface RunMeta {
  provider: string;
  model: string;
  fallbackUsed: boolean;
  attemptedProviders: string[];
  attemptedModels: string[];
  decisionSource: ResolvedRoute['decisionSource'];
  errorCategory?: ErrorCategory;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  shadowMode: boolean;   // true when AI_ROUTER_SHADOW_MODE='true'; callers must not persist results
}
```

---

## Error Classifier — `error-classifier.ts`

Single function, no external deps. Maps HTTP status + response body to `ErrorCategory`.

```typescript
export function classifyError(
  status: number,
  responseBody: string,
  providerId: string
): ErrorCategory

// Classification rules:
// 401, 403                    → auth_error
// 429                         → rate_limit
// 503, 529, 500 (Anthropic)  → provider_overload
// fetch() throws (network)    → network_error
// 400                         → invalid_request
// JSON parse fails            → parse_error
// 451, content_filter in body → policy_error
// anything else               → unknown_error

// Retry eligibility (exported separately):
export function isRetryable(category: ErrorCategory): boolean
// rate_limit, provider_overload, network_error → true
// auth_error, invalid_request, policy_error    → false
```

---

## Provider Registry — `provider-registry.ts`

Loads provider + model resolution for a given workspace and capability. Returns a
`ResolvedRoute`, not just a provider ID.

```typescript
export async function resolveRoute(
  supabase: SupabaseClient,
  params: RunPromptParams
): Promise<ResolvedRoute>
```

Resolution precedence (highest to lowest):

1. `ai_routing_rules` — workspace + task_type match → use provider_id + model_override
2. `workspace_ai_preferences` — workspace + capability match → use provider_id + model_id
3. `workspace_ai_preferences` — workspace + `'*'` (global default)
4. `CAPABILITY_DEFAULTS[capability]` — static capability matrix
5. System default: Anthropic / claude-3-5-sonnet-20241022

**API Key Rule (invariant):** Provider registry NEVER reads `ai_providers.config.api_key`.
All API keys come exclusively from `Deno.env.get(provider.apiKeyEnvVar)`. If the env var is
absent, the provider is skipped in the chain and a warning is logged.

---

## Model Catalog — `model-catalog.ts`

```typescript
// Load all active models for a provider
export async function getModelsForProvider(
  supabase: SupabaseClient,
  providerId: string
): Promise<ModelConfig[]>

// Get a specific model (DB-first, static fallback)
export async function getModel(
  supabase: SupabaseClient,
  providerId: string,
  modelId: string
): Promise<ModelConfig | null>
```

The static fallback catalog is embedded in `model-catalog.ts` as a `const STATIC_CATALOG` object.
This ensures functions work even if the DB query fails.

---

## Capability Matrix — `capability-matrix.ts`

Static defaults. No DB dependency. Overridable at workspace level.

```typescript
export const CAPABILITY_DEFAULTS: Record<
  CapabilityType,
  { provider: string; model: string; fallback: Array<{ provider: string; model: string }> }
> = {
  content_generation:  { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022',      fallback: [{ provider: 'openai', model: 'gpt-4o' }, { provider: 'gemini', model: 'gemini-2.5-pro' }] },
  seo_generation:      { provider: 'anthropic', model: 'claude-3-5-haiku-20241022',       fallback: [{ provider: 'openai', model: 'gpt-4o-mini' }] },
  classification:      { provider: 'openai',    model: 'gpt-4o-mini',                     fallback: [{ provider: 'anthropic', model: 'claude-3-5-haiku-20241022' }] },
  extraction:          { provider: 'openai',    model: 'gpt-4o',                          fallback: [{ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' }] },
  reasoning:           { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022',      fallback: [{ provider: 'openai', model: 'gpt-4o' }] },
  multimodal_vision:   { provider: 'gemini',    model: 'gemini-2.5-flash-preview-04-17',  fallback: [{ provider: 'openai', model: 'gpt-4o' }] },
  web_research:        { provider: 'gemini',    model: 'gemini-2.5-pro',                  fallback: [{ provider: 'openai', model: 'gpt-4o' }] },
  enrichment:          { provider: 'gemini',    model: 'gemini-2.5-flash-preview-04-17',  fallback: [{ provider: 'openai', model: 'gpt-4o-mini' }] },
  translation:         { provider: 'anthropic', model: 'claude-3-5-haiku-20241022',       fallback: [{ provider: 'openai', model: 'gpt-4o-mini' }] },
  summarization:       { provider: 'anthropic', model: 'claude-3-5-haiku-20241022',       fallback: [{ provider: 'gemini', model: 'gemini-2.5-flash-preview-04-17' }] },
};

export function mapTaskTypeToCapability(taskType: string): CapabilityType
// Maps existing task_type strings (e.g. 'product_optimization', 'seo', 'translation')
// to CapabilityType enum values. Unknown types default to 'content_generation'.
```

---

## Invoke Provider — `invoke-provider.ts`

Three format adapters. Each returns a normalized `InvokeResult`. All API keys read from `Deno.env`.

```typescript
// Routes to the correct adapter by provider.format
export async function invokeProvider(params: InvokeParams): Promise<InvokeResult>

// Adapter 1: OpenAI, Mistral, Perplexity, DeepSeek, Grok
async function invokeOpenAICompatible(params: InvokeParams): Promise<InvokeResult>

// Adapter 2: Anthropic native
async function invokeAnthropic(params: InvokeParams): Promise<InvokeResult>

// Adapter 3: Gemini native (normalizes candidates → normalizedResponse)
async function invokeGemini(params: InvokeParams): Promise<InvokeResult>
```

Each adapter:
1. Reads `Deno.env.get(params.provider.apiKeyEnvVar)` — throws `auth_error` if absent
2. Makes the HTTP call with a 30-second timeout
3. On non-OK response: throws with status + body for `error-classifier.ts` to classify
4. Normalizes the native response to `InvokeResult` (including `normalizedResponse` in OpenAI format)
5. Records `latencyMs` from fetch start to response parse

---

## Fallback Policy — `fallback-policy.ts`

**Retry and fallback are separate concerns.**

```typescript
// Retry: same provider, same model, retryable error category only
export interface RetryConfig {
  maxAttempts: number;      // default: 2
  baseDelayMs: number;      // default: 500
  backoffMultiplier: number; // default: 2
}

// Fallback: different provider or model
export async function executeWithFallback(
  chain: Array<{ provider: ProviderConfig; model: string }>,
  baseParams: Omit<InvokeParams, 'provider' | 'model'>,
  retryConfig?: RetryConfig
): Promise<InvokeResult & {
  fallbackUsed: boolean;
  attemptedProviders: string[];
  attemptedModels: string[];
  errorCategories: Array<{ provider: string; category: ErrorCategory }>;
}>
```

**Execution logic:**

```
For each (provider, model) in chain:
  For attempt in 1..retryConfig.maxAttempts:
    try:
      result = invokeProvider({ provider, model, ...baseParams })
      return result  // success
    catch error:
      category = classifyError(error)
      if NOT isRetryable(category): break (try next provider immediately)
      if attempt < maxAttempts: sleep(backoff)
  // provider exhausted → try next in chain
Throw: AllProvidersFailedError with full attempt log
```

Key invariant: **`policy_error` and `auth_error` are never retried**. Rate limits are retried
within the same provider before moving to the fallback.

---

## Usage Logger — `usage-logger.ts`

Decoupled from `prompt-runner.ts`. Single responsibility: write to `ai_usage_logs`.

```typescript
export interface UsageLogEntry {
  workspaceId: string;
  taskType?: string;
  capability: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  fallbackUsed: boolean;
  decisionSource: string;
  latencyMs: number;
  errorCategory?: string;
  isShadow: boolean;     // true when AI_ROUTER_SHADOW_MODE='true' — logged but not persisted to business state
}

export async function logUsage(
  supabase: SupabaseClient,
  entry: UsageLogEntry
): Promise<void>
// Fire-and-forget. Never throws. Errors are console.warn'd, not propagated.
```

`ai_usage_logs` table receives 2 new columns (additive migration, nullable):
- `task_type TEXT` — for cost analysis per operation type
- `capability TEXT` — capability enum value
- `provider_id TEXT` — normalized provider name
- `fallback_used BOOLEAN`
- `decision_source TEXT`
- `latency_ms INT`
- `error_category TEXT`

---

## Prompt Runner — `prompt-runner.ts`

Single entry point for all AI calls in edge functions.

```typescript
export async function runPrompt(
  supabase: SupabaseClient,
  params: RunPromptParams
): Promise<{ result: InvokeResult; meta: RunMeta }>
```

Sequence:
1. Check `AI_ROUTER_ENABLED` env flag → if `'false'`, throw `Error('AI router disabled')`
2. `resolveRoute(supabase, params)` → `ResolvedRoute`
3. Build `chain` from `[selected, ...fallback]`
4. `executeWithFallback(chain, invokeParams)` → `InvokeResult + attempt metadata`
5. Estimate cost from `model-catalog` pricing
6. Build `RunMeta`
7. `logUsage(supabase, meta)` — fire and forget
8. If `AI_ROUTER_SHADOW_MODE === 'true'`: log result, but DO NOT update any product/business state — callers responsible for honouring this flag
9. Return `{ result, meta }`

---

## Feature Flags

Two Deno.env flags, checked at runtime inside `prompt-runner.ts`:

| Flag                    | Values            | Behaviour |
|-------------------------|-------------------|-----------|
| `AI_ROUTER_ENABLED`     | `'true'` (default) / `'false'` | `'false'` disables all AI calls; functions return a structured error immediately |
| `AI_ROUTER_SHADOW_MODE` | `'false'` (default) / `'true'` | `'true'` executes the AI call but logs it as shadow (dry-run). Business callers must check `meta.shadowMode` before persisting results. |

These flags are set in Supabase Edge Functions → Secrets. No code changes needed to toggle them.

---

## `resolve-ai-route` — Thin HTTP Wrapper

After refactoring: ~80 lines. HTTP contract identical to current (backward compatible).

```typescript
import { runPrompt }            from "../_shared/ai/prompt-runner.ts";
import { mapTaskTypeToCapability } from "../_shared/ai/capability-matrix.ts";
import { toLegacyResponse }     from "./legacy-compat.ts";

Deno.serve(async (req) => {
  const body = await req.json();
  const { taskType, workspaceId, messages, systemPrompt, options, modelOverride } = body;

  // Resolve prompt from prompt_templates/prompt_versions if routing rule specifies one.
  // resolvePromptTemplate() is EXISTING logic extracted from current resolve-ai-route (no new impl needed).
  const resolvedPrompt = await resolvePromptTemplate(supabase, workspaceId, taskType, systemPrompt);

  const { result, meta } = await runPrompt(supabase, {
    workspaceId,
    capability: mapTaskTypeToCapability(taskType),
    taskType,
    systemPrompt: resolvedPrompt,
    messages,
    temperature: options?.temperature,
    maxTokens: options?.max_tokens,
    jsonMode: !!options?.response_format,
    modelOverride,
    tools: options?.tools,
    toolChoice: options?.tool_choice,
  });

  return Response.json({
    result: toLegacyResponse(result),   // ← encapsulates OpenAI format compat
    meta: {
      usedProvider: meta.provider,
      usedModel: meta.model,
      fallbackUsed: meta.fallbackUsed,
      latencyMs: meta.latencyMs,
      taskType,
    },
  });
});
```

`legacy-compat.ts` — lives inside `resolve-ai-route/`:

```typescript
// Converts InvokeResult → OpenAI-format response object
// All existing callers receive the same shape they always have
export function toLegacyResponse(result: InvokeResult): unknown {
  return result.normalizedResponse;
}
```

---

## Database Migrations

Three additive migrations. No destructive changes.

### Migration 1 — `ai_provider_registry` and `workspace_ai_preferences`

```sql
-- Provider registry (global)
CREATE TABLE ai_provider_registry (
  id             TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL,
  api_base_url   TEXT NOT NULL,
  api_key_env_var TEXT NOT NULL,
  auth_scheme    TEXT NOT NULL DEFAULT 'bearer',
  request_format TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  is_legacy      BOOLEAN NOT NULL DEFAULT FALSE,
  priority       INT NOT NULL DEFAULT 50,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Workspace-level AI preferences (optional overrides)
CREATE TABLE workspace_ai_preferences (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id         UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  capability           TEXT NOT NULL DEFAULT '*',
  provider_id          TEXT REFERENCES ai_provider_registry(id),
  model_id             TEXT,
  fallback_provider_id TEXT REFERENCES ai_provider_registry(id),
  fallback_model_id    TEXT,
  temperature          NUMERIC DEFAULT 0.7,
  max_tokens           INT DEFAULT 2048,
  json_mode            BOOLEAN DEFAULT FALSE,
  enabled              BOOLEAN DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, capability)
);

-- RLS
ALTER TABLE ai_provider_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_ai_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_registry"
  ON ai_provider_registry FOR ALL TO service_role USING (true);

CREATE POLICY "workspace_members_read_preferences"
  ON workspace_ai_preferences FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "service_role_full_access_preferences"
  ON workspace_ai_preferences FOR ALL TO service_role USING (true);
```

### Migration 2 — `ai_model_catalog`

```sql
CREATE TABLE ai_model_catalog (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id               TEXT NOT NULL REFERENCES ai_provider_registry(id),
  model_id                  TEXT NOT NULL,
  display_name              TEXT NOT NULL,
  context_window            INT,
  max_output_tokens         INT,
  supports_vision           BOOLEAN DEFAULT FALSE,
  supports_function_calling BOOLEAN DEFAULT FALSE,
  supports_json_mode        BOOLEAN DEFAULT FALSE,
  input_cost_per_1k         NUMERIC,
  output_cost_per_1k        NUMERIC,
  status                    TEXT NOT NULL DEFAULT 'active',
  recommended_for           TEXT[],
  enabled                   BOOLEAN DEFAULT TRUE,
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now(),
  UNIQUE(provider_id, model_id)
);

ALTER TABLE ai_model_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access_catalog"
  ON ai_model_catalog FOR ALL TO service_role USING (true);
CREATE POLICY "authenticated_read_catalog"
  ON ai_model_catalog FOR SELECT TO authenticated USING (true);
```

### Migration 3 — Extend `ai_usage_logs`

```sql
ALTER TABLE ai_usage_logs
  ADD COLUMN IF NOT EXISTS task_type       TEXT,
  ADD COLUMN IF NOT EXISTS capability      TEXT,
  ADD COLUMN IF NOT EXISTS provider_id     TEXT,
  ADD COLUMN IF NOT EXISTS fallback_used   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS decision_source TEXT,
  ADD COLUMN IF NOT EXISTS latency_ms      INT,
  ADD COLUMN IF NOT EXISTS error_category  TEXT,
  ADD COLUMN IF NOT EXISTS is_shadow       BOOLEAN DEFAULT FALSE;
-- is_shadow marks calls made during AI_ROUTER_SHADOW_MODE. Useful for cost analysis
-- and confirming shadow traffic before decommissioning a provider.
```

### Seed Data — `ai_provider_registry`

```sql
INSERT INTO ai_provider_registry (id, display_name, api_base_url, api_key_env_var, auth_scheme, request_format, enabled, is_legacy, priority) VALUES
  ('anthropic',       'Anthropic (Claude)',   'https://api.anthropic.com/v1/messages',                              'ANTHROPIC_API_KEY',  'x-api-key', 'anthropic',          true,  false, 1),
  ('openai',          'OpenAI',               'https://api.openai.com/v1/chat/completions',                         'OPENAI_API_KEY',     'bearer',    'openai_compatible',  true,  false, 2),
  ('gemini',          'Google Gemini',        'https://generativelanguage.googleapis.com/v1beta',                   'GEMINI_API_KEY',     'query_param','gemini',             true,  false, 3),
  ('mistral',         'Mistral',              'https://api.mistral.ai/v1/chat/completions',                         'MISTRAL_API_KEY',    'bearer',    'openai_compatible',  false, false, 10),
  ('perplexity',      'Perplexity',           'https://api.perplexity.ai/chat/completions',                         'PERPLEXITY_API_KEY', 'bearer',    'openai_compatible',  false, false, 11),
  ('deepseek',        'DeepSeek',             'https://api.deepseek.com/v1/chat/completions',                       'DEEPSEEK_API_KEY',   'bearer',    'openai_compatible',  false, false, 12),
  ('grok',            'Grok (xAI)',           'https://api.x.ai/v1/chat/completions',                               'GROK_API_KEY',       'bearer',    'openai_compatible',  false, false, 13),
  ('lovable_gateway', 'Lovable Gateway',      'https://ai.gateway.lovable.dev/v1/chat/completions',                 'LOVABLE_API_KEY',    'bearer',    'openai_compatible',  false, true,  99)
ON CONFLICT (id) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  is_legacy = EXCLUDED.is_legacy,
  updated_at = now();
```

### Seed Data — `ai_model_catalog` (subset)

```sql
INSERT INTO ai_model_catalog (provider_id, model_id, display_name, context_window, max_output_tokens, supports_vision, supports_function_calling, supports_json_mode, input_cost_per_1k, output_cost_per_1k, status, recommended_for, enabled) VALUES
-- Anthropic
('anthropic', 'claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet', 200000, 8192, true,  true,  false, 0.003, 0.015, 'active', ARRAY['content_generation','reasoning','extraction'], true),
('anthropic', 'claude-3-5-haiku-20241022',  'Claude 3.5 Haiku',  200000, 8192, false, true,  false, 0.001, 0.005, 'active', ARRAY['seo_generation','translation','summarization'], true),
('anthropic', 'claude-3-opus-20240229',     'Claude 3 Opus',     200000, 4096, true,  true,  false, 0.015, 0.075, 'active', ARRAY['reasoning'], true),
-- OpenAI
('openai', 'gpt-4o',      'GPT-4o',      128000, 4096, true,  true,  true,  0.005, 0.015, 'active', ARRAY['extraction','reasoning','multimodal_vision'], true),
('openai', 'gpt-4o-mini', 'GPT-4o Mini', 128000, 4096, false, true,  true,  0.00015, 0.0006, 'active', ARRAY['classification','seo_generation'], true),
-- Gemini
('gemini', 'gemini-2.5-pro',                 'Gemini 2.5 Pro',         1000000, 8192, true,  true,  true,  0.00125, 0.005,  'active', ARRAY['web_research','reasoning'], true),
('gemini', 'gemini-2.5-flash-preview-04-17', 'Gemini 2.5 Flash',        1000000, 8192, true,  true,  true,  0.00015, 0.0006, 'active', ARRAY['multimodal_vision','enrichment'], true),
('gemini', 'gemini-1.5-pro',                 'Gemini 1.5 Pro (Legacy)', 1000000, 8192, true,  true,  true,  0.00125, 0.005,  'deprecated', ARRAY[]::TEXT[], false),
-- Mistral (prepared)
('mistral', 'mistral-large-latest', 'Mistral Large', 131072, 4096, false, true, true, 0.003, 0.009, 'active', ARRAY['content_generation'], false),
('mistral', 'mistral-small-latest', 'Mistral Small', 131072, 4096, false, true, true, 0.001, 0.003, 'active', ARRAY['classification'], false),
-- Perplexity (prepared)
('perplexity', 'sonar-pro', 'Sonar Pro', 200000, 8000, false, false, false, 0.003, 0.015, 'active', ARRAY['web_research'], false),
('perplexity', 'sonar',     'Sonar',     127072, 8000, false, false, false, 0.001, 0.001, 'active', ARRAY['web_research'], false),
-- DeepSeek (prepared)
('deepseek', 'deepseek-chat',     'DeepSeek Chat',     64000, 4096, false, false, true, 0.00014, 0.00028, 'active', ARRAY['content_generation'], false),
('deepseek', 'deepseek-reasoner', 'DeepSeek Reasoner', 64000, 4096, false, false, true, 0.00055, 0.00219, 'active', ARRAY['reasoning'], false),
-- Grok (prepared)
('grok', 'grok-2', 'Grok 2', 131072, 4096, true, true, false, 0.002, 0.010, 'active', ARRAY['reasoning'], false)
ON CONFLICT (provider_id, model_id) DO NOTHING;
```

---

## Required Secrets

Add to Supabase → Project Settings → Edge Functions → Secrets:

```
OPENAI_API_KEY          string   Active — production required
ANTHROPIC_API_KEY       string   Active — production required
GEMINI_API_KEY          string   Active — production required
MISTRAL_API_KEY         string   Prepared — leave empty until key available
PERPLEXITY_API_KEY      string   Prepared — leave empty until key available
DEEPSEEK_API_KEY        string   Prepared — leave empty until key available
GROK_API_KEY            string   Prepared — leave empty until key available
LOVABLE_API_KEY         string   Legacy — keep during Phases 1-3; remove in Phase 4
AI_ROUTER_ENABLED       string   Set to 'true' (default). Set 'false' to kill-switch AI.
AI_ROUTER_SHADOW_MODE   string   Set to 'false' (default). Set 'true' for dry-run mode.
```

**API Key Security Rule (invariant):**
- `Deno.env` is the sole source of truth for API keys in `_shared/ai/`
- `ai_providers.config.api_key` is read-only legacy during transition; ignored by new layer
- API keys are never returned to the frontend; edge functions only
- No API key is stored in application code or committed to git

---

## Migration Plan

### Phase 1 — Foundation (1 batch, ~3 commits)

**Commit 1:** `feat: create _shared/ai module with provider types and capability matrix`
- `provider-types.ts`
- `capability-matrix.ts`
- `error-classifier.ts`

**Commit 2:** `feat: add model catalog, provider registry, invoke provider, fallback policy`
- `model-catalog.ts`
- `provider-registry.ts`
- `invoke-provider.ts`
- `fallback-policy.ts`
- `usage-logger.ts`
- `prompt-runner.ts`

**Commit 3:** `feat: refactor resolve-ai-route as thin wrapper using shared AI layer`
- `resolve-ai-route/index.ts` (refactored ~80 lines)
- `resolve-ai-route/legacy-compat.ts` (new, `toLegacyResponse`)
- SQL migrations 1, 2, 3
- Seed SQL

**Validation gate (Phase 1 complete when):**
- `resolve-ai-route` handles `optimize-product`, `enrich-products`, `translate-product`
  calls end-to-end in staging without errors
- `ai_usage_logs` shows `provider_id` = 'anthropic'|'openai'|'gemini' (not 'lovable_gateway')
- No `LOVABLE_API_KEY` usage in AI router logs

---

### Phase 2 — Migrate Direct Lovable Callers (1 batch, ~2 commits)

Target functions (call Lovable gateway directly, bypass `resolve-ai-route`):
- `translate-product` — remove `LOVABLE_API_KEY`, import `prompt-runner.ts`
- `enrich-products` — remove `lovableApiKey` conditional, import `prompt-runner.ts`
- `analyze-product-page` — replace direct gateway call, import `prompt-runner.ts`

**Commit 4:** `feat: migrate translate-product and enrich-products to shared AI layer`
**Commit 5:** `feat: migrate analyze-product-page to shared AI layer`

**Validation gate:** Zero `lovable_gateway` entries in `ai_usage_logs` for these functions.

---

### Phase 3 — Vision / PDF Functions (separate batch, higher risk)

Target functions (multimodal vision, complex prompt chains):
- `parse-catalog`
- `vision-parse-pdf`
- `run-document-intelligence`
- `extract-pdf-pages`

These use `multimodal_vision` capability → Gemini as preferred provider.
Staged rollout: one function at a time with full regression testing before next.

**Commit 6-9:** one commit per function migration

**Validation gate:** All PDF extraction tests pass in staging. No regression in catalog parsing.

---

### Phase 4 — Deprecation Gate (time-locked)

Only execute after both conditions are met:
1. **Stable period:** minimum 14 days since Phase 3 completion with no production incidents
2. **Log verification:** query `ai_usage_logs` confirms zero `provider_id = 'lovable_gateway'`
   entries in the last 30 days across all production workspaces

```sql
-- Verification query before Phase 4
SELECT COUNT(*) FROM ai_usage_logs
WHERE provider_id = 'lovable_gateway'
  AND created_at > now() - INTERVAL '30 days';
-- Must return 0 before proceeding
```

**Commit 10:** `chore: remove LOVABLE_API_KEY from all edge functions`
**Commit 11:** `chore: mark lovable_gateway as disabled in provider registry`

```sql
UPDATE ai_provider_registry
SET enabled = FALSE, updated_at = now()
WHERE id = 'lovable_gateway';
```

Remove `LOVABLE_API_KEY` secret from Supabase Edge Functions settings.

---

## Test Checklist

### Local / Unit

- [ ] `error-classifier.ts`: all 7 categories triggered with mock status codes
- [ ] `fallback-policy.ts`: retry stops on `auth_error`; retries on `rate_limit`
- [ ] `fallback-policy.ts`: fallback chain moves to next provider after exhausting retries
- [ ] `invoke-provider.ts`: Anthropic, OpenAI, Gemini adapters produce valid `InvokeResult`
- [ ] `model-catalog.ts`: static fallback used when DB is unreachable
- [ ] `provider-registry.ts`: precedence order (routing_rule > workspace_pref > capability_default > system_default)
- [ ] `prompt-runner.ts`: `AI_ROUTER_ENABLED=false` returns error without making HTTP calls
- [ ] `prompt-runner.ts`: shadow mode flag passed through to `RunMeta`

### Staging Integration

- [ ] `resolve-ai-route`: call with `taskType=product_optimization` → routes to Anthropic
- [ ] `resolve-ai-route`: call with Anthropic key removed → falls back to OpenAI
- [ ] `resolve-ai-route`: call with all keys removed → returns structured error (no crash)
- [ ] `optimize-product`: end-to-end product optimization via `resolve-ai-route` → success
- [ ] `translate-product` (Phase 2): no `LOVABLE_API_KEY` used; `provider_id=anthropic` in logs
- [ ] `enrich-products` (Phase 2): same validation
- [ ] `ai_usage_logs`: new columns (`provider_id`, `capability`, `latency_ms`) populated
- [ ] `toLegacyResponse`: callers receive same JSON shape as before refactor

### Regression

- [ ] Existing WooCommerce import flow unaffected
- [ ] Workspace auth and session management unaffected
- [ ] Existing `ai_routing_rules` configuration still honoured
- [ ] `prompt_templates` / `prompt_versions` still loaded and applied
- [ ] `test-ai-provider` function still works for health checks

---

## Files Changed Summary

### New Files

```
supabase/functions/_shared/ai/provider-types.ts
supabase/functions/_shared/ai/error-classifier.ts
supabase/functions/_shared/ai/provider-registry.ts
supabase/functions/_shared/ai/model-catalog.ts
supabase/functions/_shared/ai/capability-matrix.ts
supabase/functions/_shared/ai/invoke-provider.ts
supabase/functions/_shared/ai/fallback-policy.ts
supabase/functions/_shared/ai/usage-logger.ts
supabase/functions/_shared/ai/prompt-runner.ts
supabase/functions/resolve-ai-route/legacy-compat.ts
supabase/migrations/YYYYMMDD_ai_provider_registry_and_preferences.sql
supabase/migrations/YYYYMMDD_ai_model_catalog.sql
supabase/migrations/YYYYMMDD_extend_ai_usage_logs.sql
supabase/migrations/YYYYMMDD_seed_ai_provider_registry.sql
```

### Modified Files (Phase 1)

```
supabase/functions/resolve-ai-route/index.ts
```

### Modified Files (Phase 2)

```
supabase/functions/translate-product/index.ts
supabase/functions/enrich-products/index.ts
supabase/functions/analyze-product-page/index.ts
```

### Modified Files (Phase 3)

```
supabase/functions/parse-catalog/index.ts
supabase/functions/vision-parse-pdf/index.ts
supabase/functions/run-document-intelligence/index.ts
supabase/functions/extract-pdf-pages/index.ts
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Anthropic/OpenAI keys not yet in Supabase secrets | Secrets added before Phase 1 deploy; Phase 1 blocked without them |
| Existing callers break on `resolve-ai-route` response shape change | `toLegacyResponse()` preserves exact OpenAI shape |
| `ai_routing_rules` references old `ai_providers` records | Registry resolves these via backward-compat path; no data migration |
| Vision functions regress on PDF extraction quality | Phase 3 migrated one-at-a-time with staging regression tests |
| Phase 4 executes before Lovable is truly unused | Time-lock (14 days) + log query gate enforced before any Phase 4 commit |
| API key absent for active provider | Provider skipped in chain with warning; fallback chain continues |
