import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useEffect } from "react";

export interface Asset {
  id: string;
  workspace_id: string;
  original_filename: string | null;
  storage_path: string | null;
  public_url: string | null;
  file_hash: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  file_size: number | null;
  format: string | null;
  asset_type: string;
  source_kind: string;
  provider: string | null;
  background_type: string | null;
  quality_score: number | null;
  ai_alt_text: string | null;
  ai_tags: string[] | null;
  parent_asset_id: string | null;
  family_shared: boolean;
  status: string;
  review_status: string;
  created_at: string;
  updated_at: string;
}

export interface AssetProductLink {
  id: string;
  asset_id: string;
  product_id: string;
  usage_context: string;
  sort_order: number;
  created_at: string;
}

export function useAssets(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["assets", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_library" as any)
        .select("*")
        .eq("workspace_id", workspaceId)
        .neq("status", "archived")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as Asset[];
    },
  });
}

export function useAssetDetail(assetId: string | null) {
  return useQuery({
    queryKey: ["asset-detail", assetId],
    enabled: !!assetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_library" as any)
        .select("*")
        .eq("id", assetId)
        .single();
      if (error) throw error;
      return data as unknown as Asset;
    },
  });
}

export function useAssetProductLinks(assetId: string | null) {
  return useQuery({
    queryKey: ["asset-product-links", assetId],
    enabled: !!assetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_product_links" as any)
        .select("*")
        .eq("asset_id", assetId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as AssetProductLink[];
    },
  });
}

export function useProductAssets(productId: string | null) {
  return useQuery({
    queryKey: ["product-assets", productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data: links, error: linkErr } = await supabase
        .from("asset_product_links" as any)
        .select("*")
        .eq("product_id", productId)
        .order("sort_order", { ascending: true });
      if (linkErr) throw linkErr;
      if (!links || links.length === 0) return [];

      const assetIds = (links as any[]).map((l: any) => l.asset_id);
      const { data: assets, error: assetErr } = await supabase
        .from("asset_library" as any)
        .select("*")
        .in("id", assetIds);
      if (assetErr) throw assetErr;

      const assetMap = new Map((assets as any[]).map((a: any) => [a.id, a]));
      return (links as any[]).map((l: any) => ({
        ...l,
        asset: assetMap.get(l.asset_id) || null,
      }));
    },
  });
}

export function useAssetVariants(assetId: string | null) {
  return useQuery({
    queryKey: ["asset-variants", assetId],
    enabled: !!assetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_variants" as any)
        .select("*")
        .eq("source_asset_id", assetId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useRegisterAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      workspaceId: string;
      imageUrl: string;
      productId?: string;
      usageContext?: string;
      sortOrder?: number;
    }) => {
      const { data, error } = await supabase.functions.invoke("manage-assets", {
        body: { action: "register", ...params },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      qc.invalidateQueries({ queryKey: ["product-assets"] });
      if (data.deduplicated) {
        toast.info("Asset já existente — reutilizado (deduplicação por hash).");
      } else {
        toast.success("Asset registado com sucesso.");
      }
    },
    onError: (err: any) => {
      toast.error(err.message || "Erro ao registar asset.");
    },
  });
}

export function useLinkAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      workspaceId: string;
      assetId: string;
      productId: string;
      usageContext?: string;
      sortOrder?: number;
    }) => {
      const { data, error } = await supabase.functions.invoke("manage-assets", {
        body: { action: "link", ...params },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product-assets"] });
      qc.invalidateQueries({ queryKey: ["asset-product-links"] });
      toast.success("Asset associado ao produto.");
    },
    onError: (err: any) => {
      toast.error(err.message || "Erro ao associar asset.");
    },
  });
}

export function useReviewAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { workspaceId: string; assetId: string; reviewStatus: string }) => {
      const { data, error } = await supabase.functions.invoke("manage-assets", {
        body: { action: "review", ...params },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      qc.invalidateQueries({ queryKey: ["asset-detail"] });
      toast.success("Review atualizado.");
    },
  });
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { workspaceId: string; assetId: string }) => {
      const { data, error } = await supabase.functions.invoke("manage-assets", {
        body: { action: "delete", ...params },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast.success("Asset arquivado.");
    },
  });
}

export function useImageJobs(workspaceId: string | undefined) {
  const query = useQuery({
    queryKey: ["image-jobs", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("image_jobs" as any)
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });

  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase
      .channel(`image-jobs-${workspaceId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "image_jobs",
      }, () => {
        query.refetch();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [workspaceId]);

  return query;
}
