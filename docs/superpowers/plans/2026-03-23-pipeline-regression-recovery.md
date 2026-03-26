# Pipeline Regression Recovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore optimization quality, truthful status, working image pipeline, and safe publishing to Lovable-baseline equivalence — no feature expansion.

**Architecture:** Four phased recovery stages (A→B→C→D) targeting 7 files. Each phase is independently committable and revertable. Phase B has a hard dependency on Phase A being deployed first. Phase C requires prerequisite research on Gemini image model availability.

**Tech Stack:** Deno edge functions (Supabase), TypeScript, Gemini REST API, Supabase Storage

**Spec:** `docs/superpowers/specs/2026-03-23-pipeline-regression-recovery-design.md`

**Deployment:** After each commit, Supabase edge functions must be deployed for changes to take effect. Run `supabase functions deploy <function-name>` for each modified function, or `supabase functions deploy` for all. Validation steps assume deployment has occurred.

---

## File Map

| File | Phase | Action | Responsibility |
|------|-------|--------|----------------|
| `supabase/functions/optimize-product/index.ts` | A3, B1, B2, B3, C4 | Edit | Model map, status gating, variation guard |
| `supabase/functions/_shared/ai/output-guardrails.ts` | A1, B1 | Edit | Field limits, regex bug |
| `supabase/functions/_shared/ai/output-formatter.ts` | A2 | Edit | Disable phrase stripping |
| `supabase/functions/resolve-ai-route/index.ts` | A4 | Edit | Prompt override logging |
| `supabase/functions/process-product-images/index.ts` | C1, C3 | Edit | Guard removal, adapter wiring |
| `supabase/functions/_shared/ai/invoke-gemini-image.ts` | C2 | Create | Dedicated Gemini image adapter |
| `supabase/functions/publish-woocommerce/index.ts` | D1, D2 | Edit | Quality gate, image warning |

---

## Phase A: Recover Optimization Quality

### Task 1: A3 — Expand CANONICAL_MODEL_MAP with preview model keys

**Files:**
- Modify: `supabase/functions/optimize-product/index.ts:261-282`

- [ ] **Step 1: Add preview model keys to CANONICAL_MODEL_MAP**

At line 261-269, add entries for preview models that exist in `STATIC_CATALOG` (model-catalog.ts:56-66). This ensures users who have `"gemini-3-flash-preview"` or `"gemini-3-pro-preview"` stored in their settings get exactly those models:

```typescript
    const CANONICAL_MODEL_MAP: Record<string, { provider: string; model: string }> = {
      // Gemini models — primary optimization providers
      "gemini-2.5-pro":        { provider: "gemini", model: "gemini-2.5-pro" },
      "gemini-2.5-flash":      { provider: "gemini", model: "gemini-2.5-flash" },
      "gemini-2.5-flash-lite": { provider: "gemini", model: "gemini-2.5-flash-lite" },
      // Preview models — map to themselves (exist in STATIC_CATALOG)
      "gemini-3-flash-preview":  { provider: "gemini", model: "gemini-3-flash-preview" },
      "gemini-3-pro-preview":    { provider: "gemini", model: "gemini-3-pro-preview" },
      // Legacy UI keys — remap to latest stable equivalents
      "gemini-3-flash":        { provider: "gemini", model: "gemini-2.5-flash" },
      "gemini-3-pro":          { provider: "gemini", model: "gemini-2.5-pro" },
    };
```

- [ ] **Step 2: Improve model resolution logging**

Replace the log at line 282 with more explicit tracing:

```typescript
    console.log(`[optimize-product] Model resolution: requested="${modelKey}" → resolved="${chosenModel.model}" via provider="${chosenModel.provider}" (override: ${modelOverride || "none"}, setting: ${modelSetting?.value || "default"})`);
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/optimize-product/index.ts
git commit -m "fix(optimize-product): add preview model keys to CANONICAL_MODEL_MAP, improve model tracing"
```

---

### Task 2: A4 — Add prompt template override logging

**Files:**
- Modify: `supabase/functions/resolve-ai-route/index.ts:83-134`

- [ ] **Step 1: Add logging to resolvePromptTemplate**

