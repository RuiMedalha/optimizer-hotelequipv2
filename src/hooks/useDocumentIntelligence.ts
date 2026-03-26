import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export interface DocumentAIProvider {
  id: string;
  workspace_id: string;
  provider_name: string;
  provider_type: string;
  is_active: boolean;
  priority_order: number;
  default_model: string | null;
  supports_vision: boolean;
  supports_tables: boolean;
  supports_json_schema: boolean;
  max_pages: number;
  timeout_seconds: number;
  estimated_cost_per_page: number;
  config: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export function useDocumentAIProviders() {
  const { activeWorkspace } = useWorkspaceContext();
  const workspaceId = activeWorkspace?.id;

  return useQuery({
    queryKey: ["document-ai-providers", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_ai_providers" as any)
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("priority_order");
      if (error) throw error;
      return data as unknown as DocumentAIProvider[];
    },
  });
}

export function useSaveDocumentAIProvider() {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (provider: Partial<DocumentAIProvider> & { id?: string }) => {
      if (provider.id) {
        const { error } = await supabase
          .from("document_ai_providers" as any)
          .update({
            provider_name: provider.provider_name,
            provider_type: provider.provider_type,
            is_active: provider.is_active,
            priority_order: provider.priority_order,
            default_model: provider.default_model,
            supports_vision: provider.supports_vision,
            supports_tables: provider.supports_tables,
            supports_json_schema: provider.supports_json_schema,
            max_pages: provider.max_pages,
            timeout_seconds: provider.timeout_seconds,
            estimated_cost_per_page: provider.estimated_cost_per_page,
            config: provider.config,
            updated_at: new Date().toISOString(),
          })
          .eq("id", provider.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("document_ai_providers" as any)
          .insert({
            workspace_id: activeWorkspace!.id,
            ...provider,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Provider guardado");
      queryClient.invalidateQueries({ queryKey: ["document-ai-providers"] });
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });
}

export function useDeleteDocumentAIProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("document_ai_providers" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Provider removido");
      queryClient.invalidateQueries({ queryKey: ["document-ai-providers"] });
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });
}

export function useTestDocumentProvider() {
  return useMutation({
    mutationFn: async ({ providerId, workspaceId }: { providerId?: string; workspaceId: string }) => {
      const { data, error } = await supabase.functions.invoke("test-document-intelligence-provider", {
        body: { providerId, workspaceId },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useRunDocumentIntelligence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { extractionId?: string; pageId?: string; mode?: string; manualProvider?: string }) => {
      const { data, error } = await supabase.functions.invoke("run-document-intelligence", {
        body: params,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Document Intelligence concluído");
      queryClient.invalidateQueries({ queryKey: ["pdf-extractions"] });
      queryClient.invalidateQueries({ queryKey: ["pdf-pages"] });
      queryClient.invalidateQueries({ queryKey: ["pdf-tables"] });
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });
}

export function useReprocessExtraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { extractionId: string; mode?: string; provider?: string }) => {
      const { data, error } = await supabase.functions.invoke("reprocess-pdf-extraction", {
        body: params,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Reprocessamento iniciado");
      queryClient.invalidateQueries({ queryKey: ["pdf-extractions"] });
      queryClient.invalidateQueries({ queryKey: ["pdf-pages"] });
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });
}

export const PIPELINE_STEPS = [
  { id: "extract-pdf-pages", name: "Extração de Páginas", description: "Segmentação de texto, zonas e tabelas" },
  { id: "analyze-pdf-layout", name: "Análise de Layout", description: "Classificação semântica e recomendação de motor" },
  { id: "vision-parse-pdf", name: "Análise Visual AI", description: "Classificação semântica com LLM" },
  { id: "map-pdf-to-products", name: "Mapeamento de Produtos", description: "Conversão para produtos estruturados" },
];

export const PROVIDER_TYPES = [
  { value: "lovable_gateway", label: "Lovable AI Gateway", description: "Gateway integrado (sem configuração extra)" },
  { value: "gemini_direct", label: "Google Gemini Direct", description: "API direta do Google Gemini" },
  { value: "openai_direct", label: "OpenAI Direct", description: "API direta da OpenAI" },
  { value: "ocr_fallback", label: "OCR Básico Fallback", description: "Extração apenas por texto/OCR" },
];

export const EXECUTION_MODES = [
  { value: "auto", label: "Auto", description: "Escolha automática pelo sistema" },
  { value: "quality_optimized", label: "Qualidade", description: "Melhor qualidade, maior custo" },
  { value: "cost_optimized", label: "Custo", description: "Menor custo possível" },
  { value: "fast", label: "Rápido", description: "Menor latência" },
  { value: "manual", label: "Manual", description: "Escolher provider manualmente" },
];

export function useAnalyzePdfLayout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (extractionId: string) => {
      const { data, error } = await supabase.functions.invoke("analyze-pdf-layout", {
        body: { extractionId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Análise de layout concluída");
      queryClient.invalidateQueries({ queryKey: ["pdf-extractions"] });
    },
    onError: (e: Error) => toast.error("Erro na análise: " + e.message),
  });
}

export function useSaveExtractionMappingRules() {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async ({ extractionId, rules }: { extractionId: string; rules: Array<{ field_label: string; mapped_to: string; confidence: number; column_index?: number; table_index?: number }> }) => {
      // Delete existing rules for this extraction
      await supabase
        .from("extraction_mapping_rules" as any)
        .delete()
        .eq("extraction_id", extractionId);

      // Insert new rules
      const rows = rules.map((r) => ({
        workspace_id: activeWorkspace!.id,
        extraction_id: extractionId,
        field_label: r.field_label,
        mapped_to: r.mapped_to,
        confidence: r.confidence,
        column_index: r.column_index,
        table_index: r.table_index,
        source: "human",
      }));

      const { error } = await supabase
        .from("extraction_mapping_rules" as any)
        .insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regras de mapeamento guardadas");
      queryClient.invalidateQueries({ queryKey: ["extraction-mapping-rules"] });
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });
}

export function useSendExtractionToIngestion() {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async ({ extractionId, mergeStrategy, dupFields }: { extractionId: string; mergeStrategy: string; dupFields: string }) => {
      const { data, error } = await supabase.functions.invoke("map-pdf-to-products", {
        body: { extractionId, sendToIngestion: true, workspaceId: activeWorkspace?.id, mergeStrategy, dupFields },
      });
      if (error) throw error;

      // Mark extraction as sent
      await supabase.from("pdf_extractions").update({ sent_to_ingestion: true }).eq("id", extractionId);

      return data;
    },
    onSuccess: (data) => {
      toast.success(`${data.rowsMapped || 0} produtos enviados para Ingestion Hub`);
      queryClient.invalidateQueries({ queryKey: ["pdf-extractions"] });
      queryClient.invalidateQueries({ queryKey: ["ingestion-jobs"] });
    },
    onError: (e: Error) => toast.error("Erro: " + e.message),
  });
}
