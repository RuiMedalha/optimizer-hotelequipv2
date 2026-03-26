# Production Hardening Block 1 — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the AI routing layer for production by fixing model catalog consistency, translating critical English prompts to PT-PT, and removing redundant hardcoded model overrides that bypass the unified routing system.

**Architecture:** Three independent changes — (1) static catalog + provider defaults in `_shared/ai/`, (2) in-function system prompt language fixes in `enrich-products` and `extract-pdf-pages`, (3) add missing `product_enrichment` task-type mapping to capability-matrix.ts and then remove the now-redundant `modelOverride` in `enrich-products`. All changes are non-breaking: they preserve existing call signatures, task types, and response shapes.

**Tech Stack:** Deno Edge Functions (TypeScript), Supabase PostgreSQL, resolve-ai-route routing layer, CAPABILITY_DEFAULTS matrix (`_shared/ai/capability-matrix.ts`).

---

## Scope boundaries

### What this plan changes
- `supabase/functions/_shared/ai/model-catalog.ts` — add 4 missing models to STATIC_CATALOG
- `supabase/functions/_shared/ai/provider-registry.ts` — fix legacy anthropic default model
- `supabase/functions/_shared/ai/capability-matrix.ts` — add `product_enrichment` task-type mapping (prerequisite for Task 3)
- `supabase/functions/optimize-product/index.ts` — remove 4 dead GPT-5 entries from MODEL_MAP
- `supabase/functions/enrich-products/index.ts` — translate English system prompt to PT-PT, remove redundant modelOverride
- `supabase/functions/extract-pdf-pages/index.ts` — translate English overview prompt to PT-PT

### What this plan deliberately excludes (remaining exceptions)
- `process-product-images`: `modelOverride: "google/gemini-3.1-flash-image-preview"` — **kept** (vision-generation model not in CAPABILITY_DEFAULTS; removing it would break image generation)
- `parse-catalog` line ~815: `modelOverride: "google/gemini-2.5-pro"` — **kept** (intentional; pro model required for complex multi-page PDF product extraction)
- `run-ai-comparison`: `modelOverride: toProviderModel(modelId)` — **kept** (user-explicit model selection; this is the feature's purpose)
- `extract-pdf-pages` and `analyze-product-page`: these bypass resolve-ai-route entirely, calling Lovable Gateway directly — **architectural change deferred to Block 2**
- DB-driven prompt governance (prompt_templates/ai_routing_rules): `prompt_templates` is workspace-scoped with RLS; global templates require a schema migration — **deferred to Block 2**
- `parse-catalog` lines 717 and 750: `modelOverride: "google/gemini-2.5-flash"` — **kept** (parse-catalog passes `workspaceId: "system"` which breaks routing rule lookup; removing the override without fixing the workspaceId would route to wrong workspace context — architectural fix in Block 2)

---

## File structure

```
supabase/functions/_shared/ai/
  model-catalog.ts          ← MODIFY: add 4 entries to STATIC_CATALOG (lines 43–49)
  provider-registry.ts      ← MODIFY: fix anthropic default (line 89)
  capability-matrix.ts      ← MODIFY: add product_enrichment mapping (line 85)

supabase/functions/optimize-product/
  index.ts                  ← MODIFY: remove gpt-5* from MODEL_MAP (lines 258–267)

supabase/functions/enrich-products/
  index.ts                  ← MODIFY: system prompt EN→PT (lines 661–684), remove modelOverride (line 704)

supabase/functions/extract-pdf-pages/
  index.ts                  ← MODIFY: overview system prompt EN→PT (line 75)
```

---

## Task 1: Fix model catalog consistency

**Context:** The `STATIC_CATALOG` in `model-catalog.ts` is the offline fallback used when the `ai_model_catalog` DB table is unreachable. It currently has 7 models but is missing 4 that are actively used in production (including `gemini-3-flash-preview`, which is the default fallback in `optimize-product`). If the DB goes down, cost estimation returns $0 for these models. Additionally, `getDefaultModelForProvider("anthropic")` returns the legacy model `claude-3-5-sonnet-20241022` while the rest of the system uses `claude-sonnet-4-6`.

**Cost values note:** STATIC_CATALOG stores costs as `inputCostPer1k` (per 1,000 tokens). DB stores `input_cost_per_1m` (per 1,000,000 tokens). Conversion: `inputCostPer1k = input_cost_per_1m / 1000`. Values below are derived from the seed migration `20260320000004_seed_ai_model_pricing_v2.sql`.

**Files:**
- Modify: `supabase/functions/_shared/ai/model-catalog.ts:43–49`
- Modify: `supabase/functions/_shared/ai/provider-registry.ts:89`
- Modify: `supabase/functions/optimize-product/index.ts:263–267`

- [ ] **Step 1: Add 4 missing models to STATIC_CATALOG**

Open `supabase/functions/_shared/ai/model-catalog.ts`. After line 48 (the closing `},` of the `gemini-2.5-flash` entry), add 4 new entries before the closing `];` on line 49:

```typescript
// BEFORE (lines 43–49):
  {
    providerId: "gemini", modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash",
    contextWindow: 1000000, maxOutputTokens: 8192, supportsVision: true, supportsFunctionCalling: true,
    supportsJsonMode: true, inputCostPer1k: 0.00015, outputCostPer1k: 0.0006, status: "active",
    recommendedFor: ["multimodal_vision", "enrichment"], enabled: true,
  },
];
```

```typescript
// AFTER (replace the closing entry + `];` with):
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
```

