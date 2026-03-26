# Excel Export, Session Management & Audit Trail — Design Spec

**Date:** 2026-03-18
**Status:** Approved

---

## Goal

Três tasks independentes:
- **A:** Enriquecer o export Excel com 10 colunas novas (campos críticos como EAN/Marca/Modelo separados, paths de categoria, auditoria básica)
- **B:** Rename e delete de sessões no `WorkflowRunSelector`
- **C:** Ligar `workflow_run_id` ao `activity_log` + painel de histórico de importações

---

## Task A — Excel Export: colunas novas

### Ficheiro único: `src/hooks/useExportProducts.ts`

### Colunas a adicionar

| Coluna Excel | Fonte | Lógica |
|---|---|---|
| `WooCommerce ID` | `p.woocommerce_id` | directo |
| `Marca` | `p.supplier_ref` | directo (renomear "Ref. Fornecedor") |
| `EAN` | `p.attributes` | matching robusto por nome (ver abaixo) |
| `Modelo` | `p.attributes` | matching robusto por nome (ver abaixo) |
| `Estado WooCommerce` | `source_confidence_profile.woo_status` | `(p.source_confidence_profile as any)?.woo_status ?? ""` |
| `Categorias Secundárias` | `source_confidence_profile.category_paths` | paths[1..] join " \| " (exclui o primeiro = categoria principal) |
| `Focus Keyword` | `p.focus_keyword` | `(p.focus_keyword ?? []).join(", ")` |
| `Importado em` | `p.created_at` | `new Date(p.created_at).toLocaleDateString("pt-PT")` |
| `Importado por` | `p.user_id` + lookup | `profiles.full_name ?? profiles.email ?? p.user_id` |
| `Sessão` | `p.workflow_run_id` + lookup | `workflow_name ?? p.workflow_run_id ?? ""` |

### Matching robusto para EAN e Modelo

```typescript
const EAN_ATTR_NAMES = new Set(["ean", "gtin", "barcode", "código de barras", "codigo de barras"]);
const MODELO_ATTR_NAMES = new Set(["modelo", "model", "ref", "referência", "referencia"]);

function extractAttrValue(attrs: any[], nameSet: Set<string>): string {
  const found = (attrs || []).find((a: any) =>
    nameSet.has((a.name ?? "").toLowerCase().trim())
  );
  return found?.value || found?.values?.[0] || "";
}
```

### Coluna "Atributos" existente

Filtrar EAN e Modelo para evitar duplicação:
```typescript
const OTHER_ATTR_NAMES = new Set([...EAN_ATTR_NAMES, ...MODELO_ATTR_NAMES]);
// no mapeamento de "attributes":
val.filter((a: any) => !OTHER_ATTR_NAMES.has((a.name ?? "").toLowerCase().trim()))
```

### Lookups assíncronos — regras de segurança

1. **Nunca falham:** envolvidos em `try/catch`; em caso de erro retornam maps vazios
2. **Fallback sempre presente:** se user_id não encontrado → mostrar `p.user_id`; se workflow_run_id não encontrado → mostrar `p.workflow_run_id ?? ""`
3. **Apenas chamados quando necessário:** se não há `user_id` nem `workflow_run_id` nos produtos, não fazer queries
4. **Batch único:** um único `SELECT * FROM profiles WHERE user_id IN (...)` + um único `SELECT ... FROM catalog_workflow_runs JOIN catalog_workflows WHERE id IN (...)`

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

### `productToRow` — nova assinatura

```typescript
function productToRow(
  p: Product,
  skuPrefix?: string,
  lookups?: { users: Map<string, string>; sessions: Map<string, string> }
): Record<string, unknown>
```

### `exportProductsToExcel` (síncrona, produtos já em memória)

Torna-se assíncrona para suportar os lookups. Mantém a mesma interface pública excepto que devolve `Promise<void>`.

---

## Task B — Sessões: rename e delete

### Ficheiros: `src/components/WorkflowRunSelector.tsx` + `src/hooks/useActiveWorkflowRun.ts`

### Rename

- Trigger: ícone de edição (pencil) inline em cada sessão na lista
- Input inline (mesmo padrão do campo "Nova Sessão")
- Acção:
  ```ts
  // Obter workflow_id a partir do run
  const { data: run } = await supabase
    .from("catalog_workflow_runs")
    .select("workflow_id")
    .eq("id", runId)
    .single();

  await supabase
    .from("catalog_workflows")
    .update({ workflow_name: newName })
    .eq("id", run.workflow_id);
  ```
