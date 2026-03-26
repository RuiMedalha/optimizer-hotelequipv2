import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ── Quality Gate Results ──
export function useQualityGateResults(productId: string | null) {
  return useQuery({
    queryKey: ["quality-gate-results", productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quality_gate_results" as any)
        .select("*")
        .eq("product_id", productId)
        .order("evaluated_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as any[];
    },
  });
}

// ── Publish Locks ──
export function usePublishLocks(productId: string | null) {
  return useQuery({
    queryKey: ["publish-locks", productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("publish_locks" as any)
        .select("*")
        .eq("product_id", productId)
        .eq("is_active", true)
        .order("locked_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as any[];
    },
  });
}

// ── Product Quality Scores ──
export function useProductQualityScores(productId: string | null) {
  return useQuery({
    queryKey: ["product-quality-scores", productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_quality_scores" as any)
        .select("*")
        .eq("product_id", productId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as any;
    },
  });
}

// ── Field Confidence ──
export function useProductFieldConfidence(productId: string | null) {
  return useQuery({
    queryKey: ["product-field-confidence", productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_field_confidence" as any)
        .select("*")
        .eq("product_id", productId)
        .order("field_key", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as any[];
    },
  });
}

// ── Evaluate Quality Gate ──
export function useEvaluateQualityGate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId, productIds }: { workspaceId: string; productIds: string[] }) => {
      const { data, error } = await supabase.functions.invoke("evaluate-quality-gate", {
        body: { workspaceId, productIds },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["quality-gate-results"] });
      qc.invalidateQueries({ queryKey: ["publish-locks"] });
      qc.invalidateQueries({ queryKey: ["product-quality-scores"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      const results = data?.results || [];
      const locked = results.filter((r: any) => r.locked).length;
      if (locked > 0) {
        toast.warning(`${locked} produto(s) bloqueado(s) por quality gate.`);
      } else {
        toast.success("Todos os produtos passaram no quality gate! ✅");
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
