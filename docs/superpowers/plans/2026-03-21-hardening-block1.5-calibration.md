# Production Hardening Block 1.5 — Final Calibration Layer

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strengthen AI output quality and model/provider traceability without architectural changes.

**Architecture:** Four independent improvements: (1) HTML-aware trimming + output validation in the existing guardrails module, (2) a new lightweight output formatter for weak-phrase detection, (3) model traceability fields added to RunMeta so callers can see requested vs actual model, (4) fix optimize-product's Lovable-gateway model IDs to use canonical provider-registry format. A fifth task adds 4 PT-PT quality rules to the DB-seeded product_optimization prompt.

**Tech Stack:** Deno Edge Functions (TypeScript), Vitest (browser tests for pure functions), Supabase SQL migrations.

---

## Scope boundaries

### What this plan changes
- `supabase/functions/_shared/ai/output-guardrails.ts` — add HTML-safe trimming + `validateProductOutput()`
- `supabase/functions/_shared/ai/output-formatter.ts` — CREATE: `stripWeakPhrases()`, `normalizeWhitespace()`, `formatProductOutput()`
- `supabase/functions/_shared/ai/provider-types.ts` — add `requestedModel?: string` and `fallbackReason?: string` to `RunMeta`
- `supabase/functions/_shared/ai/prompt-runner.ts` — populate `requestedModel` and `fallbackReason` in RunMeta
- `supabase/functions/resolve-ai-route/index.ts` — expose `requestedModel` in HTTP response meta
- `supabase/functions/optimize-product/index.ts` — fix MODEL_MAP: pass `providerOverride: "gemini"` + canonical model IDs (strip `google/` prefix) to resolve-ai-route; wire `formatProductOutput` after `enforceFieldLimits`
- `supabase/migrations/20260321000001_seed_prompt_v2_quality_rules.sql` — CREATE: add v2 of `product_optimization_global` with PT-PT quality rules appended
- `src/test/output-formatter.test.ts` — CREATE: unit tests for formatter

### What this plan deliberately excludes
- No DB schema changes (ai_usage_logs, optimization_logs columns stay as-is)
- No changes to enrich-products or extract-pdf-pages routing (Block 5 scope)
- No rewriting of semantic content — formatter only strips known weak phrase PATTERNS
- No changes to extract-pdf-pages Lovable gateway call (line 71) — Block 5 scope
- Hardcoded subtask models in optimize-product (lines ~712, ~1512 reranking/variation) — those are subtask calls that do NOT go through resolve-ai-route; leave for Block 5
- No changes to provider-registry resolveRoute() logic itself

---

## File structure

```
supabase/functions/_shared/ai/
  output-guardrails.ts          ← MODIFY: HTML-safe trim + validateProductOutput()
  output-formatter.ts           ← CREATE: stripWeakPhrases, normalizeWhitespace, formatProductOutput
  provider-types.ts             ← MODIFY: add requestedModel + fallbackReason to RunMeta
  prompt-runner.ts              ← MODIFY: populate requestedModel in RunMeta

supabase/functions/resolve-ai-route/
  index.ts                      ← MODIFY: expose requestedModel in HTTP response meta

supabase/functions/optimize-product/
  index.ts                      ← MODIFY: fix MODEL_MAP + wire formatProductOutput

supabase/migrations/
  20260321000001_seed_prompt_v2_quality_rules.sql  ← CREATE: prompt v2

src/test/
  output-formatter.test.ts      ← CREATE: unit tests
```

---

## Task 1 — Enhance output-guardrails.ts with HTML-aware trimming and output validation

**Files:** MODIFY `supabase/functions/_shared/ai/output-guardrails.ts`, ADD tests to `src/test/output-guardrails.test.ts`

### Steps

- [ ] **1.1** Open `supabase/functions/_shared/ai/output-guardrails.ts`. Currently 92 lines. The file exports `OptimizedFields` (line 51) and `enforceFieldLimits` (line 71). The private helpers `trimToWord` (line 6), `trimToSentence` (line 14), and `normalizeSlug` (line 41) are not exported. No HTML-aware logic exists.

