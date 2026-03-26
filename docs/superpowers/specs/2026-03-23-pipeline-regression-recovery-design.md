# Pipeline Regression Recovery — Design Spec

**Date**: 2026-03-23
**Status**: Approved
**Scope**: Operational recovery of optimization, image, status, and publishing pipelines
**Approach**: Minimal staged fixes, not feature expansion

---

## Problem Statement

After the Lovable baseline (commit `7f2b564`), successive commits introduced regressions across the AI optimization pipeline, image processing pipeline, status management, and downstream publishing. The system produces degraded text output, false completion states, broken image processing, and publishes incomplete data.

## Recovery Anchors

| Pipeline | Last Good Commit | First Bad Commit | Date |
|----------|-----------------|-------------------|------|
| Optimization (quality) | `39f81ab` | `a1c947f` | Mar 21 |
| Optimization (status) | `7f2b564` | `837f24b` (partial — introduced gating but with bugs) | Mar 23 |
| Images | `7f2b564` | `16ad909` | Mar 14 |
| Publishing | N/A (downstream) | N/A | — |

These are high-confidence anchors. Each fix must be validated before proceeding to the next phase.

---

## Phase A: Recover Optimization Quality

**Goal**: Restore AI text output quality to Lovable-baseline equivalence or better.

**Internal ordering**: A3/A4 (diagnostics) run first — if the wrong model is running or a bad DB prompt is active, fixing limits and stripping won't address the root cause. Then A1/A2 (content fixes).

### A3. Verify model identity (diagnostic — run first)

**File**: `supabase/functions/optimize-product/index.ts`

**Problem**: `CANONICAL_MODEL_MAP` maps UI key `"gemini-3-flash"` to `{ provider: "gemini", model: "gemini-2.5-flash" }`. The Lovable baseline mapped it to `"google/gemini-3-flash-preview"` — a different model. User's model selection in the UI may not match what actually runs.

**Fix**:
- Add `"gemini-3-flash-preview"` and `"gemini-3-pro-preview"` as explicit keys in `CANONICAL_MODEL_MAP`, mapping to themselves (since they exist in `STATIC_CATALOG`)
- Ensure the model that the user selects is the model that runs
- Log clearly: `"Requested: X, Resolved: Y, Provider: Z"`

**Validation**: Check settings table for actual stored model key values. Confirm the resolved model matches user intent.

### A4. Audit prompt template override (diagnostic — run first)

**File**: `supabase/functions/resolve-ai-route/index.ts` (lines 83-134)

**Problem**: `resolvePromptTemplate` can silently replace the hardcoded system prompt with a DB-stored version. If DB prompt is weaker, output degrades invisibly.

**Fix**:
- Add logging when a DB prompt overrides the caller's prompt: `"[resolve-ai-route] Using DB prompt version {id} for task {taskType} (workspace: {wsId})"`
- No structural change — just observability for now
- If DB prompts are found to be the cause after validation, the fix is to update or deactivate the offending prompt_versions rows

**Validation**: Check `prompt_versions` table for active versions on `product_optimization` task type. Compare DB prompt text against the hardcoded system prompt.

### A1. Relax enforceFieldLimits

**File**: `supabase/functions/_shared/ai/output-guardrails.ts`

**Problem**: Hard-coded limits truncate valid content. Titles capped at 70 chars, short descriptions at 500, descriptions at 5000. These were not present in the Lovable baseline and are cutting content mid-thought.

**Fix**:
- Raise `optimized_title` limit to 100 chars (compromise: PT-PT product names are longer than EN, but 150 risks WooCommerce theme display issues in admin, storefront breadcrumbs, and cart)
- Raise `optimized_short_description` limit to 1000 chars
- Keep `optimized_description` at 5000 (reasonable ceiling)
- Keep `meta_title` at 60, `meta_description` at 160, `seo_slug` at 100 (these are SEO standards)
- Ensure trimming uses word-boundary, not mid-word cut

