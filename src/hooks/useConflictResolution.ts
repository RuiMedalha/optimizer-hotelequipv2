import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function useConflictResolution() {
  const { activeWorkspace } = useWorkspaceContext();
  const workspaceId = activeWorkspace?.id;
  const queryClient = useQueryClient();

  const conflictsQuery = useQuery({
    queryKey: ["conflict-cases", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conflict_cases")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });

  const reviewTasksQuery = useQuery({
    queryKey: ["human-review-tasks", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("human_review_tasks")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("priority", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });

  const resolutionRulesQuery = useQuery({
    queryKey: ["conflict-resolution-rules", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conflict_resolution_rules")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("rule_priority", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });

  const publishApprovalRulesQuery = useQuery({
    queryKey: ["publish-approval-rules", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("publish_approval_rules")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!workspaceId,
  });

  const detectConflicts = useMutation({
    mutationFn: async (params: { canonical_product_id?: string; product_id?: string; supplier_id?: string }) => {
      const { data, error } = await supabase.functions.invoke("detect-conflicts", {
        body: { workspace_id: workspaceId, ...params },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`${data.conflicts_detected} conflito(s) detetado(s)`);
      queryClient.invalidateQueries({ queryKey: ["conflict-cases"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const attemptAutoResolution = useMutation({
    mutationFn: async (conflict_case_id: string) => {
      const { data, error } = await supabase.functions.invoke("attempt-auto-resolution", {
        body: { workspace_id: workspaceId, conflict_case_id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(data.resolved ? "Conflito resolvido automaticamente" : "Escalado para revisão humana");
      queryClient.invalidateQueries({ queryKey: ["conflict-cases"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const submitDecision = useMutation({
    mutationFn: async (params: { review_task_id: string; decision_type: string; decision_reason?: string; field_overrides?: any; approved_by: string }) => {
      const { data, error } = await supabase.functions.invoke("submit-review-decision", { body: params });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Decisão registada com sucesso");
      queryClient.invalidateQueries({ queryKey: ["human-review-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["conflict-cases"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const evaluatePublishApproval = useMutation({
    mutationFn: async (params: { product_id: string; channel_id?: string }) => {
      const { data, error } = await supabase.functions.invoke("evaluate-publish-approval", {
        body: { workspace_id: workspaceId, ...params },
      });
      if (error) throw error;
      return data;
    },
  });

  const resolveConflictCase = useMutation({
    mutationFn: async (params: { conflict_case_id: string; resolution_source?: string; resolution_action?: string }) => {
      const { data, error } = await supabase.functions.invoke("resolve-conflict-case", { body: params });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Conflito resolvido");
      queryClient.invalidateQueries({ queryKey: ["conflict-cases"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return {
    conflicts: conflictsQuery.data || [],
    reviewTasks: reviewTasksQuery.data || [],
    resolutionRules: resolutionRulesQuery.data || [],
    publishApprovalRules: publishApprovalRulesQuery.data || [],
    isLoading: conflictsQuery.isLoading,
    detectConflicts,
    attemptAutoResolution,
    submitDecision,
    evaluatePublishApproval,
    resolveConflictCase,
  };
}