- [ ] **1.2** Add the `trimHtmlSafe` helper function after line 11 (after `trimToWord`). Insert before the `trimToSentence` function at line 14:

```typescript
/**
 * Trim a string to maxLen characters in an HTML-safe way.
 * Finds the last `>` before maxLen to avoid cutting inside a tag's content,
 * then walks back to before any unclosed `<` tag, then applies fallbackFn.
 * If no `>` exists before maxLen, delegates directly to fallbackFn.
 */
function trimHtmlSafe(
  value: string,
  maxLen: number,
  fallbackFn: (v: string, n: number) => string,
): string {
  if (!value || value.length <= maxLen) return value;
  // Find the last `>` at or before maxLen
  const cut = value.substring(0, maxLen);
  const lastClose = cut.lastIndexOf(">");
  if (lastClose < 0) {
    // No HTML structure detected — use fallback directly
    return fallbackFn(value, maxLen);
  }
  // Work from lastClose backward to find any unclosed `<`
  const beforeClose = cut.substring(0, lastClose + 1);
  const lastOpen = beforeClose.lastIndexOf("<");
  if (lastOpen >= 0) {
    // Check if there is a matching `>` after this `<` within beforeClose
    const closeAfterOpen = beforeClose.indexOf(">", lastOpen);
    if (closeAfterOpen < 0) {
      // Unclosed tag found — trim to before the `<`
      const safeEnd = beforeClose.substring(0, lastOpen).trimEnd();
      return fallbackFn(safeEnd, safeEnd.length);
    }
  }
  // All tags are closed — apply fallback to the cut at lastClose+1
  return fallbackFn(value, lastClose + 1);
}
```

- [ ] **1.3** Export the `ValidationResult` interface and add the `validateProductOutput` function after the `enforceFieldLimits` export (after line 91, at the end of the file):

```typescript
/** Result of output validation. */
export interface ValidationResult {
  valid: boolean;
  issues: string[];
}

/**
 * Validate AI-generated product output fields.
 * Returns { valid: boolean; issues: string[] }.
 * Does not throw. Issues array is empty when valid === true.
 *
 * Checks:
 *   1. Required fields are present and non-empty.
 *   2. Description fields end with sentence-ending punctuation (not abrupt).
 *   3. HTML fields do not have broken (unclosed) tags.
 */
export function validateProductOutput(fields: OptimizedFields): ValidationResult {
  const issues: string[] = [];

  // 1. Required fields must be non-empty strings
  const REQUIRED = [
    "optimized_title",
    "optimized_short_description",
    "meta_title",
    "meta_description",
  ] as const;
  for (const field of REQUIRED) {
    const val = fields[field];
    if (typeof val !== "string" || val.trim().length === 0) {
      issues.push(`required field "${field}" is empty or missing`);
    }
  }

  // 2. Description fields must not end abruptly (last visible char must be sentence-ending punctuation)
  const DESCRIPTION_FIELDS = [
    "optimized_short_description",
    "optimized_description",
  ] as const;
  for (const field of DESCRIPTION_FIELDS) {
    const val = fields[field];
    if (typeof val !== "string" || val.trim().length === 0) continue;
    // Strip HTML tags to get visible text
    const visibleText = val.replace(/<[^>]+>/g, "").trim();
    if (visibleText.length === 0) continue;
    const lastChar = visibleText[visibleText.length - 1];
    if (!/[.!?]/.test(lastChar)) {
      issues.push(`field "${field}" ends abruptly (last visible char: "${lastChar}")`);
    }
  }

  // 3. HTML fields must not have broken (unclosed) tags
  const HTML_FIELDS = [
    "optimized_short_description",
    "optimized_description",
  ] as const;
  for (const field of HTML_FIELDS) {
    const val = fields[field];
    if (typeof val !== "string" || val.trim().length === 0) continue;
    // Check for any `<tag...` without a matching `>` — simple heuristic
    const openWithoutClose = /<[^>]*$/.test(val);
    if (openWithoutClose) {
      issues.push(`field "${field}" contains an unclosed HTML tag`);
    }
    // Check for unmatched block-level open tags (e.g. <table without </table>)
    const BLOCK_TAGS = ["table", "thead", "tbody", "tr", "td", "th", "ul", "ol", "li"];
    for (const tag of BLOCK_TAGS) {
      const openCount = (val.match(new RegExp(`<${tag}[\\s>]`, "gi")) || []).length;
      const closeCount = (val.match(new RegExp(`</${tag}>`, "gi")) || []).length;
      if (openCount !== closeCount) {
        issues.push(
          `field "${field}" has mismatched <${tag}> tags (${openCount} open, ${closeCount} close)`,
        );
      }
    }
  }

  return { valid: issues.length === 0, issues };
}
```

