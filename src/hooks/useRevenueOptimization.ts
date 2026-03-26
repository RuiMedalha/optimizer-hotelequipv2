import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useProductRelationships(wId: string | undefined) {
  return useQuery({ queryKey: ["product-rels", wId], enabled: !!wId, queryFn: async () => { const { data, error } = await supabase.from("product_relationships" as any).select("*").eq("workspace_id", wId).order("confidence", { ascending: false }).limit(100); if (error) throw error; return (data || []) as any[]; } });
}
export function useBundleRecommendations(wId: string | undefined) {
  return useQuery({ queryKey: ["bundle-recs", wId], enabled: !!wId, queryFn: async () => { const { data, error } = await supabase.from("bundle_recommendations" as any).select("*").eq("workspace_id", wId).order("expected_revenue", { ascending: false }).limit(50); if (error) throw error; return (data || []) as any[]; } });
}
export function usePricingRecommendations(wId: string | undefined) {
  return useQuery({ queryKey: ["pricing-recs", wId], enabled: !!wId, queryFn: async () => { const { data, error } = await supabase.from("pricing_recommendations" as any).select("*").eq("workspace_id", wId).order("created_at", { ascending: false }).limit(100); if (error) throw error; return (data || []) as any[]; } });
}
export function usePromotionCandidates(wId: string | undefined) {
  return useQuery({ queryKey: ["promo-candidates", wId], enabled: !!wId, queryFn: async () => { const { data, error } = await supabase.from("promotion_candidates" as any).select("*").eq("workspace_id", wId).order("estimated_revenue_gain", { ascending: false }).limit(50); if (error) throw error; return (data || []) as any[]; } });
}
export function useRevenueActions(wId: string | undefined) {
  return useQuery({ queryKey: ["revenue-actions", wId], enabled: !!wId, queryFn: async () => { const { data, error } = await supabase.from("revenue_actions" as any).select("*").eq("workspace_id", wId).order("expected_revenue", { ascending: false }).limit(100); if (error) throw error; return (data || []) as any[]; } });
}

export function useRunRevenuePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId }: { workspaceId: string }) => {
      const invoke = async (fn: string) => { const { data, error } = await supabase.functions.invoke(fn, { body: { workspaceId } }); if (error) throw error; return data; };
      const r1 = await invoke("generate-product-relationships");
      const r2 = await invoke("generate-bundle-recommendations");
      const r3 = await invoke("calculate-price-optimization");
      const r4 = await invoke("detect-promotion-opportunities");
      const r5 = await invoke("evaluate-revenue-impact");
      return { relationships: r1.relationships, bundles: r2.bundles, pricing: r3.recommendations, promotions: r4.promotions, actions: r5.actions };
    },
    onSuccess: (d) => { ["product-rels", "bundle-recs", "pricing-recs", "promo-candidates", "revenue-actions"].forEach(k => qc.invalidateQueries({ queryKey: [k] })); toast.success(`Pipeline: ${d.relationships} relações, ${d.bundles} bundles, ${d.pricing} preços, ${d.promotions} promoções`); },
    onError: (e: Error) => toast.error(e.message),
  });
}
