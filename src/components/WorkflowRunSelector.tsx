import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveWorkflowRun } from "@/hooks/useActiveWorkflowRun";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FolderOpen, Plus, ChevronDown, CheckCircle, Clock, Pencil, Trash2, Check, X } from "lucide-react";

export function WorkflowRunSelector() {
  const { activeWorkspace } = useWorkspaceContext();
  const { activeRunId, setActiveRun, createNewSession, clearActiveRun } = useActiveWorkflowRun(activeWorkspace?.id);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Fetch current active run details
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

  // Fetch recent runs for selection
  const { data: recentRuns } = useQuery({
    queryKey: ["workflow-runs-recent", activeWorkspace?.id],
    enabled: open && !!activeWorkspace?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("catalog_workflow_runs")
        .select("id, created_at, catalog_workflows(id, workflow_name)")
        .eq("workspace_id", activeWorkspace!.id)
        .in("status", ["running", "paused"])
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !activeWorkspace) return;
    setIsCreating(true);
    try {
      await createNewSession(name, activeWorkspace.id);
      toast.success(`Sessão "${name}" criada.`);
      setNewName("");
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao criar sessão");
    } finally {
      setIsCreating(false);
    }
  };

  const handleRename = async (runId: string, workflowId: string) => {
    if (isRenaming) return;
    if (!workflowId) { toast.error("ID do workflow inválido"); return; }
    const name = editName.trim();
    if (!name) return;
    setIsRenaming(true);
    try {
      const { error } = await supabase
        .from("catalog_workflows")
        .update({ workflow_name: name })
        .eq("id", workflowId);
      if (error) throw error;
      toast.success(`Sessão renomeada para "${name}".`);
      setEditingRunId(null);
      queryClient.invalidateQueries({ queryKey: ["workflow-runs-recent"] });
      queryClient.invalidateQueries({ queryKey: ["workflow-run-detail", runId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao renomear sessão");
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDelete = async (runId: string, workflowId: string) => {
    if (!workflowId) { toast.error("ID do workflow inválido"); return; }
    if (!window.confirm("Apagar esta sessão? Os produtos associados ficam sem sessão.")) return;
    setIsDeleting(runId);
    try {
      // 1. Disconnect products from session (safe regardless of FK type)
      const { error: productErr } = await (supabase
        .from("products") as any)
        .update({ workflow_run_id: null })
        .eq("workflow_run_id", runId);
      if (productErr) throw productErr;

      // 2. Delete the run
      const { error: runErr } = await supabase
        .from("catalog_workflow_runs")
        .delete()
        .eq("id", runId);
      if (runErr) throw runErr;

      // 3. Delete the workflow
      const { error: workflowErr } = await supabase
        .from("catalog_workflows")
        .delete()
        .eq("id", workflowId);
      if (workflowErr) throw workflowErr;

      // 4. If this was the active session, clear it
      if (runId === activeRunId) clearActiveRun();

      toast.success("Sessão apagada.");
      queryClient.invalidateQueries({ queryKey: ["workflow-runs-recent"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao apagar sessão");
    } finally {
      setIsDeleting(null);
    }
  };

  const runName = (run: any) =>
    (run?.catalog_workflows as any)?.workflow_name ?? "Sessão sem nome";

  const hasSession = !!activeRunId && !!activeRun;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
      <FolderOpen className={cn("w-4 h-4 shrink-0", hasSession ? "text-primary" : "text-muted-foreground")} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-muted-foreground">Sessão de Trabalho</p>
        {hasSession ? (
          <p className="text-sm font-semibold truncate">{runName(activeRun)}</p>
        ) : (
          <p className="text-sm text-destructive font-medium">Nenhuma sessão ativa — necessário para importar</p>
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="shrink-0 gap-1">
            {hasSession ? "Trocar" : "Selecionar"}
            <ChevronDown className="w-3 h-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3 space-y-4" align="end">
          {/* Create new session */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nova Sessão</p>
            <div className="flex gap-2">
              <Input
                placeholder="Nome da sessão..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="h-8 text-sm"
              />
              <Button
                size="sm"
                className="h-8 px-3 shrink-0"
                disabled={!newName.trim() || isCreating || !activeWorkspace}
                onClick={handleCreate}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* Recent runs */}
          {recentRuns && recentRuns.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sessões Recentes</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {recentRuns.map((run: any) => (
                  <div key={run.id} className="flex items-center gap-1">
                    {editingRunId === run.id ? (
                      // Rename inline input
                      <div className="flex-1 flex items-center gap-1">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(run.id, (run.catalog_workflows as any)?.id ?? "");
                            if (e.key === "Escape") setEditingRunId(null);
                          }}
                          className="h-7 text-sm flex-1"
                          autoFocus
                        />
                        <button
                          className="p-1 rounded hover:bg-accent text-primary"
                          onClick={() => handleRename(run.id, (run.catalog_workflows as any)?.id ?? "")}
                          disabled={isRenaming}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          className="p-1 rounded hover:bg-accent text-muted-foreground"
                          onClick={() => setEditingRunId(null)}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          className={cn(
                            "flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left hover:bg-accent transition-colors",
                            run.id === activeRunId && "bg-primary/10 text-primary font-medium"
                          )}
                          onClick={() => { setActiveRun(run.id); setOpen(false); }}
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
                        <button
                          className="p-1 rounded hover:bg-accent text-muted-foreground shrink-0"
                          title="Renomear"
                          onClick={() => { setEditingRunId(run.id); setEditName(runName(run)); }}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          className="p-1 rounded hover:bg-accent text-destructive shrink-0"
                          title="Apagar"
                          disabled={isDeleting === run.id}
                          onClick={() => handleDelete(run.id, (run.catalog_workflows as any)?.id ?? "")}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
