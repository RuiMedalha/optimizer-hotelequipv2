import { useState, useCallback, useMemo } from "react";
import { Upload, FileSpreadsheet, Play, Eye, Loader2, CheckCircle, AlertCircle, Clock, ArrowRight, X, Database, Webhook, Zap, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, RefreshCw, Plus, Check, FileText, Search, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useIngestionJobs, useIngestionJobItems, useParseIngestion, useRunIngestionJob, type IngestionJob } from "@/hooks/useIngestion";
import { usePlaybookEngine } from "@/hooks/usePlaybookEngine";
import { useUploadedFiles } from "@/hooks/useUploadedFiles";
import { useDeleteUploadedFile } from "@/hooks/useDeleteUploadedFile";
import { SupplierAutoDetectionPanel } from "@/components/playbook-engine/SupplierAutoDetectionPanel";
import { SmartColumnInferencePreview } from "@/components/playbook-engine/SmartColumnInferencePreview";
import { ImportPreviewBeforeRun } from "@/components/playbook-engine/ImportPreviewBeforeRun";
import { PlaybookCorrectionsPanel } from "@/components/playbook-engine/PlaybookCorrectionsPanel";
import { IngestionJobActionsDropdown } from "@/components/playbook-engine/IngestionJobActionsDropdown";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import { toast } from "sonner";

const PRODUCT_FIELDS = [
  { key: "sku", label: "SKU" },
  { key: "original_title", label: "Título" },
  { key: "original_description", label: "Descrição" },
  { key: "original_price", label: "Preço" },
  { key: "sale_price", label: "Preço Promocional" },
  { key: "stock", label: "Stock / Inventário" },
  { key: "category", label: "Categoria" },
  { key: "short_description", label: "Descrição Curta" },
  { key: "image_urls", label: "Imagens (URLs)" },
  { key: "tags", label: "Tags" },
  { key: "meta_title", label: "Meta Title" },
  { key: "meta_description", label: "Meta Description" },
  { key: "seo_slug", label: "SEO Slug" },
  { key: "supplier_ref", label: "Ref. Fornecedor" },
  { key: "technical_specs", label: "Especificações" },
  { key: "attributes", label: "Atributos" },
  { key: "product_type", label: "Tipo de Produto" },
];

const statusLabels: Record<string, { label: string; color: string }> = {
  queued: { label: "Na fila", color: "bg-muted text-muted-foreground" },
  parsing: { label: "A analisar", color: "bg-primary/10 text-primary" },
  mapping: { label: "A mapear", color: "bg-primary/10 text-primary" },
  dry_run: { label: "Preview", color: "bg-amber-500/10 text-amber-600" },
  importing: { label: "A importar", color: "bg-blue-500/10 text-blue-600" },
  done: { label: "Concluído", color: "bg-green-500/10 text-green-600" },
  error: { label: "Erro", color: "bg-destructive/10 text-destructive" },
};

