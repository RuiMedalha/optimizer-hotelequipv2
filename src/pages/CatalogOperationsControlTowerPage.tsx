import { useState } from "react";
import { useControlTower } from "@/hooks/useControlTower";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, Camera, CheckCircle, Clock,
  RefreshCw, Shield, Loader2, Eye, XCircle
} from "lucide-react";

export default function CatalogOperationsControlTowerPage() {
  const {
    alerts, snapshots, buildSnapshot, generateAlerts,
    summarize, getQueues, acknowledgeAlert, resolveAlert,
  } = useControlTower();

  const [summary, setSummary] = useState<any>(null);
  const [queues, setQueues] = useState<any>(null);

  const handleBuildSnapshot = () => {
    buildSnapshot.mutate(undefined, {
      onSuccess: () => toast.success("Snapshot criado"),
      onError: (e) => toast.error(e.message),
    });
  };

  const handleGenerateAlerts = () => {
    generateAlerts.mutate(undefined, {
      onSuccess: (d) => toast.success(`${d?.alerts_generated || 0} alertas gerados`),
      onError: (e) => toast.error(e.message),
    });
  };

  const handleSummarize = () => {
    summarize.mutate(undefined, {
      onSuccess: (d) => setSummary(d?.summary),
      onError: (e) => toast.error(e.message),
    });
  };

  const handleGetQueues = () => {
    getQueues.mutate(undefined, {
      onSuccess: (d) => setQueues(d?.queues),
      onError: (e) => toast.error(e.message),
    });
  };

  const latestSnapshot = snapshots.data?.[0]?.snapshot_payload as any;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Control Tower</h1>
          <p className="text-muted-foreground">Supervisão operacional do catálogo em tempo real</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleGetQueues} disabled={getQueues.isPending}>
            <Activity className="w-4 h-4 mr-1" /> Filas
          </Button>
          <Button variant="outline" size="sm" onClick={handleSummarize} disabled={summarize.isPending}>
            <Eye className="w-4 h-4 mr-1" /> Resumo
          </Button>
          <Button variant="outline" size="sm" onClick={handleGenerateAlerts} disabled={generateAlerts.isPending}>
            <AlertTriangle className="w-4 h-4 mr-1" /> Scan Alertas
          </Button>
          <Button size="sm" onClick={handleBuildSnapshot} disabled={buildSnapshot.isPending}>
            <Camera className="w-4 h-4 mr-1" /> Snapshot
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      {latestSnapshot && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KPICard title="Jobs Ativos" value={latestSnapshot.active_jobs} icon={<Activity className="w-4 h-4" />} />
          <KPICard title="Jobs Falhados" value={latestSnapshot.failed_jobs} icon={<XCircle className="w-4 h-4" />} variant={latestSnapshot.failed_jobs > 0 ? "destructive" : "default"} />
          <KPICard title="Revisão Pendente" value={latestSnapshot.review_pending} icon={<Clock className="w-4 h-4" />} variant={latestSnapshot.review_pending > 5 ? "warning" : "default"} />
          <KPICard title="Conflitos Abertos" value={latestSnapshot.conflicts_open} icon={<Shield className="w-4 h-4" />} variant={latestSnapshot.conflicts_open > 0 ? "warning" : "default"} />
          <KPICard title="Payloads Inválidos" value={latestSnapshot.payloads_invalid} icon={<AlertTriangle className="w-4 h-4" />} variant={latestSnapshot.payloads_invalid > 0 ? "destructive" : "default"} />
          <KPICard title="Alertas Abertos" value={latestSnapshot.alerts_open} icon={<AlertTriangle className="w-4 h-4" />} />
        </div>
      )}

      {/* Summary */}
      {summary && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Resumo Operacional</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Total Produtos" value={summary.total_products} />
              <Stat label="Aprovados" value={summary.approved_products} />
              <Stat label="Draft" value={summary.draft_products} />
              <Stat label="Health Score" value={`${summary.health_score}%`} />
              <Stat label="Ingestões Ativas" value={summary.active_ingestions} />
              <Stat label="Payloads Publicados" value={summary.published_payloads} />
              <Stat label="Alertas Abertos" value={summary.open_alerts} />
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts">Alertas ({alerts.data?.length || 0})</TabsTrigger>
          <TabsTrigger value="queues">Filas Operacionais</TabsTrigger>
          <TabsTrigger value="snapshots">Snapshots</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts">
          <Card>
            <CardHeader><CardTitle>Alertas Operacionais</CardTitle><CardDescription>Alertas consolidados de todos os módulos</CardDescription></CardHeader>
            <CardContent>
              {alerts.isLoading ? (
                <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
              ) : !alerts.data?.length ? (
                <p className="text-center text-muted-foreground py-8">Nenhum alerta aberto</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sev.</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Título</TableHead>
                      <TableHead>Escopo</TableHead>
                      <TableHead>Criado</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alerts.data.map((a: any) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <Badge variant={a.severity >= 3 ? "destructive" : "secondary"}>{a.severity}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{a.alert_type}</TableCell>
                        <TableCell>{a.title}</TableCell>
                        <TableCell><Badge variant="outline">{a.alert_scope}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => acknowledgeAlert.mutate(a.id)}>
                              <CheckCircle className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => resolveAlert.mutate(a.id)}>
                              <XCircle className="w-3 h-3" />
                            </Button>
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

        <TabsContent value="queues">
          <Card>
            <CardHeader>
              <CardTitle>Filas Operacionais</CardTitle>
              <CardDescription>Clique "Filas" para carregar dados atuais</CardDescription>
            </CardHeader>
            <CardContent>
              {!queues ? (
                <p className="text-center text-muted-foreground py-8">Clique no botão "Filas" para carregar</p>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  <QueueCard title="Ingestão" items={queues.ingestion} />
                  <QueueCard title="Revisão Humana" items={queues.review} />
                  <QueueCard title="Conflitos" items={queues.conflicts} />
                  <QueueCard title="Publicação" items={queues.publish} />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="snapshots">
          <Card>
            <CardHeader><CardTitle>Histórico de Snapshots</CardTitle></CardHeader>
            <CardContent>
              {snapshots.isLoading ? (
                <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
              ) : !snapshots.data?.length ? (
                <p className="text-center text-muted-foreground py-8">Nenhum snapshot. Crie o primeiro.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Jobs Ativos</TableHead>
                      <TableHead>Falhados</TableHead>
                      <TableHead>Revisão</TableHead>
                      <TableHead>Conflitos</TableHead>
                      <TableHead>Criado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snapshots.data.map((s: any) => {
                      const p = s.snapshot_payload as any;
                      return (
                        <TableRow key={s.id}>
                          <TableCell><Badge variant="outline">{s.snapshot_type}</Badge></TableCell>
                          <TableCell>{p?.active_jobs ?? "-"}</TableCell>
                          <TableCell>{p?.failed_jobs ?? "-"}</TableCell>
                          <TableCell>{p?.review_pending ?? "-"}</TableCell>
                          <TableCell>{p?.conflicts_open ?? "-"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString()}</TableCell>
                        </TableRow>
                      );
                    })}
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

function KPICard({ title, value, icon, variant = "default" }: { title: string; value: number; icon: React.ReactNode; variant?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-muted-foreground">{icon}</span>
          {variant === "destructive" && <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />}
          {variant === "warning" && <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />}
        </div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{title}</p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

function QueueCard({ title, items }: { title: string; items: any[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{items?.length || 0} itens</CardDescription>
      </CardHeader>
      <CardContent>
        {!items?.length ? (
          <p className="text-xs text-muted-foreground">Fila vazia</p>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {items.map((item: any) => (
              <div key={item.id} className="flex justify-between items-center text-xs border-b border-border py-1">
                <span className="font-mono truncate max-w-[60%]">{item.id.slice(0, 8)}</span>
                <Badge variant="outline" className="text-[10px]">{item.aging_minutes}m</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
