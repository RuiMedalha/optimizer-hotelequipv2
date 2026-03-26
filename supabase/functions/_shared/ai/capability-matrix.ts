// supabase/functions/_shared/ai/capability-matrix.ts
// Static capability → provider/model defaults. No DB dependency.
import type { CapabilityType } from "./provider-types.ts";

export const CAPABILITY_DEFAULTS: Record<
  CapabilityType,
  { provider: string; model: string; fallback: Array<{ provider: string; model: string }> }
> = {
  content_generation: {
    provider: "anthropic", model: "claude-sonnet-4-6",
    fallback: [{ provider: "openai", model: "gpt-4o" }, { provider: "gemini", model: "gemini-2.5-pro" }],
  },
  seo_generation: {
    provider: "anthropic", model: "claude-haiku-4-5-20251001",
    fallback: [{ provider: "openai", model: "gpt-4o-mini" }],
  },
  classification: {
    provider: "openai", model: "gpt-4o-mini",
    fallback: [{ provider: "anthropic", model: "claude-haiku-4-5-20251001" }],
  },
  extraction: {
    provider: "openai", model: "gpt-4o",
    fallback: [{ provider: "anthropic", model: "claude-sonnet-4-6" }],
  },
  reasoning: {
    provider: "anthropic", model: "claude-sonnet-4-6",
    fallback: [{ provider: "openai", model: "gpt-4o" }],
  },
  multimodal_vision: {
    provider: "gemini", model: "gemini-2.5-flash",
    fallback: [{ provider: "openai", model: "gpt-4o" }],
  },
  web_research: {
    provider: "gemini", model: "gemini-2.5-pro",
    fallback: [{ provider: "openai", model: "gpt-4o" }],
  },
  enrichment: {
    provider: "gemini", model: "gemini-2.5-flash",
    fallback: [{ provider: "openai", model: "gpt-4o-mini" }],
  },
  translation: {
    provider: "anthropic", model: "claude-haiku-4-5-20251001",
    fallback: [{ provider: "openai", model: "gpt-4o-mini" }],
  },
  summarization: {
    provider: "anthropic", model: "claude-haiku-4-5-20251001",
    fallback: [{ provider: "gemini", model: "gemini-2.5-flash" }],
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
  product_enrichment: "enrichment",
  // Summarization
  summarization: "summarization",
  summarize: "summarization",
};

export function mapTaskTypeToCapability(taskType: string): CapabilityType {
  return TASK_TYPE_TO_CAPABILITY[taskType] ?? "content_generation";
}
