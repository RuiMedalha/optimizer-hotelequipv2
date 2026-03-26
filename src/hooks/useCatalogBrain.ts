import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useBrainObservations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["brain-observations", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_brain_observations" as any).select("*")
        .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useBrainPlans(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["brain-plans", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_brain_plans" as any).select("*")
        .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useBrainPlanSteps(planId: string | null) {
  return useQuery({
    queryKey: ["brain-plan-steps", planId],
    enabled: !!planId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_brain_plan_steps" as any).select("*")
        .eq("plan_id", planId).order("step_order", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useBrainOutcomes(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["brain-outcomes", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_brain_outcomes" as any).select("*")
        .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useBrainEntities(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["brain-entities", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_brain_entities" as any).select("*")
        .eq("workspace_id", workspaceId).limit(200);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useBrainRelations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["brain-relations", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_brain_relations" as any).select("*")
        .eq("workspace_id", workspaceId).limit(500);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useProductDNA(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["product-dna", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_dna_profiles" as any).select("*")
        .eq("workspace_id", workspaceId).limit(200);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useCatalogClusters(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["catalog-clusters", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_clusters" as any).select("*")
        .eq("workspace_id", workspaceId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useRunBrainOrchestration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId }: { workspaceId: string }) => {
      const { data, error } = await supabase.functions.invoke("catalog-brain-orchestrate", { body: { workspaceId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain-observations"] });
      qc.invalidateQueries({ queryKey: ["brain-plans"] });
      qc.invalidateQueries({ queryKey: ["brain-entities"] });
      qc.invalidateQueries({ queryKey: ["brain-relations"] });
      qc.invalidateQueries({ queryKey: ["brain-outcomes"] });
      qc.invalidateQueries({ queryKey: ["product-dna"] });
      toast.success("Orquestração do Brain concluída!");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useApprovePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ planId }: { planId: string }) => {
      const { error } = await supabase
        .from("catalog_brain_plans" as any).update({ status: "ready" }).eq("id", planId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain-plans"] });
      toast.success("Plano aprovado!");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useBrainLearn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ outcomeId, feedbackRating, feedbackText }: { outcomeId: string; feedbackRating: number; feedbackText?: string }) => {
      const { data, error } = await supabase.functions.invoke("catalog-brain-learn", {
        body: { outcomeId, feedbackRating, feedbackText },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain-outcomes"] });
      toast.success("Feedback registado!");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
