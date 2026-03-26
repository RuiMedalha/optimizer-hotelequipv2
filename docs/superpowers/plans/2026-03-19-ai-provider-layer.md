# AI Provider Layer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Lovable AI Gateway dependency with a self-owned, extensible AI provider layer using Anthropic, OpenAI, and Gemini as active providers.

**Architecture:** 9-module shared library at `supabase/functions/_shared/ai/` provides all AI routing, invocation, fallback, and logging. `resolve-ai-route` becomes a ~80-line thin HTTP wrapper. Direct Lovable callers are migrated phase by phase with a 14-day stability gate before final deprecation.

**Tech Stack:** Deno/TypeScript (edge functions), Supabase PostgREST, Deno.env secrets, `deno test` for unit tests

**Pre-Implementation Blocker:** Add `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` to Supabase → Project Settings → Edge Functions → Secrets BEFORE Phase 1 deploy. Phase 1 validation gate cannot pass without them.

---

## File Structure

### New Files

```
supabase/functions/_shared/ai/
├── provider-types.ts          Core types and interfaces — zero logic, zero deps
├── error-classifier.ts        Classifies HTTP/provider errors → ErrorCategory enum
├── capability-matrix.ts       Static capability → provider/model defaults (no DB)
├── model-catalog.ts           Model catalog: DB-first with STATIC_CATALOG fallback
├── invoke-provider.ts         Low-level HTTP adapters (OpenAI-compat, Anthropic, Gemini)
├── fallback-policy.ts         Retry (same provider) + fallback (next provider) — separated
├── usage-logger.ts            Fire-and-forget write to ai_usage_logs (decoupled)
├── provider-registry.ts       Resolves full ResolvedRoute from workspace + capability
└── prompt-runner.ts           High-level orchestrator — single entry point for all callers

supabase/functions/resolve-ai-route/
└── legacy-compat.ts           toLegacyResponse(): InvokeResult → OpenAI format

supabase/migrations/
├── 20260319000001_ai_provider_registry_and_preferences.sql
├── 20260319000002_ai_model_catalog.sql
├── 20260319000003_extend_ai_usage_logs.sql
└── 20260319000004_seed_ai_providers.sql
```

### Modified Files

```
Phase 1:  supabase/functions/resolve-ai-route/index.ts   (rewrite ~80 lines)
Phase 2:  supabase/functions/translate-product/index.ts  (remove 1 line)
          supabase/functions/enrich-products/index.ts     (replace parseWithAI call)
          supabase/functions/analyze-product-page/index.ts (replace direct Lovable call)
Phase 3:  supabase/functions/parse-catalog/index.ts
          supabase/functions/vision-parse-pdf/index.ts
          supabase/functions/run-document-intelligence/index.ts
          supabase/functions/extract-pdf-pages/index.ts
```

---

## Phase 1 — Foundation

### Task 1: provider-types.ts

**Files:**
- Create: `supabase/functions/_shared/ai/provider-types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// supabase/functions/_shared/ai/provider-types.ts
// Zero logic, zero external imports. All shared types for the AI layer.

export type CapabilityType =
  | 'content_generation'
  | 'seo_generation'
  | 'classification'
  | 'extraction'
  | 'reasoning'
  | 'multimodal_vision'
  | 'web_research'
  | 'enrichment'
  | 'translation'
  | 'summarization';

export type ProviderFormat =
  | 'openai_compatible'
  | 'anthropic'
  | 'gemini';

export type ModelStatus = 'active' | 'deprecated' | 'experimental';

export type ErrorCategory =
  | 'auth_error'
  | 'rate_limit'
  | 'provider_overload'
  | 'network_error'
  | 'invalid_request'
  | 'parse_error'
  | 'policy_error'
  | 'unknown_error';

export interface ProviderConfig {
  id: string;
  displayName: string;
  format: ProviderFormat;
  apiBaseUrl: string;
  apiKeyEnvVar: string;
  authScheme: 'bearer' | 'x-api-key' | 'query_param';
  enabled: boolean;
  isLegacy: boolean;
  priority: number;
}

export interface ModelConfig {
  providerId: string;
  modelId: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  supportsJsonMode: boolean;
  inputCostPer1k: number;
  outputCostPer1k: number;
  status: ModelStatus;
  recommendedFor: CapabilityType[];
  enabled: boolean;
}

export interface InvokeParams {
  provider: ProviderConfig;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  tools?: unknown[];
  toolChoice?: unknown;
}

export interface InvokeResult {
  content: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown';
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
  latencyMs: number;
  rawResponse: unknown;
  normalizedResponse: {
    choices: Array<{
      message: { role: string; content: string; tool_calls?: unknown[] };
      finish_reason: string;
    }>;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    model: string;
  };
}

export interface ResolvedRoute {
  selectedProvider: ProviderConfig;
  selectedModel: string;
  fallbackChain: Array<{ provider: ProviderConfig; model: string }>;
  finalParams: Partial<RunPromptParams>;
  decisionSource:
    | 'routing_rule'
    | 'workspace_preference'
    | 'capability_default'
    | 'system_default';
}

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
  tools?: unknown[];
  toolChoice?: unknown;
}

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
  shadowMode: boolean;
}

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
  isShadow: boolean;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  backoffMultiplier: number;
}
```

- [ ] **Step 2: Verify the file compiles (no TypeScript errors)**

Run: `deno check supabase/functions/_shared/ai/provider-types.ts`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/ai/provider-types.ts
git commit -m "feat: add _shared/ai/provider-types.ts — core AI layer types"
```

---

### Task 2: error-classifier.ts

**Files:**
- Create: `supabase/functions/_shared/ai/error-classifier.ts`
- Create: `supabase/functions/_shared/ai/error-classifier_test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/_shared/ai/error-classifier_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyError, isRetryable } from "./error-classifier.ts";

