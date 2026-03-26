import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const EVENT_NAME = "woo-active-run-changed";

interface ActiveRunEvent {
  /** Workspace that owns this session change — listeners MUST check this. */
  workspaceId: string;
  /** Full localStorage key, e.g. "active_workflow_run_id_<wsId>". */
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

  // Listen for changes dispatched by other hook instances.
  // STRICT workspace isolation: only update if the event's workspaceId matches
  // this instance's workspaceId. Events from other workspaces are always ignored.
  useEffect(() => {
    if (!lsKey || !workspaceId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ActiveRunEvent>).detail;
      if (detail.workspaceId === workspaceId && detail.key === lsKey) {
        setActiveRunIdState(detail.runId);
      }
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, [lsKey, workspaceId]);

  const setActiveRun = useCallback(
    (runId: string) => {
      if (!lsKey || !workspaceId) return;
      localStorage.setItem(lsKey, runId);
      setActiveRunIdState(runId);
      window.dispatchEvent(
        new CustomEvent<ActiveRunEvent>(EVENT_NAME, {
          detail: { workspaceId, key: lsKey, runId },
        })
      );
    },
    [lsKey, workspaceId]
  );

  const clearActiveRun = useCallback(() => {
    if (!lsKey || !workspaceId) return;
    localStorage.removeItem(lsKey);
    setActiveRunIdState(null);
    window.dispatchEvent(
      new CustomEvent<ActiveRunEvent>(EVENT_NAME, {
        detail: { workspaceId, key: lsKey, runId: null },
      })
    );
  }, [lsKey, workspaceId]);

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