**Validation**: Run optimization on 3 known products that had truncation. Confirm output matches or exceeds Lovable baseline length. Verify titles render correctly in WooCommerce admin if possible.

### A2. Disable aggressive weak-phrase stripping

**File**: `supabase/functions/_shared/ai/output-formatter.ts`

**Problem**: `stripWeakPhrases()` removes legitimate Portuguese marketing phrases. It has two pattern lists: `WEAK_PHRASE_PATTERNS` (prefix patterns like "ideal para") and `GENERIC_FILLER_PATTERNS` (global replacements like "alta qualidade", "solucao ideal para" anywhere in text). Both are active and both strip valid B2B HORECA copy. The Lovable baseline had no such filter.

**Fix**:
- Make `stripWeakPhrases` a no-op: return input unchanged — this disables BOTH pattern lists
- Keep `normalizeWhitespace` active (harmless cleanup)
- Keep `formatProductOutput` wrapper intact (returns `{ fields, issues }`) so callers don't break
- `validateProductOutput` continues to report issues for observability, but stripping is disabled

**Why not remove entirely**: The formatter interface is wired into optimize-product. Keeping the shell avoids changing the caller. If phrase stripping is wanted later, it can be re-enabled with a curated, reviewed pattern list.

**Validation**: Run optimization on 2 products. Confirm descriptions retain natural phrasing. Compare against Lovable baseline output for same products if available.

---

## Phase B: Recover Truthful Status

**Goal**: Products only get `"optimized"` when output is genuinely complete. Products with issues get `"needs_review"` with actionable reasons.

### B1. Fix global regex state bug

**Files**:
- `supabase/functions/optimize-product/index.ts` (line 1332, 1375)
- `supabase/functions/_shared/ai/output-guardrails.ts` (line ~229-239 — same bug in `validateProductOutput`)

**Problem**: `PLACEHOLDER_REGEX` is defined with `/g` flag and reused across multiple `.test()` calls. JavaScript regex with `/g` flag has sticky `lastIndex` state — `.test()` alternates between true/false on consecutive calls for the same input. This bug exists in both files.

**Fix**:
- Remove `/g` flag from the regex used in `.test()` calls (optimize-product line 1375 loop, output-guardrails ~line 236)
- Keep `/g` flag on the regex used in `.replace()` calls (lines 1339, 1344, 1349) — replace needs global
- Use two separate regex instances: one for testing, one for replacing
- In optimize-product line 1378: consider removing the `break` statement so all fields with placeholders are reported, not just the first

**Validation**: Create a test string with two `{{placeholder}}` patterns. Confirm `.test()` catches both. Also test multi-field scenario: two fields each with placeholders, confirm both are detected.

### B2. Add minimum content quality checks

**File**: `supabase/functions/optimize-product/index.ts` (around line 1352)

**Problem**: Status gating only checks field presence (non-empty string). A 5-character truncated title passes. A description with all placeholders stripped passes.

**Fix**: Add minimum length thresholds to status gating:
- `optimized_title`: minimum 10 chars to pass
- `optimized_short_description`: minimum 50 chars to pass
- `optimized_description`: minimum 200 chars to pass
- If below threshold → add to `statusIssues` → product gets `"needs_review"`

These thresholds are intentionally low — they catch catastrophic failures, not stylistic issues.

**Hard dependency**: B2 MUST deploy after A1/A2. If deployed before, the truncation from `enforceFieldLimits` and stripping from `formatProductOutput` could push content below these thresholds, causing everything to become `"needs_review"`.

**Validation**: Review products currently marked `"optimized"` — check if any have very short fields that should have been flagged. SQL audit query: `SELECT id, status, LENGTH(optimized_title), LENGTH(optimized_description) FROM products WHERE status = 'optimized' AND (LENGTH(optimized_title) < 10 OR LENGTH(optimized_description) < 200)`.

### B3. Promote critical formatter issues to status blockers

**File**: `supabase/functions/optimize-product/index.ts` (around line 1382)

