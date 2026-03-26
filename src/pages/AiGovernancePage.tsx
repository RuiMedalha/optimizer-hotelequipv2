import { useState } from "react";
import { useAiGovernance } from "@/hooks/useAiGovernance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DollarSign, Gauge, Shield, Plus, CheckCircle, TrendingUp } from "lucide-react";

const MODES = ["economic", "balanced", "premium"];
const MODELS = ["google/gemini-2.5-flash-lite", "google/gemini-2.5-flash", "google/gemini-2.5-pro", "google/gemini-3-flash-preview"];

export default function AiGovernancePage() {
  const { usageSummary, usageLogs, profiles, createProfile, activateProfile, retryPolicies, createRetryPolicy } = useAiGovernance();
  const [newRetry, setNewRetry] = useState({ policy_name: "", retry_limit: "3", fallback_model: "google/gemini-2.5-flash-lite" });

  const summary = usageSummary.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Gauge className="w-6 h-6" /> AI Cost & Execution</h1>
        <p className="text-muted-foreground">Controlo de custos, modelos e políticas de retry</p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">${summary.totalCost.toFixed(4)}</p><p className="text-xs text-muted-foreground">Custo Total</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{summary.totalRequests}</p><p className="text-xs text-muted-foreground">Requests</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{(summary.totalInputTokens / 1000).toFixed(1)}k</p><p className="text-xs text-muted-foreground">Input Tokens</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{(summary.totalOutputTokens / 1000).toFixed(1)}k</p><p className="text-xs text-muted-foreground">Output Tokens</p></CardContent></Card>
        </div>
      )}

      <Tabs defaultValue="profiles">
        <TabsList>
          <TabsTrigger value="profiles">Perfis de Execução</TabsTrigger>
          <TabsTrigger value="retry">Retry Policies</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="profiles" className="space-y-4 mt-4">
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
                  {p.is_active && <CheckCircle className="w-4 h-4 text-green-500" />}
                  <div>
                    <p className="font-medium">{p.profile_name}</p>
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
          {profiles.data?.length === 0 && <p className="text-muted-foreground">Crie um perfil acima.</p>}
        </TabsContent>

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
                <p className="font-medium">{r.policy_name}</p>
                <div className="flex gap-2">
                  <Badge variant="outline">Retries: {r.retry_limit}</Badge>
                  <Badge variant="secondary">{r.fallback_model}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
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
              {usageLogs.data?.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sem logs</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  );
}
