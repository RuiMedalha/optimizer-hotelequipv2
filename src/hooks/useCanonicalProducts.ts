import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function useCanonicalProducts() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;
  const qc = useQueryClient();

  const canonicalProducts = useQuery({
    queryKey: ["canonical-products", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("canonical_products") as any)
        .select("*")
        .eq("workspace_id", wsId)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as any[];
    },
  });

  const createCanonical = useMutation({
    mutationFn: async (payload: { canonical_key: string; supplier_id?: string; product_type?: string }) => {
      const { data, error } = await (supabase.from("canonical_products") as any)
        .insert({ workspace_id: wsId, ...payload })
        .select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["canonical-products"] }); toast.success("Produto canónico criado"); },
  });

  return { canonicalProducts, createCanonical, wsId };
}

export function useCanonicalDetail(canonicalProductId: string | null) {
  const fields = useQuery({
    queryKey: ["canonical-fields", canonicalProductId],
    enabled: !!canonicalProductId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("canonical_product_fields") as any)
        .select("*").eq("canonical_product_id", canonicalProductId).order("field_name");
      if (error) throw error;
      return data as any[];
    },
  });

  const sources = useQuery({
    queryKey: ["canonical-sources", canonicalProductId],
    enabled: !!canonicalProductId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("canonical_product_sources") as any)
        .select("*").eq("canonical_product_id", canonicalProductId).order("source_priority");
      if (error) throw error;
      return data as any[];
    },
  });

  const candidates = useQuery({
    queryKey: ["canonical-candidates", canonicalProductId],
    enabled: !!canonicalProductId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("canonical_product_candidates") as any)
        .select("*").eq("canonical_product_id", canonicalProductId).order("match_confidence", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const relationships = useQuery({
    queryKey: ["canonical-relationships", canonicalProductId],
    enabled: !!canonicalProductId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("canonical_product_relationships") as any)
        .select("*").eq("canonical_product_id", canonicalProductId);
      if (error) throw error;
      return data as any[];
    },
  });

  const assets = useQuery({
    queryKey: ["canonical-assets", canonicalProductId],
    enabled: !!canonicalProductId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("canonical_product_assets") as any)
        .select("*").eq("canonical_product_id", canonicalProductId).order("sort_order");
      if (error) throw error;
      return data as any[];
    },
  });

  const logs = useQuery({
    queryKey: ["canonical-logs", canonicalProductId],
    enabled: !!canonicalProductId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("canonical_assembly_logs") as any)
        .select("*").eq("canonical_product_id", canonicalProductId).order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      return data as any[];
    },
  });

  return { fields, sources, candidates, relationships, assets, logs };
}
