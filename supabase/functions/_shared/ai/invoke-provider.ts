// supabase/functions/_shared/ai/invoke-provider.ts
import type { InvokeParams, InvokeResult } from "./provider-types.ts";
import { classifyError, classifyNetworkError } from "./error-classifier.ts";

const TIMEOUT_MS = 30_000;
const IMAGE_TIMEOUT_MS = 120_000; // 2 min for image generation
const ERROR_BODY_MAX = 1200;

export async function invokeProvider(params: InvokeParams): Promise<InvokeResult> {
  switch (params.provider.format) {
    case "openai_compatible":  return await invokeOpenAICompatible(params);
    case "lovable_gateway":    return await invokeOpenAICompatible(params);
    case "anthropic":          return await invokeAnthropic(params);
    case "gemini":             return await invokeGemini(params);
    default: throw new ProviderError(
      `Unknown provider format: ${(params.provider as { format: string }).format}`,
      "invalid_request",
    );
  }
}

// ─── Adapter 1: OpenAI-compatible (OpenAI, Mistral, Perplexity, DeepSeek, Grok) ───

async function invokeOpenAICompatible(params: InvokeParams): Promise<InvokeResult> {
  const apiKey = params.apiKeyOverride || Deno.env.get(params.provider.apiKeyEnvVar);
  if (!apiKey) {
    throw new ProviderError(`Missing API key for ${params.provider.id} (no env var ${params.provider.apiKeyEnvVar} and no DB key)`, "auth_error");
  }

  const messages = buildMessages(params);
  const body: Record<string, unknown> = {
    model: params.model,
    messages,
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    ...(params.maxTokens != null ? { max_tokens: params.maxTokens } : {}),
    ...(params.jsonMode ? { response_format: { type: "json_object" } } : {}),
    ...(params.tools?.length ? { tools: params.tools, tool_choice: params.toolChoice ?? "auto" } : {}),
    ...(params.modalities?.length ? { modalities: params.modalities } : {}),
  };

  const isImageRequest = params.modalities?.includes("image");
  const timeoutMs = isImageRequest ? IMAGE_TIMEOUT_MS : TIMEOUT_MS;

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
    }, timeoutMs);
  } catch (err) {
    throw new ProviderError("Network error", classifyNetworkError(err));
  }

  const latencyMs = Date.now() - startMs;

  if (!resp.ok) {
    const text = await resp.text();
    const category = classifyError(resp.status, text, params.provider.id);
    console.error(`[invoke-provider] ${params.provider.id} HTTP ${resp.status} (${category}): ${text}`);
    throw new ProviderError(
      `${params.provider.id} ${resp.status}: ${text}`,
      category,
    );
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
  const images = message?.images as unknown[] | undefined;
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
        message: {
          role: "assistant",
          content,
          tool_calls: message?.tool_calls as unknown[] | undefined,
          ...(images?.length ? { images } : {}),
        },
        finish_reason: finishReason,
      }],
      usage: {
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? 0,
        total_tokens: usage?.total_tokens ?? 0,
      },
      model: (raw.model as string) ?? params.model,
    },
  };
}

// ─── Adapter 2: Anthropic native ───

async function invokeAnthropic(params: InvokeParams): Promise<InvokeResult> {
  const apiKey = params.apiKeyOverride || Deno.env.get(params.provider.apiKeyEnvVar);
  if (!apiKey) {
    throw new ProviderError(`Missing API key for anthropic (no env var ${params.provider.apiKeyEnvVar} and no DB key)`, "auth_error");
  }

  const userMessages = params.messages.filter((m) => m.role !== "system");
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxTokens ?? 4096,
    ...(params.systemPrompt ? { system: params.systemPrompt } : {}),
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
    const category = classifyError(resp.status, text, "anthropic");
    console.error(`[invoke-provider] anthropic HTTP ${resp.status} (${category}): ${text}`);
    throw new ProviderError(
      `anthropic ${resp.status}: ${text}`,
      category,
    );
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
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
      model: params.model,
    },
  };
}