- [ ] **Step 2: Fix anthropic default model in provider-registry**

Open `supabase/functions/_shared/ai/provider-registry.ts`. Find line 89 (inside `getDefaultModelForProvider`):

```typescript
// BEFORE:
    anthropic: "claude-3-5-sonnet-20241022",
```

```typescript
// AFTER:
    anthropic: "claude-sonnet-4-6",
```

- [ ] **Step 3: Remove dead GPT-5 entries from MODEL_MAP**

Open `supabase/functions/optimize-product/index.ts`. Find lines 263–267:

```typescript
// BEFORE (lines 258–268):
    const MODEL_MAP: Record<string, string> = {
      "gemini-3-flash": "google/gemini-3-flash-preview",
      "gemini-3-pro": "google/gemini-3-pro-preview",
      "gemini-2.5-pro": "google/gemini-2.5-pro",
      "gemini-2.5-flash": "google/gemini-2.5-flash",
      "gemini-2.5-flash-lite": "google/gemini-2.5-flash-lite",
      "gpt-5.2": "openai/gpt-5.2",
      "gpt-5": "openai/gpt-5",
      "gpt-5-mini": "openai/gpt-5-mini",
      "gpt-5-nano": "openai/gpt-5-nano",
    };
```

```typescript
// AFTER:
    const MODEL_MAP: Record<string, string> = {
      "gemini-3-flash": "google/gemini-3-flash-preview",
      "gemini-3-pro": "google/gemini-3-pro-preview",
      "gemini-2.5-pro": "google/gemini-2.5-pro",
      "gemini-2.5-flash": "google/gemini-2.5-flash",
      "gemini-2.5-flash-lite": "google/gemini-2.5-flash-lite",
    };
```

- [ ] **Step 4: Run tests to confirm no regressions**

```bash
npm run test
```

Expected: all tests pass (or same count as before — no new failures).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/model-catalog.ts \
        supabase/functions/_shared/ai/provider-registry.ts \
        supabase/functions/optimize-product/index.ts
