import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

export function useControlTower() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;
  const qc = useQueryClient();

  const alerts = useQuery({
    queryKey: ["control-tower-alerts", wsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("control_tower_alerts")
        .select("*")
        .eq("workspace_id", wsId!)
        .eq("status", "open")
        .order("severity", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const snapshots = useQuery({
    queryKey: ["control-tower-snapshots", wsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("control_tower_snapshots")
        .select("*")
        .eq("workspace_id", wsId!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const buildSnapshot = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("build-control-tower-snapshot", {
        body: { workspace_id: wsId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["control-tower-snapshots", wsId] }),
  });

  const generateAlerts = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-control-tower-alerts", {
        body: { workspace_id: wsId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["control-tower-alerts", wsId] }),
  });

  const summarize = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("summarize-workspace-operations", {
        body: { workspace_id: wsId },
      });
      if (error) throw error;
      return data;
    },
  });

  const getQueues = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-operational-queues", {
        body: { workspace_id: wsId },
      });
      if (error) throw error;
      return data;
    },
  });

  const acknowledgeAlert = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from("control_tower_alerts")
        .update({ status: "acknowledged" as any })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["control-tower-alerts", wsId] }),
  });

  const resolveAlert = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from("control_tower_alerts")
        .update({ status: "resolved" as any, resolved_at: new Date().toISOString() })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["control-tower-alerts", wsId] }),
  });

  return {
    alerts, snapshots, buildSnapshot, generateAlerts,
    summarize, getQueues, acknowledgeAlert, resolveAlert,
  };
}
