# Production Hardening Block 3 — Output Guardrails + PT-PT Completion

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce field-length limits on AI-generated product content before DB write; translate the 7 remaining English prompts to PT-PT.

**Architecture:** Two independent changes: (1) a shared guardrail helper plus wiring in `optimize-product`'s post-processing step, (2) in-place string replacement of English system/user prompts in 5 edge functions. No schema changes. No new routing.

**Tech Stack:** Deno Edge Functions (TypeScript), `optimize-product`, `enrich-products`, `extract-pdf-pages`, `process-product-images`, `analyze-product-page`.

---

## Scope boundaries

### What this plan changes
- `supabase/functions/_shared/ai/output-guardrails.ts` — CREATE: `enforceFieldLimits()` function
- `supabase/functions/optimize-product/index.ts` — wire guardrails after tool-call parse
- `supabase/functions/optimize-product/index.ts` — translate `variation_attribute_extraction` system prompt (EN→PT-PT)
- `supabase/functions/enrich-products/index.ts` — translate user prompt (EN→PT-PT)
- `supabase/functions/extract-pdf-pages/index.ts` — translate chunk extraction system + user prompts (EN→PT-PT)
- `supabase/functions/process-product-images/index.ts` — translate lifestyle + standard prompts (EN→PT-PT)
- `supabase/functions/analyze-product-page/index.ts` — translate fingerprint + fields system prompts (EN→PT-PT)

### What this plan deliberately excludes
- `optimize-product` `DEFAULT_FIELD_PROMPTS` — these are already PT-PT
- `parse-catalog` prompts — already PT-PT
- `run-ai-comparison` system prompt — already PT-PT
- `extract-pdf-pages` overview prompt (line 75) — already translated in Block 1
- `enrich-products` system prompt — already translated in Block 1
- HTML structure validation of AI description output — too risky without real test data; deferred to Block 7 (after real-data testing confirms actual AI output patterns)
- FAQ HTML structure enforcement — same reason

---

## Field limits reference

Limits come from the AI tool schema descriptions already in `optimize-product` and HORECA SEO best practice:

| Field | Max length | Rule |
|---|---|---|
| `optimized_title` | 70 chars | Trim to last word boundary before limit |
| `meta_title` | 60 chars | Trim to last word boundary |
| `meta_description` | 160 chars | Trim to last sentence boundary |
| `seo_slug` | 100 chars | Trim at char, lowercase, replace space with `-` |
| `optimized_short_description` | 500 chars | Trim to last sentence |

---

## File structure

```
supabase/functions/_shared/ai/
  output-guardrails.ts                     ← CREATE: enforceFieldLimits()

supabase/functions/optimize-product/
  index.ts                                 ← MODIFY: wire guardrails + translate variation prompt

supabase/functions/enrich-products/
  index.ts                                 ← MODIFY: translate user prompt

supabase/functions/extract-pdf-pages/
  index.ts                                 ← MODIFY: translate chunk system + user prompts

supabase/functions/process-product-images/
  index.ts                                 ← MODIFY: translate lifestyle + standard prompts

supabase/functions/analyze-product-page/
  index.ts                                 ← MODIFY: translate fingerprint + fields system prompts
```

---

## Task 1: Create output guardrails helper + wire in optimize-product

**Context:** `optimize-product` receives AI tool-call output as a raw JSON object (`optimized`) and writes fields directly to the DB. There is no length enforcement — the AI can return a 120-char `optimized_title` and it will be saved as-is. The guardrail function trims fields at word/sentence boundaries without truncating mid-word.

**Files:**
- Create: `supabase/functions/_shared/ai/output-guardrails.ts`
- Modify: `supabase/functions/optimize-product/index.ts` (around line 1247, after `const optimized = JSON.parse(...)`)

- [ ] **Step 1: Create the guardrails helper**

Create `supabase/functions/_shared/ai/output-guardrails.ts`:

