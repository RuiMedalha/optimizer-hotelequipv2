import { Package, CheckCircle, Clock, Activity, Loader2, Brain, BookOpen, Globe, Database, Search, Layers, BarChart3, TrendingUp, AlertTriangle, Tag, Cpu, ImageIcon, DollarSign } from "lucide-react";
import { IntelligenceDashboardPanel } from "@/components/IntelligenceDashboardPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useNavigate } from "react-router-dom";
import { useProductStats } from "@/hooks/useProducts";
import { useRecentActivity } from "@/hooks/useActivityLog";
import { useTokenUsageSummary, useQualityMetrics } from "@/hooks/useOptimizationLogs";
import { useAiPricingDashboard } from "@/hooks/useAiPricingDashboard";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { pt } from "date-fns/locale";

const actionLabels: Record<string, string> = {
  upload: "Ficheiro carregado",
  optimize: "Produto otimizado",
  publish: "Produto publicado",
  settings_change: "Configurações alteradas",
  error: "Erro ocorrido",
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { activeWorkspace } = useWorkspaceContext();
  const { data: stats, isLoading: statsLoading } = useProductStats();
  const { data: activity, isLoading: activityLoading } = useRecentActivity();
  const { data: tokenSummary, isLoading: tokenLoading } = useTokenUsageSummary();
  const { data: quality, isLoading: qualityLoading } = useQualityMetrics();
  const { summary: aiCost, isLoading: aiCostLoading } = useAiPricingDashboard();

  const { data: imageCredits } = useQuery({
    queryKey: ["image-credits", activeWorkspace?.id],
    queryFn: async () => {
      if (!activeWorkspace) return null;
      const { data } = await supabase
        .from("image_credits" as any)
        .select("*")
        .eq("workspace_id", activeWorkspace.id)
        .maybeSingle();
      return data as unknown as { used_this_month: number; monthly_limit: number; reset_at: string } | null;
    },
    enabled: !!activeWorkspace,
  });

  const { data: scrapingCredits } = useQuery({
    queryKey: ["scraping-credits", activeWorkspace?.id],
    queryFn: async () => {
      if (!activeWorkspace) return null;
      const { data } = await supabase
        .from("scraping_credits")
        .select("*")
        .eq("workspace_id", activeWorkspace.id)
        .maybeSingle();
      return data;
    },
    enabled: !!activeWorkspace,
  });

  const lifecycleStages = [
    { label: "Pendentes",       value: stats?.pending      ?? 0, color: "text-warning",     bg: "bg-warning/10",     icon: Clock },
    { label: "A processar",     value: stats?.processing   ?? 0, color: "text-primary",     bg: "bg-primary/10",     icon: Loader2 },
    { label: "Otimizados",      value: stats?.optimized    ?? 0, color: "text-success",     bg: "bg-success/10",     icon: CheckCircle },
    { label: "Em revisão",      value: stats?.needs_review ?? 0, color: "text-amber-500",   bg: "bg-amber-500/10",   icon: AlertTriangle },
    { label: "Publicados",      value: stats?.published    ?? 0, color: "text-blue-500",    bg: "bg-blue-500/10",    icon: Globe },
    { label: "Com erro",        value: stats?.failed       ?? 0, color: "text-destructive", bg: "bg-destructive/10", icon: AlertTriangle },
  ];

  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-6 sm:space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          {activeWorkspace ? `Workspace: ${activeWorkspace.name}` : "A carregar workspace..."}
        </p>
      </div>

      {/* Product Lifecycle State */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2"><Package className="w-4 h-4" /> Pipeline de Produtos</span>
            {!statsLoading && (
              <span className="text-sm font-normal text-muted-foreground">{stats?.total ?? 0} total</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {lifecycleStages.map((stage) => (
                <div key={stage.label} className={`rounded-lg p-3 text-center ${stage.bg}`}>
                  <p className={`text-2xl font-bold ${stage.color}`}>{stage.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stage.label}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Intelligence Dashboard */}
      <IntelligenceDashboardPanel />

      {/* Credits Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ImageIcon className="w-4 h-4" />
            Créditos do Workspace
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">🖼️ Imagens</span>
                <span className="text-xs text-muted-foreground">
                  {imageCredits
                    ? `${imageCredits.used_this_month} / ${imageCredits.monthly_limit >= 1000000 ? "∞" : imageCredits.monthly_limit}`
                    : "0 / 100"}
                </span>
              </div>
              <Progress
                value={
                  imageCredits && imageCredits.monthly_limit < 1000000
                    ? (imageCredits.used_this_month / imageCredits.monthly_limit) * 100
                    : 0
                }
                className="h-2"
              />
              <p className="text-xs text-muted-foreground">
                {imageCredits && imageCredits.monthly_limit >= 1000000
                  ? "Sem limite ativo • otimização e lifestyle com IA"
                  : "Otimização e geração lifestyle com IA"}
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">🌐 Scraping</span>
                <span className="text-xs text-muted-foreground">
                  {scrapingCredits ? `${scrapingCredits.used_this_month} / ${scrapingCredits.monthly_limit}` : "0 / 1000"}
                </span>
              </div>
              <Progress
                value={scrapingCredits ? (scrapingCredits.used_this_month / scrapingCredits.monthly_limit) * 100 : 0}
                className="h-2"
              />
              <p className="text-xs text-muted-foreground">
                Enriquecimento web via Firecrawl
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quality Dashboard */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="w-4 h-4" />
            Qualidade &amp; Métricas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {qualityLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : !quality || quality.total === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sem dados de qualidade disponíveis.</p>
          ) : (
            <div className="space-y-5">
              {/* Key Rates */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-success">{quality.acceptanceRate}%</p>
                  <p className="text-xs text-muted-foreground">Taxa de Aceitação</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-primary">{quality.publishRate}%</p>
                  <p className="text-xs text-muted-foreground">Taxa de Publicação</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-destructive">{quality.errorRate}%</p>
                  <p className="text-xs text-muted-foreground">Taxa de Erro</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-foreground">{quality.optimized + quality.published}</p>
                  <p className="text-xs text-muted-foreground">Aceites / {quality.total}</p>
                </div>
              </div>

              {/* Model Comparison */}
              {quality.modelStats && Object.keys(quality.modelStats).length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                    <Cpu className="w-3 h-3" /> Comparação por Modelo de IA
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="p-2 text-left text-xs font-medium text-muted-foreground">Modelo</th>
                          <th className="p-2 text-center text-xs font-medium text-muted-foreground">Otimizações</th>
                          <th className="p-2 text-center text-xs font-medium text-muted-foreground">Tokens Totais</th>
                          <th className="p-2 text-center text-xs font-medium text-muted-foreground">c/ Conhecimento</th>
                          <th className="p-2 text-center text-xs font-medium text-muted-foreground">Avg Chunks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(quality.modelStats)
                          .sort(([, a], [, b]) => b.count - a.count)
                          .map(([model, stats]) => (
                            <tr key={model} className="border-b last:border-0">
                              <td className="p-2 font-mono text-xs">{model}</td>
                              <td className="p-2 text-center">{stats.count}</td>
                              <td className="p-2 text-center text-muted-foreground">{stats.tokens.toLocaleString()}</td>
                              <td className="p-2 text-center">
                                <Badge variant={stats.withKnowledge > 0 ? "default" : "secondary"} className="text-[10px]">
                                  {stats.withKnowledge}/{stats.count}
                                </Badge>
                              </td>
                              <td className="p-2 text-center text-muted-foreground">{stats.avgChunks}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Category Distribution */}
              {quality.topCategories.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                    <Tag className="w-3 h-3" /> Distribuição por Categoria
                  </h4>
                  <div className="space-y-1.5">
                    {quality.topCategories.map((cat, i) => {
                      const maxCount = quality.topCategories[0]?.count || 1;
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-xs truncate w-48 shrink-0">{cat.name}</span>
                          <div className="flex-1 h-4 rounded-full bg-muted/50 overflow-hidden">
                            <div
                              className="h-full bg-primary/70 rounded-full transition-all"
                              style={{ width: `${(cat.count / maxCount) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-8 text-right">{cat.count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Token Usage Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="w-4 h-4" />
            Consumo de IA
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tokenLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : !tokenSummary || tokenSummary.totalOptimizations === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sem otimizações registadas com dados de tokens.</p>
          ) : (
            <div className="space-y-4">
              {/* Token counters */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-primary">{tokenSummary.totalOptimizations}</p>
                  <p className="text-xs text-muted-foreground">Otimizações</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-foreground">{tokenSummary.totalTokens.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Total Tokens</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-foreground">{tokenSummary.totalPrompt.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Prompt Tokens</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-foreground">{tokenSummary.totalCompletion.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Completion Tokens</p>
                </div>
              </div>

              {/* Context usage */}
              <div className="flex flex-wrap gap-3">
                <Badge variant="outline" className="text-xs gap-1">
                  <BookOpen className="w-3 h-3" /> Conhecimento: {tokenSummary.withKnowledge}/{tokenSummary.totalOptimizations}
                </Badge>
                <Badge variant="outline" className="text-xs gap-1">
                  <Globe className="w-3 h-3" /> Fornecedor: {tokenSummary.withSupplier}/{tokenSummary.totalOptimizations}
                </Badge>
                <Badge variant="outline" className="text-xs gap-1">
                  <Database className="w-3 h-3" /> Catálogo: {tokenSummary.withCatalog}/{tokenSummary.totalOptimizations}
                </Badge>
              </div>

              {/* RAG Metrics */}
              {(tokenSummary.totalChunksUsed > 0 || Object.keys(tokenSummary.matchTypeTotals).length > 0) && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                    <Search className="w-3 h-3" /> Métricas RAG Híbrido
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <p className="text-xl font-bold text-primary">{tokenSummary.totalChunksUsed}</p>
                      <p className="text-[10px] text-muted-foreground">Chunks Usados</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <p className="text-xl font-bold text-foreground">{tokenSummary.avgChunksPerOptimization}</p>
                      <p className="text-[10px] text-muted-foreground">Média/Otimização</p>
                    </div>
                    {Object.entries(tokenSummary.matchTypeTotals).length > 0 && Object.entries(tokenSummary.matchTypeTotals)
                      .sort(([, a], [, b]) => (b as number) - (a as number))
                      .slice(0, 2)
                      .map(([type, count]) => {
                        const labels: Record<string, string> = { fts: "Full-Text", trigram: "Trigram", family: "Família", fts_fallback: "FTS Fallback", unknown: "Outro" };
                        return (
                          <div key={type} className="text-center p-3 rounded-lg bg-muted/50">
                            <p className="text-xl font-bold text-foreground">{count as number}</p>
                            <p className="text-[10px] text-muted-foreground">{labels[type] || type}</p>
                          </div>
                        );
                      })}
                  </div>
                  {/* Match type breakdown bar */}
                  {Object.keys(tokenSummary.matchTypeTotals).length > 0 && (() => {
                    const total = Object.values(tokenSummary.matchTypeTotals).reduce((s, v) => s + (v as number), 0);
                    const colors: Record<string, string> = { fts: "bg-primary", trigram: "bg-chart-2", family: "bg-chart-3", fts_fallback: "bg-chart-4", unknown: "bg-muted-foreground" };
                    const labels: Record<string, string> = { fts: "FTS", trigram: "Trigram", family: "Família", fts_fallback: "Fallback", unknown: "Outro" };
                    return (
                      <div className="space-y-1">
                        <div className="flex h-3 rounded-full overflow-hidden">
                          {Object.entries(tokenSummary.matchTypeTotals)
                            .sort(([, a], [, b]) => (b as number) - (a as number))
                            .map(([type, count]) => (
                              <div
                                key={type}
                                className={`${colors[type] || "bg-muted-foreground"} transition-all`}
                                style={{ width: `${((count as number) / total) * 100}%` }}
                                title={`${labels[type] || type}: ${count} (${(((count as number) / total) * 100).toFixed(0)}%)`}
                              />
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {Object.entries(tokenSummary.matchTypeTotals)
                            .sort(([, a], [, b]) => (b as number) - (a as number))
                            .map(([type, count]) => (
                              <span key={type} className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <span className={`w-2 h-2 rounded-full ${colors[type] || "bg-muted-foreground"}`} />
                                {labels[type] || type}: {count} ({(((count as number) / total) * 100).toFixed(0)}%)
                              </span>
                            ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Top sources */}
              {tokenSummary.topSources.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                    <Layers className="w-3 h-3" /> Top fontes de conhecimento
                  </h4>
                  <div className="space-y-1">
                    {tokenSummary.topSources.map((s, i) => (
                      <div key={i} className="flex items-center justify-between text-sm p-2 rounded bg-muted/30">
                        <span className="truncate">{s.name}</span>
                        <Badge variant="outline" className="text-xs">{s.count} chunks</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Cost Dashboard */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="w-4 h-4" />
            Custo estimado por IA
            {!aiCost.pricingLoaded && !aiCostLoading && (
              <Badge variant="outline" className="text-xs ml-auto">Sem preços no BD</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {aiCostLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-4">
              {/* Totals row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg bg-muted/40 p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Custo total</p>
                  <p className="text-lg font-bold">${aiCost.totalCostUsd.toFixed(4)}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Por otimização</p>
                  <p className="text-lg font-bold">${aiCost.costPerOptimization.toFixed(4)}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Tokens entrada</p>
                  <p className="text-lg font-bold">{(aiCost.totalInputTokens / 1000).toFixed(1)}k</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Tokens saída</p>
                  <p className="text-lg font-bold">{(aiCost.totalOutputTokens / 1000).toFixed(1)}k</p>
                </div>
              </div>

              {/* Cost by provider */}
              {aiCost.costByProvider.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Por fornecedor</h4>
                  <div className="flex flex-wrap gap-2">
                    {aiCost.costByProvider.map(({ provider, costUsd }) => (
                      <Badge key={provider} variant="secondary" className="text-sm px-3 py-1">
                        {provider}: ${costUsd.toFixed(4)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Cost by model table */}
              {aiCost.costByModel.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Por modelo</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs text-muted-foreground">
                          <th className="text-left py-1.5 pr-3">Modelo</th>
                          <th className="text-left py-1.5 pr-3 hidden sm:table-cell">Uso recomendado</th>
                          <th className="text-right py-1.5 pr-3">Chamadas</th>
                          <th className="text-right py-1.5 pr-3 hidden md:table-cell">Entrada</th>
                          <th className="text-right py-1.5 pr-3 hidden md:table-cell">Saída</th>
                          <th className="text-right py-1.5">Custo (USD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aiCost.costByModel.map((m) => {
                          const meta = m.metadata;
                          const speedColor = { fast: "text-success", medium: "text-warning", slow: "text-destructive" }[meta.speed_tier ?? ""] ?? "text-muted-foreground";
                          const qualityColor = { premium: "text-purple-500", high: "text-blue-500", standard: "text-muted-foreground" }[meta.quality_tier ?? ""] ?? "text-muted-foreground";
                          const costColor = { cheap: "text-success", medium: "text-warning", expensive: "text-destructive" }[meta.cost_tier ?? ""] ?? "text-muted-foreground";
                          const speedLabel = { fast: "Rápido", medium: "Médio", slow: "Lento" }[meta.speed_tier ?? ""] ?? "";
                          const qualityLabel = { premium: "Premium", high: "Alta", standard: "Padrão" }[meta.quality_tier ?? ""] ?? "";
                          const costLabel = { cheap: "Barato", medium: "Médio", expensive: "Caro" }[meta.cost_tier ?? ""] ?? "";
                          return (
                            <tr key={m.modelId} className="border-b border-border/50 last:border-0 align-top">
                              <td className="py-2 pr-3">
                                <div className="font-medium leading-snug">{m.displayName}</div>
                                {!m.pricingFound && (
                                  <span className="text-[10px] text-destructive">Sem preço configurado — modelo em logs sem linha na tabela</span>
                                )}
                                {(speedLabel || qualityLabel || costLabel) && (
                                  <div className="flex gap-1.5 mt-0.5 flex-wrap">
                                    {speedLabel && <span className={`text-[10px] font-medium ${speedColor}`}>⚡ {speedLabel}</span>}
                                    {qualityLabel && <span className={`text-[10px] font-medium ${qualityColor}`}>★ {qualityLabel}</span>}
                                    {costLabel && <span className={`text-[10px] font-medium ${costColor}`}>$ {costLabel}</span>}
                                  </div>
                                )}
                              </td>
                              <td className="py-2 pr-3 hidden sm:table-cell">
                                <span className="text-xs text-muted-foreground">{meta.best_for ?? "—"}</span>
                              </td>
                              <td className="text-right py-2 pr-3 text-muted-foreground">{m.callCount}</td>
                              <td className="text-right py-2 pr-3 text-muted-foreground hidden md:table-cell">{(m.inputTokens / 1000).toFixed(1)}k</td>
                              <td className="text-right py-2 pr-3 text-muted-foreground hidden md:table-cell">{(m.outputTokens / 1000).toFixed(1)}k</td>
                              <td className="text-right py-2 font-mono">${m.estimatedCostUsd.toFixed(4)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {aiCost.costByModel.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Sem dados de custo disponíveis.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Ações Rápidas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Button size="lg" className="h-20 text-base" onClick={() => navigate("/upload")}>
            📁 Carregar Ficheiros
          </Button>
          <Button size="lg" variant="secondary" className="h-20 text-base" onClick={() => navigate("/produtos")}>
            📦 Ver Produtos
          </Button>
          <Button size="lg" variant="outline" className="h-20 text-base" onClick={() => navigate("/configuracoes")}>
            ⚙️ Configurações
          </Button>
        </div>
      </div>

      {/* Activity Log */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="w-4 h-4" />
            Atividade Recente
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activityLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : !activity || activity.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sem atividade registada.</p>
          ) : (
            <div className="space-y-3">
              {activity.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <span className="text-sm">{actionLabels[item.action] ?? item.action}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: pt })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