// ─── Adapter 3: Gemini native ───

async function invokeGemini(params: InvokeParams): Promise<InvokeResult> {
  const apiKey = params.apiKeyOverride || Deno.env.get(params.provider.apiKeyEnvVar);
  if (!apiKey) {
    throw new ProviderError(`Missing API key for gemini (no env var ${params.provider.apiKeyEnvVar} and no DB key)`, "auth_error");
  }

  const url = `${params.provider.apiBaseUrl}/models/${params.model}:generateContent?key=${apiKey}`;

  const contents = params.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: convertToGeminiParts(m.content),
    }));

  // Convert OpenAI-format tools to Gemini functionDeclarations
  const geminiTools = convertToolsToGemini(params.tools);
  const toolConfig = convertToolChoiceToGemini(params.toolChoice);

  const body: Record<string, unknown> = {
    contents,
    ...(params.systemPrompt
      ? { systemInstruction: { parts: [{ text: params.systemPrompt }] } }
      : {}),
    generationConfig: {
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
      ...(params.maxTokens != null ? { maxOutputTokens: params.maxTokens } : {}),
      ...(params.jsonMode && !geminiTools ? { responseMimeType: "application/json" } : {}),
    },
    ...(geminiTools ? { tools: geminiTools } : {}),
    ...(toolConfig ? { toolConfig } : {}),
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
    const message = err instanceof Error ? err.message : String(err);
    throw new ProviderError(`Gemini fetch error: ${message}`, classifyNetworkError(err));
  }

  const latencyMs = Date.now() - startMs;

  if (!resp.ok) {
    const text = (await resp.text()).slice(0, ERROR_BODY_MAX);
    const category = classifyError(resp.status, text, "gemini");
    const detail = `Gemini HTTP ${resp.status} ${resp.statusText}: ${text}`;
    console.error(`[invoke-provider] ${detail} (${category})`);
    throw new ProviderError(
      detail,
      category,
    );
  }

  let raw: Record<string, unknown>;
  try {
    raw = await resp.json() as Record<string, unknown>;
  } catch {
    throw new ProviderError("Failed to parse Gemini response", "parse_error");
  }

  const candidates = raw.candidates as Array<Record<string, unknown>> | undefined;
  const firstCandidate = candidates?.[0];
  const parts = (firstCandidate?.content as Record<string, unknown>)?.parts as
    | Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }>
    | undefined;

  // Extract text content (skip functionCall parts)
  const content = parts
    ?.filter((p) => p.text != null)
    .map((p) => p.text ?? "")
    .join("") ?? "";

  // Extract function calls from Gemini response and normalize to OpenAI format
  const toolCalls = extractGeminiFunctionCalls(parts);

  const finishReason = normalizeFinishReason(firstCandidate?.finishReason as string);
  const usageMeta = raw.usageMetadata as
    | { promptTokenCount?: number; candidatesTokenCount?: number }
    | undefined;

  return {
    content,
    finishReason: toolCalls.length > 0 ? "tool_calls" : finishReason,
    inputTokens: usageMeta?.promptTokenCount ?? 0,
    outputTokens: usageMeta?.candidatesTokenCount ?? 0,
    provider: params.provider.id,
    model: params.model,
    latencyMs,
    rawResponse: raw,
    normalizedResponse: {
      choices: [{
        message: {
          role: "assistant",
          content,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length > 0 ? "tool_calls" : finishReason,
      }],
      usage: {
        prompt_tokens: usageMeta?.promptTokenCount ?? 0,
        completion_tokens: usageMeta?.candidatesTokenCount ?? 0,
        total_tokens:
          (usageMeta?.promptTokenCount ?? 0) + (usageMeta?.candidatesTokenCount ?? 0),
      },
      model: params.model,
    },
  };
}

// ─── Gemini tool-call helpers ───

