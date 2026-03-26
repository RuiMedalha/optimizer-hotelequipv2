import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Server, Plus, Trash2, TestTube, CheckCircle, XCircle, Loader2,
  Cpu, Route, Activity, Zap, Shield, Brain, Settings2, Info, BookOpen,
} from "lucide-react";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import {
  useAiProviders, useSaveAiProvider, useDeleteAiProvider, useTestAiProvider,
  useAiModelCatalog, useAiRoutingRules, useSaveAiRoutingRule, useDeleteAiRoutingRule,
  PROVIDER_TYPES, DEFAULT_TASK_TYPES,
  type AiProvider, type AiRoutingRule,
} from "@/hooks/useAiProviderCenter";

const emptyProvider: Partial<AiProvider> = {
  provider_name: "", provider_type: "lovable_gateway", default_model: "", fallback_model: "",
  timeout_seconds: 60, priority_order: 10, is_active: true, supports_text: true,
  supports_vision: false, supports_json_schema: false, supports_translation: false,
  supports_function_calling: false, config: {},
};

const emptyRoute: Partial<AiRoutingRule> = {
  task_type: "", display_name: "", provider_id: null, model_override: null,
  recommended_model: null, fallback_provider_id: null, fallback_model: null,
  is_active: true, execution_priority: 50,
};

