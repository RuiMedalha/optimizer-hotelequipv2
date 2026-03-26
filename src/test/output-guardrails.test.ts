// src/test/output-guardrails.test.ts
// NOTE: These tests run in vitest (browser/Node environment).
// The guardrails module is pure TS with no Deno-specific imports, so it
// can be tested directly. We inline the logic here to avoid cross-runtime
// import issues — the test validates the expected behavior.
//
// Inlined from output-guardrails.ts — keep in sync if production logic changes.

import { describe, it, expect } from "vitest";

// Inline the pure functions for testing (identical to output-guardrails.ts)
function trimToWord(value: string, maxLen: number): string {
  if (!value || value.length <= maxLen) return value;
  const cut = value.substring(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 0 ? cut.substring(0, lastSpace).trimEnd() : cut;
}

function trimToSentence(value: string, maxLen: number): string {
  if (!value || value.length <= maxLen) return value;
  const cut = value.substring(0, maxLen);
  const lastSentence = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
    cut.lastIndexOf(".\n"),
    cut.lastIndexOf("!\n"),
    cut.lastIndexOf("?\n"),
    cut.endsWith(".") ? cut.length - 1 : -1,
    cut.endsWith("!") ? cut.length - 1 : -1,
    cut.endsWith("?") ? cut.length - 1 : -1,
  );
  if (lastSentence > 0) {
    return cut.substring(0, lastSentence + 1).trimEnd();
  }
  return trimToWord(value, maxLen);
}

function normalizeSlug(value: string, maxLen: number): string {
  if (!value) return value;
  return value
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .substring(0, maxLen)
    .replace(/-+$/, "");
}

describe("output guardrails", () => {
  describe("trimToWord", () => {
    it("returns value unchanged when within limit", () => {
      expect(trimToWord("Fritadeira UNOX 10L", 70)).toBe("Fritadeira UNOX 10L");
    });

    it("trims at last word boundary before limit", () => {
      const long = "Fritadeira Elétrica Profissional UNOX 10 Litros com Controlo Digital";
      // 70 chars: "Fritadeira Elétrica Profissional UNOX 10 Litros com Controlo Digital" = 68 chars, no trim needed
      expect(trimToWord(long, 50).length).toBeLessThanOrEqual(50);
      expect(trimToWord(long, 50)).not.toMatch(/^\S*\s$/); // no trailing space
    });

    it("does not cut mid-word", () => {
      const result = trimToWord("Frigorífico Combinado Inox 400L Professiona", 30);
      expect(result.length).toBeLessThanOrEqual(30);
      expect(result).not.toMatch(/\s$/); // no trailing space
    });
  });

  describe("trimToSentence", () => {
    it("returns value unchanged when within limit", () => {
      const short = "Produto de alta qualidade.";
      expect(trimToSentence(short, 160)).toBe(short);
    });

    it("trims at last sentence boundary", () => {
      const text = "Primeiro parágrafo com detalhe. Segundo parágrafo muito longo que excede o limite máximo permitido de cento e sessenta caracteres totais.";
      const result = trimToSentence(text, 60);
      expect(result).toBe("Primeiro parágrafo com detalhe.");
      expect(result.length).toBeLessThanOrEqual(60);
    });

    it("handles sentence ending exactly at the cut boundary (no trailing space)", () => {
      // "Frase curta." is 12 chars; limit is 12 — ends exactly at boundary
      const text = "Frase curta.Mais conteúdo que excede o limite máximo.";
      const result = trimToSentence(text, 12);
      expect(result).toBe("Frase curta.");
    });

    it("handles ! and ? newline terminators", () => {
      const text = "Atenção!\nMais texto longo que excede o limite máximo permitido aqui.";
      const result = trimToSentence(text, 20);
      expect(result).toBe("Atenção!");
    });
  });

  describe("normalizeSlug", () => {
    it("lowercases and replaces spaces with hyphens", () => {
      expect(normalizeSlug("Fritadeira Elétrica 10L", 100)).toBe("fritadeira-eltrica-10l");
    });

    it("removes trailing hyphens", () => {
      expect(normalizeSlug("produto ", 100)).toBe("produto");
    });

    it("respects max length", () => {
      expect(normalizeSlug("a".repeat(200), 100).length).toBeLessThanOrEqual(100);
    });
  });
});

