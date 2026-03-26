# Production Readiness Audit — Hotelequip Product Optimizer

**Date:** 2026-03-22
**Scope:** Full system audit of optimization, AI routing, prompt governance, image pipeline, job lifecycle, and comparison engine.
**Method:** Static code analysis of all relevant Edge Functions, hooks, and migrations with exact line references.

---

## 1. Executive Summary

**Verdict: NOT production-ready for unsupervised scale.**

The system produces correct optimization output for the happy path. The AI routing layer is well-architected with proper fallback chains. The output guardrails (field limits, weak phrase stripping, HTML validation) are functional and add real value.

However, the system has **systematic false-success reporting** at every level of the stack. A job can report "completed" when 100% of products failed. A product can report "optimized" when output validation found issues. An image can report "processed" when it silently fell back to the original URL. These are not regressions — they are design gaps that were always present but are now more visible because Block 1.5/1.6 added stricter validation that surfaces issues previously invisible.

**The core AI optimization pipeline works.** The problems are in status reporting, traceability, and error visibility.

---

## 2. Answers to Core Questions

### Q1: When a model is selected, is it actually used?

**YES — with caveats.**

`optimize-product/index.ts` lines 261-277: `CANONICAL_MODEL_MAP` translates UI keys to `{ provider, model }` pairs. The selected model is passed as `modelOverride` + `providerOverride` to `resolve-ai-route`. The routing layer (`provider-registry.ts`) respects `modelOverride` at the highest priority.

**Caveat:** If the selected provider's API key is missing from Deno.env, `buildChain()` (`provider-registry.ts` lines 61-85) silently skips it and falls to the next available provider. The fallback is tracked in `RunMeta.fallbackUsed` and `RunMeta.fallbackReason`, but `optimize-product` does NOT read these fields from the response — it only extracts `promptVersionId` (line 1240). The `optimization_logs` table records `model: chosenModel.model` (line 1701) — the **requested** model, not the **actually used** model. There is no `provider_id` written to `optimization_logs` despite the column existing after Block 1.6 migration.

**Evidence gap:** You cannot currently verify from `optimization_logs` whether the requested model was actually used or whether fallback occurred.

### Q2: Is fallback happening anywhere without visibility?

**YES — in multiple places.**

| Location | Fallback behavior | Visibility |
|----------|-------------------|------------|
| `prompt-runner.ts` fallback chain | Tries primary, then fallback providers | `RunMeta.fallbackUsed` set to true, but optimize-product ignores it |
| `optimize-product` knowledge reranking (line 762) | If reranking fails, uses original rank-sorted chunks | `console.warn` only |
| `optimize-product` supplier scraping (line 834) | If Firecrawl fails, skips supplier context | `console.warn` only |
| `optimize-product` hybrid search (line 662) | Falls to FTS, then to empty array | `console.warn` only |
| `process-product-images` AI failure (line 302) | Keeps original URL, no DB record | Only in API response `imageErrors` array |
| `enrich-products` AI parse failure (line 360) | Falls back to regex extraction (images only, no specs) | `aiParsed: false` in result but `success: true` |

**Root cause:** The system was designed for "graceful degradation" — every subsystem has fallbacks. But degradation is invisible to the operator because status codes don't distinguish "full success" from "degraded success."

### Q3: Are logs consistent and trustworthy?

**PARTIALLY.**

| Log table | What's logged | What's missing |
|-----------|---------------|----------------|
| `optimization_logs` | model (requested), tokens, RAG sources, supplier, fields, prompt_version_id | **provider_id** (column exists but never written), **actual model used** (only requested), **fallback status** |
| `ai_usage_logs` | provider, model, tokens, cost, fallback, decision_source, prompt_version_id | Written by `usage-logger.ts` fire-and-forget — **silent failure** if insert fails (line 30-32) |
| `activity_log` | user, action, product_id, fields, supplier | No token/cost data |

