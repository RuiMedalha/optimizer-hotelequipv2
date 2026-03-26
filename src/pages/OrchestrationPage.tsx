import { useState } from "react";
import { useOrchestration } from "@/hooks/useOrchestration";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, RefreshCw, CheckCircle, XCircle, Clock, Loader2, Workflow, GitBranch } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const statusIcon: Record<string, React.ReactNode> = {
  pending: <Clock className="w-4 h-4 text-muted-foreground" />,
  running: <Loader2 className="w-4 h-4 animate-spin text-primary" />,
  completed: <CheckCircle className="w-4 h-4 text-green-500" />,
  failed: <XCircle className="w-4 h-4 text-destructive" />,
  cancelled: <XCircle className="w-4 h-4 text-muted-foreground" />,
  skipped: <Clock className="w-4 h-4 text-muted-foreground" />,
};

const statusVariant = (s: string) => {
  if (s === "completed") return "default" as const;
  if (s === "running") return "secondary" as const;
  if (s === "failed") return "destructive" as const;
  return "outline" as const;
};

export default function OrchestrationPage() {
  const { runs, policies, startRun, resolveSteps, useRunSteps, useRunDecisions } = useOrchestration();
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [triggerSource, setTriggerSource] = useState("manual");

  const steps = useRunSteps(selectedRun);
  const decisions = useRunDecisions(selectedRun);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Workflow className="w-6 h-6" /> AI Orchestration Core
          </h1>
          <p className="text-muted-foreground">Motor central de coordenação de pipelines</p>
        </div>
        <div className="flex gap-2">
          <Select value={triggerSource} onValueChange={setTriggerSource}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="upload_pdf">Upload PDF</SelectItem>
              <SelectItem value="upload_excel">Upload Excel</SelectItem>
              <SelectItem value="upload_xml">Upload XML</SelectItem>
              <SelectItem value="woocommerce_sync">WooCommerce Sync</SelectItem>
              <SelectItem value="supplier_scrape">Supplier Scrape</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => startRun.mutate({ triggerSource, payload: { sourceType: triggerSource } })} disabled={startRun.isPending}>
            {startRun.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
            Iniciar Pipeline
          </Button>
        </div>
      </div>

      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="steps">Steps</TabsTrigger>
          <TabsTrigger value="decisions">Decisões</TabsTrigger>
          <TabsTrigger value="policies">Políticas</TabsTrigger>
        </TabsList>

        <TabsContent value="runs" className="space-y-3 mt-4">
          {runs.isLoading && <p className="text-muted-foreground">A carregar...</p>}
          {runs.data?.length === 0 && <p className="text-muted-foreground">Nenhum run encontrado.</p>}
          {runs.data?.map((run: any) => (
            <Card key={run.id} className={`cursor-pointer transition-colors ${selectedRun === run.id ? "border-primary" : ""}`} onClick={() => setSelectedRun(run.id)}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  {statusIcon[run.status]}
                  <div>
                    <p className="font-medium">{run.run_type.replace("_", " ")}</p>
                    <p className="text-xs text-muted-foreground">Fonte: {run.trigger_source} • {new Date(run.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                  {run.status === "running" && (
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); resolveSteps.mutate(run.id); }}>
                      <RefreshCw className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="steps" className="space-y-3 mt-4">
          {!selectedRun && <p className="text-muted-foreground">Selecione um run para ver os steps.</p>}
          {steps.data?.map((step: any, i: number) => (
            <Card key={step.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-muted-foreground w-6">{i + 1}</span>
                  {statusIcon[step.status]}
                  <div>
                    <p className="font-medium">{step.step_type}</p>
                    {step.confidence_score && <p className="text-xs text-muted-foreground">Confiança: {(step.confidence_score * 100).toFixed(0)}%</p>}
                  </div>
                </div>
                <Badge variant={statusVariant(step.status)}>{step.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="decisions" className="space-y-3 mt-4">
          {!selectedRun && <p className="text-muted-foreground">Selecione um run para ver as decisões.</p>}
          {decisions.data?.map((d: any) => (
            <Card key={d.id}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <GitBranch className="w-4 h-4 text-primary" />
                  <p className="font-medium">{d.decision_type}</p>
                  {d.confidence && <Badge variant="outline">{(d.confidence * 100).toFixed(0)}%</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{d.decision_reason}</p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="policies" className="space-y-3 mt-4">
          {policies.data?.length === 0 && <p className="text-muted-foreground">Nenhuma política configurada.</p>}
          {policies.data?.map((p: any) => (
            <Card key={p.id}>
              <CardContent className="flex items-center justify-between p-4">
                <p className="font-medium">{p.policy_name}</p>
                <Badge variant={p.is_active ? "default" : "outline"}>{p.is_active ? "Ativa" : "Inativa"}</Badge>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
