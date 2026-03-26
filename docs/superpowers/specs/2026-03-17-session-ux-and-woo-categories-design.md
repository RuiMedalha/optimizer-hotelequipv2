# Session UX Fixes & WooCommerce Category Paths — Design Spec

**Date:** 2026-03-17
**Status:** Approved

---

## Goal

Fix three session/UX bugs in `WooImportPage` and add complete category-path storage to the WooCommerce import edge function.

---

## Problem A — Session / UX

### A1 — `SessionRequiredDialog` sem `workspaceId`

`SessionRequiredDialog` chama `useActiveWorkflowRun()` **sem** `workspaceId`.
`lsKey = null` → `setActiveRun` faz `if (!lsKey) return` → sessão criada na BD mas **nunca escrita no localStorage** → a instância de `useActiveWorkflowRun(activeWorkspace?.id)` em `WooImportPage` nunca actualiza → botão continua desactivado.

**Fix:** `SessionRequiredDialog` aceita prop `workspaceId?: string` e passa-a ao hook.

### A2 — Estado isolado por instância (cross-instance sync)

Cada componente tem a sua própria instância de `useActiveWorkflowRun`. O `useState` inicializa a partir do localStorage apenas no mount. Quando `WorkflowRunSelector.setActiveRun()` escreve no localStorage, as outras instâncias (`WorkflowSessionBanner`, `SessionBadge`, `WooImportPage`) **não recebem o novo valor**.

**Fix:** Adicionar ao hook um `window.dispatchEvent(CustomEvent)` ao escrever e um `addEventListener` ao montar. Todas as instâncias ouvem e actualizam o seu estado. O listener faz cleanup no unmount.

### A3 — Botão desactivado impede abrir o diálogo

O botão "Importar Produtos" tem `disabled={... || !activeRunId}`. O `handleImport` já verifica `!activeRunId` e abriria o `SessionRequiredDialog` — mas esse código nunca é atingido porque o botão está desactivado. O utilizador vê um botão cinzento sem caminho claro para criar sessão.

**Fix:** Remover `!activeRunId` do `disabled`. O botão fica sempre clicável (desde que workspace exista); `handleImport` abre o diálogo quando não há sessão.

Adicionar ao `SessionRequiredDialog` a lista de sessões existentes (pattern de `WorkflowRunSelector`) para o utilizador poder **seleccionar** OU **criar** sessão — mesma query `catalog_workflow_runs`, mesmo shape de dados.

### A4 — Sem notificação ao mudar workspace

Ao mudar de workspace, a sessão limpa silenciosamente.

**Fix:** Em `WorkflowSessionBanner`, adicionar um `useEffect` com `useRef` para detectar mudança de `activeWorkspace?.id`. Quando muda de um valor para outro, mostrar `toast.info(...)` a informar o utilizador.
O toast deve disparar apenas neste componente (que está sempre visível nas rotas de sessão), para evitar toasts duplicados.

---

## Problem B — Categorias WooCommerce: paths secundários

### Situação actual

- `resolveCategoryPath()` — correcto (walk `parent → 0`, proteção contra ciclos).
- Selecção do "caminho mais profundo" como `category` principal — correcto.
- `source_confidence_profile.woo_categories` guarda `[{id, name, slug}]` em bruto **sem paths resolvidos**.
- Quando um produto tem múltiplas categorias, só o path da categoria principal fica resolvido. Os paths das categorias secundárias são descartados.

### Fix

Dentro de `normalizeWooProduct`, calcular **todos** os paths resolvidos e guardá-los em:

```json
source_confidence_profile.category_paths: ["Mobiliário > Cadeiras > Cadeiras de Escritório", "Promoções > Verão"]
```

- Sem migração de BD (campo JSONB `source_confidence_profile`).
- `category` (principal) mantém-se como está.
- `category_paths` inclui **todos** os paths, incluindo o principal.
- A alteração é cirúrgica: apenas dentro de `normalizeWooProduct`, no bloco de categorias.

---

## Ficheiros a Alterar

### Task A — Session/UX

| Ficheiro | Tipo | Alteração |
|---|---|---|
| `src/hooks/useActiveWorkflowRun.ts` | Modify | +custom event dispatch em `setActiveRun`/`clearActiveRun`; +`useEffect` listener para sync cross-instância |
| `src/components/SessionRequiredDialog.tsx` | Modify | +prop `workspaceId`; +lista de sessões existentes (reutiliza query pattern do `WorkflowRunSelector`) |
| `src/pages/WooImportPage.tsx` | Modify | Remover `!activeRunId` do `disabled`; passar `workspaceId` ao `SessionRequiredDialog` |
| `src/components/WorkflowSessionBanner.tsx` | Modify | +`useEffect` com toast ao detectar mudança de workspace |
| `src/hooks/useActiveWorkflowRun.test.ts` | Modify | +testes para custom event sync |

### Task B — Categorias/Import

| Ficheiro | Tipo | Alteração |
|---|---|---|
| `supabase/functions/import-woocommerce/index.ts` | Modify | Em `normalizeWooProduct`: guardar `category_paths: string[]` em `source_confidence_profile` |

---

## Constraints

- Não alterar edge functions fora do âmbito (apenas `import-woocommerce`).
- Não refactor global de componentes.
- Não alterar o shape do campo `category` (mantém path principal como string).
- `SessionRequiredDialog`: reutilizar a mesma query e shape de dados do `WorkflowRunSelector`, não duplicar lógica.
- O custom event deve usar um nome estável: `'woo-active-run-changed'`.

---

## Testes

### Task A
- `useActiveWorkflowRun.test.ts`: verificar que `setActiveRun` numa instância dispara actualizações noutras instâncias via evento.
- `useActiveWorkflowRun.test.ts`: verificar que o listener faz cleanup ao unmount.

### Task B
- Teste unitário ou verificação manual: produto com 2 categorias → `source_confidence_profile.category_paths` tem ambos os paths resolvidos.

---

## Riscos

| Risco | Mitigação |
|---|---|
| Listener em componente desmontado → warning React | Cleanup do event listener no return do `useEffect` |
| Toast duplicado ao mudar workspace (múltiplos banners) | `WorkflowSessionBanner` só está presente uma vez no layout (`AppLayout.tsx:63`) |
| `SessionRequiredDialog` com query desnecessária | `enabled: !!open && !!workspaceId` |
