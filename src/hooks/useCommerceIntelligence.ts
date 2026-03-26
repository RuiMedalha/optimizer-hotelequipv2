import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

// --- Product Insights ---
export function useProductInsights(productId?: string | null) {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["product-insights", activeWorkspace?.id, productId],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      let q = supabase.from("product_insights").select("*").eq("workspace_id", activeWorkspace!.id).order("priority", { ascending: false });
      if (productId) q = q.eq("product_id", productId);
      const { data, error } = await q.limit(200);
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateInsightStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const update: any = { status };
      if (status === "implemented" || status === "accepted") update.resolved_at = new Date().toISOString();
      const { error } = await supabase.from("product_insights").update(update).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Insight atualizado"); qc.invalidateQueries({ queryKey: ["product-insights"] }); },
  });
}

// --- Bundle Suggestions ---
export function useBundleSuggestions() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["bundle-suggestions", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const { data, error } = await supabase.from("bundle_suggestions").select("*").eq("workspace_id", activeWorkspace!.id).order("confidence", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useAcceptBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bundle_suggestions").update({ accepted: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Bundle aceite"); qc.invalidateQueries({ queryKey: ["bundle-suggestions"] }); },
  });
}

// --- SEO Recommendations ---
export function useSeoRecommendations(productId?: string | null) {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["seo-recommendations", activeWorkspace?.id, productId],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      let q = supabase.from("seo_recommendations").select("*").eq("workspace_id", activeWorkspace!.id).order("confidence", { ascending: false });
      if (productId) q = q.eq("product_id", productId);
      const { data, error } = await q.limit(100);
      if (error) throw error;
      return data;
    },
  });
}

// --- Catalog Gaps ---
export function useCatalogGaps() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["catalog-gaps", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const { data, error } = await supabase.from("catalog_gap_analysis").select("*").eq("workspace_id", activeWorkspace!.id).order("confidence", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

// --- Monetization Opportunities ---
export function useMonetizationOpportunities() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["monetization-opportunities", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const { data, error } = await supabase.from("monetization_opportunities").select("*").eq("workspace_id", activeWorkspace!.id).order("estimated_revenue_gain", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

// --- Completeness Scores ---
export function useCompletenessScores() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["completeness-scores", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const { data, error } = await supabase.from("attribute_completeness_scores").select("*").eq("workspace_id", activeWorkspace!.id).order("completeness_score", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

// --- Performance Metrics ---
export function usePerformanceMetrics(productId?: string | null) {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["performance-metrics", activeWorkspace?.id, productId],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      let q = supabase.from("product_performance_metrics").select("*").eq("workspace_id", activeWorkspace!.id);
      if (productId) q = q.eq("product_id", productId);
      const { data, error } = await q.limit(200);
      if (error) throw error;
      return data;
    },
  });
}

// --- Actions ---
export function useAnalyzeCatalog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (workspace_id: string) => {
      const { data, error } = await supabase.functions.invoke("analyze-catalog", { body: { workspace_id } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Análise concluída: ${data.insights_generated} insights gerados`);
      qc.invalidateQueries({ queryKey: ["product-insights"] });
      qc.invalidateQueries({ queryKey: ["bundle-suggestions"] });
      qc.invalidateQueries({ queryKey: ["completeness-scores"] });
      qc.invalidateQueries({ queryKey: ["seo-recommendations"] });
    },
    onError: (e: any) => toast.error(e.message || "Erro na análise"),
  });
}

export function useGenerateProductInsights() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspace_id, product_id }: { workspace_id: string; product_id: string }) => {
      const { data, error } = await supabase.functions.invoke("generate-product-insights", { body: { workspace_id, product_id } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`${data.insights_generated} insights gerados`);
      qc.invalidateQueries({ queryKey: ["product-insights"] });
    },
    onError: (e: any) => toast.error(e.message || "Erro"),
  });
}

// --- Constants ---
export const INSIGHT_TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  seo_improvement: { label: "SEO", icon: "🔍", color: "bg-blue-500/10 text-blue-600" },
  title_optimization: { label: "Título", icon: "✏️", color: "bg-purple-500/10 text-purple-600" },
  description_improvement: { label: "Descrição", icon: "📝", color: "bg-indigo-500/10 text-indigo-600" },
  missing_attribute: { label: "Atributo", icon: "⚠️", color: "bg-amber-500/10 text-amber-600" },
  image_quality_issue: { label: "Imagem", icon: "🖼️", color: "bg-rose-500/10 text-rose-600" },
  category_mismatch: { label: "Categoria", icon: "📂", color: "bg-orange-500/10 text-orange-600" },
  bundle_opportunity: { label: "Bundle", icon: "📦", color: "bg-green-500/10 text-green-600" },
  upsell_opportunity: { label: "Upsell", icon: "⬆️", color: "bg-emerald-500/10 text-emerald-600" },
  cross_sell_opportunity: { label: "Cross-sell", icon: "↔️", color: "bg-teal-500/10 text-teal-600" },
  price_anomaly: { label: "Preço", icon: "💰", color: "bg-yellow-500/10 text-yellow-600" },
  channel_rejection_risk: { label: "Rejeição", icon: "🚫", color: "bg-red-500/10 text-red-600" },
  missing_translation: { label: "Tradução", icon: "🌐", color: "bg-cyan-500/10 text-cyan-600" },
  catalog_gap: { label: "Gap", icon: "🕳️", color: "bg-gray-500/10 text-gray-600" },
  keyword_opportunity: { label: "Keyword", icon: "🔑", color: "bg-violet-500/10 text-violet-600" },
};
