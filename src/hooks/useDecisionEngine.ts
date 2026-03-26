import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useDecisionSignals(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["decision-signals", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_decision_signals" as any).select("*")
        .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useDecisions(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["decisions", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_decisions" as any).select("*")
        .eq("workspace_id", workspaceId).order("priority_score", { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useDecisionExplanations(decisionId: string | null) {
  return useQuery({
    queryKey: ["decision-explanation", decisionId],
    enabled: !!decisionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("decision_explanations" as any).select("*")
        .eq("decision_id", decisionId).limit(1);
      if (error) throw error;
      return (data || [])[0] as any;
    },
  });
}

export function useImpactModels(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["impact-models", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("impact_models" as any).select("*")
        .eq("workspace_id", workspaceId).order("dimension");
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useImpactEvaluations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["impact-evaluations", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_impact_evaluations" as any).select("*")
        .eq("workspace_id", workspaceId).order("impact_score", { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useDecisionPolicies(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["decision-policies", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brain_decision_policies" as any).select("*")
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useEconomicModels(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["economic-models", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_economic_models" as any).select("*")
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useRunDecisionEngine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId }: { workspaceId: string }) => {
      // Step 1: Detect signals
      const { data: d1, error: e1 } = await supabase.functions.invoke("catalog-brain-detect-signals", { body: { workspaceId } });
      if (e1) throw e1;

      // Step 2: Evaluate impact
      const { data: d2, error: e2 } = await supabase.functions.invoke("catalog-brain-evaluate-impact", { body: { workspaceId } });
      if (e2) throw e2;

      // Step 3: Generate decisions
      const { data: d3, error: e3 } = await supabase.functions.invoke("catalog-brain-generate-decisions", { body: { workspaceId } });
      if (e3) throw e3;

      // Step 4: Prioritize
      const { data: d4, error: e4 } = await supabase.functions.invoke("catalog-brain-prioritize-decisions", { body: { workspaceId } });
      if (e4) throw e4;

      return { signals: d1?.detected || 0, evaluations: d2?.evaluated || 0, decisions: d3?.decisions || 0, prioritized: d4 };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["decision-signals"] });
      qc.invalidateQueries({ queryKey: ["decisions"] });
      qc.invalidateQueries({ queryKey: ["impact-evaluations"] });
      toast.success(`Motor de decisão: ${data.signals} sinais → ${data.decisions} decisões`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useApproveDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ decisionId }: { decisionId: string }) => {
      const { error } = await supabase
        .from("catalog_decisions" as any).update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", decisionId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["decisions"] });
      toast.success("Decisão aprovada!");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRejectDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ decisionId }: { decisionId: string }) => {
      const { error } = await supabase
        .from("catalog_decisions" as any).update({ status: "rejected", updated_at: new Date().toISOString() }).eq("id", decisionId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["decisions"] });
      toast.success("Decisão rejeitada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreatePlanFromDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ decisionId }: { decisionId: string }) => {
      const { data, error } = await supabase.functions.invoke("catalog-brain-create-plan-from-decision", { body: { decisionId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["decisions"] });
      qc.invalidateQueries({ queryKey: ["brain-plans"] });
      toast.success(`Plano criado com ${data.steps} passos!`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSaveImpactModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId, models }: { workspaceId: string; models: { dimension: string; weight: number }[] }) => {
      // Delete existing
      await supabase.from("impact_models" as any).delete().eq("workspace_id", workspaceId);
      // Insert new
      const rows = models.map((m) => ({ workspace_id: workspaceId, model_name: "default", dimension: m.dimension, weight: m.weight }));
      const { error } = await supabase.from("impact_models" as any).insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["impact-models"] });
      toast.success("Pesos de impacto guardados!");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