/** Convert OpenAI-format tools to Gemini functionDeclarations. */
function convertToolsToGemini(
  tools: unknown[] | undefined,
): Array<{ functionDeclarations: unknown[] }> | null {
  if (!tools || tools.length === 0) return null;

  const stripAdditionalProperties = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(stripAdditionalProperties);
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === "additionalProperties") continue;
        next[k] = stripAdditionalProperties(v);
      }
      return next;
    }
    return value;
  };

  const declarations: unknown[] = [];
  for (const tool of tools) {
    const t = tool as { type?: string; function?: { name: string; description?: string; parameters?: unknown } };
    if (t.type === "function" && t.function) {
      declarations.push({
        name: t.function.name,
        description: t.function.description ?? "",
        parameters: stripAdditionalProperties(
          t.function.parameters ?? { type: "object", properties: {} },
        ),
      });
    }
  }
  return declarations.length > 0 ? [{ functionDeclarations: declarations }] : null;
}

/** Convert OpenAI-format tool_choice to Gemini toolConfig. */
function convertToolChoiceToGemini(
  toolChoice: unknown,
): Record<string, unknown> | null {
  if (!toolChoice) return null;

  // OpenAI: "auto" | "none" | "required" | { type: "function", function: { name: "..." } }
  if (typeof toolChoice === "string") {
    const map: Record<string, string> = {
      auto: "AUTO",
      none: "NONE",
      required: "ANY",
    };
    const mode = map[toolChoice];
    return mode ? { functionCallingConfig: { mode } } : null;
  }

  // { type: "function", function: { name: "xxx" } } → forced function call
  const tc = toolChoice as { type?: string; function?: { name: string } };
  if (tc.type === "function" && tc.function?.name) {
    return {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [tc.function.name],
      },
    };
  }

  return null;
}

/** Extract Gemini functionCall parts and normalize to OpenAI tool_calls format. */
function extractGeminiFunctionCalls(
  parts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> | undefined,
): unknown[] {
  if (!parts) return [];

  const calls: unknown[] = [];
  for (let i = 0; i < parts.length; i++) {
    const fc = parts[i].functionCall;
    if (fc) {
      calls.push({
        id: `call_${i}`,
        type: "function",
        function: {
          name: fc.name,
          arguments: JSON.stringify(fc.args ?? {}),
        },
      });
    }
  }
  return calls;
}

// ─── Helpers ───

function buildMessages(
  params: InvokeParams,
): Array<{ role: string; content: string | unknown[] }> {
  const out: Array<{ role: string; content: string | unknown[] }> = [];
  if (params.systemPrompt) out.push({ role: "system", content: params.systemPrompt });
  out.push(...params.messages.filter((m) => m.role !== "system"));
  return out;
}

/** Convert message content (string or multimodal array) to Gemini parts format. */
function convertToGeminiParts(content: string | unknown[]): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return [{ text: content }];
  }

  if (!Array.isArray(content)) {
    return [{ text: String(content) }];
  }

  const parts: Array<Record<string, unknown>> = [];
  for (const item of content) {
    const typed = item as { type?: string; text?: string; image_url?: { url?: string } };
    if (typed.type === "text" && typed.text) {
      parts.push({ text: typed.text });
    } else if (typed.type === "image_url" && typed.image_url?.url) {
      const url = typed.image_url.url;
      if (url.startsWith("data:")) {
        // Base64 inline image
        const match = url.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) {
          parts.push({
            inlineData: { mimeType: match[1], data: match[2] },
          });
        }
      } else {
        // URL-based image — Gemini supports fileUri for some URLs
        // but for HTTP URLs we need to fetch and inline
        parts.push({ text: `[Image: ${url}]` });
      }
    }
  }

  return parts.length > 0 ? parts : [{ text: "" }];
}

function normalizeFinishReason(raw: string | undefined): InvokeResult["finishReason"] {
  if (!raw) return "unknown";
  const lower = raw.toLowerCase();
  if (lower === "stop" || lower === "end_turn") return "stop";
  if (lower === "length" || lower === "max_tokens") return "length";
  if (lower === "tool_use" || lower === "tool_calls") return "tool_calls";
  if (lower.includes("safety") || lower.includes("filter") || lower === "recitation") {
    return "content_filter";
  }
  return "unknown";
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
