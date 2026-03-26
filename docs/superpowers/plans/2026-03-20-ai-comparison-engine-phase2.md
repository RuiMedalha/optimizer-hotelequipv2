# AI Comparison Engine — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the AI Comparison Engine with persistent history, full output visibility, and an expanded model catalog.

**Architecture:** Three independent improvements: (1) "Ver completo" dialog in the results grid removes truncation without restructuring the grid; (2) a new `/ai-comparacoes` page lists past runs and reopens them using the existing `AiComparisonResults` component; (3) a new migration adds more provider models to `ai_model_pricing`.

**Tech Stack:** React 18 + TypeScript, Supabase (PostgreSQL + React Query), shadcn/ui Dialog/Sheet, Tailwind CSS

---

## File Map

| Action   | File | Responsibility |
|----------|------|----------------|
| Modify   | `src/components/ai-comparison/AiComparisonResults.tsx` | Add "Ver completo" Dialog; remove `line-clamp-6` |
| Modify   | `src/hooks/useAiComparison.ts` | Add `useComparisonHistory()` + `useProductsByIds()` |
| Create   | `src/pages/AiComparisonHistoryPage.tsx` | History list + reopen viewer |
| Modify   | `src/App.tsx` | Register `/ai-comparacoes` route |
| Modify   | `src/config/navigation.ts` | Add "Comparações IA" nav item |
| Create   | `supabase/migrations/20260320000006_expand_model_catalog.sql` | New models + legacy aliases |

---

### Task 1: Full output visibility — "Ver completo" dialog

**Files:**
- Modify: `src/components/ai-comparison/AiComparisonResults.tsx`

**Context:** Output text is currently truncated with `line-clamp-6` on line 198. The fix: remove the clamp, add a "Ver completo" button, and open a Dialog with the full text plus the apply action. No structural changes to the grid layout.

- [ ] **Step 1: Add Dialog import + open state**

Open `src/components/ai-comparison/AiComparisonResults.tsx`. At the top of the file, add `Dialog, DialogContent, DialogHeader, DialogTitle` to the shadcn imports and import `Expand` from lucide-react:

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, Zap, DollarSign, Loader2, Expand } from "lucide-react";
```

Inside `AiComparisonResults`, add state for the open dialog:

```tsx
const [viewingResult, setViewingResult] = useState<ComparisonResult | null>(null);
```

- [ ] **Step 2: Remove line-clamp-6 and add "Ver completo" button**

Find line 198:
```tsx
<p className="text-xs leading-relaxed text-foreground whitespace-pre-wrap line-clamp-6 flex-1">
```

Replace with:

```tsx
<div className="flex-1 space-y-1">
  <p className="text-xs leading-relaxed text-foreground whitespace-pre-wrap line-clamp-4">
    {result.output_text || "—"}
  </p>
  {(result.output_text?.length ?? 0) > 300 && (
    <button
      className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
      onClick={() => setViewingResult(result)}
    >
      <Expand className="w-2.5 h-2.5" /> Ver completo
    </button>
  )}
