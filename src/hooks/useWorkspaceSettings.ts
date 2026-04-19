import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

// ── AI Settings ──
export function useWorkspaceAiSettings() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;

  return useQuery({
    queryKey: ["workspace-ai-settings", wsId],
    enabled: !!wsId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_ai_settings" as any)
        .select("*")
        .eq("workspace_id", wsId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveWorkspaceAiSettings() {
  const qc = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (settings: Record<string, any>) => {
      const wsId = activeWorkspace?.id;
      if (!wsId) throw new Error("Workspace não selecionado");
      const { error } = await supabase
        .from("workspace_ai_settings" as any)
        .upsert({ workspace_id: wsId, ...settings, updated_at: new Date().toISOString() }, { onConflict: "workspace_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace-ai-settings"] });
      toast.success("Configurações AI guardadas!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

// ── Notification Settings ──
export function useWorkspaceNotificationSettings() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;

  return useQuery({
    queryKey: ["workspace-notification-settings", wsId],
    enabled: !!wsId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_notification_settings" as any)
        .select("*")
        .eq("workspace_id", wsId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveWorkspaceNotificationSettings() {
  const qc = useQueryClient();
  const { activeWorkspace } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (settings: Record<string, any>) => {
      const wsId = activeWorkspace?.id;
      if (!wsId) throw new Error("Workspace não selecionado");
      const { error } = await supabase
        .from("workspace_notification_settings" as any)
        .upsert({ workspace_id: wsId, ...settings, updated_at: new Date().toISOString() }, { onConflict: "workspace_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace-notification-settings"] });
      toast.success("Configurações de notificações guardadas!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

// ── Supplier Configs ──
export function useWorkspaceSupplierConfigs() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;

  return useQuery({
    queryKey: ["workspace-supplier-configs", wsId],
    enabled: !!wsId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_supplier_configs" as any)
        .select("*")
        .eq("workspace_id", wsId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

// ── Prompt Profiles ──
export function useWorkspacePromptProfiles() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;

  return useQuery({
    queryKey: ["workspace-prompt-profiles", wsId],
    enabled: !!wsId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_prompt_profiles" as any)
        .select("*")
        .eq("workspace_id", wsId)
        .order("field_key", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
}

// ── Publish Profiles ──
export function useWorkspacePublishProfiles() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;

  return useQuery({
    queryKey: ["workspace-publish-profiles", wsId],
    enabled: !!wsId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_publish_profiles" as any)
        .select("*")
        .eq("workspace_id", wsId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}
