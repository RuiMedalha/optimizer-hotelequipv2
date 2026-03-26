import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

// --- Channels ---
export function useChannels() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["channels", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channels")
        .select("*")
        .eq("workspace_id", activeWorkspace!.id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { workspace_id: string; channel_name: string; channel_type: "woocommerce" | "shopify" | "amazon" | "google_merchant" | "csv_export" | "api_endpoint" | "marketplace"; config?: any }) => {
      const { error } = await supabase.from("channels").insert(params);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Canal criado"); qc.invalidateQueries({ queryKey: ["channels"] }); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("channels").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["channels"] }); },
  });
}

// --- Connections ---
export function useChannelConnections(channelId: string | null) {
  return useQuery({
    queryKey: ["channel-connections", channelId],
    enabled: !!channelId,
    queryFn: async () => {
      const { data, error } = await supabase.from("channel_connections").select("*").eq("channel_id", channelId!);
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: any) => {
      const { error } = await supabase.from("channel_connections").insert(params);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Conexão criada"); qc.invalidateQueries({ queryKey: ["channel-connections"] }); },
    onError: (e: any) => toast.error(e.message),
  });
}

// --- Field Mappings ---
export function useFieldMappings(channelId: string | null) {
  return useQuery({
    queryKey: ["channel-field-mappings", channelId],
    enabled: !!channelId,
    queryFn: async () => {
      const { data, error } = await supabase.from("channel_field_mappings").select("*").eq("channel_id", channelId!);
      if (error) throw error;
      return data;
    },
  });
}

export function useUpsertFieldMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: any) => {
      const { error } = await supabase.from("channel_field_mappings").upsert(params);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["channel-field-mappings"] }); },
  });
}

export function useDeleteFieldMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("channel_field_mappings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["channel-field-mappings"] }); },
  });
}

// --- Category Mappings ---
export function useCategoryMappings(channelId: string | null) {
  return useQuery({
    queryKey: ["channel-category-mappings", channelId],
    enabled: !!channelId,
    queryFn: async () => {
      const { data, error } = await supabase.from("channel_category_mappings").select("*").eq("channel_id", channelId!);
      if (error) throw error;
      return data;
    },
  });
}

export function useUpsertCategoryMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: any) => {
      const { error } = await supabase.from("channel_category_mappings").upsert(params);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["channel-category-mappings"] }); },
  });
}

// --- Attribute Mappings ---
export function useAttributeMappings(channelId: string | null) {
  return useQuery({
    queryKey: ["channel-attribute-mappings", channelId],
    enabled: !!channelId,
    queryFn: async () => {
      const { data, error } = await supabase.from("channel_attribute_mappings").select("*").eq("channel_id", channelId!);
      if (error) throw error;
      return data;
    },
  });
}

// --- Channel Product Data ---
export function useChannelProductData(productId: string | null) {
  return useQuery({
    queryKey: ["channel-product-data", productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data, error } = await supabase.from("channel_product_data").select("*, channels(channel_name, channel_type)").eq("product_id", productId!);
      if (error) throw error;
      return data;
    },
  });
}

// --- Publish Jobs ---
export function useChannelPublishJobs() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["channel-publish-jobs", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channel_publish_jobs")
        .select("*, channels(channel_name, channel_type)")
        .eq("workspace_id", activeWorkspace!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });
}

export function useChannelPublishJobItems(jobId: string | null) {
  return useQuery({
    queryKey: ["channel-publish-job-items", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase.from("channel_publish_job_items").select("*").eq("job_id", jobId!);
      if (error) throw error;
      return data;
    },
  });
}

// --- Publish Actions ---
export function usePublishToChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { product_id: string; channel_id: string; workspace_id: string; user_id: string; locale?: string }) => {
      const { data, error } = await supabase.functions.invoke("publish-to-channel", { body: params });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Publicado com sucesso");
      qc.invalidateQueries({ queryKey: ["channel-product-data"] });
    },
    onError: (e: any) => toast.error(e.message || "Erro na publicação"),
  });
}

export function usePublishBatchToChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { channel_id: string; workspace_id: string; user_id: string; product_ids: string[]; locale?: string }) => {
      const { data, error } = await supabase.functions.invoke("publish-batch-to-channel", { body: params });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Job de publicação iniciado");
      qc.invalidateQueries({ queryKey: ["channel-publish-jobs"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// --- Constants ---
export const CHANNEL_TYPES = [
  { value: "woocommerce", label: "WooCommerce", icon: "🛒" },
  { value: "shopify", label: "Shopify", icon: "🟢" },
  { value: "amazon", label: "Amazon", icon: "📦" },
  { value: "google_merchant", label: "Google Merchant", icon: "🔍" },
  { value: "csv_export", label: "CSV Export", icon: "📄" },
  { value: "api_endpoint", label: "API Endpoint", icon: "🔗" },
  { value: "marketplace", label: "Marketplace", icon: "🏪" },
] as const;

export const CANONICAL_FIELDS = [
  "title", "description", "short_description", "meta_title", "meta_description",
  "slug", "price", "sale_price", "sku", "category", "tags", "images", "attributes", "faq",
];
