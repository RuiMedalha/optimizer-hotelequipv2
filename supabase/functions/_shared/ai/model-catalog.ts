// supabase/functions/_shared/ai/model-catalog.ts
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ModelConfig, CapabilityType } from "./provider-types.ts";

// Static fallback — used when DB is unreachable. Must be kept in sync with seed data.
export const STATIC_CATALOG: ModelConfig[] = [
  {
    providerId: "anthropic", modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6",
    contextWindow: 200000, maxOutputTokens: 8192, supportsVision: true, supportsFunctionCalling: true,
    supportsJsonMode: false, inputCostPer1k: 0.003, outputCostPer1k: 0.015, status: "active",
    recommendedFor: ["content_generation", "reasoning", "extraction"], enabled: true,
  },
  {
    providerId: "anthropic", modelId: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5",
    contextWindow: 200000, maxOutputTokens: 8192, supportsVision: false, supportsFunctionCalling: true,
    supportsJsonMode: false, inputCostPer1k: 0.001, outputCostPer1k: 0.005, status: "active",
    recommendedFor: ["seo_generation", "translation", "summarization"], enabled: true,
  },
  {
    providerId: "anthropic", modelId: "claude-opus-4-6", displayName: "Claude Opus 4.6",
    contextWindow: 200000, maxOutputTokens: 4096, supportsVision: true, supportsFunctionCalling: true,
    supportsJsonMode: false, inputCostPer1k: 0.015, outputCostPer1k: 0.075, status: "active",
    recommendedFor: ["reasoning"], enabled: true,
  },
  {
    providerId: "openai", modelId: "gpt-4o", displayName: "GPT-4o",
    contextWindow: 128000, maxOutputTokens: 4096, supportsVision: true, supportsFunctionCalling: true,
    supportsJsonMode: true, inputCostPer1k: 0.005, outputCostPer1k: 0.015, status: "active",
    recommendedFor: ["extraction", "reasoning", "multimodal_vision"], enabled: true,
  },
  {
    providerId: "openai", modelId: "gpt-4o-mini", displayName: "GPT-4o Mini",
    contextWindow: 128000, maxOutputTokens: 4096, supportsVision: false, supportsFunctionCalling: true,
    supportsJsonMode: true, inputCostPer1k: 0.00015, outputCostPer1k: 0.0006, status: "active",
    recommendedFor: ["classification", "seo_generation"], enabled: true,
  },
  {
    providerId: "gemini", modelId: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro",
    contextWindow: 1000000, maxOutputTokens: 8192, supportsVision: true, supportsFunctionCalling: true,
    supportsJsonMode: true, inputCostPer1k: 0.00125, outputCostPer1k: 0.005, status: "active",
    recommendedFor: ["web_research", "reasoning"], enabled: true,
  },
  {
    providerId: "gemini", modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash",
    contextWindow: 1000000, maxOutputTokens: 8192, supportsVision: true, supportsFunctionCalling: true,
    supportsJsonMode: true, inputCostPer1k: 0.00015, outputCostPer1k: 0.0006, status: "active",
    recommendedFor: ["multimodal_vision", "enrichment"], enabled: true,
  },
  {
    providerId: "gemini", modelId: "gemini-2.5-flash-lite", displayName: "Gemini 2.5 Flash Lite",
    contextWindow: 1000000, maxOutputTokens: 8192, supportsVision: true, supportsFunctionCalling: true,
    supportsJsonMode: true, inputCostPer1k: 0.0001, outputCostPer1k: 0.0004, status: "active",
    recommendedFor: ["classification", "seo_generation", "summarization"], enabled: true,
  },
  {
    providerId: "gemini", modelId: "gemini-3-flash-preview", displayName: "Gemini 3 Flash (preview)",
    contextWindow: 1000000, maxOutputTokens: 8192, supportsVision: true, supportsFunctionCalling: true,
    supportsJsonMode: true, inputCostPer1k: 0.00015, outputCostPer1k: 0.0006, status: "active",
    recommendedFor: ["content_generation", "enrichment"], enabled: true,
  },
  {
    providerId: "gemini", modelId: "gemini-3-pro-preview", displayName: "Gemini 3 Pro (preview)",
    contextWindow: 1000000, maxOutputTokens: 8192, supportsVision: true, supportsFunctionCalling: true,
    supportsJsonMode: true, inputCostPer1k: 0.00125, outputCostPer1k: 0.01, status: "active",
    recommendedFor: ["reasoning", "web_research"], enabled: true,
  },
  {
    providerId: "gemini", modelId: "gemini-3.1-flash-image-preview", displayName: "Gemini 3.1 Flash Image (preview)",
    contextWindow: 1000000, maxOutputTokens: 8192, supportsVision: true, supportsFunctionCalling: false,
    supportsJsonMode: false, inputCostPer1k: 0.00015, outputCostPer1k: 0.0006, status: "active",
    recommendedFor: ["multimodal_vision"], enabled: true,
  },
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
  } catch { /* fall through to static */ }
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
