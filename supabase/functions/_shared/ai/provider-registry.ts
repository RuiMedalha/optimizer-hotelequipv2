// supabase/functions/_shared/ai/provider-registry.ts
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ProviderConfig, ResolvedRoute, RunPromptParams } from "./provider-types.ts";
import { CAPABILITY_DEFAULTS } from "./capability-matrix.ts";

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  lovable_gateway: {
    id: "lovable_gateway",
    displayName: "Lovable AI Gateway",
    format: "lovable_gateway",
    apiBaseUrl: "https://ai.gateway.lovable.dev/v1/chat/completions",
    apiKeyEnvVar: "LOVABLE_API_KEY",
    authScheme: "bearer",
    enabled: true,
    isLegacy: false,
    priority: 0,
  },
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic",
    format: "anthropic",
    apiBaseUrl: "https://api.anthropic.com/v1/messages",
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
    authScheme: "x-api-key",
    enabled: true,
    isLegacy: false,
    priority: 1,
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    format: "openai_compatible",
    apiBaseUrl: "https://api.openai.com/v1/chat/completions",
    apiKeyEnvVar: "OPENAI_API_KEY",
    authScheme: "bearer",
    enabled: true,
    isLegacy: false,
    priority: 2,
  },
  gemini: {
    id: "gemini",
    displayName: "Gemini",
    format: "gemini",
    apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyEnvVar: "GEMINI_API_KEY",
    authScheme: "query_param",
    enabled: true,
    isLegacy: false,
    priority: 3,
  },
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
  fallbackSpecs: Array<{ provider: string; model: string }>
) {
  const chain: Array<{ provider: ProviderConfig; model: string }> = [];

  if (isKeyAvailable(primaryProvider)) {
    chain.push({ provider: primaryProvider, model: primaryModel });
  }

  for (const fb of fallbackSpecs) {
    const p = getProvider(fb.provider);
    if (p && isKeyAvailable(p)) {
      chain.push({ provider: p, model: fb.model });
    }
  }

  return chain;
}

function getDefaultModelForProvider(providerId: string): string {
  const defaults: Record<string, string> = {
    lovable_gateway: "google/gemini-3-flash-preview",
    anthropic: "claude-sonnet-4-6",
    openai: "gpt-4o",
    gemini: "gemini-2.5-pro",
  };
  return defaults[providerId] ?? "gpt-4o";
}

function getDefaultImageModelForProvider(providerId: string): string | null {
  const defaults: Record<string, string> = {
    lovable_gateway: "google/gemini-3.1-flash-image-preview",
    gemini: "gemini-2.0-flash-exp",
    openai: "gpt-image-1-mini",
  };
  return defaults[providerId] ?? null;
}

function isModelCompatibleWithProvider(modelId: string, providerId: string): boolean {
  const m = String(modelId || "").toLowerCase();

  if (providerId === "lovable_gateway") return m.startsWith("google/") || m.startsWith("openai/");
  if (providerId === "gemini") return m.startsWith("gemini-");
  if (providerId === "openai") return m.startsWith("gpt-");
  if (providerId === "anthropic") return m.startsWith("claude-");

  return true;
}

export async function resolveRoute(
  supabase: SupabaseClient,
  params: RunPromptParams
): Promise<ResolvedRoute> {
  const { taskType, modelOverride } = params;
  const isImageTask = params.modalities?.includes("image") ||
    params.capability === "image_generation";

  // For image tasks, only use providers that support image generation
  const imageProviders = ["lovable_gateway", "gemini", "openai"];
  const textProviders = ["lovable_gateway", "gemini", "openai", "anthropic"];
  const providerOrder = isImageTask ? imageProviders : textProviders;

  // Normalize modelOverride: ensure gateway-compatible prefix
  let normalizedModelOverride = modelOverride;
  if (normalizedModelOverride && isImageTask) {
    // If user passes "gemini-3.1-flash-image-preview", normalize to "google/gemini-3.1-flash-image-preview" for gateway
    if (normalizedModelOverride.startsWith("gemini-") && !normalizedModelOverride.startsWith("google/")) {
      normalizedModelOverride = `google/${normalizedModelOverride}`;
    }
  }

  for (const providerId of providerOrder) {
    const provider = getProvider(providerId);
    if (!provider || !isKeyAvailable(provider)) continue;

    let model: string;
    if (normalizedModelOverride && isModelCompatibleWithProvider(normalizedModelOverride, providerId)) {
      model = normalizedModelOverride;
    } else if (isImageTask) {
      const imgModel = getDefaultImageModelForProvider(providerId);
      if (!imgModel) continue; // Provider doesn't support image generation
      model = imgModel;
    } else {
      model = getDefaultModelForProvider(providerId);
    }

    // Build fallback chain from remaining providers
    const fallbackSpecs = providerOrder
      .filter(p => p !== providerId)
      .map(p => {
        const m = isImageTask
          ? getDefaultImageModelForProvider(p)
          : getDefaultModelForProvider(p);
        return m ? { provider: p, model: m } : null;
      })
      .filter((x): x is { provider: string; model: string } => x !== null);

    const chain = buildChain(provider, model, fallbackSpecs);

    if (chain.length > 0) {
      console.log(
        `[AI ROUTE] task=${taskType || "default"} | image=${isImageTask} | ${chain.map((c) => `${c.provider.id}/${c.model}`).join(" -> ")}`
      );

      return {
        selectedProvider: chain[0].provider,
        selectedModel: chain[0].model,
        fallbackChain: chain.slice(1),
        finalParams: {},
        decisionSource: "auto_provider_resolution",
      };
    }
  }

  throw new Error("No AI providers available");
}