```typescript
// supabase/functions/_shared/ai/output-guardrails.ts
// Post-processing guardrails for AI-generated product fields.
// All functions are pure (no side effects). Never throws.

/** Trim a string to maxLen characters at the last word boundary before the limit. */
function trimToWord(value: string, maxLen: number): string {
  if (!value || value.length <= maxLen) return value;
  const cut = value.substring(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 0 ? cut.substring(0, lastSpace).trimEnd() : cut;
}

/** Trim a string to maxLen characters at the last sentence boundary (. ! ?). */
function trimToSentence(value: string, maxLen: number): string {
  if (!value || value.length <= maxLen) return value;
  const cut = value.substring(0, maxLen);
  // Find the last sentence-ending punctuation before the cut point.
  // Check both "punct+space" and "punct+newline" patterns so sentences that
  // end right at or near the boundary are not missed.
  const lastSentence = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
    cut.lastIndexOf(".\n"),
    cut.lastIndexOf("!\n"),
    cut.lastIndexOf("?\n"),
    // Also handle sentence ending exactly at the cut boundary (no trailing space)
    cut.endsWith(".") ? cut.length - 1 : -1,
    cut.endsWith("!") ? cut.length - 1 : -1,
    cut.endsWith("?") ? cut.length - 1 : -1,
  );
  if (lastSentence > maxLen * 0.5) {
    // Keep the punctuation character
    return cut.substring(0, lastSentence + 1).trimEnd();
  }
  // Fall back to word boundary if no sentence boundary found
  return trimToWord(value, maxLen);
}

/** Normalize an SEO slug: lowercase, trim, replace spaces/underscores with hyphens. */
function normalizeSlug(value: string, maxLen: number): string {
  if (!value) return value;
  return value
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .substring(0, maxLen)
    .replace(/-+$/, ""); // remove trailing hyphens
}

export interface OptimizedFields {
  optimized_title?: string;
  meta_title?: string;
  meta_description?: string;
  seo_slug?: string;
  optimized_short_description?: string;
  [key: string]: unknown;
}

/**
 * Apply field-level length guardrails to AI-generated product fields.
 * Returns a new object — does not mutate the input.
 *
 * Limits:
 *   optimized_title              → 70 chars (word boundary)
 *   meta_title                   → 60 chars (word boundary)
 *   meta_description             → 160 chars (sentence boundary)
 *   seo_slug                     → 100 chars (slug normalization)
 *   optimized_short_description  → 500 chars (sentence boundary)
 */
export function enforceFieldLimits(fields: OptimizedFields): OptimizedFields {
  const result = { ...fields };

  if (typeof result.optimized_title === "string") {
    result.optimized_title = trimToWord(result.optimized_title, 70);
  }
  if (typeof result.meta_title === "string") {
    result.meta_title = trimToWord(result.meta_title, 60);
  }
  if (typeof result.meta_description === "string") {
    result.meta_description = trimToSentence(result.meta_description, 160);
  }
  if (typeof result.seo_slug === "string") {
    result.seo_slug = normalizeSlug(result.seo_slug, 100);
  }
  if (typeof result.optimized_short_description === "string") {
    result.optimized_short_description = trimToSentence(result.optimized_short_description, 500);
  }

  return result;
}
```

- [ ] **Step 2: Write a unit test for the guardrails**

Create `src/test/output-guardrails.test.ts`:

```typescript
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
  if (lastSentence > maxLen * 0.5) {
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
      expect(result).not.toMatch(/[a-z]$/); // ends at word boundary or cuts at char if no space
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
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
cd C:/AI-DEV/projects/remix-of-pixel-perfect-replica && npx vitest run src/test/output-guardrails.test.ts
```

Expected: all guardrail tests pass.

- [ ] **Step 4: Wire enforceFieldLimits in optimize-product**

