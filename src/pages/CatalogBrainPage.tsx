import { useState } from "react";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import {
  useBrainObservations, useBrainPlans, useBrainPlanSteps,
  useBrainOutcomes, useBrainEntities, useBrainRelations,
  useProductDNA, useCatalogClusters,
  useRunBrainOrchestration, useApprovePlan, useBrainLearn,
} from "@/hooks/useCatalogBrain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Brain, Play, Eye, Network, ClipboardCheck, Activity,
  CheckCircle, XCircle, Clock, AlertTriangle, Star, Dna,
  Target, TrendingUp, Layers,
} from "lucide-react";

const planStatusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  ready: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  running: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  completed: "bg-green-500/10 text-green-700 dark:text-green-400",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

const stepStatusIcons: Record<string, any> = {
  pending: Clock, running: Activity, completed: CheckCircle, failed: XCircle, skipped: AlertTriangle,
};

export default function CatalogBrainPage() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;

  const { data: observations = [] } = useBrainObservations(wsId);
  const { data: plans = [] } = useBrainPlans(wsId);
  const { data: outcomes = [] } = useBrainOutcomes(wsId);
  const { data: entities = [] } = useBrainEntities(wsId);
  const { data: relations = [] } = useBrainRelations(wsId);
  const { data: dnaProfiles = [] } = useProductDNA(wsId);
  const { data: clusters = [] } = useCatalogClusters(wsId);

  const orchestrate = useRunBrainOrchestration();
  const approvePlan = useApprovePlan();
  const learn = useBrainLearn();

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const { data: planSteps = [] } = useBrainPlanSteps(selectedPlanId);

  const unprocessedObs = observations.filter((o: any) => !o.processed).length;
  const activePlans = plans.filter((p: any) => ["draft", "ready", "running"].includes(p.status)).length;
  const improvements = outcomes.filter((o: any) => o.outcome_type === "improvement").length;
  const avgDNA = dnaProfiles.length
    ? Math.round(dnaProfiles.reduce((s: number, d: any) => s + (d.completeness_score || 0), 0) / dnaProfiles.length)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Brain className="w-6 h-6" /> Catalog Brain
          </h1>
          <p className="text-muted-foreground text-sm">Camada central de inteligência autónoma</p>
        </div>
        <Button onClick={() => wsId && orchestrate.mutate({ workspaceId: wsId })} disabled={orchestrate.isPending || !wsId}>
          <Play className="w-4 h-4 mr-2" /> {orchestrate.isPending ? "A orquestrar..." : "Orquestrar Ciclo"}
        </Button>
      </div>

      {/* Health Score */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card><CardContent className="pt-4 text-center">
          <Eye className="w-5 h-5 mx-auto mb-1 text-primary" />
          <p className="text-2xl font-bold">{unprocessedObs}</p>
          <p className="text-xs text-muted-foreground">Observações</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <Target className="w-5 h-5 mx-auto mb-1 text-blue-500" />
          <p className="text-2xl font-bold">{activePlans}</p>
          <p className="text-xs text-muted-foreground">Planos Ativos</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <Network className="w-5 h-5 mx-auto mb-1 text-purple-500" />
          <p className="text-2xl font-bold">{entities.length}</p>
          <p className="text-xs text-muted-foreground">Entidades</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <Layers className="w-5 h-5 mx-auto mb-1 text-orange-500" />
          <p className="text-2xl font-bold">{relations.length}</p>
          <p className="text-xs text-muted-foreground">Relações</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <TrendingUp className="w-5 h-5 mx-auto mb-1 text-green-500" />
          <p className="text-2xl font-bold">{improvements}</p>
          <p className="text-xs text-muted-foreground">Melhorias</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <Dna className="w-5 h-5 mx-auto mb-1 text-pink-500" />
          <p className="text-2xl font-bold">{avgDNA}%</p>
          <p className="text-xs text-muted-foreground">DNA Médio</p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="plans">
        <TabsList>
          <TabsTrigger value="plans"><ClipboardCheck className="w-4 h-4 mr-1" /> Planos</TabsTrigger>
          <TabsTrigger value="observations"><Eye className="w-4 h-4 mr-1" /> Observações</TabsTrigger>
          <TabsTrigger value="graph"><Network className="w-4 h-4 mr-1" /> Grafo</TabsTrigger>
          <TabsTrigger value="dna"><Dna className="w-4 h-4 mr-1" /> DNA</TabsTrigger>
          <TabsTrigger value="outcomes"><Star className="w-4 h-4 mr-1" /> Outcomes</TabsTrigger>
        </TabsList>

        {/* Plans */}
        <TabsContent value="plans" className="space-y-3">
          {plans.map((plan: any) => (
            <Card key={plan.id} className="cursor-pointer hover:border-primary/30 transition-colors" onClick={() => setSelectedPlanId(plan.id === selectedPlanId ? null : plan.id)}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-medium text-sm">{plan.plan_name}</p>
                    <p className="text-xs text-muted-foreground">{plan.plan_description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={planStatusColors[plan.status] || ""}>{plan.status}</Badge>
                    <Badge variant="outline">Confiança: {plan.confidence}%</Badge>
                    {plan.status === "draft" && plan.requires_approval && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); approvePlan.mutate({ planId: plan.id }); }}>
                        <CheckCircle className="w-3 h-3 mr-1" /> Aprovar
                      </Button>
                    )}
                  </div>
                </div>
                {selectedPlanId === plan.id && planSteps.length > 0 && (
                  <div className="mt-3 space-y-2 border-t pt-3">
                    {planSteps.map((step: any) => {
                      const Icon = stepStatusIcons[step.status] || Clock;
                      return (
                        <div key={step.id} className="flex items-center gap-3 text-xs">
                          <span className="text-muted-foreground w-5">{step.step_order}</span>
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="flex-1">{step.step_description || step.step_type}</span>
                          <Badge variant="outline" className="text-[10px]">{step.status}</Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {!plans.length && <p className="text-sm text-muted-foreground text-center py-8">Nenhum plano gerado. Execute um ciclo de orquestração.</p>}
        </TabsContent>

        {/* Observations */}
        <TabsContent value="observations" className="space-y-2">
          {observations.slice(0, 50).map((obs: any) => (
            <Card key={obs.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{obs.observation_type}</p>
                  <p className="text-xs text-muted-foreground">Fonte: {obs.signal_source} · Severidade: {obs.severity}</p>
                </div>
                <Badge variant={obs.processed ? "secondary" : "default"}>
                  {obs.processed ? "Processada" : "Pendente"}
                </Badge>
              </CardContent>
            </Card>
          ))}
          {!observations.length && <p className="text-sm text-muted-foreground text-center py-8">Nenhuma observação registada.</p>}
        </TabsContent>

        {/* Graph */}
        <TabsContent value="graph" className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Entidades ({entities.length})</CardTitle></CardHeader>
              <CardContent className="max-h-80 overflow-y-auto space-y-1">
                {entities.slice(0, 50).map((e: any) => (
                  <div key={e.id} className="flex items-center gap-2 text-xs py-1">
                    <Badge variant="outline" className="text-[10px]">{e.entity_type}</Badge>
                    <span className="truncate">{e.entity_label || e.entity_id}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Relações ({relations.length})</CardTitle></CardHeader>
              <CardContent className="max-h-80 overflow-y-auto space-y-1">
                {relations.slice(0, 50).map((r: any) => (
                  <div key={r.id} className="flex items-center gap-2 text-xs py-1">
                    <Badge variant="outline" className="text-[10px]">{r.relation_type}</Badge>
                    <span className="text-muted-foreground">peso: {r.weight}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
          {clusters.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Clusters ({clusters.length})</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {clusters.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium">{c.cluster_name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{c.cluster_type}</span>
                    </div>
                    <Badge variant="outline">{c.product_ids?.length || 0} produtos</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* DNA */}
        <TabsContent value="dna" className="space-y-2">
          {dnaProfiles.slice(0, 50).map((dna: any) => (
            <Card key={dna.id}>
              <CardContent className="py-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium truncate">{dna.product_id}</p>
                  <div className="flex gap-2">
                    <Badge variant="outline">Completude: {dna.completeness_score}%</Badge>
                    <Badge variant="outline">Qualidade: {dna.quality_score}</Badge>
                  </div>
                </div>
                <Progress value={dna.completeness_score} className="h-1.5" />
              </CardContent>
            </Card>
          ))}
          {!dnaProfiles.length && <p className="text-sm text-muted-foreground text-center py-8">Nenhum perfil DNA gerado.</p>}
        </TabsContent>

        {/* Outcomes */}
        <TabsContent value="outcomes" className="space-y-2">
          {outcomes.map((o: any) => (
            <Card key={o.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{o.outcome_type}</p>
                  <p className="text-xs text-muted-foreground">Impacto: {o.impact_score} · {o.measured_at ? new Date(o.measured_at).toLocaleString("pt-PT") : "Pendente"}</p>
                </div>
                <div className="flex items-center gap-2">
                  {o.feedback_rating ? (
                    <Badge variant="secondary">{o.feedback_rating}/5 ⭐</Badge>
                  ) : (
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((r) => (
                        <button key={r} onClick={() => learn.mutate({ outcomeId: o.id, feedbackRating: r })}
                          className="w-6 h-6 rounded text-xs hover:bg-accent transition-colors">
                          {r}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {!outcomes.length && <p className="text-sm text-muted-foreground text-center py-8">Nenhum outcome registado.</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
