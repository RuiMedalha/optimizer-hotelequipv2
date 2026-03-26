import { useState } from "react";
import { useCatalogWorkflows } from "@/hooks/useCatalogWorkflows";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Play, Pause, RotateCcw, Plus, ArrowRight, CheckCircle2, XCircle, Clock, Workflow } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
  paused: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300",
  completed: "bg-green-500/20 text-green-700 dark:text-green-300",
  partial: "bg-orange-500/20 text-orange-700 dark:text-orange-300",
  failed: "bg-destructive/20 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

const STEP_ICONS: Record<string, React.ReactNode> = {
  completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
  failed: <XCircle className="h-4 w-4 text-destructive" />,
  queued: <Clock className="h-4 w-4 text-muted-foreground" />,
  paused: <Pause className="h-4 w-4 text-yellow-500" />,
};

const WORKFLOW_TYPES = [
  { value: "supplier_import", label: "Supplier Import" },
  { value: "catalog_refresh", label: "Catalog Refresh" },
  { value: "price_update", label: "Price Update" },
  { value: "channel_republish", label: "Channel Republish" },
  { value: "marketplace_export", label: "Marketplace Export" },
  { value: "full_catalog_cycle", label: "Full Catalog Cycle" },
];

function RunDetail({ runId, onRetry, onPause, onResume }: { runId: string; onRetry: (stepId: string) => void; onPause: () => void; onResume: () => void }) {
  const { getRunSteps, getHandoffs } = useCatalogWorkflows();
  const steps = useQuery({
    queryKey: ["workflow-steps", runId],
    queryFn: async () => { const { data } = await getRunSteps(runId); return data ?? []; },
  });
  const handoffs = useQuery({
    queryKey: ["workflow-handoffs", runId],
    queryFn: async () => { const { data } = await getHandoffs(runId); return data ?? []; },
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onPause}><Pause className="h-3 w-3 mr-1" />Pausar</Button>
        <Button size="sm" variant="outline" onClick={onResume}><Play className="h-3 w-3 mr-1" />Retomar</Button>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Passos</h4>
        {steps.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {(steps.data ?? []).map((s: any) => (
          <div key={s.id} className="flex items-center justify-between p-2 border rounded-lg">
            <div className="flex items-center gap-2">
              {STEP_ICONS[s.status] ?? STEP_ICONS.queued}
              <span className="text-sm font-medium">{s.step_name}</span>
              <Badge variant="outline" className="text-xs">{s.step_type}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={STATUS_COLORS[s.status]}>{s.status}</Badge>
              {s.status === "failed" && (
                <Button size="sm" variant="ghost" onClick={() => onRetry(s.id)}><RotateCcw className="h-3 w-3" /></Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {(handoffs.data ?? []).length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Handoffs</h4>
          {(handoffs.data ?? []).map((h: any) => (
            <div key={h.id} className="flex items-center gap-2 p-2 border rounded-lg text-sm">
              <span className="font-medium">{h.from_module}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium">{h.to_module}</span>
              <Badge className={STATUS_COLORS[h.handoff_status]}>{h.handoff_status}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CatalogWorkflowCenterPage() {
  const { workflows, runs, startWorkflow, pauseRun, resumeRun, retryStep, createWorkflow, summarizeRun } = useCatalogWorkflows();
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("full_catalog_cycle");
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [summaryData, setSummaryData] = useState<any>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleCreate = () => {
    if (!newName.trim()) return;
    createWorkflow.mutate({ workflow_name: newName, workflow_type: newType }, {
      onSuccess: () => { setNewName(""); setDialogOpen(false); },
    });
  };

  const handleSummary = async (runId: string) => {
    const result = await summarizeRun.mutateAsync(runId);
    setSummaryData(result);
  };

  const activeRuns = (runs.data ?? []).filter((r: any) => ["running", "paused", "queued"].includes(r.status));
  const completedRuns = (runs.data ?? []).filter((r: any) => !["running", "paused", "queued"].includes(r.status));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Workflow Center</h1>
          <p className="text-muted-foreground">End-to-end catalog workflows</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Novo Workflow</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Criar Workflow</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <Input placeholder="Nome do workflow" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WORKFLOW_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={handleCreate} disabled={createWorkflow.isPending} className="w-full">
                {createWorkflow.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Criar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold">{(workflows.data ?? []).length}</p>
          <p className="text-xs text-muted-foreground">Workflows</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{activeRuns.length}</p>
          <p className="text-xs text-muted-foreground">Em curso</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-green-600">{completedRuns.filter((r: any) => r.status === "completed").length}</p>
          <p className="text-xs text-muted-foreground">Concluídos</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-destructive">{completedRuns.filter((r: any) => r.status === "failed").length}</p>
          <p className="text-xs text-muted-foreground">Falhados</p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">Runs Ativos</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="runs" className="space-y-4">
          {runs.isLoading && <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
          {activeRuns.length === 0 && !runs.isLoading && (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum workflow em curso.</CardContent></Card>
          )}
          {activeRuns.map((r: any) => (
            <Card key={r.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedRun(selectedRun === r.id ? null : r.id)}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Workflow className="h-4 w-4" />
                    {r.catalog_workflows?.workflow_name ?? "Workflow"}
                  </CardTitle>
                  <Badge className={STATUS_COLORS[r.status]}>{r.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">Trigger: {r.trigger_source} · {new Date(r.created_at).toLocaleString()}</p>
              </CardHeader>
              {selectedRun === r.id && (
                <CardContent>
                  <RunDetail
                    runId={r.id}
                    onRetry={(stepId) => retryStep.mutate({ step_id: stepId, run_id: r.id })}
                    onPause={() => pauseRun.mutate(r.id)}
                    onResume={() => resumeRun.mutate(r.id)}
                  />
                </CardContent>
              )}
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          {completedRuns.map((r: any) => (
            <Card key={r.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{r.catalog_workflows?.workflow_name ?? "Workflow"}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge className={STATUS_COLORS[r.status]}>{r.status}</Badge>
                    <Button size="sm" variant="outline" onClick={() => handleSummary(r.id)}>Resumo</Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>
              </CardHeader>
              {summaryData && selectedRun === r.id && (
                <CardContent>
                  <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto max-h-40">{JSON.stringify(summaryData, null, 2)}</pre>
                </CardContent>
              )}
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="templates" className="space-y-4">
          {workflows.isLoading && <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
          {(workflows.data ?? []).map((w: any) => (
            <Card key={w.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{w.workflow_name}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{w.workflow_type}</Badge>
                    <Button size="sm" onClick={() => startWorkflow.mutate({ workflow_id: w.id })} disabled={startWorkflow.isPending}>
                      <Play className="h-3 w-3 mr-1" />Iniciar
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
