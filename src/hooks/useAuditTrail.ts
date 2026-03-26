import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AuditEntityType = "product" | "category" | "channel" | "settings" | "member" | "workspace" | "asset" | "job";
export type AuditAction = "create" | "update" | "delete" | "publish" | "approve" | "reject" | "restore" | "optimize" | "enrich" | "import";

export interface AuditEntry {
  id: string;
  workspace_id: string | null;
  user_id: string;
  entity_type: AuditEntityType;
  entity_id: string;
  action: AuditAction;
  field_changes: Record<string, { before?: any; after?: any }>;
  metadata: Record<string, any>;
  created_at: string;
}

export function useAuditTrail(entityType?: AuditEntityType, entityId?: string) {
  return useQuery({
    queryKey: ["audit-trail", entityType, entityId],
    enabled: !!entityId,
    queryFn: async () => {
      let query = supabase
        .from("audit_trail" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (entityType) query = query.eq("entity_type", entityType);
      if (entityId) query = query.eq("entity_id", entityId);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as AuditEntry[];
    },
  });
}

export function useLogAudit() {
  return useMutation({
    mutationFn: async ({
      entityType,
      entityId,
      action,
      fieldChanges,
      metadata,
      workspaceId,
    }: {
      entityType: AuditEntityType;
      entityId: string;
      action: AuditAction;
      fieldChanges?: Record<string, { before?: any; after?: any }>;
      metadata?: Record<string, any>;
      workspaceId?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("audit_trail" as any).insert({
        user_id: user.id,
        workspace_id: workspaceId || null,
        entity_type: entityType,
        entity_id: entityId,
        action,
        field_changes: fieldChanges || {},
        metadata: metadata || {},
      });
      if (error) throw error;
    },
  });
}