- Após sucesso: `queryClient.invalidateQueries({ queryKey: ["workflow-runs-recent"] })` + `queryClient.invalidateQueries({ queryKey: ["workflow-run-detail"] })`

### Delete

- Trigger: ícone de apagar (trash) com `window.confirm()` simples
- **ANTES da implementação:** verificar se `products.workflow_run_id` tem `ON DELETE SET NULL`
  - Se sim: apagar o run directamente; os produtos ficam com `workflow_run_id = NULL`
  - Se não: primeiro `UPDATE products SET workflow_run_id = NULL WHERE workflow_run_id = runId`, depois apagar run + workflow
- Se a sessão apagada for a sessão activa → chamar `clearActiveRun()`
- Acção segura (ambos os casos):
  ```ts
  // Sempre: garantir NULL nos produtos antes de apagar
  await supabase
    .from("products")
    .update({ workflow_run_id: null })
    .eq("workflow_run_id", runId);

  // Obter workflow_id
  const { data: run } = await supabase
    .from("catalog_workflow_runs")
    .select("workflow_id")
    .eq("id", runId)
    .single();

  await supabase.from("catalog_workflow_runs").delete().eq("id", runId);
  await supabase.from("catalog_workflows").delete().eq("id", run.workflow_id);
  ```

**Nota:** A estratégia de sempre fazer NULL nos produtos antes de apagar é segura independentemente do tipo de FK. Remove a dependência da verificação de BD.

### Onde fica a UI

Dentro da lista de sessões no `WorkflowRunSelector.tsx` (popover existente). Cada linha de sessão recente recebe dois ícones discretos: `Pencil` (rename) e `Trash2` (delete).

---

## Task C — Auditoria

### C1 — Guardar `workflow_run_id` no `activity_log.details`

**Ficheiro:** `supabase/functions/import-woocommerce/index.ts`

Adicionar ao `details` do `activity_log.insert`:
```ts
details: {
  type: "woocommerce_import",
  imported: inserted,
  variations: variationsInserted,
  skipped,
  filters,
  workflow_run_id: workflowRunId || null,  // ← novo
  imported_at: new Date().toISOString(),   // ← novo
},
```

Zero migração de BD. `details` é `Json | null`.

### C2 — Painel de histórico de importações

**Ficheiro a criar:** `src/components/ImportHistoryPanel.tsx`

Query:
```ts
supabase
  .from("activity_log")
  .select("id, created_at, user_id, details")
  .eq("workspace_id", workspaceId)
  .eq("action", "upload")
  .order("created_at", { ascending: false })
  .limit(20)
```

Filtro no frontend: `details->>'type' === 'woocommerce_import'` (o `action` já é "upload" mas pode haver uploads de ficheiro — filtrar pelo `type` no detalhe).

Cada linha mostra:
- Data e hora (formatted pt-PT)
- Utilizador (`profiles.full_name || email` via lookup por `user_id`)
- Sessão (via `details.workflow_run_id` → lookup `catalog_workflow_runs`)
- Produtos importados (`details.imported`)
- Variações (`details.variations`)
- Ignorados (`details.skipped`)
- Filtros usados (`details.filters` — colapsável)

**Integração:** secção colapsável dentro de `WooImportPage.tsx`, sob o resultado de import.

---

## Ficheiros a alterar por task

| Task | Ficheiro | Acção |
|---|---|---|
| A | `src/hooks/useExportProducts.ts` | Modificar |
| B | `src/components/WorkflowRunSelector.tsx` | Modificar |
| C1 | `supabase/functions/import-woocommerce/index.ts` | Modificar (2 linhas) |
| C2 | `src/components/ImportHistoryPanel.tsx` | Criar |
| C2 | `src/pages/WooImportPage.tsx` | Modificar (adicionar painel) |

---

## Riscos

| Risco | Mitigação |
|---|---|
| Lookup users/sessions falha → export incompleto | `try/catch` com Map vazio; fallback para UUID bruto |
| category_paths vazio ou undefined | `?? []` + `slice(1)` seguro em array vazio |
| Delete de sessão com FK desconhecida | Sempre fazer NULL nos produtos antes de apagar |
| Rename de sessão activa | Apenas invalida query cache; `activeRunId` mantém-se |
| `activity_log` não tem FK para `workflow_run_id` | Guardado como string em JSON — sem restrição referencial |

---

## Ordem de implementação recomendada

```
Task A → Task C1 → Task B → Task C2
```

Commits separados por task. Task C1 antes de C2 para garantir dados correctos.
