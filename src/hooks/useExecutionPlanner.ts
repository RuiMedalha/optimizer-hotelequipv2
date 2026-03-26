import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function useExecutionPlanner() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();
  const wsId = activeWorkspace?.id;

  const plans = useQuery({
    queryKey: ["execution-plans", wsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("execution_plans")
        .select("*")
        .eq("workspace_id", wsId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const routingPolicies = useQuery({
    queryKey: ["ai-routing-policies", wsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_routing_policies")
        .select("*")
        .eq("workspace_id", wsId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const fallbackRules = useQuery({
    queryKey: ["execution-fallback-rules", wsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("execution_fallback_rules")
        .select("*")
        .eq("workspace_id", wsId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const modelMatrix = useQuery({
    queryKey: ["model-capability-matrix"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("model_capability_matrix")
        .select("*")
        .eq("is_active", true)
        .order("quality_score", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const createPlan = useMutation({
    mutationFn: async (params: { planType: string; executionMode?: string; runId?: string; context?: Record<string, unknown> }) => {
      const { data, error } = await supabase.functions.invoke("create-execution-plan", {
        body: { workspaceId: wsId, ...params },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Plano de execução criado");
      qc.invalidateQueries({ queryKey: ["execution-plans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runStep = useMutation({
    mutationFn: async (stepId: string) => {
      const { data, error } = await supabase.functions.invoke("run-execution-step", {
        body: { stepId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["execution-plans"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const evaluatePlan = useMutation({
    mutationFn: async (planId: string) => {
      const { data, error } = await supabase.functions.invoke("evaluate-execution-plan", {
        body: { planId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => toast.success("Avaliação concluída"),
    onError: (e: Error) => toast.error(e.message),
  });

  const usePlanSteps = (planId: string | null) =>
    useQuery({
      queryKey: ["execution-plan-steps", planId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("execution_plan_steps")
          .select("*")
          .eq("plan_id", planId!)
          .order("step_order", { ascending: true });
        if (error) throw error;
        return data;
      },
      enabled: !!planId,
    });

  const usePlanOutcomes = (planId: string | null) =>
    useQuery({
      queryKey: ["execution-outcomes", planId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("execution_outcomes")
          .select("*")
          .eq("plan_id", planId!)
          .order("created_at", { ascending: true });
        if (error) throw error;
        return data;
      },
      enabled: !!planId,
    });

  return { plans, routingPolicies, fallbackRules, modelMatrix, createPlan, runStep, evaluatePlan, usePlanSteps, usePlanOutcomes };
}
