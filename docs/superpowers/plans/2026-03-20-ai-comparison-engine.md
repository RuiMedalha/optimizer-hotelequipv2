# AI Comparison Engine Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a sandboxed AI model comparison workflow that runs multiple AI models on the same products/sections, stores results non-destructively, and lets users choose the best output per section before applying.

**Architecture:** Frontend wizard (Dialog) collects product/model/section selection, then calls a new `run-ai-comparison` edge function once per (product × model) pair in batches of 3. The function stores results directly into two new tables. The results view is a large dialog showing side-by-side outputs grouped by product. Applying a result writes to the product's existing column.

**Tech Stack:** React 18 + TypeScript, shadcn/ui Dialog + ScrollArea + Table, React Query, Supabase Edge Functions (Deno), existing `resolve-ai-route` for AI routing, existing `useAiModelPricing` hook for model list.

---

## Codebase Context (read before implementing)

- **`supabase/functions/resolve-ai-route/index.ts`** — AI router. Request: `{ taskType, workspaceId, messages, systemPrompt, options, modelOverride }`. Response: `{ result: { choices[0].message.tool_calls[0].function.arguments }, meta: { usedModel, latencyMs } }`.
- **`src/hooks/useAiPricingDashboard.ts`** — exports `useAiModelPricing()` (React Query hook for all active models with metadata). Re-use this for model selection.
- **`src/components/DuplicateDetectionDialog.tsx`** — reference modal pattern using shadcn `Dialog` + `ScrollArea` + internal `useState`.
- **`src/pages/ProductsPage.tsx`** — has `selected: Set<string>` for product selection. Toolbar buttons follow pattern: `disabled={selected.size === 0}`.
- **`src/integrations/supabase/client.ts`** — Supabase client import path.
- **`supabase/config.toml`** — every new edge function MUST have a `[functions.run-ai-comparison] / verify_jwt = false` entry.
- **TypeScript types** — New tables not in generated types yet. Use `as any` on `.from()` calls and define inline interfaces, following `useAiPricingDashboard.ts` pattern.

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `supabase/migrations/20260320000005_ai_comparison.sql` | CREATE | Tables: `ai_comparison_runs`, `ai_comparison_results` |
| `supabase/config.toml` | MODIFY | Add `[functions.run-ai-comparison] verify_jwt = false` |
| `supabase/functions/run-ai-comparison/index.ts` | CREATE | Edge fn: one product × one model, all sections, stores results |
| `src/hooks/useAiComparison.ts` | CREATE | React Query hooks for create/run/results/apply |
| `src/components/ai-comparison/AiComparisonWizard.tsx` | CREATE | 5-step Dialog wizard (products → models → sections → running → results) |
| `src/components/ai-comparison/AiComparisonResults.tsx` | CREATE | Side-by-side results table component used in the wizard's final step |
| `src/pages/ProductsPage.tsx` | MODIFY | Add "Comparar IA" button + state + modal |

---

## Task 1: Database Schema

**Files:**
- Create: `supabase/migrations/20260320000005_ai_comparison.sql`
- Modify: `supabase/config.toml` (add edge function entry)

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/20260320000005_ai_comparison.sql
-- Non-destructive AI model comparison engine.
-- Stores comparison runs and per-result outputs without touching products table.

