import { Badge } from "@/components/ui/badge";
import type { WorkspaceRole } from "@/hooks/useWorkspaceMembers";

const roleConfig: Record<WorkspaceRole, { label: string; className: string }> = {
  owner: { label: "Owner", className: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400" },
  admin: { label: "Admin", className: "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-400" },
  editor: { label: "Editor", className: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-400" },
  viewer: { label: "Viewer", className: "bg-muted text-muted-foreground border-border" },
};

export function MemberRoleBadge({ role }: { role: WorkspaceRole }) {
  const config = roleConfig[role] || roleConfig.viewer;
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
}