// ─── Inlined helpers for new tests ───────────────────────────────────────────
// trimHtmlSafe — inlined from output-guardrails.ts; keep in sync.
function trimHtmlSafe(
  value: string,
  maxLen: number,
  fallbackFn: (v: string, n: number) => string,
): string {
  if (!value || value.length <= maxLen) return value;
  const cut = value.substring(0, maxLen);
  const lastClose = cut.lastIndexOf(">");
  if (lastClose < 0) return fallbackFn(value, maxLen);
  const beforeClose = cut.substring(0, lastClose + 1);
  const lastOpen = beforeClose.lastIndexOf("<");
  if (lastOpen >= 0) {
    const closeAfterOpen = beforeClose.indexOf(">", lastOpen);
    if (closeAfterOpen < 0) {
      const safeEnd = beforeClose.substring(0, lastOpen).trimEnd();
      return fallbackFn(safeEnd, safeEnd.length);
    }
  }
  return fallbackFn(value, lastClose + 1);
}

// validateProductOutput — inlined from output-guardrails.ts; keep in sync.
interface ValidationResult {
  valid: boolean;
  issues: string[];
}
function validateProductOutput(fields: Record<string, unknown>): ValidationResult {
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
// ─────────────────────────────────────────────────────────────────────────────

describe("trimHtmlSafe", () => {
  it("stops before an opening <table> tag that would be cut mid-way", () => {
    const input = "Texto antes. <table><tr><td>celula</td></tr></table>";
    const result = trimHtmlSafe(input, 15, trimToWord);
    expect(result).toBe("Texto antes.");
    expect(result).not.toContain("<table");
  });

  it("returns full string when within maxLen", () => {
    const input = "<p>Curto.</p>";
    expect(trimHtmlSafe(input, 100, trimToWord)).toBe("<p>Curto.</p>");
  });

  it("delegates to fallback when no HTML tags are present", () => {
    const input = "palavra um dois tres quatro cinco seis sete";
    const result = trimHtmlSafe(input, 20, trimToWord);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result).not.toMatch(/\s$/);
  });
});

describe("validateProductOutput", () => {
  const baseValid = {
    optimized_title: "Título válido.",
    optimized_short_description: "Descrição curta válida.",
    meta_title: "Meta título.",
    meta_description: "Meta descrição completa.",
  };

  it("returns valid=true for a complete, well-formed output", () => {
    const { valid, issues } = validateProductOutput(baseValid);
    expect(valid).toBe(true);
    expect(issues).toHaveLength(0);
  });

  it("reports missing required field when optimized_title is empty", () => {
    const { valid, issues } = validateProductOutput({ ...baseValid, optimized_title: "" });
    expect(valid).toBe(false);
    expect(issues.some((i) => i.includes('"optimized_title"') && i.includes("empty"))).toBe(true);
  });

  it("reports abrupt ending when optimized_short_description does not end with punctuation", () => {
    const { valid, issues } = validateProductOutput({
      ...baseValid,
      optimized_short_description: "Esta descrição termina de forma abrupta sem pontuação",
    });
    expect(valid).toBe(false);
    expect(issues.some((i) => i.includes('"optimized_short_description"') && i.includes("abruptly"))).toBe(true);
  });

  it("reports broken HTML table when <table> has no </table>", () => {
    const { valid, issues } = validateProductOutput({
      ...baseValid,
      optimized_short_description: "Texto. <table><tr><td>Dado</td></tr>",
    });
    expect(valid).toBe(false);
    expect(issues.some((i) => i.includes("<table>") && i.includes("mismatched"))).toBe(true);
  });

  it("does not flag optimized_description as required (it is optional)", () => {
    const withoutDesc = { ...baseValid };
    const { issues } = validateProductOutput(withoutDesc);
    expect(issues.some((i) => i.includes('"optimized_description"') && i.includes("required"))).toBe(false);
  });
});
