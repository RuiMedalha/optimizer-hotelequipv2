import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useSimulationScenarios(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["sim-scenarios", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_simulation_scenarios" as any).select("*")
        .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useSimulationRuns(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["sim-runs", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_simulation_runs" as any).select("*")
        .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useSimulationResults(runId: string | null) {
  return useQuery({
    queryKey: ["sim-results", runId],
    enabled: !!runId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_simulation_results" as any).select("*")
        .eq("simulation_run_id", runId);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useActionSimulations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["action-sims", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_action_simulations" as any).select("*")
        .eq("workspace_id", workspaceId).order("expected_value", { ascending: false }).limit(50);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useRunSimulation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { workspaceId: string; entityType?: string; entityId?: string; simulationType: string; scenarioName?: string; inputData?: any }) => {
      const { data, error } = await supabase.functions.invoke("catalog-brain-run-simulation", { body: params });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["sim-scenarios"] });
      qc.invalidateQueries({ queryKey: ["sim-runs"] });
      toast.success(`Simulação concluída: risco ${data.risk_level}, confiança ${data.confidence}%`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useEvaluateSimulations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId }: { workspaceId: string }) => {
      const { data, error } = await supabase.functions.invoke("catalog-brain-evaluate-simulation", { body: { workspaceId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["action-sims"] });
      qc.invalidateQueries({ queryKey: ["sim-runs"] });
      toast.success(`${data.simulated} decisões simuladas!`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
