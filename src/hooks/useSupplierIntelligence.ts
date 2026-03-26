import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function useSupplierIntelligence() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;
  const qc = useQueryClient();

  const suppliers = useQuery({
    queryKey: ["supplier-profiles", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_profiles") as any)
        .select("*")
        .eq("workspace_id", wsId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const qualityScores = useQuery({
    queryKey: ["supplier-quality-scores", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_data_quality_scores") as any)
        .select("*")
        .eq("workspace_id", wsId);
      if (error) throw error;
      return data as any[];
    },
  });

  const createSupplier = useMutation({
    mutationFn: async (payload: { supplier_name: string; supplier_code?: string; base_url?: string }) => {
      const { data, error } = await (supabase.from("supplier_profiles") as any)
        .insert({ workspace_id: wsId, ...payload })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["supplier-profiles"] }); toast.success("Fornecedor criado"); },
  });

  const updateSupplier = useMutation({
    mutationFn: async ({ id, ...updates }: any) => {
      const { error } = await (supabase.from("supplier_profiles") as any)
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["supplier-profiles"] }); toast.success("Fornecedor atualizado"); },
  });

  const detectStructure = useMutation({
    mutationFn: async (payload: { supplier_id: string; columns: string[]; file_type?: string; source_file_id?: string }) => {
      const { data, error } = await supabase.functions.invoke("detect-supplier-structure", { body: payload });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier-schema-profiles"] });
      qc.invalidateQueries({ queryKey: ["supplier-mapping-suggestions"] });
      toast.success("Estrutura detetada com sucesso");
    },
  });

  const learnPatterns = useMutation({
    mutationFn: async (supplier_id: string) => {
      const { data, error } = await supabase.functions.invoke("learn-supplier-patterns-v2", { body: { supplier_id, workspace_id: wsId } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["supplier-patterns"] });
      toast.success(`${data.patterns_detected} padrões detetados`);
    },
  });

  const calculateQuality = useMutation({
    mutationFn: async (supplier_id: string) => {
      const { data, error } = await supabase.functions.invoke("calculate-supplier-quality", { body: { supplier_id, workspace_id: wsId } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier-quality-scores"] });
      toast.success("Quality score atualizado");
    },
  });

  const buildKnowledgeGraph = useMutation({
    mutationFn: async (supplier_id: string) => {
      const { data, error } = await supabase.functions.invoke("build-supplier-knowledge-graph", { body: { supplier_id, workspace_id: wsId } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["supplier-knowledge-graph"] });
      toast.success(`Knowledge graph: ${data.edges_created} ligações criadas`);
    },
  });

  return { suppliers, qualityScores, createSupplier, updateSupplier, detectStructure, learnPatterns, calculateQuality, buildKnowledgeGraph, wsId };
}

export function useSupplierDetail(supplierId: string | null) {
  const sourceProfiles = useQuery({
    queryKey: ["supplier-source-profiles", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_source_profiles") as any)
        .select("*").eq("supplier_id", supplierId).order("priority_rank");
      if (error) throw error;
      return data as any[];
    },
  });

  const fieldTrust = useQuery({
    queryKey: ["supplier-field-trust", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_field_trust_rules") as any)
        .select("*").eq("supplier_id", supplierId);
      if (error) throw error;
      return data as any[];
    },
  });

  const matchingRules = useQuery({
    queryKey: ["supplier-matching-rules", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_matching_rules") as any)
        .select("*").eq("supplier_id", supplierId).order("rule_weight", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const groupingRules = useQuery({
    queryKey: ["supplier-grouping-rules", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_grouping_rules") as any)
        .select("*").eq("supplier_id", supplierId);
      if (error) throw error;
      return data as any[];
    },
  });

  const taxonomyMappings = useQuery({
    queryKey: ["supplier-taxonomy-mappings", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_taxonomy_mappings") as any)
        .select("*").eq("supplier_id", supplierId);
      if (error) throw error;
      return data as any[];
    },
  });

  const learningEvents = useQuery({
    queryKey: ["supplier-learning-events", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_learning_events") as any)
        .select("*").eq("supplier_id", supplierId).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data as any[];
    },
  });

  const benchmarks = useQuery({
    queryKey: ["supplier-benchmarks", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_extraction_benchmarks") as any)
        .select("*").eq("supplier_id", supplierId).order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data as any[];
    },
  });

  const promptProfiles = useQuery({
    queryKey: ["supplier-prompt-profiles", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_prompt_profiles") as any)
        .select("*").eq("supplier_id", supplierId);
      if (error) throw error;
      return data as any[];
    },
  });

  const schemaProfiles = useQuery({
    queryKey: ["supplier-schema-profiles", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_schema_profiles") as any)
        .select("*").eq("supplier_id", supplierId).order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const patterns = useQuery({
    queryKey: ["supplier-patterns", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_patterns") as any)
        .select("*").eq("supplier_id", supplierId).order("confidence", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const mappingSuggestions = useQuery({
    queryKey: ["supplier-mapping-suggestions", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_mapping_suggestions") as any)
        .select("*").eq("supplier_id", supplierId).order("confidence", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const knowledgeGraph = useQuery({
    queryKey: ["supplier-knowledge-graph", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_knowledge_graph") as any)
        .select("*").eq("supplier_id", supplierId).order("weight", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  return { sourceProfiles, fieldTrust, matchingRules, groupingRules, taxonomyMappings, learningEvents, benchmarks, promptProfiles, schemaProfiles, patterns, mappingSuggestions, knowledgeGraph };
}
