# Session/Workspace Isolation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope the active workflow session to the current workspace so that switching workspace always clears the session, with per-workspace localStorage persistence.

**Architecture:** `useActiveWorkflowRun` gains a `workspaceId` parameter and derives a per-workspace localStorage key. A `useRef`+`useEffect` pair detects real workspace changes and resets `activeRunId` to `null`. All five consumers pass `activeWorkspace?.id` to the hook.

**Tech Stack:** React 18, TypeScript, Vitest + @testing-library/react (jsdom), localStorage (native in jsdom)

**Spec:** `docs/superpowers/specs/2026-03-17-session-workspace-isolation-design.md`

---

## File Map

| Action | File |
|---|---|
| Modify | `src/hooks/useActiveWorkflowRun.ts` |
| Create | `src/hooks/useActiveWorkflowRun.test.ts` |
| Modify | `src/components/WorkflowSessionBanner.tsx` |
| Modify | `src/components/WorkflowRunSelector.tsx` |
| Modify | `src/components/SessionBadge.tsx` |
| Modify | `src/pages/WooImportPage.tsx` |
| Modify | `src/pages/UploadPage.tsx` |

---

## Task 1: Test the hook before changing it

**Files:**
- Create: `src/hooks/useActiveWorkflowRun.test.ts`

- [ ] **Step 1: Create test file with failing tests**

