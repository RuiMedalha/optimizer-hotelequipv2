# Excel Export, Session Management & Audit Trail — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar 10 colunas ao export Excel (EAN/Modelo/Marca separados, lookups assíncronos seguros), rename/delete de sessões no WorkflowRunSelector, e ligar auditoria de importação ao painel de histórico.

**Architecture:** Quatro tasks totalmente independentes, commits separados. Task A modifica apenas `useExportProducts.ts`. Task B apenas `WorkflowRunSelector.tsx`. Task C1 é 2 linhas na edge function. Task C2 cria `ImportHistoryPanel.tsx` e integra-o em `WooImportPage.tsx`.

**Tech Stack:** React 18 + TypeScript, XLSX (já instalado), Supabase client, TanStack React Query v5, sonner (toast), lucide-react.

---

## Contexto para o implementador

### Ficheiros chave a ler antes de começar

- `src/hooks/useExportProducts.ts` — export Excel actual (27 colunas, funções `productToRow`, `exportAllProductsToExcel`, `exportProductsToExcel`)
- `src/components/WorkflowRunSelector.tsx` — selector de sessões no banner
- `src/hooks/useActiveWorkflowRun.ts` — hook de sessão activa (tem `clearActiveRun`)
- `supabase/functions/import-woocommerce/index.ts` — edge function (activity_log insert está nas linhas 614-626)
- `src/pages/WooImportPage.tsx` — página de import (para integrar o painel de histórico)

### Regras obrigatórias

- EAN/Modelo: matching por Set de nomes lowercase, nunca por string exacta
- Lookups: sempre `try/catch`, sempre com fallback para UUID bruto
- category_paths secundárias: `slice(1)` — exclui o índice 0 (= categoria principal)
- Delete de sessão: sempre fazer NULL nos produtos ANTES de apagar o run

---

## Task A — Excel: 10 colunas novas (1 commit)

**Files:**
- Modify: `src/hooks/useExportProducts.ts`
- Modify: `src/pages/ProductsPage.tsx` (call site de `exportProductsToExcel` — tornar-se-á async)

---

- [ ] **A1 — Ler o ficheiro actual**

```bash
cat -n src/hooks/useExportProducts.ts
```

Confirmar: linha onde `EXPORT_COLUMNS` começa, assinatura de `productToRow`, corpo de `exportAllProductsToExcel`.

---

- [ ] **A2 — Adicionar constantes de matching robusto no topo do ficheiro**

Após as importações existentes, antes de `EXPORT_COLUMNS`, inserir:

```typescript
// Attribute name sets for robust matching (case-insensitive)
const EAN_ATTR_NAMES = new Set([
  "ean", "gtin", "barcode", "código de barras", "codigo de barras", "_ean", "_gtin", "_barcode",
]);
const MODELO_ATTR_NAMES = new Set([
  "modelo", "model", "ref", "referência", "referencia", "_modelo", "_model",
]);
const CRITICAL_ATTR_NAMES = new Set([...EAN_ATTR_NAMES, ...MODELO_ATTR_NAMES]);

function extractAttrValue(attrs: any[], nameSet: Set<string>): string {
  const found = (attrs || []).find((a: any) =>
    nameSet.has((a.name ?? "").toLowerCase().trim())
  );
  return found?.value || (Array.isArray(found?.values) ? found.values[0] : "") || "";
}
```

---

- [ ] **A3 — Adicionar lookup helpers assíncronos**

Após as constantes acima, antes de `EXPORT_COLUMNS`, inserir:

```typescript
async function fetchUserLookup(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  try {
    const { data } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", userIds);
    const map = new Map<string, string>();
    for (const p of data ?? []) {
      map.set(p.user_id, p.full_name || p.email || p.user_id);
    }
    return map;
  } catch {
    return new Map();
  }
}

async function fetchSessionLookup(runIds: string[]): Promise<Map<string, string>> {
  if (runIds.length === 0) return new Map();
  try {
    const { data } = await supabase
      .from("catalog_workflow_runs")
      .select("id, catalog_workflows(workflow_name)")
      .in("id", runIds);
    const map = new Map<string, string>();
    for (const r of data ?? []) {
      const name = (r.catalog_workflows as any)?.workflow_name;
      if (name) map.set(r.id, name);
    }
    return map;
  } catch {
    return new Map();
  }
}
```

