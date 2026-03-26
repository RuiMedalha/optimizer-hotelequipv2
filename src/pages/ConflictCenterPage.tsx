import { useState } from "react";
import { useConflictResolution } from "@/hooks/useConflictResolution";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle, Clock, Shield, Zap, Scale, ListChecks } from "lucide-react";
import { Loader2 } from "lucide-react";

const SEVERITY_CONFIG = {
  critical: { color: "destructive" as const, icon: AlertTriangle },
  high: { color: "destructive" as const, icon: AlertTriangle },
  medium: { color: "secondary" as const, icon: Clock },
  low: { color: "outline" as const, icon: CheckCircle },
};

const STATUS_LABELS: Record<string, string> = {
  open: "Aberto",
  in_review: "Em Revisão",
  auto_resolved: "Auto-resolvido",
  human_resolved: "Resolvido",
  rejected: "Rejeitado",
  closed: "Fechado",
};

export default function ConflictCenterPage() {
  const { conflicts, reviewTasks, resolutionRules, publishApprovalRules, isLoading, attemptAutoResolution, resolveConflictCase } = useConflictResolution();
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = conflicts.filter((c: any) => {
    if (severityFilter !== "all" && c.severity !== severityFilter) return false;
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    return true;
  });

  const openCount = conflicts.filter((c: any) => c.status === "open").length;
  const criticalCount = conflicts.filter((c: any) => c.severity === "critical" && c.status === "open").length;
  const reviewCount = reviewTasks.filter((t: any) => ["pending", "assigned", "in_review"].includes(t.status)).length;
  const resolvedCount = conflicts.filter((c: any) => ["auto_resolved", "human_resolved"].includes(c.status)).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Conflict Center</h1>
        <p className="text-muted-foreground mt-1">Deteção, resolução e revisão de conflitos</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{openCount}</p>
                <p className="text-sm text-muted-foreground">Abertos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <Shield className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{criticalCount}</p>
                <p className="text-sm text-muted-foreground">Críticos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Clock className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{reviewCount}</p>
                <p className="text-sm text-muted-foreground">Em Revisão</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/50">
                <CheckCircle className="w-5 h-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{resolvedCount}</p>
                <p className="text-sm text-muted-foreground">Resolvidos</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="conflicts">
        <TabsList>
          <TabsTrigger value="conflicts"><Scale className="w-4 h-4 mr-1" /> Conflitos</TabsTrigger>
          <TabsTrigger value="review"><ListChecks className="w-4 h-4 mr-1" /> Revisão Humana</TabsTrigger>
          <TabsTrigger value="rules"><Zap className="w-4 h-4 mr-1" /> Regras</TabsTrigger>
          <TabsTrigger value="publish"><Shield className="w-4 h-4 mr-1" /> Publish Approval</TabsTrigger>
        </TabsList>

        <TabsContent value="conflicts" className="space-y-4">
          <div className="flex gap-3">
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Severidade" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="critical">Crítica</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="medium">Média</SelectItem>
                <SelectItem value="low">Baixa</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="open">Aberto</SelectItem>
                <SelectItem value="in_review">Em Revisão</SelectItem>
                <SelectItem value="auto_resolved">Auto-resolvido</SelectItem>
                <SelectItem value="human_resolved">Resolvido</SelectItem>
                <SelectItem value="closed">Fechado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Sem conflitos encontrados.</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {filtered.map((c: any) => {
                const cfg = SEVERITY_CONFIG[c.severity as keyof typeof SEVERITY_CONFIG] || SEVERITY_CONFIG.medium;
                const Icon = cfg.icon;
                return (
                  <Card key={c.id}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Icon className="w-5 h-5 text-muted-foreground" />
                          <div>
                            <p className="font-medium text-foreground">{c.conflict_type.replace(/_/g, " ")}</p>
                            <p className="text-sm text-muted-foreground">Scope: {c.conflict_scope} • {new Date(c.created_at).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={cfg.color}>{c.severity}</Badge>
                          <Badge variant="outline">{STATUS_LABELS[c.status] || c.status}</Badge>
                          {c.requires_human_review && <Badge variant="secondary">Revisão Humana</Badge>}
                          {c.status === "open" && (
                            <Button size="sm" variant="outline" onClick={() => attemptAutoResolution.mutate(c.id)}>
                              Auto-resolver
                            </Button>
                          )}
                          {c.status === "open" && (
                            <Button size="sm" variant="default" onClick={() => resolveConflictCase.mutate({ conflict_case_id: c.id, resolution_source: "human" })}>
                              Resolver
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="review" className="space-y-3">
          {reviewTasks.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Sem tarefas de revisão pendentes.</CardContent></Card>
          ) : (
            reviewTasks.map((t: any) => (
              <Card key={t.id}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground">{t.task_type.replace(/_/g, " ")}</p>
                      <p className="text-sm text-muted-foreground">Prioridade: {t.priority} • {t.review_reason || "—"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={t.status === "pending" ? "destructive" : "secondary"}>{t.status}</Badge>
                      {t.due_at && <span className="text-xs text-muted-foreground">SLA: {new Date(t.due_at).toLocaleDateString()}</span>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="rules" className="space-y-3">
          <Card>
            <CardHeader><CardTitle>Regras de Resolução Automática</CardTitle></CardHeader>
            <CardContent>
              {resolutionRules.length === 0 ? (
                <p className="text-muted-foreground">Nenhuma regra configurada.</p>
              ) : (
                <div className="space-y-2">
                  {resolutionRules.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium text-foreground">{r.rule_name}</p>
                        <p className="text-sm text-muted-foreground">{r.conflict_type} → {r.resolution_mode}</p>
                      </div>
                      <Badge variant={r.is_active ? "default" : "outline"}>{r.is_active ? "Ativa" : "Inativa"}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="publish" className="space-y-3">
          <Card>
            <CardHeader><CardTitle>Regras de Aprovação de Publicação</CardTitle></CardHeader>
            <CardContent>
              {publishApprovalRules.length === 0 ? (
                <p className="text-muted-foreground">Nenhuma regra configurada.</p>
              ) : (
                <div className="space-y-2">
                  {publishApprovalRules.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium text-foreground">{r.rule_name}</p>
                        <p className="text-sm text-muted-foreground">
                          Mode: {r.approval_mode} • Quality ≥ {r.min_quality_score} • Confidence ≥ {r.min_confidence_score}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {r.block_on_conflict && <Badge variant="destructive">Bloqueia conflitos</Badge>}
                        {r.require_human_approval && <Badge variant="secondary">Aprovação humana</Badge>}
                        <Badge variant={r.is_active ? "default" : "outline"}>{r.is_active ? "Ativa" : "Inativa"}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
