// src/hooks/useAiPricingDashboard.ts
// Fetches ai_model_pricing and computes cost breakdowns from optimization_logs
// and ai_usage_logs. Pricing is DB-driven — no hardcoded cost map.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

export interface ModelMetadata {
  best_for?: string;
  strengths?: string[];
  speed_tier?: "fast" | "medium" | "slow";
  quality_tier?: "standard" | "high" | "premium";
  cost_tier?: "cheap" | "medium" | "expensive";
  recommended_tasks?: string[];
}

export interface AiModelPricing {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  input_cost_per_1m: number;
  output_cost_per_1m: number;
  cached_input_cost_per_1m: number | null;
  currency: string;
  effective_from: string;
  is_active: boolean;
  source_url: string | null;
  notes: string | null;
  metadata: ModelMetadata;
}

export interface ModelCostRow {
  modelId: string;
  displayName: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  callCount: number;
  pricingFound: boolean;
  metadata: ModelMetadata;
}

export interface AiCostSummary {
  totalCostUsd: number;
  costByProvider: { provider: string; costUsd: number }[];
  costByModel: ModelCostRow[];
  totalInputTokens: number;
  totalOutputTokens: number;
  costPerOptimization: number;
  totalOptimizations: number;
  pricingLoaded: boolean;
}