- [ ] **1.4** Update `enforceFieldLimits` to use `trimHtmlSafe` for `optimized_short_description` and `optimized_description`. Replace the existing block at lines 86–88:

  **Old code (lines 86–88):**
  ```typescript
    if (typeof result.optimized_short_description === "string") {
      result.optimized_short_description = trimToSentence(result.optimized_short_description, 500);
    }
  ```

  **New code:**
  ```typescript
    if (typeof result.optimized_short_description === "string") {
      result.optimized_short_description = trimHtmlSafe(
        result.optimized_short_description,
        500,
        trimToSentence,
      );
    }
    if (typeof result.optimized_description === "string") {
      result.optimized_description = trimHtmlSafe(
        result.optimized_description,
        5000,
        trimToWord,
      );
    }
  ```

- [ ] **1.5** Add new tests to `src/test/output-guardrails.test.ts`. The file currently ends at line 109. **ADD** the following block after the closing `});` of the `describe("output guardrails", ...)` block (do not replace existing tests):

```typescript
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
    // The string is: "Texto antes. <table><tr><td>celula</td></tr></table>"
    // maxLen = 15 cuts inside the <table> open tag → should stop before "<table>"
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
```

- [ ] **1.6** Run tests to confirm no regressions and new tests pass:
  ```bash
  npx vitest run src/test/output-guardrails.test.ts
  ```
  **Expected output:** All describe blocks pass. No failures. Output similar to:
  ```
  ✓ src/test/output-guardrails.test.ts (14 tests)
  Test Files  1 passed (1)
  Tests  14 passed (14)
  ```

- [ ] **1.7** Commit:
  ```bash
  git add supabase/functions/_shared/ai/output-guardrails.ts src/test/output-guardrails.test.ts
  git commit -m "feat(guardrails): add HTML-safe trimming and validateProductOutput"
  ```

---

## Task 2 — Create output-formatter.ts and unit tests

**Files:** CREATE `supabase/functions/_shared/ai/output-formatter.ts`, CREATE `src/test/output-formatter.test.ts`

### Steps

- [ ] **2.1** Create the file `supabase/functions/_shared/ai/output-formatter.ts` with the following exact content:

```typescript
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
  /^Apresentamos o\b/i,
  /^Descubra o\b/i,
  /^Conheça o\b/i,
  /^O nosso produto\b/i,
  /^De alta qualidade[,.]?\s*/i,
  /^Alta qualidade[,.]?\s*/i,
  /^Excelente desempenho[,.]?\s*/i,
  /^Produto de (alta |excelente )?qualidade[,.]?\s*/i,
];

export function stripWeakPhrases(text: string): string {
  if (!text) return text;
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

export function formatProductOutput(fields: OptimizedFields): FormattedOutput {
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
```

- [ ] **2.2** Create the file `src/test/output-formatter.test.ts` with the following exact content:

