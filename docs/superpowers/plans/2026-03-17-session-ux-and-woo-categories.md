# Session UX Fixes & WooCommerce Category Paths — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir três bugs de session/UX em `WooImportPage` e guardar paths completos de todas as categorias WooCommerce no produto importado.

**Architecture:** Task A é inteiramente frontend (hook + 3 componentes). O fix de cross-instance sync usa um `CustomEvent` no `window`. Task B é uma alteração cirúrgica à edge function `import-woocommerce`, apenas dentro de `normalizeWooProduct`. Commits separados.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, Deno (edge function), sonner (toast), TanStack React Query v5.

---

## Contexto para o implementador

### Ficheiros chave a ler antes de começar

- `src/hooks/useActiveWorkflowRun.ts` — hook de sessão activa (per-workspace localStorage key)
- `src/components/SessionRequiredDialog.tsx` — diálogo que abre quando não há sessão
- `src/components/WorkflowRunSelector.tsx` — selector de sessão no banner; reutilizar o seu padrão de query
- `src/pages/WooImportPage.tsx` — página de import WooCommerce
- `src/components/WorkflowSessionBanner.tsx` — banner de sessão no topo das páginas de dados
- `src/hooks/useActiveWorkflowRun.test.ts` — testes existentes do hook
- `supabase/functions/import-woocommerce/index.ts` — edge function de import

### Convenções do projecto

- `cn()` de `src/lib/utils.ts` para classes Tailwind condicionais
- `toast` de `sonner` para notificações
- React Query: `useQuery({ queryKey, enabled, queryFn })` — sempre com `enabled` explícito
- `useWorkspaceContext()` de `src/hooks/useWorkspaces` para workspace activo
- Hooks seguem o padrão: declarar `useWorkspaceContext` **antes** de `useActiveWorkflowRun(activeWorkspace?.id)`

---

## Task A — Session/UX (commit único)

**Files:**
- Modify: `src/hooks/useActiveWorkflowRun.ts`
- Modify: `src/hooks/useActiveWorkflowRun.test.ts`
- Modify: `src/components/SessionRequiredDialog.tsx`
- Modify: `src/pages/WooImportPage.tsx`
- Modify: `src/components/WorkflowSessionBanner.tsx`

---

### Step A1 — Escrever testes falhantes para o custom event sync

Adicionar ao final de `src/hooks/useActiveWorkflowRun.test.ts` os seguintes testes:

```typescript
describe("cross-instance sync via custom event", () => {
  it("setActiveRun numa instância actualiza outra instância com o mesmo workspaceId", async () => {
    const workspaceId = "ws-sync-test";
    const { result: r1 } = renderHook(() => useActiveWorkflowRun(workspaceId));
    const { result: r2 } = renderHook(() => useActiveWorkflowRun(workspaceId));

    await act(async () => {
      r1.current.setActiveRun("run-abc");
    });

    expect(r2.current.activeRunId).toBe("run-abc");
  });

  it("clearActiveRun numa instância actualiza outra instância", async () => {
    const workspaceId = "ws-sync-clear";
    localStorage.setItem(`active_workflow_run_id_${workspaceId}`, "run-xyz");

    const { result: r1 } = renderHook(() => useActiveWorkflowRun(workspaceId));
    const { result: r2 } = renderHook(() => useActiveWorkflowRun(workspaceId));

    await act(async () => {
      r1.current.clearActiveRun();
    });

    expect(r2.current.activeRunId).toBeNull();
  });

  it("evento de workspace diferente não actualiza instância", async () => {
    localStorage.setItem("active_workflow_run_id_ws-A", "run-A");
    const { result: rA } = renderHook(() => useActiveWorkflowRun("ws-A"));
    const { result: rB } = renderHook(() => useActiveWorkflowRun("ws-B"));

    await act(async () => {
      rA.current.setActiveRun("run-A-new");
    });

    expect(rB.current.activeRunId).toBeNull();
  });

  it("listener é removido ao unmount (sem memory leak)", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useActiveWorkflowRun("ws-leak"));
    unmount();

    expect(addSpy).toHaveBeenCalledWith("woo-active-run-changed", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("woo-active-run-changed", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
```

- [ ] **Escrever os 4 testes acima** no final do ficheiro `src/hooks/useActiveWorkflowRun.test.ts`

- [ ] **Verificar que falham**

```bash
npx vitest run src/hooks/useActiveWorkflowRun.test.ts
```

Esperado: os 4 novos testes FAIL, os 11 existentes PASS.

---

### Step A2 — Implementar custom event sync em `useActiveWorkflowRun`

