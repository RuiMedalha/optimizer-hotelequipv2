import { useState } from "react";
import { useAgentRegistry } from "@/hooks/useAgentRegistry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Plus, Cpu, Activity, Puzzle } from "lucide-react";

export default function AgentRegistryPage() {
  const { agents, seedAgents, useAgentLogs, useAgentCapabilities, addCapability } = useAgentRegistry();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [newCap, setNewCap] = useState({ capability_name: "", capability_description: "" });

  const logs = useAgentLogs(selectedAgent);
  const capabilities = useAgentCapabilities(selectedAgent);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="w-6 h-6" /> Agent Registry</h1>
          <p className="text-muted-foreground">Registo e coordenação de agentes de IA</p>
        </div>
        {agents.data?.length === 0 && (
          <Button onClick={() => seedAgents.mutate()} disabled={seedAgents.isPending}>
            <Plus className="w-4 h-4 mr-1" /> Registar Agentes Default
          </Button>
        )}
      </div>

      <Tabs defaultValue="agents">
        <TabsList>
          <TabsTrigger value="agents">Agentes</TabsTrigger>
          <TabsTrigger value="capabilities">Capacidades</TabsTrigger>
          <TabsTrigger value="logs">Logs de Execução</TabsTrigger>
        </TabsList>

        <TabsContent value="agents" className="space-y-3 mt-4">
          {agents.data?.length === 0 && <p className="text-muted-foreground">Nenhum agente registado. Clique em "Registar Agentes Default".</p>}
          {agents.data?.map((a: any) => (
            <Card key={a.id} className={`cursor-pointer transition-colors ${selectedAgent === a.id ? "border-primary" : ""}`} onClick={() => setSelectedAgent(a.id)}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <Cpu className="w-5 h-5 text-primary" />
                  <div>
                    <p className="font-medium">{a.agent_name}</p>
                    <p className="text-xs text-muted-foreground">{a.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{a.agent_type}</Badge>
                  <Badge variant="outline">{a.model_preference}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="capabilities" className="mt-4 space-y-4">
          {!selectedAgent ? (
            <p className="text-muted-foreground">Selecione um agente.</p>
          ) : (
            <>
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Puzzle className="w-4 h-4" /> Adicionar Capacidade</CardTitle></CardHeader>
                <CardContent className="flex gap-2">
                  <Input placeholder="Nome" value={newCap.capability_name} onChange={(e) => setNewCap({ ...newCap, capability_name: e.target.value })} className="max-w-xs" />
                  <Input placeholder="Descrição" value={newCap.capability_description} onChange={(e) => setNewCap({ ...newCap, capability_description: e.target.value })} />
                  <Button size="sm" onClick={() => { addCapability.mutate({ agent_id: selectedAgent!, ...newCap }); setNewCap({ capability_name: "", capability_description: "" }); }} disabled={!newCap.capability_name}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
              {capabilities.data?.map((c: any) => (
                <Card key={c.id}>
                  <CardContent className="p-4">
                    <p className="font-medium">{c.capability_name}</p>
                    <p className="text-sm text-muted-foreground">{c.capability_description || "—"}</p>
                  </CardContent>
                </Card>
              ))}
              {capabilities.data?.length === 0 && <p className="text-muted-foreground">Sem capacidades registadas.</p>}
            </>
          )}
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          {!selectedAgent ? (
            <p className="text-muted-foreground">Selecione um agente.</p>
          ) : (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" /> Logs</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Confiança</TableHead>
                      <TableHead>Tempo (ms)</TableHead>
                      <TableHead>Custo Est.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.data?.map((l: any) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs">{new Date(l.created_at).toLocaleString()}</TableCell>
                        <TableCell>{l.confidence_score ? `${(l.confidence_score * 100).toFixed(0)}%` : "—"}</TableCell>
                        <TableCell>{l.execution_time || "—"}</TableCell>
                        <TableCell>{l.cost_estimate ? `$${l.cost_estimate}` : "—"}</TableCell>
                      </TableRow>
                    ))}
                    {logs.data?.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sem logs</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