```typescript
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
  /^O nosso produto\b/i,
  /^De alta qualidade[,.]?\s*/i,
  /^Alta qualidade[,.]?\s*/i,
  /^Excelente desempenho[,.]?\s*/i,
  /^Produto de (alta |excelente )?qualidade[,.]?\s*/i,
];

function stripWeakPhrases(text: string): string {
  if (!text) return text;
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
    expect(result).toContain("cozinhas profissionais");
  });

  it('removes "Apresentamos o" prefix', () => {
    const input = "Apresentamos o novo forno combinado para uso profissional.";
    const result = stripWeakPhrases(input);
    expect(result).not.toMatch(/^Apresentamos o/i);
    expect(result).toContain("novo forno combinado");
  });

  it("preserves text that does not start with a weak phrase", () => {
    const input = "Forno combinado de 10 tabuleiros. Ideal para hotelaria.";
    expect(stripWeakPhrases(input)).toBe(input);
  });

  it("does not strip if the remainder after the pattern is 20 chars or fewer (too short)", () => {
    // "De alta qualidade, " + 15-char remainder = remainder.length <= 20, so no strip
    const input = "De alta qualidade, poucos chars.";
    // remainder = "poucos chars." = 13 chars — no strip
    expect(stripWeakPhrases(input)).toBe(input);
  });

  it("capitalizes the first character of the stripped remainder", () => {
    const input = "Este produto é perfeito para restaurantes de luxo com serviço completo.";
    const result = stripWeakPhrases(input);
    expect(result.charAt(0)).toBe(result.charAt(0).toUpperCase());
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
    // optimized_title is NOT in TEXT_FIELDS — should be unchanged
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
});
```

- [ ] **2.3** Run tests:
  ```bash
  npx vitest run src/test/output-formatter.test.ts
  ```
  **Expected output:**
  ```
  ✓ src/test/output-formatter.test.ts (16 tests)
  Test Files  1 passed (1)
  Tests  16 passed (16)
  ```

- [ ] **2.4** Commit:
  ```bash
  git add supabase/functions/_shared/ai/output-formatter.ts src/test/output-formatter.test.ts
  git commit -m "feat(formatter): add output-formatter with weak-phrase stripping and whitespace normalization"
  ```

---

## Task 3 — Add requestedModel + fallbackReason to RunMeta

**Files:** MODIFY `supabase/functions/_shared/ai/provider-types.ts`, MODIFY `supabase/functions/_shared/ai/prompt-runner.ts`, MODIFY `supabase/functions/resolve-ai-route/index.ts`

### Steps

- [ ] **3.1** Open `supabase/functions/_shared/ai/provider-types.ts`. The `RunMeta` interface is at lines 121–134. It currently ends with:

```typescript
export interface RunMeta {
  provider: string;
  model: string;
  fallbackUsed: boolean;
  attemptedProviders: string[];
  attemptedModels: string[];
  decisionSource: ResolvedRoute['decisionSource'];
  errorCategory?: ErrorCategory;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  shadowMode: boolean;
}
```

- [ ] **3.2** Add `requestedModel` and `fallbackReason` after `fallbackUsed` (line 124). Replace the existing `RunMeta` block:

```typescript
export interface RunMeta {
  provider: string;
  model: string;
  fallbackUsed: boolean;
  /** The model ID the caller requested via modelOverride, if any. */
  requestedModel?: string;
  /** Human-readable reason a fallback was used, if fallbackUsed === true. */
  fallbackReason?: string;
  attemptedProviders: string[];
  attemptedModels: string[];
  decisionSource: ResolvedRoute['decisionSource'];
  errorCategory?: ErrorCategory;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  shadowMode: boolean;
}
```

- [ ] **3.3** Open `supabase/functions/_shared/ai/prompt-runner.ts`. The `meta` object is built at lines 61–74. Currently it reads:

```typescript
  const meta: RunMeta = {
    provider: raw.provider,
    model: raw.model,
    fallbackUsed: raw.fallbackUsed,
    attemptedProviders: raw.attemptedProviders,
    attemptedModels: raw.attemptedModels,
    decisionSource: route.decisionSource,
    errorCategory: lastErrorCategory,
    latencyMs: raw.latencyMs,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    estimatedCostUsd,
    shadowMode,
  };
```

Replace this block to add `requestedModel` and `fallbackReason`:

