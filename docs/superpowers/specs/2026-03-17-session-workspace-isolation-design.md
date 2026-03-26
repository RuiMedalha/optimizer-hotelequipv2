# Design: Session/Workspace Isolation

**Date:** 2026-03-17
**Status:** Approved
**Scope:** Frontend only — no backend, no edge functions, no DB changes

---

## Problem

`useActiveWorkflowRun` stores the active session ID under a single global localStorage key (`active_workflow_run_id`), with no awareness of which workspace is active. When the user switches workspace, the previous session ID remains active in memory and in localStorage, causing imports and uploads to be tagged with a session that belongs to a different workspace.

---

## Goal

1. Sessions are always scoped to a workspace — no cross-workspace leakage
2. Switching workspace clears the active session in memory
3. The user must explicitly select or create a session after switching workspace
4. Per-workspace localStorage key is written on session creation, for future evolution
5. No automatic session restoration or creation when switching workspaces

---

## Architecture

### What changes

| File | Change |
|---|---|
| `src/hooks/useActiveWorkflowRun.ts` | Accept `workspaceId` param, derive per-workspace key, `useRef`+`useEffect` reset |
| `src/components/WorkflowRunSelector.tsx` | Pass `activeWorkspace?.id` to hook (1 line) |
| `src/components/WorkflowSessionBanner.tsx` | Pass `activeWorkspace?.id` to hook (1 line) |
| `src/components/SessionBadge.tsx` | Add `useWorkspaceContext` import + pass `activeWorkspace?.id` to hook (2 lines) |
| `src/pages/WooImportPage.tsx` | Pass `activeWorkspace?.id` to hook (1 line) |
| `src/pages/UploadPage.tsx` | Pass `activeWorkspace?.id` to hook (1 line) |

**Note on `SessionBadge.tsx`:** Unlike the other four consumers, `SessionBadge` does not currently import `useWorkspaceContext`. It requires both a new import line and an updated hook call — two lines changed, not one.

### What does NOT change

- `src/hooks/useWorkspaces.tsx` — no coupling between WorkspaceProvider and session logic
- `src/components/SessionRequiredDialog.tsx` — props-based, no hook usage
- All edge functions, DB schema, `types.ts`

---

## Hook Design: `useActiveWorkflowRun(workspaceId?: string)`

### localStorage key strategy

```
active_workflow_run_id_${workspaceId}   // per-workspace key (new)
active_workflow_run_id                  // old global key — becomes orphaned, never read again
```

The old global key `active_workflow_run_id` is not migrated or deleted. It becomes unreachable orphaned data in localStorage — harmless, and not worth the complexity of a one-time migration.

When `workspaceId` is `undefined` (workspace not yet loaded), `lsKey` is `null` and `activeRunId` returns `null` — safe for loading states.

### Initial state (mount only)

```typescript
const lsKey = workspaceId ? `active_workflow_run_id_${workspaceId}` : null;

const [activeRunId, setActiveRunIdState] = useState<string | null>(() =>
  lsKey ? localStorage.getItem(lsKey) : null
);
```

The lazy initializer reads the per-workspace key once on mount. This safely restores the session after a page refresh (the user was already in that workspace). It does NOT run again on workspace change.

### Reset on workspace change

```typescript
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
```

`useRef` tracks the previous `workspaceId`. The effect only clears the session when a **real workspace change** occurs (not on the first render). No automatic restoration — `null` forces the user to select or create a session manually.

**Important:** The reset path calls `setActiveRunIdState(null)` directly — it does NOT call `clearActiveRun`. This avoids the ordering hazard described below.

### `setActiveRun` and `clearActiveRun`

Both depend on `lsKey` which is recomputed from `workspaceId` on every render. Since `lsKey` changes when `workspaceId` changes, both callbacks are recreated on workspace switch. This is safe because `clearActiveRun` and `setActiveRun` are only ever called by **explicit user interaction** (button clicks), never programmatically during the workspace-change render cycle. By the time a user can interact, `lsKey` always reflects the current workspace.

```typescript
const setActiveRun = useCallback((runId: string) => {
  if (!lsKey) return;
  localStorage.setItem(lsKey, runId);
  setActiveRunIdState(runId);
}, [lsKey]);

const clearActiveRun = useCallback(() => {
  if (!lsKey) return;
  localStorage.removeItem(lsKey);
  setActiveRunIdState(null);
}, [lsKey]);
```

### `createNewSession`

No logic changes. Already receives `workspaceId` as a parameter and calls `setActiveRun` internally, which now writes to the correct per-workspace key.

### Return shape — unchanged

```typescript
return { activeRunId, setActiveRun, clearActiveRun, createNewSession };
```

---

## Workspace change behaviour

| Situation | Result |
|---|---|
| Page refresh in workspace A | Session restored from `active_workflow_run_id_${A}` via `useState` initializer |
| Workspace changes A → B | `activeRunId` set to `null` — always, regardless of what is stored for B |
| `workspaceId` is `undefined` (loading) | `activeRunId` is `null` — safe |
| User creates/selects session in B | Written to `active_workflow_run_id_${B}` — persisted for future use |

---

## Call Sites

### Uniform pattern

All consumers call the hook with `activeWorkspace?.id`:

```typescript
const { activeWorkspace } = useWorkspaceContext();
const { activeRunId, ... } = useActiveWorkflowRun(activeWorkspace?.id);
```

`WorkflowRunSelector`, `WorkflowSessionBanner`, `WooImportPage`, and `UploadPage` already import `useWorkspaceContext` — only their hook call line changes. `SessionBadge` requires an additional import line.

### Double-instantiation: `WorkflowSessionBanner` + `WorkflowRunSelector`

`WorkflowSessionBanner` renders `WorkflowRunSelector` as a child and also calls `useActiveWorkflowRun` independently for its own display logic (session name, status badges). This means two separate hook instances exist simultaneously.

Both instances:
- Derive `lsKey` from the same `workspaceId`
- Have independent `prevWorkspaceId` refs and `useState` values
- Fire their `useEffect` in the same React render batch when workspace changes
- Both set `activeRunId` to `null` in the same batch

There is no observable divergence — both instances reach `null` in the same render cycle. The two-instance pattern is intentional: the Banner owns display, the Selector owns interaction.

---

## React Query

No manual invalidation required. All queries gated by `enabled: !!activeRunId` automatically deactivate when `activeRunId` becomes `null` after a workspace change. Stale cache entries from the previous session become inert and are replaced naturally when the user selects a new session.

---

## Out of Scope

- Auto-creating a session when none exists
- Auto-resuming the last session of a workspace
- UI changes beyond what is already in place
- Backend, edge functions, DB schema
- Migration of old `active_workflow_run_id` localStorage key

---

## Success Criteria

1. Switching workspace sets `activeRunId` to `null` in all consuming components
2. The import button in `WooImportPage` and process button in `UploadPage` become disabled immediately after workspace switch
3. Page refresh in workspace A restores the session that was active before the refresh
4. A session created in workspace B is stored under `active_workflow_run_id_${B}` and not visible when workspace A is active
5. No changes required to `useWorkspaces.tsx` or any backend file
6. `SessionBadge` requires both a new import and an updated hook call (2 lines, not 1)
