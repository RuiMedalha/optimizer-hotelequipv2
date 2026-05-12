import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSupplierIntelligence, useSupplierDetail } from "@/hooks/useSupplierIntelligence";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Building2, Globe, CheckCircle, AlertCircle, Clock, ArrowLeft, Brain, Search, Network, BarChart3, ArrowRight, Wand2, Copy, Save, Check, Loader2, Sparkles, FileText, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { 
  generateAiPrompt, 
  applyConnectorTransformations, 
  CONNECTOR_PRESETS,
  detectCsvDelimiter,
  type ConnectorConfig,
  type XmlFormat
} from '@/lib/supplierConnector';

import { SupplierHealthCards } from "@/components/supplier/SupplierHealthCards";
import { SupplierTable } from "@/components/supplier/SupplierTable";
import { SupplierImportHistory } from "@/components/supplier/SupplierImportHistory";
import { SupplierDataQualityPanel } from "@/components/supplier/SupplierDataQualityPanel";
import { SupplierParsingIssues } from "@/components/supplier/SupplierParsingIssues";
import { SupplierChangeFeed } from "@/components/supplier/SupplierChangeFeed";

// --- Supplier Detail View (existing, enhanced) ---
function SupplierDetail({ supplier, onBack }: { supplier: any; onBack: () => void }) {
  const { learnPatterns, calculateQuality, buildKnowledgeGraph, updateSupplier, wsId } = useSupplierIntelligence();
  const detail = useSupplierDetail(supplier.id);

  const [feedUrlXml, setFeedUrlXml] = useState(supplier?.feed_url_xml || '');
  const [feedUrlCsv, setFeedUrlCsv] = useState(supplier?.feed_url_csv || '');
  const [feedTestResult, setFeedTestResult] = useState<any>(null);
  const [connectorConfigText, setConnectorConfigText] = useState(
    supplier?.connector_config ? JSON.stringify(supplier.connector_config, null, 2) : ''
  );

  const { data: suppliersWithConfig } = useQuery({
    queryKey: ['suppliers-with-config', wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplier_profiles')
        .select('id, supplier_name, connector_config')
        .neq('connector_config', null)
        .eq('workspace_id', wsId);
      if (error) throw error;
      return data as any[];
    }
  });

  const [configError, setConfigError] = useState<string | null>(null);
  const [connectorTestResult, setConnectorTestResult] = useState<any[]>([]);
  const [showAiPromptModal, setShowAiPromptModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [testingUrl, setTestingUrl] = useState(false);

  const handleTestUrl = (format: 'xml' | 'csv') => async () => {
    const directUrl = format === 'csv' ? feedUrlCsv : feedUrlXml;
    if (!directUrl) {
      toast.error(`Configura primeiro o URL ${format.toUpperCase()} antes de testar.`);
      return;
    }
    setTestingUrl(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-supplier-feed', {
        body: { supplierId: supplier.id, workspaceId: wsId, format, feedUrl: directUrl }
      });
      if (error) throw error;
      setFeedTestResult(data);
      toast.success(`Feed carregado: ${data.totalRows} produtos`);
    } catch (e: any) {
      toast.error(`Erro ao testar URL: ${e.message}`);
    } finally {
      setTestingUrl(false);
    }
  };

  const handlePresetSelect = (val: string) => {
    // If it starts with "saved:", it's a dynamic supplier config
    if (val.startsWith('saved:')) {
      const supplierId = val.split(':')[1];
      const savedSupplier = suppliersWithConfig?.find(s => s.id === supplierId);
      if (savedSupplier?.connector_config) {
        setConnectorConfigText(JSON.stringify(savedSupplier.connector_config, null, 2));
        setConfigError(null);
        toast.info(`Configuração de ${savedSupplier.supplier_name} aplicada.`);
      }
      return;
    }

    const config = CONNECTOR_PRESETS[val] || {};
    setConnectorConfigText(JSON.stringify(config, null, 2));
    setConfigError(null);
    if (val === 'tefcold_xml') {
      toast.info('Preset aplicado. Clica Guardar para actualizar o connector do fornecedor.');
    }
  };

  const handleValidateConfig = () => {
    try {
      JSON.parse(connectorConfigText);
      setConfigError(null);
      toast.success('JSON válido');
    } catch (e: any) {
      setConfigError(`JSON inválido: ${e.message}`);
    }
  };

  const handleTestConnector = async () => {
    try {
      const config = JSON.parse(connectorConfigText);
      const rows = feedTestResult?.rows || feedTestResult?.allRows || [];
      const format = feedTestResult?.format || 'xml';
      
      let finalRows = rows;
      if (format === 'csv' && feedTestResult?.rawText) {
        const { default: Papa } = await import('papaparse');
        const autoDelimiter = detectCsvDelimiter(feedTestResult.rawText);
        const delimiter = config.csv_delimiter || autoDelimiter;
        
        const parsed = Papa.parse(feedTestResult.rawText, {
          delimiter,
          header: true,
          skipEmptyLines: true
        });
        finalRows = parsed.data;
      }
      
      const transformed = applyConnectorTransformations(finalRows, config, format);
      setConnectorTestResult(transformed.slice(0, 3));
      toast.success('Connector testado com sucesso');
    } catch (e: any) {
      toast.error(`Erro ao testar connector: ${e.message}`);
    }
  };

  const handleSaveConnector = async () => {
    try {
      const config = connectorConfigText ? JSON.parse(connectorConfigText) : {};
      await updateSupplier.mutateAsync({
        id: supplier.id,
        feed_url_xml: feedUrlXml || null,
        feed_url_csv: feedUrlCsv || null,
        connector_config: config
      });
    } catch (e: any) {
      toast.error(`Erro ao guardar: ${e.message}`);
    }
  };

  const avgConfidence = detail.benchmarks.data?.length
    ? (detail.benchmarks.data.reduce((s: number, b: any) => s + (b.average_confidence || 0), 0) / detail.benchmarks.data.length).toFixed(2)
    : "—";
  const avgCost = detail.benchmarks.data?.length
    ? (detail.benchmarks.data.reduce((s: number, b: any) => s + (b.average_cost || 0), 0) / detail.benchmarks.data.length).toFixed(4)
    : "—";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button>
        <h2 className="text-xl font-bold">{supplier.supplier_name}</h2>
        <Badge variant={supplier.is_active ? "default" : "secondary"}>{supplier.is_active ? "Ativo" : "Inativo"}</Badge>
        <div className="ml-auto flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => learnPatterns.mutate(supplier.id)} disabled={learnPatterns.isPending}>
            <Brain className="h-4 w-4 mr-1" />{learnPatterns.isPending ? "A aprender..." : "Aprender Padrões"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => calculateQuality.mutate(supplier.id)} disabled={calculateQuality.isPending}>
            <BarChart3 className="h-4 w-4 mr-1" />{calculateQuality.isPending ? "A calcular..." : "Calcular Qualidade"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => buildKnowledgeGraph.mutate(supplier.id)} disabled={buildKnowledgeGraph.isPending}>
            <Network className="h-4 w-4 mr-1" />{buildKnowledgeGraph.isPending ? "A construir..." : "Knowledge Graph"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold">{avgConfidence}</p><p className="text-xs text-muted-foreground">Confiança Média</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold">€{avgCost}</p><p className="text-xs text-muted-foreground">Custo Médio</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold">{detail.benchmarks.data?.length || 0}</p><p className="text-xs text-muted-foreground">Execuções</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold">{detail.patterns.data?.length || 0}</p><p className="text-xs text-muted-foreground">Padrões</p></CardContent></Card>
      </div>

      <Tabs defaultValue="schemas">
        <TabsList className="flex-wrap">
          <TabsTrigger value="schemas">Estrutura</TabsTrigger>
          <TabsTrigger value="feed">Feed & Connector</TabsTrigger>
          <TabsTrigger value="patterns">Padrões</TabsTrigger>
          <TabsTrigger value="mappings">Mapeamentos</TabsTrigger>
          <TabsTrigger value="publishability">Publicabilidade</TabsTrigger>
          <TabsTrigger value="graph">Knowledge Graph</TabsTrigger>
          <TabsTrigger value="sources">Fontes</TabsTrigger>
          <TabsTrigger value="trust">Trust Matrix</TabsTrigger>
          <TabsTrigger value="matching">Matching</TabsTrigger>
          <TabsTrigger value="learning">Learning</TabsTrigger>
          <TabsTrigger value="benchmarks">Benchmarks</TabsTrigger>
        </TabsList>

        <TabsContent value="feed">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">URLs do Feed</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Feed XML</Label>
                  <div className="flex gap-2">
                    <Input
                      value={feedUrlXml}
                      onChange={e => setFeedUrlXml(e.target.value)}
                      placeholder="https://feedapi.supplier.com/feed.xml?Key=..."
                      className="flex-1"
                    />
                    <Button variant="outline" onClick={handleTestUrl('xml')} disabled={!feedUrlXml || testingUrl}>
                      {testingUrl ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Testar'}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Feed CSV</Label>
                  <div className="flex gap-2">
                    <Input
                      value={feedUrlCsv}
                      onChange={e => setFeedUrlCsv(e.target.value)}
                      placeholder="https://feedapi.supplier.com/feed.csv?Key=..."
                      className="flex-1"
                    />
                    <Button variant="outline" onClick={handleTestUrl('csv')} disabled={!feedUrlCsv || testingUrl}>
                      {testingUrl ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Testar'}
                    </Button>
                  </div>
                </div>
                {feedTestResult && (
                  <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-sm">
                    <p className="font-medium text-green-400">✓ {feedTestResult.totalRows} produtos — formato: {feedTestResult.xmlFormat || feedTestResult.format}</p>
                    <pre className="mt-2 text-xs overflow-auto max-h-32 text-muted-foreground">
                      {JSON.stringify(feedTestResult.rows?.[0], null, 2)?.substring(0, 500)}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center justify-between">
                  Connector Config
                  <Select onValueChange={handlePresetSelect}>
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder="Aplicar Preset..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tefcold_xml">Tefcold (XML proprietário)</SelectItem>
                      <SelectItem value="fricosmos_xml">Fricosmos / Google Merchant (XML)</SelectItem>
                      <SelectItem value="fricosmos_excel_prices">Fricosmos (Excel — só preços)</SelectItem>
                      
                      {suppliersWithConfig && suppliersWithConfig.length > 0 && (
                        <>
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1">
                            Fornecedores guardados
                          </div>
                          {suppliersWithConfig.map((s) => (
                            <SelectItem key={s.id} value={`saved:${s.id}`}>
                              {s.supplier_name} (config guardado)
                            </SelectItem>
                          ))}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={connectorConfigText}
                  onChange={e => { setConnectorConfigText(e.target.value); setConfigError(null); }}
                  placeholder='{ "file_format": "xml", "sku_prefix": "TF", ... }'
                  className="font-mono text-xs min-h-64"
                />
                {configError && <p className="text-sm text-red-400">{configError}</p>}
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" onClick={handleValidateConfig}>Validar JSON</Button>
                  <Button variant="outline" onClick={handleTestConnector} disabled={!feedTestResult}>Testar Connector</Button>
                  { (feedUrlCsv || feedUrlXml) && (
                    <Button 
                      variant="outline" 
                      disabled={testingUrl}
                      onClick={async () => {
                        const format = feedUrlCsv ? 'csv' : 'xml';
                        const url = format === 'csv' ? feedUrlCsv : feedUrlXml;
                        
                        setTestingUrl(true);
                        try {
                          const { data: feedData, error } = await supabase.functions.invoke('fetch-supplier-feed', {
                            body: { supplierId: supplier.id, workspaceId: wsId, format, feedUrl: url }
                          });
                          
                          if (error) throw error;
                          
                          let rows = feedData.rows || feedData.allRows || [];
                          let headers = [];
                          
                          if (format === 'csv' && feedData.rawText) {
                            const { default: Papa } = await import('papaparse');
                            let config;
                            try {
                              config = JSON.parse(connectorConfigText);
                            } catch (e) {
                              config = {};
                            }
                            const autoDelimiter = detectCsvDelimiter(feedData.rawText);
                            const delimiter = config.csv_delimiter || autoDelimiter;
                            
                            const parsed = Papa.parse(feedData.rawText, {
                              delimiter,
                              header: true,
                              skipEmptyLines: true
                            });
                            rows = parsed.data;
                          }
                          
                          headers = rows[0] ? Object.keys(rows[0]).filter((k: string) => !k.startsWith('_')) : [];
                          
                          const prompt = generateAiPrompt(rows, headers, feedData.format || format, feedData.xmlFormat);
                          setAiPrompt(prompt);
                          setShowAiPromptModal(true);
                          toast.success("Análise do feed concluída. Prompt gerado.");
                        } catch (e: any) {
                          toast.error(`Erro ao analisar feed para o prompt: ${e.message}`);
                        } finally {
                          setTestingUrl(false);
                        }
                      }}>
                      {testingUrl ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Wand2 className="w-4 h-4 mr-2" />}
                      Gerar Prompt para IA
                    </Button>
                  )}
                  <Button onClick={handleSaveConnector}>
                    <Save className="w-4 h-4 mr-2" />
                    Guardar
                  </Button>
                </div>
                {connectorTestResult.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Preview (3 produtos transformados):</p>
                    <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-48">
                      {JSON.stringify(connectorTestResult, null, 2)}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
            <AiPromptModal 
              isOpen={showAiPromptModal} 
              onClose={() => setShowAiPromptModal(false)} 
              prompt={aiPrompt} 
              supplierId={supplier.id}
              onApply={(config) => {
                setConnectorConfigText(JSON.stringify(config, null, 2));
              }}
            />
          </div>
        </TabsContent>

        <TabsContent value="schemas">
          <Card><CardHeader><CardTitle className="text-sm">Estruturas Detetadas</CardTitle></CardHeader><CardContent>
            {detail.schemaProfiles.data?.length ? (
              <div className="space-y-4">
                {detail.schemaProfiles.data.map((sp: any) => (
                  <div key={sp.id} className="border rounded p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline">{sp.file_type}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(sp.created_at).toLocaleDateString("pt-PT")}</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                      <div><span className="text-muted-foreground">SKU:</span> <span className="font-medium">{sp.sku_column || "—"}</span></div>
                      <div><span className="text-muted-foreground">Preço:</span> <span className="font-medium">{sp.price_column || "—"}</span></div>
                      <div><span className="text-muted-foreground">Nome:</span> <span className="font-medium">{sp.name_column || "—"}</span></div>
                      <div><span className="text-muted-foreground">EAN:</span> <span className="font-medium">{sp.ean_column || "—"}</span></div>
                      <div><span className="text-muted-foreground">Imagem:</span> <span className="font-medium">{sp.image_column || "—"}</span></div>
                      <div><span className="text-muted-foreground">Confiança:</span> <span className="font-medium">{Math.round(sp.detection_confidence * 100)}%</span></div>
                    </div>
                    {sp.attribute_columns?.length > 0 && (
                      <div className="flex flex-wrap gap-1">{sp.attribute_columns.map((a: string) => <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>)}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">Nenhuma estrutura detetada.</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="patterns">
          <Card><CardHeader><CardTitle className="text-sm">Padrões Aprendidos</CardTitle></CardHeader><CardContent>
            {detail.patterns.data?.length ? (
              <Table><TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Chave</TableHead><TableHead>Ocorrências</TableHead><TableHead>Confiança</TableHead></TableRow></TableHeader>
                <TableBody>{detail.patterns.data.map((p: any) => (
                  <TableRow key={p.id}><TableCell><Badge variant="outline">{p.pattern_type}</Badge></TableCell><TableCell className="font-medium">{p.pattern_key}</TableCell><TableCell>{p.occurrences}</TableCell><TableCell>{Math.round(p.confidence * 100)}%</TableCell></TableRow>
                ))}</TableBody></Table>
            ) : <p className="text-sm text-muted-foreground">Sem padrões. Clique "Aprender Padrões".</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="mappings">
          <Card><CardHeader><CardTitle className="text-sm">Sugestões de Mapeamento</CardTitle></CardHeader><CardContent>
            {detail.mappingSuggestions.data?.length ? (
              <Table><TableHeader><TableRow><TableHead>Coluna</TableHead><TableHead /><TableHead>Campo</TableHead><TableHead>Confiança</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader>
                <TableBody>{detail.mappingSuggestions.data.map((m: any) => (
                  <TableRow key={m.id}><TableCell className="font-mono text-sm">{m.source_column}</TableCell><TableCell><ArrowRight className="h-3 w-3 text-muted-foreground" /></TableCell><TableCell><Badge variant="outline">{m.suggested_field}</Badge></TableCell><TableCell>{Math.round(m.confidence * 100)}%</TableCell>
                    <TableCell>{m.accepted === true ? <Badge variant="default">Aceite</Badge> : m.accepted === false ? <Badge variant="destructive">Rejeitado</Badge> : <Badge variant="secondary">Pendente</Badge>}</TableCell>
                  </TableRow>
                ))}</TableBody></Table>
            ) : <p className="text-sm text-muted-foreground">Sem sugestões.</p>}
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="publishability">
          <SupplierPublishabilityPanel supplier={supplier} workspaceId={wsId} />
        </TabsContent>

        <TabsContent value="graph">
          <Card><CardHeader><CardTitle className="text-sm">Knowledge Graph</CardTitle></CardHeader><CardContent>
            {detail.knowledgeGraph.data?.length ? (
              <div className="space-y-2">{detail.knowledgeGraph.data.map((edge: any) => (
                <div key={edge.id} className="flex items-center gap-2 p-2 border rounded text-sm">
                  <Badge variant="outline">{edge.node_type}</Badge><span className="font-medium">{edge.node_label}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" /><Badge variant="secondary">{edge.relationship_type}</Badge>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" /><Badge variant="outline">{edge.related_node_type}</Badge><span className="font-medium">{edge.related_node_label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{Math.round(edge.weight * 100)}%</span>
                </div>
              ))}</div>
            ) : <p className="text-sm text-muted-foreground">Sem ligações. Clique "Knowledge Graph".</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="sources">
          <Card><CardHeader><CardTitle className="text-sm">Source Profiles</CardTitle></CardHeader><CardContent>
            {detail.sourceProfiles.data?.length ? (
              <Table><TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Papel</TableHead><TableHead>Fiabilidade</TableHead><TableHead>Prioridade</TableHead></TableRow></TableHeader>
                <TableBody>{detail.sourceProfiles.data.map((sp: any) => (
                  <TableRow key={sp.id}><TableCell><Badge variant="outline">{sp.source_type}</Badge></TableCell><TableCell>{sp.source_role}</TableCell><TableCell>{(sp.reliability_score * 100).toFixed(0)}%</TableCell><TableCell>{sp.priority_rank}</TableCell></TableRow>
                ))}</TableBody></Table>
            ) : <p className="text-sm text-muted-foreground">Sem source profiles.</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="trust">
          <Card><CardHeader><CardTitle className="text-sm">Field Trust Rules</CardTitle></CardHeader><CardContent>
            {detail.fieldTrust.data?.length ? (
              <Table><TableHeader><TableRow><TableHead>Campo</TableHead><TableHead>Primária</TableHead><TableHead>Secundária</TableHead><TableHead>Trust</TableHead><TableHead>Conflito</TableHead></TableRow></TableHeader>
                <TableBody>{detail.fieldTrust.data.map((ft: any) => (
                  <TableRow key={ft.id}><TableCell className="font-medium">{ft.field_name}</TableCell><TableCell>{ft.primary_source_type}</TableCell><TableCell>{ft.secondary_source_type || "—"}</TableCell><TableCell>{(ft.trust_score * 100).toFixed(0)}%</TableCell><TableCell>{ft.conflict_strategy}</TableCell></TableRow>
                ))}</TableBody></Table>
            ) : <p className="text-sm text-muted-foreground">Sem regras de confiança.</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="matching">
          <Card><CardHeader><CardTitle className="text-sm">Matching Rules</CardTitle></CardHeader><CardContent>
            {detail.matchingRules.data?.length ? (
              <Table><TableHeader><TableRow><TableHead>Regra</TableHead><TableHead>Tipo</TableHead><TableHead>Peso</TableHead><TableHead>Ativo</TableHead></TableRow></TableHeader>
                <TableBody>{detail.matchingRules.data.map((mr: any) => (
                  <TableRow key={mr.id}><TableCell>{mr.rule_name}</TableCell><TableCell><Badge variant="outline">{mr.match_type}</Badge></TableCell><TableCell>{mr.rule_weight}</TableCell><TableCell>{mr.is_active ? <CheckCircle className="h-4 w-4 text-primary" /> : <AlertCircle className="h-4 w-4 text-muted-foreground" />}</TableCell></TableRow>
                ))}</TableBody></Table>
            ) : <p className="text-sm text-muted-foreground">Sem regras de matching.</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="learning">
          <Card><CardHeader><CardTitle className="text-sm">Learning Timeline</CardTitle></CardHeader><CardContent>
            {detail.learningEvents.data?.length ? (
              <div className="space-y-2 max-h-96 overflow-y-auto">{detail.learningEvents.data.map((ev: any) => (
                <div key={ev.id} className="flex items-start gap-3 p-2 rounded border">
                  <Clock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><span className="text-sm font-medium">{ev.event_type}</span><Badge variant={ev.outcome === "success" || ev.outcome === "confirmed" ? "default" : "destructive"} className="text-xs">{ev.outcome}</Badge></div>
                    <p className="text-xs text-muted-foreground">{new Date(ev.created_at).toLocaleString("pt-PT")}</p>
                  </div>
                </div>
              ))}</div>
            ) : <p className="text-sm text-muted-foreground">Sem eventos.</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="benchmarks">
          <Card><CardHeader><CardTitle className="text-sm">Benchmarks</CardTitle></CardHeader><CardContent>
            {detail.benchmarks.data?.length ? (
              <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead>Rows</TableHead><TableHead>Matches</TableHead><TableHead>Conf.</TableHead><TableHead>Custo</TableHead><TableHead>Latência</TableHead></TableRow></TableHeader>
                <TableBody>{detail.benchmarks.data.map((b: any) => (
                  <TableRow key={b.id}><TableCell className="text-xs">{new Date(b.created_at).toLocaleDateString("pt-PT")}</TableCell><TableCell><Badge variant="outline">{b.source_type || "—"}</Badge></TableCell><TableCell>{b.rows_processed}</TableCell><TableCell>{b.successful_matches}</TableCell><TableCell>{(b.average_confidence * 100).toFixed(0)}%</TableCell><TableCell>€{b.average_cost?.toFixed(4)}</TableCell><TableCell>{b.average_latency_ms?.toFixed(0)}ms</TableCell></TableRow>
                ))}</TableBody></Table>
            ) : <p className="text-sm text-muted-foreground">Sem benchmarks.</p>}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Main Page ---
export default function SupplierIntelligencePage() {
  const { suppliers, qualityScores, createSupplier, wsId } = useSupplierIntelligence();
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [search, setSearch] = useState("");

  // Fetch benchmarks for import history
  const benchmarks = useQuery({
    queryKey: ["all-supplier-benchmarks", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_extraction_benchmarks") as any)
        .select("*, supplier_profiles!inner(supplier_name, workspace_id)")
        .eq("supplier_profiles.workspace_id", wsId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as any[];
    },
  });

  // Fetch conflict count
  const conflicts = useQuery({
    queryKey: ["open-conflicts-count", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { count, error } = await (supabase.from("conflict_cases") as any)
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", wsId)
        .eq("status", "open");
      if (error) throw error;
      return count || 0;
    },
  });

  // Fetch recent learning events as parsing issues proxy
  const learningIssues = useQuery({
    queryKey: ["supplier-learning-issues", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_learning_events") as any)
        .select("*, supplier_profiles!inner(supplier_name, workspace_id)")
        .eq("supplier_profiles.workspace_id", wsId)
        .in("outcome", ["failed", "error", "rejected"])
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as any[];
    },
  });

  const handleCreate = () => {
    if (!newName.trim()) return toast.error("Nome obrigatório");
    createSupplier.mutate(
      { supplier_name: newName, supplier_code: newCode || undefined, base_url: newUrl || undefined },
      { onSuccess: () => { setShowCreate(false); setNewName(""); setNewCode(""); setNewUrl(""); } }
    );
  };

  const getQualityScore = (supplierId: string) => qualityScores.data?.find((q: any) => q.supplier_id === supplierId);

  // Build table data
  const tableData = useMemo(() => {
    return (suppliers.data || [])
      .filter((s: any) => !search || s.supplier_name.toLowerCase().includes(search.toLowerCase()) || s.supplier_code?.toLowerCase().includes(search.toLowerCase()))
      .map((s: any) => {
        const qs = getQualityScore(s.id);
        const lastBench = benchmarks.data?.find((b: any) => b.supplier_id === s.id);
        return {
          id: s.id,
          supplier_name: s.supplier_name,
          is_active: s.is_active,
          total_products: qs?.total_products || 0,
          last_import_date: lastBench?.created_at || null,
          quality_score: qs?.overall_score ?? null,
          matching_rate: qs?.matching_accuracy ?? null,
          conflict_rate: qs?.conflict_rate ?? null,
        };
      });
  }, [suppliers.data, qualityScores.data, benchmarks.data, search]);

  // Import history data
  const importHistory = useMemo(() => {
    return (benchmarks.data || []).map((b: any) => ({
      id: b.id,
      supplier_name: b.supplier_profiles?.supplier_name || "—",
      created_at: b.created_at,
      rows_processed: b.rows_processed || 0,
      successful_matches: b.successful_matches || 0,
      manual_reviews: b.manual_reviews || 0,
      source_type: b.source_type,
      average_confidence: b.average_confidence || 0,
    }));
  }, [benchmarks.data]);

  // Quality panel data
  const qualityMetrics = useMemo(() => {
    return (qualityScores.data || []).map((q: any) => {
      const s = suppliers.data?.find((s: any) => s.id === q.supplier_id);
      return { supplier_name: s?.supplier_name || "—", supplier_id: q.supplier_id, ...q };
    });
  }, [qualityScores.data, suppliers.data]);

  // Parsing issues data
  const parsingIssues = useMemo(() => {
    return (learningIssues.data || []).map((ev: any) => ({
      id: ev.id,
      supplier_name: ev.supplier_profiles?.supplier_name || "—",
      product_ref: ev.event_type || "—",
      error_type: ev.outcome,
      error_description: JSON.stringify(ev.event_payload || {}),
      timestamp: ev.created_at,
    }));
  }, [learningIssues.data]);

  // KPIs
  const activeSuppliers = suppliers.data?.filter((s: any) => s.is_active).length || 0;
  const totalProducts = qualityScores.data?.reduce((s: number, q: any) => s + (q.total_products || 0), 0) || 0;
  const avgQuality = qualityScores.data?.length
    ? qualityScores.data.reduce((s: number, q: any) => s + (q.overall_score || 0), 0) / qualityScores.data.length : 0;

  if (selectedSupplier) {
    return (
      <div className="p-6 space-y-4">
        <SupplierDetail supplier={selectedSupplier} onBack={() => setSelectedSupplier(null)} />
      </div>
    );
  }

  const handleViewSupplier = (id: string) => {
    const s = suppliers.data?.find((s: any) => s.id === id);
    if (s) setSelectedSupplier(s);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="h-6 w-6" />Supplier Intelligence</h1>
          <p className="text-sm text-muted-foreground">Dashboard operacional de fornecedores, ingestões e qualidade</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Novo Fornecedor</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo Fornecedor</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Nome *</Label><Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome do fornecedor" /></div>
              <div><Label>Código</Label><Input value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="Código interno" /></div>
              <div><Label>URL Base</Label><Input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://fornecedor.com" /></div>
              <Button onClick={handleCreate} disabled={createSupplier.isPending} className="w-full">{createSupplier.isPending ? "A criar..." : "Criar Fornecedor"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Health KPIs */}
      <SupplierHealthCards activeSuppliers={activeSuppliers} totalProducts={totalProducts} avgQuality={avgQuality} openConflicts={conflicts.data || 0} />

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Pesquisar fornecedor..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="suppliers">
        <TabsList>
          <TabsTrigger value="suppliers">Fornecedores</TabsTrigger>
          <TabsTrigger value="imports">Importações</TabsTrigger>
          <TabsTrigger value="quality">Qualidade</TabsTrigger>
          <TabsTrigger value="issues">Parsing Issues</TabsTrigger>
          <TabsTrigger value="changes">Alterações</TabsTrigger>
        </TabsList>

        <TabsContent value="suppliers" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              <SupplierTable suppliers={tableData} onView={handleViewSupplier} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="imports" className="mt-4">
          <SupplierImportHistory imports={importHistory} />
        </TabsContent>

        <TabsContent value="quality" className="mt-4">
          <SupplierDataQualityPanel metrics={qualityMetrics} />
        </TabsContent>

        <TabsContent value="issues" className="mt-4">
          <SupplierParsingIssues issues={parsingIssues} />
        </TabsContent>

        <TabsContent value="changes" className="mt-4">
          <SupplierChangeFeed changes={[]} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SupplierPublishabilityPanel({ supplier, workspaceId }: { supplier: any; workspaceId: string }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rulesSaved, setRulesSaved] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadingExcel, setUploadingExcel] = useState(false);
  const [generatingStatus, setGeneratingStatus] = useState<string | null>(null);
  const [excelSource, setExcelSource] = useState<string | null>(null);
  const queryClient = useQueryClient();
  
  const [rules, setRules] = useState<any>(supplier.publishability_rules || {
    power_words: [],
    stop_words: [],
    strategic_categories: [],
    skip_categories: [],
    sku_publish_patterns: [],
    min_price_skip: 5,
    min_price_review: 15,
    min_price_spare_parts: 50,
    notes: ''
  });

  const { data: sourcesStatus } = useQuery({
    queryKey: ['supplier-sources-status', supplier.id],
    queryFn: async () => {
      const feed = !!supplier.feed_url_xml || !!supplier.feed_url_csv;
      
      const { data: pdfs } = await (supabase
        .from('uploaded_files') as any)
        .select('id')
        .eq('supplier_id', supplier.id)
        .eq('file_type', 'knowledge')
        .limit(1);

      const { data: chunks } = await (supabase
        .from('knowledge_chunks') as any)
        .select('id')
        .eq('supplier_id', supplier.id)
        .limit(1);
        
      const { data: excel } = await (supabase
        .from('uploaded_files') as any)
        .select('id')
        .eq('file_type', 'products')
        .eq('supplier_id', supplier.id)
        .limit(1);
        
      const { data: scraping } = await (supabase
        .from('website_extraction_runs') as any)
        .select('id')
        .eq('supplier_id', supplier.id)
        .limit(1);

      return {
        feed,
        pdf: (pdfs?.length || 0) > 0,
        pdfIndexed: (chunks?.length || 0) > 0,
        excel: (excel?.length || 0) > 0,
        website: (scraping?.length || 0) > 0
      };
    }
  });

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploadingPdf(true);
    try {
      const filePath = `${workspaceId}/${supplier.id}/${file.name}`;
      
      const { error: uploadError } = await supabase.storage
        .from('knowledge-base')
        .upload(filePath, file, { upsert: true });
        
      if (uploadError) throw uploadError;
      
      const { data: { user } } = await supabase.auth.getUser();
      const { error: dbError } = await (supabase
        .from('uploaded_files') as any)
        .insert({
          workspace_id: workspaceId || supplier.workspace_id,
          supplier_id: supplier.id,
          user_id: user?.id,
          file_name: file.name,
          storage_path: filePath,
          file_type: 'knowledge',
          file_size: file.size,
          status: 'ready'
        });
        
      if (dbError) throw dbError;
      
      toast.success("PDF carregado. Vai ao Knowledge Graph para indexar o conteúdo.");
      queryClient.invalidateQueries({ queryKey: ['supplier-sources-status', supplier.id] });
    } catch (err: any) {
      toast.error(`Erro ao carregar PDF: ${err.message}`);
    } finally {
      setUploadingPdf(false);
    }
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploadingExcel(true);
    try {
      const filePath = `${workspaceId}/${supplier.id}/${file.name}`;
      
      const { error: uploadError } = await supabase.storage
        .from('knowledge-base')
        .upload(filePath, file, { upsert: true });
        
      if (uploadError) throw uploadError;
      
      const { data: { user } } = await supabase.auth.getUser();
      const { error: dbError } = await (supabase
        .from('uploaded_files') as any)
        .insert({
          workspace_id: workspaceId || supplier.workspace_id,
          supplier_id: supplier.id,
          user_id: user?.id,
          file_name: file.name,
          storage_path: filePath,
          file_type: 'products',
          file_size: file.size,
          status: 'ready'
        });
        
      if (dbError) throw dbError;
      
      toast.success("Excel carregado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ['supplier-sources-status', supplier.id] });
      queryClient.invalidateQueries({ queryKey: ['supplier-excel-files', supplier.id] });
    } catch (err: any) {
      toast.error(`Erro ao carregar Excel: ${err.message}`);
    } finally {
      setUploadingExcel(false);
    }
  };

  const { data: excelFilesList } = useQuery({
    queryKey: ['supplier-excel-files', supplier.id],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('uploaded_files') as any)
        .select('*')
        .eq('supplier_id', supplier.id)
        .eq('file_type', 'products')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  const handleSaveRules = async () => {
    try {
      const { error } = await (supabase
        .from('supplier_profiles') as any)
        .update({ publishability_rules: rules })
        .eq('id', supplier.id);
      if (error) throw error;
      setRulesSaved(true);
      toast.success("Regras guardadas com sucesso.");
    } catch (e: any) {
      toast.error(`Erro ao guardar: ${e.message}`);
    }
  };

  const handleGenerateRules = async () => {
    setIsGenerating(true);
    try {
      // STEP 1 — Fetch real supplier products (200 varied samples)
      // First try by supplier_ref
      let { data: products } = await (supabase
        .from('products') as any)
        .select('sku, original_title, original_price, category')
        .eq('supplier_ref', supplier.id)
        .not('original_title', 'is', null)
        .limit(200);

      // Fallback by supplier_name if no products found by ref
      if (!products || products.length === 0) {
        const { data: fallbackProducts } = await (supabase
          .from('products') as any)
          .select('sku, original_title, original_price, category')
          .eq('supplier_name', supplier.supplier_name)
          .not('original_title', 'is', null)
          .limit(200);
        products = fallbackProducts;
      }

      if (!products || products.length === 0) {
        // STEP 1.5 — Fallback to Feed if no products in DB
        const format = supplier.feed_url_csv ? 'csv' : 'xml';
        const url = format === 'csv' ? supplier.feed_url_csv : supplier.feed_url_xml;
        
        if (url) {
          setGeneratingStatus('A ler feed do fornecedor...');
          const { data: feedData } = await supabase.functions.invoke('fetch-supplier-feed', {
            body: { supplierId: supplier.id, workspaceId, format, feedUrl: url }
          });
          const rows = feedData?.allRows || feedData?.rows || [];
          if (rows.length > 0) {
            const sample = [...rows.slice(0, 100), ...rows.slice(Math.floor(rows.length/2), Math.floor(rows.length/2) + 50), ...rows.slice(-50)];
            products = sample.map((r: any) => ({
              original_title: r.title || r.PRODUCTNAME || r['g:title'] || r.name || r.original_title || r.Título || r.Nome,
              original_price: r.price || r.PRICE || r['g:price'] || r.original_price || r.Preço,
              category: r.category || r.CATEGORYTEXT1 || r['g:product_type'] || r.Categoria,
              sku: r.id || r.ITEM_ID || r['g:id'] || r.sku || r.SKU || r.Referência
            }));
            setGeneratingStatus('Feed lido — a analisar com IA...');
          }
        }
      }

      if (!products || products.length === 0) {
        // If still no products, check if we have other sources
        const { data: chunks } = await (supabase.from('knowledge_chunks') as any).select('id').eq('supplier_id', supplier.id).limit(1);
        const { data: files } = await (supabase.from('uploaded_files') as any).select('id').eq('entity_id', supplier.id).limit(1);
        
        if (!(chunks?.length) && !(files?.length)) {
          throw new Error("Não foram encontrados produtos nem ficheiros para análise. Carrega um catálogo PDF ou Excel primeiro.");
        }
      }

      // STEP 2 — Build real context from actual product data
      const productSample = products.map(p => 
        `SKU:${p.sku} | ${p.original_title} | €${p.original_price} | ${p.category}`
      ).join('\n');

      // Step B: PDF analysis
      let pdfContext = "";
      const { data: chunks } = await (supabase
        .from('knowledge_chunks') as any)
        .select('content')
        .eq('supplier_id', supplier.id)
        .limit(50);
      if (chunks?.length) {
        pdfContext = chunks.map((c: any) => c.content).join("\n---\n");
      }

      // Step C: Excel analysis
      let excelContext = "";
      const { data: excelFiles } = await (supabase
        .from('uploaded_files') as any)
        .select('id, file_path, file_name, created_at')
        .eq('entity_id', supplier.id)
        .eq('file_type', 'products')
        .order('created_at', { ascending: false })
        .limit(1);

      if (excelFiles?.length > 0) {
        setExcelSource(excelFiles[0].file_name);
        
        const { data: priceStats } = await (supabase
          .from('products') as any)
          .select('original_price, category')
          .eq('supplier_ref', supplier.id)
          .not('original_price', 'is', null);
          
        if (priceStats?.length) {
          const prices = priceStats.map((p: any) => Number(p.original_price)).filter((p: number) => p > 0);
          const sorted = [...prices].sort((a,b) => a-b);
          if (sorted.length > 0) {
            excelContext = JSON.stringify({
              total_products: prices.length,
              min_price: sorted[0],
              max_price: sorted[sorted.length-1],
              avg_price: Math.round(prices.reduce((a,b)=>a+b,0)/prices.length),
              p25: sorted[Math.floor(sorted.length*0.25)],
              p75: sorted[Math.floor(sorted.length*0.75)],
              price_distribution: {
                under_5: prices.filter(p=>p<5).length,
                '5_to_20': prices.filter(p=>p>=5&&p<20).length,
                '20_to_100': prices.filter(p=>p>=20&&p<100).length,
                '100_to_500': prices.filter(p=>p>=100&&p<500).length,
                over_500: prices.filter(p=>p>=500).length
              }
            });
          }
        }
      }

      // STEP 3 — Send to AI with real data
      const { data: aiResponse, error: aiError } = await supabase.functions.invoke('direct-ai-call', {
        body: {
          systemPrompt: `You are analyzing a real supplier catalog to generate publishability rules for hotelequip.pt (professional restaurant and hotel equipment store in Portugal).

Your task: analyze the ACTUAL products provided and identify:
1. Words in titles that indicate STANDALONE products a customer buys directly (power_words)
2. Words in titles that indicate MOUNTING COMPONENTS or SPARE PARTS that should NOT be sold standalone (stop_words)
3. Categories where EVERYTHING should be published
4. SKU patterns that always indicate complete assembled products

Focus on the ACTUAL words found in these product titles.
Do NOT generate generic marketing words.

Return ONLY this JSON, no other text:
{
  "power_words": [actual words from titles indicating standalone products],
  "stop_words": [actual words from titles indicating components/parts],
  "strategic_categories": [category patterns to always publish],
  "skip_categories": [category patterns to mostly skip],
  "sku_publish_patterns": [regex for complete product SKUs],
  "min_price_skip": 5,
  "min_price_review": 15,
  "min_price_spare_parts": 50,
  "notes": "explanation in PT-PT based on actual catalog analysis"
}`,
          prompt: `Analyze these ${products.length} real products from this supplier:

${productSample}

=== PDF CONTEXT ===
${pdfContext}

=== PRICE DISTRIBUTION FROM EXCEL/PRODUCTS ===
${excelContext}`,
          model: "lovable/gemini-2.5-flash"
        }
      });

      if (aiError) throw aiError;
      
      setGeneratingStatus(null);
      const jsonMatch = aiResponse.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("A IA não retornou um JSON válido.");
      
      const generated = JSON.parse(jsonMatch[0]);
      setRules(generated);
      toast.success("Regras geradas com base em produtos reais. Revê e guarda.");
    } catch (e: any) {
      setGeneratingStatus(null);
      toast.error(`Erro ao gerar regras: ${e.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClassify = async () => {
    if (!rules) return toast.error("Gera e guarda as regras primeiro.");
    setIsClassifying(true);
    setProgress(0);
    
    try {
      const applyRules = (product: any, rules: any) => {
        const sku = product.sku || '';
        const price = Number(product.original_price) || 0;
        const title = (product.original_title || '').toLowerCase();
        const category = (product.category || '').toLowerCase();

        for (const pattern of (rules.sku_publish_patterns || [])) {
          try { if (new RegExp(pattern).test(sku)) return { score: 100, reason: 'SKU padrão', decision: 'publish' }; } catch(e) {}
        }
        for (const cat of (rules.strategic_categories || [])) {
          if (category.includes(cat.toLowerCase())) return { score: 92, reason: `Categoria estratégica: ${cat}`, decision: 'publish' };
        }
        for (const cat of (rules.skip_categories || [])) {
          if (category.includes(cat.toLowerCase()) && price < 100) return { score: 10, reason: `Categoria a ignorar: ${cat}`, decision: 'skip' };
        }
        for (const word of (rules.power_words || [])) {
          if (title.includes(word.toLowerCase())) return { score: 85, reason: `Standalone: "${word}"`, decision: 'publish' };
        }
        for (const word of (rules.stop_words || [])) {
          if (title.includes(word.toLowerCase()) && price < (rules.min_price_review || 30)) return { score: 12, reason: `Componente: "${word}"`, decision: 'skip' };
        }
        
        const spareWords = ['pedal','válvula','valvula','bomba','motor','resistência','resistencia'];
        if (spareWords.some(w => title.includes(w)) && price >= (rules.min_price_spare_parts || 50))
          return { score: 75, reason: 'Peça de substituição valiosa', decision: 'publish' };

        if (price > 0 && price < (rules.min_price_skip || 5)) return { score: 5, reason: `Preço €${price}`, decision: 'skip' };
        if (price > 0 && price < (rules.min_price_review || 15)) return { score: 25, reason: `Preço €${price}`, decision: 'review' };
        if (price >= 200) return { score: 80, reason: `Preço €${price}`, decision: 'publish' };

        return { score: 50, reason: 'Ambíguo', decision: 'review' };
      };

      let from = 0;
      const limit = 100;
      let total = 0;
      let p: any = { publish: 0, review: 0, skip: 0 };

      while (true) {
        const { data: products, error } = await (supabase
          .from('products') as any)
          .select('id, sku, original_price, original_title, category, workflow_state')
          .eq('supplier_ref', supplier.id)
          .range(from, from + limit - 1);
        
        if (error) throw error;
        if (!products.length) break;

        for (const product of products) {
          const result: any = applyRules(product, rules);
          const updates: any = {
            publishability_score: result.score,
            publishability_reason: result.reason,
            publishability_decision: result.decision
          };
          
          if (result.decision === 'skip' && product.workflow_state === 'draft') updates.workflow_state = 'archived';
          else if (result.decision === 'review' && product.workflow_state === 'draft') updates.workflow_state = 'needs_review';

          await (supabase.from('products') as any).update(updates).eq('id', product.id);
          p[result.decision]++;
          total++;
        }
        
        from += limit;
        setProgress(Math.min(99, Math.round((from / (supplier.publishability_stats?.total || from + 1000)) * 100)));
      }

      const stats = { ...p, total, last_run: new Date().toISOString() };
      await (supabase.from('supplier_profiles') as any).update({ 
        publishability_stats: stats,
        publishability_last_run: stats.last_run
      }).eq('id', supplier.id);
      
      queryClient.invalidateQueries({ queryKey: ['supplier-profiles'] });
      toast.success("Classificação concluída.");
      setProgress(100);
    } catch (e: any) {
      toast.error(`Erro na classificação: ${e.message}`);
    } finally {
      setIsClassifying(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-sm">Estado das Fontes</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 items-center">
            <Badge variant={sourcesStatus?.feed ? "default" : "secondary"}>Feed {sourcesStatus?.feed ? "✅" : "❌"}</Badge>
            
            <div className="flex items-center gap-2">
              <Badge variant={sourcesStatus?.pdf ? "default" : "secondary"}>
                PDF {sourcesStatus?.pdf ? "✅" : "❌"}
              </Badge>
              {sourcesStatus?.pdfIndexed ? (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  ✅ PDF indexado 
                  <button 
                    onClick={() => queryClient.invalidateQueries({ queryKey: ['supplier-knowledge-graph'] })}
                    className="text-primary hover:underline flex items-center ml-1"
                  >
                    Ver Knowledge Graph <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                  </button>
                </span>
              ) : sourcesStatus?.pdf ? (
                <span className="text-[10px] text-amber-500">Aguardando indexação</span>
              ) : (
                <div className="flex items-center gap-2">
                  <Input 
                    type="file" 
                    accept=".pdf" 
                    className="hidden" 
                    id="pdf-upload-pub" 
                    onChange={handlePdfUpload}
                    disabled={uploadingPdf}
                  />
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-7 text-[10px] gap-1 px-2"
                    disabled={uploadingPdf}
                    asChild
                  >
                    <label htmlFor="pdf-upload-pub" className="cursor-pointer">
                      {uploadingPdf ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                      {uploadingPdf ? "A carregar..." : "📄 Carregar PDF"}
                    </label>
                  </Button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Badge variant={sourcesStatus?.excel ? "default" : "secondary"}>
                Excel {sourcesStatus?.excel ? "✅" : "❌"}
              </Badge>
              <Input 
                type="file" 
                accept=".xlsx,.xls,.csv" 
                className="hidden" 
                id="excel-upload-pub" 
                onChange={handleExcelUpload}
                disabled={uploadingExcel}
              />
              <Button 
                variant="outline" 
                size="sm" 
                className="h-7 text-[10px] gap-1 px-2"
                disabled={uploadingExcel}
                asChild
              >
                <label htmlFor="excel-upload-pub" className="cursor-pointer">
                  {uploadingExcel ? <Loader2 className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />}
                  {uploadingExcel ? "A carregar..." : "📊 Carregar Excel"}
                </label>
              </Button>
            </div>
            
            <Badge variant={sourcesStatus?.website ? "default" : "secondary"}>Website {sourcesStatus?.website ? "✅" : "❌"}</Badge>
          </div>

          {excelFilesList && excelFilesList.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Ficheiros Excel/Tarifas:</p>
              <div className="flex flex-wrap gap-2">
                {excelFilesList.map((file: any) => (
                  <div key={file.id} className="text-[10px] bg-muted px-2 py-1 rounded border flex items-center gap-2">
                    <FileText className="w-2.5 h-2.5" />
                    {file.file_name}
                    <span className="text-muted-foreground">({new Date(file.created_at).toLocaleDateString()})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(!sourcesStatus?.feed && !sourcesStatus?.pdf && !sourcesStatus?.excel) && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <p className="text-xs text-amber-600 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                <strong>Fornecedor novo sem dados.</strong> Para gerar regras precisas, carrega um catálogo PDF, uma lista Excel ou configura o Feed.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Regras de Publicabilidade</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {(generatingStatus || excelSource) && (
            <div className="text-[10px] text-muted-foreground bg-muted p-1 px-2 rounded flex items-center gap-2">
              {isGenerating && <Loader2 className="w-3 h-3 animate-spin" />}
              {generatingStatus || `Analisando: ${excelSource}`}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Power Words (publicar)</Label>
              <Textarea 
                value={rules.power_words?.join('\n')} 
                onChange={e => setRules({...rules, power_words: e.target.value.split('\n')})} 
                placeholder="mesa\narmario..."
              />
            </div>
            <div className="space-y-2">
              <Label>Stop Words (ignorar)</Label>
              <Textarea 
                value={rules.stop_words?.join('\n')} 
                onChange={e => setRules({...rules, stop_words: e.target.value.split('\n')})} 
                placeholder="tornillo\ntuerca..."
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Padrões de SKU (regex para publicar)</Label>
            <Textarea 
              value={rules.sku_publish_patterns?.join('\n')} 
              onChange={e => setRules({...rules, sku_publish_patterns: e.target.value.split('\n')})} 
              placeholder="^91\\d{7}"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Min Preço Ignorar (€)</Label>
              <Input type="number" value={rules.min_price_skip} onChange={e => setRules({...rules, min_price_skip: Number(e.target.value)})} />
            </div>
            <div className="space-y-2">
              <Label>Min Preço Rever (€)</Label>
              <Input type="number" value={rules.min_price_review} onChange={e => setRules({...rules, min_price_review: Number(e.target.value)})} />
            </div>
            <div className="space-y-2">
              <Label>Peças p/ Publicar (€)</Label>
              <Input type="number" value={rules.min_price_spare_parts} onChange={e => setRules({...rules, min_price_spare_parts: Number(e.target.value)})} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleGenerateRules} disabled={isGenerating}>
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
              Gerar com IA
            </Button>
            <Button variant="outline" onClick={handleSaveRules}><Save className="w-4 h-4 mr-2" />Guardar</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Classificar Produtos</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between text-sm">
            <span>✅ {supplier.publishability_stats?.publish || 0} publicar</span>
            <span>👁 {supplier.publishability_stats?.review || 0} rever</span>
            <span>❌ {supplier.publishability_stats?.skip || 0} ignorar</span>
          </div>
          {isClassifying && <Progress value={progress} className="h-2" />}
          <Button 
            onClick={handleClassify} 
            disabled={isClassifying || (!rulesSaved && (!supplier.publishability_rules || (!(supplier.publishability_rules.power_words?.length > 0) && !(supplier.publishability_rules.stop_words?.length > 0) && !(supplier.publishability_rules.sku_publish_patterns?.length > 0))))} 
            className="w-full"
          >
            {isClassifying ? "A classificar..." : "🔍 Classificar Produtos"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// AI Prompt Generator Modal
const AiPromptModal = ({ 
  isOpen, 
  onClose, 
  prompt, 
  onApply, 
  supplierId 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  prompt: string; 
  onApply: (config: any) => void;
  supplierId?: string;
}) => {
  const [response, setResponse] = useState("");
  const [parsedConfig, setParsedConfig] = useState<any>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt);
    toast.success("Prompt copiado para a área de transferência.");
  };

  const validateAndParse = () => {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;
      const config = JSON.parse(jsonStr);
      setParsedConfig(config);
      toast.success("JSON validado com sucesso.");
    } catch (e) {
      toast.error("JSON inválido.");
    }
  };

  const saveToSupplier = async () => {
    if (!supplierId || !parsedConfig) return;
    try {
      const { error } = await supabase
        .from("supplier_profiles")
        .update({ connector_config: parsedConfig })
        .eq("id", supplierId);
      if (error) throw error;
      toast.success("Configuração guardada.");
      onApply(parsedConfig);
      toast.info("Config gerada — revê e clica Guardar");
      onClose();
    } catch (e: any) {
      toast.error(`Erro: ${e.message}`);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-primary" />
            Gerar Configuração com IA
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase">1. Copia o Prompt</Label>
            <div className="relative">
              <ScrollArea className="h-32 border rounded p-2 text-[10px] font-mono">
                <pre>{prompt}</pre>
              </ScrollArea>
              <Button size="sm" variant="secondary" className="absolute top-1 right-1 h-6" onClick={handleCopy}>Copiar</Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase">2. Cola o JSON</Label>
            <Textarea className="h-32 font-mono text-[10px]" value={response} onChange={e => setResponse(e.target.value)} />
          </div>
          {parsedConfig && (
            <div className="p-2 bg-green-500/10 border border-green-500/20 rounded text-[10px]">
              ✓ JSON válido detectado
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          {!parsedConfig ? (
            <Button onClick={validateAndParse}>Validar</Button>
          ) : (
            <Button onClick={saveToSupplier}>Guardar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
