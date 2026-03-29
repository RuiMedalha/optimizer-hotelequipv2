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

// Maps DB provider_type values to runtime provider slugs
const PROVIDER_TYPE_TO_SLUG: Record<string, string> = {
  gemini_direct: "gemini",
  openai_direct: "openai",
  anthropic_direct: "anthropic",
  lovable_gateway: "lovable_gateway",
  // Also support exact slugs
  gemini: "gemini",
  openai: "openai",
  anthropic: "anthropic",
};

function getProvider(id: string): ProviderConfig | null {
  return PROVIDER_CONFIGS[id] ?? null;
}

function isKeyAvailable(provider: ProviderConfig): boolean {
  return !!Deno.env.get(provider.apiKeyEnvVar);
}

/**
 * Resolve API key with priority: env var > DB config > null.
 * Never logs the actual key value.
 */
export function getApiKey(
  provider: ProviderConfig,
  dbConfig?: Record<string, unknown> | null,
): { key: string | null; source: 'env' | 'db' | null } {
  const envKey = Deno.env.get(provider.apiKeyEnvVar);
  if (envKey) return { key: envKey, source: 'env' };
  const dbKey = dbConfig?.api_key as string | undefined;
  if (dbKey) return { key: dbKey, source: 'db' };
  return { key: null, source: null };
}