Substituir o conteúdo de `src/hooks/useActiveWorkflowRun.ts` pelo seguinte:

```typescript
import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const EVENT_NAME = "woo-active-run-changed";

interface ActiveRunEvent {
  key: string;
  runId: string | null;
}

export function useActiveWorkflowRun(workspaceId?: string) {
  const lsKey = workspaceId ? `active_workflow_run_id_${workspaceId}` : null;

  const [activeRunId, setActiveRunIdState] = useState<string | null>(() =>
    lsKey ? localStorage.getItem(lsKey) : null
  );

  // Reset on real workspace change — never on first render
  const prevWorkspaceId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      prevWorkspaceId.current !== undefined &&
      prevWorkspaceId.current !== workspaceId
    ) {
      setActiveRunIdState(null);
    }
    prevWorkspaceId.current = workspaceId;
  }, [workspaceId]);

  // Listen for changes dispatched by other instances of this hook
  useEffect(() => {
    if (!lsKey) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ActiveRunEvent>).detail;
      if (detail.key === lsKey) {
        setActiveRunIdState(detail.runId);
      }
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, [lsKey]);

  const setActiveRun = useCallback(
    (runId: string) => {
      if (!lsKey) return;
      localStorage.setItem(lsKey, runId);
      setActiveRunIdState(runId);
      window.dispatchEvent(
        new CustomEvent<ActiveRunEvent>(EVENT_NAME, { detail: { key: lsKey, runId } })
      );
    },
    [lsKey]
  );

  const clearActiveRun = useCallback(() => {
    if (!lsKey) return;
    localStorage.removeItem(lsKey);
    setActiveRunIdState(null);
    window.dispatchEvent(
      new CustomEvent<ActiveRunEvent>(EVENT_NAME, { detail: { key: lsKey, runId: null } })
    );
  }, [lsKey]);

  const createNewSession = useCallback(
    async (name: string, wsId: string): Promise<string> => {
      const { data: workflow, error: wfErr } = await supabase
        .from("catalog_workflows")
        .insert({
          workspace_id: wsId,
          workflow_name: name,
          workflow_type: "supplier_import",
        } as any)
        .select("id")
        .single();
      if (wfErr) throw wfErr;

      const { data: run, error: runErr } = await supabase
        .from("catalog_workflow_runs")
        .insert({
          workspace_id: wsId,
          workflow_id: workflow.id,
          trigger_source: "manual",
          status: "running",
          started_at: new Date().toISOString(),
        } as any)
        .select("id")
        .single();
      if (runErr) throw runErr;

      setActiveRun(run.id);
      return run.id as string;
    },
    [setActiveRun]
  );

  return { activeRunId, setActiveRun, clearActiveRun, createNewSession };
}
```

- [ ] **Substituir o ficheiro** com o código acima

- [ ] **Verificar que os testes passam**

```bash
npx vitest run src/hooks/useActiveWorkflowRun.test.ts
```

Esperado: todos os 15 testes PASS.

---

### Step A3 — Actualizar `SessionRequiredDialog` com `workspaceId` + lista de sessões

O objectivo é que o diálogo:
1. Receba `workspaceId` como prop e passe-o ao hook
2. Mostre sessões existentes para seleccionar (mesmo padrão de query do `WorkflowRunSelector`)
3. Ao criar/seleccionar, feche o diálogo e o `activeRunId` propague via o evento do passo A2

Substituir `src/components/SessionRequiredDialog.tsx` por:

```typescript
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useActiveWorkflowRun } from "@/hooks/useActiveWorkflowRun";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FolderOpen, Plus, CheckCircle, Clock } from "lucide-react";

interface SessionRequiredDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId?: string;
}

export function SessionRequiredDialog({
  open,
  onOpenChange,
  workspaceId,
}: SessionRequiredDialogProps) {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = workspaceId ?? activeWorkspace?.id;

  const { activeRunId, setActiveRun, createNewSession } = useActiveWorkflowRun(wsId);
  const [newName, setNewName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Fetch recent sessions — same query as WorkflowRunSelector
  const { data: recentRuns } = useQuery({
    queryKey: ["workflow-runs-recent", wsId],
    enabled: open && !!wsId,
    queryFn: async () => {
      const { data } = await supabase
        .from("catalog_workflow_runs")
        .select("id, created_at, catalog_workflows(workflow_name)")
        .eq("workspace_id", wsId!)
        .in("status", ["running", "paused"])
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  const runName = (run: any) =>
    (run?.catalog_workflows as any)?.workflow_name ?? "Sessão sem nome";

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !wsId) return;
    setIsCreating(true);
    try {
      await createNewSession(name, wsId);
      toast.success(`Sessão "${name}" criada.`);
      setNewName("");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao criar sessão");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSelect = (runId: string) => {
    setActiveRun(runId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-primary" />
            Sessão de Trabalho Necessária
          </DialogTitle>
          <DialogDescription>
            Seleciona uma sessão existente ou cria uma nova para continuar. Os
            dados importados ficam organizados por sessão.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Existing sessions */}
          {recentRuns && recentRuns.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Sessões Activas
              </p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {recentRuns.map((run: any) => (
                  <button
                    key={run.id}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left hover:bg-accent transition-colors",
                      run.id === activeRunId && "bg-primary/10 text-primary font-medium"
                    )}
                    onClick={() => handleSelect(run.id)}
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
                ))}
              </div>
            </div>
          )}

          {/* Create new session */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Nova Sessão
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="Ex: TEFCOLD 2026"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="h-9"
              />
              <Button
                size="sm"
                className="h-9 px-4 shrink-0"
                disabled={!newName.trim() || isCreating || !wsId}
                onClick={handleCreate}
              >
                <Plus className="w-4 h-4 mr-1" />
                Criar
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Substituir o ficheiro** com o código acima

---

### Step A4 — Actualizar `WooImportPage`: remover `!activeRunId` do disabled + passar `workspaceId`

Duas alterações cirúrgicas em `src/pages/WooImportPage.tsx`:

**Alteração 1 — linha 297:** remover `!activeRunId` da condição `disabled`

Localizar:
```tsx
                  disabled={isImporting || !activeWorkspace || !activeRunId}
```
Substituir por:
```tsx
                  disabled={isImporting || !activeWorkspace}
```

**Alteração 2 — linha 367:** passar `workspaceId` ao `SessionRequiredDialog`

Localizar:
```tsx
      <SessionRequiredDialog open={sessionGuardOpen} onOpenChange={setSessionGuardOpen} />
```
Substituir por:
```tsx
      <SessionRequiredDialog open={sessionGuardOpen} onOpenChange={setSessionGuardOpen} workspaceId={activeWorkspace?.id} />
```

- [ ] **Aplicar as duas alterações** em `src/pages/WooImportPage.tsx`

---

### Step A5 — Adicionar toast de workspace change em `WorkflowSessionBanner`

Adicionar um `useEffect` no componente `WorkflowSessionBanner` que detecta mudança de workspace e mostra um toast.

Localizar em `src/components/WorkflowSessionBanner.tsx` as importações existentes:

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveWorkflowRun } from "@/hooks/useActiveWorkflowRun";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { WorkflowRunSelector } from "@/components/WorkflowRunSelector";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, FolderOpen } from "lucide-react";
```

Substituir por (adicionar `useEffect`, `useRef`, `toast`):

```typescript
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveWorkflowRun } from "@/hooks/useActiveWorkflowRun";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { WorkflowRunSelector } from "@/components/WorkflowRunSelector";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, FolderOpen } from "lucide-react";
import { toast } from "sonner";
```

Depois, dentro de `WorkflowSessionBanner`, **após** a linha `const { activeRunId } = useActiveWorkflowRun(activeWorkspace?.id);` e **antes** do `useQuery`, adicionar:

```typescript
  // Notify user when workspace changes so they know the session was cleared
  const prevWorkspaceId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      prevWorkspaceId.current !== undefined &&
      prevWorkspaceId.current !== activeWorkspace?.id
    ) {
      toast.info("Workspace alterado — sessão anterior limpa. Selecione ou crie uma nova sessão.", {
        duration: 5000,
      });
    }
    prevWorkspaceId.current = activeWorkspace?.id;
  }, [activeWorkspace?.id]);
```

- [ ] **Aplicar as alterações** em `src/components/WorkflowSessionBanner.tsx`

---

### Step A6 — Verificar compilação e testes

- [ ] **Verificar TypeScript**

```bash
npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Verificar testes do hook**

```bash
npx vitest run src/hooks/useActiveWorkflowRun.test.ts
```

Esperado: 15 testes PASS.

- [ ] **Verificar build**

```bash
npm run build
```

Esperado: sem erros.

---

### Step A7 — Commit Task A

```bash
git add src/hooks/useActiveWorkflowRun.ts \
        src/hooks/useActiveWorkflowRun.test.ts \
        src/components/SessionRequiredDialog.tsx \
        src/pages/WooImportPage.tsx \
        src/components/WorkflowSessionBanner.tsx

git diff --stat HEAD
```

```bash
git commit -m "fix: session cross-instance sync, SessionRequiredDialog UX and workspace-change toast