**Critical:** `optimization_logs.model` records `chosenModel.model` (the requested model), not the model that actually executed. If fallback occurred, the log is misleading.

**Critical:** `prompt_version_id` is always NULL for optimize-product because the function uses a hardcoded system prompt (line 1200) and never passes a template reference to resolve-ai-route.

### Q4: Can a job report success when output is invalid?

**YES.**

`optimize-product/index.ts` lines 1257-1259:
```typescript
if (outputIssues.length > 0) {
  console.warn("[optimize-product] output quality issues:", outputIssues);
}
```

The `formatProductOutput()` validation detects:
- Empty required fields
- Descriptions ending without punctuation (`.!?`)
- Unmatched HTML block tags
- Unclosed HTML tags

**All of these are logged as warnings but do NOT prevent the product from being saved as "optimized."** The product is updated in the database (line 1295-1315) and returned with `status: "optimized"` (line 1711) regardless of validation issues.

Additionally, `optimize-batch/index.ts` line 506 sets the job status to `"completed"` even if `totalFailed === totalProcessed`. There is no `"partial"` or `"failed"` job status — only `"completed"` or `"cancelled"`.

### Q5: Are new errors caused by real validation or regressions?

**Mostly real validation improvements, NOT regressions.**

What changed in Block 1.5:
- `enforceFieldLimits()` — truncates fields that exceed limits. Previously, a 200-char title would be saved as-is. Now it's trimmed to 70 chars at word boundary. This is **correct behavior** but may surface as "title looks different."
- `formatProductOutput()` — strips weak opening phrases ("Este produto é ideal para..."). Products that previously had these phrases now don't. This is **intentional improvement** but may look like content changed.
- `validateProductOutput()` — detects descriptions ending without punctuation. This was **always a problem** — now it's visible via console warnings.

What could cause MORE errors:
- `enforceFieldLimits` uses `trimHtmlSafe()` which finds the last `>` before the limit. If the AI generates HTML that doesn't close cleanly within the limit, the trim could produce malformed output. This is a **new edge case** from the trimming logic.
- The weak phrase stripping only fires if remainder > 20 chars. If remainder is exactly 21 chars and starts lowercase, the first char is uppercased. This is **correct behavior** but may produce unexpected capitalization.

**No regressions were found in the core AI call path.** The model selection, routing, and response parsing are unchanged.

### Q6: Are prompts applied consistently and correctly?

**The prompts work, but are NOT governed by the Prompt Governance system.**

`optimize-product/index.ts` line 1200 uses a **hardcoded system prompt** string, not a database-driven template. The seed migration (`20260320000012_seed_global_prompt_versions.sql` line 12-15) explicitly documents:

```sql
-- NOTE: product_optimization template is seeded but has NO routing rule yet.
--       Both optimize-product and run-ai-comparison use that task_type with
--       different system prompts. Routing rule added in Block 5.
```

**Consequence:** Editing templates in the Prompt Governance UI has **zero effect** on optimize-product. The templates are visible but not wired.

The v2 prompt migration (`20260321000001_seed_prompt_v2_quality_rules.sql`) added PT-PT quality rules to the `product_optimization_global` template in the database, but optimize-product's hardcoded prompt already includes equivalent rules (line 1200: "Escreve sempre em português europeu", "Nunca cortes frases a meio", etc.).

