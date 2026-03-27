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
  | 'gemini'
  | 'lovable_gateway';

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
    | 'system_default'
    | 'product_optimization_fixed';
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
  promptVersionId?: string;
}

export interface RunMeta {
  provider: string;
  model: string;
  fallbackUsed: boolean;
  /** The model ID the caller requested via modelOverride, if any. */
  requestedModel?: string;
  /** Human-readable reason a fallback was used, if fallbackUsed === true. */
  fallbackReason?: string;
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
  promptVersionId?: string;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  backoffMultiplier: number;
}