git commit -m "fix: complete STATIC_CATALOG, fix anthropic default, remove dead GPT-5 model entries"
```

---

## Task 2: PT-PT normalization for critical prompts

**Context:** Two edge functions have their system prompts in English, violating the PT-PT requirement for the platform:

1. **`enrich-products`** line 661: `"You are a product data extraction specialist..."` — full English system prompt (17 lines). This function enriches products from supplier web pages; the AI needs to understand the rules in the same language as the product data (PT).

2. **`extract-pdf-pages`** line 75: `"You are a document analysis expert. Analyze this PDF and return a concise JSON overview."` — English system prompt for the PDF overview analysis step. Note: this function calls the Lovable Gateway directly (not resolve-ai-route), so it cannot be fixed via DB prompt governance in Block 1 — the fix is in-code.

The translated prompts preserve all existing extraction rules exactly; no logic changes, only language.

**Files:**
- Modify: `supabase/functions/enrich-products/index.ts:661–684`
- Modify: `supabase/functions/extract-pdf-pages/index.ts:75`

- [ ] **Step 1: Fix enrich-products system prompt (EN → PT-PT)**

Open `supabase/functions/enrich-products/index.ts`. Find lines 661–684 (the `systemPrompt` const):

```typescript
// BEFORE (lines 661–684):
    const systemPrompt = `You are a product data extraction specialist. You analyze scraped web pages of supplier/manufacturer product pages and extract structured data.

RULES FOR IMAGES:
- Extract ONLY images that belong to THIS specific product being viewed on the page
- Focus on: the main product photo, gallery/carousel/slider images, alternate angles, zoom views, detail shots
- These are typically found inside a product image gallery container, lightbox, or carousel — usually the first set of images on the page
- STRICTLY EXCLUDE: navigation icons, category thumbnails, footer logos, newsletter banners, social media icons, cookie popup images, "related products" images, "you may also like" images, brand logos, payment method icons, shipping icons, trust badges, SVG icons, any image smaller than 100px
- DO NOT include images from "related products", "recommended products", "products from the same series", or any section that shows OTHER products
- A typical product has 1-8 images. If you find more than 10, you are probably including non-product images — be more selective
- When in doubt, EXCLUDE the image

RULES FOR VARIATIONS:
- Only detect variations if the page clearly shows a selector (size picker, color picker, dropdown) for THIS product
- CRITICAL: Only report variations that have REAL SKUs visible on the page (in URLs, onclick attributes, data attributes, or option values)
- NEVER invent or guess SKUs — if you cannot find a real SKU code for a variation, do NOT include it in the "skus" array
- If you see variation values (e.g. sizes) but NO associated SKUs, return the values WITHOUT the skus array
- The "skus" array MUST only contain short alphanumeric codes (e.g. "80020", "UD12345"), NEVER full URLs
- If a variation link is "https://supplier.com/product-name/80020", the SKU is "80020"

RULES FOR SPECS:
- Extract technical specifications as structured key-value pairs
- Identify the product series/family name if visible

${instructions ? `USER INSTRUCTIONS FOR THIS SUPPLIER:\n${instructions}\n` : ''}`;
```

```typescript
// AFTER:
    const systemPrompt = `És um especialista em extração de dados de produtos. Analisas páginas web de fornecedores/fabricantes e extraís dados estruturados.

REGRAS PARA IMAGENS:
- Extrai APENAS imagens que pertencem a ESTE produto específico visualizado na página
- Foca em: foto principal do produto, imagens de galeria/carrossel, ângulos alternativos, vistas de detalhe, zoom
- Estas encontram-se tipicamente dentro de um contentor de galeria de imagens, lightbox ou carrossel — geralmente o primeiro conjunto de imagens na página
- EXCLUI ESTRITAMENTE: ícones de navegação, miniaturas de categoria, logótipos de rodapé, banners de newsletter, ícones de redes sociais, imagens de popup de cookies, imagens de "produtos relacionados", imagens de "também pode gostar", logótipos de marca, ícones de métodos de pagamento, ícones de envio, selos de confiança, ícones SVG, qualquer imagem com menos de 100px
- NÃO incluas imagens de "produtos relacionados", "produtos recomendados", "produtos da mesma série", ou qualquer secção que mostre OUTROS produtos
- Um produto típico tem 1-8 imagens. Se encontrares mais de 10, provavelmente estás a incluir imagens não relacionadas com o produto — sê mais seletivo
- Em caso de dúvida, EXCLUI a imagem

REGRAS PARA VARIAÇÕES:
- Deteta variações APENAS se a página mostrar claramente um seletor (seletor de tamanho, de cor, dropdown) para ESTE produto
- CRÍTICO: Reporta apenas variações que tenham SKUs REAIS visíveis na página (em URLs, atributos onclick, atributos data, ou valores de opção)
- NUNCA inventes ou adivinhes SKUs — se não encontrares um código SKU real para uma variação, NÃO a incluas no array "skus"
- Se vires valores de variação (ex: tamanhos) mas NENHUM SKU associado, devolve os valores SEM o array skus
- O array "skus" DEVE conter apenas códigos alfanuméricos curtos (ex: "80020", "UD12345"), NUNCA URLs completos
- Se o link de uma variação for "https://fornecedor.com/nome-produto/80020", o SKU é "80020"

REGRAS PARA ESPECIFICAÇÕES:
- Extrai especificações técnicas como pares chave-valor estruturados
- Identifica o nome da série/família do produto se visível

${instructions ? `INSTRUÇÕES DO UTILIZADOR PARA ESTE FORNECEDOR:\n${instructions}\n` : ''}`;
```

- [ ] **Step 2: Fix extract-pdf-pages overview system prompt (EN → PT-PT)**

Open `supabase/functions/extract-pdf-pages/index.ts`. Find line 75 (the system content in the Lovable API call):

```typescript
// BEFORE (line 74–76):
          {
            role: "system",
            content: "You are a document analysis expert. Analyze this PDF and return a concise JSON overview.",
          },
