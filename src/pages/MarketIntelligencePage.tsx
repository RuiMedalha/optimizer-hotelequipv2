import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { useMarketSources, useMarketSignals, useMarketOpportunities, useMarketBenchmarks, useSyncMarketIntelligence, useUpdateOpportunityStatus, useAddMarketSource } from "@/hooks/useMarketIntelligence";
import { Globe, TrendingUp, AlertTriangle, Target, Plus, RefreshCw, CheckCircle, XCircle, BarChart3 } from "lucide-react";

const sourceTypes = ["competitor_site", "google_serp", "google_shopping", "marketplace", "supplier_feed", "public_catalog", "price_comparison"];

export default function MarketIntelligencePage() {
  const { activeWorkspace } = useWorkspaceContext();
  const wId = activeWorkspace?.id;
  const { data: sources = [] } = useMarketSources(wId);
  const { data: signals = [] } = useMarketSignals(wId);
  const { data: opportunities = [] } = useMarketOpportunities(wId);
  const { data: benchmarks = [] } = useMarketBenchmarks(wId);
  const syncPipeline = useSyncMarketIntelligence();
  const updateStatus = useUpdateOpportunityStatus();
  const addSource = useAddMarketSource();

  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("competitor_site");
  const [newUrl, setNewUrl] = useState("");

  const openOpps = opportunities.filter((o: any) => o.status === "open");
  const signalsByType: Record<string, number> = {};
  signals.forEach((s: any) => { signalsByType[s.signal_type] = (signalsByType[s.signal_type] || 0) + 1; });

  const signalColor = (t: string) => {
    if (t.includes("price")) return "text-amber-600";
    if (t.includes("gap")) return "text-red-500";
    if (t.includes("opportunity")) return "text-green-600";
    return "text-muted-foreground";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Market Intelligence</h1>
          <p className="text-muted-foreground text-sm">Dados de mercado, benchmarks competitivos e oportunidades</p>
        </div>
        <Button onClick={() => wId && syncPipeline.mutate({ workspaceId: wId })} disabled={!wId || syncPipeline.isPending}>
          <RefreshCw className={`w-4 h-4 mr-2 ${syncPipeline.isPending ? "animate-spin" : ""}`} /> Sync Pipeline
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Fontes Ativas</p><p className="text-2xl font-bold">{sources.filter((s: any) => s.is_active).length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Sinais Detetados</p><p className="text-2xl font-bold">{signals.length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Oportunidades Abertas</p><p className="text-2xl font-bold text-green-600">{openOpps.length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Benchmarks</p><p className="text-2xl font-bold">{benchmarks.length}</p></CardContent></Card>
      </div>

      <Tabs defaultValue="opportunities">
        <TabsList>
          <TabsTrigger value="opportunities"><Target className="w-4 h-4 mr-1" /> Oportunidades</TabsTrigger>
          <TabsTrigger value="signals"><AlertTriangle className="w-4 h-4 mr-1" /> Sinais</TabsTrigger>
          <TabsTrigger value="benchmarks"><BarChart3 className="w-4 h-4 mr-1" /> Benchmarks</TabsTrigger>
          <TabsTrigger value="sources"><Globe className="w-4 h-4 mr-1" /> Fontes</TabsTrigger>
        </TabsList>

        {/* OPPORTUNITIES */}
        <TabsContent value="opportunities" className="space-y-3">
          {openOpps.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Sem oportunidades. Execute o pipeline para gerar.</CardContent></Card>
          ) : openOpps.map((o: any) => (
            <Card key={o.id}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline">{(o.opportunity_type || "").replace(/_/g, " ")}</Badge>
                      <span className="text-xs text-muted-foreground">Prioridade: {o.priority_score}</span>
                      {o.estimated_revenue_impact && <span className="text-xs text-green-600">+€{o.estimated_revenue_impact}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {(o.recommendation_payload as any)?.signal_type?.replace(/_/g, " ")} • Confiança: {o.confidence_score}%
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: o.id, status: "accepted" })}><CheckCircle className="w-3.5 h-3.5 mr-1" /> Aceitar</Button>
                    <Button size="sm" variant="ghost" onClick={() => updateStatus.mutate({ id: o.id, status: "rejected" })}><XCircle className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* SIGNALS */}
        <TabsContent value="signals" className="space-y-3">
          {Object.entries(signalsByType).length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {Object.entries(signalsByType).map(([type, count]) => (
                <Badge key={type} variant="secondary" className="text-xs">{type.replace(/_/g, " ")}: {count}</Badge>
              ))}
            </div>
          )}
          {signals.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Sem sinais detetados.</CardContent></Card>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {signals.map((s: any) => (
                <Card key={s.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${signalColor(s.signal_type)}`}>{(s.signal_type || "").replace(/_/g, " ")}</span>
                        <span className="text-muted-foreground">Força: {s.signal_strength}%</span>
                      </div>
                      <span className="text-muted-foreground">{s.detected_at ? new Date(s.detected_at).toLocaleDateString("pt-PT") : ""}</span>
                    </div>
                    {s.signal_payload && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {(s.signal_payload as any).direction === "overpriced" && `Preço ${(s.signal_payload as any).price}€ vs mediana ${(s.signal_payload as any).median}€`}
                        {(s.signal_payload as any).direction === "underpriced" && `Preço ${(s.signal_payload as any).price}€ abaixo da mediana ${(s.signal_payload as any).median}€`}
                        {(s.signal_payload as any).title_length !== undefined && `Título ${(s.signal_payload as any).title_length} chars vs média ${(s.signal_payload as any).market_avg}`}
                        {(s.signal_payload as any).images === 0 && "Produto sem imagens"}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* BENCHMARKS */}
        <TabsContent value="benchmarks" className="space-y-3">
          {benchmarks.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Sem benchmarks.</CardContent></Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {benchmarks.map((b: any) => (
                <Card key={b.id}>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{(b.common_attributes as any)?.category_name || "Categoria"}</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {b.median_price && <div><span className="text-muted-foreground">Preço mediano:</span> <span className="font-medium">€{b.median_price}</span></div>}
                      {b.average_title_length && <div><span className="text-muted-foreground">Título médio:</span> <span className="font-medium">{b.average_title_length} chars</span></div>}
                      <div><span className="text-muted-foreground">Amostra:</span> <span className="font-medium">{(b.common_attributes as any)?.sample_size || "?"}</span></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* SOURCES */}
        <TabsContent value="sources" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Adicionar Fonte</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-2 flex-wrap">
                <Input placeholder="Nome" value={newName} onChange={(e) => setNewName(e.target.value)} className="max-w-[180px]" />
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger className="max-w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{sourceTypes.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="URL base" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} className="max-w-[250px]" />
                <Button size="sm" disabled={!newName.trim() || !newUrl.trim() || !wId} onClick={() => { addSource.mutate({ workspaceId: wId!, sourceName: newName, sourceType: newType, baseUrl: newUrl }); setNewName(""); setNewUrl(""); }}>
                  <Plus className="w-4 h-4 mr-1" /> Adicionar
                </Button>
              </div>
            </CardContent>
          </Card>

          {sources.length === 0 ? (
            <Card><CardContent className="py-6 text-center text-muted-foreground text-sm">Sem fontes configuradas.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {sources.map((s: any) => (
                <Card key={s.id}>
                  <CardContent className="py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{s.source_name}</p>
                      <p className="text-xs text-muted-foreground">{(s.source_type || "").replace(/_/g, " ")} • {s.base_url}</p>
                    </div>
                    <Badge variant={s.is_active ? "default" : "secondary"}>{s.is_active ? "Ativa" : "Inativa"}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
