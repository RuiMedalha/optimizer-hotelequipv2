import { useState } from "react";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import {
  useDecisionSignals, useDecisions, useDecisionExplanations,
  useImpactModels, useImpactEvaluations, useDecisionPolicies,
  useRunDecisionEngine, useApproveDecision, useRejectDecision,
  useCreatePlanFromDecision, useSaveImpactModel,
} from "@/hooks/useDecisionEngine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Zap, Target, TrendingUp, Shield, Eye, ThumbsUp, ThumbsDown, ArrowRight, Brain } from "lucide-react";

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-white",
  low: "bg-muted text-muted-foreground",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  executed: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  expired: "bg-muted text-muted-foreground",
};

const DEFAULT_WEIGHTS = [
  { dimension: "revenue", label: "Receita", weight: 0.35 },
  { dimension: "conversion", label: "Conversão", weight: 0.25 },
  { dimension: "seo_visibility", label: "Visibilidade SEO", weight: 0.15 },
  { dimension: "channel_compliance", label: "Conformidade Canal", weight: 0.15 },
  { dimension: "catalog_quality", label: "Qualidade Catálogo", weight: 0.05 },
  { dimension: "automation_efficiency", label: "Eficiência Automação", weight: 0.05 },
];

export default function BrainDecisionEnginePage() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;

  const { data: signals = [], isLoading: loadingSignals } = useDecisionSignals(wsId);
  const { data: decisions = [], isLoading: loadingDecisions } = useDecisions(wsId);
  const { data: impactModels = [] } = useImpactModels(wsId);
  const { data: evaluations = [] } = useImpactEvaluations(wsId);
  const { data: policies = [] } = useDecisionPolicies(wsId);

  const runEngine = useRunDecisionEngine();
  const approveDecision = useApproveDecision();
  const rejectDecision = useRejectDecision();
  const createPlan = useCreatePlanFromDecision();
  const saveWeights = useSaveImpactModel();

  const [inspectId, setInspectId] = useState<string | null>(null);
  const { data: explanation } = useDecisionExplanations(inspectId);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [tab, setTab] = useState("dashboard");

  // Init weights from DB
  useState(() => {
    if (impactModels.length > 0) {
      setWeights(DEFAULT_WEIGHTS.map((w) => {
        const found = impactModels.find((m: any) => m.dimension === w.dimension);
        return found ? { ...w, weight: Number(found.weight) } : w;
      }));
    }
  });

  const pendingDecisions = decisions.filter((d: any) => d.status === "pending");
  const approvedDecisions = decisions.filter((d: any) => d.status === "approved");
  const criticalCount = decisions.filter((d: any) => d.priority_level === "critical").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Decision Engine</h1>
          <p className="text-muted-foreground text-sm">Motor de decisão económica para otimização do catálogo</p>
        </div>
        <Button onClick={() => wsId && runEngine.mutate({ workspaceId: wsId })} disabled={runEngine.isPending || !wsId}>
          {runEngine.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
          Executar Motor
        </Button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-foreground">{signals.length}</p>
          <p className="text-xs text-muted-foreground">Sinais</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-foreground">{evaluations.length}</p>
          <p className="text-xs text-muted-foreground">Avaliações</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-foreground">{pendingDecisions.length}</p>
          <p className="text-xs text-muted-foreground">Pendentes</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-primary">{approvedDecisions.length}</p>
          <p className="text-xs text-muted-foreground">Aprovadas</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-destructive">{criticalCount}</p>
          <p className="text-xs text-muted-foreground">Críticas</p>
        </CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="dashboard"><Target className="w-4 h-4 mr-1" />Decisões</TabsTrigger>
          <TabsTrigger value="signals"><Zap className="w-4 h-4 mr-1" />Sinais</TabsTrigger>
          <TabsTrigger value="impact"><TrendingUp className="w-4 h-4 mr-1" />Modelo Impacto</TabsTrigger>
          <TabsTrigger value="policies"><Shield className="w-4 h-4 mr-1" />Políticas</TabsTrigger>
        </TabsList>

        {/* Decisions Tab */}
        <TabsContent value="dashboard" className="space-y-3">
          {loadingDecisions ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : decisions.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Sem decisões. Execute o motor para detetar oportunidades.</CardContent></Card>
          ) : (
            decisions.map((d: any) => (
              <Card key={d.id} className="hover:shadow-md transition-shadow">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Badge className={PRIORITY_COLORS[d.priority_level] || ""}>{d.priority_level}</Badge>
                      <Badge variant="outline" className={STATUS_COLORS[d.status] || ""}>{d.status}</Badge>
                      <span className="text-sm font-medium text-foreground truncate">{d.decision_type}</span>
                      <span className="text-xs text-muted-foreground">ID: {d.entity_id?.substring(0, 8)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right mr-3">
                        <p className="text-sm font-bold text-foreground">{Number(d.priority_score).toFixed(1)}</p>
                        <p className="text-[10px] text-muted-foreground">Prioridade</p>
                      </div>
                      <div className="text-right mr-3">
                        <p className="text-sm font-bold text-foreground">{Number(d.impact_score).toFixed(1)}</p>
                        <p className="text-[10px] text-muted-foreground">Impacto</p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setInspectId(d.id)}><Eye className="w-4 h-4" /></Button>
                      {d.status === "pending" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => approveDecision.mutate({ decisionId: d.id })} disabled={approveDecision.isPending}>
                            <ThumbsUp className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => rejectDecision.mutate({ decisionId: d.id })} disabled={rejectDecision.isPending}>
                            <ThumbsDown className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      {d.status === "approved" && (
                        <Button size="sm" onClick={() => createPlan.mutate({ decisionId: d.id })} disabled={createPlan.isPending}>
                          <ArrowRight className="w-4 h-4 mr-1" />Plano
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Signals Tab */}
        <TabsContent value="signals" className="space-y-3">
          {loadingSignals ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : signals.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Sem sinais detetados.</CardContent></Card>
          ) : (
            <div className="grid gap-2">
              {signals.slice(0, 50).map((s: any) => (
                <Card key={s.id}>
                  <CardContent className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">{s.signal_type}</Badge>
                      <span className="text-xs text-muted-foreground">{s.source}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-muted-foreground">Severidade: <strong className="text-foreground">{s.severity}</strong></span>
                      <span className="text-muted-foreground">Confiança: <strong className="text-foreground">{s.confidence}%</strong></span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Impact Model Tab */}
        <TabsContent value="impact" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Pesos do Modelo de Impacto</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              {weights.map((w, i) => (
                <div key={w.dimension} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground font-medium">{w.label}</span>
                    <span className="text-muted-foreground">{(w.weight * 100).toFixed(0)}%</span>
                  </div>
                  <Slider
                    value={[w.weight * 100]}
                    min={0} max={100} step={5}
                    onValueChange={([v]) => {
                      const next = [...weights];
                      next[i] = { ...next[i], weight: v / 100 };
                      setWeights(next);
                    }}
                  />
                </div>
              ))}
              <Button
                className="w-full"
                onClick={() => wsId && saveWeights.mutate({
                  workspaceId: wsId,
                  models: weights.map((w) => ({ dimension: w.dimension, weight: w.weight })),
                })}
                disabled={saveWeights.isPending || !wsId}
              >
                Guardar Pesos
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Policies Tab */}
        <TabsContent value="policies" className="space-y-3">
          {policies.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">
              Sem políticas configuradas. Todas as decisões requerem revisão humana.
            </CardContent></Card>
          ) : (
            policies.map((p: any) => (
              <Card key={p.id}>
                <CardContent className="py-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">{p.policy_name}</p>
                    <p className="text-xs text-muted-foreground">{p.requires_human_review ? "Revisão humana" : "Auto-aprovado"}</p>
                  </div>
                  <Badge variant={p.requires_human_review ? "outline" : "default"}>
                    {p.requires_human_review ? "Manual" : "Auto"}
                  </Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Decision Inspector Dialog */}
      <Dialog open={!!inspectId} onOpenChange={(open) => !open && setInspectId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Brain className="w-5 h-5" />Inspeção de Decisão</DialogTitle>
          </DialogHeader>
          {explanation ? (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-foreground mb-1">Explicação</p>
                <p className="text-sm text-muted-foreground">{explanation.explanation?.reasoning || "Sem detalhes."}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Sinais utilizados</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(explanation.explanation?.signals_used || []).map((s: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">{s}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Dimensões de impacto</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(explanation.explanation?.impact_dimensions || []).map((d: string, i: number) => (
                      <Badge key={i} variant="secondary" className="text-xs">{d}</Badge>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Impacto Total</p>
                  <p className="text-lg font-bold text-foreground">{explanation.explanation?.total_impact?.toFixed(1)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Confiança</p>
                  <p className="text-lg font-bold text-foreground">{explanation.confidence}%</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-4 text-center text-muted-foreground">A carregar explicação...</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
