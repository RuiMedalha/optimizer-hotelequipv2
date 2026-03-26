import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ── Agents ──
export function useAgents(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["catalog-agents", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_agents" as any)
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agent: { workspace_id: string; agent_name: string; agent_type: string; configuration?: any }) => {
      const { data, error } = await supabase.from("catalog_agents" as any).insert(agent).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catalog-agents"] }); toast.success("Agente criado!"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateAgentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("catalog_agents" as any).update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catalog-agents"] }); toast.success("Estado atualizado!"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ── Tasks ──
export function useAgentTasks(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["agent-tasks", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_tasks" as any)
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

// ── Actions ──
export function useAgentActions(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["agent-actions", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_actions" as any)
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

// ── Policies ──
export function useAgentPolicies(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["agent-policies", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_policies" as any)
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useCreatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (policy: { workspace_id: string; agent_type: string; policy_name: string; conditions?: any; actions?: any; requires_approval?: boolean }) => {
      const { data, error } = await supabase.from("agent_policies" as any).insert(policy).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["agent-policies"] }); toast.success("Política criada!"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ── Schedules ──
export function useAgentSchedules(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["agent-schedules", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_schedules" as any)
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

// ── Run Agent Cycle ──
export function useRunAgentCycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId }: { workspaceId: string }) => {
      const { data, error } = await supabase.functions.invoke("run-agent-cycle", { body: { workspaceId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agent-tasks"] });
      qc.invalidateQueries({ queryKey: ["agent-actions"] });
      toast.success(`Ciclo concluído: ${data?.executed || 0} tarefas executadas`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ── Approve/Reject Action ──
export function useApproveAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ actionId, approved }: { actionId: string; approved: boolean }) => {
      const { data, error } = await supabase.functions.invoke("learn-agent-decisions", { body: { actionId, approved } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["agent-actions"] });
      toast.success(vars.approved ? "Ação aprovada!" : "Ação rejeitada");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