---

- [ ] **A4 — Adicionar as 10 novas colunas a `EXPORT_COLUMNS`**

Substituir `EXPORT_COLUMNS` pelo seguinte (manter as 27 existentes, adicionar/renomear conforme abaixo):

```typescript
const EXPORT_COLUMNS = [
  { key: "sku", header: "SKU" },
  { key: "woocommerce_id", header: "WooCommerce ID" },          // ← novo
  { key: "product_type", header: "Tipo" },
  { key: "original_title", header: "Título Original" },
  { key: "optimized_title", header: "Título Otimizado" },
  { key: "original_description", header: "Descrição Original" },
  { key: "optimized_description", header: "Descrição Otimizada" },
  { key: "short_description", header: "Descrição Curta Original" },
  { key: "optimized_short_description", header: "Descrição Curta Otimizada" },
  { key: "technical_specs", header: "Características Técnicas" },
  { key: "original_price", header: "Preço Original" },
  { key: "sale_price", header: "Preço Promocional" },
  { key: "optimized_price", header: "Preço Otimizado" },
  { key: "optimized_sale_price", header: "Preço Promocional Otimizado" },
  { key: "category", header: "Categoria Principal" },
  { key: "category_paths_secondary", header: "Categorias Secundárias" },  // ← novo (virtual)
  { key: "suggested_category", header: "Categoria Proposta (IA)" },
  { key: "supplier_ref", header: "Marca" },                     // ← renomeado de "Ref. Fornecedor"
  { key: "attr_ean", header: "EAN" },                           // ← novo (virtual)
  { key: "attr_modelo", header: "Modelo" },                     // ← novo (virtual)
  { key: "tags", header: "Tags" },
  { key: "meta_title", header: "Meta Title SEO" },
  { key: "meta_description", header: "Meta Description SEO" },
  { key: "seo_slug", header: "SEO Slug" },
  { key: "focus_keyword", header: "Focus Keyword" },            // ← novo
  { key: "faq", header: "FAQ" },
  { key: "upsell_skus", header: "Upsells (SKU | Título)" },
  { key: "crosssell_skus", header: "Cross-sells (SKU | Título)" },
  { key: "image_urls", header: "URLs Imagens" },
  { key: "image_alt_texts", header: "Alt Text Imagens" },
  { key: "attributes", header: "Outros Atributos" },            // ← renomeado, excluirá EAN/Modelo
  { key: "woo_status", header: "Estado WooCommerce" },          // ← novo (virtual)
  { key: "status", header: "Estado Optimização" },              // ← renomeado
  { key: "imported_at", header: "Importado em" },               // ← novo (virtual)
  { key: "imported_by", header: "Importado por" },              // ← novo (virtual, requer lookup)
  { key: "session_name", header: "Sessão" },                    // ← novo (virtual, requer lookup)
];
```

---

- [ ] **A5 — Actualizar `productToRow` para lidar com as colunas virtuais**

Substituir `productToRow` por:

