import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function useMemoryPatterns(supplierName?: string) {
  const { activeWorkspace } = useWorkspaceContext();
  const workspaceId = activeWorkspace?.id;

  return useQuery({
    queryKey: ["memory-patterns", workspaceId, supplierName],
    enabled: !!workspaceId,
    queryFn: async () => {
      let query = supabase
        .from("extraction_memory_patterns" as any)
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("confidence", { ascending: false })
        .limit(100);
      if (supplierName) {
        query = query.or(`supplier_name.eq.${supplierName},supplier_name.is.null`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useExtractionCorrections() {
  const { activeWorkspace } = useWorkspaceContext();
  const workspaceId = activeWorkspace?.id;

  return useQuery({
    queryKey: ["extraction-corrections", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("extraction_corrections" as any)
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useNormalizationDictionary() {
  const { activeWorkspace } = useWorkspaceContext();
  const workspaceId = activeWorkspace?.id;

  return useQuery({
    queryKey: ["normalization-dictionary", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("normalization_dictionary" as any)
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("dictionary_type", { ascending: true });
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useDecisionHistory() {
  const { activeWorkspace } = useWorkspaceContext();
  const workspaceId = activeWorkspace?.id;

  return useQuery({
    queryKey: ["decision-history", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("extraction_decision_history" as any)
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useLearnFromReview() {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async ({ corrections, saveAsPatterns }: { corrections: any[]; saveAsPatterns?: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke("learn-from-review", {
        body: {
          workspaceId: activeWorkspace?.id,
          reviewedBy: user?.id,
          corrections,
          saveAsPatterns: saveAsPatterns !== false,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Memória atualizada: ${data.correctionsStored} correções, ${data.patternsCreated} padrões`);
      queryClient.invalidateQueries({ queryKey: ["memory-patterns"] });
      queryClient.invalidateQueries({ queryKey: ["extraction-corrections"] });
      queryClient.invalidateQueries({ queryKey: ["normalization-dictionary"] });
      queryClient.invalidateQueries({ queryKey: ["decision-history"] });
    },
    onError: (e: Error) => toast.error("Erro ao aprender: " + e.message),
  });
}

export function useAddNormalization() {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (entry: { dictionary_type: string; source_term: string; normalized_term: string; supplier_name?: string; language?: string }) => {
      const { error } = await supabase
        .from("normalization_dictionary" as any)
        .insert({
          workspace_id: activeWorkspace!.id,
          ...entry,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Normalização adicionada");
      queryClient.invalidateQueries({ queryKey: ["normalization-dictionary"] });
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });
}

export function useDeleteNormalization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("normalization_dictionary" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entrada removida");
      queryClient.invalidateQueries({ queryKey: ["normalization-dictionary"] });
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });
}

export function useMemoryInsights() {
  const { activeWorkspace } = useWorkspaceContext();
  const workspaceId = activeWorkspace?.id;

  return useQuery({
    queryKey: ["memory-insights", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const [patternsRes, correctionsRes, dictRes, decisionsRes] = await Promise.all([
        supabase.from("extraction_memory_patterns" as any).select("id, pattern_type, confidence, usage_count, success_count, failure_count, source_type, supplier_name").eq("workspace_id", workspaceId!),
        supabase.from("extraction_corrections" as any).select("id, correction_type, created_at").eq("workspace_id", workspaceId!),
        supabase.from("normalization_dictionary" as any).select("id, dictionary_type").eq("workspace_id", workspaceId!),
        supabase.from("extraction_decision_history" as any).select("id, decision_type, approved, confidence").eq("workspace_id", workspaceId!),
      ]);

      const patterns = (patternsRes.data || []) as any[];
      const corrections = (correctionsRes.data || []) as any[];
      const dict = (dictRes.data || []) as any[];
      const decisions = (decisionsRes.data || []) as any[];

      const topPatterns = [...patterns].sort((a, b) => b.usage_count - a.usage_count).slice(0, 10);
      const lowConfidence = patterns.filter(p => p.confidence < 40);
      const suppliers = [...new Set(patterns.filter(p => p.supplier_name).map(p => p.supplier_name))];
      const avgConfidence = patterns.length > 0 ? Math.round(patterns.reduce((s, p) => s + p.confidence, 0) / patterns.length) : 0;
      const humanPatterns = patterns.filter(p => p.source_type === "human_confirmed").length;
      const aiPatterns = patterns.filter(p => p.source_type === "ai_inferred").length;

      return {
        totalPatterns: patterns.length,
        totalCorrections: corrections.length,
        totalNormalizations: dict.length,
        totalDecisions: decisions.length,
        approvedDecisions: decisions.filter(d => d.approved).length,
        avgConfidence,
        humanPatterns,
        aiPatterns,
        topPatterns,
        lowConfidence,
        suppliers,
        patternsByType: Object.entries(
          patterns.reduce((acc: any, p: any) => { acc[p.pattern_type] = (acc[p.pattern_type] || 0) + 1; return acc; }, {})
        ),
        correctionsByType: Object.entries(
          corrections.reduce((acc: any, c: any) => { acc[c.correction_type] = (acc[c.correction_type] || 0) + 1; return acc; }, {})
        ),
      };
    },
  });
}
