import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toast } from "sonner";

export interface SeoLifecycleRecord {
  id: string;
  product_id: string;
  sku: string | null;
  lifecycle_phase: string;
  discontinued_at: string | null;
  pending_redirect_at: string | null;
  redirect_target_type: string | null;
  redirect_target_url: string | null;
  days_before_redirect: number | null;
  noindex_at: string | null;
  previous_slug: string | null;
  previous_url: string | null;
  current_url: string | null;
  alternative_product_ids: string[] | null;
  workspace_id: string;
  created_at: string;
  updated_at: string;
  // joined
  product?: {
    original_title: string | null;
    optimized_title: string | null;
    sku: string | null;
    status: string | null;
  };
}

export interface SeoRedirect {
  id: string;
  product_id: string | null;
  source_url: string;
  destination_url: string;
  redirect_type: number;
  status: string;
  reason: string | null;
  workspace_id: string;
  created_at: string;
  applied_at: string | null;
}

export interface SeoLifecycleLog {
  id: string;
  product_id: string | null;
  event_type: string;
  old_phase: string | null;
  new_phase: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export function useSeoLifecycleList(workspaceId: string | undefined, phaseFilter?: string) {
  return useQuery({
    queryKey: ["seo-lifecycle", workspaceId, phaseFilter],
    enabled: !!workspaceId,
    queryFn: async () => {
      let query = supabase
        .from("product_seo_lifecycle" as any)
        .select("*, product:products(original_title, optimized_title, sku, status)")
        .eq("workspace_id", workspaceId!)
        .order("updated_at", { ascending: false });

      if (phaseFilter && phaseFilter !== "all") {
        query = query.eq("lifecycle_phase", phaseFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as SeoLifecycleRecord[];
    },
  });
}

export function useSeoRedirects(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["seo-redirects", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_redirects" as any)
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as SeoRedirect[];
    },
  });
}

export function useSeoLifecycleLogs(workspaceId: string | undefined, productId?: string) {
  return useQuery({
    queryKey: ["seo-lifecycle-logs", workspaceId, productId],
    enabled: !!workspaceId,
    queryFn: async () => {
      let query = supabase
        .from("seo_lifecycle_logs" as any)
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false })
        .limit(100);

      if (productId) {
        query = query.eq("product_id", productId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as SeoLifecycleLog[];
    },
  });
}

export function useSeoLifecycleConfig(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["seo-lifecycle-config", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seo_lifecycle_config" as any)
        .select("*")
        .eq("workspace_id", workspaceId!)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });
}

export function useSeoLifecycleAction() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      action: "discontinue" | "force_redirect" | "restore" | "bulk_import";
      workspace_id: string;
      product_id?: string;
      destination_url?: string;
      days_override?: number;
      items?: any[];
    }) => {
      return invokeEdgeFunction("seo-lifecycle-engine", { body: params });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["seo-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["seo-redirects"] });
      qc.invalidateQueries({ queryKey: ["seo-lifecycle-logs"] });
      qc.invalidateQueries({ queryKey: ["products"] });

      const msgs: Record<string, string> = {
        discontinue: "Produto marcado como descontinuado",
        force_redirect: "Redireccionamento forçado aplicado",
        restore: "Produto restaurado para ativo",
        bulk_import: "Importação em massa processada",
      };
      toast.success(msgs[vars.action] || "Ação executada");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useSeoLifecycleStats(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["seo-lifecycle-stats", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_seo_lifecycle" as any)
        .select("lifecycle_phase")
        .eq("workspace_id", workspaceId!);
      if (error) throw error;

      const stats = { active: 0, discontinued: 0, pending_redirect: 0, redirected: 0 };
      for (const row of data || []) {
        const phase = (row as any).lifecycle_phase as keyof typeof stats;
        if (phase in stats) stats[phase]++;
      }
      return stats;
    },
  });
}
