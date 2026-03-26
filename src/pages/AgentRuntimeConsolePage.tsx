import { useState } from "react";
import { useAgentRuntime } from "@/hooks/useAgentRuntime";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, BarChart3, CheckCircle, Loader2,
  ThumbsUp, ThumbsDown, XCircle, RefreshCw
} from "lucide-react";

export default function AgentRuntimeConsolePage() {
  const { runs, alerts, summarize, generateAlerts, submitFeedback, resolveAlert } = useAgentRuntime();
  const [summary, setSummary] = useState<any[]>([]);

  const handleSummarize = () => {
    summarize.mutate(undefined, {
      onSuccess: (d) => setSummary(d?.summary || []),
      onError: (e) => toast.error(e.message),
    });
  };

  const statusColor = (s: string) => {
    if (s === "completed") return "default";
    if (s === "failed") return "destructive";
    if (s === "running" || s === "queued") return "secondary";
    return "outline";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agent Runtime Console</h1>
          <p className="text-muted-foreground">Observabilidade e auditoria da execução dos agentes de IA</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSummarize} disabled={summarize.isPending}>
            <BarChart3 className="w-4 h-4 mr-1" /> Métricas
          </Button>
          <Button variant="outline" size="sm" onClick={() => generateAlerts.mutate(undefined, {
            onSuccess: (d) => toast.success(`${d?.alerts_generated || 0} alertas gerados`),
          })} disabled={generateAlerts.isPending}>
            <AlertTriangle className="w-4 h-4 mr-1" /> Scan
          </Button>
        </div>
      </div>

      {/* Metrics */}
      {summary.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {summary.map((s: any) => (
            <Card key={s.agent_name}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{s.agent_name}</CardTitle>
                <CardDescription>{s.total_runs} execuções</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Sucesso:</span> {s.success_rate}%</div>
                  <div><span className="text-muted-foreground">Falha:</span> {s.failure_rate}%</div>
                  <div><span className="text-muted-foreground">Fallback:</span> {s.fallback_rate}%</div>
                  <div><span className="text-muted-foreground">Confiança:</span> {s.avg_confidence}</div>
                  <div><span className="text-muted-foreground">Custo médio:</span> €{s.avg_cost}</div>
                  <div><span className="text-muted-foreground">Latência:</span> {s.avg_latency_ms}ms</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">Execuções ({runs.data?.length || 0})</TabsTrigger>
          <TabsTrigger value="alerts">Alertas ({alerts.data?.length || 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="runs">
          <Card>
            <CardHeader><CardTitle>Execuções Recentes</CardTitle></CardHeader>
            <CardContent>
              {runs.isLoading ? (
                <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
              ) : !runs.data?.length ? (
                <p className="text-center text-muted-foreground py-8">Nenhuma execução registada</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agente</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Confiança</TableHead>
                      <TableHead>Custo</TableHead>
                      <TableHead>Latência</TableHead>
                      <TableHead>Fallback</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Feedback</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.data.map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.agent_name}</TableCell>
                        <TableCell><Badge variant={statusColor(r.status) as any}>{r.status}</Badge></TableCell>
                        <TableCell>{r.confidence_score ? `${Math.round(r.confidence_score * 100)}%` : "-"}</TableCell>
                        <TableCell>{r.cost_estimate ? `€${Number(r.cost_estimate).toFixed(4)}` : "-"}</TableCell>
                        <TableCell>{r.latency_ms ? `${r.latency_ms}ms` : "-"}</TableCell>
                        <TableCell>{r.fallback_used ? <Badge variant="outline">Sim</Badge> : "-"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => submitFeedback.mutate({
                              agent_run_id: r.id, feedback_type: "human_approved", feedback_score: 1,
                            })}><ThumbsUp className="w-3 h-3" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => submitFeedback.mutate({
                              agent_run_id: r.id, feedback_type: "human_rejected", feedback_score: 0,
                            })}><ThumbsDown className="w-3 h-3" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts">
          <Card>
            <CardHeader><CardTitle>Alertas de Runtime</CardTitle></CardHeader>
            <CardContent>
              {alerts.isLoading ? (
                <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
              ) : !alerts.data?.length ? (
                <p className="text-center text-muted-foreground py-8">Sem alertas</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sev.</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Mensagem</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alerts.data.map((a: any) => (
                      <TableRow key={a.id}>
                        <TableCell><Badge variant={a.severity >= 3 ? "destructive" : "secondary"}>{a.severity}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{a.alert_type}</TableCell>
                        <TableCell>{a.message}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => resolveAlert.mutate(a.id)}>
                            <XCircle className="w-3 h-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
