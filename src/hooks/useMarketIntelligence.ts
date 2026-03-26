import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useMarketSources(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["market-sources", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from("market_sources" as any).select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useMarketSignals(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["market-signals", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from("market_signals" as any).select("*").eq("workspace_id", workspaceId).order("detected_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useMarketOpportunities(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["market-opportunities", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from("market_opportunities" as any).select("*").eq("workspace_id", workspaceId).order("priority_score", { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useMarketBenchmarks(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["market-benchmarks", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from("market_benchmarks" as any).select("*").eq("workspace_id", workspaceId).order("benchmark_date", { ascending: false }).limit(50);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useMarketTrends(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["market-trends", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from("market_trends" as any).select("*").eq("workspace_id", workspaceId).order("detected_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useSyncMarketIntelligence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId }: { workspaceId: string }) => {
      const { data, error } = await supabase.functions.invoke("sync-market-intelligence", { body: { workspaceId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["market-sources"] });
      qc.invalidateQueries({ queryKey: ["market-signals"] });
      qc.invalidateQueries({ queryKey: ["market-opportunities"] });
      qc.invalidateQueries({ queryKey: ["market-benchmarks"] });
      toast.success(`Pipeline completo: ${data.signals || 0} sinais, ${data.opportunities || 0} oportunidades`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateOpportunityStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("market_opportunities" as any).update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["market-opportunities"] });
      toast.success("Status atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAddMarketSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { workspaceId: string; sourceName: string; sourceType: string; baseUrl: string; config?: any }) => {
      const { error } = await supabase.from("market_sources" as any).insert({
        workspace_id: params.workspaceId,
        source_name: params.sourceName,
        source_type: params.sourceType,
        base_url: params.baseUrl,
        config: params.config || {},
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["market-sources"] });
      toast.success("Fonte adicionada");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