```typescript
interface ProductLookups {
  users: Map<string, string>;
  sessions: Map<string, string>;
}

function productToRow(p: Product, skuPrefix?: string, lookups?: ProductLookups) {
  const row: Record<string, unknown> = {};
  const attrs: any[] = Array.isArray((p as any).attributes) ? (p as any).attributes : [];
  const sourceProfile: any = (p as any).source_confidence_profile ?? {};
  const categoryPaths: string[] = Array.isArray(sourceProfile.category_paths)
    ? sourceProfile.category_paths
    : [];

  for (const col of EXPORT_COLUMNS) {
    let val = (p as any)[col.key];

    // SKU prefix
    if (col.key === "sku" && skuPrefix && val && !String(val).toUpperCase().startsWith(skuPrefix.toUpperCase())) {
      val = skuPrefix + val;
    }

    // Virtual columns
    if (col.key === "category_paths_secondary") {
      row[col.header] = categoryPaths.slice(1).join(" | ");
      continue;
    }
    if (col.key === "attr_ean") {
      row[col.header] = extractAttrValue(attrs, EAN_ATTR_NAMES);
      continue;
    }
    if (col.key === "attr_modelo") {
      row[col.header] = extractAttrValue(attrs, MODELO_ATTR_NAMES);
      continue;
    }
    if (col.key === "woo_status") {
      row[col.header] = sourceProfile.woo_status ?? "";
      continue;
    }
    if (col.key === "imported_at") {
      row[col.header] = (p as any).created_at
        ? new Date((p as any).created_at).toLocaleDateString("pt-PT")
        : "";
      continue;
    }
    if (col.key === "imported_by") {
      const uid = (p as any).user_id;
      row[col.header] = (uid && lookups?.users.get(uid)) || uid || "";
      continue;
    }
    if (col.key === "session_name") {
      const rid = (p as any).workflow_run_id;
      row[col.header] = (rid && lookups?.sessions.get(rid)) || rid || "";
      continue;
    }

    // Standard columns
    if (col.key === "faq" && Array.isArray(val)) {
      row[col.header] = val.map((f: any) => `Q: ${f.question} A: ${f.answer}`).join(" | ");
    } else if ((col.key === "upsell_skus" || col.key === "crosssell_skus") && Array.isArray(val)) {
      row[col.header] = val.map((item: any) => typeof item === "string" ? item : item.sku).filter(Boolean).join(",");
    } else if (col.key === "image_alt_texts" && Array.isArray(val)) {
      row[col.header] = val.map((a: any) => a.alt_text).join(" | ");
    } else if (col.key === "attributes" && Array.isArray(val)) {
      // Exclude EAN and Modelo — they have dedicated columns
      const others = val.filter((a: any) => !CRITICAL_ATTR_NAMES.has((a.name ?? "").toLowerCase().trim()));
      row[col.header] = others.map((a: any) => `${a.name}: ${a.value || (a.values || []).join(", ")}`).join(" | ");
    } else if (col.key === "focus_keyword" && Array.isArray(val)) {
      row[col.header] = val.join(", ");
    } else if (Array.isArray(val)) {
      row[col.header] = val.join(", ");
    } else {
      row[col.header] = val ?? "";
    }
  }
  return row;
}
```

---

- [ ] **A6 — Actualizar `exportAllProductsToExcel` para lookups assíncronos**

Após a linha `allProducts.push(...products)` e antes de `writeExcel`, adicionar o bloco de lookups. Localizar o final de `exportAllProductsToExcel` (linha `writeExcel(excelRows, fileName)`) e substituir por:

```typescript
  // Build lookup maps for user names and session names
  const uniqueUserIds = [...new Set(allProducts.map((p: any) => p.user_id).filter(Boolean))];
  const uniqueRunIds = [...new Set(allProducts.map((p: any) => p.workflow_run_id).filter(Boolean))];
  const [userMap, sessionMap] = await Promise.all([
    fetchUserLookup(uniqueUserIds),
    fetchSessionLookup(uniqueRunIds),
  ]);
  const lookups: ProductLookups = { users: userMap, sessions: sessionMap };

  const excelRows = allProducts.map((p) => productToRow(p, skuPrefix, lookups));
  writeExcel(excelRows, fileName);
  toast.success(`${allProducts.length} produto(s) exportado(s) com sucesso!`);
```

---

- [ ] **A7 — Actualizar `exportProductsToExcel` para ser assíncrona com lookups**

Substituir a função síncrona por versão assíncrona:

```typescript
export async function exportProductsToExcel(products: Product[], fileName = "produtos-otimizados", skuPrefix?: string) {
  if (products.length === 0) {
    toast.error("Nenhum produto para exportar.");
    return;
  }
  const uniqueUserIds = [...new Set(products.map((p: any) => p.user_id).filter(Boolean))];
  const uniqueRunIds = [...new Set(products.map((p: any) => p.workflow_run_id).filter(Boolean))];
  const [userMap, sessionMap] = await Promise.all([
    fetchUserLookup(uniqueUserIds),
    fetchSessionLookup(uniqueRunIds),
  ]);
  const lookups: ProductLookups = { users: userMap, sessions: sessionMap };
  const rows = products.map((p) => productToRow(p, skuPrefix, lookups));
  writeExcel(rows, fileName);
  toast.success(`${products.length} produto(s) exportado(s) com sucesso!`);
}
```

