import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  FileText, Upload, Eye, Brain, Send, Loader2, CheckCircle, AlertTriangle, XCircle,
  Table2, Layers, GitCompare, Shield, BarChart3, Languages, Settings2, ArrowRight,
  Scan, MapPin, Database, Package, Trash2, Square, Download, ScanEye,
} from "lucide-react";
import { usePdfExtractions, usePdfPages, usePdfTables, useStartPdfExtraction, useVisionParsePage, useMapPdfToProducts, useDeletePdfExtraction } from "@/hooks/usePdfExtraction";
import { useUploadedFiles } from "@/hooks/useUploadedFiles";
import {
  useSendExtractionToIngestion,
} from "@/hooks/useDocumentIntelligence";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import { toast } from "sonner";
import { PDFUploadDropzone } from "@/components/document-intelligence/PDFUploadDropzone";
import { ExtractionPipelineViewer } from "@/components/document-intelligence/ExtractionPipelineViewer";
import { ExtractionActionsDropdown, ProviderModeSelector } from "@/components/document-intelligence/ExtractionActions";
import { DocumentIntelligenceProviderPanel } from "@/components/document-intelligence/DocumentIntelligenceProviderPanel";
import { DocumentPreviewPanel } from "@/components/document-intelligence/DocumentPreviewPanel";
import { EngineRecommendationCard } from "@/components/document-intelligence/EngineRecommendationCard";
import { MappingEditor } from "@/components/document-intelligence/MappingEditor";
import { DataPreviewTable } from "@/components/document-intelligence/DataPreviewTable";
import { SendToIngestionPanel } from "@/components/document-intelligence/SendToIngestionPanel";
import { PDFVersionCompare } from "@/components/document-intelligence/PDFVersionCompare";

// Flatten nested product structures like [{products: [...], section_title: "..."}] into flat product arrays
function flattenProducts(items: any[]): any[] {
  const flat: any[] = [];

  const walk = (candidate: any, parentSection?: string) => {
    if (candidate == null) return;

    if (Array.isArray(candidate)) {
      candidate.forEach((entry) => walk(entry, parentSection));
      return;
    }

    if (typeof candidate !== "object") return;

    // Section wrapper shape: { section_title, products }
    if (Array.isArray(candidate.products)) {
      const section = typeof candidate.section_title === "string" ? candidate.section_title : parentSection;
      candidate.products.forEach((entry: any) => walk(entry, section));
      return;
    }

    flat.push({ ...candidate, category: candidate.category || parentSection });
  };

  walk(items);
  return flat;
}

function toDisplayText(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    const joined = value
      .map((entry) => toDisplayText(entry, ""))
      .filter(Boolean)
      .join(", ");
    return joined || fallback;
  }

  if (typeof value === "object") {
    const sectionTitle = (value as any)?.section_title;
    if (typeof sectionTitle === "string" || typeof sectionTitle === "number") return String(sectionTitle);
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }

  return fallback;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  queued: { label: "Na fila", variant: "secondary" },
  extracting: { label: "A extrair", variant: "default" },
  reviewing: { label: "Em revisão", variant: "outline" },
  done: { label: "Concluído", variant: "default" },
  error: { label: "Erro", variant: "destructive" },
};

const zoneColors: Record<string, string> = {
  header: "bg-primary/10 text-primary",
  section_title: "bg-accent text-accent-foreground",
  table: "bg-muted text-foreground",
  notes: "bg-secondary text-secondary-foreground",
  note: "bg-secondary text-secondary-foreground",
  footer: "bg-muted text-muted-foreground",
  paragraph: "text-foreground",
  body_text: "text-foreground",
  image: "bg-accent/50 text-accent-foreground",
  caption: "bg-muted text-muted-foreground",
};

const semanticTypeColors: Record<string, string> = {
  sku: "bg-primary/20 text-primary",
  title: "bg-accent text-accent-foreground",
  price: "bg-secondary text-secondary-foreground",
  description: "bg-muted text-foreground",
  dimensions: "bg-primary/10 text-primary",
  capacity: "bg-accent/50 text-accent-foreground",
  material: "bg-secondary/50 text-secondary-foreground",
  unknown: "bg-muted text-muted-foreground",
};

const tableTypeLabels: Record<string, string> = {
  product_table: "Produtos",
  technical_specs: "Especificações",
  pricing_table: "Preços",
  accessories: "Acessórios",
  compatibility: "Compatibilidade",
  spare_parts: "Peças",
};

// Wizard steps — simplified flow
type WizardStep = "upload" | "extracting" | "review" | "ingestion";

const WIZARD_STEPS: { key: WizardStep; label: string; icon: React.ElementType }[] = [
  { key: "upload", label: "Upload", icon: Upload },
  { key: "extracting", label: "Extração AI", icon: Brain },
  { key: "review", label: "Revisão", icon: Package },
  { key: "ingestion", label: "Ingestão", icon: Database },
];

