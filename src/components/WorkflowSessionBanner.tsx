import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveWorkflowRun } from "@/hooks/useActiveWorkflowRun";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { WorkflowRunSelector } from "@/components/WorkflowRunSelector";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, FolderOpen } from "lucide-react";
import { toast } from "sonner";

export function WorkflowSessionBanner() {
  const { activeWorkspace } = useWorkspaceContext();
  const { activeRunId } = useActiveWorkflowRun(activeWorkspace?.id);

  // Notify user when workspace changes so they know the session was cleared
  const prevWorkspaceId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      prevWorkspaceId.current !== undefined &&
      prevWorkspaceId.current !== activeWorkspace?.id
    ) {
      toast.info("Workspace alterado — sessão anterior limpa. Selecione ou crie uma nova sessão.", {
        duration: 5000,
      });
    }
    prevWorkspaceId.current = activeWorkspace?.id;
  }, [activeWorkspace?.id]);

  const { data: activeRun } = useQuery({
    queryKey: ["workflow-run-detail", activeRunId],
    enabled: !!activeRunId,
    queryFn: async () => {
      const { data } = await supabase
        .from("catalog_workflow_runs")
        .select("id, status, created_at, catalog_workflows(workflow_name)")
        .eq("id", activeRunId!)
        .single();
      return data;
    },
  });

  const runName = (activeRun?.catalog_workflows as any)?.workflow_name ?? null;
  const hasSession = !!activeRunId && !!runName;

  return (
    <div className="border-b bg-muted/20 px-4 py-2">
      <div className="flex items-center justify-between gap-4 max-w-full">
        <div className="flex items-center gap-3 min-w-0">
          <FolderOpen className={`w-4 h-4 shrink-0 ${hasSession ? "text-primary" : "text-destructive"}`} />
          {hasSession ? (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium truncate">
                Sessão Ativa: <strong>{runName}</strong>
              </span>
              {activeWorkspace && (
                <Badge variant="secondary" className="text-[10px] shrink-0">
                  {activeWorkspace.name}
                </Badge>
              )}
              {(activeRun as any)?.status && (
                <Badge variant="outline" className="text-[10px] shrink-0 capitalize">
                  {(activeRun as any).status}
                </Badge>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="font-medium">Nenhuma sessão ativa — selecione ou crie uma sessão para continuar</span>
            </div>
          )}
        </div>
        <div className="shrink-0">
          <WorkflowRunSelector />
        </div>
      </div>
    </div>
  );
}