---

- [ ] **A7b — Actualizar call sites de `exportProductsToExcel` em `ProductsPage.tsx`**

Pesquisar todos os call sites:
```bash
grep -rn "exportProductsToExcel" src/ --include="*.tsx" --include="*.ts"
```

Em `src/pages/ProductsPage.tsx`, localizar cada chamada do tipo:
```typescript
exportProductsToExcel(prods, "produtos-selecionados", prefix)
```

Como o `onClick` já é `async`, substituir por:
```typescript
await exportProductsToExcel(prods, "produtos-selecionados", prefix)
```

Aplicar o mesmo padrão para todos os call sites encontrados.

---

- [ ] **A8 — Verificar TypeScript e build**

```bash
npx tsc --noEmit
npm run build
```

Esperado: sem erros TypeScript. O build pode mostrar o aviso de chunk size (pré-existente — ignorar).

---

- [ ] **A9 — Commit Task A**

```bash
git add src/hooks/useExportProducts.ts src/pages/ProductsPage.tsx
git diff --stat HEAD
git commit -m "feat: add 10 new columns to Excel export (EAN, Modelo, Marca, category paths, audit fields)"
```

---

## Task B — Sessões: rename e delete (1 commit)

**Files:**
- Modify: `src/components/WorkflowRunSelector.tsx`

---

- [ ] **B1 — Ler o ficheiro actual**

```bash
cat -n src/components/WorkflowRunSelector.tsx
```

Confirmar: imports existentes, estado local, query de `recentRuns`, estrutura da lista.

---

- [ ] **B2 — Actualizar imports: adicionar `useQueryClient`, `Pencil`, `Trash2`, `Check`, `X`**

Localizar o import de `@tanstack/react-query`:
```typescript
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
```
Substituir por:
```typescript
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
```

Localizar o import de lucide-react (contém `FolderOpen, Plus, ChevronDown, CheckCircle, Clock`):
```typescript
import { FolderOpen, Plus, ChevronDown, CheckCircle, Clock } from "lucide-react";
```
Substituir por:
```typescript
import { FolderOpen, Plus, ChevronDown, CheckCircle, Clock, Pencil, Trash2, Check, X } from "lucide-react";
```

Adicionar `clearActiveRun` à desestruturação do hook (linha com `useActiveWorkflowRun`):
```typescript
// antes:
const { activeRunId, setActiveRun, createNewSession } = useActiveWorkflowRun(activeWorkspace?.id);
// depois:
const { activeRunId, setActiveRun, createNewSession, clearActiveRun } = useActiveWorkflowRun(activeWorkspace?.id);
```

---

- [ ] **B3 — Actualizar a query de `recentRuns` para incluir `catalog_workflows(id, workflow_name)`**

**IMPORTANTE:** este passo deve ser feito ANTES de escrever os handlers, pois eles dependem de `catalog_workflows.id` no shape dos dados.

Localizar a linha dentro de `useQuery` de `recentRuns`:
```typescript
        .select("id, created_at, catalog_workflows(workflow_name)")
```
Substituir por:
```typescript
        .select("id, created_at, catalog_workflows(id, workflow_name)")
```

---

- [ ] **B4 — Adicionar estado e handlers para rename e delete**

Após o estado existente (`useState` para `open`, `newName`, `isCreating`), adicionar:

```typescript
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const queryClient = useQueryClient();
```

Adicionar os handlers (após `handleCreate`):

