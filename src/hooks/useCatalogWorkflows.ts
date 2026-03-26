import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function useCatalogWorkflows() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();
  const wid = activeWorkspace?.id;

  const workflows = useQuery({
    queryKey: ["catalog-workflows", wid],
    enabled: !!wid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_workflows")
        .select("*")
        .eq("workspace_id", wid!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const runs = useQuery({
    queryKey: ["catalog-workflow-runs", wid],
    enabled: !!wid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_workflow_runs")
        .select("*, catalog_workflows(workflow_name, workflow_type)")
        .eq("workspace_id", wid!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const getRunSteps = (runId: string) =>
    supabase
      .from("catalog_workflow_steps")
      .select("*")
      .eq("workflow_run_id", runId)
      .order("step_order");

  const getHandoffs = (runId: string) =>
    supabase
      .from("workflow_handoffs")
      .select("*")
      .eq("workflow_run_id", runId)
      .order("created_at");

  const inv = (fn: string, body: Record<string, unknown>) =>
    invokeEdgeFunction(fn, { body: { workspace_id: wid, ...body } });

  const startWorkflow = useMutation({
    mutationFn: async (p: { workflow_id: string; supplier_id?: string }) => {
      return await inv("start-catalog-workflow", p);
    },
    onSuccess: () => {
      toast.success("Workflow iniciado");
      qc.invalidateQueries({ queryKey: ["catalog-workflow-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const executeStep = useMutation({
    mutationFn: async (p: { step_id: string; run_id: string }) => {
      return await inv("execute-workflow-step", p);
    },
    onSuccess: () => {
      toast.success("Passo executado");
      qc.invalidateQueries({ queryKey: ["catalog-workflow-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pauseRun = useMutation({
    mutationFn: async (run_id: string) => {
      return await inv("pause-workflow-run", { run_id });
    },
    onSuccess: () => {
      toast.success("Workflow pausado");
      qc.invalidateQueries({ queryKey: ["catalog-workflow-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resumeRun = useMutation({
    mutationFn: async (run_id: string) => {
      return await inv("resume-workflow-run", { run_id });
    },
    onSuccess: () => {
      toast.success("Workflow retomado");
      qc.invalidateQueries({ queryKey: ["catalog-workflow-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retryStep = useMutation({
    mutationFn: async (p: { step_id: string; run_id: string }) => {
      return await inv("retry-workflow-step", p);
    },
    onSuccess: () => {
      toast.success("Passo reexecutado");
      qc.invalidateQueries({ queryKey: ["catalog-workflow-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const summarizeRun = useMutation({
    mutationFn: async (run_id: string) => {
      return await inv("summarize-workflow-run", { run_id });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createWorkflow = useMutation({
    mutationFn: async (p: { workflow_name: string; workflow_type: string; workflow_config?: Record<string, unknown> }) => {
      const { data, error } = await supabase
        .from("catalog_workflows")
        .insert({ workspace_id: wid!, ...p } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Workflow criado");
      qc.invalidateQueries({ queryKey: ["catalog-workflows"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    workflows,
    runs,
    getRunSteps,
    getHandoffs,
    startWorkflow,
    executeStep,
    pauseRun,
    resumeRun,
    retryStep,
    summarizeRun,
    createWorkflow,
  };
}
