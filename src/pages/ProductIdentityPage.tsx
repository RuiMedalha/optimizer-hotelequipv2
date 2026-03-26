import { useState } from "react";
import { useProductIdentity } from "@/hooks/useProductIdentity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Fingerprint, Plus, GitMerge, Link2 } from "lucide-react";

const STRATEGIES = ["auto", "manual", "ai_suggested"];
const GROUP_TYPES = ["variation", "accessory", "pack", "related"];

export default function ProductIdentityPage() {
  const { identityRules, variationPolicies, groupings, createIdentityRule, createVariationPolicy, seedDefaults } = useProductIdentity();
  const [newRule, setNewRule] = useState({ rule_name: "", field: "", priority: "1", match_type: "exact" });
  const [newPolicy, setNewPolicy] = useState({ policy_name: "", attribute_keys: "", variation_strategy: "auto" });

  const hasData = (identityRules.data?.length || 0) > 0 || (variationPolicies.data?.length || 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Fingerprint className="w-6 h-6" /> Product Identity & Variations</h1>
          <p className="text-muted-foreground">Regras de identificação e políticas de variação</p>
        </div>
        {!hasData && (
          <Button onClick={() => seedDefaults.mutate()} disabled={seedDefaults.isPending}>
            <Plus className="w-4 h-4 mr-1" /> Criar Regras Default
          </Button>
        )}
      </div>

      <Tabs defaultValue="identity">
        <TabsList>
          <TabsTrigger value="identity">Identidade</TabsTrigger>
          <TabsTrigger value="variations">Variações</TabsTrigger>
          <TabsTrigger value="groupings">Agrupamentos</TabsTrigger>
        </TabsList>

        <TabsContent value="identity" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Nova Regra de Identidade</CardTitle></CardHeader>
            <CardContent className="flex gap-2 flex-wrap">
              <Input placeholder="Nome" value={newRule.rule_name} onChange={(e) => setNewRule({ ...newRule, rule_name: e.target.value })} className="w-40" />
              <Input placeholder="Campo (ex: sku)" value={newRule.field} onChange={(e) => setNewRule({ ...newRule, field: e.target.value })} className="w-32" />
              <Input placeholder="Prioridade" type="number" value={newRule.priority} onChange={(e) => setNewRule({ ...newRule, priority: e.target.value })} className="w-24" />
              <Select value={newRule.match_type} onValueChange={(v) => setNewRule({ ...newRule, match_type: v })}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="exact">Exato</SelectItem>
                  <SelectItem value="fuzzy">Fuzzy</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => {
                if (!newRule.rule_name || !newRule.field) return;
                createIdentityRule.mutate({ rule_name: newRule.rule_name, rule_config: { field: newRule.field, priority: parseInt(newRule.priority), match_type: newRule.match_type } });
                setNewRule({ rule_name: "", field: "", priority: "1", match_type: "exact" });
              }}><Plus className="w-4 h-4" /></Button>
            </CardContent>
          </Card>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Regra</TableHead>
                <TableHead>Campo</TableHead>
                <TableHead>Prioridade</TableHead>
                <TableHead>Tipo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {identityRules.data?.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.rule_name}</TableCell>
                  <TableCell><Badge variant="secondary">{(r.rule_config as any)?.field}</Badge></TableCell>
                  <TableCell>{(r.rule_config as any)?.priority}</TableCell>
                  <TableCell><Badge variant="outline">{(r.rule_config as any)?.match_type}</Badge></TableCell>
                </TableRow>
              ))}
              {identityRules.data?.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sem regras</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="variations" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><GitMerge className="w-4 h-4" /> Nova Política de Variação</CardTitle></CardHeader>
            <CardContent className="flex gap-2 flex-wrap">
              <Input placeholder="Nome" value={newPolicy.policy_name} onChange={(e) => setNewPolicy({ ...newPolicy, policy_name: e.target.value })} className="w-40" />
              <Input placeholder="Atributos (vírgula)" value={newPolicy.attribute_keys} onChange={(e) => setNewPolicy({ ...newPolicy, attribute_keys: e.target.value })} className="w-60" />
              <Select value={newPolicy.variation_strategy} onValueChange={(v) => setNewPolicy({ ...newPolicy, variation_strategy: v })}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>{STRATEGIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" onClick={() => {
                if (!newPolicy.policy_name) return;
                createVariationPolicy.mutate({ policy_name: newPolicy.policy_name, attribute_keys: newPolicy.attribute_keys.split(",").map((s) => s.trim()).filter(Boolean), variation_strategy: newPolicy.variation_strategy });
                setNewPolicy({ policy_name: "", attribute_keys: "", variation_strategy: "auto" });
              }}><Plus className="w-4 h-4" /></Button>
            </CardContent>
          </Card>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Política</TableHead>
                <TableHead>Atributos</TableHead>
                <TableHead>Estratégia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {variationPolicies.data?.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.policy_name}</TableCell>
                  <TableCell className="flex gap-1 flex-wrap">{p.attribute_keys?.map((k: string) => <Badge key={k} variant="secondary">{k}</Badge>)}</TableCell>
                  <TableCell><Badge variant="outline">{p.variation_strategy}</Badge></TableCell>
                </TableRow>
              ))}
              {variationPolicies.data?.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Sem políticas</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="groupings" className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Razão</TableHead>
                <TableHead>Confiança</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupings.data?.map((g: any) => (
                <TableRow key={g.id}>
                  <TableCell><Badge>{g.group_type}</Badge></TableCell>
                  <TableCell>{g.group_reason || "—"}</TableCell>
                  <TableCell>{g.confidence_score ? `${(g.confidence_score * 100).toFixed(0)}%` : "—"}</TableCell>
                  <TableCell className="text-xs">{new Date(g.created_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {groupings.data?.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sem agrupamentos</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  );
}
