import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useLearningSignals(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["learning-signals", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_learning_signals" as any).select("*")
        .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useOutcomeTracking(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["outcome-tracking", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_outcome_tracking" as any).select("*")
        .eq("workspace_id", workspaceId).order("measured_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function usePerformanceHistory(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["perf-history", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("decision_performance_history" as any).select("*")
        .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useReinforcementMemory(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["reinforcement-memory", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_reinforcement_memory" as any).select("*")
        .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useLearningModels(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["learning-models", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_learning_models" as any).select("*")
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function usePolicyAdjustments(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["policy-adjustments", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brain_policy_adjustments" as any).select("*")
        .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useRunLearningCycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId }: { workspaceId: string }) => {
      // 1. Evaluate outcomes
      const { data: d1, error: e1 } = await supabase.functions.invoke("catalog-brain-evaluate-outcomes", { body: { workspaceId } });
      if (e1) throw e1;

      // 2. Update reinforcement
      const { data: d2, error: e2 } = await supabase.functions.invoke("catalog-brain-update-reinforcement", { body: { workspaceId } });
      if (e2) throw e2;

      // 3. Adjust impact model
      const { data: d3, error: e3 } = await supabase.functions.invoke("catalog-brain-adjust-impact-model", { body: { workspaceId } });
      if (e3) throw e3;

      // 4. Discover patterns
      const { data: d4, error: e4 } = await supabase.functions.invoke("catalog-brain-discover-patterns", { body: { workspaceId } });
      if (e4) throw e4;

      // 5. Detect success patterns
      const { data: d5, error: e5 } = await supabase.functions.invoke("catalog-brain-detect-success-patterns", { body: { workspaceId } });
      if (e5) throw e5;

      // 6. Update models
      const { data: d6, error: e6 } = await supabase.functions.invoke("catalog-brain-update-models", { body: { workspaceId } });
      if (e6) throw e6;

      return { outcomes: d1, reinforcement: d2, impact: d3, patterns: d4, success: d5, models: d6 };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["learning-signals"] });
      qc.invalidateQueries({ queryKey: ["outcome-tracking"] });
      qc.invalidateQueries({ queryKey: ["perf-history"] });
      qc.invalidateQueries({ queryKey: ["reinforcement-memory"] });
      qc.invalidateQueries({ queryKey: ["learning-models"] });
      toast.success("Ciclo de aprendizagem concluído!");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSubmitFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId, decisionId, feedback }: { workspaceId: string; decisionId: string; feedback: "positive" | "negative" }) => {
      const { data, error } = await supabase.functions.invoke("catalog-brain-evaluate-feedback", {
        body: { workspaceId, decisionId, feedback, feedbackType: "explicit_feedback" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["learning-signals"] });
      qc.invalidateQueries({ queryKey: ["reinforcement-memory"] });
      toast.success("Feedback registado!");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