**Problem**: `outputIssues` from `formatProductOutput` are filtered for "critical" patterns but the filter is narrow. Currently only checks for `"required field"`, `"unclosed HTML tag"`, `"mismatched"`.

**Fix**:
- Keep the existing critical issue filter
- Additionally check: if `outputIssues.length > 3` (many issues), treat as status blocker regardless of pattern
- Log all issues (not just critical ones) to `optimization_logs` for observability

**Validation**: Review recent `optimization_logs` entries. Confirm issue counts correlate with actual output quality.

---

## Phase C: Recover Image Pipeline

**Goal**: Restore working image processing (optimize + lifestyle) without Lovable Gateway dependency. Use a dedicated Gemini image adapter, cleanly separated from the text/tool-call pipeline.

### C1. Remove dead lovableKey guard

**File**: `supabase/functions/process-product-images/index.ts` (lines 17, 129, 220)

**Problem**: `if (lovableKey)` gates all image processing. The actual API calls use `serviceKey` + resolve-ai-route. The guard is a dead remnant.

**Fix**:
- Remove `const lovableKey = Deno.env.get("LOVABLE_API_KEY")` at line 17
- Remove `if (lovableKey) {` conditionals at lines 129 and 220
- Dedent the code blocks that were inside those conditionals
- Keep the `else` fallback paths (keep original URL on skip)

**Validation**: Deploy and confirm the function no longer silently skips image processing.

### C2. Create dedicated Gemini image adapter

**New file**: `supabase/functions/_shared/ai/invoke-gemini-image.ts`

**Problem**: The shared `invokeProvider` → `invokeGemini` path was designed for text/tool-call tasks. It cannot handle:
- Multimodal input content (arrays with image_url objects)
- Image output modalities (`responseModalities: ["TEXT", "IMAGE"]`)
- Image response format (parts with `inlineData: { mimeType, data }`)

Retrofitting this into the existing adapter would compromise its stability for text tasks.

**Fix**: Create a focused, single-purpose adapter:
- Input: `{ model, prompt, imageUrl, apiKey }`
- Calls Gemini `generateContent` API directly with:
  - `contents: [{ role: "user", parts: [{ text }, { inlineData | fileData }] }]`
  - `generationConfig: { responseModalities: ["TEXT", "IMAGE"] }`
- Parses response: extracts `inlineData` parts (base64 image data)
- Returns: `{ imageBase64: string, mimeType: string } | null`
- Handles errors: logs and returns null (caller keeps original URL)
- Uses `GEMINI_API_KEY` from env directly

**Architecture rationale**: This adapter sits in `_shared/ai/` alongside the text adapters but has no coupling to them. It's a peer, not a fork. If the shared layer later adds native image support, this can be replaced.

**Model**: The model ID `gemini-3.1-flash-image-preview` was a Lovable Gateway alias. Before implementation, verify which actual Gemini model supports image generation output by:
1. Checking Google's Gemini API docs for models supporting `responseModalities: ["IMAGE"]`
2. Testing a single API call with a candidate model
3. Hardcode the verified model as a named constant (not inline string)

**This is a prerequisite research task for C2** — if the wrong model is picked, C2/C3 will fail at runtime with no fallback. The adapter should include a response format check and clear error logging if the model doesn't return image data.

### C3. Rewire process-product-images to use dedicated adapter

**File**: `supabase/functions/process-product-images/index.ts`

**Fix**:
- Import `invokeGeminiImage` from the new adapter
- Replace the resolve-ai-route fetch blocks (lifestyle at ~133-163, optimize at ~223-253) with direct calls to the adapter
- Replace response parsing (`aiData.choices?.[0]?.message?.images?.[0]?.image_url?.url`) with adapter's return format
- Keep all existing storage upload, images table insert, and family propagation logic unchanged

**Validation**:
- Test with 1 product in "optimize" mode — confirm image is processed and stored
- Test with 1 product in "lifestyle" mode — confirm lifestyle image is generated
- Check `images` table for correct entries
- Check `products.image_urls` for updated URLs

