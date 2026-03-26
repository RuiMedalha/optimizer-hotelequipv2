import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { useTwins, useTwinSnapshots, useTwinScenarios, useTwinResults, useTwinComparisons, useTwinEntities, useCreateTwin, useRunTwinScenario, useCompareScenarios, usePromoteScenario, useSyncTwin } from "@/hooks/useDigitalTwin";
import { Copy, Play, GitCompare, Rocket, RefreshCw, Plus, Layers, FlaskConical, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const scenarioTypes = [
  "seo_optimization", "bundle_creation", "price_adjustment", "taxonomy_change",
  "translation_rollout", "image_replacement", "channel_publish", "schema_update", "catalog_reorganization",
];

export default function DigitalTwinPage() {
  const { activeWorkspace } = useWorkspaceContext();
  const wId = activeWorkspace?.id;
  const { data: twins = [], isLoading: loadingTwins } = useTwins(wId);
  const { data: snapshots = [] } = useTwinSnapshots(wId);
  const [selectedTwinId, setSelectedTwinId] = useState<string | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const { data: scenarios = [] } = useTwinScenarios(selectedTwinId);
  const { data: results = [] } = useTwinResults(selectedScenarioId);
  const { data: comparisons = [] } = useTwinComparisons(selectedTwinId);
  const { data: entities = [] } = useTwinEntities(selectedTwinId);

  const createTwin = useCreateTwin();
  const runScenario = useRunTwinScenario();
  const compareScenarios = useCompareScenarios();
  const promoteScenario = usePromoteScenario();
  const syncTwin = useSyncTwin();

  const [newScenarioName, setNewScenarioName] = useState("");
  const [newScenarioType, setNewScenarioType] = useState<string>("seo_optimization");
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");

  const handleCreateScenario = async () => {
    if (!selectedTwinId || !newScenarioName.trim()) return;
    const { error } = await supabase.from("catalog_twin_scenarios" as any).insert({
      twin_id: selectedTwinId,
      scenario_type: newScenarioType,
      scenario_name: newScenarioName.trim(),
      status: "draft",
      created_by: "user",
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Cenário criado");
    setNewScenarioName("");
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "completed": return "default";
      case "running": return "secondary";
      case "promoted": return "outline";
      case "failed": return "destructive";
      default: return "secondary";
    }
  };

  const resultColor = (r: string) => {
    if (r === "expected_improvement") return "text-green-600";
    if (r === "expected_decline") return "text-red-600";
    return "text-muted-foreground";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Digital Twin Engine</h1>
          <p className="text-muted-foreground text-sm">Réplica virtual do catálogo para simulação preditiva</p>
        </div>
        <Button onClick={() => wId && createTwin.mutate({ workspaceId: wId })} disabled={!wId || createTwin.isPending}>
          <Copy className="w-4 h-4 mr-2" /> Criar Twin
        </Button>
      </div>

      <Tabs defaultValue="twins">
        <TabsList>
          <TabsTrigger value="twins"><Layers className="w-4 h-4 mr-1" /> Twins</TabsTrigger>
          <TabsTrigger value="scenarios"><FlaskConical className="w-4 h-4 mr-1" /> Cenários</TabsTrigger>
          <TabsTrigger value="compare"><GitCompare className="w-4 h-4 mr-1" /> Comparação</TabsTrigger>
          <TabsTrigger value="diff"><BarChart3 className="w-4 h-4 mr-1" /> Diff & Entidades</TabsTrigger>
        </TabsList>

        {/* TWINS TAB */}
        <TabsContent value="twins" className="space-y-4">
          {loadingTwins ? <p className="text-muted-foreground text-sm">A carregar...</p> : twins.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum twin criado. Clique em "Criar Twin" para começar.</CardContent></Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {twins.map((t: any) => (
                <Card key={t.id} className={`cursor-pointer transition-colors ${selectedTwinId === t.id ? "border-primary" : ""}`} onClick={() => setSelectedTwinId(t.id)}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      {t.twin_name || "Twin"}
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); syncTwin.mutate({ twinId: t.id }); }}>
                          <RefreshCw className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">Criado: {new Date(t.created_at).toLocaleDateString("pt-PT")}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {snapshots.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Snapshots</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {snapshots.map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between text-xs border-b border-border pb-2">
                      <span>{s.snapshot_name}</span>
                      <span className="text-muted-foreground">{(s.snapshot_metadata as any)?.product_count || 0} produtos</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* SCENARIOS TAB */}
        <TabsContent value="scenarios" className="space-y-4">
          {selectedTwinId ? (
            <>
              <Card>
                <CardHeader><CardTitle className="text-sm">Novo Cenário</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex gap-2 flex-wrap">
                    <Input placeholder="Nome do cenário" value={newScenarioName} onChange={(e) => setNewScenarioName(e.target.value)} className="max-w-xs" />
                    <Select value={newScenarioType} onValueChange={setNewScenarioType}>
                      <SelectTrigger className="max-w-[200px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {scenarioTypes.map((st) => <SelectItem key={st} value={st}>{st.replace(/_/g, " ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={handleCreateScenario} disabled={!newScenarioName.trim()}><Plus className="w-4 h-4 mr-1" /> Criar</Button>
                  </div>
                </CardContent>
              </Card>

              {scenarios.length === 0 ? (
                <Card><CardContent className="py-6 text-center text-muted-foreground text-sm">Sem cenários para este twin.</CardContent></Card>
              ) : (
                <div className="space-y-3">
                  {scenarios.map((sc: any) => (
                    <Card key={sc.id} className={`cursor-pointer ${selectedScenarioId === sc.id ? "border-primary" : ""}`} onClick={() => setSelectedScenarioId(sc.id)}>
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-sm">{sc.scenario_name || sc.scenario_type}</p>
                            <p className="text-xs text-muted-foreground">{(sc.scenario_type || "").replace(/_/g, " ")}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={statusColor(sc.status)}>{sc.status}</Badge>
                            {sc.status === "draft" && (
                              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); runScenario.mutate({ scenarioId: sc.id }); }}>
                                <Play className="w-3.5 h-3.5 mr-1" /> Simular
                              </Button>
                            )}
                            {sc.status === "completed" && (
                              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); promoteScenario.mutate({ scenarioId: sc.id }); }}>
                                <Rocket className="w-3.5 h-3.5 mr-1" /> Promover
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {selectedScenarioId && results.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-sm">Resultados da Simulação</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {results.map((r: any) => (
                        <div key={r.id} className="flex items-center justify-between text-xs border-b border-border pb-2">
                          <div>
                            <span className={resultColor(r.result_type)}>{(r.result_type || "").replace(/_/g, " ")}</span>
                            <span className="ml-2 text-muted-foreground">{(r.metadata as any)?.action_type}</span>
                          </div>
                          <div className="flex gap-4">
                            <span>Base: {r.baseline_value}</span>
                            <span>Previsto: {r.predicted_value}</span>
                            <span className={Number(r.delta) > 0 ? "text-green-600" : "text-red-600"}>Δ {r.delta}</span>
                            <span className="text-muted-foreground">{r.confidence}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Selecione um twin na aba "Twins" primeiro.</CardContent></Card>
          )}
        </TabsContent>

        {/* COMPARE TAB */}
        <TabsContent value="compare" className="space-y-4">
          {selectedTwinId && scenarios.length >= 2 ? (
            <>
              <Card>
                <CardHeader><CardTitle className="text-sm">Comparar Cenários</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex gap-2 flex-wrap items-end">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Cenário A</p>
                      <Select value={compareA} onValueChange={setCompareA}>
                        <SelectTrigger className="w-[200px]"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                        <SelectContent>
                          {scenarios.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.scenario_name || s.scenario_type}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Cenário B</p>
                      <Select value={compareB} onValueChange={setCompareB}>
                        <SelectTrigger className="w-[200px]"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                        <SelectContent>
                          {scenarios.filter((s: any) => s.id !== compareA).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.scenario_name || s.scenario_type}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button size="sm" disabled={!compareA || !compareB || compareScenarios.isPending} onClick={() => compareScenarios.mutate({ twinId: selectedTwinId!, scenarioAId: compareA, scenarioBId: compareB })}>
                      <GitCompare className="w-4 h-4 mr-1" /> Comparar
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {comparisons.length > 0 && (
                <div className="space-y-3">
                  {comparisons.map((c: any) => {
                    const res = c.comparison_result as any;
                    return (
                      <Card key={c.id}>
                        <CardContent className="py-4">
                          <div className="grid grid-cols-2 gap-4 text-xs">
                            <div className={`p-3 rounded-lg border ${c.recommended_scenario === c.scenario_a_id ? "border-primary bg-primary/5" : "border-border"}`}>
                              <p className="font-medium mb-1">Cenário A {c.recommended_scenario === c.scenario_a_id && <Badge variant="default" className="text-[10px] ml-1">Recomendado</Badge>}</p>
                              <p>Δ médio: {res?.scenario_a?.avg_delta}</p>
                              <p>Confiança: {res?.scenario_a?.avg_confidence}%</p>
                              <p>Expected Value: {res?.scenario_a?.expected_value}</p>
                            </div>
                            <div className={`p-3 rounded-lg border ${c.recommended_scenario === c.scenario_b_id ? "border-primary bg-primary/5" : "border-border"}`}>
                              <p className="font-medium mb-1">Cenário B {c.recommended_scenario === c.scenario_b_id && <Badge variant="default" className="text-[10px] ml-1">Recomendado</Badge>}</p>
                              <p>Δ médio: {res?.scenario_b?.avg_delta}</p>
                              <p>Confiança: {res?.scenario_b?.avg_confidence}%</p>
                              <p>Expected Value: {res?.scenario_b?.expected_value}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">{!selectedTwinId ? "Selecione um twin primeiro." : "Precisa de pelo menos 2 cenários para comparar."}</CardContent></Card>
          )}
        </TabsContent>

        {/* DIFF TAB */}
        <TabsContent value="diff" className="space-y-4">
          {selectedTwinId ? (
            <Card>
              <CardHeader><CardTitle className="text-sm">Entidades no Twin ({entities.length})</CardTitle></CardHeader>
              <CardContent>
                {entities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem entidades. Sincronize o twin.</p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {entities.slice(0, 50).map((e: any) => (
                      <div key={e.id} className="flex items-center justify-between text-xs border-b border-border pb-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{e.entity_type}</Badge>
                          <span>{(e.canonical_data as any)?.title || (e.canonical_data as any)?.sku || e.entity_id}</span>
                        </div>
                        <span className="text-muted-foreground">{(e.canonical_data as any)?.category || "—"}</span>
                      </div>
                    ))}
                    {entities.length > 50 && <p className="text-xs text-muted-foreground text-center">+{entities.length - 50} entidades</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Selecione um twin primeiro.</CardContent></Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