**Replace** lines 122-127 (the `version?.prompt_text` block and the single-line `basePrompt` return) with the expanded version that includes logging:

```typescript
      if (version?.prompt_text) {
        console.log(`[resolve-ai-route] Using DB prompt version ${version.id} for task "${taskType}" (workspace: ${workspaceId}). Caller prompt overridden.`);
        return { text: version.prompt_text, versionId: version.id as string };
      }

      const basePrompt = (rule.prompt as { base_prompt?: string } | null)?.base_prompt;
      if (basePrompt) {
        console.log(`[resolve-ai-route] Using base_prompt from template for task "${taskType}" (workspace: ${workspaceId}). No active version found.`);
        return { text: basePrompt, versionId: null };
      }
```

**Replace** line 133 (the fallback return) with:

```typescript
  console.log(`[resolve-ai-route] No DB prompt found for task "${taskType}" (workspace: ${workspaceId}). Using caller's hardcoded prompt.`);
  return { text: fallbackPrompt || "", versionId: null };
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/resolve-ai-route/index.ts
git commit -m "fix(resolve-ai-route): log when DB prompt overrides caller's hardcoded prompt"
```

---

### Task 3: A3/A4 Validation Checkpoint

- [ ] **Step 1: Check settings table for stored model keys**

Run against Supabase: `SELECT key, value FROM settings WHERE key = 'default_model';`

Confirm the stored value maps to a key in the updated `CANONICAL_MODEL_MAP`. If it maps to a legacy key like `"gemini-3-flash"`, note that it will resolve to `"gemini-2.5-flash"` — which may be intended or may need changing.

- [ ] **Step 2: Check active prompt versions for product_optimization**

Run: `SELECT pv.id, pv.prompt_text, pv.version_number, pv.is_active, pt.task_type FROM prompt_versions pv JOIN prompt_templates pt ON pv.template_id = pt.id WHERE pt.task_type = 'product_optimization' AND pv.is_active = true ORDER BY pv.version_number DESC;`

Compare the DB prompt text against the hardcoded system prompt in optimize-product line 1227. If they differ significantly, the DB prompt may be the quality degradation source. Decision: deactivate or update the DB prompt.

- [ ] **Step 3: Document findings and decide next steps**

Log whether model mapping or prompt override was the root cause (or both).

**Decision tree:**
- If the DB prompt is dramatically different from the hardcoded prompt → deactivate the DB prompt version (`UPDATE prompt_versions SET is_active = false WHERE id = '...'`). This alone may fix quality. Still proceed with A1/A2 as defensive measures.
- If the model resolves to something unexpected → fix the settings table value or `CANONICAL_MODEL_MAP`. Still proceed with A1/A2.
- If diagnostics look clean (correct model, no DB override) → the root cause is guardrails/stripping. A1/A2 are essential — proceed immediately.

---

### Task 4: A1 — Relax enforceFieldLimits

**Files:**
- Modify: `supabase/functions/_shared/ai/output-guardrails.ts:101-135`

- [ ] **Step 1: Update field limit comment and optimized_title limit**

Change lines 101-102 and 110-112:

```typescript
/**
 * Apply field-level length guardrails to AI-generated product fields.
 * Returns a new object — does not mutate the input.
 *
 * Limits:
 *   optimized_title              → 100 chars (word boundary)
 *   meta_title                   → 60 chars (word boundary)
 *   meta_description             → 160 chars (sentence boundary)
 *   seo_slug                     → 100 chars (slug normalization)
 *   optimized_short_description  → 1000 chars (sentence boundary)
 */