CREATE TABLE IF NOT EXISTS ai_comparison_runs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL,
  created_by    UUID        NOT NULL,
  product_ids   JSONB       NOT NULL,  -- string[]
  model_ids     JSONB       NOT NULL,  -- string[]
  sections      JSONB       NOT NULL,  -- string[]
  product_count INTEGER     NOT NULL,
  model_count   INTEGER     NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'running', -- running | completed | cancelled
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ai_comparison_results (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID        NOT NULL REFERENCES ai_comparison_runs(id) ON DELETE CASCADE,
  product_id     UUID        NOT NULL,
  model_id       TEXT        NOT NULL,  -- bare ID, e.g. "gemini-2.5-flash"
  provider_id    TEXT        NOT NULL,  -- "gemini" | "openai" | "anthropic"
  section        TEXT        NOT NULL,  -- "title" | "short_description" | "description" | "seo_title" | "meta_description"
  output_text    TEXT        NOT NULL,
  input_tokens   INTEGER     NOT NULL DEFAULT 0,
  output_tokens  INTEGER     NOT NULL DEFAULT 0,
  estimated_cost NUMERIC(12,6) NOT NULL DEFAULT 0,
  latency_ms     INTEGER     NOT NULL DEFAULT 0,
  score          NUMERIC(5,2),          -- optional manual/heuristic score
  selected       BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_comparison_results_run_product_idx
  ON ai_comparison_results (run_id, product_id);

CREATE INDEX IF NOT EXISTS ai_comparison_results_run_section_idx
  ON ai_comparison_results (run_id, product_id, section);

-- RLS
ALTER TABLE ai_comparison_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_comparison_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_comparison_runs"
  ON ai_comparison_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_comparison_runs"
  ON ai_comparison_runs FOR SELECT TO authenticated
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "authenticated_insert_comparison_runs"
  ON ai_comparison_runs FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "service_role_all_comparison_results"
  ON ai_comparison_results FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_comparison_results"
  ON ai_comparison_results FOR SELECT TO authenticated
  USING (run_id IN (
    SELECT id FROM ai_comparison_runs
    WHERE workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  ));
```

- [ ] **Step 2: Add edge function to config.toml**

Find the last `[functions.*]` block in `supabase/config.toml` and append:

```toml
[functions.run-ai-comparison]
verify_jwt = false
```

- [ ] **Step 3: Run migration in Supabase SQL editor**

Copy the SQL above into the Supabase SQL editor and run it. Verify both tables appear in Table Editor.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260320000005_ai_comparison.sql supabase/config.toml
git commit -m "feat: ai_comparison_runs and ai_comparison_results tables"
```

---

## Task 2: Edge Function — run-ai-comparison

**Files:**
- Create: `supabase/functions/run-ai-comparison/index.ts`

This function receives one `(runId, productId, modelId, sections[], workspaceId)` call, makes one LLM call (all sections in one tool call), and inserts per-section rows into `ai_comparison_results`.

- [ ] **Step 1: Create the function file**

```typescript
// supabase/functions/run-ai-comparison/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Maps bare model ID → provider-prefixed ID for resolve-ai-route
function toProviderModel(modelId: string): string {
  if (modelId.includes("/")) return modelId; // already prefixed
  if (modelId.startsWith("gemini-"))  return `google/${modelId}`;
  if (modelId.startsWith("gpt-"))     return `openai/${modelId}`;
  if (modelId.startsWith("claude-"))  return `anthropic/${modelId}`;
  return modelId;
}

// Maps bare model ID → provider_id label for storage
function providerFromModel(modelId: string): string {
  if (modelId.startsWith("gemini-") || modelId.startsWith("google/")) return "gemini";
  if (modelId.startsWith("gpt-")    || modelId.startsWith("openai/")) return "openai";
  if (modelId.startsWith("claude-") || modelId.startsWith("anthropic/")) return "anthropic";
  return "unknown";
}

const SECTION_DESCRIPTIONS: Record<string, string> = {
  title:             "Título do produto (máx 70 caracteres, SEO-friendly, em português)",
  short_description: "Descrição curta do produto (2-3 frases concisas, máx 150 caracteres, em português)",
  description:       "Descrição detalhada do produto com características e benefícios, em HTML (3-5 parágrafos, em português)",
  seo_title:         "Meta título SEO (máx 60 caracteres, inclui palavra-chave principal, em português)",
  meta_description:  "Meta descrição SEO (máx 155 caracteres, chamada à ação, em português)",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      runId,
      productId,
      modelId,
      sections,
      workspaceId,
    }: {
      runId: string;
      productId: string;
      modelId: string;
      sections: string[];
      workspaceId: string;
    } = await req.json();

    if (!runId || !productId || !modelId || !sections?.length || !workspaceId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
    const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase     = createClient(supabaseUrl, serviceKey);

    // Fetch product data
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, original_title, optimized_title, original_description, optimized_description, short_description, optimized_short_description, meta_title, meta_description, category, sku, tags")
      .eq("id", productId)
      .single();

    if (productError || !product) {
      return new Response(JSON.stringify({ error: "Product not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch pricing for cost estimation
    const { data: pricing } = await supabase
      .from("ai_model_pricing")
      .select("input_cost_per_1m, output_cost_per_1m")
      .eq("model_id", modelId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    // Build tool definition — only include requested sections
    const sectionProperties: Record<string, { type: string; description: string }> = {};
    for (const section of sections) {
      if (SECTION_DESCRIPTIONS[section]) {
        sectionProperties[section] = { type: "string", description: SECTION_DESCRIPTIONS[section] };
      }
    }

    const toolDef = {
      type: "function",
      function: {
        name: "generate_product_content",
        description: "Generate optimized content for the specified product sections",
        parameters: {
          type: "object",
          properties: sectionProperties,
          required: sections.filter((s) => !!SECTION_DESCRIPTIONS[s]),
        },
      },
    };

    const productContext = [
      `Título atual: ${product.optimized_title || product.original_title || "N/A"}`,
      `Categoria: ${product.category || "N/A"}`,
      `Tags: ${(product.tags || []).join(", ") || "N/A"}`,
      `Descrição atual: ${(product.optimized_description || product.original_description || "").slice(0, 600)}`,
    ].join("\n");

    const systemPrompt =
      "És um especialista em copywriting de produtos de e-commerce. Geras conteúdo otimizado para SEO e conversão, sempre em português de Portugal.";

    const userMessage =
      `Produto:\n${productContext}\n\nGera conteúdo otimizado apenas para as secções pedidas. Responde usando a ferramenta generate_product_content.`;

    // Call resolve-ai-route
    const t0 = Date.now();
    const routeResp = await fetch(`${supabaseUrl}/functions/v1/resolve-ai-route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        taskType: "product_optimization", // matches existing capability-matrix entry → content_generation
        workspaceId,
        messages: [{ role: "user", content: userMessage }],
        systemPrompt,
        options: { tools: [toolDef], tool_choice: { type: "function", function: { name: "generate_product_content" } } },
        modelOverride: toProviderModel(modelId),
      }),
    });
    const latencyMs = Date.now() - t0;

    if (!routeResp.ok) {
      const errText = await routeResp.text();
      throw new Error(`resolve-ai-route ${routeResp.status}: ${errText}`);
    }

    const routeData = await routeResp.json();
    const usage     = routeData.result?.usage ?? {};
    const inputTokens  = usage.prompt_tokens ?? usage.input_tokens ?? 0;
    const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;

    // Parse tool call output
    let generated: Record<string, string> = {};
    try {
      const rawArgs = routeData.result?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      generated = typeof rawArgs === "string" ? JSON.parse(rawArgs) : (rawArgs ?? {});
    } catch {
      // Fallback: try plain content
      const content = routeData.result?.choices?.[0]?.message?.content ?? "";
      try { generated = JSON.parse(content); } catch { /* ignore */ }
    }

    // Estimated cost (split evenly across sections)
    const totalCost = pricing
      ? (inputTokens / 1_000_000) * Number(pricing.input_cost_per_1m) +
        (outputTokens / 1_000_000) * Number(pricing.output_cost_per_1m)
      : 0;
    const costPerSection = sections.length > 0 ? totalCost / sections.length : 0;
    const tokensPerSection = {
      input:  Math.round(inputTokens  / (sections.length || 1)),
      output: Math.round(outputTokens / (sections.length || 1)),
    };

    const providerId = providerFromModel(modelId);

    // Insert one row per section
    const rows = sections
      .filter((s) => generated[s] !== undefined)
      .map((section) => ({
        run_id:         runId,
        product_id:     productId,
        model_id:       modelId,
        provider_id:    providerId,
        section,
        output_text:    String(generated[section] ?? ""),
        input_tokens:   tokensPerSection.input,
        output_tokens:  tokensPerSection.output,
        estimated_cost: costPerSection,
        latency_ms:     latencyMs,
        selected:       false,
      }));

    if (rows.length > 0) {
      const { error: insertError } = await supabase
        .from("ai_comparison_results")
        .insert(rows);
      if (insertError) throw insertError;
    }

    return new Response(
      JSON.stringify({ ok: true, sectionsGenerated: rows.length, latencyMs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[run-ai-comparison]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
```

- [ ] **Step 2: Deploy the function**

```bash
npx supabase functions deploy run-ai-comparison --project-ref hbjrycodpqjfreewyckl
```

Expected: `Deployed run-ai-comparison`

- [ ] **Step 3: Smoke-test manually**

After deployment, test with curl (replace tokens):
```bash
curl -X POST https://hbjrycodpqjfreewyckl.supabase.co/functions/v1/run-ai-comparison \
  -H "Content-Type: application/json" \
  -d '{
    "runId": "00000000-0000-0000-0000-000000000001",
    "productId": "<real-product-uuid>",
    "modelId": "gemini-2.5-flash",
    "sections": ["title"],
    "workspaceId": "<real-workspace-uuid>"
  }'
```

Expected: `{"ok":true,"sectionsGenerated":1,"latencyMs":...}`

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/run-ai-comparison/index.ts
git commit -m "feat: run-ai-comparison edge function — single product/model, all sections"
```

---

## Task 3: Frontend Hook — useAiComparison

**Files:**
- Create: `src/hooks/useAiComparison.ts`

All DB interactions for the comparison feature live here. The wizard and results components only call these hooks.

- [ ] **Step 1: Create the hook file**

```typescript
// src/hooks/useAiComparison.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ComparisonRun {
  id: string;
  workspace_id: string;
  created_by: string;
  product_ids: string[];
  model_ids: string[];
  sections: string[];
  product_count: number;
  model_count: number;
  status: "running" | "completed" | "cancelled";
  created_at: string;
  completed_at: string | null;
}

export interface ComparisonResult {
  id: string;
  run_id: string;
  product_id: string;
  model_id: string;
  provider_id: string;
  section: string;
  output_text: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  latency_ms: number;
  score: number | null;
  selected: boolean;
  created_at: string;
}

export type ComparisonSection =
  | "title"
  | "short_description"
  | "description"
  | "seo_title"
  | "meta_description";

export const COMPARISON_SECTIONS: { id: ComparisonSection; label: string; productField: string }[] = [
  { id: "title",             label: "Título",             productField: "optimized_title" },
  { id: "short_description", label: "Descrição curta",    productField: "optimized_short_description" },
  { id: "description",       label: "Descrição",          productField: "optimized_description" },
  { id: "seo_title",         label: "Título SEO",         productField: "meta_title" },
  { id: "meta_description",  label: "Meta descrição",     productField: "meta_description" },
];

// ── Create run ────────────────────────────────────────────────────────────────

export function useCreateComparisonRun() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      productIds,
      modelIds,
      sections,
    }: {
      productIds: string[];
      modelIds: string[];
      sections: string[];
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("ai_comparison_runs" as any)
        .insert({
          workspace_id:  activeWorkspace!.id,
          created_by:    user.id,
          product_ids:   productIds,
          model_ids:     modelIds,
          sections,
          product_count: productIds.length,
          model_count:   modelIds.length,
          status:        "running",
        })
        .select()
        .single();

      if (error) throw error;
      return data as ComparisonRun;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comparison-runs"] }),
  });
}

// ── Execute comparison (batched frontend orchestration) ────────────────────────

const BATCH_CONCURRENCY = 3;

export async function executeComparison({
  runId,
  productIds,
  modelIds,
  sections,
  workspaceId,
  onProgress,
}: {
  runId: string;
  productIds: string[];
  modelIds: string[];
  sections: string[];
  workspaceId: string;
  onProgress?: (completed: number, total: number) => void;
}) {
  // Cartesian product: one call per (product × model)
  const combinations = productIds.flatMap((pid) =>
    modelIds.map((mid) => ({ productId: pid, modelId: mid }))
  );

  let completed = 0;
  const total = combinations.length;

  for (let i = 0; i < combinations.length; i += BATCH_CONCURRENCY) {
    const batch = combinations.slice(i, i + BATCH_CONCURRENCY);
    await Promise.all(
      batch.map(async ({ productId, modelId }) => {
        try {
          await supabase.functions.invoke("run-ai-comparison", {
            body: { runId, productId, modelId, sections, workspaceId },
          });
        } catch (err) {
          console.error(`[executeComparison] ${modelId}/${productId}:`, err);
        }
        completed++;
        onProgress?.(completed, total);
      })
    );
  }
}

// ── Mark run completed ────────────────────────────────────────────────────────

export function useCompleteComparisonRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase
        .from("ai_comparison_runs" as any)
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", runId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comparison-runs"] }),
  });
}

// ── Fetch results for a run ────────────────────────────────────────────────────

export function useComparisonResults(runId: string | null) {
  return useQuery({
    queryKey: ["comparison-results", runId],
    enabled: !!runId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_comparison_results" as any)
        .select("*")
        .eq("run_id", runId!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as ComparisonResult[];
    },
  });
}

// ── Select a result (mark as winner for that product+section) ─────────────────

export function useSelectComparisonResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      runId,
      resultId,
      productId,
      section,
    }: {
      runId: string;
      resultId: string;
      productId: string;
      section: string;
    }) => {
      // Deselect all results for same run + product + section
      await supabase
        .from("ai_comparison_results" as any)
        .update({ selected: false })
        .eq("run_id", runId)
        .eq("product_id", productId)
        .eq("section", section);

      // Select this one
      const { error } = await supabase
        .from("ai_comparison_results" as any)
        .update({ selected: true })
        .eq("id", resultId);
      if (error) throw error;
    },
    onSuccess: (_data, { runId }) =>
      qc.invalidateQueries({ queryKey: ["comparison-results", runId] }),
  });
}

// ── Apply a selected result to the product ────────────────────────────────────

export function useApplyComparisonResult() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      productId,
      section,
      outputText,
    }: {
      productId: string;
      section: string;
      outputText: string;
    }) => {
      const sectionDef = COMPARISON_SECTIONS.find((s) => s.id === section);
      if (!sectionDef) throw new Error(`Unknown section: ${section}`);
      if (!activeWorkspace) throw new Error("No active workspace");

      // Always scope writes to active workspace — never mutate across workspaces
      const { error } = await supabase
        .from("products")
        .update({ [sectionDef.productField]: outputText })
        .eq("id", productId)
        .eq("workspace_id", activeWorkspace.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });
    },
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors in `src/hooks/useAiComparison.ts`. If RLS policy errors appear at runtime (not compile time), ignore for now — they will be caught in integration testing.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAiComparison.ts
git commit -m "feat: useAiComparison hook — create/run/results/select/apply"
```

---

## Task 4: AiComparisonWizard Component (Steps 1–4)

**Files:**
- Create: `src/components/ai-comparison/AiComparisonWizard.tsx`

This is the main wizard Dialog. It manages the full flow: product selection → model selection → section selection → execution with progress bar.

The results view is a separate component (`AiComparisonResults`) rendered inside this dialog on the final step.

- [ ] **Step 1: Create directory and component**

```typescript
// src/components/ai-comparison/AiComparisonWizard.tsx
import { useState, useCallback } from "react";
import { Loader2, ChevronRight, ChevronLeft, Play, Check } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAiModelPricing } from "@/hooks/useAiPricingDashboard";
import {
  COMPARISON_SECTIONS,
  ComparisonSection,
  executeComparison,
  useCreateComparisonRun,
  useCompleteComparisonRun,
} from "@/hooks/useAiComparison";
import type { Product } from "@/hooks/useProducts";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { AiComparisonResults } from "./AiComparisonResults";

// ── Types ─────────────────────────────────────────────────────────────────────

type WizardStep = "products" | "models" | "sections" | "running" | "results";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected products from ProductsPage checkboxes */
  preSelectedProducts: Product[];
  /** All products currently visible (for sample picking) */
  allProducts: Product[];
}

const SAMPLE_SIZES = [5, 10, 20] as const;

// ── Tier badge helpers ─────────────────────────────────────────────────────────

const tierColors = {
  speed:   { fast: "text-success", medium: "text-warning",  slow: "text-destructive" },
  quality: { standard: "text-muted-foreground", high: "text-blue-500", premium: "text-purple-500" },
  cost:    { cheap: "text-success",  medium: "text-warning", expensive: "text-destructive" },
} as const;

const tierLabels = {
  speed:   { fast: "⚡ Rápido", medium: "⏱ Médio", slow: "🐢 Lento" },
  quality: { standard: "★ Padrão", high: "★★ Alta",   premium: "★★★ Premium" },
  cost:    { cheap: "€",         medium: "€€",        expensive: "€€€" },
} as const;

// ── Component ─────────────────────────────────────────────────────────────────

export function AiComparisonWizard({ open, onOpenChange, preSelectedProducts, allProducts }: Props) {
  const { activeWorkspace } = useWorkspaceContext();
  const { data: allPricing = [] } = useAiModelPricing();
  const createRun   = useCreateComparisonRun();
  const completeRun = useCompleteComparisonRun();

  const [step,            setStep]            = useState<WizardStep>("products");
  const [selectedProducts, setSelectedProducts] = useState<Product[]>(preSelectedProducts);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [selectedSections, setSelectedSections] = useState<Set<ComparisonSection>>(
    new Set(["title", "description"])
  );
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [runId,    setRunId]    = useState<string | null>(null);

  // Only show canonical (non-legacy) active models
  const availableModels = allPricing.filter((p) => !p.model_id.includes("/"));

  const totalCalls = selectedProducts.length * selectedModelIds.size;

  const handleStart = useCallback(async () => {
    if (!activeWorkspace) return;
    setStep("running");
    setProgress({ completed: 0, total: totalCalls });

    try {
      const run = await createRun.mutateAsync({
        productIds: selectedProducts.map((p) => p.id),
        modelIds:   Array.from(selectedModelIds),
        sections:   Array.from(selectedSections),
      });
      setRunId(run.id);

      await executeComparison({
        runId:       run.id,
        productIds:  selectedProducts.map((p) => p.id),
        modelIds:    Array.from(selectedModelIds),
        sections:    Array.from(selectedSections),
        workspaceId: activeWorkspace.id,
        onProgress:  (completed, total) => setProgress({ completed, total }),
      });

      await completeRun.mutateAsync(run.id);
      setStep("results");
    } catch (err) {
      console.error("[AiComparisonWizard]", err);
      setStep("sections"); // back to last step on error
    }
  }, [activeWorkspace, selectedProducts, selectedModelIds, selectedSections, totalCalls, createRun, completeRun]);

  const handleClose = () => {
    // Reset on close
    setStep("products");
    setSelectedProducts(preSelectedProducts);
    setSelectedModelIds(new Set());
    setSelectedSections(new Set(["title", "description"]));
    setProgress(null);
    setRunId(null);
    onOpenChange(false);
  };

  const isResultsStep = step === "results";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className={isResultsStep ? "max-w-7xl w-full h-[90vh] flex flex-col" : "max-w-2xl"}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Comparar modelos de IA
            <Badge variant="outline" className="text-xs font-normal">
              {step === "products"  && "1/3 — Produtos"}
              {step === "models"    && "2/3 — Modelos"}
              {step === "sections"  && "3/3 — Secções"}
              {step === "running"   && "A comparar..."}
              {step === "results"   && "Resultados"}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* ── Step: Products ─────────────────────────────────────────────── */}
        {step === "products" && (
          <div className="space-y-4">
            {preSelectedProducts.length > 0 && (
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-sm font-medium mb-1">{preSelectedProducts.length} produtos selecionados na página</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={selectedProducts === preSelectedProducts ? "default" : "outline"}
                    onClick={() => setSelectedProducts(preSelectedProducts)}
                  >
                    Usar selecionados
                  </Button>
                </div>
              </div>
            )}

            <div>
              <p className="text-sm text-muted-foreground mb-2">Ou escolhe uma amostra aleatória:</p>
              <div className="flex gap-2">
                {SAMPLE_SIZES.map((n) => (
                  <Button
                    key={n}
                    size="sm"
                    variant={selectedProducts.length === n && selectedProducts !== preSelectedProducts ? "default" : "outline"}
                    disabled={allProducts.length < n}
                    onClick={() => setSelectedProducts(allProducts.slice(0, n))}
                  >
                    {n} produtos
                  </Button>
                ))}
              </div>
            </div>

            {selectedProducts.length > 0 && (
              <ScrollArea className="h-40 rounded border p-2">
                {selectedProducts.map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-1 text-sm">
                    <span className="truncate">{p.optimized_title || p.original_title || "Sem título"}</span>
                    <span className="text-xs text-muted-foreground ml-2 shrink-0">{p.sku ?? ""}</span>
                  </div>
                ))}
              </ScrollArea>
            )}
          </div>
        )}

        {/* ── Step: Models ───────────────────────────────────────────────── */}
        {step === "models" && (
          <ScrollArea className="h-80">
            <div className="space-y-2 pr-2">
              {availableModels.map((model) => {
                const meta = (model.metadata ?? {}) as Record<string, string>;
                const checked = selectedModelIds.has(model.model_id);
                return (
                  <label
                    key={model.model_id}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        setSelectedModelIds((prev) => {
                          const next = new Set(prev);
                          v ? next.add(model.model_id) : next.delete(model.model_id);
                          return next;
                        });
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{model.display_name}</span>
                        <Badge variant="outline" className="text-[10px] px-1 capitalize">{model.provider_id}</Badge>
                      </div>
                      {meta.best_for && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{meta.best_for}</p>
                      )}
                      <div className="flex gap-2 mt-1 flex-wrap">
                        {meta.speed_tier && (
                          <span className={`text-[10px] font-medium ${(tierColors.speed as any)[meta.speed_tier] ?? ""}`}>
                            {(tierLabels.speed as any)[meta.speed_tier] ?? meta.speed_tier}
                          </span>
                        )}
                        {meta.quality_tier && (
                          <span className={`text-[10px] font-medium ${(tierColors.quality as any)[meta.quality_tier] ?? ""}`}>
                            {(tierLabels.quality as any)[meta.quality_tier] ?? meta.quality_tier}
                          </span>
                        )}
                        {meta.cost_tier && (
                          <span className={`text-[10px] font-medium ${(tierColors.cost as any)[meta.cost_tier] ?? ""}`}>
                            {(tierLabels.cost as any)[meta.cost_tier] ?? meta.cost_tier} — $
                            {Number(model.input_cost_per_1m).toFixed(2)}/1M in
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </ScrollArea>
        )}

        {/* ── Step: Sections ─────────────────────────────────────────────── */}
        {step === "sections" && (
          <div className="space-y-2">
            {COMPARISON_SECTIONS.map((section) => {
              const checked = selectedSections.has(section.id);
              return (
                <label
                  key={section.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${
                    checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => {
                      setSelectedSections((prev) => {
                        const next = new Set(prev);
                        v ? next.add(section.id) : next.delete(section.id);
                        return next;
                      });
                    }}
                  />
                  <span className="text-sm font-medium">{section.label}</span>
                </label>
              );
            })}

            <div className="mt-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
              <span className="font-semibold">Estimativa:</span> {totalCalls} chamadas de IA
              ({selectedProducts.length} produtos × {selectedModelIds.size} modelos)
            </div>
          </div>
        )}

        {/* ── Step: Running ──────────────────────────────────────────────── */}
        {step === "running" && progress && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <span className="text-sm">
                A comparar... {progress.completed} / {progress.total}
              </span>
            </div>
            <Progress value={(progress.completed / progress.total) * 100} />
            <p className="text-xs text-muted-foreground">
              Processando em lotes de 3 em paralelo. Não feches esta janela.
            </p>
          </div>
        )}

        {/* ── Step: Results ──────────────────────────────────────────────── */}
        {step === "results" && runId && (
          <div className="flex-1 overflow-hidden">
            <AiComparisonResults
              runId={runId}
              products={selectedProducts}
              modelIds={Array.from(selectedModelIds)}
              sections={Array.from(selectedSections)}
            />
          </div>
        )}

        {/* ── Footer navigation ──────────────────────────────────────────── */}
        {step !== "running" && step !== "results" && (
          <DialogFooter className="gap-2">
            {step !== "products" && (
              <Button variant="outline" onClick={() => {
                const prev: Record<WizardStep, WizardStep> = {
                  products: "products",
                  models:   "products",
                  sections: "models",
                  running:  "sections",
                  results:  "sections",
                };
                setStep(prev[step]);
              }}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
              </Button>
            )}

            {step === "sections" ? (
              <Button
                disabled={
                  selectedProducts.length === 0 ||
                  selectedModelIds.size === 0 ||
                  selectedSections.size === 0
                }
                onClick={handleStart}
              >
                <Play className="w-4 h-4 mr-1" /> Iniciar comparação
              </Button>
            ) : (
              <Button
                disabled={
                  (step === "products" && selectedProducts.length === 0) ||
                  (step === "models"   && selectedModelIds.size === 0)
                }
                onClick={() => {
                  const next: Partial<Record<WizardStep, WizardStep>> = {
                    products: "models",
                    models:   "sections",
                  };
                  if (next[step]) setStep(next[step]!);
                }}
              >
                Próximo <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ai-comparison/AiComparisonWizard.tsx
git commit -m "feat: AiComparisonWizard — 5-step dialog (products/models/sections/running/results)"
```

---

## Task 5: AiComparisonResults Component (Step 5–7)

**Files:**
- Create: `src/components/ai-comparison/AiComparisonResults.tsx`

Shows results grouped by product × section × model. Each section row has side-by-side model outputs with € ⚡ badges and "Selecionar + Aplicar" actions.

- [ ] **Step 1: Create the results component**

```typescript
// src/components/ai-comparison/AiComparisonResults.tsx
import { useState } from "react";
import { Check, Zap, DollarSign, Star, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  COMPARISON_SECTIONS,
  useComparisonResults,
  useSelectComparisonResult,
  useApplyComparisonResult,
  type ComparisonResult,
} from "@/hooks/useAiComparison";
import type { Product } from "@/hooks/useProducts";

interface Props {
  runId: string;
  products: Product[];
  modelIds: string[];
  sections: string[];
}

// ── Decision-support helpers ───────────────────────────────────────────────────

function findCheapest(results: ComparisonResult[]): string | null {
  if (results.length === 0) return null;
  return results.reduce((a, b) => a.estimated_cost <= b.estimated_cost ? a : b).id;
}

function findFastest(results: ComparisonResult[]): string | null {
  if (results.length === 0) return null;
  return results.reduce((a, b) => a.latency_ms <= b.latency_ms ? a : b).id;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function AiComparisonResults({ runId, products, modelIds, sections }: Props) {
  const { data: allResults = [], isLoading } = useComparisonResults(runId);
  const selectResult = useSelectComparisonResult();
  const applyResult  = useApplyComparisonResult();
  const [applying, setApplying] = useState<string | null>(null); // resultId being applied

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (allResults.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-12">
        Sem resultados. Verifica se a comparação correu com sucesso.
      </p>
    );
  }

  // Group results: productId → sectionId → modelId → ComparisonResult
  const grouped = new Map<string, Map<string, Map<string, ComparisonResult>>>();
  for (const r of allResults) {
    if (!grouped.has(r.product_id)) grouped.set(r.product_id, new Map());
    const bySec = grouped.get(r.product_id)!;
    if (!bySec.has(r.section)) bySec.set(r.section, new Map());
    bySec.get(r.section)!.set(r.model_id, r);
  }

  const handleSelectAndApply = async (result: ComparisonResult) => {
    setApplying(result.id);
    try {
      await selectResult.mutateAsync({
        runId,
        resultId:  result.id,
        productId: result.product_id,
        section:   result.section,
      });
      await applyResult.mutateAsync({
        productId:  result.product_id,
        section:    result.section,
        outputText: result.output_text,
      });
      toast.success("Resultado aplicado ao produto.");
    } catch (err) {
      toast.error("Erro ao aplicar resultado.");
      console.error(err);
    } finally {
      setApplying(null);
    }
  };

  return (
    <ScrollArea className="h-full pr-2">
      <div className="space-y-8">
        {products.map((product) => {
          const productResults = grouped.get(product.id);
          if (!productResults) return null;

          return (
            <div key={product.id}>
              {/* Product header */}
              <div className="flex items-baseline gap-2 mb-3">
                <h3 className="font-semibold text-sm">
                  {product.optimized_title || product.original_title || "Sem título"}
                </h3>
                {product.sku && (
                  <span className="text-xs text-muted-foreground">SKU: {product.sku}</span>
                )}
              </div>

              {/* Sections */}
              <div className="space-y-4">
                {COMPARISON_SECTIONS.filter((s) => sections.includes(s.id)).map((sectionDef) => {
                  const sectionResults = productResults.get(sectionDef.id);
                  if (!sectionResults) return null;

                  const resultsArr = Array.from(sectionResults.values());
                  const cheapestId = findCheapest(resultsArr);
                  const fastestId  = findFastest(resultsArr);

                  return (
                    <div key={sectionDef.id} className="border rounded-lg overflow-hidden">
                      {/* Section label */}
                      <div className="bg-muted/40 px-3 py-1.5 border-b">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {sectionDef.label}
                        </span>
                      </div>

                      {/* Model columns — horizontal scroll for many models */}
                      <div
                        className="grid"
                        style={{ gridTemplateColumns: `repeat(${modelIds.length}, minmax(260px, 1fr))` }}
                      >
                        {modelIds.map((modelId) => {
                          const result = sectionResults.get(modelId);
                          if (!result) return (
                            <div key={modelId} className="p-3 border-r last:border-r-0 text-xs text-muted-foreground">
                              Sem resultado
                            </div>
                          );

                          const isCheapest = result.id === cheapestId;
                          const isFastest  = result.id === fastestId;
                          const isSelected = result.selected;
                          const isApplying = applying === result.id;

                          return (
                            <div
                              key={modelId}
                              className={`p-3 border-r last:border-r-0 flex flex-col gap-2 ${
                                isSelected ? "bg-success/5 border-l-2 border-l-success" : ""
                              }`}
                            >
                              {/* Model + badges */}
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="text-xs font-semibold">{modelId}</span>
                                {isCheapest && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 text-success border-success/40">
                                    <DollarSign className="w-2.5 h-2.5" /> Mais barato
                                  </Badge>
                                )}
                                {isFastest && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 text-primary border-primary/40">
                                    <Zap className="w-2.5 h-2.5" /> Mais rápido
                                  </Badge>
                                )}
                                {isSelected && (
                                  <Badge className="text-[10px] px-1 py-0 bg-success text-success-foreground">
                                    <Star className="w-2.5 h-2.5" /> Selecionado
                                  </Badge>
                                )}
                              </div>

                              {/* Output text */}
                              <p className="text-xs leading-relaxed text-foreground whitespace-pre-wrap line-clamp-6 flex-1">
                                {result.output_text || "—"}
                              </p>

                              {/* Stats */}
                              <div className="flex gap-3 text-[10px] text-muted-foreground">
                                <span>${result.estimated_cost.toFixed(5)}</span>
                                <span>{result.latency_ms}ms</span>
                                <span>{result.input_tokens + result.output_tokens} tokens</span>
                              </div>

                              {/* Action */}
                              <Button
                                size="sm"
                                variant={isSelected ? "default" : "outline"}
                                className="h-7 text-xs w-full"
                                disabled={isApplying}
                                onClick={() => handleSelectAndApply(result)}
                              >
                                {isApplying ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : isSelected ? (
                                  <><Check className="w-3 h-3 mr-1" /> Aplicado</>
                                ) : (
                                  "Selecionar e aplicar"
                                )}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ai-comparison/AiComparisonResults.tsx
git commit -m "feat: AiComparisonResults — side-by-side model outputs with decision support badges"
```

---

## Task 6: Wire Up ProductsPage

**Files:**
- Modify: `src/pages/ProductsPage.tsx`

Add "Comparar IA" button to the products toolbar and wire the wizard.

- [ ] **Step 1: Add imports to ProductsPage.tsx**

Add after the last `import` statement in `src/pages/ProductsPage.tsx`:

```typescript
import { AiComparisonWizard } from "@/components/ai-comparison/AiComparisonWizard";
```

Find the existing lucide-react import line (starts with `import { ... } from "lucide-react"`) and add `GitCompare` to it.

- [ ] **Step 2: Add state for wizard visibility**

Find this exact line in `src/pages/ProductsPage.tsx` (line ~136):

```typescript
const [showExportDialog, setShowExportDialog] = useState(false);
```

Add immediately after it:

```typescript
const [showCompareModal, setShowCompareModal] = useState(false);
```

- [ ] **Step 3: Add "Comparar IA" button to the selection toolbar**

Find this exact block in `src/pages/ProductsPage.tsx` (line ~931):

```tsx
              <Button size="sm" variant="secondary" className="text-xs h-8" onClick={() => handleOptimizeClick(Array.from(selected))} disabled={optimizeProducts.isPending}>
                <Sparkles className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Otimizar </span>IA ({selected.size})
              </Button>
```

Add immediately after it (before the Export Seleção button):

```tsx
              <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setShowCompareModal(true)}>
                <GitCompare className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Comparar </span>IA ({selected.size})
              </Button>
```

- [ ] **Step 4: Render the wizard**

Find this exact block at the end of `src/pages/ProductsPage.tsx` (line ~2156):

```tsx
      <DuplicateDetectionDialog
        open={showDuplicates}
```

Add immediately before it:

```tsx
      <AiComparisonWizard
        open={showCompareModal}
        onOpenChange={setShowCompareModal}
        preSelectedProducts={products.filter((p) => selected.has(p.id))}
        allProducts={products}
      />
```

Note: `products` is already declared as `const products = paginatedData?.products ?? [];` at line 162 — use it directly.

- [ ] **Step 5: Verify the page renders without errors**

```bash
npm run dev
```

Navigate to the Products page. Confirm:
- "Comparar IA" button is visible in the toolbar
- Clicking it opens the wizard dialog
- Step 1 shows pre-selected products (if any are checked)
- Proceeding through steps 1-3 works
- Starting comparison shows progress bar
- Results appear after completion

- [ ] **Step 6: Commit**

```bash
git add src/pages/ProductsPage.tsx
git commit -m "feat: wire AiComparisonWizard into ProductsPage toolbar"
```

---

## Task 7: Push and Verify

- [ ] **Step 1: Run TypeScript check one final time**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: Push to remote**

```bash
git pull --rebase origin main
git push origin main
```

- [ ] **Step 3: Run migrations in Supabase**

In the Supabase SQL editor, run `supabase/migrations/20260320000005_ai_comparison.sql`.
Verify both tables appear in Table Editor with correct columns.

- [ ] **Step 4: Deploy edge function**

```bash
npx supabase functions deploy run-ai-comparison --project-ref hbjrycodpqjfreewyckl
```

- [ ] **Step 5: End-to-end test**

1. Open Products page
2. Select 2 products
3. Click "Comparar IA"
4. Step 1: confirm 2 products shown
5. Step 2: select "gemini-2.5-flash" + "claude-haiku-4-5-20251001"
6. Step 3: select "title" + "short_description"
7. Click "Iniciar comparação"
8. Watch progress bar (4 calls total: 2 products × 2 models)
9. Results appear: 2 product groups, each with 2 section rows, 2 model columns
10. Cheapest/fastest badges appear
11. Click "Selecionar e aplicar" on one result
12. Toast confirms success
13. Check product in DB — field updated

---

## Architecture Notes

**Non-destructive guarantee:** The wizard only writes to `ai_comparison_results`. It never touches `products` until the user explicitly clicks "Selecionar e aplicar" on a specific result. This is enforced in `useApplyComparisonResult` — the only place that calls `.update()` on the `products` table.

**Extensibility:** The `COMPARISON_SECTIONS` array in `useAiComparison.ts` is the single source of truth for supported sections. Adding "translation" or "faq" later requires one entry in that array plus a matching key in `SECTION_DESCRIPTIONS` in the edge function.

**Model list:** Comes from `useAiModelPricing()` (existing hook). Models with `/` in their ID are filtered out as legacy aliases. No hardcoding.

**Progress tracking:** Pure frontend — `completed` is incremented after each function call resolves. No DB polling needed. For very large batches (>50 calls), consider adding a `useQuery` poll on `ai_comparison_results` count as an alternative.
