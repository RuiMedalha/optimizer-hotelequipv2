import { useState } from "react";
import { useExecutionPlanner } from "@/hooks/useExecutionPlanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, BarChart3, Route, Shield, Cpu, Clock, DollarSign, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const statusColor = (s: string) => {
  if (s === "completed" || s === "success") return "default";
  if (s === "running" || s === "in_progress") return "secondary";
  if (s === "error" || s === "failed") return "destructive";
  return "outline";
};

const modeIcon = (m: string) => {
  if (m === "economic") return <DollarSign className="h-3 w-3" />;
  if (m === "premium") return <Zap className="h-3 w-3" />;
  return <BarChart3 className="h-3 w-3" />;
};

export default function ExecutionPlannerPage() {
  const { plans, routingPolicies, fallbackRules, modelMatrix, createPlan, runStep, evaluatePlan, usePlanSteps, usePlanOutcomes } = useExecutionPlanner();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [newPlanType, setNewPlanType] = useState("enrichment");
  const [newMode, setNewMode] = useState("balanced");

  const stepsQuery = usePlanSteps(selectedPlan);
  const outcomesQuery = usePlanOutcomes(selectedPlan);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Execution Planner & AI Routing</h1>
          <p className="text-muted-foreground text-sm">Planeamento inteligente de execução com routing por custo, qualidade e latência</p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={newPlanType} onValueChange={setNewPlanType}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["ingestion","canonical_assembly","enrichment","validation","translation","asset_processing","publish","sync","review_support"].map(t => (
                <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={newMode} onValueChange={setNewMode}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["economic","balanced","premium","manual_safe","auto_fast"].map(m => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => createPlan.mutate({ planType: newPlanType, executionMode: newMode })} disabled={createPlan.isPending}>
            <Play className="h-4 w-4 mr-1" /> Criar Plano
          </Button>
        </div>
      </div>

      <Tabs defaultValue="plans" className="space-y-4">
        <TabsList>
          <TabsTrigger value="plans">Planos</TabsTrigger>
          <TabsTrigger value="models">Modelos AI</TabsTrigger>
          <TabsTrigger value="routing">Routing Policies</TabsTrigger>
          <TabsTrigger value="fallbacks">Fallbacks</TabsTrigger>
        </TabsList>

        <TabsContent value="plans" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader><CardTitle className="text-sm">Planos de Execução</CardTitle></CardHeader>
                <CardContent>
                  {plans.isLoading ? <Skeleton className="h-40" /> : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Modo</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Custo Est.</TableHead>
                          <TableHead>Custo Real</TableHead>
                          <TableHead>Criado</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(plans.data || []).map((p: any) => (
                          <TableRow key={p.id} className={selectedPlan === p.id ? "bg-muted/50" : "cursor-pointer"} onClick={() => setSelectedPlan(p.id)}>
                            <TableCell className="font-medium text-xs">{p.plan_type}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs gap-1">{modeIcon(p.execution_mode)}{p.execution_mode}</Badge></TableCell>
                            <TableCell><Badge variant={statusColor(p.status)} className="text-xs">{p.status}</Badge></TableCell>
                            <TableCell className="text-xs">{Number(p.estimated_cost || 0).toFixed(4)}€</TableCell>
                            <TableCell className="text-xs">{p.actual_cost != null ? `${Number(p.actual_cost).toFixed(4)}€` : "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString("pt-PT")}</TableCell>
                            <TableCell>
                              <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); evaluatePlan.mutate(p.id); }}>
                                <BarChart3 className="h-3 w-3" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {(!plans.data || plans.data.length === 0) && (
                          <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground text-sm py-8">Sem planos de execução</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              {selectedPlan && (
                <>
                  <Card>
                    <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4" /> Steps</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      {stepsQuery.isLoading ? <Skeleton className="h-20" /> : (stepsQuery.data || []).map((s: any) => (
                        <div key={s.id} className="flex items-center justify-between p-2 rounded border text-xs">
                          <div>
                            <div className="font-medium">{s.step_order}. {s.step_name}</div>
                            <div className="text-muted-foreground">{s.executor_type}{s.model_name ? ` → ${s.model_name}` : ""}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={statusColor(s.status)} className="text-xs">{s.status}</Badge>
                            {s.status === "pending" && (
                              <Button size="sm" variant="ghost" onClick={() => runStep.mutate(s.id)}><Play className="h-3 w-3" /></Button>
                            )}
                          </div>
                        </div>
                      ))}
                      {stepsQuery.data?.length === 0 && <p className="text-muted-foreground text-xs text-center py-4">Sem steps</p>}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4" /> Outcomes</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      {outcomesQuery.isLoading ? <Skeleton className="h-20" /> : (outcomesQuery.data || []).map((o: any) => (
                        <div key={o.id} className="p-2 rounded border text-xs space-y-1">
                          <div className="flex justify-between">
                            <Badge variant={o.success ? "default" : "destructive"}>{o.outcome_type}</Badge>
                            <span className="text-muted-foreground">{o.latency_ms ? `${o.latency_ms}ms` : ""}</span>
                          </div>
                          {o.confidence_score != null && <div>Confiança: {(o.confidence_score * 100).toFixed(0)}%</div>}
                          {o.cost != null && <div>Custo: {Number(o.cost).toFixed(4)}€</div>}
                        </div>
                      ))}
                      {outcomesQuery.data?.length === 0 && <p className="text-muted-foreground text-xs text-center py-4">Sem outcomes</p>}
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="models">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Cpu className="h-4 w-4" /> Model Capability Matrix</CardTitle></CardHeader>
            <CardContent>
              {modelMatrix.isLoading ? <Skeleton className="h-40" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Modelo</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Text</TableHead>
                      <TableHead>Vision</TableHead>
                      <TableHead>JSON</TableHead>
                      <TableHead>Translation</TableHead>
                      <TableHead>Custo</TableHead>
                      <TableHead>Latência</TableHead>
                      <TableHead>Qualidade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(modelMatrix.data || []).map((m: any) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs">{m.model_name}</TableCell>
                        <TableCell className="text-xs">{m.provider_name}</TableCell>
                        <TableCell>{m.supports_text ? "✓" : "—"}</TableCell>
                        <TableCell>{m.supports_vision ? "✓" : "—"}</TableCell>
                        <TableCell>{m.supports_json_schema ? "✓" : "—"}</TableCell>
                        <TableCell>{m.supports_translation ? "✓" : "—"}</TableCell>
                        <TableCell className="text-xs">{Number(m.relative_cost_score).toFixed(0)}/10</TableCell>
                        <TableCell className="text-xs">{Number(m.relative_latency_score).toFixed(0)}/10</TableCell>
                        <TableCell className="text-xs font-medium">{Number(m.quality_score).toFixed(0)}/10</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="routing">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Route className="h-4 w-4" /> AI Routing Policies</CardTitle></CardHeader>
            <CardContent>
              {routingPolicies.isLoading ? <Skeleton className="h-40" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Policy</TableHead>
                      <TableHead>Contexto</TableHead>
                      <TableHead>Ativa</TableHead>
                      <TableHead>Criada</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(routingPolicies.data || []).map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium text-sm">{p.policy_name}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{p.context_type}</Badge></TableCell>
                        <TableCell>{p.is_active ? <Badge className="text-xs">Ativa</Badge> : <Badge variant="outline" className="text-xs">Inativa</Badge>}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString("pt-PT")}</TableCell>
                      </TableRow>
                    ))}
                    {(!routingPolicies.data || routingPolicies.data.length === 0) && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-sm py-8">Sem políticas de routing</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fallbacks">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4" /> Fallback Rules</CardTitle></CardHeader>
            <CardContent>
              {fallbackRules.isLoading ? <Skeleton className="h-40" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Regra</TableHead>
                      <TableHead>Tipo Falha</TableHead>
                      <TableHead>Primário</TableHead>
                      <TableHead>Fallback</TableHead>
                      <TableHead>Retries</TableHead>
                      <TableHead>Ativa</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(fallbackRules.data || []).map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium text-sm">{r.rule_name}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{r.failure_type}</Badge></TableCell>
                        <TableCell className="text-xs">{r.primary_executor}</TableCell>
                        <TableCell className="text-xs">{r.fallback_executor}</TableCell>
                        <TableCell className="text-xs">{r.max_retries}</TableCell>
                        <TableCell>{r.is_active ? <Badge className="text-xs">Ativa</Badge> : <Badge variant="outline" className="text-xs">Inativa</Badge>}</TableCell>
                      </TableRow>
                    ))}
                    {(!fallbackRules.data || fallbackRules.data.length === 0) && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-8">Sem regras de fallback</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
