import { useCostIntelligence } from "@/hooks/useCostIntelligence";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DollarSign, AlertTriangle, TrendingDown, BarChart3, Bell, Shield, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

const severityColor = (s: string) => {
  if (s === "critical" || s === "high") return "destructive";
  if (s === "medium") return "secondary";
  return "outline";
};

export default function CostDashboardPage() {
  const {
    budgets, costRecords, alerts, forecasts, optimizationRules, savingsLogs,
    generateAlerts, totalCostThisMonth, totalSavings,
  } = useCostIntelligence();

  // Group costs by category
  const costByCategory: Record<string, number> = {};
  (costRecords.data || []).forEach((r: any) => {
    const month = new Date(r.created_at).getMonth();
    if (month === new Date().getMonth()) {
      costByCategory[r.cost_category] = (costByCategory[r.cost_category] || 0) + Number(r.total_cost || 0);
    }
  });

  const sortedCategories = Object.entries(costByCategory).sort((a, b) => b[1] - a[1]);
  const maxCategoryCost = sortedCategories.length > 0 ? sortedCategories[0][1] : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cost Intelligence</h1>
          <p className="text-muted-foreground text-sm">Controlo económico, previsões e otimização de consumo</p>
        </div>
        <Button variant="outline" onClick={() => generateAlerts.mutate()} disabled={generateAlerts.isPending}>
          <Bell className="h-4 w-4 mr-1" /> Verificar Alertas
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><DollarSign className="h-5 w-5 text-primary" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Custo este mês</p>
                <p className="text-xl font-bold">{totalCostThisMonth.toFixed(2)}€</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10"><TrendingDown className="h-5 w-5 text-green-600" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Poupanças</p>
                <p className="text-xl font-bold">{totalSavings.toFixed(2)}€</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/10"><AlertTriangle className="h-5 w-5 text-orange-600" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Alertas abertos</p>
                <p className="text-xl font-bold">{alerts.data?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10"><BarChart3 className="h-5 w-5 text-blue-600" /></div>
              <div>
                <p className="text-xs text-muted-foreground">Operações registadas</p>
                <p className="text-xl font-bold">{costRecords.data?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Custos</TabsTrigger>
          <TabsTrigger value="budgets">Budgets</TabsTrigger>
          <TabsTrigger value="alerts">Alertas</TabsTrigger>
          <TabsTrigger value="forecasts">Previsões</TabsTrigger>
          <TabsTrigger value="rules">Regras</TabsTrigger>
          <TabsTrigger value="savings">Poupanças</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Cost by category bar chart */}
            <Card>
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Custo por Categoria</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {sortedCategories.length === 0 && <p className="text-muted-foreground text-sm text-center py-4">Sem registos</p>}
                {sortedCategories.map(([cat, cost]) => (
                  <div key={cat} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium">{cat.replace(/_/g, " ")}</span>
                      <span>{cost.toFixed(3)}€</span>
                    </div>
                    <Progress value={(cost / maxCategoryCost) * 100} className="h-2" />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Recent cost records */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Últimos Registos</CardTitle></CardHeader>
              <CardContent>
                {costRecords.isLoading ? <Skeleton className="h-40" /> : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {(costRecords.data || []).slice(0, 20).map((r: any) => (
                      <div key={r.id} className="flex items-center justify-between p-2 rounded border text-xs">
                        <div>
                          <Badge variant="outline" className="text-xs">{r.cost_category}</Badge>
                          <span className="ml-2 text-muted-foreground">{r.job_type}</span>
                          {r.model_name && <span className="ml-1 text-muted-foreground font-mono">({r.model_name})</span>}
                        </div>
                        <span className="font-medium">{Number(r.total_cost).toFixed(4)}€</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="budgets">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4" /> Budgets</CardTitle></CardHeader>
            <CardContent>
              {budgets.isLoading ? <Skeleton className="h-40" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Período</TableHead>
                      <TableHead>Limite</TableHead>
                      <TableHead>Alerta %</TableHead>
                      <TableHead>Hard Limit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(budgets.data || []).map((b: any) => (
                      <TableRow key={b.id}>
                        <TableCell><Badge variant="outline" className="text-xs">{b.budget_type}</Badge></TableCell>
                        <TableCell className="text-xs">{b.budget_period}</TableCell>
                        <TableCell className="font-medium">{Number(b.budget_limit).toFixed(2)}€</TableCell>
                        <TableCell className="text-xs">{b.warning_threshold_percent}%</TableCell>
                        <TableCell>{b.hard_limit_enabled ? <Badge className="text-xs">Ativo</Badge> : <Badge variant="outline" className="text-xs">Desligado</Badge>}</TableCell>
                      </TableRow>
                    ))}
                    {(!budgets.data || budgets.data.length === 0) && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Sem budgets configurados</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Alertas</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(alerts.data || []).map((a: any) => (
                <div key={a.id} className="flex items-center justify-between p-3 rounded border">
                  <div className="flex items-center gap-3">
                    <Badge variant={severityColor(a.severity)} className="text-xs">{a.severity}</Badge>
                    <div>
                      <p className="text-sm font-medium">{a.message}</p>
                      <p className="text-xs text-muted-foreground">{a.alert_type.replace(/_/g, " ")} — {Number(a.current_value).toFixed(2)}€ / {Number(a.threshold_value).toFixed(2)}€</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">{a.status}</Badge>
                </div>
              ))}
              {(!alerts.data || alerts.data.length === 0) && <p className="text-center text-muted-foreground py-8 text-sm">Sem alertas abertos</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forecasts">
          <Card>
            <CardHeader><CardTitle className="text-sm">Previsões de Custo</CardTitle></CardHeader>
            <CardContent>
              {forecasts.isLoading ? <Skeleton className="h-40" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead>Custo Estimado</TableHead>
                      <TableHead>Confiança</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(forecasts.data || []).map((f: any) => (
                      <TableRow key={f.id}>
                        <TableCell className="text-xs">{f.forecast_type}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{f.scope_type}</Badge></TableCell>
                        <TableCell className="font-medium">{Number(f.estimated_cost).toFixed(3)}€</TableCell>
                        <TableCell className="text-xs">{(Number(f.forecast_confidence) * 100).toFixed(0)}%</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(f.created_at).toLocaleDateString("pt-PT")}</TableCell>
                      </TableRow>
                    ))}
                    {(!forecasts.data || forecasts.data.length === 0) && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Sem previsões</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4" /> Regras de Otimização</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Regra</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Ativa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(optimizationRules.data || []).map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium text-sm">{r.rule_name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{r.scope_type}</Badge></TableCell>
                      <TableCell>{r.is_active ? <Badge className="text-xs">Ativa</Badge> : <Badge variant="outline" className="text-xs">Inativa</Badge>}</TableCell>
                    </TableRow>
                  ))}
                  {(!optimizationRules.data || optimizationRules.data.length === 0) && (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">Sem regras</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="savings">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><TrendingDown className="h-4 w-4" /> Poupanças</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ação</TableHead>
                    <TableHead>Poupança Est.</TableHead>
                    <TableHead>Poupança Real</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(savingsLogs.data || []).map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-sm">{s.action_type}</TableCell>
                      <TableCell className="font-medium text-green-600">{Number(s.estimated_saving).toFixed(3)}€</TableCell>
                      <TableCell>{s.actual_saving != null ? `${Number(s.actual_saving).toFixed(3)}€` : "—"}</TableCell>
                      <TableCell className="text-xs">{s.saving_scope || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleDateString("pt-PT")}</TableCell>
                    </TableRow>
                  ))}
                  {(!savingsLogs.data || savingsLogs.data.length === 0) && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Sem poupanças registadas</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
