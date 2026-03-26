// supabase/functions/_shared/ai/provider-registry.ts
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ProviderConfig, ResolvedRoute, RunPromptParams } from "./provider-types.ts";
import { CAPABILITY_DEFAULTS } from "./capability-matrix.ts";

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
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
    anthropic: "claude-sonnet-4-6",
    openai: "gpt-4o",
    gemini: "gemini-2.5-pro",
  };
  return defaults[providerId] ?? "gpt-4o";
}

function isModelCompatibleWithProvider(modelId: string, providerId: string): boolean {
  const m = String(modelId || "").toLowerCase();

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

  // 🔥 FIX DEFINITIVO: product optimization routing
  if (taskType === "product_optimization") {
    const gemini = getProvider("gemini");

    if (gemini) {
      const primaryModel =
        modelOverride && isModelCompatibleWithProvider(modelOverride, "gemini")
          ? modelOverride
          : getDefaultModelForProvider("gemini");

      const chain = buildChain(gemini, primaryModel, [
        { provider: "openai", model: getDefaultModelForProvider("openai") },
        { provider: "anthropic", model: getDefaultModelForProvider("anthropic") },
      ]);

      if (chain.length > 0) {
        console.log(
          `[AI ROUTE] ${chain.map((c) => `${c.provider.id}/${c.model}`).join(" -> ")}`
        );

        return {
          selectedProvider: chain[0].provider,
          selectedModel: chain[0].model,
          fallbackChain: chain.slice(1),
          finalParams: {},
          decisionSource: "product_optimization_fixed",
        };
      }
    }
  }

  throw new Error("No AI providers available");
}
