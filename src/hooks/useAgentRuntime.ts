import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

export function useAgentRuntime() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;
  const qc = useQueryClient();

  const runs = useQuery({
    queryKey: ["agent-runs", wsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_runs")
        .select("*")
        .eq("workspace_id", wsId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const alerts = useQuery({
    queryKey: ["agent-runtime-alerts", wsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_runtime_alerts")
        .select("*")
        .eq("workspace_id", wsId!)
        .eq("status", "open")
        .order("severity", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const summarize = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("summarize-agent-runtime", {
        body: { workspace_id: wsId },
      });
      if (error) throw error;
      return data;
    },
  });

  const generateAlerts = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-agent-runtime-alerts", {
        body: { workspace_id: wsId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-runtime-alerts", wsId] }),
  });

  const submitFeedback = useMutation({
    mutationFn: async (params: { agent_run_id: string; feedback_type: string; feedback_score?: number }) => {
      const { data, error } = await supabase.functions.invoke("record-agent-feedback", { body: params });
      if (error) throw error;
      return data;
    },
  });

  const resolveAlert = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from("agent_runtime_alerts")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-runtime-alerts", wsId] }),
  });

  return { runs, alerts, summarize, generateAlerts, submitFeedback, resolveAlert };
}
