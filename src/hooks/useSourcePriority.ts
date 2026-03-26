import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

export function useSourcePriority() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();
  const wsId = activeWorkspace?.id;

  const profiles = useQuery({
    queryKey: ["source-priority-profiles", wsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("source_priority_profiles")
        .select("*")
        .eq("workspace_id", wsId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!wsId,
  });

  const createProfile = useMutation({
    mutationFn: async (params: { profileName: string; isDefault?: boolean }) => {
      const { data, error } = await supabase
        .from("source_priority_profiles")
        .insert({ workspace_id: wsId!, profile_name: params.profileName, is_default: params.isDefault || false })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success("Perfil criado"); qc.invalidateQueries({ queryKey: ["source-priority-profiles"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const useProfileRules = (profileId: string | null) =>
    useQuery({
      queryKey: ["source-priority-rules", profileId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("source_priority_rules")
          .select("*")
          .eq("profile_id", profileId!)
          .order("field_name");
        if (error) throw error;
        return data;
      },
      enabled: !!profileId,
    });

  const upsertRule = useMutation({
    mutationFn: async (rule: { profile_id: string; field_name: string; primary_source: string; secondary_source?: string; fallback_source?: string; confidence_weight?: number }) => {
      const { data, error } = await supabase
        .from("source_priority_rules")
        .upsert(rule, { onConflict: "id" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success("Regra guardada"); qc.invalidateQueries({ queryKey: ["source-priority-rules"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const confidenceLogs = (productId: string | null) =>
    useQuery({
      queryKey: ["source-confidence-logs", productId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("source_confidence_logs")
          .select("*")
          .eq("product_id", productId!)
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        return data;
      },
      enabled: !!productId,
    });

  return { profiles, createProfile, useProfileRules, upsertRule, confidenceLogs };
}
