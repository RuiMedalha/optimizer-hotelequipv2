import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, Activity, DollarSign, Clock, CheckCircle, AlertTriangle, CalendarClock } from "lucide-react";
import type { VersionPerformance, PromptUsageLog } from "@/hooks/usePromptGovernance";

interface Props {
  performance: VersionPerformance | undefined;
  logs: PromptUsageLog[];
  loading?: boolean;
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color?: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-lg bg-muted ${color || ""}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function PromptPerformancePanel({ performance, logs, loading }: Props) {
  if (loading) return <p className="text-muted-foreground text-center py-8">A carregar métricas...</p>;
  if (!performance) return <p className="text-muted-foreground text-center py-8">Selecione uma versão para ver performance.</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Activity} label="Execuções" value={String(performance.total_executions)} />
        <StatCard icon={CheckCircle} label="Confiança Média" value={performance.avg_confidence ? `${(performance.avg_confidence * 100).toFixed(0)}%` : "—"} />
        <StatCard icon={DollarSign} label="Custo Médio" value={performance.avg_cost ? `€${performance.avg_cost.toFixed(4)}` : "—"} />
        <StatCard icon={Clock} label="Latência Média" value={performance.avg_latency ? `${performance.avg_latency.toFixed(0)}ms` : "—"} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard icon={CheckCircle} label="Taxa de Sucesso" value={`${performance.success_rate.toFixed(0)}%`} />
        <StatCard icon={AlertTriangle} label="Taxa de Fallback" value={`${performance.fallback_rate.toFixed(0)}%`} />
        <StatCard icon={CalendarClock} label="Última Utilização" value={performance.last_used ? new Date(performance.last_used).toLocaleDateString("pt-PT") : "Nunca"} />
      </div>

      {logs.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Logs Recentes</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agente</TableHead>
                  <TableHead>Input</TableHead>
                  <TableHead>Output</TableHead>
                  <TableHead>Tempo</TableHead>
                  <TableHead>Confiança</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.slice(0, 20).map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="text-sm">{l.agent_name || "—"}</TableCell>
                    <TableCell>{l.input_size || 0}</TableCell>
                    <TableCell>{l.output_size || 0}</TableCell>
                    <TableCell>{l.execution_time ? `${l.execution_time}ms` : "—"}</TableCell>
                    <TableCell>{l.confidence_score ? `${(l.confidence_score * 100).toFixed(0)}%` : "—"}</TableCell>
                    <TableCell className="text-xs">{new Date(l.created_at).toLocaleString("pt-PT")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
