import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export interface AiProvider {
  id: string;
  workspace_id: string;
  provider_name: string;
  provider_type: string;
  base_url: string | null;
  default_model: string | null;
  fallback_model: string | null;
  timeout_seconds: number;
  priority_order: number;
  is_active: boolean;
  supports_text: boolean;
  supports_vision: boolean;
  supports_json_schema: boolean;
  supports_translation: boolean;
  supports_function_calling: boolean;
  last_health_check: string | null;
  last_health_status: string | null;
  last_error: string | null;
  avg_latency_ms: number | null;
  success_rate: number | null;
  config: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface AiModelCatalogEntry {
  id: string;
  provider_type: string;
  model_id: string;
  display_name: string;
  supports_text: boolean;
  supports_vision: boolean;
  supports_structured_output: boolean;
  supports_json_schema: boolean;
  supports_tool_calls: boolean;
  cost_input_per_mtok: number;
  cost_output_per_mtok: number;
  speed_rating: number;
  accuracy_rating: number;
  max_context_tokens: number | null;
  is_global: boolean;
}

export interface AiRoutingRule {
  id: string;
  workspace_id: string;
  task_type: string;
  display_name: string;
  prompt_template_id: string | null;
  provider_id: string | null;
  model_override: string | null;
  recommended_model: string | null;
  fallback_provider_id: string | null;
  fallback_model: string | null;
  is_active: boolean;
  execution_priority: number;
  config: Record<string, any>;
  // joined
  provider?: AiProvider;
  fallback_provider?: AiProvider;
  prompt?: any;
}

// ═══ Providers ═══
export function useAiProviders() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["ai-providers", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const { data, error } = await (supabase.from("ai_providers") as any)
        .select("*")
        .eq("workspace_id", activeWorkspace!.id)
        .order("priority_order");
      if (error) throw error;
      return data as AiProvider[];
    },
  });
}

export function useSaveAiProvider() {
  const qc = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (provider: Partial<AiProvider> & { id?: string }) => {
      const payload = {
        provider_name: provider.provider_name,
        provider_type: provider.provider_type,
        base_url: provider.base_url,
        default_model: provider.default_model,
        fallback_model: provider.fallback_model,
        timeout_seconds: provider.timeout_seconds,
        priority_order: provider.priority_order,
        is_active: provider.is_active,
        supports_text: provider.supports_text,
        supports_vision: provider.supports_vision,
        supports_json_schema: provider.supports_json_schema,
        supports_translation: provider.supports_translation,
        supports_function_calling: provider.supports_function_calling,
        config: provider.config,
        updated_at: new Date().toISOString(),
      };

      if (provider.id) {
        const { error } = await (supabase.from("ai_providers") as any).update(payload).eq("id", provider.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from("ai_providers") as any).insert({
          workspace_id: activeWorkspace!.id,
          ...payload,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Provider guardado");
      qc.invalidateQueries({ queryKey: ["ai-providers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteAiProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("ai_providers") as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Provider removido");
      qc.invalidateQueries({ queryKey: ["ai-providers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useTestAiProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ providerId, workspaceId }: { providerId: string; workspaceId: string }) => {
      const { data, error } = await supabase.functions.invoke("test-ai-provider", {
        body: { providerId, workspaceId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data.status === "success") {
        toast.success(`Provider OK — ${data.latencyMs}ms`);
      } else {
        toast.error(`Provider falhou: ${data.error}`);
      }
      qc.invalidateQueries({ queryKey: ["ai-providers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ═══ Model Catalog ═══
export function useAiModelCatalog() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["ai-model-catalog", activeWorkspace?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.from("ai_model_catalog") as any)
        .select("*")
        .or(`is_global.eq.true,workspace_id.eq.${activeWorkspace?.id}`)
        .order("provider_type,model_id");
      if (error) throw error;
      return data as AiModelCatalogEntry[];
    },
    enabled: !!activeWorkspace,
  });
}

// ═══ Routing Rules ═══
export function useAiRoutingRules() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["ai-routing-rules", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const { data, error } = await (supabase.from("ai_routing_rules") as any)
        .select("*, provider:provider_id(id, provider_name, provider_type, default_model), fallback_provider:fallback_provider_id(id, provider_name)")
        .eq("workspace_id", activeWorkspace!.id)
        .order("execution_priority");
      if (error) throw error;
      return data as AiRoutingRule[];
    },
  });
}

export function useSaveAiRoutingRule() {
  const qc = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (rule: Partial<AiRoutingRule> & { id?: string }) => {
      const payload = {
        task_type: rule.task_type,
        display_name: rule.display_name,
        prompt_template_id: rule.prompt_template_id || null,
        provider_id: rule.provider_id || null,
        model_override: rule.model_override || null,
        recommended_model: rule.recommended_model || null,
        fallback_provider_id: rule.fallback_provider_id || null,
        fallback_model: rule.fallback_model || null,
        is_active: rule.is_active ?? true,
        execution_priority: rule.execution_priority ?? 50,
        updated_at: new Date().toISOString(),
      };

      if (rule.id) {
        const { error } = await (supabase.from("ai_routing_rules") as any).update(payload).eq("id", rule.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from("ai_routing_rules") as any).insert({
          workspace_id: activeWorkspace!.id,
          ...payload,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Regra de routing guardada");
      qc.invalidateQueries({ queryKey: ["ai-routing-rules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteAiRoutingRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("ai_routing_rules") as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra removida");
      qc.invalidateQueries({ queryKey: ["ai-routing-rules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ═══ Provider Health ═══
export function useAiProviderHealth(providerId: string | null) {
  return useQuery({
    queryKey: ["ai-provider-health", providerId],
    enabled: !!providerId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("ai_provider_health_log") as any)
        .select("*")
        .eq("provider_id", providerId!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });
}

// ═══ Constants ═══
export const PROVIDER_TYPES = [
  { value: "gemini_direct", label: "Google Gemini Direct", description: "API direta do Google Gemini (requer GEMINI_API_KEY)" },
  { value: "openai_direct", label: "OpenAI Direct", description: "API direta da OpenAI (requer OPENAI_API_KEY)" },
  { value: "anthropic_direct", label: "Anthropic Direct", description: "API direta da Anthropic Claude (requer ANTHROPIC_API_KEY)" },
  { value: "azure_openai", label: "Azure OpenAI", description: "Azure OpenAI Service (requer endpoint + key)" },
  { value: "ocr_fallback", label: "OCR Engine", description: "Extração apenas por OCR/texto" },
];

export const DEFAULT_TASK_TYPES = [
  { value: "categorization", label: "Classificação de Produto" },
  { value: "attribute_extraction", label: "Extração de Atributos" },
  { value: "description_generation", label: "Geração de Descrição" },
  { value: "seo_optimization", label: "Otimização SEO" },
  { value: "content_translation", label: "Tradução de Conteúdo" },
  { value: "product_validation", label: "Validação de Produto" },
  { value: "supplier_matching", label: "Matching de Fornecedor" },
  { value: "image_analysis", label: "Análise de Imagem" },
  { value: "pdf_extraction", label: "Extração de PDF" },
  { value: "pdf_vision_parse", label: "Parsing Visual PDF" },
  { value: "pdf_layout_analysis", label: "Análise de Layout PDF" },
  { value: "pdf_product_mapping", label: "Mapeamento de Produtos PDF" },
  { value: "bundle_detection", label: "Deteção de Bundles" },
  { value: "variation_detection", label: "Deteção de Variações" },
  { value: "price_optimization", label: "Otimização de Preço" },
];