const IngestionHubPage = () => {
  const { data: jobs, isLoading } = useIngestionJobs();
  const parseIngestion = useParseIngestion();
  const runJob = useRunIngestionJob();
  const {
    autoDetect, inferMapping, generateDraft, applyCorrections, overrides,
    deleteIngestionJob, archiveIngestionJob, triggerAutoDraftFromIngestion,
  } = usePlaybookEngine();
  const deleteFile = useDeleteUploadedFile();

  const [activeTab, setActiveTab] = useState("import");
  const [dragOver, setDragOver] = useState(false);

  // Parsing state
  const [parsedData, setParsedData] = useState<any[] | null>(null);
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({});
  const [mergeStrategy, setMergeStrategy] = useState("merge");
  const [dupFields, setDupFields] = useState("sku");
  const [skuPrefix, setSkuPrefix] = useState("");
  const [sourceLang, setSourceLang] = useState("auto");

  // Auto-detection state
  const [currentDetection, setCurrentDetection] = useState<any>(null);
  const [currentInference, setCurrentInference] = useState<any>(null);
  const [showReview, setShowReview] = useState(false);
  const [showCorrections, setShowCorrections] = useState(false);

  // Preview state
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<any>(null);
  const { data: previewItems } = useIngestionJobItems(previewJobId);

  // Detail state
  const [detailJob, setDetailJob] = useState<IngestionJob | null>(null);
  const { data: detailItems } = useIngestionJobItems(detailJob?.id || null);

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setCurrentDetection(null);
    setCurrentInference(null);
    setShowReview(false);
    const ext = file.name.split(".").pop()?.toLowerCase();

    let headers: string[] = [];
    let rows: any[] = [];

    if (ext === "csv") {
      const text = await file.text();
      const lines = text.split("\n").filter(l => l.trim());
      if (lines.length === 0) return;
      const sep = lines[0].includes(";") ? ";" : ",";
      headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ""));
      rows = lines.slice(1).map(line => {
        const vals = line.split(sep).map(v => v.trim().replace(/^"|"$/g, ""));
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
        return obj;
      });
    } else if (ext === "xlsx" || ext === "xls") {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<Record<string, any>>(ws);
      if (data.length === 0) return;
      headers = Object.keys(data[0]);
      rows = data;
    } else if (ext === "json") {
      const text = await file.text();
      let parsed = JSON.parse(text);
      
      // If the root is an object, look for common array keys
      if (!Array.isArray(parsed) && typeof parsed === "object" && parsed !== null) {
        const arrayKey = ["products", "items", "data", "rows"].find(k => Array.isArray(parsed[k]));
        if (arrayKey) {
          parsed = parsed[arrayKey];
        } else {
          parsed = [parsed];
        }
      }
      
      rows = parsed;
      if (rows.length === 0) return;
      headers = Object.keys(rows[0]);
    } else {
      toast.error("Formato não suportado. Use CSV, XLSX ou JSON.");
      return;
    }

    setParsedHeaders(headers);
    setParsedData(rows);

    // 1. Auto-detect supplier
    try {
      const detResult = await autoDetect.mutateAsync({
        file_name: file.name,
        headers,
        sample_data: rows.slice(0, 50),
        source_type: ext || "excel",
      });
      setCurrentDetection(detResult.detection);

      // 2. Infer column mapping
      const infResult = await inferMapping.mutateAsync({
        supplier_id: detResult.matched_supplier_id || undefined,
        detection_id: detResult.detection?.id,
        headers,
        sample_data: rows.slice(0, 50),
        file_name: file.name,
      });
      setCurrentInference(infResult);

      // Apply inferred mapping
      if (infResult.mapping) {
        setFieldMappings(infResult.mapping);
      }

      // 3. Generate playbook draft
      await generateDraft.mutateAsync({
        supplier_id: detResult.matched_supplier_id || undefined,
        detection_id: detResult.detection?.id,
        inference_id: infResult.inference?.id,
      });

      setShowReview(true);
    } catch (e) {
      // Fallback to basic auto-mapping if engine fails
      const autoMap: Record<string, string> = {};
      headers.forEach(h => {
        const lower = h.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (lower === "sku" || lower === "ref" || lower === "reference" || lower === "referencia" || lower === "cod" || lower === "codigo") autoMap[h] = "sku";
        else if (lower.includes("title") || lower.includes("titulo") || lower.includes("nome") || lower === "name" || lower === "label") autoMap[h] = "original_title";
        else if (lower.includes("desc") && !lower.includes("short") && !lower.includes("curta")) autoMap[h] = "original_description";
        else if (lower.includes("price") || lower.includes("preco") || lower.includes("preço") || lower === "pvp") autoMap[h] = "original_price";
        else if (lower.includes("saleprice") || lower.includes("promo")) autoMap[h] = "sale_price";
        else if (lower.includes("stock") || lower.includes("stockquantity") || lower.includes("inv") || lower.includes("estoque") || lower.includes("existencia")) autoMap[h] = "stock";
        else if (lower.includes("categ")) autoMap[h] = "category";
        else if (lower.includes("image") || lower.includes("imagem") || lower.includes("foto") || lower.includes("img")) autoMap[h] = "image_urls";
      });
      setFieldMappings(autoMap);
    }
  }, [autoDetect, inferMapping, generateDraft]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleFile(e.target.files[0]);
    e.target.value = "";
  }, [handleFile]);

  const handleDryRun = async () => {
    if (!parsedData) return;
    try {
      const result = await parseIngestion.mutateAsync({
        data: parsedData,
        fileName,
        sourceType: fileName.endsWith(".csv") ? "csv" : fileName.endsWith(".json") ? "json" : "xlsx",
        fieldMappings,
        mergeStrategy,
        duplicateDetectionFields: dupFields.split(",").map(s => s.trim()).filter(Boolean),
        mode: "dry_run",
        skuPrefix: skuPrefix.trim() || undefined,
        sourceLanguage: sourceLang,
      });
      setPreviewResult(result);
      setPreviewJobId(result.jobId);

      // Trigger auto-draft creation after successful dry-run
      triggerAutoDraftAfterIngestion(result.jobId);

      toast.success("Preview gerado com sucesso");
    } catch {}
  };

  const handleLiveRun = async () => {
    if (!parsedData) return;
    try {
      const result = await parseIngestion.mutateAsync({
        data: parsedData,
        fileName,
        sourceType: fileName.endsWith(".csv") ? "csv" : fileName.endsWith(".json") ? "json" : "xlsx",
        fieldMappings,
        mergeStrategy,
        duplicateDetectionFields: dupFields.split(",").map(s => s.trim()).filter(Boolean),
        mode: "live",
        skuPrefix: skuPrefix.trim() || undefined,
        sourceLanguage: sourceLang,
      });
      await runJob.mutateAsync(result.jobId);

      // Trigger auto-draft creation after successful live import
      triggerAutoDraftAfterIngestion(result.jobId);

      resetForm();
    } catch {}
  };

  const triggerAutoDraftAfterIngestion = (jobId: string) => {
    if (!parsedData || !parsedHeaders.length) return;
    const ext = fileName.split(".").pop()?.toLowerCase() || "xlsx";
    triggerAutoDraftFromIngestion.mutate({
      ingestion_job_id: jobId,
      file_name: fileName,
      headers: parsedHeaders,
      sample_data: parsedData.slice(0, 50),
      source_type: ext,
    });
  };

  const handleRunExistingJob = async (jobId: string) => {
    try { await runJob.mutateAsync(jobId); } catch {}
  };

  const handleJobAction = (action: string, jobId: string) => {
    const job = jobs?.find(j => j.id === jobId);
    switch (action) {
      case "view":
        if (job) setDetailJob(job);
        break;
      case "run":
        handleRunExistingJob(jobId);
        break;
      case "delete":
        deleteIngestionJob.mutate(jobId);
        break;
      case "archive":
        archiveIngestionJob.mutate(jobId);
        break;
      case "delete_file":
        // Delete the uploaded file associated with this job
        toast.info("A eliminar ficheiro...");
        // We'd need the file ID; for now delete by job reference
        deleteIngestionJob.mutate(jobId);
        break;
      case "clone":
        toast.info("Clone: funcionalidade em desenvolvimento");
        break;
      case "open_draft":
        toast.info("Navegar para Supplier Playbooks > Auto-Drafts");
        break;
      default:
        toast.info(`Ação "${action}" pendente de implementação`);
    }
  };

  const resetForm = () => {
    setParsedData(null);
    setParsedHeaders([]);
    setFileName("");
    setFieldMappings({});
    setPreviewResult(null);
    setPreviewJobId(null);
    setCurrentDetection(null);
    setCurrentInference(null);
    setShowReview(false);
    setShowCorrections(false);
    setSkuPrefix("");
  };

  const mappedCount = Object.keys(fieldMappings).length;

  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Centro de Importação</h1>
        <p className="text-muted-foreground mt-1">Importe, mapeie e valide dados de catálogo com deteção inteligente de fornecedores e matching automático de SKU.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="import" className="gap-2"><Upload className="w-4 h-4" /> Importar</TabsTrigger>
          <TabsTrigger value="jobs" className="gap-2"><Clock className="w-4 h-4" /> Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="space-y-6 mt-4">
          {!parsedData ? (
            <Card
              className={cn("border-2 border-dashed transition-colors cursor-pointer",
                dragOver ? "border-primary bg-accent" : "border-border hover:border-primary/50"
              )}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <CardContent className="flex flex-col items-center justify-center py-16">
                <FileSpreadsheet className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium mb-1">Arraste um ficheiro para importar</p>
                <p className="text-sm text-muted-foreground mb-2">CSV, XLSX, XLS ou JSON</p>
                <p className="text-xs text-muted-foreground mb-4 flex items-center gap-1">
                  <Zap className="w-3 h-3" /> Deteção automática de fornecedor e mapeamento inteligente
                </p>
                <Button variant="outline" asChild>
                  <label className="cursor-pointer">
                    Selecionar Ficheiro
                    <input type="file" accept=".csv,.xlsx,.xls,.json,.xml" className="hidden" onChange={onFileSelect} />
                  </label>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{fileName}</h2>
                  <p className="text-sm text-muted-foreground">{parsedData.length} linhas detectadas · {parsedHeaders.length} colunas</p>
                </div>
                <Button variant="ghost" size="sm" onClick={resetForm}><X className="w-4 h-4 mr-1" /> Cancelar</Button>
              </div>

              {/* Auto-detection panel */}
              <SupplierAutoDetectionPanel
                detection={currentDetection}
                isDetecting={autoDetect.isPending}
              />

              {/* Smart inference with review toggle */}
              {showReview ? (
                <ImportPreviewBeforeRun
                  detection={currentDetection}
                  inference={currentInference}
                  draft={null}
                  parsedData={parsedData}
                  fieldMappings={fieldMappings}
                  onConfirmImport={handleLiveRun}
                  onCorrectMapping={() => setShowReview(false)}
                  onSaveDraft={() => { toast.success("Draft guardado"); }}
                  onReprocess={() => handleFile(new File([], fileName))}
                  isImporting={parseIngestion.isPending || runJob.isPending}
                />
              ) : (
                <>
                  {/* Settings row */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Estratégia de Merge</Label>
                      <Select value={mergeStrategy} onValueChange={setMergeStrategy}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="merge">Merge (insert + update)</SelectItem>
                          <SelectItem value="insert_only">Apenas inserir novos</SelectItem>
                          <SelectItem value="update_only">Apenas atualizar existentes</SelectItem>
                          <SelectItem value="replace">Substituir completamente</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Prefixo SKU (opcional)</Label>
                      <Input 
                        value={skuPrefix} 
                        onChange={e => setSkuPrefix(e.target.value.toUpperCase())} 
                        placeholder="Ex: UD-" 
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Idioma de Origem</Label>
                      <Select value={sourceLang} onValueChange={setSourceLang}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Auto-detetar</SelectItem>
                          <SelectItem value="es">Espanhol</SelectItem>
                          <SelectItem value="en">Inglês</SelectItem>
                          <SelectItem value="pt">Português (Brasil)</SelectItem>
                          <SelectItem value="pt-pt">Português (Portugal)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Detecção de duplicados</Label>
                      <Input value={dupFields} onChange={e => setDupFields(e.target.value)} placeholder="sku, original_title" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Estado do Mapeamento</Label>
                      <div className="h-10 flex items-center px-3 rounded-md border border-input bg-background">
                        <p className="text-sm text-muted-foreground">{mappedCount} de {parsedHeaders.length} colunas</p>
                      </div>
                    </div>
                  </div>

                  {/* Smart column inference */}
                  <SmartColumnInferencePreview
                    inference={currentInference}
                    headers={parsedHeaders}
                    sampleData={parsedData || []}
                    fieldMappings={fieldMappings}
                    onMappingChange={setFieldMappings}
                  />

                  {/* Corrections panel */}
                  {showCorrections && (
                    <PlaybookCorrectionsPanel
                      supplierId={currentDetection?.matched_supplier_id}
                      overrides={(overrides.data || []).filter((o: any) => o.supplier_id === currentDetection?.matched_supplier_id)}
                      onApplyInstruction={(instruction) => {
                        applyCorrections.mutate({
                          supplier_id: currentDetection?.matched_supplier_id,
                          instruction,
                        });
                      }}
                      onApplyCorrection={(c) => {
                        applyCorrections.mutate({
                          supplier_id: currentDetection?.matched_supplier_id,
                          corrections: [c],
                        });
                      }}
                      isApplying={applyCorrections.isPending}
                    />
                  )}

                  {/* Dry-run result */}
                  {previewResult && (
                    <Card className="border-amber-500/30 bg-amber-500/5">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Eye className="w-4 h-4 text-amber-600" />
                          Resultado do Preview
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                          <div className="text-center">
                            <p className="text-2xl font-bold text-green-600">{previewResult.inserts}</p>
                            <p className="text-xs text-muted-foreground">Novos</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-blue-600">{previewResult.updates}</p>
                            <p className="text-xs text-muted-foreground">Atualizações</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-muted-foreground">{previewResult.skips}</p>
                            <p className="text-xs text-muted-foreground">Ignorados</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-amber-600">{previewResult.duplicates}</p>
                            <p className="text-xs text-muted-foreground">Duplicados</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-foreground">{previewResult.totalRows}</p>
                            <p className="text-xs text-muted-foreground">Total</p>
                          </div>
                        </div>

                        {previewResult.groups?.length > 0 && (
                          <div className="mt-4 border-t border-border pt-3">
                            <p className="text-xs font-medium mb-2">Grupos de variações detectados:</p>
                            <div className="flex flex-wrap gap-2">
                              {previewResult.groups.map((g: any) => (
                                <Badge key={g.key} variant="outline" className="text-xs">{g.key} ({g.count} items)</Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {previewItems && previewItems.length > 0 && (
                          <div className="mt-4 border-t border-border pt-3">
                            <p className="text-xs font-medium mb-2">Detalhes por linha:</p>
                            <ScrollArea className="max-h-64">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="text-xs">#</TableHead>
                                    <TableHead className="text-xs">Ação</TableHead>
                                    <TableHead className="text-xs">SKU</TableHead>
                                    <TableHead className="text-xs">Título</TableHead>
                                    <TableHead className="text-xs">Match</TableHead>
                                    <TableHead className="text-xs">Grupo</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {previewItems.slice(0, 20).map((item) => (
                                    <TableRow key={item.id}>
                                      <TableCell className="text-xs">{item.source_row_index + 1}</TableCell>
                                      <TableCell>
                                        <Badge variant="outline" className={cn("text-[10px]",
                                          item.action === "insert" ? "border-green-500 text-green-600" :
                                          item.action === "update" || item.action === "merge" ? "border-blue-500 text-blue-600" :
                                          "border-muted text-muted-foreground"
                                        )}>{item.action}</Badge>
                                      </TableCell>
                                      <TableCell className="text-xs font-mono">{item.mapped_data?.sku || "—"}</TableCell>
                                      <TableCell className="text-xs max-w-[200px] truncate">{item.mapped_data?.original_title || "—"}</TableCell>
                                      <TableCell className="text-xs">{item.match_confidence ? `${item.match_confidence}%` : "—"}</TableCell>
                                      <TableCell className="text-xs">
                                        {item.parent_group_key ? (
                                          <Badge variant="secondary" className="text-[10px]">
                                            {item.is_parent ? "Parent" : "Child"}: {item.parent_group_key}
                                          </Badge>
                                        ) : "—"}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </ScrollArea>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Actions */}
                  <div className="flex gap-3 flex-wrap">
                    <Button variant="outline" onClick={() => setShowReview(true)} disabled={mappedCount === 0}>
                      <Eye className="w-4 h-4 mr-1" /> Rever Antes de Importar
                    </Button>
                    <Button variant="outline" onClick={handleDryRun} disabled={parseIngestion.isPending || mappedCount === 0}>
                      {parseIngestion.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Eye className="w-4 h-4 mr-1" />}
                      Preview (Dry Run)
                    </Button>
                    <Button onClick={handleLiveRun} disabled={parseIngestion.isPending || runJob.isPending || mappedCount === 0}>
                      {(parseIngestion.isPending || runJob.isPending) ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
                      Importar Agora
                    </Button>
                    <Button variant="ghost" onClick={() => setShowCorrections(!showCorrections)}>
                      Correções
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="jobs" className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (() => {
            // Separate jobs: pending/active vs completed history
            const pendingJobs = (jobs || []).filter(j => ["queued", "parsing", "mapping", "dry_run", "importing"].includes(j.status));
            const historyJobs = (jobs || []).filter(j => ["done", "error"].includes(j.status));
            
            if (!jobs || jobs.length === 0) return (
              <Card>
                <CardContent className="flex flex-col items-center py-12 text-muted-foreground">
                  <Database className="w-10 h-10 mb-3" />
                  <p className="font-medium">Sem jobs de ingestão</p>
                  <p className="text-sm">Importe dados no separador "Importar"</p>
                </CardContent>
              </Card>
            );
            
            return (
              <div className="space-y-6">
                {/* Active / Pending Jobs */}
                {pendingJobs.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" /> Em Processamento ({pendingJobs.length})
                    </h3>
                    {pendingJobs.map(job => {
                      const st = statusLabels[job.status] || statusLabels.queued;
                      return (
                        <Card key={job.id} className="hover:border-primary/30 transition-colors">
                          <CardContent className="flex items-center gap-4 py-3">
                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setDetailJob(job)}>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium truncate">{job.file_name || `Job ${job.id.slice(0, 8)}`}</p>
                                <Badge className={cn("text-[10px]", st.color)}>{st.label}</Badge>
                                <Badge variant="outline" className="text-[10px]">{job.mode === "dry_run" ? "Preview" : "Live"}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {job.total_rows} linhas · {job.imported_rows} importados · {job.updated_rows} atualizados · {job.failed_rows} erros
                                {job.created_at && ` · ${format(new Date(job.created_at), "dd/MM HH:mm")}`}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              {job.status === "dry_run" && (
                                <Button size="sm" variant="outline" onClick={() => handleRunExistingJob(job.id)}>
                                  <Play className="w-3 h-3 mr-1" /> Executar
                                </Button>
                              )}
                              <IngestionJobActionsDropdown job={job} onAction={handleJobAction} />
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {/* Completed History */}
                {historyJobs.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-primary" /> Histórico Concluído ({historyJobs.length})
                    </h3>
                    {historyJobs.map(job => {
                      const st = statusLabels[job.status] || statusLabels.queued;
                      return (
                        <Card key={job.id} className="hover:border-primary/30 transition-colors">
                          <CardContent className="flex items-center gap-4 py-3">
                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setDetailJob(job)}>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium truncate">{job.file_name || `Job ${job.id.slice(0, 8)}`}</p>
                                <Badge className={cn("text-[10px]", st.color)}>{st.label}</Badge>
                                <Badge variant="outline" className="text-[10px]">{job.mode === "dry_run" ? "Preview" : "Live"}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {job.total_rows} linhas · {job.imported_rows} importados · {job.updated_rows} atualizados · {job.failed_rows} erros
                                {job.created_at && ` · ${format(new Date(job.created_at), "dd/MM HH:mm")}`}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <IngestionJobActionsDropdown job={job} onAction={handleJobAction} />
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {pendingJobs.length === 0 && historyJobs.length === 0 && (
                  <Card>
                    <CardContent className="flex flex-col items-center py-12 text-muted-foreground">
                      <Database className="w-10 h-10 mb-3" />
                      <p className="font-medium">Sem jobs de ingestão</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })()}
        </TabsContent>
      </Tabs>

      {/* Job Detail Dialog */}
      <JobDetailDialog job={detailJob} items={detailItems || []} onClose={() => setDetailJob(null)} />
    </div>
  );
};

// ─── Job Detail Dialog with pagination ───
function JobDetailDialog({ job, items, onClose }: { job: IngestionJob | null; items: any[]; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const pageSize = 50;
  const runJob = useRunIngestionJob();

  if (!job) return null;

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const visibleItems = items.slice(startIndex, startIndex + pageSize);
  const st = statusLabels[job.status] || statusLabels.queued;

  const insertCount = items.filter(i => i.action === "insert").length;
  const updateCount = items.filter(i => i.action === "merge" || i.action === "update").length;

  // Navigate between items in detail view
  const selectedIndex = selectedItem ? items.findIndex(i => i.id === selectedItem.id) : -1;
  const goToItem = (idx: number) => {
    if (idx >= 0 && idx < items.length) {
      setSelectedItem(items[idx]);
      // Ensure pagination follows
      const targetPage = Math.floor(idx / pageSize) + 1;
      if (targetPage !== page) setPage(targetPage);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4 text-primary" />
              {job.file_name || `Job ${job.id.slice(0, 8)}`}
              <Badge className={cn("text-[10px]", st.color)}>{st.label}</Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
            {/* Stats */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              {[
                { l: "Total", v: job.total_rows, c: "" },
                { l: "Novos", v: job.status === "dry_run" ? insertCount : job.imported_rows, c: "text-primary" },
                { l: "Atualizações", v: job.status === "dry_run" ? updateCount : job.updated_rows, c: "text-primary" },
                { l: "Ignorados", v: job.skipped_rows, c: "text-muted-foreground" },
                { l: "Duplicados", v: job.duplicate_rows, c: "text-amber-600" },
                { l: "Erros", v: job.failed_rows, c: "text-destructive" },
              ].map(s => (
                <div key={s.l} className="bg-muted/50 rounded-lg p-2.5 text-center">
                  <p className={`text-xl font-bold ${s.c}`}>{s.v}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.l}</p>
                </div>
              ))}
            </div>

            {/* Items table */}
            {items.length > 0 && (
              <ScrollArea className="flex-1 min-h-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="text-xs font-semibold w-10">#</TableHead>
                      <TableHead className="text-xs font-semibold">Status</TableHead>
                      <TableHead className="text-xs font-semibold">Ação</TableHead>
                      <TableHead className="text-xs font-semibold">SKU</TableHead>
                      <TableHead className="text-xs font-semibold">Título</TableHead>
                      <TableHead className="text-xs font-semibold">Erro</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleItems.map(item => (
                      <TableRow
                        key={item.id}
                        className="cursor-pointer hover:bg-primary/5"
                        onClick={() => setSelectedItem(item)}
                      >
                        <TableCell className="text-xs font-mono">{item.source_row_index + 1}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-[10px]",
                            item.status === "processed" ? "border-primary/50 text-primary" :
                            item.status === "error" ? "border-destructive text-destructive" :
                            item.status === "mapped" ? "border-primary/30 text-primary" :
                            item.status === "skipped" ? "border-muted text-muted-foreground" : ""
                          )}>{item.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={cn("text-[10px]",
                            item.action === "insert" ? "bg-primary/10 text-primary" :
                            item.action === "merge" || item.action === "update" ? "bg-accent text-accent-foreground" :
                            item.action === "skip" ? "bg-muted text-muted-foreground" : ""
                          )}>
                            {item.action === "insert" ? "➕ Novo" :
                             item.action === "merge" || item.action === "update" ? "🔄 Atualizar" :
                             item.action === "skip" ? "⏭ Ignorar" : item.action || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-primary underline">{item.mapped_data?.sku || item.source_data?.sku || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{item.mapped_data?.original_title || "—"}</TableCell>
                        <TableCell className="text-xs text-destructive max-w-[200px] truncate">{item.error_message || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}

            {/* Pagination */}
            {items.length > pageSize && (
              <div className="flex items-center justify-between border-t pt-3">
                <p className="text-xs text-muted-foreground">
                  {startIndex + 1}–{Math.min(startIndex + pageSize, items.length)} de {items.length}
                </p>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(1)} disabled={safePage === 1}>
                    <ChevronsLeft className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <span className="text-xs text-muted-foreground px-2 font-medium">{safePage} / {totalPages}</span>
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>
                    <ChevronsRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground text-center">Clique numa linha para ver todos os dados do produto</p>

            {/* Re-run / Inject button */}
            {(job.status === "dry_run" || job.status === "done" || job.status === "error") && (
              <div className="border-t pt-3 mt-2 space-y-2">
                <p className="text-xs text-muted-foreground text-center">
                  {job.status === "dry_run"
                    ? "Pronto para injetar. SKUs duplicados serão fundidos automaticamente num único produto."
                    : "Pode re-executar este job. SKUs duplicados serão fundidos num único produto."}
                </p>
                <Button
                  className="w-full"
                  disabled={runJob.isPending}
                  onClick={() => {
                    runJob.mutate(job.id, {
                      onSuccess: () => toast.success("Ingestão concluída — SKUs duplicados foram fundidos"),
                    });
                  }}
                >
                  {runJob.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" /> A injetar...</>
                  ) : (
                    <><Play className="h-4 w-4 mr-2" /> {job.status === "dry_run" ? "Injetar nos Produtos" : "Re-executar Ingestão"}</>
                  )}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Item Detail Dialog */}
      {selectedItem && (
        <ItemDetailDialog
          item={selectedItem}
          allItems={items}
          jobId={job.id}
          onClose={() => setSelectedItem(null)}
          currentIndex={selectedIndex}
          totalItems={items.length}
          onPrevious={() => goToItem(selectedIndex - 1)}
          onNext={() => goToItem(selectedIndex + 1)}
        />
      )}
    </>
  );
}

// ─── Item Detail Dialog — shows all data with field selection ───
function ItemDetailDialog({
  item, allItems, jobId, onClose, currentIndex, totalItems, onPrevious, onNext,
}: {
  item: any;
  allItems: any[];
  jobId: string;
  onClose: () => void;
  currentIndex: number;
  totalItems: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const mapped = item.mapped_data || {};
  const source = item.source_data || {};
  const [pendingAdds, setPendingAdds] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Reset state when item changes
  const itemId = item.id;
  const [lastItemId, setLastItemId] = useState(itemId);
  if (itemId !== lastItemId) {
    setPendingAdds({});
    setSaved(false);
    setLastItemId(itemId);
  }

  const FIELD_LABELS: Record<string, string> = {
    sku: "SKU", original_title: "Título", original_description: "Descrição",
    short_description: "Descrição Curta", original_price: "Preço", category: "Categoria",
    dimensions: "Dimensões", weight: "Peso", material: "Material", brand: "Marca",
    model: "Modelo", technical_specs: "Especificações Técnicas", image_urls: "Imagens (URLs)",
    image_url: "Imagem URL", image_description: "Descrição da Imagem",
    color_options: "Opções de Cor", quantity: "Quantidade", unit: "Unidade",
    tags: "Tags", meta_title: "Meta Title", meta_description: "Meta Description",
    seo_slug: "SEO Slug", supplier_ref: "Ref. Fornecedor", attributes: "Atributos",
    product_type: "Tipo de Produto",
  };

  const allMappedKeys = [...new Set([...Object.keys(mapped), ...Object.keys(pendingAdds)])].filter(k => !k.startsWith("_"));
  const priorityKeys = ["sku", "original_title", "original_description", "short_description", "original_price", "category", "brand", "model", "technical_specs", "dimensions", "weight", "material", "image_urls", "image_url"];
  const sortedMappedKeys = [
    ...priorityKeys.filter(k => allMappedKeys.includes(k)),
    ...allMappedKeys.filter(k => !priorityKeys.includes(k)),
  ];

  // Source fields NOT yet in mapped_data (candidates to add)
  const unmappedSourceKeys = Object.keys(source)
    .filter(k => !k.startsWith("_") && k !== "confidence" && k !== "currency")
    .filter(k => {
      const mappedVal = mapped[k];
      const pendingVal = pendingAdds[k];
      return (mappedVal === null || mappedVal === undefined || mappedVal === "") && !(k in pendingAdds);
    })
    .filter(k => {
      const v = source[k];
      return v !== null && v !== undefined && v !== "";
    });

  const formatValue = (val: any): string => {
    if (val === null || val === undefined || val === "") return "—";
    if (Array.isArray(val)) return val.join(", ");
    if (typeof val === "object") { try { return JSON.stringify(val, null, 2); } catch { return String(val); } }
    return String(val);
  };

  const addFieldToMapped = (key: string) => {
    setPendingAdds(prev => ({ ...prev, [key]: source[key] }));
    setSaved(false);
  };

  const removeFieldFromPending = (key: string) => {
    setPendingAdds(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const [applyScope, setApplyScope] = useState<"single" | "all">("single");

  const handleSave = async () => {
    if (Object.keys(pendingAdds).length === 0) return;
    setIsSaving(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      
      if (applyScope === "all") {
        // Apply pendingAdds keys to ALL items in the job
        const pendingKeys = Object.keys(pendingAdds);
        let updatedCount = 0;
        for (const jobItem of allItems) {
          const itemSource = jobItem.source_data || {};
          const itemMapped = jobItem.mapped_data || {};
          const fieldsToAdd: Record<string, any> = {};
          for (const key of pendingKeys) {
            if (itemSource[key] !== undefined && itemSource[key] !== null && itemSource[key] !== "") {
              fieldsToAdd[key] = itemSource[key];
            }
          }
          if (Object.keys(fieldsToAdd).length > 0) {
            const newMapped = { ...itemMapped, ...fieldsToAdd };
            const { error } = await supabase
              .from("ingestion_job_items")
              .update({ mapped_data: newMapped })
              .eq("id", jobItem.id);
            if (!error) {
              jobItem.mapped_data = newMapped;
              updatedCount++;
            }
          }
        }
        // Also update current item with exact pending values
        item.mapped_data = { ...mapped, ...pendingAdds };
        toast.success(`Campos aplicados a ${updatedCount} produto(s) do lote`);
      } else {
        // Single item only
        const newMapped = { ...mapped, ...pendingAdds };
        const { error } = await supabase
          .from("ingestion_job_items")
          .update({ mapped_data: newMapped })
          .eq("id", item.id);
        if (error) throw error;
        item.mapped_data = newMapped;
        toast.success("Campos adicionados ao mapeamento com sucesso");
      }
      
      setPendingAdds({});
      setSaved(true);
    } catch (err: any) {
      toast.error(`Erro ao guardar: ${err?.message || "erro desconhecido"}`);
    } finally {
      setIsSaving(false);
    }
  };

  const hasPending = Object.keys(pendingAdds).length > 0;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Eye className="h-4 w-4 text-primary" />
            Detalhe do Produto — {mapped.sku || source.sku || `#${item.source_row_index + 1}`}
            <Badge variant="secondary" className={cn("text-[10px] ml-2",
              item.action === "insert" ? "bg-primary/10 text-primary" :
              item.action === "merge" || item.action === "update" ? "bg-accent text-accent-foreground" :
              "bg-muted text-muted-foreground"
            )}>
              {item.action === "insert" ? "➕ Novo" :
               item.action === "merge" || item.action === "update" ? "🔄 Atualizar" :
               item.action === "skip" ? "⏭ Ignorar" : item.action || "—"}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-4 pr-4">
            {/* Match info */}
            {item.matched_existing_id && (
              <div className="flex items-center gap-2 p-3 bg-accent/50 rounded-lg border border-accent">
                <RefreshCw className="h-4 w-4 text-accent-foreground" />
                <div>
                  <p className="text-xs font-medium text-accent-foreground">Produto existente será atualizado</p>
                  <p className="text-[10px] text-muted-foreground">ID: {item.matched_existing_id} · Confiança: {item.match_confidence}%</p>
                </div>
              </div>
            )}

            {/* Mapped data (what will be injected) */}
            <div>
              <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                Dados a Injetar
                {hasPending && <Badge variant="outline" className="text-[10px] border-primary text-primary">{Object.keys(pendingAdds).length} novos campos</Badge>}
              </h4>
              <div className="border rounded-lg overflow-hidden">
                {sortedMappedKeys.map((key, i) => {
                  const val = pendingAdds[key] !== undefined ? pendingAdds[key] : mapped[key];
                  const hasValue = val !== null && val !== undefined && val !== "";
                  const isPending = key in pendingAdds;
                  if (!hasValue) return null;
                  return (
                    <div key={key} className={cn(
                      "flex gap-3 px-3 py-2 text-sm items-start",
                      isPending ? "bg-primary/5 border-l-2 border-l-primary" : i % 2 === 0 ? "bg-muted/30" : ""
                    )}>
                      <span className="font-medium text-muted-foreground w-40 shrink-0 text-xs flex items-center gap-1">
                        {isPending && <Plus className="h-3 w-3 text-primary" />}
                        {FIELD_LABELS[key] || key}
                      </span>
                      <span className="text-foreground text-xs break-all whitespace-pre-wrap flex-1">
                        {formatValue(val)}
                      </span>
                      {isPending && (
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0 shrink-0" onClick={() => removeFieldFromPending(key)}>
                          <X className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Unmapped source fields — available to add */}
            {unmappedSourceKeys.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Dados Disponíveis (não mapeados) — clique para adicionar
                </h4>
                <div className="border rounded-lg overflow-hidden border-dashed">
                  {unmappedSourceKeys.map((key, i) => (
                    <div
                      key={key}
                      className={cn(
                        "flex gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-primary/5 transition-colors items-center group",
                        i % 2 === 0 ? "bg-muted/20" : ""
                      )}
                      onClick={() => addFieldToMapped(key)}
                    >
                      <span className="font-medium text-muted-foreground w-40 shrink-0 text-xs">{FIELD_LABELS[key] || key}</span>
                      <span className="text-foreground/70 text-xs break-all whitespace-pre-wrap flex-1">
                        {formatValue(source[key])}
                      </span>
                      <Plus className="h-3.5 w-3.5 text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Already mapped source fields (for reference) */}
            {(() => {
              const alreadyMappedSourceKeys = Object.keys(source)
                .filter(k => !k.startsWith("_") && k !== "confidence" && k !== "currency")
                .filter(k => (mapped[k] !== null && mapped[k] !== undefined && mapped[k] !== "") || k in pendingAdds);
              if (alreadyMappedSourceKeys.length === 0) return null;
              return null; // Already shown above in mapped section
            })()}

            {/* Metadata */}
            <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
              {source._confidence && <Badge variant="outline" className="text-[10px]">Confiança: {source._confidence}%</Badge>}
              {source._source && <Badge variant="outline" className="text-[10px]">Fonte: {source._source}</Badge>}
              {source._pageNumber && <Badge variant="outline" className="text-[10px]">Página: {source._pageNumber}</Badge>}
              {(source._pages || []).length > 0 && <Badge variant="outline" className="text-[10px]">Páginas: {source._pages.join(", ")}</Badge>}
            </div>
          </div>
        </ScrollArea>

        {/* Save + Navigation footer */}
        <div className="space-y-2 border-t pt-3 mt-2">
          {hasPending && (
            <div className="flex items-center gap-2 mb-1">
              <Button
                size="sm"
                variant={applyScope === "single" ? "default" : "outline"}
                className="flex-1 h-7 text-xs"
                onClick={() => setApplyScope("single")}
              >
                Só este produto
              </Button>
              <Button
                size="sm"
                variant={applyScope === "all" ? "default" : "outline"}
                className="flex-1 h-7 text-xs"
                onClick={() => setApplyScope("all")}
              >
                Todos do lote ({allItems.length})
              </Button>
            </div>
          )}
          {hasPending && (
            <Button onClick={handleSave} disabled={isSaving} className="w-full h-9 text-sm">
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
              {applyScope === "all"
                ? `Aplicar ${Object.keys(pendingAdds).length} campo(s) a todos os ${allItems.length} produtos`
                : `Guardar ${Object.keys(pendingAdds).length} campo(s) no mapeamento`}
            </Button>
          )}
          {saved && !hasPending && (
            <div className="flex items-center justify-center gap-1.5 text-xs text-primary">
              <CheckCircle className="h-3.5 w-3.5" /> Campos guardados com sucesso
            </div>
          )}
          <div className="flex items-center justify-between">
            <Button size="sm" variant="outline" onClick={onPrevious} disabled={currentIndex <= 0}>
              <ChevronLeft className="h-3 w-3 mr-1" /> Anterior
            </Button>
            <span className="text-xs text-muted-foreground font-medium">
              {currentIndex + 1} de {totalItems}
            </span>
            <Button size="sm" variant="outline" onClick={onNext} disabled={currentIndex >= totalItems - 1}>
              Próximo <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default IngestionHubPage;
