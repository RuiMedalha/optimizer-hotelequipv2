import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function useStrategicPlanner() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();
  const wid = activeWorkspace?.id;

  const plans = useQuery({
    queryKey: ["strategy-plans", wid],
    enabled: !!wid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("strategy_plans")
        .select("*")
        .eq("workspace_id", wid!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const actions = useQuery({
    queryKey: ["strategy-actions", wid],
    enabled: !!wid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("strategy_actions")
        .select("*")
        .eq("workspace_id", wid!)
        .order("priority_score", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const simulations = useQuery({
    queryKey: ["strategy-simulations", wid],
    enabled: !!wid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("strategy_simulations")
        .select("*")
        .eq("workspace_id", wid!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const recommendations = useQuery({
    queryKey: ["strategy-recommendations", wid],
    enabled: !!wid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("strategy_recommendations")
        .select("*")
        .eq("workspace_id", wid!)
        .order("expected_impact", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const generatePlan = useMutation({
    mutationFn: async (params: { plan_type?: string; title?: string; horizon_months?: number }) => {
      const { data, error } = await supabase.functions.invoke("generate-strategy-plan", {
        body: { workspace_id: wid, ...params },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Plano estratégico gerado");
      qc.invalidateQueries({ queryKey: ["strategy-plans", wid] });
      qc.invalidateQueries({ queryKey: ["strategy-actions", wid] });
      qc.invalidateQueries({ queryKey: ["strategy-recommendations", wid] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const simulatePlan = useMutation({
    mutationFn: async (plan_id: string) => {
      const { data, error } = await supabase.functions.invoke("simulate-strategy-plan", {
        body: { workspace_id: wid, plan_id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Simulação concluída");
      qc.invalidateQueries({ queryKey: ["strategy-simulations", wid] });
      qc.invalidateQueries({ queryKey: ["strategy-plans", wid] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rankActions = useMutation({
    mutationFn: async (plan_id: string) => {
      const { data, error } = await supabase.functions.invoke("rank-strategy-actions", {
        body: { workspace_id: wid, plan_id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Ações re-priorizadas");
      qc.invalidateQueries({ queryKey: ["strategy-actions", wid] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const detectExpansion = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("detect-catalog-expansion", {
        body: { workspace_id: wid },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Expansão de catálogo analisada");
      qc.invalidateQueries({ queryKey: ["strategy-recommendations", wid] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const detectLaunch = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-launch-opportunities", {
        body: { workspace_id: wid },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Oportunidades de lançamento detetadas");
      qc.invalidateQueries({ queryKey: ["strategy-recommendations", wid] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const approvePlan = useMutation({
    mutationFn: async (plan_id: string) => {
      const { error } = await supabase
        .from("strategy_plans")
        .update({ status: "approved" as any })
        .eq("id", plan_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Plano aprovado");
      qc.invalidateQueries({ queryKey: ["strategy-plans", wid] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return {
    plans,
    actions,
    simulations,
    recommendations,
    generatePlan,
    simulatePlan,
    rankActions,
    detectExpansion,
    detectLaunch,
    approvePlan,
  };
}
