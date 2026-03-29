import { useState } from "react";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import {
  useAgents, useCreateAgent, useUpdateAgentStatus,
  useAgentTasks, useAgentActions, useAgentPolicies,
  useRunAgentCycle, useApproveAction, useCreatePolicy,
  useRunAgentAnalysis, useAgentAnalysisResults,
  useRunPublishAudit,
} from "@/hooks/useAgents";
import { useProcessImages } from "@/hooks/useProcessImages";
import { usePublishWooCommerce } from "@/hooks/usePublishWooCommerce";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Bot, Play, CheckCircle, XCircle, Clock, AlertTriangle, Zap, Shield, ListTodo, Activity, Search, Image, FileText, Wand2, ImagePlus, RefreshCw, ShoppingCart, Upload, Eye, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const AGENT_TYPES = [
  { value: "seo_optimizer", label: "SEO Optimizer" },
  { value: "catalog_gap_detector", label: "Catalog Gap Detector" },
  { value: "bundle_generator", label: "Bundle Generator" },
  { value: "attribute_completeness_agent", label: "Attribute Completeness" },
  { value: "feed_optimizer", label: "Feed Optimizer" },
  { value: "translation_agent", label: "Translation Agent" },
  { value: "image_optimizer", label: "Image Optimizer" },
  { value: "supplier_learning_agent", label: "Supplier Learning" },
  { value: "pricing_analyzer", label: "Pricing Analyzer" },
  { value: "channel_performance_agent", label: "Channel Performance" },
  { value: "publish_audit_agent", label: "Publish Audit (WC)" },
];

