import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

const MODE_MODELS: Record<string, Record<string, string>> = {
  economic: { primary: "google/gemini-2.5-flash-lite", fallback: "google/gemini-2.5-flash-lite", vision: "google/gemini-2.5-flash-lite" },
  balanced: { primary: "google/gemini-2.5-flash", fallback: "google/gemini-2.5-flash-lite", vision: "google/gemini-2.5-flash" },
  premium: { primary: "google/gemini-2.5-pro", fallback: "google/gemini-2.5-flash", vision: "google/gemini-2.5-pro" },
};

export function useAiGovernance() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();
  const wsId = activeWorkspace?.id;

  const usageLogs = useQuery({
    queryKey: ["ai-usage-logs", wsId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("ai_usage_logs") as any).select("*").eq("workspace_id", wsId!).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const usageSummary = useQuery({
    queryKey: ["ai-usage-summary", wsId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("ai_usage_logs") as any).select("*").eq("workspace_id", wsId!);
      if (error) throw error;
      const logs = data || [];
      return {
        totalCost: logs.reduce((s: number, l: any) => s + (l.estimated_cost || 0), 0),
        totalInputTokens: logs.reduce((s: number, l: any) => s + (l.input_tokens || 0), 0),
        totalOutputTokens: logs.reduce((s: number, l: any) => s + (l.output_tokens || 0), 0),
        totalRequests: logs.length,
        byModel: logs.reduce((acc: Record<string, number>, l: any) => { acc[l.model_name || "unknown"] = (acc[l.model_name || "unknown"] || 0) + 1; return acc; }, {} as Record<string, number>),
      };
    },
    enabled: !!wsId,
  });

  const profiles = useQuery({
    queryKey: ["ai-execution-profiles", wsId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("ai_execution_profiles") as any).select("*").eq("workspace_id", wsId!).order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const createProfile = useMutation({
    mutationFn: async (mode: string) => {
      const prefs = MODE_MODELS[mode] || MODE_MODELS.balanced;
      await (supabase.from("ai_execution_profiles") as any).update({ is_active: false }).eq("workspace_id", wsId!);
      const { error } = await (supabase.from("ai_execution_profiles") as any).insert({ workspace_id: wsId!, profile_name: `${mode} profile`, mode, model_preferences: prefs, is_active: true });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Perfil criado e ativado"); qc.invalidateQueries({ queryKey: ["ai-execution-profiles"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const activateProfile = useMutation({
    mutationFn: async (profileId: string) => {
      await (supabase.from("ai_execution_profiles") as any).update({ is_active: false }).eq("workspace_id", wsId!);
      const { error } = await (supabase.from("ai_execution_profiles") as any).update({ is_active: true }).eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Perfil ativado"); qc.invalidateQueries({ queryKey: ["ai-execution-profiles"] }); },
  });

  const retryPolicies = useQuery({
    queryKey: ["ai-retry-policies", wsId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("ai_retry_policies") as any).select("*").eq("workspace_id", wsId!).order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const createRetryPolicy = useMutation({
    mutationFn: async (p: { policy_name: string; retry_limit: number; fallback_model: string }) => {
      const { error } = await (supabase.from("ai_retry_policies") as any).insert({ workspace_id: wsId!, ...p });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Política criada"); qc.invalidateQueries({ queryKey: ["ai-retry-policies"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { usageLogs, usageSummary, profiles, createProfile, activateProfile, retryPolicies, createRetryPolicy };
}
