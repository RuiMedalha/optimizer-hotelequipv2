// supabase/functions/_shared/ai/direct-ai-call.ts
// Direct AI API calls without Lovable proxy dependency.
// Supports Gemini (primary), OpenAI (fallback), Anthropic (fallback).

export interface DirectAICallParams {
  systemPrompt: string;
  messages: Array<{ role: string; content: string | any[] }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  tools?: any[];
  toolChoice?: any;
}

export interface DirectAIResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model: string;
  provider: string;
}

// Model mapping: canonical -> provider-specific
const MODEL_MAP: Record<string, { provider: string; model: string }> = {
  // Lovable Gateway models — all google/gemini and short forms route through gateway
  "lovable/gemini-3-flash-preview": { provider: "lovable_gateway", model: "google/gemini-3-flash-preview" },
  "lovable/gemini-2.5-pro": { provider: "lovable_gateway", model: "google/gemini-2.5-pro" },
  "lovable/gemini-2.5-flash": { provider: "lovable_gateway", model: "google/gemini-2.5-flash" },
  "lovable/gemini-2.5-flash-lite": { provider: "lovable_gateway", model: "google/gemini-2.5-flash-lite" },
  "lovable/gpt-5": { provider: "lovable_gateway", model: "openai/gpt-5" },
  "lovable/gpt-5-mini": { provider: "lovable_gateway", model: "openai/gpt-5-mini" },
  "lovable/gpt-5-nano": { provider: "lovable_gateway", model: "openai/gpt-5-nano" },
  // Google models → route through Lovable Gateway (LOVABLE_API_KEY)
  "google/gemini-2.5-flash": { provider: "lovable_gateway", model: "google/gemini-2.5-flash" },
  "google/gemini-2.5-pro": { provider: "lovable_gateway", model: "google/gemini-2.5-pro" },
  "google/gemini-2.5-flash-lite": { provider: "lovable_gateway", model: "google/gemini-2.5-flash-lite" },
  "google/gemini-3-flash-preview": { provider: "lovable_gateway", model: "google/gemini-3-flash-preview" },
  "google/gemini-3-pro-preview": { provider: "lovable_gateway", model: "google/gemini-3-pro-preview" },
  "google/gemini-3.1-pro-preview": { provider: "lovable_gateway", model: "google/gemini-3.1-pro-preview" },
  "google/gemini-3.1-flash-image-preview": { provider: "lovable_gateway", model: "google/gemini-3.1-flash-image-preview" },
  // Short forms → prefer direct provider when selected in AI Provider Center
  "gemini-2.5-flash": { provider: "gemini", model: "gemini-2.5-flash" },
  "gemini-2.5-pro": { provider: "gemini", model: "gemini-2.5-pro" },
  "gemini-2.5-flash-lite": { provider: "gemini", model: "gemini-2.5-flash-lite" },
  "gemini-3-flash-preview": { provider: "gemini", model: "gemini-3-flash-preview" },
  "gemini-3.1-pro-preview": { provider: "gemini", model: "gemini-3.1-pro-preview" },
  // OpenAI models → route through Lovable Gateway
  "openai/gpt-5": { provider: "lovable_gateway", model: "openai/gpt-5" },
  "openai/gpt-5-mini": { provider: "lovable_gateway", model: "openai/gpt-5-mini" },
  "openai/gpt-5-nano": { provider: "lovable_gateway", model: "openai/gpt-5-nano" },
  "openai/gpt-5.2": { provider: "lovable_gateway", model: "openai/gpt-5.2" },
  "openai/gpt-4o": { provider: "openai", model: "gpt-4o" },
  "openai/gpt-4o-mini": { provider: "openai", model: "gpt-4o-mini" },
  "gpt-4o": { provider: "openai", model: "gpt-4o" },
  "gpt-4o-mini": { provider: "openai", model: "gpt-4o-mini" },
};

function resolveModel(model: string): { provider: string; model: string } {
  if (MODEL_MAP[model]) return MODEL_MAP[model];
  // Auto-route unknown google/ models through Lovable Gateway
  if (model.startsWith("google/")) return { provider: "lovable_gateway", model };
  // Unknown gemini- short forms should respect direct Gemini selection when configured
  if (model.startsWith("gemini-")) return { provider: "gemini", model };
  // Default fallback
  return { provider: "lovable_gateway", model: "google/gemini-2.5-flash" };
}

function getApiKey(provider: string): string | null {
  const envVars: Record<string, string> = {
    lovable_gateway: "LOVABLE_API_KEY",
    gemini: "GEMINI_API_KEY",
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
  };
  return Deno.env.get(envVars[provider] ?? "") ?? null;
}

// ─── Gemini Native API ───────────────────────────────────────────────────────

