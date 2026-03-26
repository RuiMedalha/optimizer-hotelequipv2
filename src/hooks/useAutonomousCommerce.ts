import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function useAutonomousCommerce() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();
  const wid = activeWorkspace?.id;

  const actions = useQuery({
    queryKey: ["autonomous-actions", wid],
    enabled: !!wid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("autonomous_actions")
        .select("*")
        .eq("workspace_id", wid!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const logs = useQuery({
    queryKey: ["autonomous-logs", wid],
    enabled: !!wid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("autonomous_execution_logs")
        .select("*")
        .eq("workspace_id", wid!)
        .order("executed_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const guardrails = useQuery({
    queryKey: ["autonomous-guardrails", wid],
    enabled: !!wid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("autonomous_guardrails")
        .select("*")
        .eq("workspace_id", wid!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const executeAction = useMutation({
    mutationFn: async (action_id: string) => {
      const { data, error } = await supabase.functions.invoke("execute-autonomous-action", {
        body: { workspace_id: wid, action_id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Ação executada");
      qc.invalidateQueries({ queryKey: ["autonomous-actions", wid] });
      qc.invalidateQueries({ queryKey: ["autonomous-logs", wid] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const scheduleActions = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("schedule-autonomous-actions", {
        body: { workspace_id: wid },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Ações agendadas");
      qc.invalidateQueries({ queryKey: ["autonomous-actions", wid] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const approveAction = useMutation({
    mutationFn: async (action_id: string) => {
      const { error } = await supabase
        .from("autonomous_actions")
        .update({ status: "approved" as any })
        .eq("id", action_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ação aprovada");
      qc.invalidateQueries({ queryKey: ["autonomous-actions", wid] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cancelAction = useMutation({
    mutationFn: async (action_id: string) => {
      const { error } = await supabase
        .from("autonomous_actions")
        .update({ status: "cancelled" as any })
        .eq("id", action_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ação cancelada");
      qc.invalidateQueries({ queryKey: ["autonomous-actions", wid] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const addGuardrail = useMutation({
    mutationFn: async (params: { guardrail_type: string; rule_payload: any }) => {
      const { error } = await supabase.from("autonomous_guardrails").insert({
        workspace_id: wid!,
        guardrail_type: params.guardrail_type,
        rule_payload: params.rule_payload,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Guardrail adicionado");
      qc.invalidateQueries({ queryKey: ["autonomous-guardrails", wid] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleGuardrail = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("autonomous_guardrails")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autonomous-guardrails", wid] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return {
    actions, logs, guardrails,
    executeAction, scheduleActions, approveAction, cancelAction,
    addGuardrail, toggleGuardrail,
  };
}