export default function AiProviderCenterPage() {
  const { activeWorkspace } = useWorkspaceContext();
  const providers = useAiProviders();
  const modelCatalog = useAiModelCatalog();
  const routingRules = useAiRoutingRules();
  const saveProvider = useSaveAiProvider();
  const deleteProvider = useDeleteAiProvider();
  const testProvider = useTestAiProvider();
  const saveRoute = useSaveAiRoutingRule();
  const deleteRoute = useDeleteAiRoutingRule();

  const [editProvider, setEditProvider] = useState<Partial<AiProvider> | null>(null);
  const [editRoute, setEditRoute] = useState<Partial<AiRoutingRule> | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const modelsForType = (providerType: string) =>
    (modelCatalog.data || []).filter(m => m.provider_type === providerType);

  const handleTestProvider = async (_id: string) => {
    toast.info("Teste de provider temporariamente indisponível — função edge no limite do plano Supabase.");
  };

  const handleSaveProvider = async () => {
    if (!editProvider?.provider_name) return;
    await saveProvider.mutateAsync(editProvider as any);
    setEditProvider(null);
  };

  const handleSaveRoute = async () => {
    if (!editRoute?.task_type || !editRoute?.display_name) return;
    await saveRoute.mutateAsync(editRoute as any);
    setEditRoute(null);
  };

  const activeProviders = (providers.data || []).filter(p => p.is_active).length;
  const totalRoutes = (routingRules.data || []).length;
  const healthyProviders = (providers.data || []).filter(p => p.last_health_status === "success").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2 text-foreground"><Server className="w-6 h-6" /> AI Provider Center</h1>
        <p className="text-muted-foreground">Centro unificado de gestão de providers, modelos e routing de IA</p>
      </div>

      {/* Setup Guide */}
      {(providers.data || []).length === 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2"><BookOpen className="h-5 w-5 text-primary" /> Guia de Configuração Rápida</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <p className="font-semibold text-foreground">1. Provider (esta página)</p>
                <p>Adicione um provider de IA. O <strong>Lovable AI Gateway</strong> funciona sem API key — já está integrado.</p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-foreground">2. Routing (tab AI Routing)</p>
                <p>Mapeie cada tarefa (categorização, SEO, PDFs…) ao provider e modelo ideal. Já foram criadas {totalRoutes} regras automáticas.</p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-foreground">3. Prompts (Prompt Governance)</p>
                <p>Crie e versione os prompts no menu <strong>Prompt Governance</strong>. Associe-os às regras de routing.</p>
              </div>
            </div>
            <div className="flex items-start gap-2 bg-muted/50 p-3 rounded-lg mt-2">
              <Info className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <p>Para providers externos (OpenAI, Gemini, Anthropic), a API key é guardada no campo de configuração do provider. O Lovable Gateway não precisa de chave.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{activeProviders}</p><p className="text-xs text-muted-foreground">Providers Ativos</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{healthyProviders}</p><p className="text-xs text-muted-foreground">Providers Saudáveis</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{(modelCatalog.data || []).length}</p><p className="text-xs text-muted-foreground">Modelos no Catálogo</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{totalRoutes}</p><p className="text-xs text-muted-foreground">Regras de Routing</p></CardContent></Card>
      </div>

      <Tabs defaultValue="providers">
        <TabsList>
          <TabsTrigger value="providers" className="gap-1.5"><Server className="h-4 w-4" /> Providers</TabsTrigger>
          <TabsTrigger value="models" className="gap-1.5"><Cpu className="h-4 w-4" /> Catálogo de Modelos</TabsTrigger>
          <TabsTrigger value="routing" className="gap-1.5"><Route className="h-4 w-4" /> AI Routing</TabsTrigger>
          <TabsTrigger value="health" className="gap-1.5"><Activity className="h-4 w-4" /> Health</TabsTrigger>
        </TabsList>

        {/* ═══ PROVIDERS TAB ═══ */}
        <TabsContent value="providers" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button onClick={() => setEditProvider({ ...emptyProvider })} size="sm"><Plus className="h-4 w-4 mr-1" /> Adicionar Provider</Button>
          </div>

          {(providers.data || []).map(p => (
            <Card key={p.id} className={!p.is_active ? "opacity-60" : ""}>
              <CardContent className="flex items-center justify-between p-4 gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2.5 h-2.5 rounded-full ${p.last_health_status === "success" ? "bg-primary" : p.last_health_status === "error" ? "bg-destructive" : "bg-muted-foreground"}`} />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{p.provider_name}</p>
                    <p className="text-xs text-muted-foreground">{PROVIDER_TYPES.find(t => t.value === p.provider_type)?.label || p.provider_type} • {p.default_model || "sem modelo"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={p.is_active ? "default" : "secondary"}>{p.is_active ? "Ativo" : "Inativo"}</Badge>
                  <Badge variant="outline">Prioridade: {p.priority_order}</Badge>
                  {p.avg_latency_ms && <Badge variant="outline">{Math.round(p.avg_latency_ms)}ms</Badge>}
                  <Button size="sm" variant="outline" onClick={() => handleTestProvider(p.id)} disabled={testingId === p.id}>
                    {testingId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube className="h-3 w-3" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditProvider(p)}><Settings2 className="h-3 w-3" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteProvider.mutate(p.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {(providers.data || []).length === 0 && (
            <Card><CardContent className="p-8 text-center text-muted-foreground">Nenhum provider configurado. Adicione o primeiro acima.</CardContent></Card>
          )}
        </TabsContent>

        {/* ═══ MODEL CATALOG TAB ═══ */}
        <TabsContent value="models" className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Texto</TableHead>
                <TableHead>Vision</TableHead>
                <TableHead>Tools</TableHead>
                <TableHead>Custo In</TableHead>
                <TableHead>Custo Out</TableHead>
                <TableHead>Velocidade</TableHead>
                <TableHead>Precisão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(modelCatalog.data || []).map(m => (
                <TableRow key={m.id}>
                  <TableCell><Badge variant="outline">{m.provider_type}</Badge></TableCell>
                  <TableCell className="font-medium text-foreground">{m.display_name}<br /><span className="text-xs text-muted-foreground">{m.model_id}</span></TableCell>
                  <TableCell>{m.supports_text ? <CheckCircle className="h-4 w-4 text-primary" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}</TableCell>
                  <TableCell>{m.supports_vision ? <CheckCircle className="h-4 w-4 text-primary" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}</TableCell>
                  <TableCell>{m.supports_tool_calls ? <CheckCircle className="h-4 w-4 text-primary" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}</TableCell>
                  <TableCell className="text-xs">${m.cost_input_per_mtok}/MTok</TableCell>
                  <TableCell className="text-xs">${m.cost_output_per_mtok}/MTok</TableCell>
                  <TableCell><Badge variant="outline">{m.speed_rating}/10</Badge></TableCell>
                  <TableCell><Badge variant="outline">{m.accuracy_rating}/10</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        {/* ═══ ROUTING TAB ═══ */}
        <TabsContent value="routing" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button onClick={() => setEditRoute({ ...emptyRoute })} size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Regra</Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Fallback</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(routingRules.data || []).map(r => (
                <TableRow key={r.id}>
                  <TableCell>
                    <p className="font-medium text-foreground">{r.display_name}</p>
                    <p className="text-xs text-muted-foreground">{r.task_type}</p>
                  </TableCell>
                  <TableCell><Badge variant="outline">{r.provider?.provider_name || "Auto"}</Badge></TableCell>
                  <TableCell className="text-sm text-foreground">{r.model_override || r.recommended_model || "Default"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.fallback_provider?.provider_name || "Lovable Gateway"}{r.fallback_model ? ` (${r.fallback_model})` : ""}</TableCell>
                  <TableCell><Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Ativo" : "Inativo"}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditRoute(r)}><Settings2 className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteRoute.mutate(r.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(routingRules.data || []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Sem regras de routing. Crie a primeira acima.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>

        {/* ═══ HEALTH TAB ═══ */}
        <TabsContent value="health" className="space-y-4 mt-4">
          {(providers.data || []).map(p => (
            <Card key={p.id}>
              <CardContent className="flex items-center justify-between p-4 gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${p.last_health_status === "success" ? "bg-primary" : p.last_health_status === "error" ? "bg-destructive" : "bg-muted-foreground"}`} />
                  <div>
                    <p className="font-medium text-foreground">{p.provider_name}</p>
                    <p className="text-xs text-muted-foreground">{p.default_model || "—"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge variant={p.last_health_status === "success" ? "default" : p.last_health_status === "error" ? "destructive" : "outline"}>
                    {p.last_health_status === "success" ? "Saudável" : p.last_health_status === "error" ? "Erro" : "Não testado"}
                  </Badge>
                  {p.avg_latency_ms && <span className="text-sm text-muted-foreground">{Math.round(p.avg_latency_ms)}ms</span>}
                  {p.last_error && <span className="text-xs text-destructive truncate max-w-xs">{p.last_error}</span>}
                  {p.last_health_check && <span className="text-xs text-muted-foreground">{new Date(p.last_health_check).toLocaleString()}</span>}
                  <Button size="sm" variant="outline" onClick={() => handleTestProvider(p.id)} disabled={testingId === p.id}>
                    {testingId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube className="h-3 w-3 mr-1" />}
                    Testar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {(providers.data || []).length === 0 && (
            <Card><CardContent className="p-8 text-center text-muted-foreground">Adicione providers na tab Providers primeiro.</CardContent></Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ═══ PROVIDER EDIT DIALOG ═══ */}
      <Dialog open={!!editProvider} onOpenChange={(o) => !o && setEditProvider(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editProvider?.id ? "Editar" : "Novo"} Provider</DialogTitle></DialogHeader>
          {editProvider && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={editProvider.provider_name || ""} onChange={e => setEditProvider({ ...editProvider, provider_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={editProvider.provider_type} onValueChange={v => setEditProvider({ ...editProvider, provider_type: v, default_model: "" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PROVIDER_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Modelo Default</Label>
                  <Select value={editProvider.default_model || ""} onValueChange={v => setEditProvider({ ...editProvider, default_model: v })}>
                    <SelectTrigger><SelectValue placeholder="Escolher..." /></SelectTrigger>
                    <SelectContent>
                      {modelsForType(editProvider.provider_type || "").map(m => (
                        <SelectItem key={m.model_id} value={m.model_id}>{m.display_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Modelo Fallback</Label>
                  <Select value={editProvider.fallback_model || ""} onValueChange={v => setEditProvider({ ...editProvider, fallback_model: v })}>
                    <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                    <SelectContent>
                      {modelsForType(editProvider.provider_type || "").map(m => (
                        <SelectItem key={m.model_id} value={m.model_id}>{m.display_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {editProvider.provider_type !== "lovable_gateway" && (
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input
                    type="password"
                    placeholder="sk-..."
                    value={(editProvider.config as any)?.api_key || ""}
                    onChange={e => setEditProvider({ ...editProvider, config: { ...editProvider.config, api_key: e.target.value } })}
                  />
                  <p className="text-xs text-muted-foreground">Guardada de forma segura no backend.</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Timeout (s)</Label>
                  <Input type="number" value={editProvider.timeout_seconds} onChange={e => setEditProvider({ ...editProvider, timeout_seconds: parseInt(e.target.value) || 60 })} />
                </div>
                <div className="space-y-2">
                  <Label>Prioridade</Label>
                  <Input type="number" value={editProvider.priority_order} onChange={e => setEditProvider({ ...editProvider, priority_order: parseInt(e.target.value) || 10 })} />
                </div>
              </div>
              <Separator />
              <div className="flex flex-wrap gap-4">
                {(["supports_text", "supports_vision", "supports_json_schema", "supports_translation", "supports_function_calling"] as const).map(cap => (
                  <div key={cap} className="flex items-center gap-2">
                    <Switch checked={!!(editProvider as any)[cap]} onCheckedChange={v => setEditProvider({ ...editProvider, [cap]: v })} />
                    <Label className="text-xs">{cap.replace("supports_", "").replace(/_/g, " ")}</Label>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={editProvider.is_active} onCheckedChange={v => setEditProvider({ ...editProvider, is_active: v })} />
                <Label>Provider Ativo</Label>
              </div>
              <Button onClick={handleSaveProvider} className="w-full" disabled={saveProvider.isPending}>
                {saveProvider.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Guardar Provider
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══ ROUTING EDIT DIALOG ═══ */}
      <Dialog open={!!editRoute} onOpenChange={(o) => !o && setEditRoute(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editRoute?.id ? "Editar" : "Nova"} Regra de Routing</DialogTitle></DialogHeader>
          {editRoute && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Task Type</Label>
                <Select value={editRoute.task_type || ""} onValueChange={v => {
                  const t = DEFAULT_TASK_TYPES.find(d => d.value === v);
                  setEditRoute({ ...editRoute, task_type: v, display_name: editRoute.display_name || t?.label || v });
                }}>
                  <SelectTrigger><SelectValue placeholder="Escolher tipo..." /></SelectTrigger>
                  <SelectContent>{DEFAULT_TASK_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={editRoute.display_name || ""} onChange={e => setEditRoute({ ...editRoute, display_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select value={editRoute.provider_id || "auto"} onValueChange={v => setEditRoute({ ...editRoute, provider_id: v === "auto" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (primeiro ativo)</SelectItem>
                    {(providers.data || []).map(p => <SelectItem key={p.id} value={p.id}>{p.provider_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Modelo Override</Label>
                <Input value={editRoute.model_override || ""} onChange={e => setEditRoute({ ...editRoute, model_override: e.target.value || null })} placeholder="Deixar vazio para usar default do provider" />
              </div>
              <div className="space-y-2">
                <Label>Fallback Provider</Label>
                <Select value={editRoute.fallback_provider_id || "auto"} onValueChange={v => setEditRoute({ ...editRoute, fallback_provider_id: v === "auto" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Lovable Gateway (default)</SelectItem>
                    {(providers.data || []).map(p => <SelectItem key={p.id} value={p.id}>{p.provider_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Fallback Model</Label>
                <Input value={editRoute.fallback_model || ""} onChange={e => setEditRoute({ ...editRoute, fallback_model: e.target.value || null })} placeholder="Modelo fallback" />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={editRoute.is_active} onCheckedChange={v => setEditRoute({ ...editRoute, is_active: v })} />
                <Label>Regra Ativa</Label>
              </div>
              <Button onClick={handleSaveRoute} className="w-full" disabled={saveRoute.isPending}>
                {saveRoute.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Guardar Regra
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