export function enforceFieldLimits(fields: OptimizedFields): OptimizedFields {
  const result = { ...fields };

  if (typeof result.optimized_title === "string") {
    result.optimized_title = trimToWord(result.optimized_title, 100);
  }
```

- [ ] **Step 2: Update optimized_short_description limit**

Change line 122-127:

```typescript
  if (typeof result.optimized_short_description === "string") {
    result.optimized_short_description = trimHtmlSafe(
      result.optimized_short_description,
      1000,
      trimToSentence,
    );
  }
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/ai/output-guardrails.ts
git commit -m "fix(guardrails): relax title limit to 100 chars, short_description to 1000 chars"
```

---

### Task 5: A2 — Disable weak-phrase stripping

**Files:**
- Modify: `supabase/functions/_shared/ai/output-formatter.ts:42-61`

- [ ] **Step 1: Make stripWeakPhrases a no-op**

Replace the function body at lines 42-62:

```typescript
export function stripWeakPhrases(text: string): string {
  // Disabled: phrase stripping removed valid B2B HORECA marketing copy.
  // Patterns preserved above for future opt-in re-enablement.
  // Only return early for empty/null input to maintain the contract.
  if (!text) return "";
  return text;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/ai/output-formatter.ts
git commit -m "fix(formatter): disable weak-phrase stripping — restores natural PT-PT marketing copy"
```

---

### Task 6: Phase A Validation Checkpoint

- [ ] **Step 1: Run optimization on 2-3 products**

Trigger optimization via the UI for products where you previously observed truncation or degraded output. Compare:
- Title length: should be longer than 70 chars if the AI produces longer titles
- Descriptions: should retain phrases like "ideal para", "alta qualidade"
- Model used: check logs for `[optimize-product] Model resolution:` to confirm correct model

- [ ] **Step 2: Confirm no regressions**

Verify that meta_title (60 char limit) and meta_description (160 char limit) are still properly enforced — these are SEO standards that should NOT be relaxed.

---

## Phase B: Recover Truthful Status

> **HARD DEPENDENCY**: Phase A (Tasks 4-5) must be deployed first. If guardrail limits are still aggressive, content will be truncated below B2's minimum thresholds, causing false "needs_review" states.

### Task 7: B1 — Fix global regex state bug

**Files:**
- Modify: `supabase/functions/optimize-product/index.ts:1332,1372-1379`
- Modify: `supabase/functions/_shared/ai/output-guardrails.ts:229`

- [ ] **Step 1: Fix regex in optimize-product**

At line 1332, split into two regex instances:

```typescript
        // === PLACEHOLDER RESOLUTION: resolve known template placeholders before saving ===
        const PLACEHOLDER_REPLACE = /\{\{[^}]+\}\}/g;  // global — for .replace()
        const PLACEHOLDER_TEST = /\{\{[^}]+\}\}/;       // non-global — for .test()
```

At lines 1339, 1344, 1349 — use `PLACEHOLDER_REPLACE` (already has /g, correct for .replace()):

```typescript
            optimized.optimized_description = optimized.optimized_description.replace(/\{\{faq\}\}/gi, faqHtml);
```
(These inline regexes are fine — they're created fresh each time. Only the shared `PLACEHOLDER_REGEX` variable was the problem.)

At line 1349, use `PLACEHOLDER_REPLACE`:

```typescript
          optimized.optimized_description = optimized.optimized_description.replace(PLACEHOLDER_REPLACE, "");
```

At lines 1374-1379, use `PLACEHOLDER_TEST` and remove the `break`:

```typescript
        const textFieldsToCheck = [optimized.optimized_title, optimized.optimized_short_description, optimized.optimized_description, optimized.meta_title, optimized.meta_description];
        for (const val of textFieldsToCheck) {
          if (typeof val === "string" && PLACEHOLDER_TEST.test(val)) {
            statusIssues.push("unresolved placeholder in output");
          }
        }
```

- [ ] **Step 2: Fix regex in output-guardrails**

At line 229 of `output-guardrails.ts`, change the regex to non-global:

```typescript
  // 4. No unresolved placeholders ({{...}}) in any text field
  const PLACEHOLDER_TEST = /\{\{[^}]+\}\}/;  // non-global for .test()
  const PLACEHOLDER_MATCH = /\{\{[^}]+\}\}/g; // global for .match()