`run-ai-comparison/index.ts` line 121 also uses a hardcoded system prompt (different from optimize-product's).

### Q7: Is PT-PT output stable and production-grade?

**YES — the prompt engineering is solid.**

The system prompt (optimize-product line 1200) explicitly requires:
- "português europeu (PT-PT), nunca em português do Brasil"
- "tom profissional e orientado a vendas B2B para setor HORECA"
- "Nunca cortes frases a meio"
- "Nunca mistures a tabela técnica com o texto descritivo"

The per-field instructions (`DEFAULT_FIELD_PROMPTS`, lines 952-1054) are comprehensive and HORECA-specific. They include:
- SEO keyword integration rules
- Character limits per field
- Exclusion rules (no brand names, no EAN codes, no packaging quantities)
- Table formatting rules for technical specs

The `stripWeakPhrases()` function (output-formatter.ts lines 12-22) specifically targets PT-PT weak openings.

**Risk area:** If the AI model doesn't follow instructions perfectly (e.g., generates PT-BR), there is no post-processing to catch it. The guardrails check structure (length, punctuation, HTML) but not language variant.

### Q8: Are outputs truncated, malformed, or inconsistent?

**Possible but controlled.**

`enforceFieldLimits()` applies hard limits:
- `optimized_title`: 70 chars (word boundary)
- `meta_title`: 60 chars (word boundary)
- `meta_description`: 160 chars (sentence boundary)
- `optimized_short_description`: 500 chars (HTML-safe, sentence boundary)
- `optimized_description`: 5000 chars (HTML-safe, sentence boundary)

**Truncation edge cases:**
1. `trimHtmlSafe()` (output-guardrails.ts lines 19-46) finds the last `>` before the limit. If no `>` exists before the limit, it falls back to `trimToSentence()`. This could cut mid-paragraph if the AI generates a long text block without HTML.
2. `trimToSentence()` (lines 48-73) looks for `. `, `! `, `? ` patterns. If the text has no sentence-ending punctuation within the limit, it falls back to `trimToWord()` — which could produce a sentence fragment.
3. The validation (lines 173-188) then flags "field ends abruptly" — but this is only a warning, not a correction.

**In practice:** The AI is instructed to respect limits in the prompt. The guardrails are a safety net. Truncation should be rare but produces valid (if shortened) output when it occurs.

### Q9: Are images truly validated or falsely marked as processed?

**Images can be falsely reported as processed.**

Three failure paths in `process-product-images/index.ts`:

| Path | What happens | DB record? | API response |
|------|-------------|------------|--------------|
| AI returns null (line 302) | Original URL kept in `processedUrls` | **No images table record** | Product status: `"done"`, no error |
| Exception caught (line 310) | Original URL kept + `imageErrors` push | **No images table record** | `imageErrors` array has entry |
| URL validation fail (line 107) | Original URL kept + `imageErrors` push | **No images table record** | `imageErrors` array has entry |

**Critical:** When AI returns null (no optimized image), the product is still marked `status: "done"` with `processed: N` (the count of URLs in `processedUrls`, which includes originals). The frontend (`useProcessImages.ts`) reads `data.processed` and counts it as success.

**Result:** A product can show as "images processed" in the UI when all images actually kept their original URLs.

### Q10: Is the system safe for production at scale?

**Safe for supervised production. NOT safe for unsupervised scale.**

**What works at scale:**
- AI routing with fallback chains and retry logic
- Batch concurrency (2 products at a time) with self-reinvocation at 95s timeout
- Rate limit handling (429 → revert to "pending" for retry)
- Credit checking before processing
- Output guardrails prevent grossly malformed content

**What breaks at scale without supervision:**
- False success reporting masks real failure rates
- No automated alerting on degraded optimization (missing supplier context, failed reranking)
- `optimization_logs` doesn't record actual provider used → can't audit model costs
- Image failures invisible in database → can't query "which products have failed images"
- Job items stuck in "processing" if crash occurs between phases
- No reconciliation mechanism for stale product statuses
- `prompt_version_id` always NULL → can't trace which prompt version produced which output

---

## 3. What Is Fully Reliable

| Component | Evidence |
|-----------|----------|
| **AI model selection** | `CANONICAL_MODEL_MAP` correctly maps UI keys → provider/model pairs. No "google/" format remains after Block 1.6. |
| **Fallback chain execution** | `fallback-policy.ts` retries 2x per provider, then moves to next. Retryable errors (rate_limit, overload, network) correctly identified. |
| **Output field limits** | `enforceFieldLimits()` enforces hard limits with intelligent trimming (word/sentence/HTML-safe boundaries). |
| **Weak phrase stripping** | 9 PT-PT patterns correctly stripped with capitalization of remainder. 17 unit tests passing. |
| **Whitespace normalization** | Collapses spaces/tabs/newlines reliably. 5 unit tests passing. |
| **Error sanitization** | HTML error pages (502, 503) detected and converted to clean PT-PT messages. 5 unit tests passing. |
| **Comparison lifecycle** | `useFailComparisonRun` catches errors, marks run as "failed", wizard recovers to "sections" step. |
| **Prompt Governance query** | `.or()` filter correctly includes global + workspace templates. Global template mutations disabled. |
| **URL validation in images** | `new URL()` + protocol check correctly filters invalid/non-HTTP URLs. |

---

## 4. What Is Partially Reliable

| Component | Works | Doesn't work |
|-----------|-------|-------------|
| **Job status reporting** | Counts `processed` and `failed` correctly | Status is always "completed" even with 100% failures. No "partial" job status. |
| **Output validation** | Detects missing fields, truncated sentences, unmatched HTML tags | Issues are warnings only — product saved as "optimized" regardless |
| **Image processing** | Correctly processes images when AI returns results | Silent fallback to original URL when AI returns null; no DB record of failure |
| **Knowledge reranking** | Works when chunks > 5 and AI responds | Falls back silently to rank-sorted chunks; no flag in optimization_logs |
| **Supplier scraping** | Caches results, checks credits | Fails silently; no flag in optimization_logs; 7-day cache may be stale |
| **Usage logging** | Writes to ai_usage_logs with full metadata | Fire-and-forget: if insert fails, no retry, no alert (console.warn only) |
| **Comparison engine** | Creates runs, executes batches, stores results | Individual batch failures via `Promise.allSettled` are only console-logged |

---

## 5. What Is Broken or Risky

### BROKEN: `optimization_logs.provider_id` never written

The column was added in migration `20260322000001` but `optimize-product/index.ts` line 1691-1709 does not include `provider_id` in the insert. The column is always NULL.

**File:** `supabase/functions/optimize-product/index.ts` line 1691-1709

### BROKEN: `prompt_version_id` always NULL for optimizations

`optimize-product` uses a hardcoded system prompt (line 1200) and never passes a prompt template reference. `resolve-ai-route` resolves no prompt version because there's no `ai_routing_rule` for `product_optimization` task type. The `promptVersionId` in the response is always null.

**File:** `supabase/functions/optimize-product/index.ts` line 1200, 1240

### BROKEN: Actual model used not logged

`optimization_logs.model` records `chosenModel.model` (the requested model). If the routing layer falls back to a different provider/model, the log records the wrong model. The actual model is in `ai_usage_logs.model_name` (written by `usage-logger.ts`), but there's no join key between the two tables for a given optimization.

**File:** `supabase/functions/optimize-product/index.ts` line 1701

### RISKY: Job "completed" with 100% failures

`optimize-batch/index.ts` line 506 always sets `"completed"` unless explicitly cancelled. Frontend toast shows "Job concluído: 0 otimizado(s), 50 com erro" — appears as success.

**File:** `supabase/functions/optimize-batch/index.ts` line 506

### RISKY: Image failures invisible in database

When image AI returns null or throws, no record is written to the `images` table. Only the API response contains `imageErrors`. Once the response is consumed, the failure data is lost. You cannot query "which products have failed images" from the database.

**File:** `supabase/functions/process-product-images/index.ts` lines 302-305, 310-316

### RISKY: Product status stuck at "processing"

Non-variable products: `optimize-product` returns `status: "optimized"` (line 1711) but does NOT update `products.status` in the DB for the success path. The batch orchestrator writes to `optimization_job_items` but does NOT update `products.status`. If the function crashes after the AI call but before returning, the product stays "processing" forever.

**File:** `supabase/functions/optimize-product/index.ts` line 1711 (returns status, doesn't write to DB)

### RISKY: Prompt Governance UI disconnected from runtime

Templates are visible and editable in the UI but have zero effect on optimize-product or run-ai-comparison. Both use hardcoded system prompts. Users may believe they're controlling prompts when they're not.

**File:** `supabase/functions/optimize-product/index.ts` line 1200

---

## 6. Root Causes

### Root Cause 1: "Graceful degradation" without status differentiation

The system was designed so every subsystem degrades gracefully (scraping fails → skip; reranking fails → use original; AI returns null → keep original). This is good engineering for availability but creates invisible quality degradation. There's no distinction between "optimized with full context" and "optimized with zero context."

### Root Cause 2: Status codes are binary (success/error)

Products are either "optimized" or "error." Jobs are either "completed" or "cancelled." There's no intermediate state for "optimized with issues," "optimized without supplier context," or "partially failed." The `needs_review` status exists only for variable product attribute extraction.

### Root Cause 3: Logging records intent, not outcome

`optimization_logs` records the model that was *requested*, not the one that *executed*. It records `prompt_version_id` from the AI response, but that's always NULL because no prompt template is wired. The log looks complete but doesn't reflect reality.

### Root Cause 4: Fire-and-forget logging

`usage-logger.ts` (line 30-32) silently catches insert errors. If the `ai_usage_logs` table has a schema issue, permission error, or connectivity problem, usage data is lost forever with only a `console.warn` in the Edge Function logs.

### Root Cause 5: Image pipeline designed for "best effort"

The image processing function returns `status: "done"` at the product level even when individual images fail. The `imageErrors` array is in the API response but not persisted to the database. The `images` table only records successes.

---

## 7. Exact Files & Flows Involved

### Optimization Flow (critical path)

```
Frontend (ProductsPage)
  → useOptimizationJob.createJob()
    → supabase.functions.invoke("optimize-batch")
      → optimize-batch/index.ts (creates job, self-reinvokes)
        → supabase.functions.invoke("optimize-product")
          → optimize-product/index.ts
            → fetch("resolve-ai-route") [main optimization]
            → fetch("resolve-ai-route") [knowledge reranking, conditional]
            → fetch("resolve-ai-route") [variation attributes, conditional]
          → writes: optimization_logs, activity_log, products (update), optimization_job_items
        → writes: optimization_jobs (status update)
```

### AI Routing Flow

```
resolve-ai-route/index.ts
  → prompt_templates lookup (taskType) [currently no match for product_optimization]
  → runPrompt() (prompt-runner.ts)
    → resolveRoute() (provider-registry.ts)
      → ai_routing_rules lookup [no match]
      → workspace_ai_preferences lookup [depends on config]
      → CAPABILITY_DEFAULTS fallback
      → system default fallback (anthropic → openai → gemini)
    → executeWithFallback() (fallback-policy.ts)
      → invokeProvider() (invoke-provider.ts)
        → OpenAI / Anthropic / Gemini API call
    → logUsage() [fire-and-forget] (usage-logger.ts)
      → inserts ai_usage_logs
```

### Image Flow

```
Frontend (ImagesPage)
  → useProcessImages.processImages()
    → supabase.functions.invoke("process-product-images")
      → process-product-images/index.ts
        → URL validation (new URL + protocol check)
        → fetch("resolve-ai-route") [image optimization/lifestyle]
        → writes: images (upsert, success only), products (image_urls update)
      → returns: { total, processed, failed, results[].imageErrors }
```

---

## 8. Recommended Execution Order (Next Blocks)

### Block 2.0 — Status Truth (Critical, do first)

1. **Add `provider_id` + `actual_model` writes to optimization_logs** — read from `aiWrapper.meta.usedProvider` and `aiWrapper.meta.usedModel` (already in the response, just not captured)
2. **Add `fallback_used` boolean to optimization_logs** — from `aiWrapper.meta.fallbackUsed`
3. **Add "partial" job status to optimize-batch** — if `totalFailed > 0 && totalProcessed > totalFailed`, set `"partial"` instead of `"completed"`
4. **Add "failed" job status** — if `totalFailed === totalProcessed`, set `"failed"`
5. **Write image failures to images table** — `status: "error"` with `error_message`
6. **Add `optimization_quality` field to products** — "full" | "degraded" | "minimal" based on context availability

### Block 2.1 — Prompt Governance Wiring (Important, do second)

1. **Create ai_routing_rule for product_optimization** — link to seeded template
2. **Migrate hardcoded prompt to DB template** — optimize-product reads from resolved prompt version
3. **Create separate task_type for run-ai-comparison** — so it can have its own prompt template
4. **Wire prompt_version_id through the full chain** — from template → routing → logging

### Block 2.2 — Observability (Important, do third)

1. **Add degradation flags to optimization_logs** — `had_reranking`, `reranking_succeeded`, `had_scraping`, `scraping_succeeded`
2. **Create reconciliation cron** — detect products stuck in "processing" for > 10 minutes, mark as "error"
3. **Add usage logging retry** — at least one retry on insert failure
4. **Add Telegram alert on high failure rate** — if > 30% of batch fails

### Block 2.3 — Product status lifecycle fix

1. **Ensure optimize-product writes `products.status = "optimized"` to DB** for non-variable products (currently only returns it, doesn't write)
2. **Add `products.optimization_quality` column** — tracks context richness
3. **Add `products.last_optimization_at` timestamp**

---

## 9. Operational Manual

### How to Run Optimization Correctly

1. **Select products** in the Products page
2. **Choose model** — default is `gemini-2.5-flash` (good balance of speed/quality). Use `gemini-2.5-pro` for high-value products needing better quality. `gemini-2.5-flash-lite` is fastest but lowest quality.
3. **Select fields** — choose which fields to optimize. All fields is safest for new products.
4. **Select phases** — "Otimizar" is the main phase. "Enriquecer" adds supplier scraping (uses Firecrawl credits). "Imagens" processes images separately.
5. **Monitor the job** — watch the progress panel. If it stalls for > 2 minutes, the auto-wakeup mechanism (every 30s) should resume it.

**Important:** A job showing "Concluído" does NOT mean all products succeeded. Always check the `failed_products` count in the job result.

### How to Choose Models

| Model | Speed | Quality | Cost | Use case |
|-------|-------|---------|------|----------|
| `gemini-2.5-flash` | Fast | Good | Low | Default for bulk optimization |
| `gemini-2.5-pro` | Slow | Best | Medium | High-value products, complex descriptions |
| `gemini-2.5-flash-lite` | Fastest | Acceptable | Lowest | Quick passes, simple products |

The model dropdown in the UI maps to `CANONICAL_MODEL_MAP` keys. The actual model name sent to the API is in the `model` field of the map value.

### How to Read Logs and Costs

**optimization_logs table:**
- `model` — the model that was *requested* (⚠️ not necessarily the one that ran — see known issue)
- `prompt_tokens` / `completion_tokens` / `total_tokens` — token usage for the main optimization call only (not reranking or attribute extraction)
- `knowledge_sources` — array of RAG knowledge sources used
- `had_knowledge` / `had_supplier` / `had_catalog` — boolean flags for context availability
- `prompt_length` — character count of the full prompt sent to the AI
- `chunks_used` — number of RAG chunks included
- `prompt_version_id` — ⚠️ currently always NULL

**ai_usage_logs table:**
- `provider_id` — the provider that actually executed the call
- `model_name` — the model that actually executed
- `estimated_cost` — cost estimate based on token count and model pricing
- `fallback_used` — whether a fallback provider was used
- `decision_source` — how the provider was selected (routing_rule, workspace_preference, capability_default, system_default)

**To get true cost per product:** Query `ai_usage_logs` by `task_type = 'product_optimization'` and the timestamp range of the job. Note: there is no direct foreign key between `optimization_logs` and `ai_usage_logs`.

### How to Detect Fallback

**Currently limited.** The `ai_usage_logs.fallback_used` boolean tells you if a fallback occurred, but `optimization_logs` does not record this. To detect fallback:

1. Query `ai_usage_logs` for `fallback_used = true` in the time window of your job
2. Compare `optimization_logs.model` (requested) with `ai_usage_logs.model_name` (actual) — if they differ, fallback occurred
3. Check Edge Function logs for `console.error` messages from `fallback-policy.ts` — these indicate retries and provider switches

### How to Validate Outputs

**Manual validation checklist:**
1. Check `products.status` — should be `"optimized"` (not `"processing"` or `"error"`)
2. Check `optimized_title` length ≤ 70 chars
3. Check `meta_title` length ≤ 60 chars
4. Check `meta_description` length ≤ 160 chars
5. Check `optimized_short_description` ends with `.` `!` or `?`
6. Check `optimized_description` ends with `.` `!` or `?`
7. Check HTML in descriptions has balanced `<table>`, `<tr>`, `<td>`, `<ul>`, `<ol>`, `<li>` tags
8. Check text is PT-PT (not PT-BR) — look for "você" (BR) vs absence of it
9. Check `optimized_description` contains a separate `<table>` for technical specs (if product has specs)

**Automated validation:** The `validateProductOutput()` function runs on every optimization but only logs warnings. To see validation issues, check Edge Function logs for `[optimize-product] output quality issues:`.

### How to Detect Image Failures

**Current limitation:** Image failures are NOT persisted to the database. The `images` table only records successes.

**Workaround:**
1. After running image processing, check the API response for `imageErrors` arrays in each result
2. Compare `products.image_urls` (the array of URLs) with `images.optimized_url` — products with URLs in `image_urls` but no matching `images` record may have had silent failures
3. Check Edge Function logs for `Error processing image` messages

**After Block 2.0 fix:** Image failures will be written to the `images` table with `status: "error"` and can be queried directly.

### How to Verify Job Success vs False Success

**A job reporting "completed" is NOT proof of success.** Always check:

1. `optimization_jobs.failed_products` — if > 0, some products failed
2. `optimization_jobs.processed_products` vs `optimization_jobs.total_products` — if processed < total, some were not attempted
3. `optimization_job_items` where `job_id = <id>` and `status = 'error'` — shows which products failed and why
4. `products.status` for each product in the batch — should be `"optimized"`, not `"processing"` or `"error"`

**Red flags:**
- Job shows "completed" but `failed_products` > 0 → partial failure (not currently distinguished in status)
- Product shows `"processing"` after job completed → crash during optimization, product stuck
- Product shows `"optimized"` but `optimization_logs` has no entry → optimization may have been reported as success without running
- `optimization_job_items.status = 'done'` but `products.status = 'processing'` → status update failed after optimization

### Summary: What Operators Must Monitor

| Check | Query/Action | Frequency |
|-------|-------------|-----------|
| Failed products in completed jobs | `SELECT * FROM optimization_jobs WHERE status = 'completed' AND failed_products > 0` | After every batch |
| Stuck products | `SELECT * FROM products WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes'` | Every 10 min |
| Fallback usage | `SELECT * FROM ai_usage_logs WHERE fallback_used = true ORDER BY created_at DESC` | Daily |
| Missing image records | Products with `image_urls` but no corresponding `images` rows | Weekly |
| Validation warnings | Edge Function logs: `[optimize-product] output quality issues` | After every batch |

---

*End of audit. This document should be reviewed alongside the Block 2.0 execution plan when created.*