```

```typescript
// AFTER:
          {
            role: "system",
            content: "És um especialista em análise de documentos. Analisa este PDF e devolve um JSON conciso com a visão geral do documento.",
          },
```

- [ ] **Step 3: Run tests**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/enrich-products/index.ts \
        supabase/functions/extract-pdf-pages/index.ts
git commit -m "fix: translate critical English system prompts to PT-PT (enrich-products, extract-pdf-pages)"
```

---

## Task 3: Register product_enrichment task type + remove redundant modelOverride

**Context:** `enrich-products/index.ts` line 704 passes `modelOverride: "google/gemini-2.5-flash"` to `resolve-ai-route`. This bypasses workspace routing preferences. Before removing the override, we must first verify that `mapTaskTypeToCapability("product_enrichment")` maps to the `enrichment` capability (which defaults to `gemini-2.5-flash`).

**Root cause:** `capability-matrix.ts` has `enrichment` and `enrich_product` registered in `TASK_TYPE_TO_CAPABILITY` (lines 84–85), but `product_enrichment` (the task type used by `enrich-products`) is NOT registered. Without the mapping, `mapTaskTypeToCapability("product_enrichment")` falls through to the default `"content_generation"`, which maps to `claude-sonnet-4-6` on Anthropic — a completely different model, provider, and tool-calling format. This would break the function's response parsing.

**Two-step fix:**
1. Add `product_enrichment: "enrichment"` to `TASK_TYPE_TO_CAPABILITY` in `capability-matrix.ts`
2. Then remove `modelOverride: "google/gemini-2.5-flash"` from `enrich-products/index.ts`

**Why this is safe after step 1:** With `product_enrichment` registered, `mapTaskTypeToCapability("product_enrichment")` → `"enrichment"` → `CAPABILITY_DEFAULTS["enrichment"].primary` = `{ provider: "gemini", model: "gemini-2.5-flash" }`. The happy-path model is unchanged. Workspace routing rules for `product_enrichment` now work. The existing bug on line 703 (`workspaceId: Deno.env.get("SUPABASE_URL")!`) is unchanged — routing rule lookup fails (no workspace with that UUID), falling through to CAPABILITY_DEFAULTS as before.

**Files:**
- Modify: `supabase/functions/_shared/ai/capability-matrix.ts:85`
- Modify: `supabase/functions/enrich-products/index.ts:704`

- [ ] **Step 1: Add product_enrichment to TASK_TYPE_TO_CAPABILITY**

Open `supabase/functions/_shared/ai/capability-matrix.ts`. Find lines 83–85 (the Enrichment section):

```typescript
// BEFORE (lines 83–85):
  // Enrichment
  enrichment: "enrichment",
  enrich_product: "enrichment",
```

```typescript
// AFTER:
  // Enrichment
  enrichment: "enrichment",
  enrich_product: "enrichment",
  product_enrichment: "enrichment",
```

- [ ] **Step 2: Verify the mapping resolves correctly**

After the edit, open `capability-matrix.ts` and confirm:
- Line with `product_enrichment: "enrichment"` is present
- `CAPABILITY_DEFAULTS["enrichment"].provider` is `"gemini"` and `.model` is `"gemini-2.5-flash"` (lines 37–40)