```

At line 236, use `PLACEHOLDER_TEST` for the test and `PLACEHOLDER_MATCH` for the match:

```typescript
    if (typeof val === "string" && PLACEHOLDER_TEST.test(val)) {
      const matches = val.match(PLACEHOLDER_MATCH) || [];
      issues.push(`field "${field}" contains unresolved placeholder(s): ${matches.join(", ")}`);
    }
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/optimize-product/index.ts supabase/functions/_shared/ai/output-guardrails.ts
git commit -m "fix(status): split placeholder regex into test/replace variants — fixes sticky lastIndex bug"
```

---

### Task 8: B2 — Add minimum content quality checks

**Files:**
- Modify: `supabase/functions/optimize-product/index.ts:1355-1370`

- [ ] **Step 1: Add minimum length thresholds after existing presence checks**

After line 1370 (the meta_description check), add:

```typescript
        // Minimum content length — catches catastrophic truncation/empty generation
        if (fields.includes("title") && hasTitle && optimized.optimized_title.trim().length < 10) {
          statusIssues.push("optimized_title too short (< 10 chars)");
        }
        if (fields.includes("short_description") && hasShortDesc && optimized.optimized_short_description.trim().length < 50) {
          statusIssues.push("optimized_short_description too short (< 50 chars)");
        }
        if (fields.includes("description") && hasDescription && optimized.optimized_description.trim().length < 200) {
          statusIssues.push("optimized_description too short (< 200 chars)");
        }
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/optimize-product/index.ts
git commit -m "fix(status): add minimum content length thresholds to status gating"
```

---

### Task 9: B3 — Promote high-volume formatter issues to status blockers

**Files:**
- Modify: `supabase/functions/optimize-product/index.ts:1381-1385`

- [ ] **Step 1: Add volume threshold check**

Replace lines 1381-1385:

```typescript
        // Also consider output quality issues from formatter/guardrails
        const criticalIssues = outputIssues.filter((i: string) =>
          i.includes("required field") || i.includes("unclosed HTML tag") || i.includes("mismatched")
        );
        statusIssues.push(...criticalIssues);
        // High volume of non-critical issues also indicates degraded output
        if (outputIssues.length > 3 && criticalIssues.length === 0) {
          statusIssues.push(`${outputIssues.length} output quality issues detected`);
        }
```

- [ ] **Step 2: Log all output issues (not just critical)**

After line 1298 (the existing warn), add persistence to optimization_logs. Find the optimization_logs insert (search for `optimization_logs` in the file) and ensure `outputIssues` is included in the logged data. If there is no insert nearby, add a comment noting this should be wired to optimization_logs in a future iteration.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/optimize-product/index.ts
git commit -m "fix(status): treat high-volume output issues as status blockers"
```

---

### Task 10: Phase B Validation Checkpoint

- [ ] **Step 1: Run SQL audit query**

```sql
SELECT id, status,
  LENGTH(optimized_title) as title_len,
  LENGTH(optimized_description) as desc_len
FROM products
WHERE status = 'optimized'
  AND (LENGTH(optimized_title) < 10 OR LENGTH(optimized_description) < 200)
LIMIT 20;
```

If this returns results, those products should have been `"needs_review"`. The fix is working correctly going forward — existing products may need a re-optimization pass.

- [ ] **Step 2: Test regex fix with a manual placeholder scenario**

If possible, trigger optimization on a product where the AI might produce `{{placeholder}}` patterns. Verify the status gating catches all fields, not just the first one.

---

## Phase C: Recover Image Pipeline

### Task 11: C2 Prerequisite — Research Gemini image generation model

- [ ] **Step 1: Identify the correct Gemini model for image generation**

Check Google Gemini API docs. As of early 2026, Gemini models supporting image generation output via `responseModalities: ["TEXT", "IMAGE"]` include:
- `gemini-2.0-flash-exp` (experimental, image generation capable)
- `imagen-3.0-generate-002` (dedicated image generation)

The Lovable Gateway alias `gemini-3.1-flash-image-preview` likely proxied to one of these. We need a model that:
1. Accepts image input (vision)
2. Produces image output (generation)
3. Is available on the `generativelanguage.googleapis.com/v1beta` endpoint

- [ ] **Step 2: Test with a single API call**

```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"role": "user", "parts": [{"text": "Generate a simple blue square image"}]}],
    "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}
  }'
```

Check if response includes `inlineData` with `mimeType: "image/..."` and base64 `data`.