- useActiveWorkflowRun: dispatch/listen CustomEvent 'woo-active-run-changed' so all
  hook instances update when any instance calls setActiveRun/clearActiveRun
- SessionRequiredDialog: accept workspaceId prop, pass to hook (fixes lsKey=null bug),
  add existing-session list (same query pattern as WorkflowRunSelector)
- WooImportPage: remove !activeRunId from disabled so button is always clickable;
  pass workspaceId to SessionRequiredDialog
- WorkflowSessionBanner: toast when workspace changes to notify user session was cleared"
```

---

## Task B — Categorias WooCommerce: guardar `category_paths` (commit separado)

**Files:**
- Modify: `supabase/functions/import-woocommerce/index.ts`

---

### Step B1 — Localizar o bloco de categorias em `normalizeWooProduct`

Em `supabase/functions/import-woocommerce/index.ts`, localizar o bloco (linhas ~141-155):

```typescript
  // Categories — resolve full hierarchy via catMap
  const wooCats: Array<{ id: number; name: string; slug: string }> = wp.categories || [];
  let category: string | null = null;
  if (wooCats.length > 0 && catMap.size > 0) {
    // Build the full path for each assigned category, pick the deepest one as canonical
    const paths = wooCats
      .map((c) => resolveCategoryPath(c.id, catMap))
      .filter(Boolean);
    // Sort descending by number of segments — deepest path first
    paths.sort((a, b) => b.split(" > ").length - a.split(" > ").length);
    category = paths[0] || null;
  } else if (wooCats.length > 0) {
    // catMap not available (e.g. fetch failed) — fall back to flat names
    category = wooCats.map((c) => c.name).join(", ");
  }
```

- [ ] **Ler o bloco** para confirmar as linhas exactas antes de editar

---

### Step B2 — Guardar todos os `category_paths` em `source_confidence_profile`

Substituir o bloco acima por:

```typescript
  // Categories — resolve full hierarchy via catMap
  const wooCats: Array<{ id: number; name: string; slug: string }> = wp.categories || [];
  let category: string | null = null;
  let categoryPaths: string[] = [];
  if (wooCats.length > 0 && catMap.size > 0) {
    // Build the full path for each assigned category
    categoryPaths = wooCats
      .map((c) => resolveCategoryPath(c.id, catMap))
      .filter(Boolean);
    // Sort descending by number of segments — deepest path first
    categoryPaths.sort((a, b) => b.split(" > ").length - a.split(" > ").length);
    category = categoryPaths[0] || null;
  } else if (wooCats.length > 0) {
    // catMap not available (e.g. fetch failed) — fall back to flat names
    categoryPaths = wooCats.map((c) => c.name);
    category = categoryPaths.join(", ");
  }
```

E no bloco `sourceProfile` (linhas ~192-201), adicionar `category_paths` após `woo_categories`:

Localizar:
```typescript
    woo_categories: wooCats,
    meta_data: meta,
```

Substituir por:
```typescript
    woo_categories: wooCats,
    category_paths: categoryPaths.length > 0 ? categoryPaths : undefined,
    meta_data: meta,
```

- [ ] **Aplicar as duas alterações** em `supabase/functions/import-woocommerce/index.ts`

---

### Step B3 — Verificar

- [ ] **Verificar TypeScript da edge function** (Deno usa tipos compatíveis — verificar pelo menos que não há erros de sintaxe)

```bash
npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Verificar build**

```bash
npm run build
```

Esperado: sem erros.

---

### Step B4 — Commit Task B

```bash
git add supabase/functions/import-woocommerce/index.ts

git diff --stat HEAD
```

```bash
git commit -m "feat: store all resolved category paths in source_confidence_profile

normalizeWooProduct now computes full hierarchy paths for all assigned
WooCommerce categories and stores them in source_confidence_profile.category_paths.
Primary category field unchanged (deepest path). Fallback to flat names when
catMap is unavailable also stored in category_paths."
```

---

## Verificação final (ambas as tasks)

- [ ] `npx vitest run src/hooks/useActiveWorkflowRun.test.ts` → 15 PASS
- [ ] `npm run build` → sem erros
- [ ] `git log --oneline -4` → confirmar dois commits Task A e Task B
- [ ] Smoke test manual:
  - Abrir `WooImportPage` sem sessão → botão "Importar Produtos" clicável → abre diálogo com sessões existentes e opção de criar
  - Criar sessão no diálogo → diálogo fecha → badge no título actualiza → botão permanece clicável
  - Mudar workspace → toast aparece a informar que sessão foi limpa
  - Seleccionar sessão via `WorkflowRunSelector` no banner → `SessionBadge` actualiza sem reload
