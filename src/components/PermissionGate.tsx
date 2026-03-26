import { ReactNode } from "react";
import { useCurrentMemberRole, hasMinRole, type WorkspaceRole } from "@/hooks/useWorkspaceMembers";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

interface PermissionGateProps {
  minRole: WorkspaceRole;
  workspaceId?: string;
  children: ReactNode;
  fallback?: ReactNode;
  /** If true, renders children disabled instead of hiding */
  disableOnly?: boolean;
}

export function PermissionGate({ minRole, workspaceId, children, fallback = null, disableOnly }: PermissionGateProps) {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = workspaceId || activeWorkspace?.id;
  const { data: role, isLoading } = useCurrentMemberRole(wsId);

  if (isLoading) return null;

  const allowed = hasMinRole(role, minRole);

  if (allowed) return <>{children}</>;

  if (disableOnly) {
    return <div className="opacity-50 pointer-events-none">{children}</div>;
  }

  return <>{fallback}</>;
}
