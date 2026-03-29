import { useState } from "react";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import {
  useAgents, useCreateAgent, useUpdateAgentStatus,
  useAgentTasks, useAgentActions, useAgentPolicies,
  useRunAgentCycle, useApproveAction, useCreatePolicy,
  useRunAgentAnalysis, useAgentAnalysisResults,
} from "@/hooks/useAgents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Bot, Play, CheckCircle, XCircle, Clock, AlertTriangle, Zap, Shield, ListTodo, Activity, Search, Image, FileText } from "lucide-react";
import { toast } from "sonner";

const AGENT_TYPES = [
  { value: "seo_optimizer", label: "SEO Optimizer" },
  { value: "catalog_gap_detector", label: "Catalog Gap Detector" },
  { value: "bundle_generator", label: "Bundle Generator" },
  { value: "attribute_completeness_agent", label: "Attribute Completeness" },
  { value: "feed_optimizer", label: "Feed Optimizer" },
  { value: "translation_agent", label: "Translation Agent" },
  { value: "image_optimizer", label: "Image Optimizer" },
  { value: "supplier_learning_agent", label: "Supplier Learning" },
  { value: "pricing_analyzer", label: "Pricing Analyzer" },
  { value: "channel_performance_agent", label: "Channel Performance" },
];

const statusColors: Record<string, string> = {
  active: "bg-green-500/10 text-green-700 dark:text-green-400",
  paused: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  disabled: "bg-muted text-muted-foreground",
  queued: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  running: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  completed: "bg-green-500/10 text-green-700 dark:text-green-400",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export default function AgentControlCenterPage() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;

  const { data: agents = [] } = useAgents(wsId);
  const { data: tasks = [] } = useAgentTasks(wsId);
  const { data: actions = [] } = useAgentActions(wsId);
  const { data: policies = [] } = useAgentPolicies(wsId);
  const { data: analysisRuns = [] } = useAgentAnalysisResults(wsId);

  const createAgent = useCreateAgent();
  const updateStatus = useUpdateAgentStatus();
  const runCycle = useRunAgentCycle();
  const runAnalysis = useRunAgentAnalysis();
  const approveAction = useApproveAction();
  const createPolicy = useCreatePolicy();

  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentType, setNewAgentType] = useState("");
  const [newPolicyName, setNewPolicyName] = useState("");
  const [newPolicyType, setNewPolicyType] = useState("");
  const [newPolicyApproval, setNewPolicyApproval] = useState(true);

  const pendingActions = actions.filter((a: any) => !a.approved_by_user);
  const completedTasks = tasks.filter((t: any) => t.status === "completed").length;
  const failedTasks = tasks.filter((t: any) => t.status === "failed").length;
  const queuedTasks = tasks.filter((t: any) => t.status === "queued").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bot className="w-6 h-6" /> Centro de Controlo de Agentes
          </h1>
          <p className="text-muted-foreground text-sm">Sistema autónomo de otimização do catálogo</p>
        </div>
        <Button
          variant="outline"
          onClick={() => wsId && runAnalysis.mutate({ workspaceId: wsId, agentTypes: ["seo_optimizer", "attribute_completeness_agent", "image_optimizer"] })}
          disabled={runAnalysis.isPending || !wsId}
          className="mr-2"
        >
          <Search className="w-4 h-4 mr-2" /> {runAnalysis.isPending ? "A analisar..." : "Analisar Catálogo"}
        </Button>
        <Button onClick={() => wsId && runCycle.mutate({ workspaceId: wsId })} disabled={runCycle.isPending || !wsId}>
          <Play className="w-4 h-4 mr-2" /> {runCycle.isPending ? "A executar..." : "Executar Ciclo"}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-4 text-center">
          <Bot className="w-5 h-5 mx-auto mb-1 text-primary" />
          <p className="text-2xl font-bold">{agents.length}</p>
          <p className="text-xs text-muted-foreground">Agentes</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <Clock className="w-5 h-5 mx-auto mb-1 text-blue-500" />
          <p className="text-2xl font-bold">{queuedTasks}</p>
          <p className="text-xs text-muted-foreground">Na Fila</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <CheckCircle className="w-5 h-5 mx-auto mb-1 text-green-500" />
          <p className="text-2xl font-bold">{completedTasks}</p>
          <p className="text-xs text-muted-foreground">Concluídas</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <AlertTriangle className="w-5 h-5 mx-auto mb-1 text-destructive" />
          <p className="text-2xl font-bold">{failedTasks}</p>
          <p className="text-xs text-muted-foreground">Falhadas</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <Zap className="w-5 h-5 mx-auto mb-1 text-yellow-500" />
          <p className="text-2xl font-bold">{pendingActions.length}</p>
          <p className="text-xs text-muted-foreground">Pendentes</p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="analysis">
        <TabsList>
          <TabsTrigger value="analysis"><Search className="w-4 h-4 mr-1" /> Análise</TabsTrigger>
          <TabsTrigger value="agents"><Bot className="w-4 h-4 mr-1" /> Agentes</TabsTrigger>
          <TabsTrigger value="tasks"><ListTodo className="w-4 h-4 mr-1" /> Tarefas</TabsTrigger>
          <TabsTrigger value="actions"><Activity className="w-4 h-4 mr-1" /> Ações</TabsTrigger>
          <TabsTrigger value="policies"><Shield className="w-4 h-4 mr-1" /> Políticas</TabsTrigger>
        </TabsList>

        {/* Analysis Results Tab */}
        <TabsContent value="analysis" className="space-y-4">
          {analysisRuns.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Search className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-4">
                  Ainda não foram executadas análises. Clique em "Analisar Catálogo" para iniciar.
                </p>
                <Button
                  onClick={() => wsId && runAnalysis.mutate({ workspaceId: wsId, agentTypes: ["seo_optimizer", "attribute_completeness_agent", "image_optimizer"] })}
                  disabled={runAnalysis.isPending || !wsId}
                >
                  <Search className="w-4 h-4 mr-2" /> Iniciar Análise
                </Button>
              </CardContent>
            </Card>
          ) : (
            analysisRuns.map((run: any) => {
              const output = run.output_payload || {};
              const isFullCycle = run.agent_name === "agent_analysis_cycle";
              
              return (
                <Card key={run.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        {isFullCycle ? <Search className="w-4 h-4 text-primary" /> : 
                         run.agent_name === "image_optimizer" ? <Image className="w-4 h-4 text-primary" /> :
                         <FileText className="w-4 h-4 text-primary" />}
                        {isFullCycle ? "Análise Completa do Catálogo" : 
                         run.agent_name === "image_optimizer" ? "Análise de Imagens" :
                         "Otimização SEO"}
                      </CardTitle>
                      <span className="text-xs text-muted-foreground">{new Date(run.created_at).toLocaleString("pt-PT")}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {isFullCycle && output.seo_optimizer && (
                      <div className="bg-muted/50 rounded-lg p-3">
                        <p className="text-xs font-semibold mb-1 flex items-center gap-1"><FileText className="w-3 h-3" /> SEO Optimizer</p>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div><span className="text-muted-foreground">Analisados:</span> {output.seo_optimizer.analyzed}</div>
                          <div><span className="text-muted-foreground">Problemas:</span> {output.seo_optimizer.issues_found}</div>
                          <div><span className="text-muted-foreground">Recomendações:</span> {output.seo_optimizer.recommendations_created}</div>
                        </div>
                      </div>
                    )}
                    {isFullCycle && output.attribute_completeness_agent && (
                      <div className="bg-muted/50 rounded-lg p-3">
                        <p className="text-xs font-semibold mb-1 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Completude de Atributos</p>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div><span className="text-muted-foreground">Analisados:</span> {output.attribute_completeness_agent.analyzed}</div>
                          <div><span className="text-muted-foreground">Incompletos:</span> {output.attribute_completeness_agent.incomplete}</div>
                          <div><span className="text-muted-foreground">Atualizados:</span> {output.attribute_completeness_agent.scores_updated}</div>
                        </div>
                      </div>
                    )}
                    {(isFullCycle ? output.image_optimizer : run.agent_name === "image_optimizer" ? output : null) && (() => {
                      const imgData = isFullCycle ? output.image_optimizer : output;
                      return (
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-xs font-semibold mb-1 flex items-center gap-1"><Image className="w-3 h-3" /> Image Optimizer</p>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            <div><span className="text-muted-foreground">Analisados:</span> {imgData.analyzed}</div>
                            <div><span className="text-muted-foreground">Sem imagens:</span> {imgData.no_images}</div>
                            <div><span className="text-muted-foreground">Poucas imagens:</span> {imgData.few_images}</div>
                            <div><span className="text-muted-foreground">Sem lifestyle:</span> {imgData.needs_lifestyle}</div>
                          </div>
                          {imgData.recommendations?.length > 0 && (
                            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                              {imgData.recommendations.slice(0, 10).map((r: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-2 text-xs">
                                  <Badge variant={r.severity === "high" ? "destructive" : "secondary"} className="text-[10px] h-4">{r.severity}</Badge>
                                  <span className="truncate flex-1">{r.title}</span>
                                  <span className="text-muted-foreground">{r.suggestion}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {!isFullCycle && run.agent_name === "seo_optimization" && (
                      <div className="text-xs">
                        <p><span className="text-muted-foreground">Confiança:</span> {Math.round((run.confidence_score || 0) * 100)}%</p>
                        {output.meta_title && <p><span className="text-muted-foreground">Título:</span> {output.meta_title}</p>}
                        {output.meta_description && <p><span className="text-muted-foreground">Descrição:</span> {output.meta_description}</p>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* Agents Tab */}
        <TabsContent value="agents" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Criar Agente</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input placeholder="Nome do agente" value={newAgentName} onChange={(e) => setNewAgentName(e.target.value)} className="flex-1" />
                <Select value={newAgentType} onValueChange={setNewAgentType}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="Tipo" /></SelectTrigger>
                  <SelectContent>
                    {AGENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button onClick={() => {
                  if (!newAgentName.trim() || !newAgentType || !wsId) return;
                  createAgent.mutate({ workspace_id: wsId, agent_name: newAgentName.trim(), agent_type: newAgentType });
                  setNewAgentName(""); setNewAgentType("");
                }} disabled={!newAgentName.trim() || !newAgentType}>Criar</Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3">
            {agents.map((agent: any) => (
              <Card key={agent.id}>
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Bot className="w-5 h-5 text-primary" />
                    <div>
                      <p className="font-medium text-sm">{agent.agent_name}</p>
                      <p className="text-xs text-muted-foreground">{AGENT_TYPES.find(t => t.value === agent.agent_type)?.label || agent.agent_type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge className={statusColors[agent.status] || ""}>{agent.status}</Badge>
                    <Select value={agent.status} onValueChange={(v) => updateStatus.mutate({ id: agent.id, status: v })}>
                      <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="paused">Paused</SelectItem>
                        <SelectItem value="disabled">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            ))}
            {!agents.length && <p className="text-sm text-muted-foreground text-center py-8">Nenhum agente configurado.</p>}
          </div>
        </TabsContent>

        {/* Tasks Tab */}
        <TabsContent value="tasks" className="space-y-3">
          {tasks.map((task: any) => (
            <Card key={task.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{task.task_type}</p>
                  <p className="text-xs text-muted-foreground">{new Date(task.created_at).toLocaleString("pt-PT")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={statusColors[task.status] || ""}>{task.status}</Badge>
                  {task.error_message && <span className="text-xs text-destructive max-w-48 truncate">{task.error_message}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
          {!tasks.length && <p className="text-sm text-muted-foreground text-center py-8">Nenhuma tarefa registada.</p>}
        </TabsContent>

        {/* Actions Tab */}
        <TabsContent value="actions" className="space-y-3">
          {actions.map((action: any) => (
            <Card key={action.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{action.action_type}</p>
                  <p className="text-xs text-muted-foreground">
                    Confiança: {action.confidence}% · {new Date(action.created_at).toLocaleString("pt-PT")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {action.approved_by_user ? (
                    <Badge className="bg-green-500/10 text-green-700 dark:text-green-400">Aprovada</Badge>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => approveAction.mutate({ actionId: action.id, approved: true })}>
                        <CheckCircle className="w-3 h-3 mr-1" /> Aprovar
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => approveAction.mutate({ actionId: action.id, approved: false })}>
                        <XCircle className="w-3 h-3 mr-1" /> Rejeitar
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {!actions.length && <p className="text-sm text-muted-foreground text-center py-8">Nenhuma ação registada.</p>}
        </TabsContent>

        {/* Policies Tab */}
        <TabsContent value="policies" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Nova Política</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-2 items-center">
                <Input placeholder="Nome da política" value={newPolicyName} onChange={(e) => setNewPolicyName(e.target.value)} className="flex-1" />
                <Select value={newPolicyType} onValueChange={setNewPolicyType}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="Tipo de agente" /></SelectTrigger>
                  <SelectContent>
                    {AGENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1.5">
                  <Switch checked={newPolicyApproval} onCheckedChange={setNewPolicyApproval} />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Aprovação</span>
                </div>
                <Button onClick={() => {
                  if (!newPolicyName.trim() || !newPolicyType || !wsId) return;
                  createPolicy.mutate({ workspace_id: wsId, agent_type: newPolicyType, policy_name: newPolicyName.trim(), requires_approval: newPolicyApproval });
                  setNewPolicyName(""); setNewPolicyType("");
                }} disabled={!newPolicyName.trim() || !newPolicyType}>Criar</Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3">
            {policies.map((p: any) => (
              <Card key={p.id}>
                <CardContent className="py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{p.policy_name}</p>
                    <p className="text-xs text-muted-foreground">{AGENT_TYPES.find(t => t.value === p.agent_type)?.label || p.agent_type}</p>
                  </div>
                  <Badge variant={p.requires_approval ? "secondary" : "default"}>
                    {p.requires_approval ? "Requer Aprovação" : "Automático"}
                  </Badge>
                </CardContent>
              </Card>
            ))}
            {!policies.length && <p className="text-sm text-muted-foreground text-center py-8">Nenhuma política definida.</p>}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
