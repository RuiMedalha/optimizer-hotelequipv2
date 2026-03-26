// supabase/functions/_shared/ai/output-formatter.ts
// Lightweight post-processing for AI-generated product fields.
// Does NOT semantically rewrite content. Only strips known weak PATTERN openings
// and normalizes whitespace. Safe to apply to any OptimizedFields object.

import type { OptimizedFields } from "./output-guardrails.ts";
import { validateProductOutput } from "./output-guardrails.ts";
export type { ValidationResult } from "./output-guardrails.ts";

// PT-PT weak opening phrase patterns to strip from description fields.
// These are EXACT prefix patterns — only removed when they start the text.
const WEAK_PHRASE_PATTERNS: RegExp[] = [
  /^Este produto é ideal para\b/i,
  /^Este produto é perfeito para\b/i,
  /^Este equipamento é ideal para\b/i,
  /^Apresentamos o\b/i,
  /^Descubra o\b/i,
  /^Conheça o\b/i,
  /^De alta qualidade[,.]?\s*/i,
  /^Alta qualidade[,.]?\s*/i,
  /^Excelente desempenho[,.]?\s*/i,
  /^Produto de (alta |excelente )?qualidade[,.]?\s*/i,
  /^Com um design\b/i,
  /^Com design\b/i,
  /^Equipamento de (alta |excelente )?qualidade[,.]?\s*/i,
  /^Este modelo é\b/i,
  /^O nosso\b/i,
  /^A nossa\b/i,
];

// Generic filler phrases to strip from ANYWHERE in text (not just prefix).
// Matched globally and replaced with empty string.
const GENERIC_FILLER_PATTERNS: RegExp[] = [
  /\bideal para (qualquer|todo o tipo de) (estabelecimento|negócio|cozinha)\b/gi,
  /\balta qualidade\b(?! [a-záéíóúâêîôûãõç])/gi,  // "alta qualidade" not followed by a qualifier
  /\bexcelente relação qualidade[- ]preço\b/gi,
  /\bsolução (ideal|perfeita|completa) para\b/gi,
  /\bgarante (excelentes |ótimos )?resultados\b/gi,
  /\bperfeito para (qualquer|todo)\b/gi,
];

export function stripWeakPhrases(text: string): string {
  // Disabled: phrase stripping removed valid B2B HORECA marketing copy.
  // Patterns preserved above for future opt-in re-enablement.
  // Only return early for empty/null input to maintain the contract.
  if (!text) return "";
  return text;
}

export function normalizeWhitespace(text: string): string {
  if (!text) return text;
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface FormattedOutput {
  fields: OptimizedFields;
  issues: string[];
}

export function formatProductOutput(fields: OptimizedFields, requestedFields?: string[]): FormattedOutput {
  const result = { ...fields };
  const TEXT_FIELDS = ["optimized_short_description", "optimized_description"] as const;
  for (const field of TEXT_FIELDS) {
    if (typeof result[field] === "string") {
      result[field] = stripWeakPhrases(result[field] as string);
      result[field] = normalizeWhitespace(result[field] as string);
    }
  }
  const { issues } = validateProductOutput(result, requestedFields);
  return { fields: result, issues };
}