const statusColors: Record<string, string> = {
  active: "bg-green-500/10 text-green-700 dark:text-green-400",
  paused: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  disabled: "bg-muted text-muted-foreground",
  queued: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  running: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  completed: "bg-green-500/10 text-green-700 dark:text-green-400",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

const severityColors: Record<string, string> = {
  high: "destructive",
  medium: "secondary",
  low: "outline",
};

/* ─── Reusable recommendation list ─── */
function RecommendationList({ items, type, onAction }: { items: any[]; type: "seo" | "attr" | "img"; onAction?: (ids: string[], action: string) => void }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleId = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelectedIds(new Set(items.map(i => i.product_id)));
  const selectNone = () => setSelectedIds(new Set());

  if (!items?.length) return <p className="text-xs text-muted-foreground py-2">Sem problemas encontrados ✓</p>;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{items.length} produto(s) com problemas</span>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={selectAll}>Selecionar Todos</Button>
          <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={selectNone}>Limpar</Button>
        </div>
      </div>

      {/* Action buttons */}
      {selectedIds.size > 0 && onAction && (
        <div className="flex gap-2 bg-primary/5 p-2 rounded-lg border border-primary/20">
          <span className="text-xs font-medium text-primary self-center">{selectedIds.size} selecionado(s)</span>
          {type === "seo" && (
            <Button size="sm" className="h-7 text-xs ml-auto" onClick={() => onAction(Array.from(selectedIds), "optimize_seo")}>
              <Wand2 className="w-3 h-3 mr-1" /> Re-otimizar SEO
            </Button>
          )}
          {type === "attr" && (
            <Button size="sm" className="h-7 text-xs ml-auto" onClick={() => onAction(Array.from(selectedIds), "optimize_product")}>
              <RefreshCw className="w-3 h-3 mr-1" /> Re-otimizar Produtos
            </Button>
          )}
          {type === "img" && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs ml-auto" onClick={() => onAction(Array.from(selectedIds), "optimize_images")}>
                <Wand2 className="w-3 h-3 mr-1" /> Otimizar Imagens
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => onAction(Array.from(selectedIds), "lifestyle_images")}>
                <ImagePlus className="w-3 h-3 mr-1" /> Gerar Lifestyle
              </Button>
            </>
          )}
        </div>
      )}

      <div className="max-h-64 overflow-y-auto space-y-1">
        {items.map((r: any, idx: number) => (
          <div key={idx}
            className={`flex items-center gap-2 text-xs p-1.5 rounded cursor-pointer hover:bg-muted/50 transition-colors ${selectedIds.has(r.product_id) ? "bg-primary/5 border border-primary/20" : ""}`}
            onClick={() => toggleId(r.product_id)}
          >
            <input type="checkbox" checked={selectedIds.has(r.product_id)} readOnly className="w-3 h-3 accent-primary" />
            <Badge variant={severityColors[r.severity] as any || "secondary"} className="text-[10px] h-4 min-w-[3rem] justify-center">{r.severity}</Badge>

            {type === "seo" && (
              <>
                <span className="truncate flex-1 font-medium">{r.title}</span>
                <span className="text-muted-foreground text-[10px]">Score: {r.score}%</span>
                <span className="text-muted-foreground text-[10px] hidden md:inline">{r.issues?.length} problema(s)</span>
              </>
            )}
            {type === "attr" && (
              <>
                <span className="truncate flex-1 font-medium">{r.title}</span>
                <Progress value={r.score} className="w-16 h-1.5" />
                <span className="text-muted-foreground text-[10px] w-8">{r.score}%</span>
                <span className="text-muted-foreground text-[10px] hidden md:inline">{r.missing?.length} em falta</span>
              </>
            )}
            {type === "img" && (
              <>
                <span className="truncate flex-1 font-medium">{r.title}</span>
                <span className="text-muted-foreground text-[10px]">{r.suggestion}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Expandable detail for SEO/Attr */}
      {type === "seo" && selectedIds.size === 1 && (() => {
        const item = items.find(i => selectedIds.has(i.product_id));
        if (!item) return null;
        return (
          <div className="bg-muted/30 rounded p-2 text-xs space-y-1">
            <p className="font-semibold">{item.title} — Problemas SEO:</p>
            {item.issues?.map((issue: string, i: number) => (
              <p key={i} className="text-muted-foreground">• {issue}</p>
            ))}
          </div>
        );
      })()}
      {type === "attr" && selectedIds.size === 1 && (() => {
        const item = items.find(i => selectedIds.has(i.product_id));
        if (!item) return null;
        return (
          <div className="bg-muted/30 rounded p-2 text-xs space-y-1">
            <p className="font-semibold">{item.title} — Campos em falta:</p>
            <div className="flex flex-wrap gap-1">
              {item.missing?.map((field: string, i: number) => (
                <Badge key={i} variant="outline" className="text-[10px] h-4">{field}</Badge>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default function AgentControlCenterPage() {
  const { activeWorkspace } = useWorkspaceContext();
  const wsId = activeWorkspace?.id;

  const { data: agents = [] } = useAgents(wsId);
  const { data: tasks = [] } = useAgentTasks(wsId);
  const { data: actions = [] } = useAgentActions(wsId);
  const { data: policies = [] } = useAgentPolicies(wsId);
  const { data: analysisRuns = [] } = useAgentAnalysisResults(wsId);

  const createAgent = useCreateAgent();
  const updateStatus = useUpdateAgentStatus();
  const runCycle = useRunAgentCycle();
  const runAnalysis = useRunAgentAnalysis();
  const runPublishAudit = useRunPublishAudit();
  const approveAction = useApproveAction();
  const createPolicy = useCreatePolicy();
  const { processImages, isProcessing } = useProcessImages();
  const publishWoo = usePublishWooCommerce();

  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentType, setNewAgentType] = useState("");
  const [newPolicyName, setNewPolicyName] = useState("");
  const [newPolicyType, setNewPolicyType] = useState("");
  const [newPolicyApproval, setNewPolicyApproval] = useState(true);
  const [auditReoptimizing, setAuditReoptimizing] = useState(false);
  const [auditReoptimizingWithImages, setAuditReoptimizingWithImages] = useState(false);
  const [auditRepublishing, setAuditRepublishing] = useState(false);
  const [reoptimizedProducts, setReoptimizedProducts] = useState<Set<string>>(new Set());
  const [reoptimizeResults, setReoptimizeResults] = useState<any[]>([]);

  const pendingActions = actions.filter((a: any) => !a.approved_by_user);
  const completedTasks = tasks.filter((t: any) => t.status === "completed").length;
  const failedTasks = tasks.filter((t: any) => t.status === "failed").length;
  const queuedTasks = tasks.filter((t: any) => t.status === "queued").length;

  // Get latest analysis run
  const latestAnalysis = analysisRuns.find((r: any) => r.agent_name === "agent_analysis_cycle");
  const latestOutput = latestAnalysis?.output_payload || {};

  // Get latest publish audit
  const latestAudit = analysisRuns.find((r: any) => r.agent_name === "publish_audit_agent");
  const auditOutput = latestAudit?.output_payload || {};

  const handleAction = async (productIds: string[], action: string) => {
    if (!wsId) return;
    if (action === "optimize_seo") {
      toast.info(`A re-otimizar SEO de ${productIds.length} produto(s)...`);
      for (const pid of productIds) {
        try {
          await supabase.functions.invoke("optimize-product-seo", {
            body: { workspace_id: wsId, product_id: pid, language: "pt" },
          });
        } catch (e) { console.error(e); }
      }
      toast.success("SEO re-otimizado! Execute nova análise para verificar.");
    } else if (action === "optimize_product") {
      toast.info(`A re-otimizar ${productIds.length} produto(s)...`);
      try {
        await supabase.functions.invoke("optimize-batch", {
          body: { productIds, workspaceId: wsId },
        });
        toast.success("Produtos re-otimizados!");
      } catch (e) { toast.error("Erro ao otimizar produtos"); }
    } else if (action === "optimize_images") {
      toast.info(`A otimizar imagens de ${productIds.length} produto(s)...`);
      await processImages({ workspaceId: wsId, productIds, mode: "optimize" });
    } else if (action === "lifestyle_images") {
      toast.info(`A gerar imagens lifestyle de ${productIds.length} produto(s)...`);
      await processImages({ workspaceId: wsId, productIds, mode: "lifestyle" });
    } else if (action === "audit_reoptimize" || action === "audit_reoptimize_with_images") {
      const withImages = action === "audit_reoptimize_with_images";
      if (withImages) setAuditReoptimizingWithImages(true); else setAuditReoptimizing(true);

      // Build targeted list: only pass the specific issues each product has
      const recs = auditOutput.recommendations || [];
      const targetedProducts = productIds.map(pid => {
        const rec = recs.find((r: any) => r.product_id === pid);
        return { productId: pid, issues: rec?.issues?.map((i: any) => i.code) || [] };
      }).filter(p => p.issues.length > 0);

      toast.info(`A corrigir problemas específicos de ${targetedProducts.length} produto(s)...`);
      try {
        const { data, error } = await supabase.functions.invoke("audit-reoptimize", {
          body: { workspaceId: wsId, products: targetedProducts, includeImages: withImages },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        const results = data?.results || [];
        setReoptimizeResults(prev => [...prev, ...results]);
        setReoptimizedProducts(prev => {
          const next = new Set(prev);
          results.filter((r: any) => r.status === "fixed").forEach((r: any) => next.add(r.productId));
          return next;
        });

        const summary = data?.summary || {};
        toast.success(`Corrigidos: ${summary.auto_fixed || 0} produto(s). ${summary.needs_full_optimization ? `${summary.needs_full_optimization} precisam otimização completa.` : ""}`);

        if (withImages) {
          const fixedIds = results.filter((r: any) => r.status === "fixed").map((r: any) => r.productId);
          if (fixedIds.length > 0) {
            toast.info("A gerar imagens lifestyle...");
            await processImages({ workspaceId: wsId, productIds: fixedIds, mode: "lifestyle" });
            toast.success("Imagens lifestyle geradas!");
          }
        }
      } catch (e: any) { toast.error(`Erro: ${e.message}`); }
      finally { setAuditReoptimizing(false); setAuditReoptimizingWithImages(false); }
    } else if (action === "audit_republish") {
      setAuditRepublishing(true);
      toast.info(`A republicar ${productIds.length} produto(s) no WooCommerce...`);
      try {
        publishWoo.mutate({ productIds, workspaceId: wsId });
        toast.success("Republicação iniciada! Verifique o progresso nos Jobs.");
      } catch (e) { toast.error("Erro ao republicar"); }
      finally { setAuditRepublishing(false); }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bot className="w-6 h-6" /> Centro de Controlo de Agentes
          </h1>
          <p className="text-muted-foreground text-sm">Sistema autónomo de otimização do catálogo</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => wsId && runAnalysis.mutate({ workspaceId: wsId, agentTypes: ["seo_optimizer", "attribute_completeness_agent", "image_optimizer"] })}
            disabled={runAnalysis.isPending || !wsId}
          >
            <Search className="w-4 h-4 mr-2" /> {runAnalysis.isPending ? "A analisar..." : "Analisar Catálogo"}
          </Button>
          <Button onClick={() => wsId && runCycle.mutate({ workspaceId: wsId })} disabled={runCycle.isPending || !wsId}>
            <Play className="w-4 h-4 mr-2" /> {runCycle.isPending ? "A executar..." : "Executar Ciclo"}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-4 text-center">
          <Bot className="w-5 h-5 mx-auto mb-1 text-primary" />
          <p className="text-2xl font-bold">{agents.length}</p>
          <p className="text-xs text-muted-foreground">Agentes</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <Clock className="w-5 h-5 mx-auto mb-1 text-blue-500" />
          <p className="text-2xl font-bold">{queuedTasks}</p>
          <p className="text-xs text-muted-foreground">Na Fila</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <CheckCircle className="w-5 h-5 mx-auto mb-1 text-green-500" />
          <p className="text-2xl font-bold">{completedTasks}</p>
          <p className="text-xs text-muted-foreground">Concluídas</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <AlertTriangle className="w-5 h-5 mx-auto mb-1 text-destructive" />
          <p className="text-2xl font-bold">{failedTasks}</p>
          <p className="text-xs text-muted-foreground">Falhadas</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <Zap className="w-5 h-5 mx-auto mb-1 text-yellow-500" />
          <p className="text-2xl font-bold">{pendingActions.length}</p>
          <p className="text-xs text-muted-foreground">Pendentes</p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="analysis">
        <TabsList className="flex-wrap">
          <TabsTrigger value="analysis"><Search className="w-4 h-4 mr-1" /> Análise</TabsTrigger>
          <TabsTrigger value="audit"><ShoppingCart className="w-4 h-4 mr-1" /> Auditoria WC</TabsTrigger>
          <TabsTrigger value="agents"><Bot className="w-4 h-4 mr-1" /> Agentes</TabsTrigger>
          <TabsTrigger value="tasks"><ListTodo className="w-4 h-4 mr-1" /> Tarefas</TabsTrigger>
          <TabsTrigger value="actions"><Activity className="w-4 h-4 mr-1" /> Ações</TabsTrigger>
          <TabsTrigger value="policies"><Shield className="w-4 h-4 mr-1" /> Políticas</TabsTrigger>
        </TabsList>

        {/* ─── Analysis Results Tab ─── */}
        <TabsContent value="analysis" className="space-y-4">
          {!latestAnalysis ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Search className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-4">
                  Ainda não foram executadas análises. Clique em "Analisar Catálogo" para iniciar.
                </p>
                <Button
                  onClick={() => wsId && runAnalysis.mutate({ workspaceId: wsId, agentTypes: ["seo_optimizer", "attribute_completeness_agent", "image_optimizer"] })}
                  disabled={runAnalysis.isPending || !wsId}
                >
                  <Search className="w-4 h-4 mr-2" /> Iniciar Análise
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Última análise: {new Date(latestAnalysis.created_at).toLocaleString("pt-PT")}
                </p>
                <Button variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => wsId && runAnalysis.mutate({ workspaceId: wsId, agentTypes: ["seo_optimizer", "attribute_completeness_agent", "image_optimizer"] })}
                  disabled={runAnalysis.isPending}
                >
                  <RefreshCw className="w-3 h-3 mr-1" /> Re-analisar
                </Button>
              </div>

              {/* SEO Section */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" /> SEO Optimizer
                    {latestOutput.seo_optimizer && (
                      <Badge variant="secondary" className="text-[10px] ml-auto">
                        {latestOutput.seo_optimizer.issues_found}/{latestOutput.seo_optimizer.analyzed} com problemas
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <RecommendationList
                    items={latestOutput.seo_optimizer?.recommendations || []}
                    type="seo"
                    onAction={handleAction}
                  />
                </CardContent>
              </Card>

              {/* Attribute Completeness Section */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-primary" /> Completude de Atributos
                    {latestOutput.attribute_completeness_agent && (
                      <Badge variant="secondary" className="text-[10px] ml-auto">
                        {latestOutput.attribute_completeness_agent.incomplete}/{latestOutput.attribute_completeness_agent.analyzed} incompletos
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <RecommendationList
                    items={latestOutput.attribute_completeness_agent?.recommendations || []}
                    type="attr"
                    onAction={handleAction}
                  />
                </CardContent>
              </Card>

              {/* Image Optimizer Section */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Image className="w-4 h-4 text-primary" /> Image Optimizer
                    {latestOutput.image_optimizer && (
                      <Badge variant="secondary" className="text-[10px] ml-auto">
                        {latestOutput.image_optimizer.no_images} sem imagens · {latestOutput.image_optimizer.needs_lifestyle} sem lifestyle
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <RecommendationList
                    items={latestOutput.image_optimizer?.recommendations || []}
                    type="img"
                    onAction={handleAction}
                  />
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ─── Publish Audit Tab ─── */}
        <TabsContent value="audit" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Auditoria de Produtos Publicados (WooCommerce)</h3>
              <p className="text-xs text-muted-foreground">Verifica produtos já publicados contra os padrões atuais de qualidade</p>
            </div>
            <Button
              onClick={() => wsId && runPublishAudit.mutate({ workspaceId: wsId })}
              disabled={runPublishAudit.isPending || !wsId}
            >
              <Eye className="w-4 h-4 mr-2" /> {runPublishAudit.isPending ? "A auditar..." : "Auditar Produtos Publicados"}
            </Button>
          </div>

          {!latestAudit ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ShoppingCart className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-4">
                  Clique em "Auditar Produtos Publicados" para verificar a qualidade dos seus produtos no WooCommerce.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Summary stats */}
              {auditOutput.summary && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <Card><CardContent className="pt-3 text-center">
                    <p className="text-xl font-bold">{auditOutput.summary.total_published}</p>
                    <p className="text-[10px] text-muted-foreground">Publicados</p>
                  </CardContent></Card>
                  <Card><CardContent className="pt-3 text-center">
                    <p className="text-xl font-bold text-green-600">{auditOutput.summary.ok_count}</p>
                    <p className="text-[10px] text-muted-foreground">OK ✓</p>
                  </CardContent></Card>
                  <Card><CardContent className="pt-3 text-center">
                    <p className="text-xl font-bold text-destructive">{auditOutput.summary.total_with_issues}</p>
                    <p className="text-[10px] text-muted-foreground">Com problemas</p>
                  </CardContent></Card>
                  <Card><CardContent className="pt-3 text-center">
                    <p className="text-xl font-bold text-orange-600">{auditOutput.summary.needs_reoptimize}</p>
                    <p className="text-[10px] text-muted-foreground">Precisam re-otimizar</p>
                  </CardContent></Card>
                  <Card><CardContent className="pt-3 text-center">
                    <p className="text-xl font-bold text-blue-600">{auditOutput.summary.needs_seo}</p>
                    <p className="text-[10px] text-muted-foreground">SEO fraco</p>
                  </CardContent></Card>
                </div>
              )}

              {/* Recommendations list */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-destructive" /> Produtos com problemas
                    <span className="text-xs text-muted-foreground ml-auto">
                      Última auditoria: {new Date(latestAudit.created_at).toLocaleString("pt-PT")}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const recs = auditOutput.recommendations || [];
                    const AuditList = () => {
                      const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
                      const toggleId = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
                      const selectAll = () => setSelectedIds(new Set(recs.map((r: any) => r.product_id)));
                      const selectNone = () => setSelectedIds(new Set());

                      const needsReopt = recs.filter((r: any) => r.needs_reoptimize);
                      const selectedNeedsReopt = Array.from(selectedIds).filter(id => needsReopt.some((r: any) => r.product_id === id));

                      if (!recs.length) return <p className="text-xs text-muted-foreground py-4 text-center">🎉 Todos os produtos publicados estão em bom estado!</p>;

                      const pendingFix = recs.filter((r: any) => !reoptimizedProducts.has(r.product_id));
                      const readyToPublish = recs.filter((r: any) => reoptimizedProducts.has(r.product_id));

                      return (
                        <div className="space-y-3">
                          {/* Ready to Republish section */}
                          {readyToPublish.length > 0 && (
                            <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-green-700 dark:text-green-400 flex items-center gap-1">
                                  <CheckCircle className="w-3.5 h-3.5" /> {readyToPublish.length} corrigido(s) — pronto(s) para republicar
                                </span>
                                <Button size="sm" className="h-7 text-xs"
                                  disabled={auditRepublishing}
                                  onClick={() => {
                                    const ids = readyToPublish.map((r: any) => r.product_id);
                                    if (confirm(`Republicar ${ids.length} produto(s) corrigidos no WooCommerce?`)) {
                                      handleAction(ids, "audit_republish");
                                    }
                                  }}
                                >
                                  <Upload className="w-3 h-3 mr-1" /> {auditRepublishing ? "A publicar..." : "Republicar no WC"}
                                </Button>
                              </div>
                              <div className="max-h-32 overflow-y-auto space-y-1">
                                {readyToPublish.map((r: any, idx: number) => {
                                  const result = reoptimizeResults.find((res: any) => res.productId === r.product_id);
                                  return (
                                    <div key={idx} className="flex items-center gap-2 text-xs p-1.5 rounded bg-green-100/50 dark:bg-green-900/20">
                                      <CheckCircle className="w-3 h-3 text-green-600 shrink-0" />
                                      <span className="font-medium truncate flex-1">{r.title}</span>
                                      <span className="text-[10px] text-green-600">{result?.auto_fixed?.length || 0} corrigido(s)</span>
                                      {result?.needs_full_optimization?.length > 0 && (
                                        <Badge variant="outline" className="text-[9px] h-3.5 border-orange-300 text-orange-600">
                                          {result.needs_full_optimization.length} pendente(s)
                                        </Badge>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Products still needing fixes */}
                          {pendingFix.length > 0 && (
                            <>
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">{pendingFix.length} produto(s) por corrigir</span>
                                <div className="flex gap-1">
                                  <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={selectAll}>Selecionar Todos</Button>
                                  <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={selectNone}>Limpar</Button>
                                </div>
                              </div>

                              {selectedIds.size > 0 && (
                                <div className="flex gap-2 flex-wrap bg-primary/5 p-3 rounded-lg border border-primary/20">
                                  <span className="text-xs font-medium text-primary self-center">{selectedIds.size} selecionado(s)</span>
                                  <div className="ml-auto flex gap-2 flex-wrap">
                                    <Button size="sm" variant="outline" className="h-7 text-xs"
                                      disabled={auditReoptimizing || auditReoptimizingWithImages}
                                      onClick={() => handleAction(Array.from(selectedIds), "audit_reoptimize")}
                                    >
                                      <Wand2 className="w-3 h-3 mr-1" /> {auditReoptimizing ? "A corrigir..." : "Corrigir Produto"}
                                    </Button>
                                    <Button size="sm" variant="outline" className="h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-50"
                                      disabled={auditReoptimizing || auditReoptimizingWithImages}
                                      onClick={() => handleAction(Array.from(selectedIds), "audit_reoptimize_with_images")}
                                    >
                                      <ImageIcon className="w-3 h-3 mr-1" /> {auditReoptimizingWithImages ? "A corrigir..." : "Corrigir + Imagens"}
                                    </Button>
                                  </div>
                                </div>
                              )}

                              <div className="max-h-96 overflow-y-auto space-y-1">
                                {pendingFix.map((r: any, idx: number) => (
                                  <div key={idx}
                                    className={`flex items-start gap-2 text-xs p-2 rounded cursor-pointer hover:bg-muted/50 transition-colors ${selectedIds.has(r.product_id) ? "bg-primary/5 border border-primary/20" : "border border-transparent"}`}
                                    onClick={() => toggleId(r.product_id)}
                                  >
                                    <input type="checkbox" checked={selectedIds.has(r.product_id)} readOnly className="w-3 h-3 accent-primary mt-0.5" />
                                    <Badge variant={r.severity === "critical" ? "destructive" : r.severity === "high" ? "destructive" : "secondary"} className="text-[10px] h-4 min-w-[3.5rem] justify-center shrink-0">
                                      {r.severity}
                                    </Badge>
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium truncate">{r.title}</p>
                                      <p className="text-muted-foreground text-[10px]">SKU: {r.sku} · WC#{r.woocommerce_id} · {r.issue_count} problema(s)</p>
                                      {selectedIds.has(r.product_id) && (
                                        <div className="mt-1 flex flex-wrap gap-1">
                                          {r.issues?.map((issue: any, i: number) => (
                                            <Badge key={i} variant={issue.severity === "high" ? "destructive" : "outline"} className="text-[9px] h-3.5">
                                              {issue.label}
                                            </Badge>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    };
                    return <AuditList />;
                  })()}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ─── Agents Tab ─── */}
        <TabsContent value="agents" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Criar Agente</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input placeholder="Nome do agente" value={newAgentName} onChange={(e) => setNewAgentName(e.target.value)} className="flex-1" />
                <Select value={newAgentType} onValueChange={setNewAgentType}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="Tipo" /></SelectTrigger>
                  <SelectContent>
                    {AGENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button onClick={() => {
                  if (!newAgentName.trim() || !newAgentType || !wsId) return;
                  createAgent.mutate({ workspace_id: wsId, agent_name: newAgentName.trim(), agent_type: newAgentType });
                  setNewAgentName(""); setNewAgentType("");
                }} disabled={!newAgentName.trim() || !newAgentType}>Criar</Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3">
            {agents.map((agent: any) => (
              <Card key={agent.id}>
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Bot className="w-5 h-5 text-primary" />
                    <div>
                      <p className="font-medium text-sm">{agent.agent_name}</p>
                      <p className="text-xs text-muted-foreground">{AGENT_TYPES.find(t => t.value === agent.agent_type)?.label || agent.agent_type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge className={statusColors[agent.status] || ""}>{agent.status}</Badge>
                    <Select value={agent.status} onValueChange={(v) => updateStatus.mutate({ id: agent.id, status: v })}>
                      <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="paused">Paused</SelectItem>
                        <SelectItem value="disabled">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            ))}
            {!agents.length && <p className="text-sm text-muted-foreground text-center py-8">Nenhum agente configurado.</p>}
          </div>
        </TabsContent>

        {/* ─── Tasks Tab ─── */}
        <TabsContent value="tasks" className="space-y-3">
          {tasks.map((task: any) => (
            <Card key={task.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{task.task_type}</p>
                  <p className="text-xs text-muted-foreground">{new Date(task.created_at).toLocaleString("pt-PT")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={statusColors[task.status] || ""}>{task.status}</Badge>
                  {task.error_message && <span className="text-xs text-destructive max-w-48 truncate">{task.error_message}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
          {!tasks.length && <p className="text-sm text-muted-foreground text-center py-8">Nenhuma tarefa registada.</p>}
        </TabsContent>

        {/* ─── Actions Tab ─── */}
        <TabsContent value="actions" className="space-y-3">
          {actions.map((action: any) => (
            <Card key={action.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{action.action_type}</p>
                  <p className="text-xs text-muted-foreground">
                    Confiança: {action.confidence}% · {new Date(action.created_at).toLocaleString("pt-PT")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {action.approved_by_user ? (
                    <Badge className="bg-green-500/10 text-green-700 dark:text-green-400">Aprovada</Badge>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => approveAction.mutate({ actionId: action.id, approved: true })}>
                        <CheckCircle className="w-3 h-3 mr-1" /> Aprovar
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => approveAction.mutate({ actionId: action.id, approved: false })}>
                        <XCircle className="w-3 h-3 mr-1" /> Rejeitar
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {!actions.length && <p className="text-sm text-muted-foreground text-center py-8">Nenhuma ação registada.</p>}
        </TabsContent>

        {/* ─── Policies Tab ─── */}
        <TabsContent value="policies" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Criar Política</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-2 items-center">
                <Input placeholder="Nome da política" value={newPolicyName} onChange={(e) => setNewPolicyName(e.target.value)} className="flex-1" />
                <Select value={newPolicyType} onValueChange={setNewPolicyType}>
                  <SelectTrigger className="w-48"><SelectValue placeholder="Tipo agente" /></SelectTrigger>
                  <SelectContent>
                    {AGENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1 text-xs">
                  <Switch checked={newPolicyApproval} onCheckedChange={setNewPolicyApproval} />
                  <span>Aprovação</span>
                </div>
                <Button onClick={() => {
                  if (!newPolicyName.trim() || !newPolicyType || !wsId) return;
                  createPolicy.mutate({ workspace_id: wsId, policy_name: newPolicyName.trim(), agent_type: newPolicyType, requires_approval: newPolicyApproval });
                  setNewPolicyName(""); setNewPolicyType("");
                }} disabled={!newPolicyName.trim() || !newPolicyType}>Criar</Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3">
            {policies.map((policy: any) => (
              <Card key={policy.id}>
                <CardContent className="py-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{policy.policy_name}</p>
                    <p className="text-xs text-muted-foreground">{AGENT_TYPES.find(t => t.value === policy.agent_type)?.label || policy.agent_type}</p>
                  </div>
                  <Badge className={policy.requires_approval ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" : "bg-green-500/10 text-green-700 dark:text-green-400"}>
                    {policy.requires_approval ? "Aprovação Manual" : "Automático"}
                  </Badge>
                </CardContent>
              </Card>
            ))}
            {!policies.length && <p className="text-sm text-muted-foreground text-center py-8">Nenhuma política configurada.</p>}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