// Normalize model names: strip "google/", "openai/", "anthropic/" prefixes
// so new-format IDs ("gemini-2.5-flash") match old-format ("google/gemini-2.5-flash").
function normalizeModelId(raw: string): string {
  return raw
    .replace(/^(google|openai|anthropic|mistral|meta-llama|cohere|deepseek)\//, "")
    .trim();
}

function providerFromModelId(raw: string): string {
  if (raw.startsWith("google/") || raw.includes("gemini")) return "gemini";
  if (raw.startsWith("openai/") || raw.includes("gpt")) return "openai";
  if (raw.startsWith("anthropic/") || raw.includes("claude")) return "anthropic";
  if (raw.startsWith("deepseek/") || raw.includes("deepseek")) return "deepseek";
  return "unknown";
}

// ── Public hooks ──────────────────────────────────────────────────────────────

/** All active pricing rows — for admin/settings display. */
export function useAiModelPricing() {
  return useQuery({
    queryKey: ["ai-model-pricing"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_model_pricing" as any)
        .select("*")
        .eq("is_active", true)
        .order("provider_id")
        .order("model_id");
      if (error) throw error;
      return (data || []) as AiModelPricing[];
    },
  });
}

/** Aggregated cost dashboard for the active workspace. */
export function useAiPricingDashboard() {
  const { activeWorkspace } = useWorkspaceContext();

  const pricingQuery = useAiModelPricing();

  // Fetch optimization_logs (populated by optimize-product — primary data source)
  const logsQuery = useQuery({
    queryKey: ["ai-cost-logs", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      // Get product IDs for workspace (optimization_logs is product-scoped)
      const { data: products } = await supabase
        .from("products")
        .select("id")
        .eq("workspace_id", activeWorkspace!.id);

      const productIds = (products || []).map((p: any) => p.id as string);
      const rows: Array<{ model: string; prompt_tokens: number; completion_tokens: number }> = [];

      const batchSize = 200;
      for (let i = 0; i < productIds.length; i += batchSize) {
        const batch = productIds.slice(i, i + batchSize);
        const { data } = await supabase
          .from("optimization_logs")
          .select("model, prompt_tokens, completion_tokens")
          .in("product_id", batch);
        if (data) rows.push(...(data as typeof rows));
      }

      return rows;
    },
  });

  // Also fetch ai_usage_logs (populated by resolve-ai-route — newer, may be sparse)
  const usageLogsQuery = useQuery({
    queryKey: ["ai-usage-logs-cost", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("ai_usage_logs")
        .select("model_name, input_tokens, output_tokens")
        .eq("workspace_id", activeWorkspace!.id);
      return (data || []) as Array<{ model_name: string; input_tokens: number; output_tokens: number }>;
    },
  });

  const summary = useMemo((): AiCostSummary => {
    const pricing = pricingQuery.data ?? [];
    const optLogs = logsQuery.data ?? [];
    const aiLogs = usageLogsQuery.data ?? [];

    // Build two pricing maps:
    // 1. Exact match (model_id as stored in DB)
    // 2. Normalized match (strip provider prefix)
    const exactMap = new Map<string, AiModelPricing>();
    const normMap = new Map<string, AiModelPricing>();
    for (const p of pricing) {
      exactMap.set(p.model_id, p);
      normMap.set(normalizeModelId(p.model_id), p);
    }

    function lookupPricing(raw: string): AiModelPricing | undefined {
      return exactMap.get(raw) ?? normMap.get(normalizeModelId(raw));
    }

    const modelMap = new Map<string, ModelCostRow>();

    function accumulate(raw: string, inputTokens: number, outputTokens: number) {
      const p = lookupPricing(raw);
      const cost = p
        ? (inputTokens / 1_000_000) * Number(p.input_cost_per_1m) +
          (outputTokens / 1_000_000) * Number(p.output_cost_per_1m)
        : 0;

      // Use canonical (normalized) key so old/new format records merge
      const key = normalizeModelId(raw);
      const existing = modelMap.get(key) ?? {
        modelId: key,
        displayName: p?.display_name ?? key,
        provider: p?.provider_id ?? providerFromModelId(raw),
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        callCount: 0,
        pricingFound: !!p,
        metadata: (p?.metadata ?? {}) as ModelMetadata,
      };

      existing.inputTokens += inputTokens;
      existing.outputTokens += outputTokens;
      existing.estimatedCostUsd += cost;
      existing.callCount += 1;
      if (p) existing.pricingFound = true;

      modelMap.set(key, existing);
    }

    // Process optimization_logs (prompt_tokens / completion_tokens)
    for (const l of optLogs) {
      accumulate(l.model || "unknown", l.prompt_tokens ?? 0, l.completion_tokens ?? 0);
    }

    // Process ai_usage_logs (input_tokens / output_tokens, model_name)
    for (const l of aiLogs) {
      accumulate(l.model_name || "unknown", l.input_tokens ?? 0, l.output_tokens ?? 0);
    }

    const costByModel = Array.from(modelMap.values())
      .filter((m) => m.inputTokens + m.outputTokens > 0)
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

    const totalCostUsd = costByModel.reduce((s, m) => s + m.estimatedCostUsd, 0);
    const totalInputTokens = costByModel.reduce((s, m) => s + m.inputTokens, 0);
    const totalOutputTokens = costByModel.reduce((s, m) => s + m.outputTokens, 0);
    const totalOptimizations = optLogs.length + aiLogs.length;

    // Cost by provider (merge model rows)
    const providerMap = new Map<string, number>();
    for (const m of costByModel) {
      providerMap.set(m.provider, (providerMap.get(m.provider) ?? 0) + m.estimatedCostUsd);
    }
    const costByProvider = Array.from(providerMap.entries())
      .map(([provider, costUsd]) => ({ provider, costUsd }))
      .sort((a, b) => b.costUsd - a.costUsd);

    return {
      totalCostUsd,
      costByProvider,
      costByModel,
      totalInputTokens,
      totalOutputTokens,
      costPerOptimization: totalOptimizations > 0 ? totalCostUsd / totalOptimizations : 0,
      totalOptimizations,
      pricingLoaded: pricing.length > 0,
    };
  }, [pricingQuery.data, logsQuery.data, usageLogsQuery.data]);

  return {
    summary,
    isLoading: pricingQuery.isLoading || logsQuery.isLoading || usageLogsQuery.isLoading,
    pricing: pricingQuery.data ?? [],
  };
}
