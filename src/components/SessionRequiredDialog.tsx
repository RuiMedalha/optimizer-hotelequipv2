import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useActiveWorkflowRun } from "@/hooks/useActiveWorkflowRun";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FolderOpen, Plus, CheckCircle, Clock } from "lucide-react";

interface SessionRequiredDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId?: string;
}

export function SessionRequiredDialog({
  open,
  onOpenChange,
  workspaceId,
}: SessionRequiredDialogProps) {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = workspaceId ?? activeWorkspace?.id;

  const { activeRunId, setActiveRun, createNewSession } = useActiveWorkflowRun(wsId);
  const [newName, setNewName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Fetch recent sessions — same query pattern as WorkflowRunSelector
  const { data: recentRuns } = useQuery({
    queryKey: ["workflow-runs-recent", wsId],
    enabled: open && !!wsId,
    queryFn: async () => {
      const { data } = await supabase
        .from("catalog_workflow_runs")
        .select("id, created_at, catalog_workflows(workflow_name)")
        .eq("workspace_id", wsId!)
        .in("status", ["running", "paused"])
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  const runName = (run: any) =>
    (run?.catalog_workflows as any)?.workflow_name ?? "Sessão sem nome";

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !wsId) return;
    setIsCreating(true);
    try {
      await createNewSession(name, wsId);
      toast.success(`Sessão "${name}" criada.`);
      setNewName("");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao criar sessão");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSelect = (runId: string) => {
    setActiveRun(runId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-primary" />
            Sessão de Trabalho Necessária
          </DialogTitle>
          <DialogDescription>
            Seleciona uma sessão existente ou cria uma nova para continuar. Os
            dados importados ficam organizados por sessão.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Existing sessions — same pattern as WorkflowRunSelector */}
          {recentRuns && recentRuns.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Sessões Activas
              </p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {recentRuns.map((run: any) => (
                  <button
                    key={run.id}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left hover:bg-accent transition-colors",
                      run.id === activeRunId && "bg-primary/10 text-primary font-medium"
                    )}
                    onClick={() => handleSelect(run.id)}
                  >
                    {run.id === activeRunId ? (
                      <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{runName(run)}</span>
                    <Badge variant="outline" className="text-[10px] ml-auto shrink-0">
                      {new Date(run.created_at).toLocaleDateString("pt-PT")}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Create new session */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Nova Sessão
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="Ex: TEFCOLD 2026"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="h-9"
              />
              <Button
                size="sm"
                className="h-9 px-4 shrink-0"
                disabled={!newName.trim() || isCreating || !wsId}
                onClick={handleCreate}
              >
                <Plus className="w-4 h-4 mr-1" />
                Criar
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