- [ ] **Step 3: Document the verified model ID**

Record which model works. This model ID will be used as a named constant in the adapter.

---

### Task 12: C1 — Remove dead lovableKey guard from process-product-images

**Files:**
- Modify: `supabase/functions/process-product-images/index.ts:17,129,212-214,220,306-309`

- [ ] **Step 1: Remove lovableKey variable declaration**

Delete line 17:

```typescript
    // DELETE: const lovableKey = Deno.env.get("LOVABLE_API_KEY");
```

- [ ] **Step 2: Remove lovableKey conditional from lifestyle mode**

At line 129, remove the `if (lovableKey) {` line. At lines 212-214, remove the `} else { processedUrls.push(originalUrl); }` block. Dedent the code block that was inside the conditional.

- [ ] **Step 3: Remove lovableKey conditional from optimize mode**

At line 220, remove the `if (lovableKey) {` line. At lines 306-309, remove the `} else { processedUrls.push(originalUrl); }` block. Dedent the code block.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/process-product-images/index.ts
git commit -m "fix(images): remove dead lovableKey guard — image processing no longer silently skipped"
```

---

### Task 13: C2 — Create dedicated Gemini image adapter

**Files:**
- Create: `supabase/functions/_shared/ai/invoke-gemini-image.ts`

- [ ] **Step 1: Write the adapter**

```typescript
// supabase/functions/_shared/ai/invoke-gemini-image.ts
// Dedicated Gemini image generation adapter.
// Separate from the text/tool-call pipeline (invoke-provider.ts).
// Handles multimodal input (text + image) and image output (inlineData).

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const TIMEOUT_MS = 60_000; // 60s — image generation is slower than text

// Replace with verified model from Task 11
export const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-exp";

export interface GeminiImageRequest {
  prompt: string;
  imageUrl?: string;      // optional source image URL for edit/transform tasks
  model?: string;         // override GEMINI_IMAGE_MODEL if needed
}

export interface GeminiImageResult {
  imageBase64: string;
  mimeType: string;
}

/**
 * Generate or transform an image using Gemini's native image generation.
 * Returns null on any failure (caller should keep original URL).
 * Never throws — all errors are logged and result in null.
 */
export async function invokeGeminiImage(
  request: GeminiImageRequest,
): Promise<GeminiImageResult | null> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.error("[invoke-gemini-image] GEMINI_API_KEY not set");
    return null;
  }

  const model = request.model || GEMINI_IMAGE_MODEL;
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  // Build multimodal content parts
  const parts: Array<Record<string, unknown>> = [
    { text: request.prompt },
  ];

  // If source image URL provided, download and inline as base64.
  // Gemini's fileData.fileUri only accepts gs:// URIs, not HTTP URLs.
  if (request.imageUrl) {
    try {
      const imgResp = await fetch(request.imageUrl);
      if (imgResp.ok) {
        const imgBytes = new Uint8Array(await imgResp.arrayBuffer());
        // Infer mime type from Content-Type header, fall back to jpeg
        const contentType = imgResp.headers.get("content-type") || "image/jpeg";
        const mimeType = contentType.split(";")[0].trim();
        // Convert to base64
        const base64 = btoa(String.fromCharCode(...imgBytes));
        parts.push({
          inlineData: { mimeType, data: base64 },
        });
      } else {
        console.warn(`[invoke-gemini-image] Failed to download source image: HTTP ${imgResp.status}`);
      }
    } catch (dlErr) {
      console.warn(`[invoke-gemini-image] Failed to download source image: ${dlErr instanceof Error ? dlErr.message : dlErr}`);
    }
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[invoke-gemini-image] HTTP ${resp.status}: ${text.substring(0, 500)}`);
      return null;
    }

    const raw = await resp.json() as Record<string, unknown>;
    const candidates = raw.candidates as Array<Record<string, unknown>> | undefined;
    const firstCandidate = candidates?.[0];
    const responseParts = (firstCandidate?.content as Record<string, unknown>)?.parts as
      | Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>
      | undefined;

    if (!responseParts) {
      console.error("[invoke-gemini-image] No parts in response");
      return null;
    }

    // Find the first image part
    const imagePart = responseParts.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData) {
      console.warn("[invoke-gemini-image] Response contained no image data — model may not support image generation");
      return null;
    }

    return {
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[invoke-gemini-image] Error: ${msg}`);
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/ai/invoke-gemini-image.ts
git commit -m "feat(images): add dedicated Gemini image adapter — handles multimodal input/output"
```

---

### Task 14: C3 — Rewire process-product-images to use dedicated adapter

**Files:**
- Modify: `supabase/functions/process-product-images/index.ts`

- [ ] **Step 1: Add import**

At the top of the file (after line 1), add:

```typescript
import { invokeGeminiImage } from "../_shared/ai/invoke-gemini-image.ts";
```

- [ ] **Step 2: Replace lifestyle mode AI call**

Replace the resolve-ai-route fetch block (lines ~133-168 after C1 dedent) with:

```typescript
                const imageResult = await invokeGeminiImage({
                  prompt,
                  imageUrl: originalUrl,
                });

                const genImage = imageResult?.imageBase64;
