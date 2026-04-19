import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/auth-context";
import { toast } from "sonner";

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
export type MemberStatus = "pending" | "active" | "revoked";

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string | null;
  email: string;
  role: WorkspaceRole;
  invited_by: string | null;
  invited_at: string;
  accepted_at: string | null;
  status: MemberStatus;
  created_at: string;
}

export interface WorkspaceInvitation {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceRole;
  token: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  status: string;
}

export function useWorkspaceMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["workspace-members", workspaceId],
    enabled: !!workspaceId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_members")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .neq("status", "revoked")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as WorkspaceMember[];
    },
  });
}

export function useWorkspaceInvitations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["workspace-invitations", workspaceId],
    enabled: !!workspaceId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_invitations_safe" as any)
        .select("*")
        .eq("workspace_id", workspaceId!)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as WorkspaceInvitation[];
    },
  });
}

export function useCurrentMemberRole(workspaceId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["workspace-my-role", workspaceId, user?.id],
    enabled: !!workspaceId && !!user,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_members")
        .select("role, status")
        .eq("workspace_id", workspaceId!)
        .eq("user_id", user!.id)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      return (data?.role as WorkspaceRole) || null;
    },
  });
}

const ROLE_RANK: Record<WorkspaceRole, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };

export function hasMinRole(currentRole: WorkspaceRole | null | undefined, minRole: WorkspaceRole): boolean {
  if (!currentRole) return false;
  return (ROLE_RANK[currentRole] || 0) >= (ROLE_RANK[minRole] || 0);
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId, email, role }: { workspaceId: string; email: string; role: WorkspaceRole }) => {
      const { data, error } = await supabase.functions.invoke("invite-workspace-member", {
        body: { workspaceId, email, role },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_, { workspaceId }) => {
      qc.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
      qc.invalidateQueries({ queryKey: ["workspace-invitations", workspaceId] });
      toast.success("Convite enviado com sucesso!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useManageMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { action: string; workspaceId: string; memberId?: string; invitationId?: string; role?: string }) => {
      const { data, error } = await supabase.functions.invoke("manage-workspace-members", { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_, { workspaceId, action }) => {
      qc.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
      qc.invalidateQueries({ queryKey: ["workspace-invitations", workspaceId] });
      const msgs: Record<string, string> = {
        "update-role": "Role atualizada!",
        "remove-member": "Membro removido!",
        "revoke-invitation": "Convite revogado!",
      };
      toast.success(msgs[action] || "Operação concluída!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
