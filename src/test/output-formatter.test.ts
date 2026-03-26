// src/test/output-formatter.test.ts
// NOTE: These tests run in vitest (browser/Node environment).
// Pure functions are inlined to avoid cross-runtime import issues.
// Keep in sync with output-formatter.ts and output-guardrails.ts.

import { describe, it, expect } from "vitest";

// ─── Inlined from output-formatter.ts — keep in sync ─────────────────────────
const WEAK_PHRASE_PATTERNS: RegExp[] = [
  /^Este produto é ideal para\b/i,
  /^Este produto é perfeito para\b/i,
  /^Apresentamos o\b/i,
  /^Descubra o\b/i,
  /^Conheça o\b/i,
  /^De alta qualidade[,.]?\s*/i,
  /^Alta qualidade[,.]?\s*/i,
  /^Excelente desempenho[,.]?\s*/i,
  /^Produto de (alta |excelente )?qualidade[,.]?\s*/i,
];

function stripWeakPhrases(text: string): string {
  if (!text) return "";
  for (const pattern of WEAK_PHRASE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const remainder = text.substring(match[0].length).trimStart();
      if (remainder.length > 20) {
        return remainder.charAt(0).toUpperCase() + remainder.slice(1);
      }
    }
  }
  return text;
}

function normalizeWhitespace(text: string): string {
  if (!text) return text;
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Inlined from output-guardrails.ts — keep in sync ────────────────────────
interface OptimizedFields {
  optimized_title?: string;
  meta_title?: string;
  meta_description?: string;
  seo_slug?: string;
  optimized_short_description?: string;
  optimized_description?: string;
  [key: string]: unknown;
}
interface ValidationResult {
  valid: boolean;
  issues: string[];
}
function validateProductOutput(fields: OptimizedFields): ValidationResult {
  const issues: string[] = [];
  const REQUIRED = ["optimized_title", "optimized_short_description", "meta_title", "meta_description"];
  for (const field of REQUIRED) {
    const val = fields[field];
    if (typeof val !== "string" || (val as string).trim().length === 0) {
      issues.push(`required field "${field}" is empty or missing`);
    }
  }
  const DESCRIPTION_FIELDS = ["optimized_short_description", "optimized_description"];
  for (const field of DESCRIPTION_FIELDS) {
    const val = fields[field];
    if (typeof val !== "string" || (val as string).trim().length === 0) continue;
    const visibleText = (val as string).replace(/<[^>]+>/g, "").trim();
    if (visibleText.length === 0) continue;
    const lastChar = visibleText[visibleText.length - 1];
    if (!/[.!?]/.test(lastChar)) {
      issues.push(`field "${field}" ends abruptly (last visible char: "${lastChar}")`);
    }
  }
  const HTML_FIELDS = ["optimized_short_description", "optimized_description"];
  for (const field of HTML_FIELDS) {
    const val = fields[field];
    if (typeof val !== "string" || (val as string).trim().length === 0) continue;
    const openWithoutClose = /<[^>]*$/.test(val as string);
    if (openWithoutClose) {
      issues.push(`field "${field}" contains an unclosed HTML tag`);
    }
    const BLOCK_TAGS = ["table", "thead", "tbody", "tr", "td", "th", "ul", "ol", "li"];
    for (const tag of BLOCK_TAGS) {
      const openCount = ((val as string).match(new RegExp(`<${tag}[\\s>]`, "gi")) || []).length;
      const closeCount = ((val as string).match(new RegExp(`</${tag}>`, "gi")) || []).length;
      if (openCount !== closeCount) {
        issues.push(`field "${field}" has mismatched <${tag}> tags (${openCount} open, ${closeCount} close)`);
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

function formatProductOutput(fields: OptimizedFields): { fields: OptimizedFields; issues: string[] } {
  const result = { ...fields };
  const TEXT_FIELDS = ["optimized_short_description", "optimized_description"] as const;
  for (const field of TEXT_FIELDS) {
    if (typeof result[field] === "string") {
      result[field] = stripWeakPhrases(result[field] as string);
      result[field] = normalizeWhitespace(result[field] as string);
    }
  }
  const { issues } = validateProductOutput(result);
  return { fields: result, issues };
}
// ─────────────────────────────────────────────────────────────────────────────

describe("stripWeakPhrases", () => {
  it('removes "Este produto é ideal para" prefix and capitalizes remainder', () => {
    const input = "Este produto é ideal para cozinhas profissionais com alta demanda.";
    const result = stripWeakPhrases(input);
    expect(result).not.toMatch(/^Este produto é ideal para/i);
    expect(result.charAt(0)).toBe(result.charAt(0).toUpperCase());
    expect(result).toContain("Cozinhas profissionais");
  });

  it('removes "Apresentamos o" prefix', () => {
    const input = "Apresentamos o novo forno combinado para uso profissional.";
    const result = stripWeakPhrases(input);
    expect(result).not.toMatch(/^Apresentamos o/i);
    expect(result).toContain("Novo forno combinado");
  });

  it("preserves text that does not start with a weak phrase", () => {
    const input = "Forno combinado de 10 tabuleiros. Ideal para hotelaria.";
    expect(stripWeakPhrases(input)).toBe(input);
  });

  it("does not strip if the remainder after the pattern is 20 chars or fewer (too short)", () => {
    const input = "De alta qualidade, poucos chars.";
    expect(stripWeakPhrases(input)).toBe(input);
  });

  it("capitalizes the first character of the stripped remainder", () => {
    const input = "Este produto é perfeito para restaurantes de luxo com serviço completo.";
    const result = stripWeakPhrases(input);
    expect(result.charAt(0)).toBe("R");
  });

  it("returns empty string unchanged", () => {
    expect(stripWeakPhrases("")).toBe("");
  });
});

describe("normalizeWhitespace", () => {
  it("collapses multiple spaces into one", () => {
    expect(normalizeWhitespace("palavra  com   espaços")).toBe("palavra com espaços");
  });

  it("collapses tabs into single space", () => {
    expect(normalizeWhitespace("coluna\t\tvalor")).toBe("coluna valor");
  });

  it("collapses 3+ newlines into double newline", () => {
    expect(normalizeWhitespace("para1\n\n\npara2")).toBe("para1\n\npara2");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeWhitespace("  texto  ")).toBe("texto");
  });

  it("returns empty string unchanged", () => {
    expect(normalizeWhitespace("")).toBe("");
  });
});

describe("formatProductOutput", () => {
  const validBase: OptimizedFields = {
    optimized_title: "Forno Combinado Profissional 10 Tabuleiros.",
    optimized_short_description: "Forno combinado para uso profissional em restaurantes.",
    meta_title: "Forno Combinado Profissional.",
    meta_description: "O forno combinado ideal para restaurantes e hotéis.",
  };

  it("returns issues array empty for valid, clean output", () => {
    const { fields, issues } = formatProductOutput(validBase);
    expect(issues).toHaveLength(0);
    expect(fields.optimized_title).toBe(validBase.optimized_title);
  });

  it("strips weak phrase from optimized_short_description", () => {
    const input: OptimizedFields = {
      ...validBase,
      optimized_short_description:
        "Este produto é ideal para cozinhas industriais de grande volume com equipamento especializado.",
    };
    const { fields } = formatProductOutput(input);
    expect(fields.optimized_short_description).not.toMatch(/^Este produto é ideal para/i);
  });

  it("returns issues for empty required field", () => {
    const { issues } = formatProductOutput({ ...validBase, optimized_title: "" });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.includes('"optimized_title"'))).toBe(true);
  });

  it("does not modify optimized_title (not in TEXT_FIELDS)", () => {
    const input: OptimizedFields = {
      ...validBase,
      optimized_title: "Apresentamos o forno combinado profissional.",
    };
    const { fields } = formatProductOutput(input);
    expect(fields.optimized_title).toBe("Apresentamos o forno combinado profissional.");
  });

  it("normalizes excess whitespace in optimized_short_description", () => {
    const input: OptimizedFields = {
      ...validBase,
      optimized_short_description: "Descrição   com   espaços   a   mais.",
    };
    const { fields } = formatProductOutput(input);
    expect(fields.optimized_short_description).toBe("Descrição com espaços a mais.");
  });

  it("applies weak phrase stripping to optimized_description", () => {
    const fields = {
      optimized_title: "Título.",
      optimized_short_description: "Descrição curta.",
      meta_title: "Meta título.",
      meta_description: "Meta descrição.",
      optimized_description: "Este produto é ideal para restaurantes e hotéis com alto volume de produção.",
    };
    const { fields: out } = formatProductOutput(fields);
    expect(out.optimized_description).not.toMatch(/^Este produto é ideal para/i);
    expect(out.optimized_description as string).toContain("Restaurantes");
  });
});