```typescript
  // workflowId vem de catalog_workflows.id — disponível após a query ser actualizada no passo B3
  const handleRename = async (runId: string, workflowId: string) => {
    const name = editName.trim();
    if (!name) return;
    setIsRenaming(true);
    try {
      const { error } = await supabase
        .from("catalog_workflows")
        .update({ workflow_name: name })
        .eq("id", workflowId);
      if (error) throw error;
      toast.success(`Sessão renomeada para "${name}".`);
      setEditingRunId(null);
      queryClient.invalidateQueries({ queryKey: ["workflow-runs-recent"] });
      queryClient.invalidateQueries({ queryKey: ["workflow-run-detail", runId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao renomear sessão");
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDelete = async (runId: string, workflowId: string) => {
    if (!window.confirm("Apagar esta sessão? Os produtos associados ficam sem sessão.")) return;
    setIsDeleting(runId);
    try {
      // 1. Desligar produtos da sessão (seguro independentemente do tipo de FK)
      await supabase
        .from("products")
        .update({ workflow_run_id: null } as any)
        .eq("workflow_run_id", runId);

      // 2. Apagar o run
      const { error: runErr } = await supabase
        .from("catalog_workflow_runs")
        .delete()
        .eq("id", runId);
      if (runErr) throw runErr;

      // 3. Apagar o workflow
      await supabase.from("catalog_workflows").delete().eq("id", workflowId);

      // 4. Se era a sessão activa, limpar
      if (runId === activeRunId) clearActiveRun();

      toast.success("Sessão apagada.");
      queryClient.invalidateQueries({ queryKey: ["workflow-runs-recent"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao apagar sessão");
    } finally {
      setIsDeleting(null);
    }
  };
```

**Nota:** `clearActiveRun` precisa de ser desestruturado do hook:
```typescript
const { activeRunId, setActiveRun, createNewSession, clearActiveRun } = useActiveWorkflowRun(activeWorkspace?.id);
```

---

- [ ] **B5 — Actualizar a lista de sessões recentes com botões de rename/delete**

Os `recentRuns` são renderizados num bloco `{recentRuns && recentRuns.length > 0 && ...}`.

Para cada `run` na lista, substituir o `<button>` actual por um grupo que inclui o botão de selecção + ícones de rename e delete.

Adicionar imports no topo do ficheiro:
```typescript
import { FolderOpen, Plus, ChevronDown, CheckCircle, Clock, Pencil, Trash2, Check, X } from "lucide-react";
```

Substituir o interior do `<div className="space-y-1 max-h-48 overflow-y-auto">` por:

```tsx
{recentRuns.map((run: any) => (
  <div key={run.id} className="flex items-center gap-1">
    {editingRunId === run.id ? (
      // Rename inline input
      <div className="flex-1 flex items-center gap-1">
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename(run.id, (run.catalog_workflows as any)?.id ?? "");
            if (e.key === "Escape") setEditingRunId(null);
          }}
          className="h-7 text-sm flex-1"
          autoFocus
        />
        <button
          className="p-1 rounded hover:bg-accent text-primary"
          onClick={() => handleRename(run.id, (run.catalog_workflows as any)?.id ?? "")}
          disabled={isRenaming}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1 rounded hover:bg-accent text-muted-foreground"
          onClick={() => setEditingRunId(null)}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    ) : (
      <>
        <button
          className={cn(
            "flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left hover:bg-accent transition-colors",
            run.id === activeRunId && "bg-primary/10 text-primary font-medium"
          )}
          onClick={() => { setActiveRun(run.id); setOpen(false); }}
        >
          {run.id === activeRunId ? (
            <CheckCircle className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <Clock className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{runName(run)}</span>
          <Badge variant="outline" className="text-[10px] ml-auto shrink-0">
            {new Date(run.created_at).toLocaleDateString("pt-PT")}
          </Badge>
        </button>
        <button
          className="p-1 rounded hover:bg-accent text-muted-foreground shrink-0"
          title="Renomear"
          onClick={() => { setEditingRunId(run.id); setEditName(runName(run)); }}
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          className="p-1 rounded hover:bg-accent text-destructive shrink-0"
          title="Apagar"
          disabled={isDeleting === run.id}
          onClick={() => handleDelete(run.id, (run.catalog_workflows as any)?.id ?? "")}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </>
    )}
  </div>
))}
```

