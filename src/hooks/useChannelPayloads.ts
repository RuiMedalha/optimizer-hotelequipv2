import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function useChannelPayloads() {
  const { activeWorkspace } = useWorkspaceContext();
  const workspaceId = activeWorkspace?.id;
  const queryClient = useQueryClient();

  const payloadsQuery = useQuery({
    queryKey: ["channel-payloads", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channel_payloads")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });

  const snapshotsQuery = useQuery({
    queryKey: ["channel-sync-snapshots", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channel_sync_snapshots")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });

  const buildPayload = useMutation({
    mutationFn: async (params: { channel_id: string; canonical_product_id: string }) => {
      const { data, error } = await supabase.functions.invoke("build-channel-payload", {
        body: { workspace_id: workspaceId, ...params },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Payload gerado com sucesso");
      queryClient.invalidateQueries({ queryKey: ["channel-payloads"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const validatePayload = useMutation({
    mutationFn: async (channel_payload_id: string) => {
      const { data, error } = await supabase.functions.invoke("validate-channel-payload", {
        body: { channel_payload_id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data.status === "validated") toast.success("Payload validado");
      else toast.warning(`${data.errors.length} erro(s) de validação`);
      queryClient.invalidateQueries({ queryKey: ["channel-payloads"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rebuildPayload = useMutation({
    mutationFn: async (params: { channel_id: string; canonical_product_id: string }) => {
      const { data, error } = await supabase.functions.invoke("rebuild-channel-payload", {
        body: { workspace_id: workspaceId, ...params },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Payload reconstruído");
      queryClient.invalidateQueries({ queryKey: ["channel-payloads"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return {
    payloads: payloadsQuery.data || [],
    snapshots: snapshotsQuery.data || [],
    isLoading: payloadsQuery.isLoading,
    buildPayload,
    validatePayload,
    rebuildPayload,
  };
}