```typescript
  const meta: RunMeta = {
    provider: raw.provider,
    model: raw.model,
    fallbackUsed: raw.fallbackUsed,
    requestedModel: params.modelOverride ?? undefined,
    fallbackReason: raw.fallbackUsed ? "primary_provider_failed" : undefined,
    attemptedProviders: raw.attemptedProviders,
    attemptedModels: raw.attemptedModels,
    decisionSource: route.decisionSource,
    errorCategory: lastErrorCategory,
    latencyMs: raw.latencyMs,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    estimatedCostUsd,
    shadowMode,
  };
```

- [ ] **3.4** Open `supabase/functions/resolve-ai-route/index.ts`. The HTTP response meta object is at lines 55–62. Currently:

```typescript
        meta: {
          usedProvider: meta.provider,
          usedModel: meta.model,
          fallbackUsed: meta.fallbackUsed,
          latencyMs: meta.latencyMs,
          taskType,
          promptVersionId: promptVersionId ?? null,
        },
```

Replace with:

```typescript
        meta: {
          usedProvider: meta.provider,
          usedModel: meta.model,
          fallbackUsed: meta.fallbackUsed,
          requestedModel: meta.requestedModel ?? null,
          fallbackReason: meta.fallbackReason ?? null,
          latencyMs: meta.latencyMs,
          taskType,
          promptVersionId: promptVersionId ?? null,
        },
```

- [ ] **3.5** Validate: No TypeScript compilation errors. The `RunMeta` interface is now a superset of the previous interface — all existing callers remain valid because the two new fields are optional (`?`). The HTTP response gains two new nullable fields; callers that only read `usedModel`/`usedProvider` are unaffected.

- [ ] **3.6** Commit:
  ```bash
  git add supabase/functions/_shared/ai/provider-types.ts supabase/functions/_shared/ai/prompt-runner.ts supabase/functions/resolve-ai-route/index.ts
  git commit -m "feat(tracing): add requestedModel and fallbackReason to RunMeta and resolve-ai-route response"
  ```

---

## Task 4 — Fix optimize-product MODEL_MAP and wire formatProductOutput

**Files:** MODIFY `supabase/functions/optimize-product/index.ts`

### Context

The current code at lines 258–274 uses Lovable-gateway format strings (e.g. `"google/gemini-3-flash-preview"`) as `modelOverride` values passed to `resolve-ai-route`. The `resolve-ai-route` function passes `modelOverride` directly to `runPrompt` → `resolveRoute` in `provider-registry.ts`, which expects canonical provider-registry model IDs (e.g. `"gemini-2.5-flash"`) paired with a `providerOverride`. This mismatch means the registry cannot match the model ID and falls back to a default, silently ignoring the user's model selection.

The `enforceFieldLimits` call is at line 1250. The `formatProductOutput` function from Task 2 must be wired after it.

The hardcoded subtask calls at lines 712 and 1512 use `"google/gemini-2.5-flash-lite"` for `knowledge_reranking` and `variation_attribute_extraction` respectively. These are left as-is (Block 5 scope) per the scope boundaries.

### Steps

