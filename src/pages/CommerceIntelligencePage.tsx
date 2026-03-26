import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Loader2, Brain, TrendingUp, Package, Search, DollarSign, BarChart3, CheckCircle, XCircle, Eye, Lightbulb, RefreshCw } from "lucide-react";
import {
  useProductInsights, useUpdateInsightStatus,
  useBundleSuggestions, useAcceptBundle,
  useSeoRecommendations, useCatalogGaps,
  useMonetizationOpportunities, useCompletenessScores,
  useAnalyzeCatalog,
  INSIGHT_TYPE_LABELS,
} from "@/hooks/useCommerceIntelligence";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

export default function CommerceIntelligencePage() {
  const { activeWorkspace } = useWorkspaceContext();
  const { data: insights, isLoading: insightsLoading } = useProductInsights();
  const { data: bundles } = useBundleSuggestions();
  const { data: seoRecs } = useSeoRecommendations();
  const { data: gaps } = useCatalogGaps();
  const { data: monetization } = useMonetizationOpportunities();
  const { data: completeness } = useCompletenessScores();
  const analyzeCatalog = useAnalyzeCatalog();
  const updateInsight = useUpdateInsightStatus();
  const acceptBundle = useAcceptBundle();
  const [activeTab, setActiveTab] = useState("overview");

  const openInsights = insights?.filter((i: any) => i.status === "open") || [];
  const avgCompleteness = completeness?.length ? Math.round(completeness.reduce((s: number, c: any) => s + Number(c.completeness_score), 0) / completeness.length) : 0;

  const insightsByType: Record<string, number> = {};
  for (const i of openInsights) {
    insightsByType[i.insight_type] = (insightsByType[i.insight_type] || 0) + 1;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Brain className="w-6 h-6" /> Commerce Intelligence</h1>
          <p className="text-sm text-muted-foreground mt-1">Análise AI do catálogo, SEO, bundles e oportunidades</p>
        </div>
        <Button onClick={() => activeWorkspace && analyzeCatalog.mutate(activeWorkspace.id)} disabled={analyzeCatalog.isPending}>
          {analyzeCatalog.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Analisar Catálogo
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{openInsights.length}</div><p className="text-xs text-muted-foreground">Insights Abertos</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{bundles?.filter((b: any) => !b.accepted).length ?? 0}</div><p className="text-xs text-muted-foreground">Bundles Sugeridos</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{seoRecs?.length ?? 0}</div><p className="text-xs text-muted-foreground">Recomendações SEO</p></CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-2"><div className="text-2xl font-bold">{avgCompleteness}%</div></div>
          <p className="text-xs text-muted-foreground">Completude Média</p>
          <Progress value={avgCompleteness} className="h-1.5 mt-1" />
        </CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview"><Lightbulb className="w-4 h-4 mr-1" /> Visão Geral</TabsTrigger>
          <TabsTrigger value="insights"><Eye className="w-4 h-4 mr-1" /> Insights</TabsTrigger>
          <TabsTrigger value="seo"><Search className="w-4 h-4 mr-1" /> SEO</TabsTrigger>
          <TabsTrigger value="bundles"><Package className="w-4 h-4 mr-1" /> Bundles</TabsTrigger>
          <TabsTrigger value="monetization"><DollarSign className="w-4 h-4 mr-1" /> Monetização</TabsTrigger>
          <TabsTrigger value="completeness"><BarChart3 className="w-4 h-4 mr-1" /> Completude</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.entries(insightsByType).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
              const meta = INSIGHT_TYPE_LABELS[type] || { label: type, icon: "📋", color: "bg-muted text-muted-foreground" };
              return (
                <Card key={type} className="cursor-pointer hover:border-primary/50" onClick={() => setActiveTab("insights")}>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <span className="text-lg">{meta.icon}</span>
                      <Badge className={meta.color}>{count}</Badge>
                    </div>
                    <p className="text-sm font-medium mt-1">{meta.label}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {gaps && gaps.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Gaps de Catálogo</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {gaps.slice(0, 5).map((g: any) => (
                    <div key={g.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
                      <div>
                        <Badge variant="outline">{g.gap_type}</Badge>
                        <p className="text-sm mt-1">{g.gap_description}</p>
                      </div>
                      <Badge variant="secondary">{g.confidence}%</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* INSIGHTS */}
        <TabsContent value="insights" className="space-y-4">
          {insightsLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Tipo</TableHead><TableHead>Detalhe</TableHead>
                  <TableHead>Confiança</TableHead><TableHead>Prioridade</TableHead><TableHead>Ações</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {openInsights.slice(0, 50).map((i: any) => {
                    const meta = INSIGHT_TYPE_LABELS[i.insight_type] || { label: i.insight_type, icon: "📋", color: "bg-muted" };
                    return (
                      <TableRow key={i.id}>
                        <TableCell><Badge className={meta.color}>{meta.icon} {meta.label}</Badge></TableCell>
                        <TableCell className="text-sm max-w-[300px] truncate">{i.insight_payload?.reason || i.insight_payload?.suggestion || "—"}</TableCell>
                        <TableCell><Badge variant="outline">{i.confidence}%</Badge></TableCell>
                        <TableCell><Badge variant="secondary">P{i.priority}</Badge></TableCell>
                        <TableCell className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => updateInsight.mutate({ id: i.id, status: "accepted" })} title="Aceitar"><CheckCircle className="w-4 h-4 text-green-600" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => updateInsight.mutate({ id: i.id, status: "ignored" })} title="Ignorar"><XCircle className="w-4 h-4 text-muted-foreground" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {openInsights.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Sem insights. Execute a análise do catálogo.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent></Card>
          )}
        </TabsContent>

        {/* SEO */}
        <TabsContent value="seo" className="space-y-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Produto</TableHead><TableHead>Título Recomendado</TableHead>
                <TableHead>Meta Description</TableHead><TableHead>Keywords</TableHead><TableHead>Confiança</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(seoRecs || []).map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-mono">{r.product_id?.substring(0, 8)}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{r.recommended_title || "—"}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{r.recommended_meta_description || "—"}</TableCell>
                    <TableCell><div className="flex gap-1 flex-wrap">{(r.recommended_keywords || []).slice(0, 3).map((k: string, idx: number) => <Badge key={idx} variant="secondary" className="text-xs">{k}</Badge>)}</div></TableCell>
                    <TableCell><Badge variant="outline">{r.confidence}%</Badge></TableCell>
                  </TableRow>
                ))}
                {(!seoRecs || seoRecs.length === 0) && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Sem recomendações SEO</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* BUNDLES */}
        <TabsContent value="bundles" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(bundles || []).filter((b: any) => !b.accepted).map((b: any) => (
              <Card key={b.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">{b.bundle_type}</Badge>
                    <Badge variant="secondary">{b.confidence}%</Badge>
                  </div>
                  <p className="text-sm">{b.bundle_reason}</p>
                  <p className="text-xs text-muted-foreground">{b.suggested_products?.length || 0} produtos sugeridos</p>
                  <Button size="sm" variant="outline" onClick={() => acceptBundle.mutate(b.id)}>
                    <CheckCircle className="w-4 h-4 mr-1" /> Aceitar Bundle
                  </Button>
                </CardContent>
              </Card>
            ))}
            {(!bundles || bundles.filter((b: any) => !b.accepted).length === 0) && <p className="text-sm text-muted-foreground col-span-2 text-center py-8">Sem sugestões de bundle</p>}
          </div>
        </TabsContent>

        {/* MONETIZATION */}
        <TabsContent value="monetization" className="space-y-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Tipo</TableHead><TableHead>Descrição</TableHead>
                <TableHead>Receita Estimada</TableHead><TableHead>Confiança</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(monetization || []).map((m: any) => (
                  <TableRow key={m.id}>
                    <TableCell><Badge variant="outline">{m.opportunity_type}</Badge></TableCell>
                    <TableCell className="text-sm">{m.description || "—"}</TableCell>
                    <TableCell className="font-medium">{m.estimated_revenue_gain ? `€${Number(m.estimated_revenue_gain).toFixed(2)}` : "—"}</TableCell>
                    <TableCell><Badge variant="secondary">{m.confidence}%</Badge></TableCell>
                  </TableRow>
                ))}
                {(!monetization || monetization.length === 0) && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Sem oportunidades detetadas</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* COMPLETENESS */}
        <TabsContent value="completeness" className="space-y-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Produto</TableHead><TableHead>Atributos</TableHead>
                <TableHead>Completude</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(completeness || []).slice(0, 50).map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm font-mono">{c.product_id?.substring(0, 8)}</TableCell>
                    <TableCell className="text-sm">{c.present_attributes}/{c.required_attributes}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={Number(c.completeness_score)} className="h-2 w-24" />
                        <Badge className={Number(c.completeness_score) >= 80 ? "bg-green-500/10 text-green-600" : Number(c.completeness_score) >= 50 ? "bg-amber-500/10 text-amber-600" : "bg-red-500/10 text-red-600"}>
                          {Number(c.completeness_score).toFixed(0)}%
                        </Badge>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(!completeness || completeness.length === 0) && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">Sem dados de completude</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