*(A query já foi actualizada no passo B3 — `catalog_workflows(id, workflow_name)` está disponível.)*

---

- [ ] **B6 — Verificar TypeScript e build**

```bash
npx tsc --noEmit
npm run build
```

Esperado: sem erros.

---

- [ ] **B7 — Commit Task B**

```bash
git add src/components/WorkflowRunSelector.tsx
git diff --stat HEAD
git commit -m "feat: add rename and delete to WorkflowRunSelector session list"
```

---

## Task C1 — Audit log: guardar workflow_run_id (1 commit)

**Files:**
- Modify: `supabase/functions/import-woocommerce/index.ts`

---

- [ ] **C1-1 — Localizar o insert no activity_log**

Linha ~618:
```typescript
      await supabase.from("activity_log").insert({
        user_id: userId,
        action: "upload" as const,
        workspace_id: workspaceId,
        details: {
          type: "woocommerce_import",
          imported: inserted,
          variations: variationsInserted,
          skipped,
          filters,
        },
      });
```

---

- [ ] **C1-2 — Adicionar `workflow_run_id` e `imported_at` ao details**

Substituir o bloco `details` por:

```typescript
        details: {
          type: "woocommerce_import",
          imported: inserted,
          variations: variationsInserted,
          skipped,
          filters,
          workflow_run_id: workflowRunId || null,
          imported_at: new Date().toISOString(),
        },
```

---

- [ ] **C1-3 — Verificar build**

```bash
npm run build
```

Esperado: sem erros.

---

- [ ] **C1-4 — Commit Task C1**

```bash
git add supabase/functions/import-woocommerce/index.ts
git diff --stat HEAD
git commit -m "feat: store workflow_run_id and imported_at in activity_log details"
```

---

## Task C2 — Painel de histórico de importações (1 commit)

**Files:**
- Create: `src/components/ImportHistoryPanel.tsx`
- Modify: `src/pages/WooImportPage.tsx`

---

- [ ] **C2-1 — Criar `src/components/ImportHistoryPanel.tsx`**