Open `supabase/functions/optimize-product/index.ts`. At the top of the file, add the import after the other Deno imports (around line 1, alongside existing imports). Since this is a Deno edge function, import using the relative path:

Add this import at the top of the file with the other shared imports:
```typescript
import { enforceFieldLimits } from "../_shared/ai/output-guardrails.ts";
```

Find the line (around line 1247) that parses the tool call:
```typescript
        const optimized = JSON.parse(toolCall.function.arguments);
```

Replace it with:
```typescript
        const rawOptimized = JSON.parse(toolCall.function.arguments);
        const optimized = enforceFieldLimits(rawOptimized);
```

This applies guardrails immediately after parsing the AI response and before any field is written to the DB.

- [ ] **Step 5: Run all tests**

```bash
cd C:/AI-DEV/projects/remix-of-pixel-perfect-replica && npm run test
```

Expected: 17+ tests pass (16 original + new guardrail tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/ai/output-guardrails.ts \
        src/test/output-guardrails.test.ts \
        supabase/functions/optimize-product/index.ts
git commit -m "feat: add output guardrails for field length enforcement; wire in optimize-product"
```

---

## Task 2: Translate remaining English prompts in optimize-product and enrich-products

**Context:** Two prompts remain in English:

1. **`optimize-product` line ~1510** — `variation_attribute_extraction` system prompt: "You extract variation attributes from product titles..."
2. **`enrich-products` line ~686** — user prompt sent to the product enrichment AI: "Analyze this scraped product page content for SKU..."

**Files:**
- Modify: `supabase/functions/optimize-product/index.ts` (~line 1510)
- Modify: `supabase/functions/enrich-products/index.ts` (~line 686)

- [ ] **Step 1: Translate variation_attribute_extraction system prompt**

Open `supabase/functions/optimize-product/index.ts`. Read the exact content around line 1510 first to confirm the exact string, then replace.

Find the systemPrompt for `variation_attribute_extraction`:

```typescript
// BEFORE (read the exact lines in the file first — line numbers are approximate):
                      systemPrompt: "You extract variation attributes from product titles. Compare the parent title with each child title to identify the differentiating attribute (e.g. Color, Size, Material, Capacity, Dimensions). Return structured data via the tool. CRITICAL: NEVER use EAN codes, barcodes, numeric references (8+ digit numbers), brand names, or SKU codes as attribute values. Only use meaningful physical attributes like size, color, capacity, material.",
```

```typescript
// AFTER:
                      systemPrompt: "Extrais atributos de variação a partir de títulos de produtos. Compara o título do produto pai com cada título filho para identificar o atributo diferenciador (ex: Cor, Tamanho, Material, Capacidade, Dimensões). Devolve dados estruturados via tool call. CRÍTICO: NUNCA uses códigos EAN, códigos de barras, referências numéricas (8+ dígitos), nomes de marca ou códigos SKU como valores de atributo. Usa apenas atributos físicos com significado como tamanho, cor, capacidade, material.",
```

- [ ] **Step 2: Translate enrich-products user prompt**

Open `supabase/functions/enrich-products/index.ts`. Find the `userPrompt` const (~line 686) that starts with `"Analyze this scraped product page content for SKU..."`. Read the exact content first, then replace with the PT-PT translation below.

The current English user prompt template (verify the exact template in the file, then replace):

```typescript
// BEFORE (approximate — verify exact text in file):
    const userPrompt = `Analyze this scraped product page content for SKU "${sku}" (${title}).

Page URL: ${url}
${instructions ? `Supplier-specific instructions: ${instructions}` : ''}

Scraped content:
${scrapedContent.substring(0, 15000)}

Extract ALL product data following the rules above. Focus on finding images, variations with real SKUs, and technical specifications.`;
```

```typescript
// AFTER:
    const userPrompt = `Analisa o conteúdo desta página de produto para o SKU "${sku}" (${title}).

URL da página: ${url}
${instructions ? `Instruções específicas do fornecedor: ${instructions}` : ''}

Conteúdo extraído:
${scrapedContent.substring(0, 15000)}

Extrai TODOS os dados do produto seguindo as regras acima. Foca em encontrar imagens, variações com SKUs reais e especificações técnicas.`;
```

**IMPORTANT:** Before making this change, read the actual lines around 686 in `enrich-products/index.ts` to confirm the exact variable name and surrounding code. Only change the string content — do NOT change the variable name or surrounding logic.

- [ ] **Step 3: Run tests**

```bash
cd C:/AI-DEV/projects/remix-of-pixel-perfect-replica && npm run test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/optimize-product/index.ts \
        supabase/functions/enrich-products/index.ts
git commit -m "fix: translate variation_attribute_extraction + enrich-products user prompt EN→PT-PT"
```

---

## Task 3: Translate English prompts in extract-pdf-pages, process-product-images, analyze-product-page

**Context:** Five more English prompts across three functions:

1. **`extract-pdf-pages` line ~381** — chunk extraction system prompt: "You are a product data extraction expert. Extract ALL produc..."
2. **`extract-pdf-pages` line ~389** — chunk extraction user prompt: "Extract ALL products from pages ${chunkStart} to ${chunkEnd}..."
3. **`process-product-images` line ~113** — lifestyle generation user prompt: "Place this product in a realistic, professional commercial env..."
4. **`process-product-images` line ~202** — standard optimization user prompt: "Take this product image and place it centered on a pure white..."
5. **`analyze-product-page` line ~40** — fingerprint mode system prompt: "You are an expert web scraping analyst. You analyze HTML page..."
6. **`analyze-product-page` line ~75** — fields mode system prompt: "You are an expert web scraping analyst. Analyze the HTML of p..."

**Files:**
- Modify: `supabase/functions/extract-pdf-pages/index.ts`
- Modify: `supabase/functions/process-product-images/index.ts`
- Modify: `supabase/functions/analyze-product-page/index.ts`

- [ ] **Step 1: Translate extract-pdf-pages chunk prompts**

Open `supabase/functions/extract-pdf-pages/index.ts`. Read the file around lines 370–420 to confirm the exact prompt text. Then:

**Chunk system prompt** (~line 381) — replace the English system content string:
```typescript
// BEFORE:
            content: "You are a product data extraction expert. Extract ALL products from this PDF catalog. Be thorough and systematic.",
```

```typescript
// AFTER:
            content: "És um especialista em extração de dados de catálogos. Extrai TODOS os produtos deste catálogo PDF. Sê rigoroso e sistemático.",
```

**Chunk user prompt** (~line 389) — replace the English user content template.

Read the exact lines around 389–406 before editing to confirm context, then replace:

```typescript
// BEFORE (exact text from file lines 389–406):
              text: `Extract ALL products from pages ${chunkStart} to ${chunkEnd} of this PDF.
Language: ${overviewData?.language || "auto-detect"}
Supplier: ${overviewData?.supplier_name || "unknown"}

For each product return:
- sku, title, description, price (number), currency, category, dimensions, weight, material, color_options (array), technical_specs (object), confidence (0-100)
- images (array of objects): For EACH product image visible on the page, provide:
  - image_description: detailed description of what the image shows (product angle, context, styling)
  - alt_text: SEO-optimized alt text (max 125 chars)
  - image_type: "product_photo"|"technical_drawing"|"lifestyle"|"packaging"|"detail_closeup"|"color_swatch"|"dimension_diagram"
  - position_on_page: "top"|"middle"|"bottom"|"left"|"right"|"center"
  - estimated_size: "small"|"medium"|"large"|"full_width"
  - contains_text: boolean (if the image has overlaid text)
  - background: "white"|"transparent"|"lifestyle"|"colored"|"studio"

JSON format:
{"pages":[{"page_number":N,"page_type":"product_listing","zones":["header","table","images"],"section_title":"...","page_images_count":N,"products":[{...}]}]}
Return ONLY valid JSON.`,
```

```typescript
// AFTER (all ${variable} interpolations preserved exactly):
              text: `Extrai TODOS os produtos das páginas ${chunkStart} a ${chunkEnd} deste PDF.
Idioma: ${overviewData?.language || "auto-detect"}
Fornecedor: ${overviewData?.supplier_name || "desconhecido"}

Para cada produto devolve:
- sku, title, description, price (number), currency, category, dimensions, weight, material, color_options (array), technical_specs (object), confidence (0-100)
- images (array de objetos): Para CADA imagem de produto visível na página, indica:
  - image_description: descrição detalhada do que a imagem mostra (ângulo do produto, contexto, estilo)
  - alt_text: texto alternativo otimizado para SEO (máx 125 caracteres)
  - image_type: "product_photo"|"technical_drawing"|"lifestyle"|"packaging"|"detail_closeup"|"color_swatch"|"dimension_diagram"
  - position_on_page: "top"|"middle"|"bottom"|"left"|"right"|"center"
  - estimated_size: "small"|"medium"|"large"|"full_width"
  - contains_text: boolean (se a imagem tem texto sobreposto)
  - background: "white"|"transparent"|"lifestyle"|"colored"|"studio"

Formato JSON:
{"pages":[{"page_number":N,"page_type":"product_listing","zones":["header","table","images"],"section_title":"...","page_images_count":N,"products":[{...}]}]}
Devolve APENAS JSON válido.`,
```

**IMPORTANT:** Only change the string content — all `${variable}` interpolations must remain exactly as in the BEFORE block.

- [ ] **Step 2: Translate process-product-images prompts**

Open `supabase/functions/process-product-images/index.ts`. Read around lines 110–215 to confirm exact prompt text.

**Lifestyle prompt** (~line 113) — the `prompt` const inside the `if (mode === "lifestyle")` block:
```typescript
// BEFORE:
              const prompt = `Place this product in a realistic, professional commercial environment. The product should be the main focus, centered and prominent. The environment should match the product category - for example, kitchen equipment in a modern professional kitchen, furniture in an elegant room. Professional lighting, high quality commercial photography style. Product: ${productName}`;
```

```typescript
// AFTER:
              const prompt = `Coloca este produto num ambiente comercial realista e profissional. O produto deve ser o foco principal, centrado e em destaque. O ambiente deve corresponder à categoria do produto — por exemplo, equipamento de cozinha numa cozinha profissional moderna, mobiliário num espaço elegante. Iluminação profissional, estilo de fotografia comercial de alta qualidade. Produto: ${productName}`;
```

**Standard optimization prompt** (~line 202) — the `padPrompt` const in the standard optimization block:
```typescript
// BEFORE:
              const padPrompt = `Take this product image and place it centered on a pure white square background. Maintain the original proportions without any cropping or distortion. Add equal white padding on all sides so the final image is perfectly square. The product should occupy about 80% of the frame. Clean, professional e-commerce style. Do not add any text, watermarks or extra elements.`;
```

```typescript
// AFTER:
              const padPrompt = `Pega nesta imagem de produto e coloca-a centrada sobre um fundo quadrado branco puro. Mantém as proporções originais sem cortar nem distorcer. Adiciona margens brancas iguais em todos os lados para que a imagem final seja perfeitamente quadrada. O produto deve ocupar cerca de 80% da área. Estilo limpo e profissional de e-commerce. Não adiciones texto, marcas de água nem elementos extra.`;
```

- [ ] **Step 3: Translate analyze-product-page system prompts**

Open `supabase/functions/analyze-product-page/index.ts`. Read around lines 35–110 to confirm exact prompt text.

**Fingerprint system prompt** (~line 40):
```typescript
// BEFORE:
          content: "You are an expert web scraping analyst. You analyze HTML page structure to identify the CSS selectors and XPath patterns that uniquely identify product data fields.",
```

```typescript
// AFTER:
          content: "És um especialista em análise de estrutura web. Analisas a estrutura HTML de páginas para identificar os seletores CSS e padrões XPath que identificam de forma única os campos de dados dos produtos.",
```

**Fields system prompt** (~line 75):
```typescript
// BEFORE:
          content: "You are an expert web scraping analyst. Analyze the HTML of product pages from this supplier and extract the requested product fields.",
```

```typescript
// AFTER:
          content: "És um especialista em análise de páginas web de fornecedores. Analisas o HTML de páginas de produtos e extraís os campos de produto solicitados.",
```

**IMPORTANT:** Read the exact lines before editing. The line numbers are approximate. Use the English text as the search anchor.

- [ ] **Step 4: Run tests**

```bash
cd C:/AI-DEV/projects/remix-of-pixel-perfect-replica && npm run test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/extract-pdf-pages/index.ts \
        supabase/functions/process-product-images/index.ts \
        supabase/functions/analyze-product-page/index.ts
git commit -m "fix: translate all remaining English system/user prompts to PT-PT (extract-pdf-pages, process-product-images, analyze-product-page)"
```

---

## Validation checklist

After all 3 tasks:

- [ ] `output-guardrails.ts` created and all unit tests pass
- [ ] `optimize-product/index.ts` imports `enforceFieldLimits` and applies it after `JSON.parse(toolCall.function.arguments)`
- [ ] No occurrence of "You extract variation attributes" in optimize-product (grep to confirm)
- [ ] No occurrence of "Analyze this scraped product page" in enrich-products (grep to confirm)
- [ ] No occurrence of "You are a product data extraction expert" in extract-pdf-pages (grep to confirm)
- [ ] No occurrence of "Place this product in a realistic" in process-product-images (grep to confirm)
- [ ] No occurrence of "Take this product image" in process-product-images (grep to confirm)
- [ ] No occurrence of "You are an expert web scraping analyst" in analyze-product-page (grep to confirm)
- [ ] All tests pass: `npm run test`

**Grep commands to confirm zero remaining English prompts in edge functions:**
```bash
grep -r "You are\|You extract\|Analyze this\|Place this product\|Take this product" supabase/functions/ --include="*.ts" | grep -v "_shared/ai/output-guardrails"
```
Expected: zero results (or only in comments).

---

## Summary report

**Files changed:** 7
- `supabase/functions/_shared/ai/output-guardrails.ts` (new)
- `src/test/output-guardrails.test.ts` (new)
- `supabase/functions/optimize-product/index.ts`
- `supabase/functions/enrich-products/index.ts`
- `supabase/functions/extract-pdf-pages/index.ts`
- `supabase/functions/process-product-images/index.ts`
- `supabase/functions/analyze-product-page/index.ts`

**Guardrails enforced:**
- `optimized_title` max 70 chars (word boundary)
- `meta_title` max 60 chars (word boundary)
- `meta_description` max 160 chars (sentence boundary)
- `seo_slug` max 100 chars (normalized)
- `optimized_short_description` max 500 chars (sentence boundary)

**Prompts translated (7 total):**
- `optimize-product` variation_attribute_extraction system prompt
- `enrich-products` user prompt
- `extract-pdf-pages` chunk system prompt
- `extract-pdf-pages` chunk user prompt
- `process-product-images` lifestyle user prompt
- `process-product-images` standard optimization user prompt
- `analyze-product-page` fingerprint system prompt
- `analyze-product-page` fields system prompt

**Remaining for later blocks:**
- Category-aware content engine with getCategoryContext (Block 4)
- Migration of extract-pdf-pages + analyze-product-page to use resolve-ai-route (Block 5)
- Real-data testing and output quality validation (Block 7)