Deno.test("classifyError: 401 → auth_error", () => {
  assertEquals(classifyError(401, "", "openai"), "auth_error");
});
Deno.test("classifyError: 403 → auth_error", () => {
  assertEquals(classifyError(403, "", "openai"), "auth_error");
});
Deno.test("classifyError: 429 → rate_limit", () => {
  assertEquals(classifyError(429, "", "openai"), "rate_limit");
});
Deno.test("classifyError: 503 → provider_overload", () => {
  assertEquals(classifyError(503, "", "openai"), "provider_overload");
});
Deno.test("classifyError: 529 → provider_overload", () => {
  assertEquals(classifyError(529, "", "anthropic"), "provider_overload");
});
Deno.test("classifyError: 400 → invalid_request", () => {
  assertEquals(classifyError(400, "", "openai"), "invalid_request");
});
Deno.test("classifyError: unknown status → unknown_error", () => {
  assertEquals(classifyError(418, "", "openai"), "unknown_error");
});
Deno.test("classifyError: network (status 0) → network_error", () => {
  assertEquals(classifyError(0, "", "openai"), "network_error");
});
Deno.test("classifyError: body contains content_filter → policy_error", () => {
  assertEquals(classifyError(400, '{"error":{"code":"content_filter"}}', "openai"), "policy_error");
});
Deno.test("isRetryable: rate_limit → true", () => {
  assertEquals(isRetryable("rate_limit"), true);
});
Deno.test("isRetryable: provider_overload → true", () => {
  assertEquals(isRetryable("provider_overload"), true);
});
Deno.test("isRetryable: network_error → true", () => {
  assertEquals(isRetryable("network_error"), true);
});
Deno.test("isRetryable: auth_error → false", () => {
  assertEquals(isRetryable("auth_error"), false);
});
Deno.test("isRetryable: policy_error → false", () => {
  assertEquals(isRetryable("policy_error"), false);
});
Deno.test("isRetryable: invalid_request → false", () => {
  assertEquals(isRetryable("invalid_request"), false);
});
Deno.test("isRetryable: parse_error → false", () => {
  assertEquals(isRetryable("parse_error"), false);
});
Deno.test("isRetryable: unknown_error → false", () => {
  assertEquals(isRetryable("unknown_error"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/ai/error-classifier_test.ts`
Expected: FAIL — `error-classifier.ts` does not exist yet

- [ ] **Step 3: Implement error-classifier.ts**

```typescript
// supabase/functions/_shared/ai/error-classifier.ts
import type { ErrorCategory } from "./provider-types.ts";

export function classifyError(
  status: number,
  responseBody: string,
  _providerId: string,
): ErrorCategory {
  if (status === 0) return "network_error";
  if (status === 401 || status === 403) return "auth_error";
  if (status === 429) return "rate_limit";
  if (status === 503 || status === 529) return "provider_overload";
  if (status === 451) return "policy_error";
  if (status === 400) {
    if (responseBody.includes("content_filter") || responseBody.includes("safety")) {
      return "policy_error";
    }
    return "invalid_request";
  }
  if (status === 500 && responseBody.includes("overloaded")) return "provider_overload";
  if (status >= 500) return "provider_overload";
  if (status >= 400) return "unknown_error";
  return "unknown_error";
}

export function classifyNetworkError(_err: unknown): ErrorCategory {
  return "network_error";
}

export function isRetryable(category: ErrorCategory): boolean {
  return category === "rate_limit" ||
    category === "provider_overload" ||
    category === "network_error";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/_shared/ai/error-classifier_test.ts`
Expected: all 16 tests PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/error-classifier.ts supabase/functions/_shared/ai/error-classifier_test.ts
git commit -m "feat: add error-classifier.ts — HTTP error → ErrorCategory with retryability"
```

---

### Task 3: capability-matrix.ts

**Files:**
- Create: `supabase/functions/_shared/ai/capability-matrix.ts`

- [ ] **Step 1: Create the capability matrix**

```typescript
// supabase/functions/_shared/ai/capability-matrix.ts
// Static capability → provider/model defaults. No DB dependency.
import type { CapabilityType } from "./provider-types.ts";

export const CAPABILITY_DEFAULTS: Record<
  CapabilityType,
  { provider: string; model: string; fallback: Array<{ provider: string; model: string }> }
> = {
  content_generation: {
    provider: "anthropic", model: "claude-3-5-sonnet-20241022",
    fallback: [{ provider: "openai", model: "gpt-4o" }, { provider: "gemini", model: "gemini-2.5-pro" }],
  },
  seo_generation: {
    provider: "anthropic", model: "claude-3-5-haiku-20241022",
    fallback: [{ provider: "openai", model: "gpt-4o-mini" }],
  },
  classification: {
    provider: "openai", model: "gpt-4o-mini",
    fallback: [{ provider: "anthropic", model: "claude-3-5-haiku-20241022" }],
  },
  extraction: {
    provider: "openai", model: "gpt-4o",
    fallback: [{ provider: "anthropic", model: "claude-3-5-sonnet-20241022" }],
  },
  reasoning: {
    provider: "anthropic", model: "claude-3-5-sonnet-20241022",
    fallback: [{ provider: "openai", model: "gpt-4o" }],
  },
  multimodal_vision: {
    provider: "gemini", model: "gemini-2.5-flash-preview-04-17",
    fallback: [{ provider: "openai", model: "gpt-4o" }],
  },
  web_research: {
    provider: "gemini", model: "gemini-2.5-pro",
    fallback: [{ provider: "openai", model: "gpt-4o" }],
  },
  enrichment: {
    provider: "gemini", model: "gemini-2.5-flash-preview-04-17",
    fallback: [{ provider: "openai", model: "gpt-4o-mini" }],
  },
  translation: {
    provider: "anthropic", model: "claude-3-5-haiku-20241022",
    fallback: [{ provider: "openai", model: "gpt-4o-mini" }],
  },
  summarization: {
    provider: "anthropic", model: "claude-3-5-haiku-20241022",
    fallback: [{ provider: "gemini", model: "gemini-2.5-flash-preview-04-17" }],
  },
};

const TASK_TYPE_TO_CAPABILITY: Record<string, CapabilityType> = {
  // Translation
  content_translation: "translation",
  translate: "translation",
  // SEO
  seo: "seo_generation",
  seo_generation: "seo_generation",
  optimize_seo: "seo_generation",
  // Content
  product_optimization: "content_generation",
  content_generation: "content_generation",
  generate_description: "content_generation",
  // Classification
  classification: "classification",
  classify_product: "classification",
  // Extraction
  extraction: "extraction",
  extract_attributes: "extraction",
  parse_catalog: "extraction",
  // Reasoning / analysis
  reasoning: "reasoning",
  analyze: "reasoning",
  analysis: "reasoning",
  bundle_detection: "reasoning",
  // Vision
  multimodal_vision: "multimodal_vision",
  vision: "multimodal_vision",
  parse_pdf: "multimodal_vision",
  vision_parse: "multimodal_vision",
  // Web research
  web_research: "web_research",
  enrich_from_web: "web_research",
  // Enrichment
  enrichment: "enrichment",
  enrich_product: "enrichment",
  // Summarization
  summarization: "summarization",
  summarize: "summarization",
};

export function mapTaskTypeToCapability(taskType: string): CapabilityType {
  return TASK_TYPE_TO_CAPABILITY[taskType] ?? "content_generation";
}
```

- [ ] **Step 2: Verify it compiles**

Run: `deno check supabase/functions/_shared/ai/capability-matrix.ts`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/ai/capability-matrix.ts
git commit -m "feat: add capability-matrix.ts — static capability/provider defaults"
```

---

### Task 4: model-catalog.ts

**Files:**
- Create: `supabase/functions/_shared/ai/model-catalog.ts`

- [ ] **Step 1: Create model-catalog.ts with STATIC_CATALOG fallback**

```typescript
// supabase/functions/_shared/ai/model-catalog.ts
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ModelConfig, CapabilityType } from "./provider-types.ts";

// Static fallback — used when DB is unreachable. Must be kept in sync with seed data.
export const STATIC_CATALOG: ModelConfig[] = [
  { providerId: "anthropic", modelId: "claude-3-5-sonnet-20241022", displayName: "Claude 3.5 Sonnet",
    contextWindow: 200000, maxOutputTokens: 8192, supportsVision: true, supportsFunctionCalling: true,
    supportsJsonMode: false, inputCostPer1k: 0.003, outputCostPer1k: 0.015, status: "active",
    recommendedFor: ["content_generation", "reasoning", "extraction"], enabled: true },
  { providerId: "anthropic", modelId: "claude-3-5-haiku-20241022", displayName: "Claude 3.5 Haiku",
    contextWindow: 200000, maxOutputTokens: 8192, supportsVision: false, supportsFunctionCalling: true,
    supportsJsonMode: false, inputCostPer1k: 0.001, outputCostPer1k: 0.005, status: "active",
    recommendedFor: ["seo_generation", "translation", "summarization"], enabled: true },
  { providerId: "openai", modelId: "gpt-4o", displayName: "GPT-4o",
    contextWindow: 128000, maxOutputTokens: 4096, supportsVision: true, supportsFunctionCalling: true,
    supportsJsonMode: true, inputCostPer1k: 0.005, outputCostPer1k: 0.015, status: "active",
    recommendedFor: ["extraction", "reasoning", "multimodal_vision"], enabled: true },
  { providerId: "openai", modelId: "gpt-4o-mini", displayName: "GPT-4o Mini",
    contextWindow: 128000, maxOutputTokens: 4096, supportsVision: false, supportsFunctionCalling: true,
    supportsJsonMode: true, inputCostPer1k: 0.00015, outputCostPer1k: 0.0006, status: "active",
    recommendedFor: ["classification", "seo_generation"], enabled: true },
  { providerId: "gemini", modelId: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro",
    contextWindow: 1000000, maxOutputTokens: 8192, supportsVision: true, supportsFunctionCalling: true,
    supportsJsonMode: true, inputCostPer1k: 0.00125, outputCostPer1k: 0.005, status: "active",
    recommendedFor: ["web_research", "reasoning"], enabled: true },
  { providerId: "gemini", modelId: "gemini-2.5-flash-preview-04-17", displayName: "Gemini 2.5 Flash",
    contextWindow: 1000000, maxOutputTokens: 8192, supportsVision: true, supportsFunctionCalling: true,
    supportsJsonMode: true, inputCostPer1k: 0.00015, outputCostPer1k: 0.0006, status: "active",
    recommendedFor: ["multimodal_vision", "enrichment"], enabled: true },
];

function dbRowToModelConfig(row: Record<string, unknown>): ModelConfig {
  return {
    providerId: row.provider_id as string,
    modelId: row.model_id as string,
    displayName: row.display_name as string,
    contextWindow: (row.context_window as number) ?? 128000,
    maxOutputTokens: (row.max_output_tokens as number) ?? 4096,
    supportsVision: (row.supports_vision as boolean) ?? false,
    supportsFunctionCalling: (row.supports_function_calling as boolean) ?? false,
    supportsJsonMode: (row.supports_json_mode as boolean) ?? false,
    inputCostPer1k: parseFloat(String(row.input_cost_per_1k ?? "0")),
    outputCostPer1k: parseFloat(String(row.output_cost_per_1k ?? "0")),
    status: (row.status as "active" | "deprecated" | "experimental") ?? "active",
    recommendedFor: (row.recommended_for as CapabilityType[]) ?? [],
    enabled: (row.enabled as boolean) ?? true,
  };
}

export async function getModelsForProvider(
  supabase: SupabaseClient,
  providerId: string,
): Promise<ModelConfig[]> {
  try {
    const { data, error } = await supabase
      .from("ai_model_catalog")
      .select("*")
      .eq("provider_id", providerId)
      .eq("enabled", true)
      .eq("status", "active");
    if (error || !data?.length) {
      return STATIC_CATALOG.filter((m) => m.providerId === providerId && m.enabled);
    }
    return data.map(dbRowToModelConfig);
  } catch {
    return STATIC_CATALOG.filter((m) => m.providerId === providerId && m.enabled);
  }
}

export async function getModel(
  supabase: SupabaseClient,
  providerId: string,
  modelId: string,
): Promise<ModelConfig | null> {
  try {
    const { data } = await supabase
      .from("ai_model_catalog")
      .select("*")
      .eq("provider_id", providerId)
      .eq("model_id", modelId)
      .single();
    if (data) return dbRowToModelConfig(data);
  } catch { /* fall through */ }
  return STATIC_CATALOG.find((m) => m.providerId === providerId && m.modelId === modelId) ?? null;
}

export function estimateCost(
  model: ModelConfig | null,
  inputTokens: number,
  outputTokens: number,
): number {
  if (!model) return 0;
  return (inputTokens / 1000) * model.inputCostPer1k +
    (outputTokens / 1000) * model.outputCostPer1k;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `deno check supabase/functions/_shared/ai/model-catalog.ts`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/ai/model-catalog.ts
git commit -m "feat: add model-catalog.ts — DB-first model lookup with STATIC_CATALOG fallback"
```

---

### Task 5: invoke-provider.ts

**Files:**
- Create: `supabase/functions/_shared/ai/invoke-provider.ts`

- [ ] **Step 1: Create invoke-provider.ts with 3 format adapters**

```typescript
// supabase/functions/_shared/ai/invoke-provider.ts
import type { InvokeParams, InvokeResult } from "./provider-types.ts";
import { classifyError, classifyNetworkError } from "./error-classifier.ts";

const TIMEOUT_MS = 30_000; // 30s per spec. If Phase 3 vision tasks need longer, increase here only.

export async function invokeProvider(params: InvokeParams): Promise<InvokeResult> {
  switch (params.provider.format) {
    case "openai_compatible": return await invokeOpenAICompatible(params);
    case "anthropic":         return await invokeAnthropic(params);
    case "gemini":            return await invokeGemini(params);
    default: throw new Error(`Unknown provider format: ${(params.provider as { format: string }).format}`);
  }
}

// ─── Adapter 1: OpenAI-compatible (OpenAI, Mistral, Perplexity, DeepSeek, Grok) ───

async function invokeOpenAICompatible(params: InvokeParams): Promise<InvokeResult> {
  const apiKey = Deno.env.get(params.provider.apiKeyEnvVar);
  if (!apiKey) {
    const err = new ProviderError(`Missing env var: ${params.provider.apiKeyEnvVar}`, "auth_error");
    throw err;
  }

  const messages = buildMessages(params);
  const body: Record<string, unknown> = {
    model: params.model,
    messages,
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    ...(params.maxTokens != null ? { max_tokens: params.maxTokens } : {}),
    ...(params.jsonMode ? { response_format: { type: "json_object" } } : {}),
    ...(params.tools?.length ? { tools: params.tools, tool_choice: params.toolChoice ?? "auto" } : {}),
  };

  const startMs = Date.now();
  let resp: Response;
  try {
    resp = await fetchWithTimeout(params.provider.apiBaseUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ProviderError("Network error", classifyNetworkError(err));
  }

  const latencyMs = Date.now() - startMs;

  if (!resp.ok) {
    const text = await resp.text();
    throw new ProviderError(`${params.provider.id} ${resp.status}: ${text}`, classifyError(resp.status, text, params.provider.id));
  }

  let raw: Record<string, unknown>;
  try {
    raw = await resp.json() as Record<string, unknown>;
  } catch {
    throw new ProviderError("Failed to parse response JSON", "parse_error");
  }

  const choice = (raw.choices as Array<Record<string, unknown>>)?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;
  const content = (message?.content as string) ?? "";
  const finishReason = normalizeFinishReason(choice?.finish_reason as string);
  const usage = raw.usage as Record<string, number> | undefined;

  return {
    content,
    finishReason,
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    provider: params.provider.id,
    model: params.model,
    latencyMs,
    rawResponse: raw,
    normalizedResponse: {
      choices: [{
        message: { role: "assistant", content, tool_calls: message?.tool_calls as unknown[] | undefined },
        finish_reason: finishReason,
      }],
      usage: {
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? 0,
        total_tokens: usage?.total_tokens ?? 0,
      },
      model: raw.model as string ?? params.model,
    },
  };
}

// ─── Adapter 2: Anthropic native ───

async function invokeAnthropic(params: InvokeParams): Promise<InvokeResult> {
  const apiKey = Deno.env.get(params.provider.apiKeyEnvVar);
  if (!apiKey) throw new ProviderError(`Missing env var: ${params.provider.apiKeyEnvVar}`, "auth_error");

  const userMessages = params.messages.filter((m) => m.role !== "system");
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxTokens ?? 4096,
    system: params.systemPrompt || undefined,
    messages: userMessages,
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    ...(params.tools?.length ? { tools: params.tools, tool_choice: params.toolChoice } : {}),
  };

  const startMs = Date.now();
  let resp: Response;
  try {
    resp = await fetchWithTimeout(params.provider.apiBaseUrl, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ProviderError("Network error", classifyNetworkError(err));
  }

  const latencyMs = Date.now() - startMs;

  if (!resp.ok) {
    const text = await resp.text();
    throw new ProviderError(`anthropic ${resp.status}: ${text}`, classifyError(resp.status, text, "anthropic"));
  }

  let raw: Record<string, unknown>;
  try {
    raw = await resp.json() as Record<string, unknown>;
  } catch {
    throw new ProviderError("Failed to parse Anthropic response", "parse_error");
  }

  const contentBlocks = raw.content as Array<{ type: string; text?: string }> | undefined;
  const content = contentBlocks?.find((b) => b.type === "text")?.text ?? "";
  const finishReason = normalizeFinishReason(raw.stop_reason as string);
  const usage = raw.usage as { input_tokens: number; output_tokens: number } | undefined;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;

  return {
    content,
    finishReason,
    inputTokens,
    outputTokens,
    provider: params.provider.id,
    model: params.model,
    latencyMs,
    rawResponse: raw,
    normalizedResponse: {
      choices: [{ message: { role: "assistant", content }, finish_reason: finishReason }],
      usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
      model: params.model,
    },
  };
}

// ─── Adapter 3: Gemini native ───

async function invokeGemini(params: InvokeParams): Promise<InvokeResult> {
  const apiKey = Deno.env.get(params.provider.apiKeyEnvVar);
  if (!apiKey) throw new ProviderError(`Missing env var: ${params.provider.apiKeyEnvVar}`, "auth_error");

  const url = `${params.provider.apiBaseUrl}/models/${params.model}:generateContent?key=${apiKey}`;

  const contents = params.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const body: Record<string, unknown> = {
    contents,
    ...(params.systemPrompt ? { systemInstruction: { parts: [{ text: params.systemPrompt }] } } : {}),
    generationConfig: {
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
      ...(params.maxTokens != null ? { maxOutputTokens: params.maxTokens } : {}),
      ...(params.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };

  const startMs = Date.now();
  let resp: Response;
  try {
    resp = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ProviderError("Network error", classifyNetworkError(err));
  }

  const latencyMs = Date.now() - startMs;

  if (!resp.ok) {
    const text = await resp.text();
    throw new ProviderError(`gemini ${resp.status}: ${text}`, classifyError(resp.status, text, "gemini"));
  }

  let raw: Record<string, unknown>;
  try {
    raw = await resp.json() as Record<string, unknown>;
  } catch {
    throw new ProviderError("Failed to parse Gemini response", "parse_error");
  }

  const candidates = raw.candidates as Array<Record<string, unknown>> | undefined;
  const firstCandidate = candidates?.[0];
  const parts = (firstCandidate?.content as Record<string, unknown>)?.parts as Array<{ text?: string }> | undefined;
  const content = parts?.map((p) => p.text ?? "").join("") ?? "";
  const finishReason = normalizeFinishReason(firstCandidate?.finishReason as string);
  const usageMeta = raw.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;

  return {
    content,
    finishReason,
    inputTokens: usageMeta?.promptTokenCount ?? 0,
    outputTokens: usageMeta?.candidatesTokenCount ?? 0,
    provider: params.provider.id,
    model: params.model,
    latencyMs,
    rawResponse: raw,
    normalizedResponse: {
      choices: [{ message: { role: "assistant", content }, finish_reason: finishReason }],
      usage: {
        prompt_tokens: usageMeta?.promptTokenCount ?? 0,
        completion_tokens: usageMeta?.candidatesTokenCount ?? 0,
        total_tokens: (usageMeta?.promptTokenCount ?? 0) + (usageMeta?.candidatesTokenCount ?? 0),
      },
      model: params.model,
    },
  };
}

// ─── Helpers ───

function buildMessages(params: InvokeParams): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = [];
  if (params.systemPrompt) out.push({ role: "system", content: params.systemPrompt });
  out.push(...params.messages.filter((m) => m.role !== "system"));
  return out;
}

function normalizeFinishReason(raw: string | undefined): InvokeResult["finishReason"] {
  if (!raw) return "unknown";
  const lower = raw.toLowerCase();
  if (lower === "stop" || lower === "end_turn") return "stop";
  if (lower === "length" || lower === "max_tokens") return "length";
  if (lower === "tool_use" || lower === "tool_calls") return "tool_calls";
  if (lower.includes("safety") || lower.includes("filter") || lower === "recitation") return "content_filter";
  return "unknown";
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export class ProviderError extends Error {
  category: import("./provider-types.ts").ErrorCategory;
  constructor(message: string, category: import("./provider-types.ts").ErrorCategory) {
    super(message);
    this.category = category;
    this.name = "ProviderError";
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `deno check supabase/functions/_shared/ai/invoke-provider.ts`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/ai/invoke-provider.ts
git commit -m "feat: add invoke-provider.ts — OpenAI-compat, Anthropic, Gemini adapters"
```

---

### Task 6: fallback-policy.ts

**Note on design deviation from spec:** The spec defines `executeWithFallback` without an `invokeFn` parameter (it internally calls `invokeProvider`). The plan adds `invokeFn` as an explicit parameter to enable unit testing with mock providers. The production call site in `prompt-runner.ts` passes the real `invokeProvider` function. This deviation is intentional and documented.

**Files:**
- Create: `supabase/functions/_shared/ai/fallback-policy.ts`
- Create: `supabase/functions/_shared/ai/fallback-policy_test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/_shared/ai/fallback-policy_test.ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { executeWithFallback } from "./fallback-policy.ts";
import type { ProviderConfig } from "./provider-types.ts";
import { ProviderError } from "./invoke-provider.ts";

const mockProvider = (id: string): ProviderConfig => ({
  id, displayName: id, format: "openai_compatible",
  apiBaseUrl: "", apiKeyEnvVar: "FAKE_KEY",
  authScheme: "bearer", enabled: true, isLegacy: false, priority: 1,
});

const baseParams = { systemPrompt: "test", messages: [] as never[] };

Deno.test("executeWithFallback: succeeds on first provider", async () => {
  let callCount = 0;
  const result = await executeWithFallback(
    [{ provider: mockProvider("p1"), model: "m1" }],
    baseParams,
    async () => {
      callCount++;
      return { content: "ok", finishReason: "stop" as const, inputTokens: 10, outputTokens: 5,
        provider: "p1", model: "m1", latencyMs: 50, rawResponse: {}, normalizedResponse: { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, model: "m1" } };
    },
    { maxAttempts: 1, baseDelayMs: 0, backoffMultiplier: 1 },
  );
  assertEquals(result.fallbackUsed, false);
  assertEquals(callCount, 1);
});

Deno.test("executeWithFallback: falls back when first provider throws auth_error", async () => {
  let calls = 0;
  const result = await executeWithFallback(
    [{ provider: mockProvider("p1"), model: "m1" }, { provider: mockProvider("p2"), model: "m2" }],
    baseParams,
    async (p, _m) => {
      calls++;
      if (p.id === "p1") throw new ProviderError("auth failed", "auth_error");
      return { content: "fallback ok", finishReason: "stop" as const, inputTokens: 10, outputTokens: 5,
        provider: "p2", model: "m2", latencyMs: 50, rawResponse: {}, normalizedResponse: { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, model: "m2" } };
    },
    { maxAttempts: 2, baseDelayMs: 0, backoffMultiplier: 1 },
  );
  assertEquals(result.fallbackUsed, true);
  assertEquals(result.provider, "p2");
  assertEquals(calls, 2); // auth_error is not retried — goes to p2 immediately
});

Deno.test("executeWithFallback: retries rate_limit before moving to fallback", async () => {
  const calls: string[] = [];
  const result = await executeWithFallback(
    [{ provider: mockProvider("p1"), model: "m1" }, { provider: mockProvider("p2"), model: "m2" }],
    baseParams,
    async (p, _m) => {
      calls.push(p.id);
      if (p.id === "p1") throw new ProviderError("rate limited", "rate_limit");
      return { content: "ok", finishReason: "stop" as const, inputTokens: 5, outputTokens: 3,
        provider: "p2", model: "m2", latencyMs: 30, rawResponse: {}, normalizedResponse: { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }, model: "m2" } };
    },
    { maxAttempts: 2, baseDelayMs: 0, backoffMultiplier: 1 },
  );
  // p1 attempted 2 times (retry), then p2
  assertEquals(calls, ["p1", "p1", "p2"]);
  assertEquals(result.fallbackUsed, true);
});

Deno.test("executeWithFallback: throws AllProvidersFailedError when all fail", async () => {
  await assertRejects(
    () => executeWithFallback(
      [{ provider: mockProvider("p1"), model: "m1" }],
      baseParams,
      async () => { throw new ProviderError("always fails", "auth_error"); },
      { maxAttempts: 1, baseDelayMs: 0, backoffMultiplier: 1 },
    ),
    Error,
    "All providers failed",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/ai/fallback-policy_test.ts`
Expected: FAIL — `fallback-policy.ts` does not exist yet

- [ ] **Step 3: Implement fallback-policy.ts**

```typescript
// supabase/functions/_shared/ai/fallback-policy.ts
import type { InvokeParams, InvokeResult, ProviderConfig, RetryConfig, ErrorCategory } from "./provider-types.ts";
import { isRetryable } from "./error-classifier.ts";
import { ProviderError } from "./invoke-provider.ts";

export type InvokeFn = (
  provider: ProviderConfig,
  model: string,
  params: Omit<InvokeParams, "provider" | "model">,
) => Promise<InvokeResult>;

const DEFAULT_RETRY: RetryConfig = { maxAttempts: 2, baseDelayMs: 500, backoffMultiplier: 2 };

export async function executeWithFallback(
  chain: Array<{ provider: ProviderConfig; model: string }>,
  baseParams: Omit<InvokeParams, "provider" | "model">,
  invokeFn: InvokeFn,
  retryConfig: RetryConfig = DEFAULT_RETRY,
): Promise<InvokeResult & {
  fallbackUsed: boolean;
  attemptedProviders: string[];
  attemptedModels: string[];
  errorCategories: Array<{ provider: string; category: ErrorCategory }>;
}> {
  const attemptedProviders: string[] = [];
  const attemptedModels: string[] = [];
  const errorCategories: Array<{ provider: string; category: ErrorCategory }> = [];

  for (let i = 0; i < chain.length; i++) {
    const { provider, model } = chain[i];
    attemptedProviders.push(provider.id);
    attemptedModels.push(model);

    let lastCategory: ErrorCategory = "unknown_error";

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const result = await invokeFn(provider, model, baseParams);
        return {
          ...result,
          fallbackUsed: i > 0,
          attemptedProviders,
          attemptedModels,
          errorCategories,
        };
      } catch (err) {
        const category = err instanceof ProviderError ? err.category : "unknown_error";
        lastCategory = category;

        if (!isRetryable(category)) break; // non-retryable: skip remaining attempts for this provider

        if (attempt < retryConfig.maxAttempts) {
          const delay = retryConfig.baseDelayMs * Math.pow(retryConfig.backoffMultiplier, attempt - 1);
          await sleep(delay);
        }
      }
    }

    errorCategories.push({ provider: provider.id, category: lastCategory });
  }

  throw new Error(
    `All providers failed. Attempted: ${attemptedProviders.join(", ")}. ` +
    `Errors: ${errorCategories.map((e) => `${e.provider}=${e.category}`).join(", ")}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/_shared/ai/fallback-policy_test.ts`
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/fallback-policy.ts supabase/functions/_shared/ai/fallback-policy_test.ts
git commit -m "feat: add fallback-policy.ts — retry + provider fallback with separated concerns"
```

---

### Task 7: usage-logger.ts

**Files:**
- Create: `supabase/functions/_shared/ai/usage-logger.ts`

- [ ] **Step 1: Create usage-logger.ts**

```typescript
// supabase/functions/_shared/ai/usage-logger.ts
// Fire-and-forget. Never throws. Errors are console.warn'd, not propagated.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { UsageLogEntry } from "./provider-types.ts";

export async function logUsage(
  supabase: SupabaseClient,
  entry: UsageLogEntry,
): Promise<void> {
  try {
    const { error } = await supabase.from("ai_usage_logs").insert({
      workspace_id: entry.workspaceId,
      task_type: entry.taskType ?? null,
      capability: entry.capability,
      provider_id: entry.provider,
      model_name: entry.model,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      estimated_cost: entry.estimatedCostUsd,
      fallback_used: entry.fallbackUsed,
      decision_source: entry.decisionSource,
      latency_ms: entry.latencyMs,
      error_category: entry.errorCategory ?? null,
      is_shadow: entry.isShadow,
    });
    if (error) {
      console.warn("[usage-logger] Failed to log usage:", error.message);
    }
  } catch (err) {
    console.warn("[usage-logger] Unexpected error:", err);
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `deno check supabase/functions/_shared/ai/usage-logger.ts`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/ai/usage-logger.ts
git commit -m "feat: add usage-logger.ts — fire-and-forget ai_usage_logs writer"
```

---

### Task 8: provider-registry.ts

**Files:**
- Create: `supabase/functions/_shared/ai/provider-registry.ts`

- [ ] **Step 1: Create provider-registry.ts**

```typescript
// supabase/functions/_shared/ai/provider-registry.ts
// Resolves full ResolvedRoute from workspace + capability context.
// INVARIANT: never reads api_key from DB. All keys come from Deno.env.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ProviderConfig, ResolvedRoute, RunPromptParams } from "./provider-types.ts";
import { CAPABILITY_DEFAULTS } from "./capability-matrix.ts";

// Static provider configs (source of truth for API metadata — DB provides enable/priority overrides)
const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  anthropic: { id: "anthropic", displayName: "Anthropic", format: "anthropic",
    apiBaseUrl: "https://api.anthropic.com/v1/messages", apiKeyEnvVar: "ANTHROPIC_API_KEY",
    authScheme: "x-api-key", enabled: true, isLegacy: false, priority: 1 },
  openai: { id: "openai", displayName: "OpenAI", format: "openai_compatible",
    apiBaseUrl: "https://api.openai.com/v1/chat/completions", apiKeyEnvVar: "OPENAI_API_KEY",
    authScheme: "bearer", enabled: true, isLegacy: false, priority: 2 },
  gemini: { id: "gemini", displayName: "Gemini", format: "gemini",
    apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKeyEnvVar: "GEMINI_API_KEY",
    authScheme: "query_param", enabled: true, isLegacy: false, priority: 3 },
  mistral: { id: "mistral", displayName: "Mistral", format: "openai_compatible",
    apiBaseUrl: "https://api.mistral.ai/v1/chat/completions", apiKeyEnvVar: "MISTRAL_API_KEY",
    authScheme: "bearer", enabled: false, isLegacy: false, priority: 10 },
  perplexity: { id: "perplexity", displayName: "Perplexity", format: "openai_compatible",
    apiBaseUrl: "https://api.perplexity.ai/chat/completions", apiKeyEnvVar: "PERPLEXITY_API_KEY",
    authScheme: "bearer", enabled: false, isLegacy: false, priority: 11 },
  deepseek: { id: "deepseek", displayName: "DeepSeek", format: "openai_compatible",
    apiBaseUrl: "https://api.deepseek.com/v1/chat/completions", apiKeyEnvVar: "DEEPSEEK_API_KEY",
    authScheme: "bearer", enabled: false, isLegacy: false, priority: 12 },
  grok: { id: "grok", displayName: "Grok", format: "openai_compatible",
    apiBaseUrl: "https://api.x.ai/v1/chat/completions", apiKeyEnvVar: "GROK_API_KEY",
    authScheme: "bearer", enabled: false, isLegacy: false, priority: 13 },
  lovable_gateway: { id: "lovable_gateway", displayName: "Lovable Gateway", format: "openai_compatible",
    apiBaseUrl: "https://ai.gateway.lovable.dev/v1/chat/completions", apiKeyEnvVar: "LOVABLE_API_KEY",
    authScheme: "bearer", enabled: false, isLegacy: true, priority: 99 },
};

function getProvider(id: string): ProviderConfig | null {
  return PROVIDER_CONFIGS[id] ?? null;
}

function isKeyAvailable(provider: ProviderConfig): boolean {
  return !!Deno.env.get(provider.apiKeyEnvVar);
}

function buildChain(
  primaryProvider: ProviderConfig,
  primaryModel: string,
  fallbackSpecs: Array<{ provider: string; model: string }>,
): Array<{ provider: ProviderConfig; model: string }> {
  const chain: Array<{ provider: ProviderConfig; model: string }> = [];

  if (isKeyAvailable(primaryProvider)) {
    chain.push({ provider: primaryProvider, model: primaryModel });
  } else {
    console.warn(`[provider-registry] Key not available for ${primaryProvider.id} — skipping`);
  }

  for (const fb of fallbackSpecs) {
    const p = getProvider(fb.provider);
    if (p && isKeyAvailable(p)) {
      chain.push({ provider: p, model: fb.model });
    } else if (p) {
      console.warn(`[provider-registry] Key not available for fallback ${p.id} — skipping`);
    }
  }

  return chain;
}

export async function resolveRoute(
  supabase: SupabaseClient,
  params: RunPromptParams,
): Promise<ResolvedRoute> {
  const { workspaceId, capability, taskType, providerOverride, modelOverride } = params;

  // 1. Check ai_routing_rules (workspace + task_type)
  if (taskType) {
    try {
      const { data: rule } = await supabase
        .from("ai_routing_rules")
        .select("provider_id, model_override, fallback_provider_id, fallback_model")
        .eq("workspace_id", workspaceId)
        .eq("task_type", taskType)
        .eq("is_active", true)
        .single();

      if (rule?.provider_id) {
        const p = getProvider(rule.provider_id);
        const model = modelOverride ?? rule.model_override ?? getDefaultModelForProvider(rule.provider_id);
        const fallbackProvider = rule.fallback_provider_id ? getProvider(rule.fallback_provider_id) : null;
        const fallbackModel = rule.fallback_model ?? (fallbackProvider ? getDefaultModelForProvider(rule.fallback_provider_id!) : undefined);

        if (p) {
          const chain = buildChain(p, model!, [
            ...(fallbackProvider && fallbackModel ? [{ provider: fallbackProvider.id, model: fallbackModel }] : []),
            ...getCapabilityFallbacks(capability),
          ]);
          if (chain.length > 0) {
            return { selectedProvider: chain[0].provider, selectedModel: chain[0].model,
              fallbackChain: chain.slice(1), finalParams: {}, decisionSource: "routing_rule" };
          }
        }
      }
    } catch { /* no rule found — continue */ }
  }

  // 2. Check workspace_ai_preferences (specific capability)
  // 3. Check workspace_ai_preferences ('*' global default)
  for (const cap of [capability, "*"]) {
    try {
      const { data: pref } = await supabase
        .from("workspace_ai_preferences")
        .select("provider_id, model_id, fallback_provider_id, fallback_model_id, temperature, max_tokens, json_mode")
        .eq("workspace_id", workspaceId)
        .eq("capability", cap)
        .eq("enabled", true)
        .single();

      if (pref?.provider_id) {
        const p = getProvider(pref.provider_id);
        const model = modelOverride ?? pref.model_id ?? getDefaultModelForProvider(pref.provider_id);
        if (p && model) {
          const fallbacks = getCapabilityFallbacks(capability);
          const chain = buildChain(p, model, fallbacks);
          if (chain.length > 0) {
            return {
              selectedProvider: chain[0].provider, selectedModel: chain[0].model,
              fallbackChain: chain.slice(1),
              finalParams: {
                temperature: pref.temperature ?? undefined,
                maxTokens: pref.max_tokens ?? undefined,
                jsonMode: pref.json_mode ?? undefined,
              },
              decisionSource: "workspace_preference",
            };
          }
        }
      }
    } catch { /* no preference — continue */ }
  }

  // 4. CAPABILITY_DEFAULTS
  const defaults = CAPABILITY_DEFAULTS[capability];
  if (defaults) {
    const override = providerOverride ? getProvider(providerOverride) : null;
    const primaryProvider = override ?? getProvider(defaults.provider)!;
    const primaryModel = modelOverride ?? (override ? getDefaultModelForProvider(providerOverride!) : defaults.model);
    const chain = buildChain(primaryProvider, primaryModel!, defaults.fallback);
    if (chain.length > 0) {
      return { selectedProvider: chain[0].provider, selectedModel: chain[0].model,
        fallbackChain: chain.slice(1), finalParams: {}, decisionSource: "capability_default" };
    }
  }

  // 5. System default: Anthropic → OpenAI → Gemini
  const systemChain = buildChain(
    PROVIDER_CONFIGS["anthropic"]!, "claude-3-5-sonnet-20241022",
    [{ provider: "openai", model: "gpt-4o" }, { provider: "gemini", model: "gemini-2.5-pro" }],
  );
  if (systemChain.length === 0) throw new Error("No AI providers available — check Deno.env secrets");

  return { selectedProvider: systemChain[0].provider, selectedModel: systemChain[0].model,
    fallbackChain: systemChain.slice(1), finalParams: {}, decisionSource: "system_default" };
}

function getDefaultModelForProvider(providerId: string): string {
  const defaults: Record<string, string> = {
    anthropic: "claude-3-5-sonnet-20241022",
    openai: "gpt-4o",
    gemini: "gemini-2.5-pro",
    mistral: "mistral-large-latest",
    perplexity: "sonar-pro",
    deepseek: "deepseek-chat",
    grok: "grok-2",
  };
  return defaults[providerId] ?? "gpt-4o";
}

function getCapabilityFallbacks(capability: string): Array<{ provider: string; model: string }> {
  return CAPABILITY_DEFAULTS[capability as keyof typeof CAPABILITY_DEFAULTS]?.fallback ?? [
    { provider: "openai", model: "gpt-4o" },
    { provider: "gemini", model: "gemini-2.5-pro" },
  ];
}
```

- [ ] **Step 2: Verify it compiles**

Run: `deno check supabase/functions/_shared/ai/provider-registry.ts`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/ai/provider-registry.ts
git commit -m "feat: add provider-registry.ts — 5-level route resolution with Deno.env key guard"
```

---

### Task 9: prompt-runner.ts

**Files:**
- Create: `supabase/functions/_shared/ai/prompt-runner.ts`

- [ ] **Step 1: Create prompt-runner.ts**

```typescript
// supabase/functions/_shared/ai/prompt-runner.ts
// Single entry point for all AI calls in edge functions.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { InvokeParams, InvokeResult, RunMeta, RunPromptParams } from "./provider-types.ts";
import { resolveRoute } from "./provider-registry.ts";
import { executeWithFallback } from "./fallback-policy.ts";
import { invokeProvider } from "./invoke-provider.ts";
import { logUsage } from "./usage-logger.ts";
import { getModel, estimateCost } from "./model-catalog.ts";

export async function runPrompt(
  supabase: SupabaseClient,
  params: RunPromptParams,
): Promise<{ result: InvokeResult; meta: RunMeta }> {
  // Feature flag: kill-switch
  const routerEnabled = Deno.env.get("AI_ROUTER_ENABLED");
  if (routerEnabled === "false") {
    throw new Error("AI router disabled (AI_ROUTER_ENABLED=false)");
  }

  const shadowMode = Deno.env.get("AI_ROUTER_SHADOW_MODE") === "true";

  const route = await resolveRoute(supabase, params);
  const { selectedProvider, selectedModel, fallbackChain, finalParams } = route;

  const chain = [
    { provider: selectedProvider, model: selectedModel },
    ...fallbackChain,
  ];

  const baseInvokeParams: Omit<InvokeParams, "provider" | "model"> = {
    systemPrompt: params.systemPrompt,
    messages: (params.messages ?? (params.userPrompt ? [{ role: "user" as const, content: params.userPrompt }] : [])) as InvokeParams["messages"],
    temperature: params.temperature ?? finalParams.temperature,
    maxTokens: params.maxTokens ?? finalParams.maxTokens,
    jsonMode: params.jsonMode ?? finalParams.jsonMode,
    tools: params.tools,
    toolChoice: params.toolChoice,
  };

  const invokeFn = (
    provider: typeof selectedProvider,
    model: string,
    p: typeof baseInvokeParams,
  ) => invokeProvider({ provider, model, ...p });

  const raw = await executeWithFallback(chain, baseInvokeParams, invokeFn);

  // Cost estimation
  const modelConfig = await getModel(supabase, raw.provider, raw.model);
  const estimatedCostUsd = estimateCost(modelConfig, raw.inputTokens, raw.outputTokens);

  // Surface the last error category encountered (present when fallback was used)
  const lastErrorCategory = raw.errorCategories.length > 0
    ? raw.errorCategories[raw.errorCategories.length - 1].category
    : undefined;

  const meta: RunMeta = {
    provider: raw.provider,
    model: raw.model,
    fallbackUsed: raw.fallbackUsed,
    attemptedProviders: raw.attemptedProviders,
    attemptedModels: raw.attemptedModels,
    decisionSource: route.decisionSource,
    errorCategory: lastErrorCategory,
    latencyMs: raw.latencyMs,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    estimatedCostUsd,
    shadowMode,
  };

  // Fire-and-forget usage log
  logUsage(supabase, {
    workspaceId: params.workspaceId,
    taskType: params.taskType,
    capability: params.capability,
    provider: raw.provider,
    model: raw.model,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    estimatedCostUsd,
    fallbackUsed: raw.fallbackUsed,
    decisionSource: route.decisionSource,
    latencyMs: raw.latencyMs,
    errorCategory: meta.errorCategory,
    isShadow: shadowMode,
  });

  return { result: raw, meta };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `deno check supabase/functions/_shared/ai/prompt-runner.ts`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/ai/prompt-runner.ts
git commit -m "feat: add prompt-runner.ts — AI orchestrator with feature flags and cost tracking"
```

---

### Task 10: SQL migrations

**Files:**
- Create: `supabase/migrations/20260319000001_ai_provider_registry_and_preferences.sql`
- Create: `supabase/migrations/20260319000002_ai_model_catalog.sql`
- Create: `supabase/migrations/20260319000003_extend_ai_usage_logs.sql`
- Create: `supabase/migrations/20260319000004_seed_ai_providers.sql`

- [ ] **Step 1: Create migration 1 — provider registry and workspace preferences**

```sql
-- supabase/migrations/20260319000001_ai_provider_registry_and_preferences.sql

CREATE TABLE IF NOT EXISTS ai_provider_registry (
  id              TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  api_base_url    TEXT NOT NULL,
  api_key_env_var TEXT NOT NULL,
  auth_scheme     TEXT NOT NULL DEFAULT 'bearer',
  request_format  TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  is_legacy       BOOLEAN NOT NULL DEFAULT FALSE,
  priority        INT NOT NULL DEFAULT 50,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_ai_preferences (
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

ALTER TABLE ai_provider_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_ai_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_registry"
  ON ai_provider_registry FOR ALL TO service_role USING (true);

CREATE POLICY "workspace_members_read_preferences"
  ON workspace_ai_preferences FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "service_role_full_access_preferences"
  ON workspace_ai_preferences FOR ALL TO service_role USING (true);
```

- [ ] **Step 2: Create migration 2 — model catalog**

```sql
-- supabase/migrations/20260319000002_ai_model_catalog.sql

CREATE TABLE IF NOT EXISTS ai_model_catalog (
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

- [ ] **Step 3: Create migration 3 — extend ai_usage_logs**

```sql
-- supabase/migrations/20260319000003_extend_ai_usage_logs.sql

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
-- Use for cost analysis and confirming shadow traffic before decommissioning a provider.
```

- [ ] **Step 4: Create migration 4 — seed provider registry and model catalog**

```sql
-- supabase/migrations/20260319000004_seed_ai_providers.sql

INSERT INTO ai_provider_registry (id, display_name, api_base_url, api_key_env_var, auth_scheme, request_format, enabled, is_legacy, priority) VALUES
  ('anthropic',       'Anthropic (Claude)', 'https://api.anthropic.com/v1/messages',                              'ANTHROPIC_API_KEY',  'x-api-key',  'anthropic',         true,  false, 1),
  ('openai',          'OpenAI',             'https://api.openai.com/v1/chat/completions',                         'OPENAI_API_KEY',     'bearer',     'openai_compatible', true,  false, 2),
  ('gemini',          'Google Gemini',      'https://generativelanguage.googleapis.com/v1beta',                   'GEMINI_API_KEY',     'query_param','gemini',            true,  false, 3),
  ('mistral',         'Mistral',            'https://api.mistral.ai/v1/chat/completions',                         'MISTRAL_API_KEY',    'bearer',     'openai_compatible', false, false, 10),
  ('perplexity',      'Perplexity',         'https://api.perplexity.ai/chat/completions',                         'PERPLEXITY_API_KEY', 'bearer',     'openai_compatible', false, false, 11),
  ('deepseek',        'DeepSeek',           'https://api.deepseek.com/v1/chat/completions',                       'DEEPSEEK_API_KEY',   'bearer',     'openai_compatible', false, false, 12),
  ('grok',            'Grok (xAI)',         'https://api.x.ai/v1/chat/completions',                               'GROK_API_KEY',       'bearer',     'openai_compatible', false, false, 13),
  ('lovable_gateway', 'Lovable Gateway',    'https://ai.gateway.lovable.dev/v1/chat/completions',                 'LOVABLE_API_KEY',    'bearer',     'openai_compatible', false, true,  99)
ON CONFLICT (id) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  is_legacy = EXCLUDED.is_legacy,
  updated_at = now();

INSERT INTO ai_model_catalog (provider_id, model_id, display_name, context_window, max_output_tokens, supports_vision, supports_function_calling, supports_json_mode, input_cost_per_1k, output_cost_per_1k, status, recommended_for, enabled) VALUES
  -- Anthropic
  ('anthropic', 'claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet', 200000, 8192, true,  true,  false, 0.003,   0.015,   'active',     ARRAY['content_generation','reasoning','extraction'], true),
  ('anthropic', 'claude-3-5-haiku-20241022',  'Claude 3.5 Haiku',  200000, 8192, false, true,  false, 0.001,   0.005,   'active',     ARRAY['seo_generation','translation','summarization'], true),
  ('anthropic', 'claude-3-opus-20240229',     'Claude 3 Opus',     200000, 4096, true,  true,  false, 0.015,   0.075,   'active',     ARRAY['reasoning'], true),
  -- OpenAI
  ('openai',    'gpt-4o',                     'GPT-4o',            128000, 4096, true,  true,  true,  0.005,   0.015,   'active',     ARRAY['extraction','reasoning','multimodal_vision'], true),
  ('openai',    'gpt-4o-mini',                'GPT-4o Mini',       128000, 4096, false, true,  true,  0.00015, 0.0006,  'active',     ARRAY['classification','seo_generation'], true),
  -- Gemini
  ('gemini',    'gemini-2.5-pro',                  'Gemini 2.5 Pro',         1000000, 8192, true, true, true, 0.00125, 0.005,  'active',     ARRAY['web_research','reasoning'], true),
  ('gemini',    'gemini-2.5-flash-preview-04-17',  'Gemini 2.5 Flash',       1000000, 8192, true, true, true, 0.00015, 0.0006, 'active',     ARRAY['multimodal_vision','enrichment'], true),
  ('gemini',    'gemini-1.5-pro',                  'Gemini 1.5 Pro (Legacy)',1000000, 8192, true, true, true, 0.00125, 0.005,  'deprecated', ARRAY[]::TEXT[], false),
  -- Mistral (prepared)
  ('mistral',     'mistral-large-latest', 'Mistral Large', 131072, 4096, false, true, true, 0.003,   0.009,   'active', ARRAY['content_generation'], false),
  ('mistral',     'mistral-small-latest', 'Mistral Small', 131072, 4096, false, true, true, 0.001,   0.003,   'active', ARRAY['classification'], false),
  -- Perplexity (prepared)
  ('perplexity',  'sonar-pro', 'Sonar Pro', 200000, 8000, false, false, false, 0.003, 0.015, 'active', ARRAY['web_research'], false),
  ('perplexity',  'sonar',     'Sonar',     127072, 8000, false, false, false, 0.001, 0.001, 'active', ARRAY['web_research'], false),
  -- DeepSeek (prepared)
  ('deepseek',    'deepseek-chat',     'DeepSeek Chat',     64000, 4096, false, false, true, 0.00014, 0.00028, 'active', ARRAY['content_generation'], false),
  ('deepseek',    'deepseek-reasoner', 'DeepSeek Reasoner', 64000, 4096, false, false, true, 0.00055, 0.00219, 'active', ARRAY['reasoning'], false),
  -- Grok (prepared)
  ('grok',        'grok-2', 'Grok 2', 131072, 4096, true, true, false, 0.002, 0.010, 'active', ARRAY['reasoning'], false)
ON CONFLICT (provider_id, model_id) DO NOTHING;
```

- [ ] **Step 5: Apply migrations in Supabase dashboard (or via CLI)**

Either:
- Go to Supabase Dashboard → SQL Editor → run each file in order (001, 002, 003, 004)
- Or: `supabase db push` if CLI is configured

Expected: no errors, new tables visible in Table Editor

- [ ] **Step 6: Commit migration files**

```bash
git add supabase/migrations/20260319000001_ai_provider_registry_and_preferences.sql
git add supabase/migrations/20260319000002_ai_model_catalog.sql
git add supabase/migrations/20260319000003_extend_ai_usage_logs.sql
git add supabase/migrations/20260319000004_seed_ai_providers.sql
git commit -m "feat: add SQL migrations for ai_provider_registry, ai_model_catalog, extended ai_usage_logs"
```

---

### Task 11: Refactor resolve-ai-route

**Files:**
- Modify: `supabase/functions/resolve-ai-route/index.ts` (rewrite ~240 → ~80 lines)
- Create: `supabase/functions/resolve-ai-route/legacy-compat.ts`

- [ ] **Step 1: Create legacy-compat.ts**

```typescript
// supabase/functions/resolve-ai-route/legacy-compat.ts
// Converts InvokeResult → OpenAI-format response object.
// All existing callers receive the same shape they always have.
import type { InvokeResult } from "../_shared/ai/provider-types.ts";

export function toLegacyResponse(result: InvokeResult): unknown {
  return result.normalizedResponse;
}
```

- [ ] **Step 2: Read the current resolve-ai-route/index.ts to understand the resolvePromptTemplate logic**

Read: `supabase/functions/resolve-ai-route/index.ts` lines 20-47
These are the `ai_routing_rules` + `prompt_versions` queries — extract them into a helper.

- [ ] **Step 3: Rewrite resolve-ai-route/index.ts as thin HTTP wrapper**

```typescript
// supabase/functions/resolve-ai-route/index.ts
// Thin HTTP wrapper (~80 lines). Business logic lives in _shared/ai/.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runPrompt } from "../_shared/ai/prompt-runner.ts";
import { mapTaskTypeToCapability } from "../_shared/ai/capability-matrix.ts";
import { toLegacyResponse } from "./legacy-compat.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { taskType, workspaceId, messages, systemPrompt, options, modelOverride } =
      await req.json();
    if (!taskType || !workspaceId) throw new Error("taskType and workspaceId required");

    // Resolve prompt from prompt_templates/prompt_versions if a routing rule specifies one.
    // This is EXISTING logic from the old resolve-ai-route — no new implementation needed.
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

    return new Response(
      JSON.stringify({
        result: toLegacyResponse(result),
        meta: {
          usedProvider: meta.provider,
          usedModel: meta.model,
          fallbackUsed: meta.fallbackUsed,
          latencyMs: meta.latencyMs,
          taskType,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Resolves the system prompt from prompt_templates/prompt_versions.
// If a routing rule specifies a prompt_template_id, use the active version.
// Falls back to the provided systemPrompt if no rule/template found.
async function resolvePromptTemplate(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  taskType: string,
  fallbackPrompt: string,
): Promise<string> {
  try {
    const { data: rule } = await supabase
      .from("ai_routing_rules")
      .select("prompt_template_id, prompt:prompt_template_id(base_prompt)")
      .eq("workspace_id", workspaceId)
      .eq("task_type", taskType)
      .eq("is_active", true)
      .single();

    if (rule?.prompt_template_id) {
      const { data: version } = await supabase
        .from("prompt_versions")
        .select("prompt_text")
        .eq("template_id", rule.prompt_template_id)
        .eq("is_active", true)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (version?.prompt_text) return version.prompt_text;
      const basePrompt = (rule.prompt as { base_prompt?: string } | null)?.base_prompt;
      if (basePrompt) return basePrompt;
    }
  } catch { /* no rule or template — use fallback */ }

  return fallbackPrompt || "";
}
```

- [ ] **Step 4: Verify it compiles**

Run: `deno check supabase/functions/resolve-ai-route/index.ts`
Expected: no output (success)

- [ ] **Step 5: Deploy to staging and run smoke test**

```bash
# Deploy resolve-ai-route
supabase functions deploy resolve-ai-route

# Smoke test: call with a real workspaceId
curl -s -X POST \
  "${SUPABASE_URL}/functions/v1/resolve-ai-route" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"taskType":"content_generation","workspaceId":"<real-workspace-id>","systemPrompt":"Return JSON: {\"ok\":true}","messages":[{"role":"user","content":"ping"}],"options":{"response_format":{"type":"json_object"}}}' | jq .
```

Expected: `{"result":{"choices":[...],"usage":{...},"model":"..."},"meta":{"usedProvider":"anthropic","usedModel":"claude-3-5-sonnet-20241022",...}}`

- [ ] **Step 6: Verify ai_usage_logs has new provider_id column populated**

Run in Supabase SQL editor:
```sql
SELECT provider_id, capability, latency_ms, fallback_used
FROM ai_usage_logs
ORDER BY created_at DESC
LIMIT 5;
```
Expected: `provider_id` = 'anthropic' (or 'openai'/'gemini'), NOT 'lovable_gateway'

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/resolve-ai-route/index.ts supabase/functions/resolve-ai-route/legacy-compat.ts
git commit -m "feat: refactor resolve-ai-route as thin wrapper using shared AI layer"
```

---

**Phase 1 Validation Gate**

Before proceeding to Phase 2, confirm all of the following:

- [ ] `resolve-ai-route` smoke test returns success with `usedProvider` = 'anthropic'|'openai'|'gemini'
- [ ] `ai_usage_logs.provider_id` shows active providers (never 'lovable_gateway')
- [ ] `deno check` passes on all 9 shared modules
- [ ] Fallback test: temporarily unset ANTHROPIC_API_KEY → confirms fallback to OpenAI (check logs)

---

## Phase 2 — Migrate Direct Lovable Callers

### Task 12: translate-product

**Files:**
- Modify: `supabase/functions/translate-product/index.ts`

**Note:** `translate-product` already calls `resolve-ai-route` via HTTP (line 132). It does NOT call Lovable directly for business logic. The only change needed is removing the unused `lovableKey` variable declaration on line 16.

- [ ] **Step 1: Remove the unused lovableKey declaration**

In `supabase/functions/translate-product/index.ts`, remove line 16:
```typescript
// REMOVE this line:
const lovableKey = Deno.env.get("LOVABLE_API_KEY")!;
```

- [ ] **Step 2: Verify file still compiles**

Run: `deno check supabase/functions/translate-product/index.ts`
Expected: no output (success)

- [ ] **Step 3: Deploy and verify**

```bash
supabase functions deploy translate-product
```

Check `ai_usage_logs` after a translation: `provider_id` should be 'anthropic'|'openai'|'gemini'.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/translate-product/index.ts
git commit -m "feat: remove unused LOVABLE_API_KEY from translate-product (already routes via resolve-ai-route)"
```

---

### Task 13: enrich-products

**Files:**
- Modify: `supabase/functions/enrich-products/index.ts`

**Note:** `enrich-products` has a direct Lovable call via `parseWithAI(lovableApiKey, ...)` at line 355. This function (starting at L623) calls `https://ai.gateway.lovable.dev` directly. Replace with a `prompt-runner.ts` call using `capability: 'enrichment'`.

- [ ] **Step 1: Read the full parseWithAI function (L623 to end of file)**

Read: `supabase/functions/enrich-products/index.ts` lines 623–849
Understand the system prompt structure and expected JSON return shape before modifying.

- [ ] **Step 2: Add the import for prompt-runner at the top of the file**

In `supabase/functions/enrich-products/index.ts`, after the existing imports, add:
```typescript
import { runPrompt } from "../_shared/ai/prompt-runner.ts";
import type { CapabilityType } from "../_shared/ai/provider-types.ts";
```

- [ ] **Step 3: Remove the lovableApiKey declaration (line 52)**

Remove:
```typescript
const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
```

- [ ] **Step 4: Replace the parseWithAI call site (lines 349–355)**

Change from:
```typescript
if (lovableApiKey) {
  const supplierInstructions = matchedPrefix?.scrapingInstructions
    || scrapingInstructions[matchedPrefix?.name]
    || Object.values(scrapingInstructions)[0]
    || '';
  aiParsed = await parseWithAI(lovableApiKey, markdown, sku, product.original_title || '', supplierInstructions, html);
}
```

Change to:
```typescript
{
  const supplierInstructions = matchedPrefix?.scrapingInstructions
    || scrapingInstructions[matchedPrefix?.name]
    || Object.values(scrapingInstructions)[0]
    || '';
  aiParsed = await parseWithAI(supabase, workspace_id, markdown, sku, product.original_title || '', supplierInstructions, html);
}
```

- [ ] **Step 5: Rewrite the parseWithAI function signature to use prompt-runner**

Find the function starting at L623:
```typescript
async function parseWithAI(apiKey: string, markdown: string, ...
```

Change its signature and body to use `runPrompt`:
```typescript
async function parseWithAI(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  markdown: string,
  sku: string,
  title: string,
  instructions: string,
  html: string = '',
): Promise<unknown> {
  try {
    // [Keep the existing systemPrompt and userPrompt construction unchanged]
    // Only change: replace the fetch() call to Lovable with runPrompt()

    const { result } = await runPrompt(supabase, {
      workspaceId,
      capability: 'enrichment' as CapabilityType,
      taskType: 'enrich_product',
      systemPrompt: systemPrompt,  // use the same systemPrompt built earlier in the function
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 4096,
      jsonMode: true,
    });

    const content = result.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('parseWithAI error:', e);
    return null;
  }
}
```

**Important:** Keep all the existing `systemPrompt` and `userPrompt` string construction code inside `parseWithAI` unchanged. Only replace the `fetch()` call to `https://ai.gateway.lovable.dev` with `runPrompt()`.

- [ ] **Step 6: Remove the lovableApiKey guard on the result (line 583)**

Change `aiParsed: !!lovableApiKey` to `aiParsed: !!aiParsed` in the logging/result object.

- [ ] **Step 7: Verify the file compiles**

Run: `deno check supabase/functions/enrich-products/index.ts`
Expected: no output (success)

- [ ] **Step 8: Deploy and verify**

```bash
supabase functions deploy enrich-products
```

Trigger an enrichment run. Check `ai_usage_logs`: `provider_id` should be 'gemini' (enrichment capability default).

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/enrich-products/index.ts
git commit -m "feat: migrate enrich-products — replace direct Lovable call with shared AI layer"
```

---

### Task 14: optimize-product

**Files:**
- Modify: `supabase/functions/optimize-product/index.ts`

**Note:** `optimize-product` calls `resolve-ai-route` via HTTP (like `translate-product`). The only change is removing any remaining `LOVABLE_API_KEY` references.

- [ ] **Step 1: Check for LOVABLE_API_KEY usage**

```bash
grep -n "LOVABLE_API_KEY\|lovable_gateway\|ai\.gateway" supabase/functions/optimize-product/index.ts
```

- [ ] **Step 2: If any found, remove them**

If `LOVABLE_API_KEY` is declared but unused (like `translate-product`), remove the line.
If it is actively used in a fetch, replace with `runPrompt()` using `capability: 'content_generation'`.

- [ ] **Step 3: Verify the file compiles**

Run: `deno check supabase/functions/optimize-product/index.ts`
Expected: no output (success)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/optimize-product/index.ts
git commit -m "feat: remove LOVABLE_API_KEY from optimize-product"
```

---

### Task 15: analyze-product-page

**Files:**
- Modify: `supabase/functions/analyze-product-page/index.ts`

**Note:** `analyze-product-page` calls `https://ai.gateway.lovable.dev` directly at line 92. Replace with `runPrompt()` using `capability: 'extraction'`.

- [ ] **Step 1: Read the full file**

Read: `supabase/functions/analyze-product-page/index.ts` (150 lines)
Understand the system prompt and expected response shape.

- [ ] **Step 2: Add prompt-runner import**

At the top of the file, add:
```typescript
import { runPrompt } from "../_shared/ai/prompt-runner.ts";
import type { CapabilityType } from "../_shared/ai/provider-types.ts";
```

- [ ] **Step 3: Remove LOVABLE_API_KEY lines (lines 16–17)**

Remove:
```typescript
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
```

- [ ] **Step 4: Replace the direct Lovable fetch (~lines 88–110) with runPrompt**

The existing code builds `messages` and calls `fetch("https://ai.gateway.lovable.dev/v1/chat/completions", ...)`.

Replace the entire `fetch` call and response parsing block with:
```typescript
const { result } = await runPrompt(supabase, {
  workspaceId,
  capability: 'extraction' as CapabilityType,
  taskType: 'analyze_product_page',
  systemPrompt,          // use existing systemPrompt variable
  messages,              // use existing messages variable
  maxTokens: options?.max_tokens ?? 4096,
  jsonMode: !!options?.response_format,
  tools: options?.tools,
  toolChoice: options?.tool_choice,
});
const content = result.content;
```

Then use `content` where the old code used `response.choices[0].message.content`.

- [ ] **Step 5: Verify the file compiles**

Run: `deno check supabase/functions/analyze-product-page/index.ts`
Expected: no output (success)

- [ ] **Step 6: Deploy and verify**

```bash
supabase functions deploy analyze-product-page
```

Trigger a page analysis. Check `ai_usage_logs`: `provider_id` = 'openai' (extraction default).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/analyze-product-page/index.ts
git commit -m "feat: migrate analyze-product-page — replace direct Lovable call with shared AI layer"
```

---

**Phase 2 Validation Gate**

- [ ] SQL check: `SELECT provider_id, count(*) FROM ai_usage_logs WHERE created_at > now() - interval '1 day' GROUP BY provider_id;`
  - Expected: 'anthropic'/'openai'/'gemini' — zero 'lovable_gateway'
- [ ] `translate-product`, `enrich-products`, `optimize-product`, `analyze-product-page` all return success in staging

---

## Phase 3 — Vision / PDF Functions

**Read each function in full before modifying.** These are complex multimodal functions. Migrate one at a time with staging regression tests between each.

### Task 16: parse-catalog (912 lines)

**Files:**
- Modify: `supabase/functions/parse-catalog/index.ts`

- [ ] **Step 1: Read the full function**

Read: `supabase/functions/parse-catalog/index.ts` (all 912 lines)
Identify all Lovable/direct AI call sites (grep: `LOVABLE_API_KEY`, `ai.gateway.lovable.dev`, `fetch.*completions`).

- [ ] **Step 2: Add prompt-runner import**

```typescript
import { runPrompt } from "../_shared/ai/prompt-runner.ts";
import type { CapabilityType } from "../_shared/ai/provider-types.ts";
```

- [ ] **Step 3: Replace each AI call with runPrompt using `capability: 'multimodal_vision'`**

For each direct Lovable/AI call found in Step 1:
```typescript
// Replace: fetch("https://ai.gateway.lovable.dev/...", { body: JSON.stringify({ model, messages, ... }) })
// With:
const { result } = await runPrompt(supabase, {
  workspaceId,
  capability: 'multimodal_vision' as CapabilityType,
  taskType: 'parse_catalog',
  systemPrompt,
  messages,
  maxTokens: 4096,
});
const content = result.content;
```

- [ ] **Step 4: Remove all LOVABLE_API_KEY references**

- [ ] **Step 5: Compile check**

Run: `deno check supabase/functions/parse-catalog/index.ts`

- [ ] **Step 6: Deploy and regression test**

```bash
supabase functions deploy parse-catalog
```

Run a catalog parse in staging. Verify output quality matches pre-migration baseline.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/parse-catalog/index.ts
git commit -m "feat: migrate parse-catalog to shared AI layer (multimodal_vision)"
```

---

### Task 17: vision-parse-pdf (365 lines)

**Files:**
- Modify: `supabase/functions/vision-parse-pdf/index.ts`

- [ ] **Step 1: Read the full function and identify all AI call sites**

- [ ] **Step 2: Replace each AI call with `runPrompt` using `capability: 'multimodal_vision'`**

Same pattern as Task 15. Use `taskType: 'vision_parse'`.

- [ ] **Step 3: Remove LOVABLE_API_KEY references**

- [ ] **Step 4: Compile check and deploy**

Run: `deno check supabase/functions/vision-parse-pdf/index.ts`
Run: `supabase functions deploy vision-parse-pdf`

- [ ] **Step 5: Regression test with a real PDF in staging**

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/vision-parse-pdf/index.ts
git commit -m "feat: migrate vision-parse-pdf to shared AI layer (multimodal_vision)"
```

---

### Task 18: run-document-intelligence

**Files:**
- Modify: `supabase/functions/run-document-intelligence/index.ts`

- [ ] **Step 1: Read the full function and identify all AI call sites**

- [ ] **Step 2: Replace each AI call with `runPrompt` using `capability: 'extraction'`**

Use `taskType: 'extract_attributes'`.

- [ ] **Step 3: Remove LOVABLE_API_KEY references**

- [ ] **Step 4: Compile check, deploy, regression test**

Run: `deno check supabase/functions/run-document-intelligence/index.ts`
Run: `supabase functions deploy run-document-intelligence`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/run-document-intelligence/index.ts
git commit -m "feat: migrate run-document-intelligence to shared AI layer"
```

---

### Task 19: extract-pdf-pages

**Files:**
- Modify: `supabase/functions/extract-pdf-pages/index.ts`

- [ ] **Step 1: Read the full function and identify all AI call sites**

- [ ] **Step 2: Replace each AI call with `runPrompt` using `capability: 'multimodal_vision'`**

Use `taskType: 'parse_pdf'`.

- [ ] **Step 3: Remove LOVABLE_API_KEY references**

- [ ] **Step 4: Compile check, deploy, regression test**

Run: `deno check supabase/functions/extract-pdf-pages/index.ts`
Run: `supabase functions deploy extract-pdf-pages`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/extract-pdf-pages/index.ts
git commit -m "feat: migrate extract-pdf-pages to shared AI layer (multimodal_vision)"
```

---

**Phase 3 Validation Gate**

- [ ] All 4 vision/PDF functions deployed without errors
- [ ] End-to-end PDF extraction test passes in staging
- [ ] `ai_usage_logs.provider_id` for vision tasks = 'gemini' (multimodal_vision default)
- [ ] Zero regressions in catalog parse quality

---

## Phase 4 — Deprecation Gate (Time-Locked)

**HARD GATE:** Do not execute Phase 4 until BOTH conditions are met:
1. Minimum 14 days since Phase 3 completion with zero production incidents
2. The SQL verification query returns 0

### Task 20: Deprecation cleanup

- [ ] **Step 1: Run the verification query**

```sql
SELECT COUNT(*) FROM ai_usage_logs
WHERE provider_id = 'lovable_gateway'
  AND created_at > now() - INTERVAL '30 days';
```

Expected: `count = 0` — if NOT 0, stop here and investigate which function is still calling Lovable.

- [ ] **Step 2: Confirm 14-day stable period**

Check: no production incidents related to AI provider failures in the past 14 days since Phase 3 deploy.

- [ ] **Step 3: Mark lovable_gateway as disabled in DB**

Run in Supabase SQL editor:
```sql
UPDATE ai_provider_registry
SET enabled = FALSE, updated_at = now()
WHERE id = 'lovable_gateway';
```

- [ ] **Step 4: Remove LOVABLE_API_KEY from Supabase secrets**

Supabase Dashboard → Project Settings → Edge Functions → Secrets → delete `LOVABLE_API_KEY`.

- [ ] **Step 5: Scan for any remaining LOVABLE_API_KEY references**

```bash
grep -rn "LOVABLE_API_KEY" supabase/functions/ --include="*.ts"
```

Expected: zero matches. If any found, fix them before committing.

- [ ] **Step 6: Commit — remove LOVABLE_API_KEY from all edge functions (Commit 10)**

```bash
git add supabase/functions/
git commit -m "chore: remove LOVABLE_API_KEY from all edge functions"
```

- [ ] **Step 7: Mark lovable_gateway disabled in registry (Commit 11)**

This is a separate commit to make the registry change traceable independently of the code change:

```bash
# Create the SQL update as a new migration file
cat > supabase/migrations/20260319000005_disable_lovable_gateway.sql << 'EOF'
UPDATE ai_provider_registry
SET enabled = FALSE, updated_at = now()
WHERE id = 'lovable_gateway';
EOF

git add supabase/migrations/20260319000005_disable_lovable_gateway.sql
git commit -m "chore: mark lovable_gateway as disabled in provider registry"
```

Apply the migration in Supabase Dashboard → SQL Editor.

- [ ] **Step 8: Push and confirm production**

```bash
git pull --rebase origin main
git push origin main
```

Run final verification:
```sql
SELECT COUNT(*) FROM ai_usage_logs
WHERE provider_id = 'lovable_gateway'
  AND created_at > now() - INTERVAL '7 days';
```
Expected: `count = 0`

---

## Test Checklist Summary

### Unit tests (run locally with `deno test`)

- [ ] `error-classifier_test.ts` — all 16 cases pass
- [ ] `fallback-policy_test.ts` — all 4 cases pass

### Staging integration tests (verify manually after each phase)

- [ ] Phase 1: `resolve-ai-route` returns success; `ai_usage_logs.provider_id` = active provider
- [ ] Phase 1: Fallback works when primary key removed (temporarily)
- [ ] Phase 2: All 3 functions log with non-Lovable provider_id
- [ ] Phase 3: PDF extraction produces correct output; no quality regression
- [ ] Phase 4: Verification query returns 0; Lovable key removed from secrets

### Regression checks (must pass throughout all phases)

- [ ] WooCommerce import flow unaffected
- [ ] Workspace auth and session management unaffected
- [ ] `ai_routing_rules` workspace configs still honoured
- [ ] `prompt_templates` / `prompt_versions` still loaded and applied

---

## Known Technical Debt (Post-Phase 4)

The following functions still use Lovable directly and are out of scope for this migration. They should be tracked for a follow-up migration cycle:

```
supabase/functions/analyze-catalog/index.ts
supabase/functions/analyze-pdf-layout/index.ts
supabase/functions/detect-product-bundles/index.ts
supabase/functions/detect-variations/index.ts
supabase/functions/optimize-batch/index.ts
supabase/functions/process-product-images/index.ts
supabase/functions/send-intelligence-alert/index.ts
supabase/functions/test-ai-provider/index.ts
supabase/functions/test-document-intelligence-provider/index.ts
```
