import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Calendar, Clock, Plus, Play, Trash2, Pause, History,
  Globe, CheckCircle2, XCircle, Loader2, RefreshCw, Bell, BellOff,
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { pt } from "date-fns/locale";
import {
  useScrapingSchedules,
  useScrapingScheduleRuns,
  useCreateScrapingSchedule,
  useUpdateScrapingSchedule,
  useDeleteScrapingSchedule,
  useRunScheduleNow,
} from "@/hooks/useScrapingSchedules";

const FREQUENCY_OPTIONS = [
  { value: "hourly", label: "A cada hora", cron: "0 * * * *" },
  { value: "daily", label: "Diariamente", cron: "0 6 * * *" },
  { value: "weekly", label: "Semanalmente", cron: "0 6 * * 1" },
  { value: "monthly", label: "Mensalmente", cron: "0 6 1 * *" },
];

export function ScrapingScheduleManager() {
  const { data: schedules, isLoading } = useScrapingSchedules();
  const createSchedule = useCreateScrapingSchedule();
  const updateSchedule = useUpdateScrapingSchedule();
  const deleteSchedule = useDeleteScrapingSchedule();
  const runNow = useRunScheduleNow();

  const [showCreate, setShowCreate] = useState(false);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [newSchedule, setNewSchedule] = useState({
    schedule_name: "",
    source_url: "",
    frequency: "weekly",
    notify_on_changes: true,
  });

  const handleCreate = () => {
    if (!newSchedule.schedule_name || !newSchedule.source_url) {
      toast.error("Nome e URL são obrigatórios");
      return;
    }
    const freq = FREQUENCY_OPTIONS.find(f => f.value === newSchedule.frequency);
    createSchedule.mutate({
      ...newSchedule,
      cron_expression: freq?.cron || "0 6 * * 1",
    }, {
      onSuccess: () => {
        setShowCreate(false);
        setNewSchedule({ schedule_name: "", source_url: "", frequency: "weekly", notify_on_changes: true });
      },
    });
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case "success": return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle2 className="w-3 h-3 mr-1" />OK</Badge>;
      case "error": return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Erro</Badge>;
      case "running": return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30"><Loader2 className="w-3 h-3 mr-1 animate-spin" />A correr</Badge>;
      default: return <Badge variant="secondary">Pendente</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            Scraping Agendado
          </h3>
          <p className="text-sm text-muted-foreground">
            Monitorize websites automaticamente e detete alterações nos catálogos dos fornecedores
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm">
          <Plus className="w-4 h-4 mr-1" /> Novo Agendamento
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : !schedules?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">Nenhum agendamento configurado</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Crie um agendamento para monitorizar websites automaticamente
            </p>
            <Button onClick={() => setShowCreate(true)} className="mt-4" variant="outline" size="sm">
              <Plus className="w-4 h-4 mr-1" /> Criar Primeiro Agendamento
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Frequência</TableHead>
                  <TableHead>Último Run</TableHead>
                  <TableHead>Próximo Run</TableHead>
                  <TableHead>Produtos</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-muted-foreground" />
                        {s.schedule_name}
                        {s.notify_on_changes ? (
                          <TooltipProvider><Tooltip><TooltipTrigger><Bell className="w-3 h-3 text-primary" /></TooltipTrigger><TooltipContent>Notificações ativas</TooltipContent></Tooltip></TooltipProvider>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">{s.source_url}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {FREQUENCY_OPTIONS.find(f => f.value === s.frequency)?.label || s.frequency}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.last_run_at ? formatDistanceToNow(new Date(s.last_run_at), { addSuffix: true, locale: pt }) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.next_run_at && s.is_active ? format(new Date(s.next_run_at), "dd/MM HH:mm") : "—"}
                    </TableCell>
                    <TableCell>{s.last_run_products_count || 0}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(s.last_run_status)}
                        <Switch
                          checked={s.is_active}
                          onCheckedChange={(checked) => updateSchedule.mutate({ id: s.id, is_active: checked })}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <TooltipProvider>
                          <Tooltip><TooltipTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-8 w-8"
                              onClick={() => runNow.mutate(s.id)} disabled={runNow.isPending}>
                              {runNow.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                            </Button>
                          </TooltipTrigger><TooltipContent>Executar agora</TooltipContent></Tooltip>
                          <Tooltip><TooltipTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setShowHistory(s.id)}>
                              <History className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger><TooltipContent>Histórico</TooltipContent></Tooltip>
                          <Tooltip><TooltipTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive"
                              onClick={() => { if (confirm("Eliminar agendamento?")) deleteSchedule.mutate(s.id); }}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger><TooltipContent>Eliminar</TooltipContent></Tooltip>
                        </TooltipProvider>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Agendamento de Scraping</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Nome</label>
              <Input
                placeholder="Ex: Catálogo Fornecedor X"
                value={newSchedule.schedule_name}
                onChange={e => setNewSchedule(p => ({ ...p, schedule_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">URL do Website</label>
              <Input
                placeholder="https://fornecedor.com/catalogo"
                value={newSchedule.source_url}
                onChange={e => setNewSchedule(p => ({ ...p, source_url: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Frequência</label>
              <Select value={newSchedule.frequency} onValueChange={v => setNewSchedule(p => ({ ...p, frequency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map(f => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={newSchedule.notify_on_changes}
                onCheckedChange={v => setNewSchedule(p => ({ ...p, notify_on_changes: v }))}
              />
              <label className="text-sm">Notificar quando houver alterações</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={createSchedule.isPending}>
              {createSchedule.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={!!showHistory} onOpenChange={() => setShowHistory(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5" /> Histórico de Execuções
            </DialogTitle>
          </DialogHeader>
          {showHistory && <ScheduleRunHistory scheduleId={showHistory} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScheduleRunHistory({ scheduleId }: { scheduleId: string }) {
  const { data: runs, isLoading } = useScrapingScheduleRuns(scheduleId);

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!runs?.length) return <p className="text-center text-muted-foreground py-8">Sem execuções registadas</p>;

  return (
    <ScrollArea className="max-h-[400px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Encontrados</TableHead>
            <TableHead>Novos</TableHead>
            <TableHead>Atualizados</TableHead>
            <TableHead>Duração</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((r: any) => {
            const duration = r.completed_at && r.started_at
              ? Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000)
              : null;
            return (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{format(new Date(r.started_at), "dd/MM/yyyy HH:mm")}</TableCell>
                <TableCell>
                  <Badge variant={r.status === "completed" ? "default" : r.status === "error" ? "destructive" : "secondary"} className="text-xs">
                    {r.status === "completed" ? "✅ OK" : r.status === "error" ? "❌ Erro" : r.status}
                  </Badge>
                </TableCell>
                <TableCell>{r.products_found || 0}</TableCell>
                <TableCell className="text-green-400">{r.products_new || 0}</TableCell>
                <TableCell className="text-yellow-400">{r.products_updated || 0}</TableCell>
                <TableCell className="text-xs">{duration !== null ? `${duration}s` : "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
