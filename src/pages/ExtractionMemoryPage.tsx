import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Brain, BookOpen, BarChart3, CheckCircle, AlertTriangle, XCircle, Plus, Trash2, Loader2, TrendingUp, TrendingDown, Users, Zap, Database, Languages } from "lucide-react";
import { useMemoryPatterns, useNormalizationDictionary, useDecisionHistory, useExtractionCorrections, useMemoryInsights, useAddNormalization, useDeleteNormalization } from "@/hooks/useExtractionMemory";
import { ConfidenceIndicator } from "@/components/ConfidenceIndicator";

const patternTypeLabels: Record<string, string> = {
  column_mapping: "Mapeamento de coluna",
  header_alias: "Alias de cabeçalho",
  table_layout: "Layout de tabela",
  unit_normalization: "Normalização de unidade",
  attribute_mapping: "Mapeamento de atributo",
  category_mapping: "Mapeamento de categoria",
  grouping_rule: "Regra de agrupamento",
  variation_rule: "Regra de variação",
  image_association_rule: "Associação de imagem",
  language_pattern: "Padrão de idioma",
  supplier_rule: "Regra de fornecedor",
  pdf_section_rule: "Regra de secção PDF",
};

const sourceTypeLabels: Record<string, string> = {
  ai_inferred: "IA",
  human_confirmed: "Humano",
  import_observed: "Importação",
  publish_validated: "Publicação",
  system_generated: "Sistema",
};

const normTypeLabels: Record<string, string> = {
  unit: "Unidade",
  material: "Material",
  color: "Cor",
  category: "Categoria",
  attribute_name: "Nome de atributo",
  attribute_value: "Valor de atributo",
  product_family: "Família de produto",
  brand_alias: "Alias de marca",
};

