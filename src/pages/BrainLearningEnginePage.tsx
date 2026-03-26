import { useState } from "react";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import {
  useLearningSignals, usePerformanceHistory, useReinforcementMemory,
  useLearningModels, useRunLearningCycle, useSubmitFeedback,
} from "@/hooks/useLearningEngine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Loader2, GraduationCap, TrendingUp, TrendingDown, BarChart3, Cpu, Lightbulb, RefreshCw } from "lucide-react";

const OUTCOME_COLORS: Record<string, string> = {
  positive: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  neutral: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  negative: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function BrainLearningEnginePage() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;

  const { data: signals = [], isLoading: loadingSignals } = useLearningSignals(wsId);
  const { data: history = [], isLoading: loadingHistory } = usePerformanceHistory(wsId);
  const { data: memories = [] } = useReinforcementMemory(wsId);
  const { data: models = [] } = useLearningModels(wsId);

  const runLearning = useRunLearningCycle();
  const [tab, setTab] = useState("dashboard");

  const positiveCount = history.filter((h: any) => h.learning_outcome === "positive").length;
  const negativeCount = history.filter((h: any) => h.learning_outcome === "negative").length;
  const successRate = history.length > 0 ? Math.round((positiveCount / history.length) * 100) : 0;
  const avgReward = memories.length > 0
    ? Math.round(memories.reduce((s: number, m: any) => s + Number(m.reward), 0) / memories.length * 100) / 100
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Learning Engine</h1>
          <p className="text-muted-foreground text-sm">Motor de aprendizagem contínua do Catalog Brain</p>
        </div>
        <Button onClick={() => wsId && runLearning.mutate({ workspaceId: wsId })} disabled={runLearning.isPending || !wsId}>
          {runLearning.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Executar Aprendizagem
        </Button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-foreground">{history.length}</p>
          <p className="text-xs text-muted-foreground">Decisões Avaliadas</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-green-600">{successRate}%</p>
          <p className="text-xs text-muted-foreground">Taxa de Sucesso</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className={`text-2xl font-bold ${avgReward >= 0 ? "text-green-600" : "text-destructive"}`}>{avgReward}</p>
          <p className="text-xs text-muted-foreground">Reward Médio</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-foreground">{memories.length}</p>
          <p className="text-xs text-muted-foreground">Memórias</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-bold text-primary">{models.length}</p>
          <p className="text-xs text-muted-foreground">Modelos Ativos</p>
        </CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="dashboard"><BarChart3 className="w-4 h-4 mr-1" />Performance</TabsTrigger>
          <TabsTrigger value="signals"><GraduationCap className="w-4 h-4 mr-1" />Sinais</TabsTrigger>
          <TabsTrigger value="models"><Cpu className="w-4 h-4 mr-1" />Modelos</TabsTrigger>
          <TabsTrigger value="patterns"><Lightbulb className="w-4 h-4 mr-1" />Padrões</TabsTrigger>
        </TabsList>

        {/* Performance Tab */}
        <TabsContent value="dashboard" className="space-y-3">
          {loadingHistory ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : history.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Sem histórico de performance. Execute o ciclo de aprendizagem.</CardContent></Card>
          ) : (
            <>
              <Card>
                <CardHeader><CardTitle className="text-sm">Taxa de Sucesso Global</CardTitle></CardHeader>
                <CardContent>
                  <Progress value={successRate} className="h-3" />
                  <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                    <span>{positiveCount} positivas</span>
                    <span>{negativeCount} negativas</span>
                  </div>
                </CardContent>
              </Card>
              {history.slice(0, 20).map((h: any) => (
                <Card key={h.id}>
                  <CardContent className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {h.learning_outcome === "positive" ? <TrendingUp className="w-4 h-4 text-green-500" /> : h.learning_outcome === "negative" ? <TrendingDown className="w-4 h-4 text-destructive" /> : <BarChart3 className="w-4 h-4 text-muted-foreground" />}
                      <Badge className={OUTCOME_COLORS[h.learning_outcome] || ""}>{h.learning_outcome}</Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-muted-foreground">Esperado: <strong className="text-foreground">{Number(h.expected_impact).toFixed(1)}</strong></span>
                      <span className="text-muted-foreground">Real: <strong className="text-foreground">{Number(h.actual_impact).toFixed(1)}</strong></span>
                      <span className="text-muted-foreground">Confiança: <strong className="text-foreground">{h.confidence}%</strong></span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </TabsContent>

        {/* Signals Tab */}
        <TabsContent value="signals" className="space-y-3">
          {loadingSignals ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : signals.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Sem sinais de aprendizagem.</CardContent></Card>
          ) : (
            signals.slice(0, 30).map((s: any) => (
              <Card key={s.id}>
                <CardContent className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">{s.signal_type}</Badge>
                    <Badge variant="secondary">{s.feedback_type}</Badge>
                    <span className="text-xs text-muted-foreground">{s.source}</span>
                  </div>
                  <span className="text-sm text-foreground font-medium">Força: {Number(s.signal_strength).toFixed(2)}</span>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Models Tab */}
        <TabsContent value="models" className="space-y-3">
          {models.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Sem modelos treinados.</CardContent></Card>
          ) : (
            models.map((m: any) => (
              <Card key={m.id}>
                <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Cpu className="w-4 h-4" />{m.model_type}</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div><p className="text-xs text-muted-foreground">Reward Médio</p><p className="font-bold text-foreground">{m.model_parameters?.avg_reward?.toFixed(2) || "N/A"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Amostras</p><p className="font-bold text-foreground">{m.model_parameters?.sample_size || 0}</p></div>
                    <div><p className="text-xs text-muted-foreground">Confiança</p><p className="font-bold text-foreground">{m.model_parameters?.avg_confidence || 0}%</p></div>
                  </div>
                  {m.last_trained_at && (
                    <p className="text-xs text-muted-foreground mt-2">Último treino: {new Date(m.last_trained_at).toLocaleString("pt-PT")}</p>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Patterns Tab */}
        <TabsContent value="patterns" className="space-y-3">
          {memories.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Sem padrões detetados.</CardContent></Card>
          ) : (
            <>
              {/* Group by decision_type */}
              {[...new Set(memories.map((m: any) => m.decision_type))].map((type: any) => {
                const group = memories.filter((m: any) => m.decision_type === type);
                const avgR = group.reduce((s: number, m: any) => s + Number(m.reward), 0) / group.length;
                return (
                  <Card key={type}>
                    <CardContent className="py-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-foreground">{type}</p>
                        <p className="text-xs text-muted-foreground">{group.length} ocorrências</p>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold ${avgR >= 0 ? "text-green-600" : "text-destructive"}`}>{avgR.toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">Reward médio</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