- [ ] **4.1** Locate the MODEL_MAP declaration at lines 258–264 and the `chosenModel` assignment at lines 271–274. Replace the entire block:

  **Old code (lines 258–274):**
  ```typescript
      // Fetch user's chosen AI model from settings
      const MODEL_MAP: Record<string, string> = {
        "gemini-3-flash": "google/gemini-3-flash-preview",
        "gemini-3-pro": "google/gemini-3-pro-preview",
        "gemini-2.5-pro": "google/gemini-2.5-pro",
        "gemini-2.5-flash": "google/gemini-2.5-flash",
        "gemini-2.5-flash-lite": "google/gemini-2.5-flash-lite",
      };
      const { data: modelSetting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "default_model")
        .maybeSingle();
      // Use override if provided, otherwise fall back to settings
      const chosenModel = modelOverride
        ? (MODEL_MAP[modelOverride] || MODEL_MAP["gemini-3-flash"])
        : (MODEL_MAP[modelSetting?.value || "gemini-3-flash"] || "google/gemini-3-flash-preview");
      console.log(`Using AI model: ${chosenModel} (override: ${modelOverride || "none"}, setting: ${modelSetting?.value || "default"})`);
  ```

  **New code:**
  ```typescript
      // Fetch user's chosen AI model from settings
      // CANONICAL_MODEL_MAP: maps UI model keys to provider-registry format.
      // Use { provider, model } pairs — never Lovable-gateway "google/..." strings.
      const CANONICAL_MODEL_MAP: Record<string, { provider: string; model: string }> = {
        "gemini-3-flash":        { provider: "gemini", model: "gemini-2.5-flash" },   // gemini-3 preview → latest stable flash
        "gemini-3-pro":          { provider: "gemini", model: "gemini-2.5-pro" },     // gemini-3 preview → latest stable pro
        "gemini-2.5-pro":        { provider: "gemini", model: "gemini-2.5-pro" },
        "gemini-2.5-flash":      { provider: "gemini", model: "gemini-2.5-flash" },
        "gemini-2.5-flash-lite": { provider: "gemini", model: "gemini-2.5-flash-lite" },
      };
      const DEFAULT_MODEL_KEY = "gemini-2.5-flash";
      const { data: modelSetting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "default_model")
        .maybeSingle();
      // Use override if provided, otherwise fall back to settings, then to DEFAULT_MODEL_KEY
      const modelKey = modelOverride || modelSetting?.value || DEFAULT_MODEL_KEY;
      const chosenModel = CANONICAL_MODEL_MAP[modelKey] ?? CANONICAL_MODEL_MAP[DEFAULT_MODEL_KEY];
      console.log(`Using AI model: ${chosenModel.model} via provider: ${chosenModel.provider} (key: ${modelKey}, override: ${modelOverride || "none"}, setting: ${modelSetting?.value || "default"})`);
  ```

- [ ] **4.2** Update the `resolve-ai-route` call for `product_optimization` at line 1194. The current body includes:
  ```typescript
              modelOverride: chosenModel,
  ```
  Replace with:
  ```typescript
              modelOverride: chosenModel.model,
              providerOverride: chosenModel.provider,
  ```
  Note: `providerOverride` is already defined in `RunPromptParams` at line 115 of provider-types.ts — this is not a new field.

  Also note: `resolve-ai-route/index.ts` currently only destructures `modelOverride` from the request body (line 24). Add `providerOverride` to the destructuring:

  **Old code (line 24 in resolve-ai-route/index.ts):**
  ```typescript
      const { taskType, workspaceId, messages, systemPrompt, options, modelOverride } =
        await req.json();
  ```

  **New code:**
  ```typescript
      const { taskType, workspaceId, messages, systemPrompt, options, modelOverride, providerOverride } =
        await req.json();
  ```

  And pass it to `runPrompt` (currently at line 46 area). The existing `runPrompt` call already has `modelOverride` in it. Add `providerOverride`:

  **Old code (lines 37–50 in resolve-ai-route/index.ts):**
  ```typescript
      const { result, meta } = await runPrompt(supabase, {
        workspaceId,
        capability: mapTaskTypeToCapability(taskType),
        taskType,
        systemPrompt: resolvedPrompt,
        messages,
        temperature: options?.temperature,
        maxTokens: options?.max_tokens,
        jsonMode: !!options?.response_format,
        modelOverride,
        tools: options?.tools,
        toolChoice: options?.tool_choice,
        promptVersionId: promptVersionId ?? undefined,
      });
  ```

  **New code:**
  ```typescript
      const { result, meta } = await runPrompt(supabase, {
        workspaceId,
        capability: mapTaskTypeToCapability(taskType),
        taskType,
        systemPrompt: resolvedPrompt,
        messages,
        temperature: options?.temperature,
        maxTokens: options?.max_tokens,
        jsonMode: !!options?.response_format,
        modelOverride,
        providerOverride,
        tools: options?.tools,
        toolChoice: options?.tool_choice,
        promptVersionId: promptVersionId ?? undefined,
      });
  ```

