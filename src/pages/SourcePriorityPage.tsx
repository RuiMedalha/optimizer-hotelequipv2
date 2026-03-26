import { useState } from "react";
import { useSourcePriority } from "@/hooks/useSourcePriority";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Layers, Star, ArrowDownUp } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const SOURCES = ["excel", "xml", "api", "pdf", "woocommerce", "scraper", "ai", "dam", "manual"];
const DEFAULT_FIELDS = [
  { field: "price", primary: "excel", secondary: "api", fallback: "woocommerce" },
  { field: "stock", primary: "xml", secondary: "api", fallback: "excel" },
  { field: "specifications", primary: "pdf", secondary: "scraper", fallback: "manual" },
  { field: "description", primary: "ai", secondary: "manual", fallback: "scraper" },
  { field: "images", primary: "scraper", secondary: "dam", fallback: "woocommerce" },
  { field: "category", primary: "ai", secondary: "manual", fallback: "woocommerce" },
];

export default function SourcePriorityPage() {
  const { profiles, createProfile, useProfileRules, upsertRule } = useSourcePriority();
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [newProfileName, setNewProfileName] = useState("");
  const [newRule, setNewRule] = useState({ field_name: "", primary_source: "", secondary_source: "", fallback_source: "" });

  const rules = useProfileRules(selectedProfile);

  const handleCreateWithDefaults = async () => {
    if (!newProfileName.trim()) return;
    const result = await createProfile.mutateAsync({ profileName: newProfileName, isDefault: true });
    if (result?.id) {
      for (const df of DEFAULT_FIELDS) {
        await upsertRule.mutateAsync({
          profile_id: result.id,
          field_name: df.field,
          primary_source: df.primary,
          secondary_source: df.secondary,
          fallback_source: df.fallback,
          confidence_weight: 1.0,
        });
      }
      setSelectedProfile(result.id);
      setNewProfileName("");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ArrowDownUp className="w-6 h-6" /> Source Priority Engine
        </h1>
        <p className="text-muted-foreground">Prioridade de fontes por campo na reconciliação de dados</p>
      </div>

      <Tabs defaultValue="profiles">
        <TabsList>
          <TabsTrigger value="profiles">Perfis</TabsTrigger>
          <TabsTrigger value="rules">Regras</TabsTrigger>
        </TabsList>

        <TabsContent value="profiles" className="space-y-4 mt-4">
          <div className="flex gap-2">
            <Input placeholder="Nome do perfil..." value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} className="max-w-xs" />
            <Button onClick={handleCreateWithDefaults} disabled={createProfile.isPending || !newProfileName.trim()}>
              <Plus className="w-4 h-4 mr-1" /> Criar com defaults
            </Button>
          </div>

          {profiles.data?.map((p: any) => (
            <Card key={p.id} className={`cursor-pointer transition-colors ${selectedProfile === p.id ? "border-primary" : ""}`} onClick={() => setSelectedProfile(p.id)}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-primary" />
                  <span className="font-medium">{p.profile_name}</span>
                </div>
                {p.is_default && <Badge><Star className="w-3 h-3 mr-1" /> Default</Badge>}
              </CardContent>
            </Card>
          ))}
          {profiles.data?.length === 0 && <p className="text-muted-foreground">Nenhum perfil. Crie um para começar.</p>}
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          {!selectedProfile ? (
            <p className="text-muted-foreground">Selecione um perfil na tab Perfis.</p>
          ) : (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Adicionar regra</CardTitle></CardHeader>
                <CardContent className="flex gap-2 flex-wrap">
                  <Input placeholder="Campo" value={newRule.field_name} onChange={(e) => setNewRule({ ...newRule, field_name: e.target.value })} className="w-40" />
                  {(["primary_source", "secondary_source", "fallback_source"] as const).map((key) => (
                    <Select key={key} value={newRule[key]} onValueChange={(v) => setNewRule({ ...newRule, [key]: v })}>
                      <SelectTrigger className="w-36"><SelectValue placeholder={key.replace("_", " ")} /></SelectTrigger>
                      <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  ))}
                  <Button size="sm" onClick={() => {
                    if (!newRule.field_name || !newRule.primary_source) return;
                    upsertRule.mutate({ profile_id: selectedProfile!, ...newRule, confidence_weight: 1.0 });
                    setNewRule({ field_name: "", primary_source: "", secondary_source: "", fallback_source: "" });
                  }}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campo</TableHead>
                    <TableHead>Primária</TableHead>
                    <TableHead>Secundária</TableHead>
                    <TableHead>Fallback</TableHead>
                    <TableHead>Peso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.data?.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.field_name}</TableCell>
                      <TableCell><Badge>{r.primary_source}</Badge></TableCell>
                      <TableCell><Badge variant="secondary">{r.secondary_source || "—"}</Badge></TableCell>
                      <TableCell><Badge variant="outline">{r.fallback_source || "—"}</Badge></TableCell>
                      <TableCell>{r.confidence_weight}</TableCell>
                    </TableRow>
                  ))}
                  {rules.data?.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sem regras</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