```typescript
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, ChevronDown, ChevronUp, Package, User, FolderOpen, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImportLogEntry {
  id: string;
  created_at: string;
  user_id: string;
  details: {
    type: string;
    imported: number;
    variations: number;
    skipped: number;
    filters: Record<string, string>;
    workflow_run_id?: string;
    imported_at?: string;
  };
}

async function resolveUserNames(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  try {
    const { data } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", userIds);
    return new Map((data ?? []).map((p) => [p.user_id, p.full_name || p.email || p.user_id]));
  } catch {
    return new Map();
  }
}

async function resolveSessionNames(runIds: string[]): Promise<Map<string, string>> {
  if (runIds.length === 0) return new Map();
  try {
    const { data } = await supabase
      .from("catalog_workflow_runs")
      .select("id, catalog_workflows(workflow_name)")
      .in("id", runIds);
    const map = new Map<string, string>();
    for (const r of data ?? []) {
      const name = (r.catalog_workflows as any)?.workflow_name;
      if (name) map.set(r.id, name);
    }
    return map;
  } catch {
    return new Map();
  }
}

export function ImportHistoryPanel() {
  const { activeWorkspace } = useWorkspaceContext();
  const [expanded, setExpanded] = useState(false);
  const [expandedFilters, setExpandedFilters] = useState<Set<string>>(new Set());

  const { data: logs, isLoading } = useQuery({
    queryKey: ["import-history", activeWorkspace?.id],
    enabled: expanded && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, created_at, user_id, details")
        .eq("workspace_id", activeWorkspace!.id)
        .eq("action", "upload")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;

      const entries = ((data ?? []) as any[]).filter(
        (l) => (l.details as any)?.type === "woocommerce_import"
      ) as ImportLogEntry[];

      // Resolve names in parallel with safe fallback
      const userIds = [...new Set(entries.map((e) => e.user_id).filter(Boolean))];
      const runIds = [...new Set(entries.map((e) => e.details?.workflow_run_id).filter(Boolean))] as string[];
      const [userMap, sessionMap] = await Promise.all([
        resolveUserNames(userIds),
        resolveSessionNames(runIds),
      ]);

      return entries.map((e) => ({
        ...e,
        _userName: userMap.get(e.user_id) || e.user_id || "—",
        _sessionName: e.details?.workflow_run_id
          ? (sessionMap.get(e.details.workflow_run_id) || e.details.workflow_run_id)
          : "—",
      }));
    },
  });

  const toggleFilter = (id: string) => {
    setExpandedFilters((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const hasFilters = (filters: Record<string, string>) =>
    Object.values(filters || {}).some((v) => v && v !== "all");

  return (
    <Card>
      <CardHeader
        className="pb-3 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="w-4 h-4" />
          Histórico de Importações
          <span className="ml-auto text-muted-foreground">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </CardTitle>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-2">
          {isLoading && (
            <p className="text-sm text-muted-foreground">A carregar histórico...</p>
          )}
          {!isLoading && (!logs || logs.length === 0) && (
            <p className="text-sm text-muted-foreground">Nenhuma importação registada.</p>
          )}
          {logs?.map((entry: any) => (
            <div key={entry.id} className="rounded-md border p-3 space-y-1.5 text-sm">
              <div className="flex flex-wrap gap-3 items-center">
                <span className="text-xs text-muted-foreground">
                  {new Date(entry.created_at).toLocaleString("pt-PT")}
                </span>
                <div className="flex items-center gap-1 text-xs">
                  <User className="w-3 h-3 text-muted-foreground" />
                  <span>{entry._userName}</span>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  <FolderOpen className="w-3 h-3 text-muted-foreground" />
                  <span>{entry._sessionName}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="text-xs gap-1">
                  <Package className="w-3 h-3" />
                  {entry.details.imported} importados
                </Badge>
                {entry.details.variations > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {entry.details.variations} variações
                  </Badge>
                )}
                {entry.details.skipped > 0 && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    {entry.details.skipped} ignorados
                  </Badge>
                )}
              </div>
              {hasFilters(entry.details.filters) && (
                <div>
                  <button
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => toggleFilter(entry.id)}
                  >
                    <Filter className="w-3 h-3" />
                    {expandedFilters.has(entry.id) ? "Ocultar filtros" : "Ver filtros"}
                  </button>
                  {expandedFilters.has(entry.id) && (
                    <div className="mt-1 text-xs text-muted-foreground pl-4 space-y-0.5">
                      {Object.entries(entry.details.filters)
                        .filter(([, v]) => v && v !== "all")
                        .map(([k, v]) => (
                          <div key={k}><strong>{k}:</strong> {String(v)}</div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
```

---

- [ ] **C2-2 — Integrar `ImportHistoryPanel` em `WooImportPage`**

Em `src/pages/WooImportPage.tsx`:

Adicionar import:
```typescript
import { ImportHistoryPanel } from "@/components/ImportHistoryPanel";
```

Localizar o final do JSX (antes do `<SessionRequiredDialog ...>`), após o resultado de import, adicionar:

```tsx
      <ImportHistoryPanel />
```

---

- [ ] **C2-3 — Verificar TypeScript e build**

```bash
npx tsc --noEmit
npm run build
```

Esperado: sem erros.

---

- [ ] **C2-4 — Commit Task C2**

```bash
git add src/components/ImportHistoryPanel.tsx src/pages/WooImportPage.tsx
git diff --stat HEAD
git commit -m "feat: add import history panel to WooImportPage with user/session resolution"
```

---

## Verificação final

- [ ] `npm run build` → sem erros
- [ ] `git log --oneline -6` → 4 commits + 2 docs + commits anteriores
- [ ] Smoke test manual:
  - Exportar produtos → Excel tem colunas WooCommerce ID, Marca, EAN, Modelo, Categorias Secundárias, Estado WooCommerce, Focus Keyword, Importado em, Importado por, Sessão
  - EAN e Modelo não aparecem em "Outros Atributos"
  - Renomear sessão no banner → nome actualiza sem reload
  - Apagar sessão → confirmação aparece → sessão desaparece da lista
  - Abrir histórico em WooImportPage → lista importações com data, utilizador, sessão