### C4. Remove dead lovableKey guard from optimize-product variations

**File**: `supabase/functions/optimize-product/index.ts` (lines 1603-1604, 1742)

**Problem**: Variable product attribute extraction is gated behind `if (LOVABLE_API_KEY)`. This silently skips AI attribute extraction for all variations.

**Fix**:
- Delete the `if (LOVABLE_API_KEY)` conditional and its `else` block (line 1742: `"LOVABLE_API_KEY not set, skipping..."`)
- Dedent the code block that was inside the conditional
- The actual AI call inside already uses resolve-ai-route — no rewiring needed, just guard removal

**Validation**: Optimize a variable product. Confirm variations receive attribute extraction.

---

## Phase D: Block Bad Publishing

**Goal**: publish-woocommerce refuses to send incomplete or degraded content to WooCommerce.

### D1. Add upstream quality gate

**File**: `supabase/functions/publish-woocommerce/index.ts`

**Problem**: Publishing blindly sends whatever is in the products table, regardless of optimization status or content quality.

**Fix**: Before processing each product in the publishing batch:
- Check `product.status` — only publish if `"optimized"` or `"published"` (re-publish of previously published products is allowed without re-optimization)
- If `"needs_review"`, `"error"`, `"processing"`, or `"pending"` → skip with clear reason in job results
- Check that key fields are non-empty: `optimized_title`, `optimized_description`
- If fields are empty → skip with reason `"incomplete optimization"`

**Note on re-publishing**: A product with status `"published"` can be re-published (e.g., for price updates). If a previously published product is re-optimized and enters `"needs_review"`, it should NOT be re-publishable until the review is resolved.

**Validation**: Attempt to publish a product with `status: "needs_review"`. Confirm it's skipped, not published.

### D2. Add image completeness check

**File**: `supabase/functions/publish-woocommerce/index.ts` (in `enrichProductImages` function, ~line 655)

**Problem**: If the `images` table has no optimized URLs (because image processing failed silently), publishing proceeds with original URLs or empty image data.

**Fix**:
- In `enrichProductImages`, if no optimized images found in `images` table, fall back to `product.image_urls` as-is (current behavior is correct here)
- Add a warning in publish results: `"images: using originals (no optimized versions found)"`
- This is informational, not blocking — images are optional for publishing

**Validation**: Publish a product with no entries in `images` table. Confirm original URLs are used and warning is logged.

---

## Execution Order

```
Phase A (optimization quality)
  A3 → A4 → validate diagnostics → A1 → A2 → validate output quality
Phase B (truthful status)  [HARD DEP: A1+A2 must be deployed first]
  B1 → B2 → B3 → validate
Phase C (image pipeline)   [C2 prerequisite: resolve Gemini image model]
  C1 → C2 → C3 → validate → C4 → validate
Phase D (publishing gate)
  D1 → D2 → validate
```

Each phase has a validation checkpoint before proceeding to the next. If a phase introduces unexpected behavior, stop and reassess before continuing.

**Rollback**: Each phase modifies a small, distinct set of files. If a phase causes issues, revert its commits via `git revert` — no phase depends on another phase's file changes (they touch different files), except B depends on A being live.

## Files Changed (Summary)

| File | Phases | Type |
|------|--------|------|
| `_shared/ai/output-guardrails.ts` | A1 | Edit |
| `_shared/ai/output-formatter.ts` | A2 | Edit |
| `optimize-product/index.ts` | A3, B1, B2, B3, C4 | Edit |
| `resolve-ai-route/index.ts` | A4 | Edit (logging only) |
| `_shared/ai/invoke-gemini-image.ts` | C2 | New file |
| `process-product-images/index.ts` | C1, C3 | Edit |
| `publish-woocommerce/index.ts` | D1, D2 | Edit |

## Out of Scope

- Shared AI layer redesign for native image support
- New features, UI changes, or schema migrations
- Lovable Gateway reintroduction
- Performance optimization
- Cost tracking for image generation (can be added later)