```

Then update the `if (genImage)` block (lines ~170-177) to use the adapter's output directly:

```typescript
                if (genImage) {
                  // imageBase64 is already raw base64, no prefix to strip
                  const raw = atob(genImage);
                  const bytes = Uint8Array.from({ length: raw.length }, (_, i) => raw.charCodeAt(i));
```

- [ ] **Step 3: Replace optimize mode AI call**

Replace the resolve-ai-route fetch block for optimization (lines ~223-258 after C1 dedent) with:

```typescript
              const imageResult = await invokeGeminiImage({
                prompt: padPrompt,
                imageUrl: originalUrl,
              });

              const optimizedImage = imageResult?.imageBase64;
```

Then update the `if (optimizedImage)` block to use raw base64 directly:

```typescript
              if (optimizedImage) {
                const raw = atob(optimizedImage);
                const chunkSize = 8192;
                const chunks: number[] = [];
                for (let c = 0; c < raw.length; c += chunkSize) {
                  const slice = raw.slice(c, c + chunkSize);
                  for (let j = 0; j < slice.length; j++) {
                    chunks.push(slice.charCodeAt(j));
                  }
                }
                const bytes = new Uint8Array(chunks);
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/process-product-images/index.ts
git commit -m "fix(images): rewire to dedicated Gemini image adapter — fixes multimodal input/output"
```

---

### Task 15: Phase C Image Validation Checkpoint

- [ ] **Step 1: Test optimize mode**

Trigger image processing for 1 product with `mode: "optimize"`. Check:
- Supabase Storage: new file at `{workspaceId}/{productId}/optimized_0.webp`
- `images` table: row with `status: "done"`, `optimized_url` populated
- `products.image_urls`: updated with new optimized URL

- [ ] **Step 2: Test lifestyle mode**

Trigger for 1 product with `mode: "lifestyle"`. Check:
- Storage: `lifestyle_*.webp` file exists
- `images` table: lifestyle row inserted
- Family propagation: if product is a variation, check parent/sibling `image_urls`

- [ ] **Step 3: If image generation fails**

Check logs for `[invoke-gemini-image]` errors. Common issues:
- Wrong model ID → update `GEMINI_IMAGE_MODEL` constant
- `fileData.fileUri` not supported → switch to downloading the image and sending as `inlineData` with base64-encoded content
- API quota/billing → check Google Cloud console

---

### Task 16: C4 — Remove dead lovableKey guard from optimize-product variations

**Files:**
- Modify: `supabase/functions/optimize-product/index.ts:1603-1604,1741-1744`

- [ ] **Step 1: Remove the guard**

Delete lines 1603-1604:

```typescript
              // DELETE: const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
              // DELETE: if (LOVABLE_API_KEY) {
```

Delete lines 1741-1744 (the else block):

```typescript
              // DELETE: } else {
              // DELETE:   console.warn("LOVABLE_API_KEY not set, skipping AI attribute extraction");
              // DELETE:   await supabase.from("products").update({ status: "needs_review" }).eq("id", product.id);
              // DELETE: }
```

Dedent the code block that was inside the conditional (lines 1605-1740).

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/optimize-product/index.ts
git commit -m "fix(optimize-product): remove lovableKey guard from variation attribute extraction"
```

- [ ] **Step 3: Validate**

First confirm `GEMINI_API_KEY` is set in the Supabase edge function environment (it should be, since the main optimization pipeline already uses it via resolve-ai-route).

Optimize a variable product (with child variations). Check logs for `AI extracted: attr=...`. Confirm variations receive attributes and titles with suffixes.

---

## Phase D: Block Bad Publishing

### Task 17: D1 — Add upstream quality gate to publish-woocommerce

**Files:**
- Modify: `supabase/functions/publish-woocommerce/index.ts` (after line 193, before line 194)

- [ ] **Step 1: Add quality gate before publish lock check**

Insert after line 193 (after `const itemStartMs = Date.now();`) and before line 194 (before `// Check publish locks`).

Note: The skip pattern (push to results, insert job item, update job counters, continue) is already used by the publish-lock block at line 202. We use a helper closure to avoid duplicating ~15 lines per check. The `previousResultsCount` uses `?? 0` to guard against null `job.results` which would cause NaN arithmetic.

```typescript
        // === UPSTREAM QUALITY GATE ===
        const previousResultsCount = (job.results as any[] | null)?.length ?? 0;

        const skipProduct = async (reason: string) => {
          console.warn(`⛔ Product ${product.id} skipped: ${reason}`);
          existingResults.push({ id: product.id, status: "error", error: reason });
          await adminClient.from("publish_job_items").insert({
            job_id: jobId,
            product_id: product.id,
            status: "skipped",
            started_at: itemStartedAt,
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - itemStartMs,
            error_message: reason,
          });
          await adminClient.from("publish_jobs").update({
            processed_products: startIndex + existingResults.length - previousResultsCount + (job.processed_products || 0),
            failed_products: (job.failed_products || 0) + 1,
            results: existingResults,
          }).eq("id", jobId);
        };

        const publishableStatuses = new Set(["optimized", "published"]);
        if (!publishableStatuses.has(product.status)) {
          await skipProduct(`Status "${product.status}" is not publishable — product must be "optimized" or "published"`);
          continue;
        }

        const hasRequiredContent = product.optimized_title?.trim() && product.optimized_description?.trim();
        if (!hasRequiredContent) {
          await skipProduct("Incomplete optimization — optimized_title or optimized_description is empty");
          continue;
        }
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/publish-woocommerce/index.ts
git commit -m "fix(publish): add quality gate — reject products with non-publishable status or empty fields"
```

---

### Task 18: D2 — Add image completeness warning

**Files:**
- Modify: `supabase/functions/publish-woocommerce/index.ts:664`

- [ ] **Step 1: Add warning when no optimized images found**

At line 664 (after the early return `if (!imageRows || imageRows.length === 0)`), add a warning:

```typescript
  if (!imageRows || imageRows.length === 0) {
    console.warn(`[enrichProductImages] Product ${product.id}: no optimized images found — using originals`);
    return product;
  }
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/publish-woocommerce/index.ts
git commit -m "fix(publish): warn when publishing with original images (no optimized versions)"
```

---

### Task 19: Phase D Validation Checkpoint

- [ ] **Step 1: Test quality gate blocks bad status**

Attempt to publish a product with `status: "needs_review"`. Expected: skipped with reason in job results.

- [ ] **Step 2: Test quality gate allows good status**

Publish a product with `status: "optimized"` and populated fields. Expected: publishes normally.

- [ ] **Step 3: Test re-publish from "published" status**

Publish a product with `status: "published"`. Expected: publishes normally (re-publish allowed).

---

## Final Summary Commit

### Task 20: Final validation and summary

- [ ] **Step 1: Run full pipeline test**

1. Optimize 2 products (1 simple, 1 variable)
2. Process images for 1 product
3. Publish 1 product to WooCommerce

Check that the full chain produces correct results end-to-end.

- [ ] **Step 2: Verify git log is clean**

```bash
git log --oneline -15
```

Expected: one clean commit per task, no merge commits, all on main.
