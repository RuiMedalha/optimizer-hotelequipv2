import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { useBundleRecommendations, usePricingRecommendations, usePromotionCandidates, useRevenueActions, useRunRevenuePipeline } from "@/hooks/useRevenueOptimization";
import { useDemandSignals, useKeywordOpportunities, useDemandTrends, useRunDemandPipeline } from "@/hooks/useDemandIntelligence";
import { DollarSign, Package, TrendingUp, Search, RefreshCw, Zap, Tag, BarChart3 } from "lucide-react";

export default function RevenueAndDemandPage() {
  const { activeWorkspace } = useWorkspaceContext();
  const wId = activeWorkspace?.id;
  const { data: bundles = [] } = useBundleRecommendations(wId);
  const { data: pricing = [] } = usePricingRecommendations(wId);
  const { data: promos = [] } = usePromotionCandidates(wId);
  const { data: actions = [] } = useRevenueActions(wId);
  const { data: demandSignals = [] } = useDemandSignals(wId);
  const { data: kwOpps = [] } = useKeywordOpportunities(wId);
  const { data: trends = [] } = useDemandTrends(wId);
  const revPipeline = useRunRevenuePipeline();
  const demandPipeline = useRunDemandPipeline();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Revenue & Demand Intelligence</h1>
          <p className="text-muted-foreground text-sm">Otimização comercial e inteligência de procura</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => wId && revPipeline.mutate({ workspaceId: wId })} disabled={!wId || revPipeline.isPending}>
            <DollarSign className="w-4 h-4 mr-1" /> Revenue Pipeline
          </Button>
          <Button onClick={() => wId && demandPipeline.mutate({ workspaceId: wId })} disabled={!wId || demandPipeline.isPending}>
            <Search className="w-4 h-4 mr-1" /> Demand Pipeline
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Bundles Sugeridos</p><p className="text-2xl font-bold">{bundles.length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Preços Otimizados</p><p className="text-2xl font-bold">{pricing.length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Keywords Emergentes</p><p className="text-2xl font-bold">{kwOpps.length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Tendências</p><p className="text-2xl font-bold">{trends.length}</p></CardContent></Card>
      </div>

      <Tabs defaultValue="bundles">
        <TabsList>
          <TabsTrigger value="bundles"><Package className="w-4 h-4 mr-1" /> Bundles</TabsTrigger>
          <TabsTrigger value="pricing"><DollarSign className="w-4 h-4 mr-1" /> Preços</TabsTrigger>
          <TabsTrigger value="promos"><Tag className="w-4 h-4 mr-1" /> Promoções</TabsTrigger>
          <TabsTrigger value="demand"><Search className="w-4 h-4 mr-1" /> Demand</TabsTrigger>
          <TabsTrigger value="keywords"><Zap className="w-4 h-4 mr-1" /> Keywords</TabsTrigger>
          <TabsTrigger value="trends"><TrendingUp className="w-4 h-4 mr-1" /> Tendências</TabsTrigger>
        </TabsList>

        <TabsContent value="bundles" className="space-y-3">
          {bundles.length === 0 ? <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Sem bundles. Execute o pipeline.</CardContent></Card> :
            bundles.map((b: any) => (
              <Card key={b.id}><CardContent className="py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{((b.bundle_products as any)?.product_ids || []).length} produtos</p>
                  <p className="text-xs text-muted-foreground">{(b.bundle_products as any)?.relationship}</p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span>Receita: €{b.expected_revenue}</span>
                  <span>Conv: {b.expected_conversion}%</span>
                  <Badge variant="outline">{b.confidence}%</Badge>
                </div>
              </CardContent></Card>
            ))}
        </TabsContent>

        <TabsContent value="pricing" className="space-y-2">
          {pricing.length === 0 ? <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Sem recomendações de preço.</CardContent></Card> :
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {pricing.map((p: any) => (
                <Card key={p.id}><CardContent className="py-3 flex items-center justify-between text-xs">
                  <span className="font-mono text-muted-foreground">{p.product_id?.slice(0, 8)}</span>
                  <div className="flex gap-4">
                    <span>Atual: €{p.current_price}</span>
                    <span className="font-medium">Recomendado: €{p.recommended_price}</span>
                    <span className="text-muted-foreground">Min: €{p.minimum_price}</span>
                    <Badge variant="outline">{p.confidence}%</Badge>
                  </div>
                </CardContent></Card>
              ))}
            </div>}
        </TabsContent>

        <TabsContent value="promos" className="space-y-2">
          {promos.length === 0 ? <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Sem candidatos a promoção.</CardContent></Card> :
            promos.map((p: any) => (
              <Card key={p.id}><CardContent className="py-3 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{(p.promotion_type || "").replace(/_/g, " ")}</Badge>
                  <span className="font-mono text-muted-foreground">{p.product_id?.slice(0, 8)}</span>
                </div>
                <div className="flex gap-3">
                  <span>+€{p.estimated_revenue_gain}</span>
                  <Badge variant="outline">{p.confidence}%</Badge>
                </div>
              </CardContent></Card>
            ))}
        </TabsContent>

        <TabsContent value="demand" className="space-y-2">
          {demandSignals.length === 0 ? <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Sem sinais de procura.</CardContent></Card> :
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {demandSignals.map((s: any) => (
                <Card key={s.id}><CardContent className="py-3 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.keyword}</span>
                    <Badge variant="outline">{(s.signal_type || "").replace(/_/g, " ")}</Badge>
                  </div>
                  <span>Força: {s.signal_strength}%</span>
                </CardContent></Card>
              ))}
            </div>}
        </TabsContent>

        <TabsContent value="keywords" className="space-y-2">
          {kwOpps.length === 0 ? <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Sem oportunidades de keyword.</CardContent></Card> :
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {kwOpps.map((k: any) => (
                <Card key={k.id}><CardContent className="py-3 flex items-center justify-between text-xs">
                  <span className="font-medium">{k.keyword}</span>
                  <div className="flex gap-3">
                    <span>Vol: {k.estimated_search_volume}</span>
                    <span>Comp: {k.competition_level}%</span>
                    <Badge variant="default">Score: {k.opportunity_score}</Badge>
                  </div>
                </CardContent></Card>
              ))}
            </div>}
        </TabsContent>

        <TabsContent value="trends" className="space-y-2">
          {trends.length === 0 ? <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Sem tendências detetadas.</CardContent></Card> :
            trends.map((t: any) => (
              <Card key={t.id}><CardContent className="py-3 flex items-center justify-between text-xs">
                <span className="font-medium">{t.keyword}</span>
                <div className="flex items-center gap-2">
                  <Badge variant={t.trend_direction === "rising" ? "default" : t.trend_direction === "declining" ? "destructive" : "secondary"}>{t.trend_direction}</Badge>
                  <span>Força: {t.trend_strength}</span>
                </div>
              </CardContent></Card>
            ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
