import { useState } from "react";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import {
  useSimulationScenarios, useSimulationRuns, useSimulationResults,
  useActionSimulations, useRunSimulation, useEvaluateSimulations,
} from "@/hooks/useSimulationEngine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, FlaskConical, Play, Eye, ShieldAlert, TrendingUp, BarChart3, Zap } from "lucide-react";

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const SIM_TYPES = [
  { value: "seo_simulation", label: "SEO" },
  { value: "feed_validation_simulation", label: "Feed" },
  { value: "conversion_simulation", label: "Conversão" },
  { value: "pricing_simulation", label: "Pricing" },
  { value: "bundle_simulation", label: "Bundle" },
  { value: "translation_quality_simulation", label: "Tradução" },
  { value: "image_quality_simulation", label: "Imagem" },
  { value: "schema_validation_simulation", label: "Schema" },
];

export default function BrainSimulationPage() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;

  const { data: scenarios = [], isLoading: loadingScenarios } = useSimulationScenarios(wsId);
  const { data: runs = [], isLoading: loadingRuns } = useSimulationRuns(wsId);
  const { data: actionSims = [] } = useActionSimulations(wsId);

  const runSim = useRunSimulation();
  const evalSims = useEvaluateSimulations();

  const [tab, setTab] = useState("dashboard");
  const [simType, setSimType] = useState("seo_simulation");
  const [inspectRunId, setInspectRunId] = useState<string | null>(null);
  const { data: inspectResults = [] } = useSimulationResults(inspectRunId);

  const completedRuns = runs.filter((r: any) => r.status === "completed");
  const lowRisk = completedRuns.filter((r: any) => r.risk_level === "low").length;
  const highRisk = completedRuns.filter((r: any) => r.risk_level === "high").length;
  const recommended = actionSims.filter((a: any) => a.recommended).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Simulation Engine</h1>
          <p className="text-muted-foreground text-sm">Simular impacto de ações antes da execução</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => wsId && evalSims.mutate({ workspaceId: wsId })} disabled={evalSims.isPending || !wsId}>
            {evalSims.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
            Simular Decisões
          </Button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-foreground">{scenarios.length}</p>
          <p className="text-xs text-muted-foreground">Cenários</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-foreground">{completedRuns.length}</p>
          <p className="text-xs text-muted-foreground">Simulações</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-green-600">{lowRisk}</p>
          <p className="text-xs text-muted-foreground">Baixo Risco</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-destructive">{highRisk}</p>
          <p className="text-xs text-muted-foreground">Alto Risco</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-primary">{recommended}</p>
          <p className="text-xs text-muted-foreground">Recomendadas</p>
        </CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="dashboard"><BarChart3 className="w-4 h-4 mr-1" />Simulações</TabsTrigger>
          <TabsTrigger value="new"><Play className="w-4 h-4 mr-1" />Nova Simulação</TabsTrigger>
          <TabsTrigger value="actions"><TrendingUp className="w-4 h-4 mr-1" />Decisões Simuladas</TabsTrigger>
          <TabsTrigger value="risk"><ShieldAlert className="w-4 h-4 mr-1" />Risco</TabsTrigger>
        </TabsList>

        {/* Simulations Dashboard */}
        <TabsContent value="dashboard" className="space-y-3">
          {loadingRuns ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : runs.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Sem simulações. Crie uma nova ou simule decisões pendentes.</CardContent></Card>
          ) : (
            runs.map((r: any) => (
              <Card key={r.id} className="hover:shadow-md transition-shadow">
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FlaskConical className="w-4 h-4 text-muted-foreground" />
                    <Badge className={STATUS_COLORS[r.status] || ""}>{r.status}</Badge>
                    {r.risk_level && <Badge className={RISK_COLORS[r.risk_level] || ""}>Risco: {r.risk_level}</Badge>}
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">Confiança: <strong className="text-foreground">{r.confidence}%</strong></span>
                    <Button size="sm" variant="ghost" onClick={() => setInspectRunId(r.id)}><Eye className="w-4 h-4" /></Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* New Simulation */}
        <TabsContent value="new">
          <Card>
            <CardHeader><CardTitle className="text-lg">Criar Simulação Manual</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium text-foreground mb-2">Tipo de Simulação</p>
                <Select value={simType} onValueChange={setSimType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SIM_TYPES.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" onClick={() => wsId && runSim.mutate({ workspaceId: wsId, simulationType: simType })} disabled={runSim.isPending || !wsId}>
                {runSim.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                Executar Simulação
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Action Simulations */}
        <TabsContent value="actions" className="space-y-3">
          {actionSims.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Sem simulações de decisões.</CardContent></Card>
          ) : (
            actionSims.map((a: any) => (
              <Card key={a.id}>
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge className={RISK_COLORS[a.risk_level] || ""}>{a.risk_level}</Badge>
                    {a.recommended && <Badge className="bg-primary text-primary-foreground">Recomendada</Badge>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">EV: {Number(a.expected_value).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Expected Value</p>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Risk Map */}
        <TabsContent value="risk" className="space-y-3">
          <div className="grid grid-cols-3 gap-4">
            {["low", "medium", "high"].map((level) => {
              const count = completedRuns.filter((r: any) => r.risk_level === level).length;
              return (
                <Card key={level}>
                  <CardContent className="pt-4 text-center">
                    <Badge className={`${RISK_COLORS[level]} mb-2`}>{level.toUpperCase()}</Badge>
                    <p className="text-3xl font-bold text-foreground">{count}</p>
                    <p className="text-xs text-muted-foreground">simulações</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Inspect Dialog */}
      <Dialog open={!!inspectRunId} onOpenChange={(open) => !open && setInspectRunId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FlaskConical className="w-5 h-5" />Resultados da Simulação</DialogTitle></DialogHeader>
          {inspectResults.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">Sem resultados.</p>
          ) : (
            <div className="space-y-3">
              {inspectResults.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div>
                    <p className="text-sm font-medium text-foreground">{r.metric_type}</p>
                    <Badge variant="outline" className="text-xs">{r.result_type}</Badge>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">{Number(r.baseline_value).toFixed(1)} → <strong className="text-foreground">{Number(r.predicted_value).toFixed(1)}</strong></p>
                    <p className={`text-xs font-bold ${Number(r.delta) >= 0 ? "text-green-600" : "text-destructive"}`}>
                      {Number(r.delta) >= 0 ? "+" : ""}{Number(r.delta).toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
