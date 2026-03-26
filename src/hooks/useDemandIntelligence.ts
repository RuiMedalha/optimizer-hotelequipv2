import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toast } from "sonner";

export function useDemandSignals(wId: string | undefined) {
  return useQuery({ queryKey: ["demand-signals", wId], enabled: !!wId, queryFn: async () => { const { data, error } = await supabase.from("demand_signals" as any).select("*").eq("workspace_id", wId).order("signal_strength", { ascending: false }).limit(100); if (error) throw error; return (data || []) as any[]; } });
}
export function useKeywordOpportunities(wId: string | undefined) {
  return useQuery({ queryKey: ["keyword-opps", wId], enabled: !!wId, queryFn: async () => { const { data, error } = await supabase.from("keyword_opportunities" as any).select("*").eq("workspace_id", wId).order("opportunity_score", { ascending: false }).limit(100); if (error) throw error; return (data || []) as any[]; } });
}
export function useDemandTrends(wId: string | undefined) {
  return useQuery({ queryKey: ["demand-trends", wId], enabled: !!wId, queryFn: async () => { const { data, error } = await supabase.from("demand_trends" as any).select("*").eq("workspace_id", wId).order("trend_strength", { ascending: false }).limit(50); if (error) throw error; return (data || []) as any[]; } });
}

export function useRunDemandPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId }: { workspaceId: string }) => {
      const invoke = (fn: string) => invokeEdgeFunction<Record<string, any>>(fn, { body: { workspaceId } });
      await invoke("collect-demand-data");
      const r2 = await invoke("generate-demand-signals");
      const r3 = await invoke("detect-keyword-opportunities");
      const r4 = await invoke("generate-demand-trends");
      return { signals: r2.signals, opportunities: r3.opportunities, trends: r4.trends };
    },
    onSuccess: (d) => { ["demand-signals", "keyword-opps", "demand-trends"].forEach(k => qc.invalidateQueries({ queryKey: [k] })); toast.success(`Demand: ${d.signals} sinais, ${d.opportunities} oportunidades, ${d.trends} tendências`); },
    onError: (e: Error) => toast.error(e.message),
  });
}
