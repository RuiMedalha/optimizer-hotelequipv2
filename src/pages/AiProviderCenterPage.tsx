import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  DollarSign, Gauge,
} from "lucide-react";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import {
  useAiProviders, useSaveAiProvider, useDeleteAiProvider, useTestAiProvider,
  useAiModelCatalog, useAiRoutingRules, useSaveAiRoutingRule, useDeleteAiRoutingRule,
  useDiscoverAiModels,
  PROVIDER_TYPES, DEFAULT_TASK_TYPES,
  type AiProvider, type AiRoutingRule,
} from "@/hooks/useAiProviderCenter";
import { useAiGovernance } from "@/hooks/useAiGovernance";

const emptyProvider: Partial<AiProvider> = {
  provider_name: "", provider_type: "gemini_direct", default_model: "", fallback_model: "",
  timeout_seconds: 60, priority_order: 10, is_active: true, supports_text: true,
  supports_vision: false, supports_json_schema: false, supports_translation: false,
  supports_function_calling: false, config: {},
};

const emptyRoute: Partial<AiRoutingRule> = {
  task_type: "", display_name: "", provider_id: null, model_override: null,
  recommended_model: null, fallback_provider_id: null, fallback_model: null,
  is_active: true, execution_priority: 50,
};

const MODES = ["economic", "balanced", "premium"];
const MODELS = ["google/gemini-2.5-flash-lite", "google/gemini-2.5-flash", "google/gemini-2.5-pro", "google/gemini-3-flash-preview"];

