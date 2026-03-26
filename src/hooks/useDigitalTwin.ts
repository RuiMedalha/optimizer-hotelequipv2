import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useTwins(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["twins", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from("catalog_twins" as any).select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useTwinSnapshots(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["twin-snapshots", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from("catalog_twin_snapshots" as any).select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useTwinScenarios(twinId: string | null) {
  return useQuery({
    queryKey: ["twin-scenarios", twinId],
    enabled: !!twinId,
    queryFn: async () => {
      const { data, error } = await supabase.from("catalog_twin_scenarios" as any).select("*").eq("twin_id", twinId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useTwinResults(scenarioId: string | null) {
  return useQuery({
    queryKey: ["twin-results", scenarioId],
    enabled: !!scenarioId,
    queryFn: async () => {
      const { data, error } = await supabase.from("catalog_twin_results" as any).select("*").eq("scenario_id", scenarioId);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useTwinComparisons(twinId: string | null) {
  return useQuery({
    queryKey: ["twin-comparisons", twinId],
    enabled: !!twinId,
    queryFn: async () => {
      const { data, error } = await supabase.from("catalog_twin_comparisons" as any).select("*").eq("twin_id", twinId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useTwinEntities(twinId: string | null) {
  return useQuery({
    queryKey: ["twin-entities", twinId],
    enabled: !!twinId,
    queryFn: async () => {
      const { data, error } = await supabase.from("catalog_twin_entities" as any).select("*").eq("twin_id", twinId).limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useCreateTwin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { workspaceId: string; twinName?: string; description?: string }) => {
      const { data, error } = await supabase.functions.invoke("catalog-brain-create-twin", { body: params });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["twins"] });
      qc.invalidateQueries({ queryKey: ["twin-snapshots"] });
      toast.success(`Twin criado com ${data.entities_count} entidades`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRunTwinScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ scenarioId }: { scenarioId: string }) => {
      const { data, error } = await supabase.functions.invoke("catalog-brain-run-twin-scenario", { body: { scenarioId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["twin-scenarios"] });
      qc.invalidateQueries({ queryKey: ["twin-results"] });
      toast.success(`Cenário simulado: ${data.results_count} resultados`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCompareScenarios() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { twinId: string; scenarioAId: string; scenarioBId: string }) => {
      const { data, error } = await supabase.functions.invoke("catalog-brain-compare-scenarios", { body: params });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["twin-comparisons"] });
      toast.success("Cenários comparados!");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePromoteScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ scenarioId }: { scenarioId: string }) => {
      const { data, error } = await supabase.functions.invoke("catalog-brain-promote-scenario", { body: { scenarioId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["twin-scenarios"] });
      toast.success(`Cenário promovido! Plano criado com ${data.steps_count} passos`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSyncTwin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ twinId }: { twinId: string }) => {
      const { data, error } = await supabase.functions.invoke("catalog-brain-sync-twin", { body: { twinId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["twin-entities"] });
      qc.invalidateQueries({ queryKey: ["twins"] });
      toast.success(`Twin sincronizado: ${data.synced} entidades`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