</div>
```

**UX rationale:** A compact preview (`line-clamp-4`) keeps the grid dense and scannable across multiple models. The "Ver completo" button appears whenever the text exceeds 300 characters and opens the Dialog with the complete, untruncated output. This satisfies the spec intent — no content is inaccessible without a "view full" action — while keeping the comparison grid usable.

- [ ] **Step 3: Add the "Ver completo" Dialog**

Insert the Dialog **after** the closing `</ScrollArea>` tag (line 241) and before the closing `}` of the `AiComparisonResults` function. The Dialog uses Radix Portal so rendering after `ScrollArea` is the correct placement:

```tsx
  return (
    <>
      <ScrollArea className="h-full">
        {/* existing content unchanged */}
      </ScrollArea>

      {/* Full-output viewer dialog — placed OUTSIDE ScrollArea */}
```

Concretely, find the return statement in `AiComparisonResults`. Wrap the existing `<ScrollArea>` in a fragment `<>...</>` and append the Dialog after it. The full return becomes:

```tsx
  return (
    <>
      <ScrollArea className="h-full">
        {/* ... existing content ... */}
      </ScrollArea>
```

Then append:

```tsx
{/* Full-output viewer dialog */}
<Dialog open={!!viewingResult} onOpenChange={(o) => { if (!o) setViewingResult(null); }}>
  <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
    <DialogHeader>
      <DialogTitle className="text-sm">
        {viewingResult
          ? `${COMPARISON_SECTIONS.find((s) => s.id === viewingResult.section)?.label ?? viewingResult.section} — ${viewingResult.model_id}`
          : ""}
      </DialogTitle>
    </DialogHeader>
    <ScrollArea className="flex-1 mt-2">
      <p className="text-sm leading-relaxed whitespace-pre-wrap pr-4">
        {viewingResult?.output_text}
      </p>
    </ScrollArea>
    {viewingResult && (
      <div className="border-t pt-3 flex items-center justify-between">
        <div className="flex gap-3 text-[10px] text-muted-foreground">
          <span>${Number(viewingResult.estimated_cost).toFixed(5)}</span>
          <span>{viewingResult.latency_ms}ms</span>
          <span>{viewingResult.input_tokens + viewingResult.output_tokens} tokens</span>
        </div>
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={applying === viewingResult.id}
          onClick={() => { handleSelectAndApply(viewingResult); setViewingResult(null); }}
        >
          {applying === viewingResult.id ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            "Selecionar e aplicar"
          )}
        </Button>
      </div>
    )}
  </DialogContent>
</Dialog>
```

- [ ] **Step 4: Verify rendering**

Run `npm run dev` (already running). Open the Products page, start a comparison, advance to results. Confirm:
- Output text shows 5 lines max in cells
- "Ver completo" appears for long outputs
- Dialog opens with full text and stats
- "Selecionar e aplicar" inside dialog works and closes dialog

- [ ] **Step 5: Commit**

```bash
git add src/components/ai-comparison/AiComparisonResults.tsx
git commit -m "feat: add full-output dialog to comparison results grid"
```

---

### Task 2: Comparison history hook + products-by-ids utility

**Files:**
- Modify: `src/hooks/useAiComparison.ts`

**Context:** The existing hook only fetches results for a specific `runId`. We need: (a) `useComparisonHistory()` — paginated list of all completed runs for the active workspace; (b) `useProductsByIds()` — fetch product records by an array of IDs so the history page can reopen a run in `AiComparisonResults`.

- [ ] **Step 1: Add `Product` import at the top of the file**

Open `src/hooks/useAiComparison.ts`. The file starts with 3 `import` lines (lines 1–6), then a `// ── Types` comment block. Insert the new import after line 6 (the `useWorkspaceContext` import), before the `// ── Types` comment:

```typescript
// Existing line 4:
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
// Add here — line 5 (new):
import type { Product } from "@/hooks/useProducts";
// Then the existing comment:
// ── Types ──────────...
```

TypeScript does not allow `import` declarations after function or variable definitions. This placement ensures the import is in the module's declaration preamble.

- [ ] **Step 2: Add `useComparisonHistory` hook**

Append to `src/hooks/useAiComparison.ts` (after all existing exports):

```typescript
// ── Comparison run history ─────────────────────────────────────────────────────

export function useComparisonHistory() {
  const { activeWorkspace } = useWorkspaceContext();

  return useQuery({
    queryKey: ["comparison-runs", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_comparison_runs" as any)
        .select("*")
        .eq("workspace_id", activeWorkspace!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ComparisonRun[];
    },
  });
}
```

- [ ] **Step 3: Add `useProductsByIds` hook**

Append to `src/hooks/useAiComparison.ts` (after `useComparisonHistory`):

```typescript
// ── Fetch products by array of IDs (for reopening historical runs) ──────────────

export function useProductsByIds(ids: string[]) {
  return useQuery({
    queryKey: ["products-by-ids", ids],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, optimized_title, original_title, sku")
        .in("id", ids);
      if (error) throw error;
      return (data ?? []) as Pick<Product, "id" | "optimized_title" | "original_title" | "sku">[];
    },
  });
}
```

Note: `Product` type comes from `src/hooks/useProducts`. Check that `optimized_title`, `original_title`, and `sku` exist on the type; if the type uses different field names, match them. Use `as any` cast if the generated types don't include a field.

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors. The `import type { Product }` is at the top of the file — if TypeScript still errors on ordering, confirm no other import was inadvertently placed after a `const` or `export`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAiComparison.ts
git commit -m "feat: add comparison history and products-by-ids hooks"
```

---

### Task 3: Comparison History page

**Files:**
- Create: `src/pages/AiComparisonHistoryPage.tsx`

**Context:** Shows a table of past comparison runs (date, models, products, status). Each row has a "Rever" button that opens a Dialog with `AiComparisonResults` for that run. The Dialog fetches products via `useProductsByIds`.

- [ ] **Step 1: Create the page**

Create `src/pages/AiComparisonHistoryPage.tsx`:

```tsx
// src/pages/AiComparisonHistoryPage.tsx
import { useState } from "react";
import { GitCompare, Loader2, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useComparisonHistory,
  useProductsByIds,
  useComparisonResults,
  type ComparisonRun,
} from "@/hooks/useAiComparison";
import { AiComparisonResults } from "@/components/ai-comparison/AiComparisonResults";

// ── Run viewer sub-component ───────────────────────────────────────────────────

function RunViewer({ run, onClose }: { run: ComparisonRun; onClose: () => void }) {
  const { data: products = [], isLoading } = useProductsByIds(run.product_ids);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-7xl w-full h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="text-base flex items-center gap-2">
            <GitCompare className="w-4 h-4" />
            Comparação de {new Date(run.created_at).toLocaleString("pt-PT")}
            <Badge variant="secondary" className="ml-auto text-xs">
              {run.model_ids.length} modelos · {run.product_count} produto{run.product_count !== 1 ? "s" : ""}
            </Badge>
          </DialogTitle>
          <div className="flex flex-wrap gap-1 mt-1">
            {run.model_ids.map((m) => (
              <Badge key={m} variant="outline" className="text-[10px]">{m}</Badge>
            ))}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <AiComparisonResults
              runId={run.id}
              products={products as any}
              modelIds={run.model_ids}
              sections={run.sections}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AiComparisonHistoryPage() {
  const { data: runs = [], isLoading } = useComparisonHistory();
  const [viewing, setViewing] = useState<ComparisonRun | null>(null);

  const statusLabel: Record<string, string> = {
    completed: "Concluída",
    running:   "A correr",
    cancelled: "Cancelada",
  };

  const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    completed: "default",
    running:   "secondary",
    cancelled: "outline",
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <GitCompare className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold">Histórico de Comparações IA</h1>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-24 text-sm text-muted-foreground">
          Nenhuma comparação realizada ainda.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Data</th>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Modelos</th>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Produtos</th>
                <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Estado</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {runs.map((run) => (
                <tr key={run.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(run.created_at).toLocaleString("pt-PT")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 max-w-sm">
                      {run.model_ids.slice(0, 3).map((m) => (
                        <Badge key={m} variant="outline" className="text-[10px]">{m}</Badge>
                      ))}
                      {run.model_ids.length > 3 && (
                        <Badge variant="outline" className="text-[10px]">+{run.model_ids.length - 3}</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">{run.product_count}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant[run.status] ?? "secondary"} className="text-[10px]">
                      {statusLabel[run.status] ?? run.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs gap-1"
                      disabled={run.status !== "completed"}
                      onClick={() => setViewing(run)}
                    >
                      Rever <ChevronRight className="w-3 h-3" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewing && <RunViewer run={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
```

- [ ] **Step 2: Verify Product field coverage**

Open `src/components/ai-comparison/AiComparisonResults.tsx` and scan all usages of the `products` prop (passed in as `Product[]`). At time of writing, the component accesses:
- `product.id` — used as React key and map lookup
- `product.optimized_title` (via `(product as any).optimized_title`)
- `product.original_title` (via `(product as any).original_title`)
- `product.sku` (via `(product as any).sku`)

These four fields are all included in the `useProductsByIds` select (`"id, optimized_title, original_title, sku"`). If the component accesses any additional field not in this list, add it to the select query in `useAiComparison.ts`. The `as any` cast in `RunViewer` suppresses TypeScript errors but not runtime `undefined` values.

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Fix any type errors. Common issues: `Product` type fields — if `optimized_title`/`original_title`/`sku` don't exist on the generated type, cast with `as any` on the `useProductsByIds` return.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AiComparisonHistoryPage.tsx
git commit -m "feat: add AI comparison history page with run viewer"
```

---

---

### Task 4: Route and navigation wiring

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/config/navigation.ts`

**Context:** Add `/ai-comparacoes` route in App.tsx (following the existing import + Route pattern). Add nav item under the `governance` group alongside "Prompt Governance" and "AI Provider Center".

- [ ] **Step 1: Add route in App.tsx**

In `src/App.tsx`, add the import after line 58 (after `ScraperManualPage`):

```tsx
import AiComparisonHistoryPage from "./pages/AiComparisonHistoryPage";
```

Then find the `<Routes>` section. Locate the route for `/prompt-governance` or any governance route. Add before the `<Route path="*" element={<NotFound />} />` catch-all:

```tsx
<Route path="/ai-comparacoes" element={<AiComparisonHistoryPage />} />
```

- [ ] **Step 2: Add nav item in navigation.ts**

`GitCompare` is NOT in `src/config/navigation.ts`. Add it to the existing lucide-react import block. The current last icon import before `type LucideIcon` is `MousePointerClick` (line ~44). Add `GitCompare` after `GitMerge`:

```typescript
// Before (excerpt):
  GitMerge,
  MousePointerClick,
  type LucideIcon,

// After:
  GitMerge,
  GitCompare,
  MousePointerClick,
  type LucideIcon,
```

In the `governance` group's `items` array, add after "Cost Intelligence":

```typescript
{ title: "Comparações IA", icon: GitCompare, route: "/ai-comparacoes" },
```

- [ ] **Step 3: Verify**

Run `npm run dev`. Navigate to the sidebar — "Comparações IA" should appear under "Governance". Click it → the history page renders. With no runs, shows empty state. With runs, shows table.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/config/navigation.ts
git commit -m "feat: wire /ai-comparacoes route and nav item"
```

---

### Task 5: Expanded model catalog migration

**Files:**
- Create: `supabase/migrations/20260320000006_expand_model_catalog.sql`

**Context:** The AiComparisonWizard filters models with `!model_id.includes("/")` (excludes legacy aliases). This migration adds canonical entries for: OpenAI `o3-mini`, `o1-mini`, `gpt-4-turbo`; Anthropic `claude-3-opus-20240229`; Gemini `gemini-2.0-flash`, `gemini-2.0-flash-lite`; DeepSeek `deepseek-v3`, `deepseek-r1` (prepare structure, pricing TBD). All with full metadata. Idempotent (`ON CONFLICT DO UPDATE`).

Pricing references (USD per 1M tokens):
- `o3-mini`: $1.10 input / $4.40 output
- `o1-mini`: $1.10 input / $4.40 output
- `gpt-4-turbo`: $10.00 input / $30.00 output
- `claude-3-opus-20240229`: $15.00 / $75.00
- `gemini-2.0-flash`: $0.10 / $0.40
- `gemini-2.0-flash-lite`: $0.075 / $0.30
- `deepseek-v3`: $0.27 / $1.10 (approximate, verify at deepseek.com/pricing)
- `deepseek-r1`: $0.55 / $2.19 (approximate)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260320000006_expand_model_catalog.sql`:

```sql
-- Expand model catalog with additional OpenAI, Anthropic, Gemini, and DeepSeek models.
-- All entries include full metadata JSONB.
-- Idempotent: ON CONFLICT (provider_id, model_id, effective_from) DO UPDATE.

INSERT INTO ai_model_pricing
  (provider_id, model_id, display_name,
   input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m,
   currency, effective_from, is_active, source_url, notes, metadata)
VALUES

  -- ── OpenAI ───────────────────────────────────────────────────────────────────
  ('openai', 'o3-mini', 'o3 Mini',
   1.10, 4.40, null,
   'USD', '2026-03-20', true,
   'https://openai.com/api/pricing/',
   'Reasoning model; fast and cost-effective for structured tasks',
   '{"best_for":"Raciocínio eficiente, classificação avançada","strengths":["Raciocínio encadeado","Custo baixo","Velocidade"],"speed_tier":"fast","quality_tier":"high","cost_tier":"cheap","recommended_tasks":["reasoning","classification","extraction"]}'),

  ('openai', 'o1-mini', 'o1 Mini',
   1.10, 4.40, null,
   'USD', '2026-03-20', true,
   'https://openai.com/api/pricing/',
   'Compact reasoning model; predecessor to o3-mini',
   '{"best_for":"Raciocínio compacto, análise estruturada","strengths":["Raciocínio","Velocidade moderada"],"speed_tier":"medium","quality_tier":"high","cost_tier":"cheap","recommended_tasks":["reasoning","extraction"]}'),

  ('openai', 'gpt-4-turbo', 'GPT-4 Turbo',
   10.00, 30.00, 5.00,
   'USD', '2026-03-20', true,
   'https://openai.com/api/pricing/',
   'High-capability model with 128k context',
   '{"best_for":"Tarefas de alta qualidade, contexto longo","strengths":["Qualidade premium","Contexto 128k","Multimodal"],"speed_tier":"medium","quality_tier":"premium","cost_tier":"expensive","recommended_tasks":["reasoning","content_generation","long_context"]}'),

  -- ── Anthropic ─────────────────────────────────────────────────────────────────
  ('anthropic', 'claude-3-opus-20240229', 'Claude 3 Opus',
   15.00, 75.00, 1.50,
   'USD', '2026-03-20', true,
   'https://www.anthropic.com/pricing',
   'Highest quality Anthropic model (Claude 3 generation); use claude-opus-4-6 for newer',
   '{"best_for":"Análise profunda, raciocínio complexo (geração Claude 3)","strengths":["Qualidade máxima","Raciocínio","Análise detalhada"],"speed_tier":"slow","quality_tier":"premium","cost_tier":"expensive","recommended_tasks":["reasoning","complex_analysis","content_generation"]}'),

  -- ── Google Gemini ─────────────────────────────────────────────────────────────
  ('gemini', 'gemini-2.0-flash', 'Gemini 2.0 Flash',
   0.10, 0.40, null,
   'USD', '2026-03-20', true,
   'https://ai.google.dev/pricing',
   'Stable fast model; great balance speed/quality before 2.5 Flash',
   '{"best_for":"Tarefas rápidas, enriquecimento, visão","strengths":["Velocidade","Multimodal","Custo baixo"],"speed_tier":"fast","quality_tier":"high","cost_tier":"cheap","recommended_tasks":["enrichment","multimodal_vision","summarization"]}'),

  ('gemini', 'gemini-2.0-flash-lite', 'Gemini 2.0 Flash Lite',
   0.075, 0.30, null,
   'USD', '2026-03-20', true,
   'https://ai.google.dev/pricing',
   'Lightest 2.0 variant; ultra-high-volume tasks',
   '{"best_for":"Alto volume, classificação simples","strengths":["Ultra-rápido","Custo mínimo","Throughput"],"speed_tier":"fast","quality_tier":"standard","cost_tier":"cheap","recommended_tasks":["classification","seo_generation"]}'),

  -- ── DeepSeek ─────────────────────────────────────────────────────────────────
  -- NOTE: is_active = false until resolve-ai-route supports DeepSeek provider.
  -- These rows are for pricing reference only; they will NOT appear in the
  -- AiComparisonWizard model picker until activated.
  ('deepseek', 'deepseek-v3', 'DeepSeek V3',
   0.27, 1.10, null,
   'USD', '2026-03-20', false,
   'https://platform.deepseek.com/docs',
   'Strong open-source model; INACTIVE until DeepSeek provider wired in resolve-ai-route',
   '{"best_for":"Raciocínio, geração de conteúdo, custo baixo","strengths":["Qualidade alta","Custo baixíssimo","Open-source"],"speed_tier":"medium","quality_tier":"high","cost_tier":"cheap","recommended_tasks":["content_generation","reasoning","extraction"]}'),

  ('deepseek', 'deepseek-r1', 'DeepSeek R1',
   0.55, 2.19, null,
   'USD', '2026-03-20', false,
   'https://platform.deepseek.com/docs',
   'Reasoning-focused model; INACTIVE until DeepSeek provider wired in resolve-ai-route',
   '{"best_for":"Raciocínio avançado, análise de dados","strengths":["Raciocínio encadeado","Qualidade premium","Open-source"],"speed_tier":"medium","quality_tier":"premium","cost_tier":"cheap","recommended_tasks":["reasoning","complex_analysis"]}')

ON CONFLICT (provider_id, model_id, effective_from) DO UPDATE SET
  display_name             = EXCLUDED.display_name,
  input_cost_per_1m        = EXCLUDED.input_cost_per_1m,
  output_cost_per_1m       = EXCLUDED.output_cost_per_1m,
  cached_input_cost_per_1m = EXCLUDED.cached_input_cost_per_1m,
  is_active                = EXCLUDED.is_active,
  source_url               = EXCLUDED.source_url,
  notes                    = EXCLUDED.notes,
  metadata                 = EXCLUDED.metadata,
  updated_at               = now();
```

- [ ] **Step 2: Verify SQL syntax**

```bash
# Dry-run parse (requires psql or supabase db diff; if not available, review manually)
npx supabase db diff --local 2>&1 | head -20
```

If the local dev DB is running: `npx supabase db push` to apply. Otherwise, file is ready for production deployment.

Note on `providerFromModelId` in `useAiPricingDashboard.ts` — the `deepseek` provider prefix is not currently handled. Add a case:

```typescript
// In src/hooks/useAiPricingDashboard.ts, providerFromModelId():
if (raw.startsWith("deepseek/") || raw.includes("deepseek")) return "deepseek";
```

Also update `normalizeModelId()` to strip `deepseek/` prefix:

```typescript
.replace(/^(google|openai|anthropic|mistral|meta-llama|cohere|deepseek)\//, "")
```

- [ ] **Step 3: Update AiComparisonWizard provider detection**

In `src/components/ai-comparison/AiComparisonWizard.tsx`, the model filter `!p.model_id.includes("/")` already handles DeepSeek since IDs like `deepseek-v3` have no slash. No changes needed there.

However, the `run-ai-comparison` edge function's `toProviderModel()` maps bare IDs to prefixed ones. Check `supabase/functions/run-ai-comparison/index.ts` — its current logic:

```typescript
function toProviderModel(modelId: string): string {
  if (modelId.startsWith("gemini")) return `google/${modelId}`;
  // ...
}
```

Add DeepSeek mapping:

```typescript
if (modelId.startsWith("deepseek")) return `deepseek/${modelId}`;
```

And verify `resolve-ai-route` handles DeepSeek (this may require a separate edge function update outside this plan scope — add a TODO comment if not implemented).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260320000006_expand_model_catalog.sql \
        src/hooks/useAiPricingDashboard.ts \
        supabase/functions/run-ai-comparison/index.ts
git commit -m "feat: expand model catalog with OpenAI o3, Gemini 2.0, DeepSeek models"
```

---

## Deployment checklist (post-plan)

After all tasks are committed:

```bash
# Apply new migrations
npx supabase db push --project-ref hbjrycodpqjfreewyckl

# Deploy updated edge function (if run-ai-comparison was changed in Task 5)
npx supabase functions deploy run-ai-comparison --project-ref hbjrycodpqjfreewyckl
```

---

## Out of scope for this plan

- DeepSeek provider integration in `resolve-ai-route` (requires new API key, provider registry entry, capability matrix update — separate feature)
- Transversal comparison for PDF / translation / images (separate plan)
- Comparison result scoring / ranking algorithm beyond cheapest+fastest badges
