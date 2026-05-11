import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, AlertTriangle, TrendingUp, DollarSign, Search, ShieldCheck, Zap, RefreshCw } from "lucide-react";
import { useIntelligenceDashboard } from "@/hooks/useIntelligenceDashboard";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { toast } from "sonner";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { pt } from "date-fns/locale";

function KPICard({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2.5 rounded-xl bg-muted ${color || ""}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className="text-xl font-bold">{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function IntelligenceDashboardPanel() {
  const { data, isLoading, refetch } = useIntelligenceDashboard();
  const { activeWorkspace } = useWorkspaceContext();
  const [running, setRunning] = useState(false);
  const [inferringModels, setInferringModels] = useState(false);

  const runPipeline = async () => {
    if (!activeWorkspace) return;
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("run-intelligence-pipeline", {
        body: { workspace_id: activeWorkspace.id },
      });
      if (error) throw error;
      toast.success("Pipeline de inteligência concluído");
      refetch();
    } catch (e: any) {
      toast.error(e.message || "Erro ao executar pipeline");
    } finally {
      setRunning(false);
    }
  };

  const inferModelsInBulk = async () => {
    if (!activeWorkspace) return;
    setInferringModels(true);
    try {
      // Fetch products in this workspace that don't have a model
      const { data: products, error } = await supabase
        .from("products")
        .select("id, sku")
        .eq("workspace_id", activeWorkspace.id)
        .is("model", null)
        .not("sku", "is", null);

      if (error) throw error;
      if (!products || products.length === 0) {
        toast.info("Todos os produtos já possuem modelo ou não têm SKU.");
        return;
      }

      const updates = products.map(p => {
        const sku = p.sku;
        const lastHyphen = sku.lastIndexOf('-');
        const lastDot = sku.lastIndexOf('.');
        const lastUnderscore = sku.lastIndexOf('_');
        const lastSlash = sku.lastIndexOf('/');
        const lastSepIndex = Math.max(lastHyphen, lastDot, lastUnderscore, lastSlash);
        
        let suggested = sku;
        if (lastSepIndex !== -1 && lastSepIndex > 0) {
          const before = sku.substring(0, lastSepIndex);
          const after = sku.substring(lastSepIndex + 1);
          
          const hasDigitsBefore = /\d/.test(before);
          const isLikelySuffix = after.length <= 6 || /^\d+$/.test(after) || /^(V|BT|TN|HC|R\d+|TR|BT|TNV|BTV)$/i.test(after);
          
          if (hasDigitsBefore && isLikelySuffix) {
            suggested = before;
          }
        } else {
          const match = sku.match(/^(.*?\d+)([A-Z])$/i);
          if (match) {
            suggested = match[1];
          }
        }
        return { id: p.id, model: suggested };
      });

      // Update in batches of 50
      const batchSize = 50;
      let updatedCount = 0;
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        const { error: updateError } = await supabase.from("products").upsert(batch as any);
        if (updateError) throw updateError;
        updatedCount += batch.length;
      }

      toast.success(`${updatedCount} modelos inferidos com sucesso a partir do SKU.`);
      refetch();
    } catch (e: any) {
      toast.error(e.message || "Erro ao inferir modelos");
    } finally {
      setInferringModels(false);
    }
  };

  if (isLoading) {
    return (
      <Card><CardContent className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="text-center py-12 space-y-3">
          <p className="text-muted-foreground">Nenhuma análise de inteligência executada ainda.</p>
          <Button onClick={runPipeline} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Zap className="h-4 w-4 mr-1" />}
            Executar Pipeline Completo
          </Button>
        </CardContent>
      </Card>
    );
  }

  const healthColor = data.overallHealth >= 70 ? "text-green-600" : data.overallHealth >= 40 ? "text-yellow-600" : "text-red-600";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Inteligência do Catálogo
          </h2>
          <p className="text-xs text-muted-foreground">
            Última análise: {data.catalog?.completed_at
              ? formatDistanceToNow(new Date(data.catalog.completed_at), { addSuffix: true, locale: pt })
              : "Nunca"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={inferModelsInBulk} disabled={inferringModels || running}>
            {inferringModels ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Database className="h-3.5 w-3.5 mr-1" />}
            Inferir Modelos (SKU)
          </Button>
          <Button variant="outline" size="sm" onClick={runPipeline} disabled={running || inferringModels}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
            Executar Pipeline
          </Button>
        </div>
      </div>

      {/* Health Score */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Saúde do Catálogo</span>
            <span className={`text-2xl font-bold ${healthColor}`}>{data.overallHealth}%</span>
          </div>
          <Progress value={data.overallHealth} className="h-2" />
        </CardContent>
      </Card>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          icon={AlertTriangle}
          label="Issues Detetadas"
          value={data.totalIssues}
          sub={`${data.highSeverityIssues} alta severidade`}
          color="text-destructive"
        />
        <KPICard
          icon={Search}
          label="Oportunidades Procura"
          value={data.demandOpportunities}
          sub={data.demand ? `Confiança: ${((data.demand.confidence_score || 0) * 100).toFixed(0)}%` : undefined}
        />
        <KPICard
          icon={TrendingUp}
          label="Oportunidades Receita"
          value={data.revenueOpportunities}
          sub={data.revenue ? `Score: ${((data.revenue.confidence_score || 0) * 100).toFixed(0)}%` : undefined}
        />
        <KPICard
          icon={DollarSign}
          label="Receita Estimada"
          value={data.estimatedRevenue > 0 ? `€${Math.round(data.estimatedRevenue).toLocaleString()}` : "—"}
          sub="Impacto potencial"
        />
      </div>

      {/* Agent Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { label: "Catalog Intelligence", agent: data.catalog, icon: "🔍" },
          { label: "Demand Intelligence", agent: data.demand, icon: "📊" },
          { label: "Revenue Optimization", agent: data.revenue, icon: "💰" },
        ].map(({ label, agent, icon }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{icon} {label}</span>
                {agent ? (
                  <Badge className="bg-green-500/10 text-green-600 border-green-500/20 text-[10px]">Executado</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">Pendente</Badge>
                )}
              </div>
              {agent ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Confiança: <span className="font-medium text-foreground">{((agent.confidence_score || 0) * 100).toFixed(0)}%</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {agent.completed_at && formatDistanceToNow(new Date(agent.completed_at), { addSuffix: true, locale: pt })}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Ainda não executado</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Top Issues Preview */}
      {data.catalog?.output_payload?.issues_found?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">⚠️ Issues Prioritárias</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data.catalog.output_payload.issues_found as any[])
                .filter((i: any) => i.severity === "high")
                .slice(0, 5)
                .map((issue: any, idx: number) => (
                  <div key={idx} className="flex items-start gap-2 text-sm p-2 rounded bg-muted/30">
                    <Badge variant="destructive" className="text-[10px] shrink-0 mt-0.5">{issue.severity}</Badge>
                    <span className="text-xs">{issue.detail}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