function buildChain(
  primaryProvider: ProviderConfig,
  primaryModel: string,
  fallbackSpecs: Array<{ provider: string; model: string }>,
  dbConfig?: Record<string, unknown> | null,
) {
  const chain: Array<{ provider: ProviderConfig; model: string }> = [];

  const { key: primaryKey } = getApiKey(primaryProvider, dbConfig);
  if (primaryKey) {
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

/**
 * Try to resolve a routing rule from ai_routing_rules for this workspace + taskType.
 * Returns null on any failure (DB error, no rule found, etc.) — caller falls through to default logic.
 */
async function tryResolveFromDB(
  supabase: SupabaseClient,
  workspaceId: string,
  taskType: string,
  isImageTask: boolean,
  modelOverride: string | undefined,
): Promise<ResolvedRoute | null> {
  try {
    // 1. Query workspace-specific routing rule
    const { data: rule } = await supabase
      .from("ai_routing_rules")
      .select("id, provider_id, model_override, fallback_provider_id, fallback_model, config, provider:provider_id(provider_type, config)")
      .eq("workspace_id", workspaceId)
      .eq("task_type", taskType)
      .eq("is_active", true)
      .order("execution_priority", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!rule?.provider_id) return null;

    // 2. Resolve provider_type to runtime slug
    const providerData = rule.provider as { provider_type?: string; config?: Record<string, unknown> } | null;
    const providerType = providerData?.provider_type ?? "";
    const runtimeSlug = PROVIDER_TYPE_TO_SLUG[providerType] ?? PROVIDER_TYPE_TO_SLUG[providerType.toLowerCase()];
    if (!runtimeSlug) {
      console.warn(`[provider-registry] Unknown provider_type "${providerType}" in routing rule ${rule.id} — skipping`);
      return null;
    }

    const provider = getProvider(runtimeSlug);
    if (!provider) return null;

    // 3. Resolve API key (env first, then DB config)
    const dbConfig = providerData?.config as Record<string, unknown> | null;
    const { key: apiKey, source: apiKeySource } = getApiKey(provider, dbConfig);
    if (!apiKey) {
      console.warn(`[provider-registry] Routing rule ${rule.id} matched but no API key available for ${runtimeSlug} — skipping`);
      return null;
    }

    // 4. Determine model
    let model: string;
    if (modelOverride && isModelCompatibleWithProvider(modelOverride, runtimeSlug)) {
      model = modelOverride;
    } else if (rule.model_override) {
      model = rule.model_override;
    } else if (isImageTask) {
      const imgModel = getDefaultImageModelForProvider(runtimeSlug);
      if (!imgModel) return null;
      model = imgModel;
    } else {
      model = getDefaultModelForProvider(runtimeSlug);
    }

    // 5. Build fallback chain
    const fallbackChain: Array<{ provider: ProviderConfig; model: string }> = [];

    // Add fallback from rule first
    if (rule.fallback_provider_id && rule.fallback_model) {
      // We don't have the fallback provider_type easily, but we can try common slugs
      const textProviders = ["lovable_gateway", "gemini", "openai", "anthropic"];
      for (const slug of textProviders) {
        const fp = getProvider(slug);
        if (fp && isKeyAvailable(fp) && slug !== runtimeSlug) {
          const fbModel = isImageTask
            ? getDefaultImageModelForProvider(slug)
            : getDefaultModelForProvider(slug);
          if (fbModel) fallbackChain.push({ provider: fp, model: fbModel });
        }
      }
    } else {
      // Default fallback: remaining providers
      const allProviders = isImageTask
        ? ["lovable_gateway", "gemini", "openai"]
        : ["lovable_gateway", "gemini", "openai", "anthropic"];
      for (const slug of allProviders) {
        if (slug === runtimeSlug) continue;
        const fp = getProvider(slug);
        if (fp && isKeyAvailable(fp)) {
          const fbModel = isImageTask
            ? getDefaultImageModelForProvider(slug)
            : getDefaultModelForProvider(slug);
          if (fbModel) fallbackChain.push({ provider: fp, model: fbModel });
        }
      }
    }

    console.log(`[provider-registry] Resolution for task="${taskType}" workspace="${workspaceId}":`, {
      source: "routing_rule",
      provider: runtimeSlug,
      model,
      apiKeySource: apiKeySource,
      fallbackChain: fallbackChain.map(c => `${c.provider.id}/${c.model}`),
      ruleId: rule.id,
    });

    return {
      selectedProvider: provider,
      selectedModel: model,
      fallbackChain,
      finalParams: {},
      decisionSource: "routing_rule",
      apiKeyOverride: apiKeySource === 'db' ? apiKey : undefined,
      apiKeySource: apiKeySource ?? undefined,
      routingRuleId: rule.id as string,
    };
  } catch (err) {
    // DB query failed — fall through to default logic silently
    console.warn(`[provider-registry] DB routing lookup failed (falling through to defaults):`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function resolveRoute(
  supabase: SupabaseClient,
  params: RunPromptParams
): Promise<ResolvedRoute> {
  const { taskType, modelOverride, workspaceId } = params;
  const isImageTask = params.modalities?.includes("image") ||
    params.capability === "image_generation";

  // ── CHANGE 1: Try DB routing rules first ──
  if (workspaceId && taskType) {
    const dbRoute = await tryResolveFromDB(supabase, workspaceId, taskType, isImageTask, modelOverride);
    if (dbRoute) return dbRoute;
  }

  // ── Fallback: hardcoded providerOrder (unchanged original behavior) ──
  const imageProviders = ["lovable_gateway", "gemini", "openai"];
  const textProviders = ["lovable_gateway", "gemini", "openai", "anthropic"];
  const providerOrder = isImageTask ? imageProviders : textProviders;

  // Normalize modelOverride: ensure gateway-compatible prefix
  let normalizedModelOverride = modelOverride;
  if (normalizedModelOverride && isImageTask) {
    if (normalizedModelOverride.startsWith("gemini-") && !normalizedModelOverride.startsWith("google/")) {
      normalizedModelOverride = `google/${normalizedModelOverride}`;
    }
  }

  const decisionSource = modelOverride ? "model_override" as const : "default_provider_order" as const;

  for (const providerId of providerOrder) {
    const provider = getProvider(providerId);
    if (!provider || !isKeyAvailable(provider)) continue;

    let model: string;
    if (normalizedModelOverride && isModelCompatibleWithProvider(normalizedModelOverride, providerId)) {
      model = normalizedModelOverride;
    } else if (isImageTask) {
      const imgModel = getDefaultImageModelForProvider(providerId);
      if (!imgModel) continue;
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
        `[provider-registry] Resolution for task="${taskType || "default"}" workspace="${workspaceId}":`,
        {
          source: decisionSource,
          provider: providerId,
          model,
          apiKeySource: "env",
          fallbackChain: chain.slice(1).map(c => `${c.provider.id}/${c.model}`),
          ruleId: null,
        }
      );

      return {
        selectedProvider: chain[0].provider,
        selectedModel: chain[0].model,
        fallbackChain: chain.slice(1),
        finalParams: {},
        decisionSource,
        apiKeySource: 'env',
      };
    }
  }

  throw new Error("No AI providers available");
}

export class ProviderError extends Error {
  category: import("./provider-types.ts").ErrorCategory;
  constructor(message: string, category: import("./provider-types.ts").ErrorCategory) {
    super(message);
    this.category = category;
    this.name = "ProviderError";
  }
}