function buildGeminiContents(systemPrompt: string, messages: DirectAICallParams["messages"]) {
  const contents: any[] = [];

  for (const msg of messages) {
    const role = msg.role === "assistant" ? "model" : "user";
    if (typeof msg.content === "string") {
      contents.push({ role, parts: [{ text: msg.content }] });
    } else if (Array.isArray(msg.content)) {
      const parts: any[] = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          parts.push({ text: part.text });
        } else if (part.type === "image_url" && part.image_url?.url) {
          const url = part.image_url.url;
          if (url.startsWith("data:")) {
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
            }
          } else {
            parts.push({ text: `[Image: ${url}]` });
          }
        }
      }
      contents.push({ role, parts });
    }
  }
  return contents;
}

function convertToolsToGemini(tools: any[]): any[] {
  return tools.map((t) => ({
    function_declarations: [{
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }],
  }));
}

async function callGemini(params: DirectAICallParams, model: string): Promise<DirectAIResponse> {
  const apiKey = getApiKey("gemini");
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const contents = buildGeminiContents(params.systemPrompt, params.messages);
  const body: any = {
    contents,
    systemInstruction: { parts: [{ text: params.systemPrompt }] },
    generationConfig: {
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
      ...(params.maxTokens != null ? { maxOutputTokens: params.maxTokens } : {}),
      ...(params.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };

  if (params.tools?.length) {
    body.tools = convertToolsToGemini(params.tools);
    if (params.toolChoice) {
      const fnName = params.toolChoice?.function?.name;
      if (fnName) {
        body.tool_config = {
          function_calling_config: {
            mode: "ANY",
            allowed_function_names: [fnName],
          },
        };
      }
    }
  }

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];

  // Check for function calls
  const functionCalls = parts.filter((p: any) => p.functionCall);
  const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text).join("");

  const toolCalls = functionCalls.map((fc: any, i: number) => ({
    id: `call_${i}`,
    type: "function",
    function: {
      name: fc.functionCall.name,
      arguments: JSON.stringify(fc.functionCall.args),
    },
  }));

  return {
    choices: [{
      message: {
        content: textParts || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
    }],
    usage: {
      prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
    },
    model,
    provider: "gemini",
  };
}

// ─── OpenAI Compatible API ───────────────────────────────────────────────────

async function callOpenAI(params: DirectAICallParams, model: string): Promise<DirectAIResponse> {
  const apiKey = getApiKey("openai");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const messages: any[] = [
    { role: "system", content: params.systemPrompt },
    ...params.messages,
  ];

  const body: any = {
    model,
    messages,
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    ...(params.maxTokens != null ? { max_tokens: params.maxTokens } : {}),
    ...(params.jsonMode ? { response_format: { type: "json_object" } } : {}),
    ...(params.tools?.length ? { tools: params.tools, tool_choice: params.toolChoice ?? "auto" } : {}),
  };

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  return { ...data, provider: "openai" };
}

// ─── Lovable AI Gateway ──────────────────────────────────────────────────────

async function callLovableGateway(params: DirectAICallParams, model: string): Promise<DirectAIResponse> {
  const apiKey = getApiKey("lovable_gateway");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const messages: any[] = [
    { role: "system", content: params.systemPrompt },
    ...params.messages,
  ];

  const body: any = {
    model,
    messages,
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    ...(params.maxTokens != null ? { max_tokens: params.maxTokens } : {}),
    ...(params.jsonMode ? { response_format: { type: "json_object" } } : {}),
    ...(params.tools?.length ? { tools: params.tools, tool_choice: params.toolChoice ?? "auto" } : {}),
  };

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 429) throw new Error(`Lovable AI rate limited: ${text}`);
    if (resp.status === 402) throw new Error(`Lovable AI credits exhausted: ${text}`);
    throw new Error(`Lovable AI Gateway error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  return { ...data, provider: "lovable_gateway" };
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

export async function directAICall(params: DirectAICallParams): Promise<DirectAIResponse> {
  const requestedModel = params.model ?? "gemini-2.5-flash";
  const resolved = resolveModel(requestedModel);

  // Try primary provider
  try {
    if (resolved.provider === "lovable_gateway") {
      return await callLovableGateway(params, resolved.model);
    } else if (resolved.provider === "gemini") {
      return await callGemini(params, resolved.model);
    } else if (resolved.provider === "openai") {
      return await callOpenAI(params, resolved.model);
    }
  } catch (err) {
    console.warn(`[direct-ai-call] Primary provider ${resolved.provider} failed:`, (err as Error).message);
  }

  // Fallback chain: lovable_gateway -> gemini -> openai
  const fallbacks = ["lovable_gateway", "gemini", "openai"].filter((p) => p !== resolved.provider);
  for (const fb of fallbacks) {
    const key = getApiKey(fb);
    if (!key) continue;
    try {
      if (fb === "lovable_gateway") return await callLovableGateway({ ...params }, "google/gemini-3-flash-preview");
      const fbModel = fb === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini";
      if (fb === "gemini") return await callGemini({ ...params }, fbModel);
      if (fb === "openai") return await callOpenAI({ ...params }, fbModel);
    } catch (err) {
      console.warn(`[direct-ai-call] Fallback ${fb} failed:`, (err as Error).message);
    }
  }

  throw new Error("No AI providers available. Configure LOVABLE_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.");
}