const MODEL_DESCRIPTIONS: Record<string, string> = {
  "gemini-2.5-pro": "Top-tier Gemini. Melhor para raciocínio complexo, imagens+texto e contextos grandes.",
  "gemini-2.5-flash": "Equilíbrio custo/qualidade. Bom para multimodal e raciocínio moderado.",
  "gemini-2.5-flash-lite": "Mais rápido e barato. Ideal para classificação, sumários e tarefas simples.",
  "gemini-3-flash-preview": "Última geração Google. Velocidade e capacidade equilibradas.",
  "gemini-3.1-pro-preview": "Preview do modelo de raciocínio de próxima geração.",
  "gemini-3-pro-image-preview": "Geração de imagens de próxima geração.",
  "gemini-3.1-flash-image-preview": "Geração e edição de imagens rápida com qualidade pro.",
  "gpt-4o": "Multimodal potente. Excelente raciocínio, contexto longo, texto+imagens.",
  "gpt-4o-mini": "Custo reduzido com boa capacidade multimodal. Bom equilíbrio geral.",
  "gpt-5": "Topo de gama OpenAI. Raciocínio avançado, grande precisão. Mais caro e lento.",
  "gpt-5-mini": "Custo moderado mantendo raciocínio e capacidade multimodal forte.",
  "gpt-5-nano": "Velocidade e custo mínimos. Ideal para tarefas simples de alto volume.",
  "gpt-5.2": "Último modelo OpenAI com raciocínio melhorado para resolução de problemas complexos.",
  "claude-3-5-haiku-20241022": "⚠️ Descontinuado. Será substituído automaticamente pelo próximo modelo disponível.",
  "claude-3-5-sonnet-20241022": "Equilíbrio entre velocidade e inteligência. Versátil.",
  "claude-3-haiku-20240307": "Rápido e económico. Bom para tarefas simples e respostas rápidas.",
  "claude-3-opus-20240229": "Máxima capacidade Anthropic. Raciocínio profundo e nuance.",
  "claude-sonnet-4-20250514": "Última geração Anthropic. Raciocínio superior e fiabilidade.",
  "deepseek-chat": "DeepSeek V3. Modelo conversacional competitivo, bom custo-benefício.",
  "deepseek-reasoner": "DeepSeek R1. Raciocínio avançado com chain-of-thought.",
  "deepseek-coder": "DeepSeek Coder. Especializado em código e tarefas técnicas.",
  "grok-3": "xAI Grok 3. Modelo flagship com raciocínio avançado e contexto longo.",
  "grok-3-mini": "xAI Grok 3 Mini. Mais rápido e económico, bom para tarefas simples.",
  "grok-2": "xAI Grok 2. Versátil com bom equilíbrio custo/qualidade.",
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
  const discoverModels = useDiscoverAiModels();

  // AI Governance data (consolidated)
  const { usageSummary, usageLogs, profiles, createProfile, activateProfile, retryPolicies, createRetryPolicy } = useAiGovernance();

  const [editProvider, setEditProvider] = useState<Partial<AiProvider> | null>(null);
  const [editRoute, setEditRoute] = useState<Partial<AiRoutingRule> | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [newRetry, setNewRetry] = useState({ policy_name: "", retry_limit: "3", fallback_model: "google/gemini-2.5-flash-lite" });

  const modelsForType = (providerType: string) =>
    (modelCatalog.data || []).filter(m => m.provider_type === providerType);

  const handleTestProvider = async (id: string) => {
    if (!activeWorkspace) return;
    setTestingId(id);
    try {
      await testProvider.mutateAsync({ providerId: id, workspaceId: activeWorkspace.id });
    } finally {
      setTestingId(null);
    }
  };

  const handleSaveProvider = async () => {
    if (!editProvider?.provider_name) return;
    // If user provided a new API key, save it securely in user settings
    const newApiKey = (editProvider as any)._newApiKey;
    if (newApiKey && newApiKey.trim()) {
      const keyMap: Record<string, string> = {
        gemini_direct: "gemini_api_key",
        openai_direct: "openai_api_key",
        anthropic_direct: "anthropic_api_key",
        azure_openai: "azure_openai_api_key",
      deepseek_direct: "deepseek_api_key",
      xai_direct: "xai_api_key",
      };
      const settingKey = keyMap[editProvider.provider_type || ""];
      if (settingKey) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("settings").upsert(
            { user_id: user.id, key: settingKey, value: newApiKey.trim() },
            { onConflict: "user_id,key" }
          );
        }
      }
    }
    // Remove temp field before saving provider
    const { _newApiKey, ...providerData } = editProvider as any;
    await saveProvider.mutateAsync(providerData as any);
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
  const summary = usageSummary.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2 text-foreground"><Server className="w-6 h-6" /> AI Provider Center</h1>
        <p className="text-muted-foreground">Centro unificado de gestão de providers, modelos, routing, custos e políticas de IA</p>
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
                <p className="font-semibold text-foreground">1. Provider + API Key</p>
                <p>Adicione um provider (Google Gemini, OpenAI, Anthropic) e cole a sua <strong>API Key</strong> no formulário.</p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-foreground">2. Routing (tab AI Routing)</p>
                <p>Mapeie cada tarefa (categorização, SEO, PDFs…) ao provider e modelo ideal.</p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-foreground">3. Prompts (Prompt Governance)</p>
                <p>Crie e versione os prompts no menu <strong>Prompt Governance</strong>. Associe-os às regras de routing.</p>
              </div>
            </div>
            <div className="flex items-start gap-2 bg-muted/50 p-3 rounded-lg mt-2">
              <Info className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <p>Cada provider necessita da sua API Key. Cole-a no formulário ao criar/editar o provider — é armazenada de forma segura na sua conta e <strong>nunca</strong> exposta na base de dados partilhada.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{activeProviders}</p><p className="text-xs text-muted-foreground">Providers Ativos</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{healthyProviders}</p><p className="text-xs text-muted-foreground">Providers Saudáveis</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{(modelCatalog.data || []).length}</p><p className="text-xs text-muted-foreground">Modelos no Catálogo</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{totalRoutes}</p><p className="text-xs text-muted-foreground">Regras de Routing</p></CardContent></Card>
        {summary && (
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">${summary.totalCost.toFixed(4)}</p><p className="text-xs text-muted-foreground">Custo Total AI</p></CardContent></Card>
        )}
      </div>

      <Tabs defaultValue="providers">
        <TabsList className="flex-wrap">
          <TabsTrigger value="providers" className="gap-1.5"><Server className="h-4 w-4" /> Providers</TabsTrigger>
          <TabsTrigger value="models" className="gap-1.5"><Cpu className="h-4 w-4" /> Catálogo</TabsTrigger>
          <TabsTrigger value="routing" className="gap-1.5"><Route className="h-4 w-4" /> Routing</TabsTrigger>
          <TabsTrigger value="health" className="gap-1.5"><Activity className="h-4 w-4" /> Health</TabsTrigger>
          <TabsTrigger value="costs" className="gap-1.5"><DollarSign className="h-4 w-4" /> Custos</TabsTrigger>
          <TabsTrigger value="profiles" className="gap-1.5"><Gauge className="h-4 w-4" /> Perfis</TabsTrigger>
          <TabsTrigger value="retry" className="gap-1.5"><Shield className="h-4 w-4" /> Retry</TabsTrigger>
        </TabsList>

        {/* ═══ PROVIDERS TAB ═══ */}
        <TabsContent value="providers" className="space-y-4 mt-4">
          <div className="flex justify-end gap-2">
            <Button 
              onClick={() => activeWorkspace && discoverModels.mutate(activeWorkspace.id)} 
              size="sm" variant="outline" 
              disabled={discoverModels.isPending || !activeWorkspace}
            >
              {discoverModels.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Cpu className="h-4 w-4 mr-1" />}
              Descobrir Modelos
            </Button>
            <Button onClick={() => setEditProvider({ ...emptyProvider })} size="sm"><Plus className="h-4 w-4 mr-1" /> Adicionar Provider</Button>
          </div>

          {(providers.data || []).map(p => {
            const providerModels = (modelCatalog.data || []).filter(m => m.provider_type === p.provider_type);
            const isHealthy = p.is_active && p.last_health_status === "success";
            return (
            <Card key={p.id} className={!p.is_active ? "opacity-60" : ""}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-2.5 h-2.5 rounded-full ${p.last_health_status === "success" ? "bg-primary" : p.last_health_status === "error" ? "bg-destructive" : "bg-muted-foreground"}`} />
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{p.provider_name}</p>
                      <p className="text-xs text-muted-foreground">{PROVIDER_TYPES.find(t => t.value === p.provider_type)?.label || p.provider_type} • {p.default_model || "sem modelo"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={p.is_active}
                        onCheckedChange={(checked) => {
                          saveProvider.mutate({ id: p.id, is_active: checked, provider_name: p.provider_name, provider_type: p.provider_type });
                        }}
                      />
                      <span className={`text-xs font-medium ${p.is_active ? "text-primary" : "text-muted-foreground"}`}>{p.is_active ? "Ativo" : "Inativo"}</span>
                    </div>
                    <Badge variant="outline">Prioridade: {p.priority_order}</Badge>
                    {p.avg_latency_ms && <Badge variant="outline">{Math.round(p.avg_latency_ms)}ms</Badge>}
                    <Button size="sm" variant="outline" onClick={() => handleTestProvider(p.id)} disabled={testingId === p.id}>
                      {testingId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditProvider(p)}><Settings2 className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteProvider.mutate(p.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                  </div>
                </div>

                {/* Models available for this provider */}
                {isHealthy && providerModels.length > 0 && (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Cpu className="h-3 w-3" /> {providerModels.length} modelo{providerModels.length !== 1 ? "s" : ""} disponíve{providerModels.length !== 1 ? "is" : "l"}
                    </div>
                    <div className="divide-y divide-border">
                      {providerModels.map(m => (
                        <div key={m.id} className="px-3 py-2 flex items-start gap-3 text-xs">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground">{m.display_name}</p>
                            <p className="text-muted-foreground mt-0.5">{MODEL_DESCRIPTIONS[m.model_id] || `Modelo ${m.model_id}`}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                            {m.supports_text && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Texto</Badge>}
                            {m.supports_vision && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Vision</Badge>}
                            {m.supports_tool_calls && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Tools</Badge>}
                            <span className="text-muted-foreground whitespace-nowrap">
                              ${m.cost_input_per_mtok ?? "?"} / ${m.cost_output_per_mtok ?? "?"} MTok
                            </span>
                            {m.speed_rating && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">⚡{m.speed_rating}</Badge>}
                            {m.accuracy_rating && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">🎯{m.accuracy_rating}</Badge>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {isHealthy && providerModels.length === 0 && (
                  <p className="text-xs text-muted-foreground italic px-1">Nenhum modelo no catálogo para este tipo de provider. Adicione modelos no separador Catálogo.</p>
                )}
              </CardContent>
            </Card>
            );
          })}
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

        {/* ═══ COSTS TAB (from AI Governance) ═══ */}
        <TabsContent value="costs" className="space-y-4 mt-4">
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">${summary.totalCost.toFixed(4)}</p><p className="text-xs text-muted-foreground">Custo Total</p></CardContent></Card>
              <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{summary.totalRequests}</p><p className="text-xs text-muted-foreground">Requests</p></CardContent></Card>
              <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{(summary.totalInputTokens / 1000).toFixed(1)}k</p><p className="text-xs text-muted-foreground">Input Tokens</p></CardContent></Card>
              <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{(summary.totalOutputTokens / 1000).toFixed(1)}k</p><p className="text-xs text-muted-foreground">Output Tokens</p></CardContent></Card>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modelo</TableHead>
                <TableHead>In</TableHead>
                <TableHead>Out</TableHead>
                <TableHead>Custo</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usageLogs.data?.map((l: any) => (
                <TableRow key={l.id}>
                  <TableCell><Badge variant="secondary">{l.model_name || "—"}</Badge></TableCell>
                  <TableCell>{l.input_tokens}</TableCell>
                  <TableCell>{l.output_tokens}</TableCell>
                  <TableCell>${(l.estimated_cost || 0).toFixed(4)}</TableCell>
                  <TableCell className="text-xs">{new Date(l.created_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {usageLogs.data?.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sem logs de utilização</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TabsContent>

        {/* ═══ PROFILES TAB (from AI Governance) ═══ */}
        <TabsContent value="profiles" className="space-y-4 mt-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-2">Perfis de Execução</h3>
            <p className="text-xs text-muted-foreground mb-4">Definem o modo de operação (custo vs qualidade) e os modelos preferidos para cada contexto.</p>
          </div>
          <div className="flex gap-2">
            {MODES.map((m) => (
              <Button key={m} variant="outline" onClick={() => createProfile.mutate(m)} disabled={createProfile.isPending}>
                <Plus className="w-4 h-4 mr-1" /> {m}
              </Button>
            ))}
          </div>
          {profiles.data?.map((p: any) => (
            <Card key={p.id} className={p.is_active ? "border-primary" : ""}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  {p.is_active && <CheckCircle className="w-4 h-4 text-primary" />}
                  <div>
                    <p className="font-medium text-foreground">{p.profile_name}</p>
                    <p className="text-xs text-muted-foreground">Modo: {p.mode} • Primary: {(p.model_preferences as any)?.primary}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={p.mode === "premium" ? "default" : p.mode === "economic" ? "outline" : "secondary"}>{p.mode}</Badge>
                  {!p.is_active && <Button size="sm" variant="ghost" onClick={() => activateProfile.mutate(p.id)}>Ativar</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
          {profiles.data?.length === 0 && <p className="text-muted-foreground text-sm">Crie um perfil de execução acima.</p>}
        </TabsContent>

        {/* ═══ RETRY TAB (from AI Governance) ═══ */}
        <TabsContent value="retry" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Shield className="w-4 h-4" /> Nova Retry Policy</CardTitle></CardHeader>
            <CardContent className="flex gap-2 flex-wrap">
              <Input placeholder="Nome" value={newRetry.policy_name} onChange={(e) => setNewRetry({ ...newRetry, policy_name: e.target.value })} className="w-40" />
              <Input placeholder="Retries" type="number" value={newRetry.retry_limit} onChange={(e) => setNewRetry({ ...newRetry, retry_limit: e.target.value })} className="w-24" />
              <Select value={newRetry.fallback_model} onValueChange={(v) => setNewRetry({ ...newRetry, fallback_model: v })}>
                <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
                <SelectContent>{MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" onClick={() => { createRetryPolicy.mutate({ policy_name: newRetry.policy_name, retry_limit: parseInt(newRetry.retry_limit), fallback_model: newRetry.fallback_model }); setNewRetry({ policy_name: "", retry_limit: "3", fallback_model: "google/gemini-2.5-flash-lite" }); }} disabled={!newRetry.policy_name}>
                <Plus className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
          {retryPolicies.data?.map((r: any) => (
            <Card key={r.id}>
              <CardContent className="flex items-center justify-between p-4">
                <p className="font-medium text-foreground">{r.policy_name}</p>
                <div className="flex gap-2">
                  <Badge variant="outline">Retries: {r.retry_limit}</Badge>
                  <Badge variant="secondary">{r.fallback_model}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
          {retryPolicies.data?.length === 0 && <p className="text-muted-foreground text-sm">Sem políticas de retry configuradas.</p>}
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
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  placeholder="Cole a nova API Key aqui (deixe vazio para manter a atual)"
                  value={(editProvider as any)._newApiKey || ""}
                  onChange={e => setEditProvider({ ...editProvider, _newApiKey: e.target.value } as any)}
                />
                <div className="bg-muted/50 p-3 rounded-lg text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" /> Armazenada de forma segura na sua conta</p>
                  {editProvider.provider_type === "gemini_direct" && <p>Obtém em: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" className="underline text-primary">Google AI Studio → API Keys</a></p>}
                  {editProvider.provider_type === "openai_direct" && <p>Obtém em: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" className="underline text-primary">platform.openai.com → API Keys</a></p>}
                  {editProvider.provider_type === "anthropic_direct" && <p>Obtém em: <a href="https://console.anthropic.com/" target="_blank" rel="noopener" className="underline text-primary">console.anthropic.com → API Keys</a></p>}
                  {editProvider.provider_type === "azure_openai" && <p>Obtém no portal Azure</p>}
                  {editProvider.provider_type === "deepseek_direct" && <p>Obtém em: <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener" className="underline text-primary">platform.deepseek.com → API Keys</a></p>}
                  {editProvider.provider_type === "xai_direct" && <p>Obtém em: <a href="https://console.x.ai/" target="_blank" rel="noopener" className="underline text-primary">console.x.ai → API Keys</a></p>}
                  {editProvider.provider_type === "lovable_gateway" && <p>Não necessita de API Key — usa a chave automática do Lovable Cloud.</p>}
                </div>
              </div>
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