- [ ] **4.3** Wire `formatProductOutput` after `enforceFieldLimits` in `optimize-product/index.ts`. First, add the import at the top of the file. Find the existing import for `enforceFieldLimits`:

  **Find (existing import near top of file):**
  ```typescript
  import { enforceFieldLimits } from "../_shared/ai/output-guardrails.ts";
  ```

  **Replace with:**
  ```typescript
  import { enforceFieldLimits } from "../_shared/ai/output-guardrails.ts";
  import { formatProductOutput } from "../_shared/ai/output-formatter.ts";
  ```

- [ ] **4.4** Update the `enforceFieldLimits` call at line 1250. Currently:

  ```typescript
          const rawOptimized = JSON.parse(toolCall.function.arguments);
          const optimized = enforceFieldLimits(rawOptimized);
  ```

  Replace with:

  ```typescript
          const rawOptimized = JSON.parse(toolCall.function.arguments);
          const guardrailed = enforceFieldLimits(rawOptimized);
          const { fields: finalOptimized, issues: outputIssues } = formatProductOutput(guardrailed);
          if (outputIssues.length > 0) {
            console.warn("[optimize-product] output quality issues:", outputIssues);
          }
          const optimized = finalOptimized;
  ```

  Verify: All downstream references to `optimized` remain valid (lines 1252 onward use `optimized.upsell_skus`, `optimized.optimized_title`, etc.) — the variable name is unchanged.

- [ ] **4.5** Validate scope: Confirm that the hardcoded `"google/gemini-2.5-flash-lite"` at lines 712 and 1512 are NOT changed (those are subtask calls outside this scope).

- [ ] **4.6** Commit:
  ```bash
  git add supabase/functions/optimize-product/index.ts supabase/functions/resolve-ai-route/index.ts
  git commit -m "fix(optimize-product): migrate MODEL_MAP to canonical provider-registry format, wire formatProductOutput"
  ```

---

## Task 5 — Add prompt v2 with PT-PT quality rules

**Files:** CREATE `supabase/migrations/20260321000001_seed_prompt_v2_quality_rules.sql`, MODIFY `supabase/functions/optimize-product/index.ts` (hardcoded system prompt)

### Steps

- [ ] **5.1** Create `supabase/migrations/20260321000001_seed_prompt_v2_quality_rules.sql` with the following exact content:

```sql
-- supabase/migrations/20260321000001_seed_prompt_v2_quality_rules.sql
--
-- Adds version 2 of the `product_optimization_global` prompt template,
-- appending 4 PT-PT writing quality rules to the v1 text.
--
-- NOTE: This migration does NOT affect the hardcoded fallback system prompt
-- inside supabase/functions/optimize-product/index.ts. That fallback is
-- updated separately in Task 5 of Block 1.5 (same migration batch).
--
-- Idempotent: safe to run multiple times. Will skip if v2 already exists.

DO $$
DECLARE
  t_id uuid;
  v1_text text;
  quality_rules text := E'\n\nREGRAS DE QUALIDADE DE ESCRITA:\n- Escreve sempre em português europeu (PT-PT), nunca em português do Brasil\n- Mantém um tom profissional e orientado a vendas B2B para setor HORECA e hotelaria\n- Nunca cortes frases a meio — cada campo deve terminar com pontuação completa\n- Nunca mistures a tabela técnica com o texto descritivo — a tabela vai SEMPRE separada';
BEGIN
  -- 1. Look up the global product_optimization_global template
  SELECT id INTO t_id
  FROM prompt_templates
  WHERE workspace_id IS NULL
    AND prompt_name = 'product_optimization_global'
  LIMIT 1;

  IF t_id IS NULL THEN
    RAISE NOTICE 'prompt_templates row "product_optimization_global" not found — skipping v2 seed';
    RETURN;
  END IF;

  -- 2. Skip if v2 already exists (idempotency guard)
  IF EXISTS (
    SELECT 1 FROM prompt_versions
    WHERE template_id = t_id
      AND version_number = 2
  ) THEN
    RAISE NOTICE 'prompt_versions v2 already exists for template % — skipping', t_id;
    RETURN;
  END IF;

  -- 3. Get v1 prompt text to append to
  SELECT prompt_text INTO v1_text
  FROM prompt_versions
  WHERE template_id = t_id
    AND version_number = 1
  LIMIT 1;

  IF v1_text IS NULL THEN
    RAISE NOTICE 'prompt_versions v1 not found for template % — skipping v2 seed', t_id;
    RETURN;
  END IF;

  -- 4. Deactivate v1
  UPDATE prompt_versions
  SET is_active = false
  WHERE template_id = t_id
    AND version_number = 1;

  -- 5. Insert v2 with quality rules appended
  INSERT INTO prompt_versions (template_id, version_number, prompt_text, is_active)
  VALUES (t_id, 2, v1_text || quality_rules, true);

  RAISE NOTICE 'Successfully seeded prompt_versions v2 for template %', t_id;
END;
$$;
```