No test to run for this step — visual verification suffices.

- [ ] **Step 3: Remove the modelOverride from enrich-products**

Open `supabase/functions/enrich-products/index.ts`. Find lines 701–706 (the resolve-ai-route body):

```typescript
// BEFORE:
      body: JSON.stringify({
        taskType: "product_enrichment",
        workspaceId: Deno.env.get("SUPABASE_URL")!, // workspace resolved elsewhere
        modelOverride: "google/gemini-2.5-flash",
        systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
```

```typescript
// AFTER:
      body: JSON.stringify({
        taskType: "product_enrichment",
        workspaceId: Deno.env.get("SUPABASE_URL")!, // workspace resolved elsewhere
        systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
```

- [ ] **Step 4: Run tests**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai/capability-matrix.ts \
        supabase/functions/enrich-products/index.ts
git commit -m "fix: register product_enrichment task type in capability-matrix, remove redundant modelOverride in enrich-products"
```

---

## Validation checklist

After all three tasks are committed, verify:

- [ ] `STATIC_CATALOG` has 11 entries (was 7) — verify by reading model-catalog.ts
- [ ] `getDefaultModelForProvider("anthropic")` returns `"claude-sonnet-4-6"` — verify by reading provider-registry.ts line 89
- [ ] `MODEL_MAP` in optimize-product has 5 entries (was 9, removed 4 GPT-5 dead entries)
- [ ] `TASK_TYPE_TO_CAPABILITY` in capability-matrix.ts contains `product_enrichment: "enrichment"` — verify by reading lines 83–86
- [ ] `enrich-products` system prompt starts with `"És um especialista..."` (not "You are")
- [ ] `extract-pdf-pages` overview system content starts with `"És um especialista..."` (not "You are")
- [ ] `enrich-products` resolve-ai-route call has no `modelOverride` key
- [ ] `npm run test` passes with no new failures

---

## Summary report (fill in after execution)

**Files changed:** 6
- `supabase/functions/_shared/ai/model-catalog.ts`
- `supabase/functions/_shared/ai/provider-registry.ts`
- `supabase/functions/_shared/ai/capability-matrix.ts`
- `supabase/functions/optimize-product/index.ts`
- `supabase/functions/enrich-products/index.ts`
- `supabase/functions/extract-pdf-pages/index.ts`

**Prompts migrated to PT-PT:** 2
- `enrich-products` system prompt (EN→PT, 17 lines)
- `extract-pdf-pages` overview system content (EN→PT, 1 line)

**Functions fixed:**
- `optimize-product`: 4 dead GPT-5 model entries removed from MODEL_MAP
- `enrich-products`: redundant `modelOverride` removed (after adding capability-matrix prerequisite)
- `capability-matrix`: `product_enrichment` task type registered → `enrichment` capability
- `provider-registry`: anthropic default updated to `claude-sonnet-4-6`
- `model-catalog`: 4 models added to STATIC_CATALOG (gemini-2.5-flash-lite, gemini-3-flash-preview, gemini-3-pro-preview, gemini-3.1-flash-image-preview)

**Remaining exceptions (Block 2+):**
- `process-product-images`: `modelOverride: "google/gemini-3.1-flash-image-preview"` kept — vision model not in CAPABILITY_DEFAULTS; removing would break image generation
- `parse-catalog` line ~815: `modelOverride: "google/gemini-2.5-pro"` kept — intentional; pro model required for complex multi-page PDF product extraction
- `parse-catalog` lines 717, 750: `modelOverride: "google/gemini-2.5-flash"` kept — `workspaceId: "system"` bug must be fixed first (architectural, Block 2)
- `run-ai-comparison`: `modelOverride: toProviderModel(modelId)` kept — user-explicit model selection; correct behavior
- `extract-pdf-pages`: direct Lovable Gateway call bypasses resolve-ai-route entirely — architectural refactor in Block 2
- `analyze-product-page`: direct Lovable Gateway call — same as above
- DB-driven prompt governance: `prompt_templates.workspace_id` is `NOT NULL` with workspace-scoped RLS; global system-level templates require schema migration + policy update — Block 2
