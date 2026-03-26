import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function useCostIntelligence() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();
  const wsId = activeWorkspace?.id;

  const budgets = useQuery({
    queryKey: ["workspace-budgets", wsId],
    queryFn: async () => {
      const { data, error } = await supabase.from("workspace_budgets").select("*").eq("workspace_id", wsId!).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const costRecords = useQuery({
    queryKey: ["usage-cost-records", wsId],
    queryFn: async () => {
      const { data, error } = await supabase.from("usage_cost_records").select("*").eq("workspace_id", wsId!).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const alerts = useQuery({
    queryKey: ["cost-alerts", wsId],
    queryFn: async () => {
      const { data, error } = await supabase.from("cost_alerts").select("*").eq("workspace_id", wsId!).eq("status", "open").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const forecasts = useQuery({
    queryKey: ["cost-forecasts", wsId],
    queryFn: async () => {
      const { data, error } = await supabase.from("cost_forecasts").select("*").eq("workspace_id", wsId!).order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const optimizationRules = useQuery({
    queryKey: ["cost-optimization-rules", wsId],
    queryFn: async () => {
      const { data, error } = await supabase.from("cost_optimization_rules").select("*").eq("workspace_id", wsId!).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const savingsLogs = useQuery({
    queryKey: ["optimization-savings-logs", wsId],
    queryFn: async () => {
      const { data, error } = await supabase.from("optimization_savings_logs").select("*").eq("workspace_id", wsId!).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const recordCost = useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke("record-usage-cost", { body: { workspaceId: wsId, ...params } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["usage-cost-records"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const forecastCost = useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke("forecast-operation-cost", { body: { workspaceId: wsId, ...params } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Previsão de custo gerada");
      qc.invalidateQueries({ queryKey: ["cost-forecasts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const evaluateBudget = useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke("evaluate-workspace-budget", { body: { workspaceId: wsId, ...params } });
      if (error) throw error;
      return data;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateAlerts = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-cost-alerts", { body: { workspaceId: wsId } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Alertas verificados");
      qc.invalidateQueries({ queryKey: ["cost-alerts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const summarizeUsage = useMutation({
    mutationFn: async (params?: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke("summarize-workspace-usage", { body: { workspaceId: wsId, ...params } });
      if (error) throw error;
      return data;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Computed totals
  const totalCostThisMonth = (costRecords.data || [])
    .filter((r: any) => new Date(r.created_at).getMonth() === new Date().getMonth())
    .reduce((s: number, r: any) => s + Number(r.total_cost || 0), 0);

  const totalSavings = (savingsLogs.data || []).reduce((s: number, r: any) => s + Number(r.estimated_saving || 0), 0);

  return {
    budgets, costRecords, alerts, forecasts, optimizationRules, savingsLogs,
    recordCost, forecastCost, evaluateBudget, generateAlerts, summarizeUsage,
    totalCostThisMonth, totalSavings,
  };
}