- [ ] **5.2** Update the hardcoded system prompt in `supabase/functions/optimize-product/index.ts`. The current hardcoded `systemPrompt` string passed in the `product_optimization` `resolve-ai-route` call is at line 1195:

  **Current value (line 1195):**
  ```typescript
              systemPrompt: "És um especialista em e-commerce e SEO. Responde APENAS com a tool call pedida, sem texto adicional. Mantém sempre as características técnicas do produto NUMA TABELA HTML separada do texto comercial. Traduz tudo para português europeu.",
  ```

  **New value (with the 4 quality rules appended):**
  ```typescript
              systemPrompt: "És um especialista em e-commerce e SEO. Responde APENAS com a tool call pedida, sem texto adicional. Mantém sempre as características técnicas do produto NUMA TABELA HTML separada do texto comercial. Traduz tudo para português europeu.\n\nREGRAS DE QUALIDADE DE ESCRITA:\n- Escreve sempre em português europeu (PT-PT), nunca em português do Brasil\n- Mantém um tom profissional e orientado a vendas B2B para setor HORECA e hotelaria\n- Nunca cortes frases a meio — cada campo deve terminar com pontuação completa\n- Nunca mistures a tabela técnica com o texto descritivo — a tabela vai SEMPRE separada",
  ```

- [ ] **5.3** Validate the SQL migration:
  - The DO block is idempotent (RAISE NOTICE on re-run, no error)
  - `quality_rules` uses `E''` string syntax so `\n` is interpreted as newlines
  - The migration does not create any new tables or columns (no schema change)
  - The `is_active = false` UPDATE on v1 + `is_active = true` on v2 ensures `resolve-ai-route`'s `resolvePromptTemplate` picks up v2 via `.eq("is_active", true).order("version_number", { ascending: false })`

- [ ] **5.4** Commit:
  ```bash
  git add supabase/migrations/20260321000001_seed_prompt_v2_quality_rules.sql supabase/functions/optimize-product/index.ts
  git commit -m "feat(prompts): add PT-PT quality rules to product_optimization_global prompt v2 and hardcoded fallback"
  ```

---

## Final validation checklist

- [ ] All 5 tasks committed independently
- [ ] `npx vitest run src/test/output-guardrails.test.ts` — all tests pass (existing + new)
- [ ] `npx vitest run src/test/output-formatter.test.ts` — all tests pass
- [ ] `npx vitest run` (full suite) — no regressions
- [ ] `RunMeta` interface is backward-compatible (new fields are optional `?`)
- [ ] `resolve-ai-route` HTTP response is backward-compatible (new fields are nullable, not breaking existing consumers)
- [ ] `optimize-product` MODEL_MAP is fully replaced — no `"google/..."` strings remain in the chosenModel path
- [ ] Hardcoded subtask model strings at lines ~712 and ~1512 are unchanged
- [ ] SQL migration is idempotent — running twice produces RAISE NOTICE, not an error
- [ ] No new DB columns added anywhere
