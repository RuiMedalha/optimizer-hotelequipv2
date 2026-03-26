import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function useOrchestration() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();
  const wsId = activeWorkspace?.id;

  const runs = useQuery({
    queryKey: ["orchestration-runs", wsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orchestration_runs")
        .select("*")
        .eq("workspace_id", wsId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const policies = useQuery({
    queryKey: ["orchestration-policies", wsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orchestration_policies")
        .select("*")
        .eq("workspace_id", wsId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const startRun = useMutation({
    mutationFn: async (params: { triggerSource: string; payload?: Record<string, unknown> }) => {
      const { data, error } = await supabase.functions.invoke("start-orchestration-run", {
        body: { workspaceId: wsId, ...params },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Pipeline de orquestração iniciado");
      qc.invalidateQueries({ queryKey: ["orchestration-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resolveSteps = useMutation({
    mutationFn: async (runId: string) => {
      const { data, error } = await supabase.functions.invoke("resolve-step-dependencies", {
        body: { runId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orchestration-runs"] }),
  });

  const useRunSteps = (runId: string | null) =>
    useQuery({
      queryKey: ["orchestration-steps", runId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("orchestration_steps")
          .select("*")
          .eq("run_id", runId!)
          .order("step_order", { ascending: true });
        if (error) throw error;
        return data;
      },
      enabled: !!runId,
    });

  const useRunDecisions = (runId: string | null) =>
    useQuery({
      queryKey: ["execution-decisions", runId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("execution_decisions")
          .select("*")
          .eq("run_id", runId!)
          .order("created_at", { ascending: true });
        if (error) throw error;
        return data;
      },
      enabled: !!runId,
    });

  return { runs, policies, startRun, resolveSteps, useRunSteps, useRunDecisions };
}