export default function PDFExtractionPage() {
  const { data: extractions, isLoading } = usePdfExtractions();
  const { data: files } = useUploadedFiles();
  const startExtraction = useStartPdfExtraction();
  const mapToProducts = useMapPdfToProducts();
  const deleteExtraction = useDeletePdfExtraction();
  const sendToIngestion = useSendExtractionToIngestion();

  const [selectedExtraction, setSelectedExtraction] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string>("");
  const [activeTab, setActiveTab] = useState("wizard");
  const [executionMode, setExecutionMode] = useState("auto");
  const [manualProvider, setManualProvider] = useState("");
  const [ocrLanguage, setOcrLanguage] = useState("auto");

  // Wizard state
  const [wizardStep, setWizardStep] = useState<WizardStep>("upload");
  const [wizardExtractionId, setWizardExtractionId] = useState<string | null>(null);
  const [reviewDraftProducts, setReviewDraftProducts] = useState<any[] | null>(null);
  const [isSavingReviewDraft, setIsSavingReviewDraft] = useState(false);

  const pdfFiles = (files || []).filter(f => f.file_type === "application/pdf" || f.file_name?.endsWith(".pdf"));
  const activeExtractions = (extractions || []).filter((e: any) => !e.archived_at);

  // Get current wizard extraction details
  const { data: wizardExtraction } = useQuery({
    queryKey: ["wizard-extraction", wizardExtractionId],
    enabled: !!wizardExtractionId,
    refetchInterval: (query) => {
      const ext = query.state.data as any;
      if (ext && ["queued", "extracting", "processing"].includes(ext.status)) return 3000;
      return false;
    },
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pdf_extractions")
        .select("*, uploaded_files:file_id(file_name)")
        .eq("id", wizardExtractionId!)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  // Real progress: count pages actually extracted from pdf_pages table
  const { data: wizardPages } = useQuery({
    queryKey: ["wizard-pages-progress", wizardExtractionId],
    enabled: !!wizardExtractionId,
    refetchInterval: (query) => {
      const ext = wizardExtraction;
      if (ext && ["queued", "extracting", "processing"].includes(ext.status)) return 3000;
      return false;
    },
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pdf_pages")
        .select("id, page_number, status, confidence_score, vision_result")
        .eq("extraction_id", wizardExtractionId!)
        .order("page_number");
      if (error) throw error;
      return data;
    },
  });

  // Keep only the best record per page_number (auto-resume may create duplicates)
  const latestWizardPages = useMemo(() => {
    const pages = wizardPages || [];
    const bestByPage = new Map<number, any>();

    const meaningfulCount = (page: any) =>
      flattenProducts((page?.vision_result as any)?.products || []).filter(
        (prod: any) => prod?.title || prod?.sku || prod?.description || prod?.price != null,
      ).length;

    for (const page of pages) {
      const pageNumber = Number(page?.page_number);
      if (!Number.isFinite(pageNumber)) continue;

      const current = bestByPage.get(pageNumber);
      if (!current) {
        bestByPage.set(pageNumber, page);
        continue;
      }

      const currentProducts = meaningfulCount(current);
      const nextProducts = meaningfulCount(page);
      const currentConfidence = Number(current?.confidence_score || 0);
      const nextConfidence = Number(page?.confidence_score || 0);

      if (
        nextProducts > currentProducts ||
        (nextProducts === currentProducts && nextConfidence > currentConfidence)
      ) {
        bestByPage.set(pageNumber, page);
      }
    }

    return [...bestByPage.values()].sort((a, b) => (a?.page_number || 0) - (b?.page_number || 0));
  }, [wizardPages]);

  const realProgress = useMemo(() => {
    const pages = latestWizardPages;
    const totalPages = wizardExtraction?.total_pages || 0;
    const uniqueExtracted = new Set(pages.filter((p: any) => p.status === "extracted").map((p: any) => p.page_number));
    const uniqueErrors = new Set(pages.filter((p: any) => p.status === "error").map((p: any) => p.page_number));
    const extractedPages = Math.min(uniqueExtracted.size, totalPages);
    const errorPages = Math.min(uniqueErrors.size, totalPages);
    const pct = totalPages > 0 ? Math.min(100, Math.round((extractedPages / totalPages) * 100)) : 0;

    let productCount = 0;
    pages.forEach((p: any) => {
      const products = flattenProducts((p.vision_result as any)?.products || []);
      productCount += products.filter((prod: any) => prod?.title || prod?.sku || prod?.description || prod?.price != null).length;
    });

    return { extractedPages, errorPages, totalPages, pct, productCount };
  }, [latestWizardPages, wizardExtraction?.total_pages]);

  // Products shown in review: prefer compiled extraction rows, fallback to normalized page-level vision data
  const reviewProducts = useMemo(() => {
    const compiled = flattenProducts((wizardExtraction?.detected_products as any[]) || []);
    if (compiled.length > 0) return compiled;

    const fromPages: any[] = [];
    latestWizardPages.forEach((page: any) => {
      fromPages.push(...flattenProducts((page?.vision_result as any)?.products || []));
    });
    return fromPages;
  }, [wizardExtraction?.detected_products, latestWizardPages]);

  const productsForReview = reviewDraftProducts ?? reviewProducts;
  const hasReviewDraftChanges = !!reviewDraftProducts;
  const wizardProductCount = productsForReview.length > 0 ? productsForReview.length : realProgress.productCount;

  const extractionStatus = wizardExtraction?.status;

  // Detect stalled extraction and auto-resume
  const [autoResumeAttempts, setAutoResumeAttempts] = useState(0);
  const [lastResumeTime, setLastResumeTime] = useState(0);
  const [lastProgressAt, setLastProgressAt] = useState(Date.now());
  const [lastExtractedCount, setLastExtractedCount] = useState(0);
  const MAX_AUTO_RESUMES = 5;

  const extractionCompletedByProgress =
    realProgress.totalPages > 0 && realProgress.extractedPages >= realProgress.totalPages;
  const canProceedToReview = wizardProductCount > 0 || realProgress.extractedPages > 0;
  const [isFinishing, setIsFinishing] = useState(false);

  useEffect(() => {
    setLastProgressAt(Date.now());
    setLastExtractedCount(0);
    setReviewDraftProducts(null);
  }, [wizardExtractionId]);

  useEffect(() => {
    if (realProgress.extractedPages > lastExtractedCount) {
      setLastExtractedCount(realProgress.extractedPages);
      setLastProgressAt(Date.now());
    }
  }, [realProgress.extractedPages, lastExtractedCount]);

  const isStalled = useMemo(() => {
    if (!wizardExtraction) return false;
    const status = wizardExtraction.status;
    if (!["extracting", "processing"].includes(status)) return false;
    if (extractionCompletedByProgress) return false; // not stalled if complete
    const totalPages = wizardExtraction.total_pages || 0;
    const extracted = realProgress.extractedPages;
    const elapsedSinceProgress = Date.now() - lastProgressAt;
    return elapsedSinceProgress > 180000 && extracted > 0 && extracted < totalPages;
  }, [wizardExtraction, realProgress.extractedPages, lastProgressAt, extractionCompletedByProgress]);

  // Auto-resume: when stalled is detected, automatically trigger resume (up to MAX attempts)
  useEffect(() => {
    if (!isStalled || !wizardExtractionId) return;
    if (extractionCompletedByProgress) return; // don't resume if already done
    if (autoResumeAttempts >= MAX_AUTO_RESUMES) return;
    if (Date.now() - lastResumeTime < 90000) return;

    logger.info(`Auto-resuming extraction (attempt ${autoResumeAttempts + 1}/${MAX_AUTO_RESUMES})`);
    toast.info(`A retomar extração automaticamente (tentativa ${autoResumeAttempts + 1})...`);
    setAutoResumeAttempts(prev => prev + 1);
    setLastResumeTime(Date.now());

    supabase.functions.invoke("extract-pdf-pages", {
      body: { extractionId: wizardExtractionId },
    }).then(() => {
      toast.success("Extração retomada com sucesso");
    }).catch((err) => {
      logger.error("Auto-resume error:", err);
    });
  }, [isStalled, wizardExtractionId, autoResumeAttempts, lastResumeTime, extractionCompletedByProgress]);

  // Auto-finalize: when all pages are extracted but status is still extracting/processing, finalize
  useEffect(() => {
    if (!wizardExtractionId || !extractionCompletedByProgress || isFinishing) return;
    const status = wizardExtraction?.status;
    if (!status || !["extracting", "processing"].includes(status)) return;

    logger.info("All pages extracted — auto-finalizing extraction");
    handleFinalizeExtraction();
  }, [extractionCompletedByProgress, wizardExtraction?.status, wizardExtractionId, isFinishing]);

  // Finalize: update status to reviewing and compile products
  const handleFinalizeExtraction = async () => {
    if (!wizardExtractionId || isFinishing) return;
    setIsFinishing(true);
    try {
      // Mark as reviewing
      await supabase.from("pdf_extractions").update({ status: "reviewing" }).eq("id", wizardExtractionId);
      // Compile products
      await supabase.functions.invoke("map-pdf-to-products", {
        body: { extractionId: wizardExtractionId },
      });
      toast.success("Extração finalizada — produtos compilados");
    } catch (err) {
      logger.error("Finalize error:", err);
      toast.error("Erro ao finalizar extração");
    } finally {
      setIsFinishing(false);
    }
  };

  // Step 1: Start extraction — goes straight to extracting
  const handleStartWizard = async () => {
    if (!selectedFileId) { toast.error("Seleciona um ficheiro PDF"); return; }
    try {
      const result = await startExtraction.mutateAsync({ fileId: selectedFileId, language: ocrLanguage !== "auto" ? ocrLanguage : undefined });
      setWizardExtractionId(result.extractionId);
      setWizardStep("extracting");
      setAutoResumeAttempts(0);
      setLastResumeTime(0);
    } catch {}
  };

  const handleFileUploaded = (fileId: string) => {
    setSelectedFileId(fileId);
  };

  // Auto-advance to review when extraction is done
  useEffect(() => {
    if (wizardStep !== "extracting") return;

    const backendReady = extractionStatus === "reviewing" && canProceedToReview;
    const progressReady = extractionCompletedByProgress && canProceedToReview;

    if (backendReady || progressReady) {
      setWizardStep("review");
    }
  }, [wizardStep, extractionStatus, canProceedToReview, extractionCompletedByProgress]);

  // Resume a stalled extraction (manual) — only if not already complete
  const handleResumeExtraction = async () => {
    if (!wizardExtractionId) return;
    if (extractionCompletedByProgress) {
      toast.info("Todas as páginas já foram extraídas — a finalizar...");
      handleFinalizeExtraction();
      return;
    }
    toast.info("A retomar extração...");
    setAutoResumeAttempts(0);
    setLastResumeTime(Date.now());
    supabase.functions.invoke("extract-pdf-pages", {
      body: { extractionId: wizardExtractionId },
    }).then(() => {
      toast.success("Extração retomada com sucesso");
    }).catch((err) => {
      logger.error("Resume error:", err);
      toast.error("Erro ao retomar extração");
    });
  };

  const persistReviewDraft = async (options?: { silent?: boolean }) => {
    if (!wizardExtractionId || !reviewDraftProducts) return;

    setIsSavingReviewDraft(true);
    try {
      const { error } = await supabase
        .from("pdf_extractions")
        .update({ status: "reviewing", detected_products: reviewDraftProducts })
        .eq("id", wizardExtractionId);

      if (error) throw error;

      setReviewDraftProducts(null);
      if (!options?.silent) toast.success("Alterações guardadas na revisão");
    } catch (error: any) {
      toast.error(`Erro ao guardar revisão: ${error?.message || "erro desconhecido"}`);
      throw error;
    } finally {
      setIsSavingReviewDraft(false);
    }
  };

  const handleProceedToIngestion = async () => {
    if (hasReviewDraftChanges) {
      try {
        await persistReviewDraft({ silent: true });
      } catch {
        return;
      }
    }
    setWizardStep("ingestion");
  };

  const handleSendToIngestion = async (config: { mergeStrategy: string; dupFields: string }) => {
    if (!wizardExtractionId) return;

    if (hasReviewDraftChanges) {
      await persistReviewDraft({ silent: true });
    }

    await sendToIngestion.mutateAsync({
      extractionId: wizardExtractionId,
      mergeStrategy: config.mergeStrategy,
      dupFields: config.dupFields,
    });
  };

  const openExtractionInWizard = (ext: any) => {
    setWizardExtractionId(ext.id);
    setActiveTab("wizard");

    if (["queued", "extracting", "processing", "error"].includes(ext.status)) {
      setWizardStep("extracting");
      return;
    }

    if (ext.sent_to_ingestion) {
      setWizardStep("ingestion");
      return;
    }

    setWizardStep("review");
  };

  const resetWizard = () => {
    setWizardStep("upload");
    setWizardExtractionId(null);
    setSelectedFileId("");
    setReviewDraftProducts(null);
  };

  // Quick extraction from history table
  const handleQuickExtraction = () => {
    if (!selectedFileId) { toast.error("Seleciona um ficheiro PDF"); return; }
    startExtraction.mutate({ fileId: selectedFileId, language: ocrLanguage !== "auto" ? ocrLanguage : undefined });
    setSelectedFileId("");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Extração de Catálogos PDF</h1>
          <p className="text-muted-foreground">Extraia automaticamente produtos de catálogos PDF com inteligência artificial avançada</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="wizard" className="gap-2"><Layers className="h-4 w-4" /> Fluxo Assistido</TabsTrigger>
          <TabsTrigger value="extractions" className="gap-2"><FileText className="h-4 w-4" /> Histórico</TabsTrigger>
          <TabsTrigger value="providers" className="gap-2"><Settings2 className="h-4 w-4" /> Providers</TabsTrigger>
          <TabsTrigger value="compare" className="gap-2"><GitCompare className="h-4 w-4" /> Comparar</TabsTrigger>
        </TabsList>

        {/* ═══════════════ WIZARD TAB ═══════════════ */}
        <TabsContent value="wizard" className="space-y-6">
          {/* Step indicator */}
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {WIZARD_STEPS.map((step, i) => {
              const StepIcon = step.icon;
              const isActive = step.key === wizardStep;
              const stepIdx = WIZARD_STEPS.findIndex((s) => s.key === wizardStep);
              const isDone = i < stepIdx;
              return (
                <div key={step.key} className="flex items-center gap-1">
                  {i > 0 && <div className={`w-6 h-px ${isDone ? "bg-primary" : "bg-border"}`} />}
                  <div
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                      isActive ? "bg-primary text-primary-foreground" :
                      isDone ? "bg-primary/10 text-primary" :
                      "bg-muted text-muted-foreground"
                    }`}
                    onClick={() => { if (isDone) setWizardStep(step.key); }}
                  >
                    {isDone ? <CheckCircle className="h-3 w-3" /> : <StepIcon className="h-3 w-3" />}
                    {step.label}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Step: Upload */}
          {wizardStep === "upload" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><Upload className="h-5 w-5" /> Upload Direto de PDF</CardTitle>
                  <CardDescription>Arraste um PDF ou clique para selecionar</CardDescription>
                </CardHeader>
                <CardContent>
                  <PDFUploadDropzone onFileUploaded={handleFileUploaded} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-5 w-5" /> Selecionar PDF Existente</CardTitle>
                  <CardDescription>Escolha um PDF já carregado na biblioteca</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Select value={selectedFileId} onValueChange={setSelectedFileId}>
                    <SelectTrigger><SelectValue placeholder="Seleciona um PDF..." /></SelectTrigger>
                    <SelectContent>
                      {pdfFiles.map(f => (
                        <SelectItem key={f.id} value={f.id}>{f.file_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Language selector for OCR */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
                      <Languages className="h-3 w-3" /> Idioma do Documento (OCR)
                    </label>
                    <Select value={ocrLanguage} onValueChange={setOcrLanguage}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">🔍 Auto-detetar</SelectItem>
                        <SelectItem value="pt">🇵🇹 Português</SelectItem>
                        <SelectItem value="es">🇪🇸 Español</SelectItem>
                        <SelectItem value="en">🇬🇧 English</SelectItem>
                        <SelectItem value="fr">🇫🇷 Français</SelectItem>
                        <SelectItem value="de">🇩🇪 Deutsch</SelectItem>
                        <SelectItem value="it">🇮🇹 Italiano</SelectItem>
                        <SelectItem value="nl">🇳🇱 Nederlands</SelectItem>
                        <SelectItem value="pl">🇵🇱 Polski</SelectItem>
                        <SelectItem value="tr">🇹🇷 Türkçe</SelectItem>
                        <SelectItem value="ru">🇷🇺 Русский</SelectItem>
                        <SelectItem value="zh">🇨🇳 中文</SelectItem>
                        <SelectItem value="ja">🇯🇵 日本語</SelectItem>
                        <SelectItem value="ko">🇰🇷 한국어</SelectItem>
                        <SelectItem value="ar">🇸🇦 العربية</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button onClick={handleStartWizard} disabled={startExtraction.isPending || !selectedFileId} className="w-full">
                    {startExtraction.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                    Iniciar Análise do Documento
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step: Extracting (auto, shows progress) */}
          {wizardStep === "extracting" && (
            <Card>
              <CardContent className="py-8">
                <div className="flex flex-col items-center gap-5 max-w-md mx-auto">
                  {extractionStatus === "error" ? (
                    <>
                      <XCircle className="h-10 w-10 text-destructive" />
                      <p className="text-sm font-medium">Erro na extração</p>
                      {realProgress.extractedPages > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {realProgress.extractedPages} páginas foram extraídas antes do erro ({realProgress.productCount} produtos encontrados)
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button variant="default" onClick={handleResumeExtraction}>
                          <ArrowRight className="h-4 w-4 mr-2" /> Retomar extração
                        </Button>
                        <Button variant="outline" onClick={resetWizard}>
                          <Upload className="h-4 w-4 mr-2" /> Recomeçar
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Loader2 className="h-10 w-10 animate-spin text-primary" />
                      <div className="w-full space-y-3">
                        <div className="text-center">
                          <p className="text-sm font-medium">A extrair produtos do PDF com AI Vision...</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {(wizardExtraction as any)?.uploaded_files?.file_name || "PDF"}
                          </p>
                        </div>

                        {/* Progress bar */}
                        <div className="space-y-1.5">
                          <Progress value={realProgress.pct} className="h-2.5" />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{realProgress.extractedPages} de {realProgress.totalPages || "?"} páginas</span>
                            <span>{realProgress.pct}%</span>
                          </div>
                        </div>

                        {/* Stats cards */}
                        <div className="grid grid-cols-3 gap-2 mt-3">
                          <div className="bg-muted rounded-lg p-2.5 text-center">
                            <p className="text-lg font-bold text-foreground">{realProgress.productCount}</p>
                            <p className="text-[10px] text-muted-foreground">Produtos</p>
                          </div>
                          <div className="bg-muted rounded-lg p-2.5 text-center">
                            <p className="text-lg font-bold text-foreground">{realProgress.extractedPages}</p>
                            <p className="text-[10px] text-muted-foreground">Páginas OK</p>
                          </div>
                          <div className="bg-muted rounded-lg p-2.5 text-center">
                            <p className="text-lg font-bold text-foreground">{realProgress.errorPages}</p>
                            <p className="text-[10px] text-muted-foreground">Erros</p>
                          </div>
                        </div>

                        {/* Stalled warning — auto-resume active */}
                        {isStalled && (
                          <div className={`border rounded-lg p-3 text-center space-y-2 ${
                            autoResumeAttempts >= MAX_AUTO_RESUMES 
                              ? "bg-destructive/10 border-destructive/20" 
                              : "bg-primary/5 border-primary/20"
                          }`}>
                            <div className="flex items-center justify-center gap-2">
                              {autoResumeAttempts >= MAX_AUTO_RESUMES ? (
                                <>
                                  <AlertTriangle className="h-4 w-4 text-destructive" />
                                  <p className="text-xs font-medium text-destructive">Auto-retoma esgotada ({MAX_AUTO_RESUMES} tentativas)</p>
                                </>
                              ) : (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                  <p className="text-xs font-medium text-primary">A retomar automaticamente (tentativa {autoResumeAttempts}/{MAX_AUTO_RESUMES})</p>
                                </>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              {realProgress.extractedPages} de {realProgress.totalPages} páginas processadas — {realProgress.totalPages - realProgress.extractedPages} restantes
                            </p>
                            <Button size="sm" variant={autoResumeAttempts >= MAX_AUTO_RESUMES ? "default" : "outline"} onClick={handleResumeExtraction}>
                              <ArrowRight className="h-3 w-3 mr-1" /> Retomar manualmente
                            </Button>
                          </div>
                        )}

                        {canProceedToReview && (
                          <div className="flex justify-center gap-2 mt-1">
                            <Button size="sm" variant="default" onClick={handleFinalizeExtraction} disabled={isFinishing}>
                              {isFinishing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Square className="h-3 w-3 mr-1" />}
                              Terminar extração
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setWizardStep("review")}>
                              <ArrowRight className="h-3 w-3 mr-1" />
                              Continuar para revisão
                            </Button>
                          </div>
                        )}

                        <p className="text-[10px] text-muted-foreground text-center mt-2">
                          Podes sair desta página — a extração continua em segundo plano.
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step: Review — compiled product table */}
          {wizardStep === "review" && (
            <div className="space-y-4">
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Package className="h-5 w-5 text-primary" /> Revisão de Produtos
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="default">{wizardProductCount} produtos</Badge>
                      <Badge variant="secondary">{productsForReview.filter((p: any) => p._approved).length} aprovados</Badge>
                    </div>
                  </div>
                  <CardDescription>
                    Revise, edite e aprove cada produto antes de enviar para ingestão.
                    Pode aprovar individualmente ou em massa. Apenas produtos aprovados serão enviados.
                  </CardDescription>
                </CardHeader>
              </Card>

              <DataPreviewTable
                products={productsForReview}
                columns={undefined}
                editable
                showApproval
                onProductsChange={(products) => setReviewDraftProducts(products)}
              />

              <div className="flex flex-wrap items-center gap-3">
                {hasReviewDraftChanges && <Badge variant="secondary">Alterações por guardar</Badge>}
                <Button variant="outline" onClick={() => persistReviewDraft()} disabled={!hasReviewDraftChanges || isSavingReviewDraft}>
                  {isSavingReviewDraft ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Guardar alterações
                </Button>
                <Button variant="outline" onClick={() => {
                  const data = productsForReview;
                  if (!data || data.length === 0) { toast.error("Sem produtos para exportar"); return; }
                  import("xlsx").then(XLSX => {
                    const exportRows = data.map((p: any, idx: number) => {
                      const pricing = p.pricing || {};
                      const tiers = Array.isArray(pricing.price_tiers) && pricing.price_tiers.length > 0
                        ? pricing.price_tiers.map((t: any) => `${t.min_qty}${t.max_qty ? `-${t.max_qty}` : "+"}un: ${t.price}€${t.discount_pct ? ` (-${t.discount_pct}%)` : ""}`).join("; ")
                        : "";
                      return {
                        "#": idx + 1,
                        "SKU": p.sku || p.ref || "",
                        "Título": p.title || p.name || "",
                        "Preço": p.price || "",
                        "Preço Unitário": pricing.unit_price || "",
                        "PVP Recomendado": pricing.rrp || "",
                        "Embalagem": pricing.pack_size ? `${pricing.pack_size}x` : "",
                        "Preço Embalagem": pricing.pack_price || "",
                        "Preço Bulk": pricing.bulk_price || "",
                        "Margem %": pricing.margin_pct ? `${pricing.margin_pct}%` : "",
                        "Escalões Preço": tiers,
                        "Notas Preço": pricing.price_notes || "",
                        "Categoria": p.category || "",
                        "Descrição": (p.description || "").slice(0, 500),
                        "Descrição Curta": (p.short_description || "").slice(0, 300),
                        "Material": p.material || "",
                        "Dimensões": p.dimensions || "",
                        "Peso": p.weight || "",
                        "Marca": p.brand || "",
                        "Modelo": p.model || "",
                        "EAN": p.ean || p.gtin || "",
                        "Imagens": Array.isArray(p.images) ? p.images.join(" | ") : (p.image || ""),
                        "Aprovado": p._approved ? "Sim" : "Não",
                      };
                    });
                    const ws = XLSX.utils.json_to_sheet(exportRows);
                    // Auto-width columns
                    const colWidths = Object.keys(exportRows[0] || {}).map(key => ({
                      wch: Math.max(key.length, ...exportRows.map(r => String((r as any)[key] || "").length).slice(0, 50)) + 2
                    }));
                    ws["!cols"] = colWidths.map(c => ({ wch: Math.min(c.wch, 60) }));
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Produtos PDF");
                    const fileName = wizardExtraction?.uploaded_files?.file_name?.replace(/\.pdf$/i, "") || "pdf-extraction";
                    XLSX.writeFile(wb, `${fileName}-produtos.xlsx`);
                    toast.success(`${exportRows.length} produtos exportados para Excel`);
                  });
                }}>
                  <Download className="h-4 w-4 mr-2" /> Exportar Excel
                </Button>
                <Button onClick={handleProceedToIngestion} disabled={isSavingReviewDraft}>
                  <ArrowRight className="h-4 w-4 mr-2" /> Avançar para Ingestão
                </Button>
                <Button variant="outline" onClick={resetWizard}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {/* Step: Ingestion */}
          {wizardStep === "ingestion" && (
            <div className="space-y-4">
              <SendToIngestionPanel
                productCount={wizardProductCount}
                approvedCount={productsForReview.filter((p: any) => p._approved).length}
                onSendToIngestion={handleSendToIngestion}
                isSending={sendToIngestion.isPending}
                alreadySent={wizardExtraction?.sent_to_ingestion}
                requireApproval
              />
              {wizardExtraction?.sent_to_ingestion && (
                <div className="flex gap-3">
                  <Button variant="outline" onClick={resetWizard}>
                    <Upload className="h-4 w-4 mr-2" /> Novo Documento
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ═══════════════ HISTORY TAB ═══════════════ */}
        <TabsContent value="extractions" className="space-y-6">
          {/* Quick extraction */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Extração Rápida</CardTitle>
              <CardDescription>Sem fluxo assistido — extrai diretamente</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-3">
              <Select value={selectedFileId} onValueChange={setSelectedFileId}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Seleciona PDF..." /></SelectTrigger>
                <SelectContent>
                  {pdfFiles.map(f => (
                    <SelectItem key={f.id} value={f.id}>{f.file_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ProviderModeSelector
                mode={executionMode}
                onModeChange={setExecutionMode}
                manualProvider={manualProvider}
                onManualProviderChange={setManualProvider}
              />
              <Button onClick={handleQuickExtraction} disabled={startExtraction.isPending || !selectedFileId}>
                {startExtraction.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
                Extrair
              </Button>
            </CardContent>
          </Card>

          {/* Extractions Table */}
          <Card>
            <CardHeader><CardTitle>Histórico de Extrações</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : !activeExtractions?.length ? (
                <p className="text-muted-foreground text-center py-8">Nenhuma extração ainda</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ficheiro</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Páginas</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Modelo</TableHead>
                      <TableHead>Modo</TableHead>
                      <TableHead>Fallback</TableHead>
                      <TableHead>Ingestão</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeExtractions.map((ext: any) => {
                      const sc = statusConfig[ext.status] || statusConfig.queued;
                      const canOpenWizard = ["queued", "extracting", "processing", "reviewing", "done", "error"].includes(ext.status);
                      const canSendFromHistory = ["reviewing", "done"].includes(ext.status) && !ext.sent_to_ingestion;
                      const processedPages = Number(ext.processed_pages || 0) > 0
                        ? Number(ext.processed_pages)
                        : (["reviewing", "done"].includes(ext.status) ? Number(ext.total_pages || 0) : 0);

                      return (
                        <TableRow key={ext.id}>
                          <TableCell className="font-medium text-sm">{ext.uploaded_files?.file_name || "—"}</TableCell>
                          <TableCell><Badge variant={sc.variant}>{sc.label}</Badge></TableCell>
                          <TableCell className="text-sm">{processedPages}/{ext.total_pages || 0}</TableCell>
                          <TableCell className="text-xs">{ext.provider_used || "—"}</TableCell>
                          <TableCell className="text-xs">{ext.provider_model || ext.model_used || "—"}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{ext.extraction_mode || "auto"}</Badge></TableCell>
                          <TableCell>
                            {ext.fallback_used ? (
                              <Badge variant="secondary" className="text-[10px]">{ext.fallback_provider}</Badge>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>
                            {ext.sent_to_ingestion ? (
                              <Badge variant="default" className="text-[10px]">Enviado</Badge>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-xs">{new Date(ext.created_at).toLocaleDateString("pt-PT")}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" onClick={() => setSelectedExtraction(ext.id)}>
                                <Eye className="h-3 w-3" />
                              </Button>

                              {canOpenWizard && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button size="sm" variant="outline" className="text-primary" onClick={() => openExtractionInWizard(ext)}>
                                      <ArrowRight className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {ext.sent_to_ingestion ? "Abrir estado de ingestão" : "Abrir revisão/ingestão no fluxo"}
                                  </TooltipContent>
                                </Tooltip>
                              )}

                              {["extracting", "processing"].includes(ext.status) && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button size="sm" variant="outline" onClick={() => {
                                      toast.info("A retomar extração...");
                                      supabase.functions.invoke("extract-pdf-pages", {
                                        body: { extractionId: ext.id },
                                      }).then(() => toast.success("Retomada")).catch(() => toast.error("Erro ao retomar"));
                                    }}>
                                      <Scan className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Retomar extração</TooltipContent>
                                </Tooltip>
                              )}

                              {canSendFromHistory && (
                                <>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button size="sm" variant="outline" onClick={() => mapToProducts.mutate({ extractionId: ext.id })}>
                                        <Table2 className="h-3 w-3" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Recompilar produtos</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button size="sm" onClick={() => mapToProducts.mutate({ extractionId: ext.id, sendToIngestion: true })}>
                                        <Send className="h-3 w-3" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Enviar para ingestão</TooltipContent>
                                  </Tooltip>
                                </>
                              )}

                              {["reviewing", "done"].includes(ext.status) && ext.detected_products && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button size="sm" variant="outline" onClick={() => {
                                      const products = Array.isArray(ext.detected_products) ? ext.detected_products : [];
                                      if (products.length === 0) { toast.error("Sem produtos para exportar"); return; }
                                      import("xlsx").then(XLSX => {
                                        const rows = products.map((p: any, idx: number) => {
                                          const pricing = p.pricing || {};
                                          const tiers = Array.isArray(pricing.price_tiers) && pricing.price_tiers.length > 0
                                            ? pricing.price_tiers.map((t: any) => `${t.min_qty}${t.max_qty ? `-${t.max_qty}` : "+"}un: ${t.price}€${t.discount_pct ? ` (-${t.discount_pct}%)` : ""}`).join("; ")
                                            : "";
                                          return {
                                            "#": idx + 1,
                                            "SKU": p.sku || p.ref || "",
                                            "Título": p.title || p.name || "",
                                            "Preço": p.price || "",
                                            "Preço Unitário": pricing.unit_price || "",
                                            "PVP": pricing.rrp || "",
                                            "Escalões": tiers,
                                            "Preço Bulk": pricing.bulk_price || "",
                                            "Categoria": p.category || "",
                                            "Descrição": (p.description || "").slice(0, 500),
                                            "Material": p.material || "",
                                            "Dimensões": p.dimensions || "",
                                            "Marca": p.brand || "",
                                            "Imagens": Array.isArray(p.images) ? p.images.join(" | ") : (p.image || ""),
                                          };
                                        });
                                        const ws = XLSX.utils.json_to_sheet(rows);
                                        const wb = XLSX.utils.book_new();
                                        XLSX.utils.book_append_sheet(wb, ws, "Produtos PDF");
                                        const fileName = ext.uploaded_files?.file_name?.replace(/\.pdf$/i, "") || "pdf-extraction";
                                        XLSX.writeFile(wb, `${fileName}-produtos.xlsx`);
                                        toast.success(`${rows.length} produtos exportados`);
                                      });
                                    }}>
                                      <Download className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Exportar para Excel</TooltipContent>
                                </Tooltip>
                              )}

                              <ExtractionActionsDropdown extraction={ext} onViewDetails={setSelectedExtraction} />
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => {
                                  if (confirm("Eliminar esta extração e todos os dados associados?")) {
                                    deleteExtraction.mutate(ext.id);
                                  }
                                }}
                                disabled={deleteExtraction.isPending}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════ PROVIDERS TAB ═══════════════ */}
        <TabsContent value="providers">
          <DocumentIntelligenceProviderPanel />
        </TabsContent>

        {/* ═══════════════ COMPARE TAB ═══════════════ */}
        <TabsContent value="compare">
          <PDFVersionCompare extractions={activeExtractions} />
        </TabsContent>
      </Tabs>

      {selectedExtraction && (
        <ExtractionDetailDialog extractionId={selectedExtraction} onClose={() => setSelectedExtraction(null)} />
      )}
    </div>
  );
}

function ExtractionDetailDialog({ extractionId, onClose }: { extractionId: string; onClose: () => void }) {
  const { data: pages, isLoading } = usePdfPages(extractionId);
  const pageIds = (pages || []).map((p: any) => p.id);
  const { data: tables } = usePdfTables(pageIds);
  const visionParse = useVisionParsePage();
  const [activeTab, setActiveTab] = useState("pages");
  const [reconcilePageId, setReconcilePageId] = useState<string | null>(null);

  const { data: extraction } = useQuery({
    queryKey: ["pdf-extraction-detail", extractionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("pdf_extractions").select("*").eq("id", extractionId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: metrics } = useQuery({
    queryKey: ["pdf-extraction-metrics", extractionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("pdf_extraction_metrics" as any).select("*").eq("extraction_id", extractionId).order("created_at", { ascending: false }).limit(1);
      if (error) return null;
      return (data as any[])?.[0] || null;
    },
  });

  const { data: sections } = useQuery({
    queryKey: ["pdf-sections", pageIds],
    enabled: pageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("pdf_sections" as any).select("*").in("page_id", pageIds);
      if (error) return [];
      return data as any[];
    },
  });

  const selectedPage = reconcilePageId ? (pages || []).find((p: any) => p.id === reconcilePageId) : null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" /> Document Intelligence — Detalhes
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-1">
            <ExtractionPipelineViewer
              providerUsed={(extraction as any)?.provider_used}
              providerModel={(extraction as any)?.provider_model || (extraction as any)?.model_used}
              extractionMode={(extraction as any)?.extraction_mode}
              fallbackUsed={(extraction as any)?.fallback_used}
              fallbackProvider={(extraction as any)?.fallback_provider}
              status={(extraction as any)?.status}
            />
          </div>

          <div className="col-span-3">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="pages">Páginas ({pages?.length || 0})</TabsTrigger>
                <TabsTrigger value="tables">Tabelas ({tables?.length || 0})</TabsTrigger>
                <TabsTrigger value="reconcile">Reconciliação</TabsTrigger>
                <TabsTrigger value="metrics">Métricas</TabsTrigger>
              </TabsList>

              <TabsContent value="pages">
                <ScrollArea className="h-[60vh]">
                  {isLoading ? (
                    <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                  ) : (
                    <div className="space-y-4">
                      {(pages || []).filter((p: any) => {
                        const productCount = (p.page_context as any)?.product_count || 0;
                        const hasContent = (p.raw_text || "").length > 10;
                        return productCount > 0 || hasContent;
                      }).map((page: any) => {
                        const products = flattenProducts((page.vision_result as any)?.products || []);
                        const pageCtx = page.page_context as any;
                        const productCount = pageCtx?.product_count || products.length || 0;
                        return (
                        <Card key={page.id}>
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-sm flex items-center gap-2">
                                Página {page.page_number}
                                {productCount > 0 && (
                                  <Badge variant="default" className="text-xs">{productCount} produto{productCount !== 1 ? "s" : ""}</Badge>
                                )}
                              </CardTitle>
                               <div className="flex items-center gap-2">
                                 {(page as any).is_scanned && (
                                   <Tooltip>
                                     <TooltipTrigger>
                                       <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30 flex items-center gap-1">
                                         <ScanEye className="h-3 w-3" /> OCR
                                       </Badge>
                                     </TooltipTrigger>
                                     <TooltipContent>Página digitalizada — texto extraído via OCR/Vision AI</TooltipContent>
                                   </Tooltip>
                                 )}
                                 {pageCtx?.page_type && (
                                   <Badge variant="outline" className="text-xs">{toDisplayText(pageCtx.page_type, "N/A")}</Badge>
                                 )}
                                 {pageCtx?.section_title && (
                                   <Badge variant="secondary" className="text-xs">{toDisplayText(pageCtx.section_title, "Secção")}</Badge>
                                 )}
                                 {pageCtx?.language && (
                                   <Badge variant="outline" className="text-xs flex items-center gap-1">
                                     <Languages className="h-3 w-3" /> {toDisplayText(typeof pageCtx.language === "string" ? pageCtx.language : pageCtx.language?.language, "—")}
                                   </Badge>
                                 )}
                                 <Badge variant="outline">Confiança: {page.confidence_score}%</Badge>
                               </div>
                            </div>
                          </CardHeader>
                          <CardContent>
                            {(page.zones || []).length > 0 && (
                              <div className="mb-3 flex flex-wrap gap-1">
                                {(page.zones || []).map((z: any, i: number) => (
                                  <Badge key={i} variant="outline" className={`text-xs ${zoneColors[z.type] || ""}`}>
                                    {toDisplayText(z.type || z.content_summary)}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            {/* Show extracted products in a clean table format */}
                            {products.length > 0 ? (
                              <div className="overflow-auto">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="text-xs">SKU</TableHead>
                                      <TableHead className="text-xs">Produto</TableHead>
                                      <TableHead className="text-xs">Preço</TableHead>
                                      <TableHead className="text-xs">Categoria</TableHead>
                                      <TableHead className="text-xs">Confiança</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {products.slice(0, 10).map((prod: any, pi: number) => (
                                      <TableRow key={pi}>
                                        <TableCell className="text-xs font-mono">{toDisplayText(prod.sku)}</TableCell>
                                        <TableCell className="text-xs">
                                          <div className="font-medium">{toDisplayText(prod.title)}</div>
                                          {toDisplayText(prod.description, "") && (
                                            <div className="text-muted-foreground text-[10px] mt-0.5 truncate max-w-xs">{toDisplayText(prod.description, "")}</div>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-xs">{prod.price ? `${prod.currency || "€"}${prod.price}` : "—"}</TableCell>
                                        <TableCell className="text-xs">{toDisplayText(prod.category ?? pageCtx?.section_title)}</TableCell>
                                        <TableCell>
                                          <div className="flex items-center gap-1">
                                            {(prod.confidence || 0) >= 80 && <CheckCircle className="h-3 w-3 text-primary" />}
                                            {(prod.confidence || 0) >= 50 && (prod.confidence || 0) < 80 && <AlertTriangle className="h-3 w-3 text-accent-foreground" />}
                                            {(prod.confidence || 0) < 50 && <XCircle className="h-3 w-3 text-destructive" />}
                                            <span className="text-xs">{prod.confidence || 0}%</span>
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                                {products.length > 10 && (
                                  <p className="text-xs text-muted-foreground mt-1">A mostrar 10 de {products.length} produtos</p>
                                )}
                              </div>
                            ) : (
                              <pre className="text-xs bg-muted p-3 rounded-md max-h-24 overflow-auto whitespace-pre-wrap font-mono">
                                {(page.raw_text || "Sem conteúdo extraído").substring(0, 300)}
                              </pre>
                            )}
                          </CardContent>
                        </Card>
                      )})}
                      {(pages || []).filter((p: any) => ((p.page_context as any)?.product_count || 0) === 0 && (p.raw_text || "").length <= 10).length > 0 && (
                        <p className="text-xs text-muted-foreground text-center">
                          {(pages || []).filter((p: any) => ((p.page_context as any)?.product_count || 0) === 0).length} páginas sem produtos (capas, índices, etc.)
                        </p>
                      )}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="tables">
                <ScrollArea className="h-[60vh]">
                  <div className="space-y-4">
                    {(tables || []).map((table: any) => (
                      <Card key={table.id}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <CardTitle className="text-sm flex items-center gap-2">
                                Tabela #{table.table_index} — {table.row_count}×{table.col_count}
                                {table.table_type && (
                                  <Badge variant="secondary" className="text-xs">{tableTypeLabels[table.table_type] || table.table_type}</Badge>
                                )}
                                {table.table_type === "pricing_table" && (
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Badge variant="default" className="text-xs">💰 Preços Estruturados</Badge>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Tabela com preços unitários, escalões de quantidade, descontos ou preços de embalagem detetados automaticamente</p></TooltipContent>
                                  </Tooltip>
                                )}
                              </CardTitle>
                              {table.template_id && (
                                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Shield className="h-3 w-3" /> Template aplicado</p>
                              )}
                            </div>
                            <Badge variant="outline">Confiança: {table.confidence_score}%</Badge>
                          </div>
                          {(table.column_classifications || []).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {(table.column_classifications || []).map((col: any, i: number) => (
                                <Tooltip key={i}>
                                  <TooltipTrigger>
                                    <Badge variant="secondary" className={`text-xs ${semanticTypeColors[col.semantic_type] || ""}`}>
                                      {col.header}: {col.semantic_type}
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent><p>Fonte: {col.source} | Confiança: {col.confidence}%</p></TooltipContent>
                                </Tooltip>
                              ))}
                            </div>
                          )}
                        </CardHeader>
                        <CardContent>
                          <div className="overflow-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  {(table.headers || []).map((h: string, i: number) => {
                                    const col = (table.column_classifications || [])[i];
                                    return (
                                      <TableHead key={i} className="text-xs">
                                        <div>{h}</div>
                                        {col && <div className="text-[10px] font-normal text-muted-foreground">{col.semantic_type}</div>}
                                      </TableHead>
                                    );
                                  })}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(table.pdf_table_rows || []).slice(0, 15).map((row: any) => (
                                  <TableRow key={row.id}>
                                    {((row.reconciled_cells?.length ? row.reconciled_cells : row.cells) || []).map((cell: any, ci: number) => (
                                      <TableCell key={ci} className="text-xs">
                                        <Tooltip>
                                          <TooltipTrigger>
                                            <div className="flex items-center gap-1">
                                              <span>{cell.value}</span>
                                              {cell.confidence >= 80 && <CheckCircle className="h-3 w-3 text-primary shrink-0" />}
                                              {cell.confidence >= 50 && cell.confidence < 80 && <AlertTriangle className="h-3 w-3 text-accent-foreground shrink-0" />}
                                              {cell.confidence < 50 && <XCircle className="h-3 w-3 text-destructive shrink-0" />}
                                            </div>
                                          </TooltipTrigger>
                                          <TooltipContent className="max-w-xs">
                                            <p className="text-xs">Confiança: {cell.confidence}%</p>
                                            <p className="text-xs">Fonte: {cell.source}</p>
                                            {cell.semantic_type && <p className="text-xs">Tipo: {cell.semantic_type}</p>}
                                          </TooltipContent>
                                        </Tooltip>
                                      </TableCell>
                                    ))}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                            {(table.pdf_table_rows || []).length > 15 && (
                              <p className="text-xs text-muted-foreground mt-2">A mostrar 15 de {table.pdf_table_rows.length} linhas</p>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {(!tables || tables.length === 0) && (
                      <p className="text-muted-foreground text-center py-8">Nenhuma tabela detectada</p>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="reconcile">
                <ScrollArea className="h-[60vh]">
                  {!selectedPage ? (
                    <div className="text-center py-8">
                      <GitCompare className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-muted-foreground">Seleciona uma página na tab "Páginas" para ver a reconciliação</p>
                    </div>
                  ) : (
                    <Card>
                      <CardHeader><CardTitle className="text-sm">Reconciliação — Página {selectedPage.page_number}</CardTitle></CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <h4 className="text-xs font-semibold mb-2 flex items-center gap-1"><FileText className="h-3 w-3" /> Texto</h4>
                            <div className="bg-muted rounded-md p-2 max-h-60 overflow-auto">
                              {(((selectedPage.text_result as any)?.zones || (selectedPage.layout_zones as any[]) || []) as any[]).map((z: any, i: number) => (
                                <div key={i} className={`text-xs p-1 mb-1 rounded ${zoneColors[z.type] || ""}`}>
                                  <span className="font-medium">[{toDisplayText(z.type)}]</span> {toDisplayText(z.content || z.content_summary, "").toString().substring(0, 80)}
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <h4 className="text-xs font-semibold mb-2 flex items-center gap-1"><Brain className="h-3 w-3" /> Visão AI</h4>
                            <div className="bg-muted rounded-md p-2 max-h-60 overflow-auto">
                              {((selectedPage.vision_result as any)?.tables?.length > 0) ? (
                                (((selectedPage.vision_result as any).tables || []) as any[]).map((t: any, i: number) => (
                                  <div key={i} className="text-xs p-1 mb-1 border-b border-border">
                                    <span className="font-medium">Tabela {i + 1}:</span> {toDisplayText((t.headers || []).join(", "))}
                                    <br />
                                    <span className="text-muted-foreground">{toDisplayText((t.rows || []).length)} linhas, confiança {toDisplayText(t.confidence)}%</span>
                                  </div>
                                ))
                              ) : (
                                <p className="text-xs text-muted-foreground">Sem resultados AI — clique "AI Parse"</p>
                              )}
                            </div>
                          </div>
                          <div>
                            <h4 className="text-xs font-semibold mb-2 flex items-center gap-1"><GitCompare className="h-3 w-3" /> Reconciliado</h4>
                            <div className="bg-muted rounded-md p-2 max-h-60 overflow-auto">
                              {(((selectedPage.reconciled_result as any)?.zones || []) as any[]).map((z: any, i: number) => (
                                <div key={i} className={`text-xs p-1 mb-1 rounded ${zoneColors[z.type] || ""}`}>
                                  <span className="font-medium">[{toDisplayText(z.type)}]</span> {toDisplayText(z.content_summary, "").toString().substring(0, 80)}
                                </div>
                              ))}
                              {!((selectedPage.reconciled_result as any)?.zones?.length) && (
                                <p className="text-xs text-muted-foreground">Execute AI Parse para gerar reconciliação</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="metrics">
                <ScrollArea className="h-[60vh]">
                  <div className="space-y-4">
                    {metrics ? (
                      <Card>
                        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Métricas de Qualidade</CardTitle></CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            <div className="space-y-1"><p className="text-xs text-muted-foreground">Confiança Média</p><p className="text-2xl font-bold text-foreground">{metrics.avg_confidence}%</p></div>
                            <div className="space-y-1"><p className="text-xs text-muted-foreground">Tabelas Detetadas</p><p className="text-2xl font-bold text-foreground">{metrics.tables_detected}</p></div>
                            <div className="space-y-1"><p className="text-xs text-muted-foreground">Linhas Extraídas</p><p className="text-2xl font-bold text-foreground">{metrics.rows_extracted}</p></div>
                            <div className="space-y-1"><p className="text-xs text-muted-foreground">Taxa de Mapeamento</p><p className="text-2xl font-bold text-foreground">{metrics.mapping_success_rate}%</p></div>
                            <div className="space-y-1"><p className="text-xs text-muted-foreground">Tempo de Processamento</p><p className="text-2xl font-bold text-foreground">{(metrics.processing_time / 1000).toFixed(1)}s</p></div>
                          </div>
                        </CardContent>
                      </Card>
                    ) : (
                      <p className="text-muted-foreground text-center py-8">Métricas disponíveis após a extração</p>
                    )}
                    {(sections || []).length > 0 && (
                      <Card>
                        <CardHeader><CardTitle className="text-sm">Secções Detetadas</CardTitle></CardHeader>
                        <CardContent>
                          <div className="space-y-1">
                            {(sections || []).map((s: any, index: number) => (
                              <div key={s.id || index} className="flex items-center justify-between text-xs border-b border-border py-1">
                                <span className="font-medium">{toDisplayText(s.section_title)}</span>
                                <Badge variant="outline" className="text-xs">Confiança: {toDisplayText(s.confidence, "0")}%</Badge>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
