import { useIntelligenceDashboard } from "@/hooks/useIntelligenceDashboard";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { useRunBrainOrchestration } from "@/hooks/useCatalogBrain";
import { useRunAgentCycle, useRunAgentAnalysis } from "@/hooks/useAgents";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Brain, Bot, Activity, AlertTriangle, TrendingUp, Zap, Play, Target,
  CheckCircle, XCircle, Clock, Network, Sparkles, Shield,
  BarChart3, Loader2, RefreshCw, Eye, Layers,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { pt } from "date-fns/locale";

const healthColor = (v: number) =>
  v >= 80 ? "text-green-600 dark:text-green-400" :
  v >= 50 ? "text-amber-600 dark:text-amber-400" :
  "text-destructive";

const healthBg = (v: number) =>
  v >= 80 ? "bg-green-500" :
  v >= 50 ? "bg-amber-500" :
  "bg-destructive";

const severityBadge = (s: number) =>
  s >= 8 ? "destructive" as const :
  s >= 5 ? "secondary" as const :
  "outline" as const;

export default function IntelligenceDashboardPage() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;
  const { data, isLoading } = useIntelligenceDashboard();

  const orchestrate = useRunBrainOrchestration();
  const runCycle = useRunAgentCycle();
  const runAnalysis = useRunAgentAnalysis();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Brain className="w-12 h-12 mx-auto mb-4 opacity-40" />
        <p>Selecione um workspace para ver o painel de inteligência.</p>
      </div>
    );
  }

  const { brain, agents, alerts, recentRuns, overallHealth } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            Intelligence Command Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Visão unificada do Catalog Brain, Agentes AI e Pipeline de Inteligência
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => wsId && runAnalysis.mutate({ workspaceId: wsId })}
            disabled={runAnalysis.isPending}
          >
            {runAnalysis.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Eye className="w-4 h-4 mr-1" />}
            Analisar
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => wsId && runCycle.mutate({ workspaceId: wsId })}
            disabled={runCycle.isPending}
          >
            {runCycle.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Bot className="w-4 h-4 mr-1" />}
            Ciclo Agentes
          </Button>
          <Button
            size="sm"
            onClick={() => wsId && orchestrate.mutate({ workspaceId: wsId })}
            disabled={orchestrate.isPending}
          >
            {orchestrate.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Brain className="w-4 h-4 mr-1" />}
            Orquestrar Brain
          </Button>
        </div>
      </div>

      {/* Health Score + Alerts Banner */}
      {alerts.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <div className="flex-1 text-sm">
              <span className="font-medium">{alerts.length} alerta{alerts.length > 1 ? "s" : ""} ativo{alerts.length > 1 ? "s" : ""}</span>
              <span className="text-muted-foreground ml-2">—</span>
              <span className="text-muted-foreground ml-2">{alerts[0]?.message || "Verifique os detalhes abaixo"}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {/* Overall Health */}
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground font-medium">Saúde Geral</span>
              <Shield className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className={`text-2xl font-bold ${healthColor(overallHealth)}`}>{overallHealth}%</p>
            <Progress value={overallHealth} className={`h-1.5 mt-2 [&>div]:${healthBg(overallHealth)}`} />
          </CardContent>
        </Card>

        {/* Brain Plans */}
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground font-medium">Planos Brain</span>
              <Brain className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold">{brain.activePlans}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {brain.completedPlans} concluídos · {brain.pendingApproval} pendentes
            </p>
          </CardContent>
        </Card>

        {/* Active Agents */}
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground font-medium">Agentes Ativos</span>
              <Bot className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold">{agents.activeAgents}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {agents.totalAgents} total · {agents.pausedAgents} pausados
            </p>
          </CardContent>
        </Card>

        {/* Tasks */}
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground font-medium">Tarefas</span>
              <Activity className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold">{agents.pendingTasks}</p>
            <p className="text-xs text-muted-foreground mt-1">
              pendentes de {agents.totalTasks} total
            </p>
          </CardContent>
        </Card>

        {/* Knowledge Graph */}
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground font-medium">Grafo</span>
              <Network className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold">{brain.totalEntities}</p>
            <p className="text-xs text-muted-foreground mt-1">
              entidades · {brain.totalRelations} relações
            </p>
          </CardContent>
        </Card>

        {/* Revenue Opportunities */}
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground font-medium">Receita Est.</span>
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {data.estimatedRevenue > 0 ? `€${Math.round(data.estimatedRevenue).toLocaleString()}` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.revenueOpportunities} oportunidades
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs: Brain / Agents / Alerts / Runs */}
      <Tabs defaultValue="brain" className="space-y-4">
        <TabsList>
          <TabsTrigger value="brain" className="gap-1.5"><Brain className="w-3.5 h-3.5" /> Catalog Brain</TabsTrigger>
          <TabsTrigger value="agents" className="gap-1.5"><Bot className="w-3.5 h-3.5" /> Agentes</TabsTrigger>
          <TabsTrigger value="errors" className="gap-1.5"><XCircle className="w-3.5 h-3.5" /> Erros de Operação</TabsTrigger>
          <TabsTrigger value="alerts" className="gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Alertas
            {alerts.length > 0 && <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">{alerts.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="runs" className="gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Histórico</TabsTrigger>
        </TabsList>

        {/* Brain Tab */}
        <TabsContent value="brain">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Brain Overview */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4" /> Estado do Brain</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <MetricRow icon={Eye} label="Observações (7d)" value={brain.recentObservations} total={brain.totalObservations} />
                  <MetricRow icon={Target} label="Planos Ativos" value={brain.activePlans} total={brain.totalPlans} />
                  <MetricRow icon={CheckCircle} label="Concluídos" value={brain.completedPlans} color="text-green-600" />
                  <MetricRow icon={XCircle} label="Falhados" value={brain.failedPlans} color="text-destructive" />
                  <MetricRow icon={Clock} label="Pendentes Aprovação" value={brain.pendingApproval} color="text-amber-600" />
                  <MetricRow icon={TrendingUp} label="Outcomes Positivos" value={brain.positiveOutcomes} total={brain.totalOutcomes} />
                </div>
              </CardContent>
            </Card>

            {/* Pipeline Summary */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Layers className="w-4 h-4" /> Pipeline de Inteligência</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <PipelineRow label="Catalog Intelligence" run={data.catalog} issues={data.totalIssues} highIssues={data.highSeverityIssues} />
                <PipelineRow label="Demand Intelligence" run={data.demand} opportunities={data.demandOpportunities} />
                <PipelineRow label="Revenue Optimization" run={data.revenue} revenue={data.estimatedRevenue} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Agents Tab */}
        <TabsContent value="agents">
          <div className="grid md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Tarefas Pendentes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{agents.pendingTasks}</p>
                <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-green-500" /> {agents.completedTasks}</span>
                  <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-destructive" /> {agents.failedTasks}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Ações Pendentes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{agents.pendingApproval}</p>
                <p className="text-xs text-muted-foreground mt-2">{agents.approvedActions} aprovadas de {agents.totalActions} total</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Taxa de Sucesso</CardTitle>
              </CardHeader>
              <CardContent>
                {agents.totalTasks > 0 ? (
                  <>
                    <p className="text-3xl font-bold">{Math.round((agents.completedTasks / agents.totalTasks) * 100)}%</p>
                    <Progress value={(agents.completedTasks / agents.totalTasks) * 100} className="h-1.5 mt-3" />
                  </>
                ) : (
                  <p className="text-3xl font-bold text-muted-foreground">—</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Erros de Operação Tab */}
        <TabsContent value="errors">
          <OperationErrorsTable />
        </TabsContent>

        {/* Alerts Tab */}
        <TabsContent value="alerts">
          {alerts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <CheckCircle className="w-8 h-8 mx-auto mb-3 text-green-500" />
                <p>Sem alertas ativos. Todos os sistemas operacionais.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Mensagem</TableHead>
                      <TableHead>Severidade</TableHead>
                      <TableHead>Quando</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alerts.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{a.alert_type}</Badge>
                        </TableCell>
                        <TableCell className="text-sm max-w-md truncate">{a.message}</TableCell>
                        <TableCell>
                          <Badge variant={severityBadge(a.severity || 0)}>{a.severity || 0}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(a.created_at), { addSuffix: true, locale: pt })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Recent Runs Tab */}
        <TabsContent value="runs">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agente</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Confiança</TableHead>
                    <TableHead>Latência</TableHead>
                    <TableHead>Custo</TableHead>
                    <TableHead>Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentRuns.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        Sem execuções recentes
                      </TableCell>
                    </TableRow>
                  ) : (
                    recentRuns.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium text-sm">{r.agent_name.replace(/_/g, " ")}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === "completed" ? "default" : r.status === "failed" ? "destructive" : "secondary"} className="text-xs">
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.confidence_score != null ? `${Math.round(r.confidence_score * 100)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {r.latency_ms != null ? `${r.latency_ms}ms` : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {r.cost_estimate != null ? `€${r.cost_estimate.toFixed(4)}` : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.created_at ? formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: pt }) : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Helper components
function MetricRow({ icon: Icon, label, value, total, color }: { icon: any; label: string; value: number; total?: number; color?: string }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/30">
      <Icon className={`w-4 h-4 ${color || "text-muted-foreground"} shrink-0`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className={`text-sm font-semibold ${color || ""}`}>
          {value}{total != null && <span className="text-muted-foreground font-normal">/{total}</span>}
        </p>
      </div>
    </div>
  );
}

function PipelineRow({ label, run, issues, highIssues, opportunities, revenue }: {
  label: string; run: any; issues?: number; highIssues?: number; opportunities?: number; revenue?: number;
}) {
  const lastRun = run?.completed_at || run?.created_at;
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {lastRun
            ? `Última: ${formatDistanceToNow(new Date(lastRun), { addSuffix: true, locale: pt })}`
            : "Nunca executado"}
        </p>
      </div>
      <div className="text-right">
        {issues != null && (
          <p className="text-xs">
            <span className="font-medium">{issues}</span> problemas
            {highIssues ? <span className="text-destructive ml-1">({highIssues} críticos)</span> : null}
          </p>
        )}
        {opportunities != null && (
          <p className="text-xs"><span className="font-medium">{opportunities}</span> oportunidades</p>
        )}
        {revenue != null && revenue > 0 && (
          <p className="text-xs text-green-600 dark:text-green-400 font-medium">€{Math.round(revenue).toLocaleString()}</p>
        )}
        {run ? (
          <Badge variant="default" className="text-[10px] mt-1">
            {Math.round((run.confidence_score || 0) * 100)}% conf.
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px] mt-1">Pendente</Badge>
        )}
      </div>
    </div>
  );
}

function OperationErrorsTable() {
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();
  const { data: errors, isLoading, refetch } = useQuery({
    queryKey: ["catalog-operation-errors", activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_operation_errors")
        .select("*")
        .eq("workspace_id", activeWorkspace!.id)
        .eq("resolved", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const deleteError = async (id: string) => {
    const { error } = await supabase
      .from("catalog_operation_errors")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Erro ao eliminar log");
    } else {
      toast.success("Log eliminado");
      refetch();
    }
  };

  const clearAll = async () => {
    if (!activeWorkspace?.id) return;
    const { error } = await supabase
      .from("catalog_operation_errors")
      .delete()
      .eq("workspace_id", activeWorkspace.id);
    if (error) {
      toast.error("Erro ao limpar logs");
    } else {
      toast.success("Logs limpos");
      refetch();
    }
  };

  if (isLoading) return <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Registo de Erros Críticos</CardTitle>
        {errors && errors.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll} className="text-destructive hover:text-destructive text-xs h-7">
            <RefreshCw className="w-3 h-3 mr-1" /> Limpar Tudo
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Operação</TableHead>
              <TableHead>Produto/SKU</TableHead>
              <TableHead>Mensagem de Erro</TableHead>
              <TableHead>Data</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!errors || errors.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Sem erros registados.
                </TableCell>
              </TableRow>
            ) : (
              errors.map((err) => (
                <TableRow key={err.id}>
                  <TableCell>
                    <Badge variant="outline" className="capitalize text-[10px]">{err.operation_type.replace(/_/g, ' ')}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs font-mono">{err.sku || "—"}</div>
                  </TableCell>
                  <TableCell className="max-w-md">
                    <p className="text-xs font-medium text-destructive">{err.error_message}</p>
                    {err.error_detail?.hint && <p className="text-[10px] text-muted-foreground mt-0.5">{err.error_detail.hint}</p>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(err.created_at), { addSuffix: true, locale: pt })}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteError(err.id)}>
                      <XCircle className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}