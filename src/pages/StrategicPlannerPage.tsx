import { useState } from "react";
import { useStrategicPlanner } from "@/hooks/useStrategicPlanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Play, BarChart3, Lightbulb, ArrowUpDown, Rocket, TrendingUp, CheckCircle } from "lucide-react";

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  simulated: "bg-blue-500/10 text-blue-500",
  approved: "bg-green-500/10 text-green-500",
  scheduled: "bg-yellow-500/10 text-yellow-500",
  executing: "bg-orange-500/10 text-orange-500",
  completed: "bg-emerald-500/10 text-emerald-500",
  cancelled: "bg-destructive/10 text-destructive",
};

const actionTypeLabels: Record<string, string> = {
  launch_product: "Lançar Produto",
  expand_category: "Expandir Categoria",
  create_bundle: "Criar Bundle",
  run_promotion: "Promoção",
  optimize_price: "Otimizar Preço",
  improve_content: "Melhorar Conteúdo",
  add_cross_sell: "Cross-sell",
  add_upsell: "Upsell",
};

export default function StrategicPlannerPage() {
  const {
    plans,
    actions,
    simulations,
    recommendations,
    generatePlan,
    simulatePlan,
    rankActions,
    detectExpansion,
    detectLaunch,
    approvePlan,
  } = useStrategicPlanner();

  const [planType, setPlanType] = useState("quarterly_plan");

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Strategic Commerce Planner</h1>
          <p className="text-muted-foreground text-sm">Planeamento estratégico com AI</p>
        </div>
        <div className="flex gap-2">
          <Select value={planType} onValueChange={setPlanType}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="quarterly_plan">Plano Trimestral</SelectItem>
              <SelectItem value="category_strategy">Estratégia Categoria</SelectItem>
              <SelectItem value="launch_plan">Plano Lançamento</SelectItem>
              <SelectItem value="promotion_strategy">Estratégia Promoções</SelectItem>
              <SelectItem value="channel_strategy">Estratégia Canal</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => generatePlan.mutate({ plan_type: planType })} disabled={generatePlan.isPending}>
            {generatePlan.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Gerar Plano
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><BarChart3 className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-2xl font-bold">{plans.data?.length || 0}</p>
                <p className="text-xs text-muted-foreground">Planos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10"><Rocket className="w-5 h-5 text-blue-500" /></div>
              <div>
                <p className="text-2xl font-bold">{actions.data?.length || 0}</p>
                <p className="text-xs text-muted-foreground">Ações</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10"><TrendingUp className="w-5 h-5 text-green-500" /></div>
              <div>
                <p className="text-2xl font-bold">
                  €{((simulations.data || []).reduce((s, sim) => s + (sim.predicted_revenue || 0), 0)).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Revenue Previsto</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10"><Lightbulb className="w-5 h-5 text-yellow-500" /></div>
              <div>
                <p className="text-2xl font-bold">{recommendations.data?.length || 0}</p>
                <p className="text-xs text-muted-foreground">Recomendações</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="plans" className="space-y-4">
        <TabsList>
          <TabsTrigger value="plans">Planos</TabsTrigger>
          <TabsTrigger value="actions">Ações</TabsTrigger>
          <TabsTrigger value="simulations">Simulações</TabsTrigger>
          <TabsTrigger value="recommendations">Recomendações</TabsTrigger>
        </TabsList>

        <TabsContent value="plans" className="space-y-4">
          <div className="flex gap-2 mb-4">
            <Button variant="outline" size="sm" onClick={() => detectExpansion.mutate()} disabled={detectExpansion.isPending}>
              {detectExpansion.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
              Detetar Expansão
            </Button>
            <Button variant="outline" size="sm" onClick={() => detectLaunch.mutate()} disabled={detectLaunch.isPending}>
              {detectLaunch.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
              Oportunidades Lançamento
            </Button>
          </div>
          {plans.isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (plans.data || []).length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhum plano criado. Clique em "Gerar Plano" para começar.</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {(plans.data || []).map((plan) => (
                <Card key={plan.id}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold truncate">{plan.title}</h3>
                          <Badge variant="outline" className={statusColors[plan.status] || ""}>{plan.status}</Badge>
                          <Badge variant="secondary">{plan.plan_type?.replace("_", " ")}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{plan.description || `Horizonte: ${plan.planning_horizon_months} meses`}</p>
                        <p className="text-xs text-muted-foreground">{new Date(plan.created_at).toLocaleDateString("pt-PT")}</p>
                      </div>
                      <div className="flex gap-2 shrink-0 ml-4">
                        <Button size="sm" variant="outline" onClick={() => simulatePlan.mutate(plan.id)} disabled={simulatePlan.isPending}>
                          <Play className="w-3 h-3 mr-1" /> Simular
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => rankActions.mutate(plan.id)} disabled={rankActions.isPending}>
                          <ArrowUpDown className="w-3 h-3 mr-1" /> Rankear
                        </Button>
                        {plan.status !== "approved" && plan.status !== "completed" && (
                          <Button size="sm" onClick={() => approvePlan.mutate(plan.id)} disabled={approvePlan.isPending}>
                            <CheckCircle className="w-3 h-3 mr-1" /> Aprovar
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="actions" className="space-y-3">
          {(actions.data || []).length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhuma ação estratégica.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {(actions.data || []).map((action) => (
                <Card key={action.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge variant="outline">{actionTypeLabels[action.action_type] || action.action_type}</Badge>
                        <Badge variant="outline" className={statusColors[action.status] || ""}>{action.status}</Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-muted-foreground">Revenue: <strong className="text-foreground">€{(action.expected_revenue || 0).toLocaleString()}</strong></span>
                        <span className="text-muted-foreground">Conv: <strong className="text-foreground">{(action.expected_conversion || 0).toFixed(1)}%</strong></span>
                        <span className="text-muted-foreground">Score: <strong className="text-foreground">{(action.priority_score || 0).toFixed(0)}</strong></span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="simulations" className="space-y-3">
          {(simulations.data || []).length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhuma simulação executada.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(simulations.data || []).map((sim) => (
                <Card key={sim.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Simulação</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div><span className="text-muted-foreground">Revenue</span><p className="font-bold text-lg">€{(sim.predicted_revenue || 0).toLocaleString()}</p></div>
                      <div><span className="text-muted-foreground">Margem</span><p className="font-bold text-lg">€{(sim.predicted_margin || 0).toLocaleString()}</p></div>
                      <div><span className="text-muted-foreground">Conversão</span><p className="font-bold">{(sim.predicted_conversion || 0).toFixed(1)}%</p></div>
                      <div><span className="text-muted-foreground">Confiança</span><p className="font-bold">{sim.confidence || 0}%</p></div>
                    </div>
                    <p className="text-xs text-muted-foreground">{new Date(sim.created_at).toLocaleDateString("pt-PT")}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="recommendations" className="space-y-3">
          {(recommendations.data || []).length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhuma recomendação.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {(recommendations.data || []).map((rec) => (
                <Card key={rec.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <Badge variant="outline">{rec.recommendation_type}</Badge>
                        <p className="text-sm mt-1 text-muted-foreground">
                          {(rec.recommendation_payload as any)?.keyword || (rec.recommendation_payload as any)?.title || (rec.recommendation_payload as any)?.description || ""}
                        </p>
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-semibold">Impacto: €{(rec.expected_impact || 0).toLocaleString()}</p>
                        <p className="text-muted-foreground">Confiança: {rec.confidence || 0}%</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