export default function ExtractionMemoryPage() {
  const [activeTab, setActiveTab] = useState("insights");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Extraction Memory Engine</h1>
        <p className="text-muted-foreground">Motor de memória acumulada — padrões, normalizações, correções e decisões</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="insights"><BarChart3 className="h-4 w-4 mr-1" /> Insights</TabsTrigger>
          <TabsTrigger value="patterns"><Brain className="h-4 w-4 mr-1" /> Padrões</TabsTrigger>
          <TabsTrigger value="normalization"><BookOpen className="h-4 w-4 mr-1" /> Normalização</TabsTrigger>
          <TabsTrigger value="corrections"><Users className="h-4 w-4 mr-1" /> Correções</TabsTrigger>
          <TabsTrigger value="decisions"><Zap className="h-4 w-4 mr-1" /> Decisões</TabsTrigger>
        </TabsList>

        <TabsContent value="insights"><InsightsPanel /></TabsContent>
        <TabsContent value="patterns"><PatternsPanel /></TabsContent>
        <TabsContent value="normalization"><NormalizationPanel /></TabsContent>
        <TabsContent value="corrections"><CorrectionsPanel /></TabsContent>
        <TabsContent value="decisions"><DecisionsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

function InsightsPanel() {
  const { data: insights, isLoading } = useMemoryInsights();

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!insights) return <p className="text-muted-foreground text-center py-8">Sem dados de memória ainda</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Padrões Totais</p>
            <p className="text-3xl font-bold text-foreground">{insights.totalPatterns}</p>
            <div className="flex gap-2 mt-1">
              <Badge variant="secondary" className="text-xs"><Brain className="h-3 w-3 mr-1" />{insights.aiPatterns} IA</Badge>
              <Badge variant="outline" className="text-xs"><Users className="h-3 w-3 mr-1" />{insights.humanPatterns} Humano</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Confiança Média</p>
            <p className="text-3xl font-bold text-foreground">{insights.avgConfidence}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Correções Humanas</p>
            <p className="text-3xl font-bold text-foreground">{insights.totalCorrections}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Normalizações</p>
            <p className="text-3xl font-bold text-foreground">{insights.totalNormalizations}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Top Padrões (por uso)</CardTitle></CardHeader>
          <CardContent>
            {insights.topPatterns.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum padrão ainda</p>
            ) : (
              <div className="space-y-2">
                {insights.topPatterns.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between text-xs border-b border-border pb-1">
                    <div>
                      <span className="font-medium">{patternTypeLabels[p.pattern_type] || p.pattern_type}</span>
                      {p.supplier_name && <span className="text-muted-foreground ml-1">({p.supplier_name})</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{p.usage_count}×</span>
                      <ConfidenceIndicator score={p.confidence} size="sm" />
                      <span className="text-primary">{p.success_count}✓</span>
                      {p.failure_count > 0 && <span className="text-destructive">{p.failure_count}✗</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Padrões com Baixa Precisão</CardTitle></CardHeader>
          <CardContent>
            {insights.lowConfidence.length === 0 ? (
              <p className="text-xs text-muted-foreground">Todos os padrões têm boa precisão</p>
            ) : (
              <div className="space-y-2">
                {insights.lowConfidence.slice(0, 10).map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between text-xs border-b border-border pb-1">
                    <span>{patternTypeLabels[p.pattern_type] || p.pattern_type}</span>
                    <div className="flex items-center gap-2">
                      <ConfidenceIndicator score={p.confidence} size="sm" />
                      <span className="text-destructive">{p.failure_count} falhas</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {insights.suppliers.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Fornecedores com Memória</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {insights.suppliers.map((s: string) => (
                <Badge key={s} variant="outline">{s}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PatternsPanel() {
  const { data: patterns, isLoading } = useMemoryPatterns();

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Padrões de Extração ({(patterns || []).length})</CardTitle></CardHeader>
      <CardContent>
        <ScrollArea className="h-[60vh]">
          {(!patterns || patterns.length === 0) ? (
            <p className="text-muted-foreground text-center py-8">Nenhum padrão aprendido ainda. Execute extrações e revisões para começar.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Chave</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Confiança</TableHead>
                  <TableHead>Uso</TableHead>
                  <TableHead>Sucesso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patterns.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs">
                      <Badge variant="outline" className="text-xs">{patternTypeLabels[p.pattern_type] || p.pattern_type}</Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{p.pattern_key}</TableCell>
                    <TableCell className="text-xs">{p.supplier_name || "—"}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="secondary" className="text-xs">{sourceTypeLabels[p.source_type] || p.source_type}</Badge>
                    </TableCell>
                    <TableCell><ConfidenceIndicator score={p.confidence} size="sm" /></TableCell>
                    <TableCell className="text-xs">{p.usage_count}</TableCell>
                    <TableCell className="text-xs">
                      <span className="text-primary">{p.success_count}✓</span>
                      {p.failure_count > 0 && <span className="text-destructive ml-1">{p.failure_count}✗</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function NormalizationPanel() {
  const { data: entries, isLoading } = useNormalizationDictionary();
  const addNorm = useAddNormalization();
  const deleteNorm = useDeleteNormalization();
  const [showAdd, setShowAdd] = useState(false);
  const [newEntry, setNewEntry] = useState({ dictionary_type: "unit", source_term: "", normalized_term: "", supplier_name: "" });

  const handleAdd = () => {
    if (!newEntry.source_term || !newEntry.normalized_term) return;
    addNorm.mutate({
      dictionary_type: newEntry.dictionary_type,
      source_term: newEntry.source_term,
      normalized_term: newEntry.normalized_term,
      supplier_name: newEntry.supplier_name || undefined,
    }, {
      onSuccess: () => {
        setShowAdd(false);
        setNewEntry({ dictionary_type: "unit", source_term: "", normalized_term: "", supplier_name: "" });
      },
    });
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Dicionário de Normalização ({(entries || []).length})</CardTitle>
          <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="h-3 w-3 mr-1" /> Adicionar</Button>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[60vh]">
          {(!entries || entries.length === 0) ? (
            <p className="text-muted-foreground text-center py-8">Nenhuma normalização definida</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Termo Original</TableHead>
                  <TableHead>→</TableHead>
                  <TableHead>Normalizado</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Confiança</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e: any) => (
                  <TableRow key={e.id}>
                    <TableCell><Badge variant="outline" className="text-xs">{normTypeLabels[e.dictionary_type] || e.dictionary_type}</Badge></TableCell>
                    <TableCell className="text-xs font-mono">{e.source_term}</TableCell>
                    <TableCell className="text-xs">→</TableCell>
                    <TableCell className="text-xs font-medium">{e.normalized_term}</TableCell>
                    <TableCell className="text-xs">{e.supplier_name || "—"}</TableCell>
                    <TableCell><ConfidenceIndicator score={e.confidence} size="sm" /></TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => deleteNorm.mutate(e.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </CardContent>

      {showAdd && (
        <Dialog open onOpenChange={() => setShowAdd(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Adicionar Normalização</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Select value={newEntry.dictionary_type} onValueChange={(v) => setNewEntry(p => ({ ...p, dictionary_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(normTypeLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="Termo original (ex: Inox 18/10)" value={newEntry.source_term} onChange={e => setNewEntry(p => ({ ...p, source_term: e.target.value }))} />
              <Input placeholder="Normalizado (ex: Aço Inoxidável 18/10)" value={newEntry.normalized_term} onChange={e => setNewEntry(p => ({ ...p, normalized_term: e.target.value }))} />
              <Input placeholder="Fornecedor (opcional)" value={newEntry.supplier_name} onChange={e => setNewEntry(p => ({ ...p, supplier_name: e.target.value }))} />
            </div>
            <DialogFooter>
              <Button onClick={handleAdd} disabled={addNorm.isPending}>
                {addNorm.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                Adicionar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

function CorrectionsPanel() {
  const { data: corrections, isLoading } = useExtractionCorrections();

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Correções Humanas ({(corrections || []).length})</CardTitle></CardHeader>
      <CardContent>
        <ScrollArea className="h-[60vh]">
          {(!corrections || corrections.length === 0) ? (
            <p className="text-muted-foreground text-center py-8">Nenhuma correção registada. As correções são guardadas automaticamente durante a revisão.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campo</TableHead>
                  <TableHead>Valor Original</TableHead>
                  <TableHead>→</TableHead>
                  <TableHead>Corrigido</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {corrections.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-xs font-mono">{c.field_key}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.raw_value || "—"}</TableCell>
                    <TableCell className="text-xs">→</TableCell>
                    <TableCell className="text-xs font-medium">{c.corrected_value || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{c.correction_type}</Badge></TableCell>
                    <TableCell className="text-xs">{new Date(c.created_at).toLocaleDateString("pt-PT")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function DecisionsPanel() {
  const { data: decisions, isLoading } = useDecisionHistory();

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Histórico de Decisões ({(decisions || []).length})</CardTitle></CardHeader>
      <CardContent>
        <ScrollArea className="h-[60vh]">
          {(!decisions || decisions.length === 0) ? (
            <p className="text-muted-foreground text-center py-8">Nenhuma decisão registada ainda</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Input</TableHead>
                  <TableHead>Output</TableHead>
                  <TableHead>Confiança</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decisions.map((d: any) => (
                  <TableRow key={d.id}>
                    <TableCell><Badge variant="outline" className="text-xs">{d.decision_type}</Badge></TableCell>
                    <TableCell className="text-xs max-w-[150px] truncate">{JSON.stringify(d.input_signature)}</TableCell>
                    <TableCell className="text-xs max-w-[150px] truncate">{JSON.stringify(d.decision_output)}</TableCell>
                    <TableCell><ConfidenceIndicator score={d.confidence} size="sm" /></TableCell>
                    <TableCell>
                      {d.approved ? (
                        <Badge className="text-xs bg-primary/10 text-primary"><CheckCircle className="h-3 w-3 mr-1" /> Aprovado</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Pendente</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{new Date(d.created_at).toLocaleDateString("pt-PT")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
