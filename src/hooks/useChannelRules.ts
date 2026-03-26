import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

// --- Channel Rules ---
export function useChannelRules(channelId: string | null) {
  return useQuery({
    queryKey: ["channel-rules", channelId],
    enabled: !!channelId,
    queryFn: async () => {
      const { data, error } = await supabase.from("channel_rules").select("*").eq("channel_id", channelId!).order("priority");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateChannelRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: any) => {
      const { error } = await supabase.from("channel_rules").insert(params);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Regra criada"); qc.invalidateQueries({ queryKey: ["channel-rules"] }); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateChannelRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...params }: any) => {
      const { error } = await supabase.from("channel_rules").update(params).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["channel-rules"] }); },
  });
}

export function useDeleteChannelRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("channel_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["channel-rules"] }); },
  });
}

// --- Feed Profiles ---
export function useFeedProfiles(channelId: string | null) {
  return useQuery({
    queryKey: ["feed-profiles", channelId],
    enabled: !!channelId,
    queryFn: async () => {
      const { data, error } = await supabase.from("channel_feed_profiles").select("*").eq("channel_id", channelId!).order("created_at");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateFeedProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: any) => {
      const { error } = await supabase.from("channel_feed_profiles").insert(params);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Perfil criado"); qc.invalidateQueries({ queryKey: ["feed-profiles"] }); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteFeedProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("channel_feed_profiles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["feed-profiles"] }); },
  });
}

// --- Rejections ---
export function useChannelRejections(channelId?: string | null) {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["channel-rejections", activeWorkspace?.id, channelId],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      let query = supabase.from("channel_rejections").select("*, channels(channel_name, channel_type), products(sku, original_title)").eq("workspace_id", activeWorkspace!.id).order("created_at", { ascending: false }).limit(100);
      if (channelId) query = query.eq("channel_id", channelId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useResolveRejection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, resolution_note }: { id: string; resolution_note: string }) => {
      const { error } = await supabase.from("channel_rejections").update({ resolved: true, resolution_note, resolved_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Rejeição resolvida"); qc.invalidateQueries({ queryKey: ["channel-rejections"] }); },
  });
}

// --- Rule Learning ---
export function useRuleLearning(channelId?: string | null) {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["rule-learning", activeWorkspace?.id, channelId],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      let query = supabase.from("channel_rule_learning").select("*, channels(channel_name)").eq("workspace_id", activeWorkspace!.id).order("frequency", { ascending: false }).limit(50);
      if (channelId) query = query.eq("channel_id", channelId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useAcceptSuggestedRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ learningId, workspace_id, channel_id, suggested_rule }: any) => {
      // Create the actual rule
      const { error: rErr } = await supabase.from("channel_rules").insert({
        workspace_id,
        channel_id,
        rule_name: `Auto: ${suggested_rule.description || "Regra sugerida"}`,
        rule_type: suggested_rule.rule_type || "validation_rule",
        conditions: suggested_rule.conditions || {},
        actions: suggested_rule.actions || {},
      });
      if (rErr) throw rErr;
      // Mark as accepted
      await supabase.from("channel_rule_learning").update({ accepted_by_user: true }).eq("id", learningId);
    },
    onSuccess: () => {
      toast.success("Regra aceite e criada");
      qc.invalidateQueries({ queryKey: ["rule-learning"] });
      qc.invalidateQueries({ queryKey: ["channel-rules"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// --- Evaluate Rules (preview) ---
export function useEvaluateChannelRules() {
  return useMutation({
    mutationFn: async (params: { product_id: string; channel_id: string; feed_profile_id?: string; workspace_id: string }) => {
      const { data, error } = await supabase.functions.invoke("evaluate-channel-rules", { body: params });
      if (error) throw error;
      return data;
    },
  });
}

// --- Constants ---
export const RULE_TYPES = [
  { value: "title_template", label: "Template de Título" },
  { value: "description_template", label: "Template de Descrição" },
  { value: "exclude_product", label: "Excluir Produto" },
  { value: "require_attribute", label: "Atributo Obrigatório" },
  { value: "fallback_attribute", label: "Atributo Fallback" },
  { value: "category_override", label: "Override de Categoria" },
  { value: "price_adjustment", label: "Ajuste de Preço" },
  { value: "image_selection", label: "Seleção de Imagens" },
  { value: "variant_strategy", label: "Estratégia de Variantes" },
  { value: "feed_cleanup", label: "Limpeza de Feed" },
  { value: "stock_policy", label: "Política de Stock" },
  { value: "shipping_policy", label: "Política de Envio" },
  { value: "validation_rule", label: "Regra de Validação" },
] as const;

export const FEED_TYPES = [
  { value: "marketplace", label: "Marketplace" },
  { value: "merchant_feed", label: "Merchant Feed" },
  { value: "partner_csv", label: "CSV Parceiro" },
  { value: "internal_api", label: "API Interna" },
  { value: "retailer_feed", label: "Feed Retalhista" },
] as const;