```typescript
// src/hooks/useActiveWorkflowRun.test.ts
import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useActiveWorkflowRun } from "./useActiveWorkflowRun";

// Mock supabase — createNewSession calls it; we only test state side-effects
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: "run-abc" }, error: null }),
        }),
      }),
    }),
  },
}));

describe("useActiveWorkflowRun", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when no workspaceId is provided", () => {
    const { result } = renderHook(() => useActiveWorkflowRun(undefined));
    expect(result.current.activeRunId).toBeNull();
  });

  it("returns null when workspaceId provided but no entry in localStorage", () => {
    const { result } = renderHook(() => useActiveWorkflowRun("ws-1"));
    expect(result.current.activeRunId).toBeNull();
  });

  it("restores from per-workspace key on mount", () => {
    localStorage.setItem("active_workflow_run_id_ws-1", "run-123");
    const { result } = renderHook(() => useActiveWorkflowRun("ws-1"));
    expect(result.current.activeRunId).toBe("run-123");
  });

  it("does NOT read from a different workspace key", () => {
    localStorage.setItem("active_workflow_run_id_ws-2", "run-xyz");
    const { result } = renderHook(() => useActiveWorkflowRun("ws-1"));
    expect(result.current.activeRunId).toBeNull();
  });

  it("does NOT restore from old global key", () => {
    localStorage.setItem("active_workflow_run_id", "run-old");
    const { result } = renderHook(() => useActiveWorkflowRun("ws-1"));
    expect(result.current.activeRunId).toBeNull();
  });

  it("clears activeRunId when workspaceId changes", () => {
    localStorage.setItem("active_workflow_run_id_ws-1", "run-123");
    const { result, rerender } = renderHook(
      ({ wsId }) => useActiveWorkflowRun(wsId),
      { initialProps: { wsId: "ws-1" } }
    );
    expect(result.current.activeRunId).toBe("run-123");

    rerender({ wsId: "ws-2" });
    expect(result.current.activeRunId).toBeNull();
  });

  it("does NOT clear on first render (mount)", () => {
    localStorage.setItem("active_workflow_run_id_ws-1", "run-123");
    const { result } = renderHook(() => useActiveWorkflowRun("ws-1"));
    // After mount, session should still be present
    expect(result.current.activeRunId).toBe("run-123");
  });

  it("setActiveRun writes to per-workspace key and updates state", () => {
    const { result } = renderHook(() => useActiveWorkflowRun("ws-1"));
    act(() => { result.current.setActiveRun("run-999"); });
    expect(result.current.activeRunId).toBe("run-999");
    expect(localStorage.getItem("active_workflow_run_id_ws-1")).toBe("run-999");
  });

  it("clearActiveRun removes per-workspace key and sets state to null", () => {
    localStorage.setItem("active_workflow_run_id_ws-1", "run-123");
    const { result } = renderHook(() => useActiveWorkflowRun("ws-1"));
    act(() => { result.current.clearActiveRun(); });
    expect(result.current.activeRunId).toBeNull();
    expect(localStorage.getItem("active_workflow_run_id_ws-1")).toBeNull();
  });

  it("setActiveRun is a no-op when workspaceId is undefined", () => {
    const { result } = renderHook(() => useActiveWorkflowRun(undefined));
    act(() => { result.current.setActiveRun("run-999"); });
    expect(result.current.activeRunId).toBeNull();
    expect(localStorage.getItem("active_workflow_run_id_undefined")).toBeNull();
  });

  it("does NOT restore previous workspace session after switching back (no auto-resume)", () => {
    localStorage.setItem("active_workflow_run_id_ws-1", "run-123");
    const { result, rerender } = renderHook(
      ({ wsId }) => useActiveWorkflowRun(wsId),
      { initialProps: { wsId: "ws-1" } }
    );
    // Switch away
    rerender({ wsId: "ws-2" });
    expect(result.current.activeRunId).toBeNull();

    // Switch back — still null, no auto-resume
    rerender({ wsId: "ws-1" });
    expect(result.current.activeRunId).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect ALL to fail** (hook doesn't have `workspaceId` param yet)

```bash
npx vitest run src/hooks/useActiveWorkflowRun.test.ts
```

Expected: multiple FAIL — "Expected null, received string" or "Expected string, received null"

---

## Task 2: Rewrite the hook

**Files:**
- Modify: `src/hooks/useActiveWorkflowRun.ts`

- [ ] **Step 3: Replace hook implementation**

```typescript
import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

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

  const setActiveRun = useCallback(
    (runId: string) => {
      if (!lsKey) return;
      localStorage.setItem(lsKey, runId);
      setActiveRunIdState(runId);
    },
    [lsKey]
  );

  const clearActiveRun = useCallback(() => {
    if (!lsKey) return;
    localStorage.removeItem(lsKey);
    setActiveRunIdState(null);
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

- [ ] **Step 4: Run tests — expect ALL to pass**

```bash
npx vitest run src/hooks/useActiveWorkflowRun.test.ts
```

Expected: 11 PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useActiveWorkflowRun.ts src/hooks/useActiveWorkflowRun.test.ts
git commit -m "feat: scope useActiveWorkflowRun to workspace with per-workspace localStorage key"
```

---

## Task 3: Update the five call sites

**Files:**
- Modify: `src/components/WorkflowSessionBanner.tsx`
- Modify: `src/components/WorkflowRunSelector.tsx`
- Modify: `src/components/SessionBadge.tsx`
- Modify: `src/pages/WooImportPage.tsx`
- Modify: `src/pages/UploadPage.tsx`

These are mechanical 1–2 line changes per file. All changes follow the same pattern.

- [ ] **Step 6: Update `WorkflowSessionBanner.tsx`**

The current file has these two lines in this order (lines 10–11):
```typescript
const { activeRunId } = useActiveWorkflowRun();
const { activeWorkspace } = useWorkspaceContext();
```

`activeWorkspace` must be declared before it is passed to the hook.
Swap the order and update the hook call — replace both lines with:
```typescript
const { activeWorkspace } = useWorkspaceContext();
const { activeRunId } = useActiveWorkflowRun(activeWorkspace?.id);
```
`useWorkspaceContext` is already imported — no new import needed.

- [ ] **Step 7: Update `WorkflowRunSelector.tsx`**

The current file has these two lines in this order (lines 15–16):
```typescript
const { activeRunId, setActiveRun, createNewSession } = useActiveWorkflowRun();
const { activeWorkspace } = useWorkspaceContext();
```

`activeWorkspace` must be declared before it is passed to the hook.
Swap the order and update the hook call — replace both lines with:
```typescript
const { activeWorkspace } = useWorkspaceContext();
const { activeRunId, setActiveRun, createNewSession } = useActiveWorkflowRun(activeWorkspace?.id);
```
`useWorkspaceContext` is already imported — no new import needed.

- [ ] **Step 8: Update `SessionBadge.tsx`**

Add import (after the existing imports):
```typescript
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
```

Find the existing hook call (line ~8):
```typescript
const { activeRunId } = useActiveWorkflowRun();
```
Replace with (add line before, update hook call):
```typescript
const { activeWorkspace } = useWorkspaceContext();
const { activeRunId } = useActiveWorkflowRun(activeWorkspace?.id);
```

- [ ] **Step 9: Update `WooImportPage.tsx`**

Find the existing hook call (line ~20):
```typescript
const { activeRunId } = useActiveWorkflowRun();
```
Replace with:
```typescript
const { activeRunId } = useActiveWorkflowRun(activeWorkspace?.id);
```
`useWorkspaceContext` and `activeWorkspace` are already declared in this file — no new import needed.

- [ ] **Step 10: Update `UploadPage.tsx`**

Find the existing hook call:
```typescript
const { activeRunId } = useActiveWorkflowRun();
```
Replace with:
```typescript
const { activeRunId } = useActiveWorkflowRun(activeWorkspace?.id);
```
`useWorkspaceContext` and `activeWorkspace` are already declared in this file — no new import needed.

- [ ] **Step 11: Run full test suite to confirm no regressions**

```bash
npx vitest run
```

Expected: the 11 hook tests from Task 2 pass. Any pre-existing failures unrelated to this feature (i.e., failing before Step 3) are not a blocker — only new failures introduced by the call site changes matter.

- [ ] **Step 12: Commit call site changes**

```bash
git add src/components/WorkflowSessionBanner.tsx \
        src/components/WorkflowRunSelector.tsx \
        src/components/SessionBadge.tsx \
        src/pages/WooImportPage.tsx \
        src/pages/UploadPage.tsx
git commit -m "feat: pass workspaceId to useActiveWorkflowRun in all consumers"
```

---

## Task 4: Manual smoke test

No automated test can cover multi-component integration in this codebase (no React context test harness is set up). Do a quick manual check in the running app.

- [ ] **Step 13: Start dev server**

```bash
npm run dev
```

Open `http://localhost:8080`

- [ ] **Step 14: Verify reset on workspace switch**

1. Select or create a session in workspace A (use the WorkflowSessionBanner selector)
2. Confirm the session name appears in the banner and the `SessionBadge` in a page title
3. Switch to workspace B using the workspace selector
4. **Expected:** banner shows "Nenhuma sessão ativa", import/upload buttons are disabled
5. Switch back to workspace A
6. **Expected:** still no session — no auto-resume

- [ ] **Step 15: Verify per-workspace persistence**

1. In workspace A, create session "Sessão A"
2. In workspace B, create session "Sessão B"
3. Refresh the page (F5) while on workspace B
4. **Expected:** "Sessão B" is restored (same workspace, page refresh)
5. Switch to workspace A
6. **Expected:** session is cleared (workspace change)

- [ ] **Step 16: Verify old global key is not read**

Open browser DevTools → Application → Local Storage
Confirm: keys follow the pattern `active_workflow_run_id_<uuid>`, not the bare `active_workflow_run_id`

- [ ] **Step 17: Push**

```bash
git push origin main
```

---

## Success Criteria (from spec)

1. ✅ Switching workspace sets `activeRunId` to `null` in all consumers
2. ✅ Import and upload buttons become disabled immediately after workspace switch
3. ✅ Page refresh in workspace A restores the session active before the refresh
4. ✅ Session created in workspace B stored under `active_workflow_run_id_${B}`
5. ✅ No changes to `useWorkspaces.tsx` or any backend file
6. ✅ `SessionBadge` has 2 lines changed (import + hook call)
