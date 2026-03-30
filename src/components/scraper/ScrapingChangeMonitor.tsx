import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity, TrendingUp, TrendingDown, Package, PackageMinus, DollarSign,
  Tag, AlertTriangle, BarChart3, Loader2,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { pt } from "date-fns/locale";
import { useScrapingChangeLogs, useScrapingChangeStats } from "@/hooks/useScrapingChangeLogs";
import { useScrapingSchedules } from "@/hooks/useScrapingSchedules";

const CHANGE_TYPE_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  new_product: { label: "Novo Produto", icon: Package, color: "bg-green-500/20 text-green-400 border-green-500/30" },
  removed_product: { label: "Produto Removido", icon: PackageMinus, color: "bg-red-500/20 text-red-400 border-red-500/30" },
  price_change: { label: "Alteração de Preço", icon: DollarSign, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  stock_change: { label: "Alteração de Stock", icon: AlertTriangle, color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  title_change: { label: "Alteração de Título", icon: Tag, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  other: { label: "Outra", icon: Activity, color: "bg-muted text-muted-foreground" },
};

export function ScrapingChangeMonitor() {
  const [filterSchedule, setFilterSchedule] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");

  const scheduleFilter = filterSchedule === "all" ? undefined : filterSchedule;
  const { data: logs, isLoading } = useScrapingChangeLogs(scheduleFilter, 100);
  const { data: stats } = useScrapingChangeStats(scheduleFilter);
  const { data: schedules } = useScrapingSchedules();

  const filteredLogs = filterType === "all"
    ? logs
    : logs?.filter((l: any) => l.change_type === filterType);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Monitorização de Alterações
          </h3>
          <p className="text-sm text-muted-foreground">
            Alterações detetadas entre execuções de scraping
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Novos" value={stats.new_products} icon={Package} color="text-green-400" />
          <StatCard label="Removidos" value={stats.removed_products} icon={PackageMinus} color="text-red-400" />
          <StatCard label="Preço" value={stats.price_changes} icon={DollarSign} color="text-yellow-400" />
          <StatCard label="Stock" value={stats.stock_changes} icon={AlertTriangle} color="text-orange-400" />
          <StatCard label="Δ Preço Médio" value={`${stats.avg_price_change.toFixed(1)}%`} icon={BarChart3} color="text-primary" />
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <Select value={filterSchedule} onValueChange={setFilterSchedule}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Todos os agendamentos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os agendamentos</SelectItem>
            {schedules?.map((s: any) => (
              <SelectItem key={s.id} value={s.id}>{s.schedule_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Todos os tipos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {Object.entries(CHANGE_TYPE_CONFIG).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Change Log Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : !filteredLogs?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Activity className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">Sem alterações detetadas</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              As alterações aparecem aqui após execuções de scraping agendado
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Campo</TableHead>
                    <TableHead>Antes</TableHead>
                    <TableHead>Depois</TableHead>
                    <TableHead>Δ</TableHead>
                    <TableHead>Quando</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log: any) => {
                    const cfg = CHANGE_TYPE_CONFIG[log.change_type] || CHANGE_TYPE_CONFIG.other;
                    const Icon = cfg.icon;
                    return (
                      <TableRow key={log.id}>
                        <TableCell>
                          <Badge className={`${cfg.color} text-xs`}>
                            <Icon className="w-3 h-3 mr-1" />
                            {cfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono">{log.product_sku || "—"}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm">{log.product_title || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{log.field_name || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[120px] truncate">
                          {log.old_value ? (
                            <span className="text-red-400">{log.old_value}</span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-xs max-w-[120px] truncate">
                          {log.new_value ? (
                            <span className="text-green-400">{log.new_value}</span>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          {log.change_magnitude != null ? (
                            <span className={`text-xs font-medium flex items-center gap-1 ${log.change_magnitude > 0 ? "text-red-400" : "text-green-400"}`}>
                              {log.change_magnitude > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {log.change_magnitude > 0 ? "+" : ""}{log.change_magnitude}%
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: pt })}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: any; color: string }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <Icon className={`w-5 h-5 ${color}`} />
        <div>
          <p className="text-lg font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
