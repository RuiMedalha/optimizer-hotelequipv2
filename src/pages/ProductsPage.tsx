import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Search, Check, X, Edit, Sparkles, Loader2, Download, Send, Trash2, Settings2, Save, GitBranch, Layers, Plus, Ban, Filter, ChevronDown, ChevronRight, Rocket, XCircle, List, Network, Globe, Copy, AlertTriangle, ImageIcon, Camera, GitCompare, Wand2, Tag, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useProducts, useAllProductIds, useUpdateProductStatus, useProductFilterOptions, useProductStats, type Product, type ProductFilters } from "@/hooks/useProducts";
import { useOptimizeProducts, OPTIMIZATION_FIELDS, OPTIMIZATION_PHASES, CancellationToken, type OptimizationField } from "@/hooks/useOptimizeProducts";
import { useActiveAiModels, useActiveImageModels } from "@/hooks/useAiProviderCenter";
import { useOptimizationJob } from "@/hooks/useOptimizationJob";
import { useOptimizationJobItems } from "@/hooks/useJobItems";
import { usePublishWooCommerce, type PublishResult } from "@/hooks/usePublishWooCommerce";
import { usePublishJob } from "@/hooks/usePublishJob";
import { useDeleteProducts } from "@/hooks/useDeleteProducts";
import { useUpdateProduct } from "@/hooks/useUpdateProduct";
import { exportProductsToExcel, exportAllProductsToExcel } from "@/hooks/useExportProducts";
import { ProductDetailModal } from "@/components/ProductDetailModal";
import { WooPublishModal } from "@/components/WooPublishModal";
import { useDetectVariations, useApplyVariations, type VariationGroup } from "@/hooks/useVariableProducts";
import { supabase } from "@/integrations/supabase/client";
import type { Enums } from "@/integrations/supabase/types";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { calculateSeoScore } from "@/lib/seoScore";
import { useRepairAttributes } from "@/hooks/useRepairAttributes";
import { useEnrichProducts } from "@/hooks/useEnrichProducts";
import { useProcessImages, type ImageProcessingMode, IMAGE_PROCESSING_MODE_DEFAULT } from "@/hooks/useProcessImages";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useSettings } from "@/hooks/useSettings";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useDuplicateDetection } from "@/hooks/useDuplicateDetection";
import { DuplicateDetectionDialog } from "@/components/DuplicateDetectionDialog";
import { AiComparisonWizard } from "@/components/ai-comparison/AiComparisonWizard";
import { CategoryReviewModal } from "@/components/CategoryReviewModal";
import { CategoryCell } from "@/components/category/CategoryCell";
import { PublishLogsModal } from "@/components/PublishLogsModal";
const statusLabels: Record<string, string> = {
  pending: "Pendente",
  processing: "A Processar",
  optimized: "Otimizado",
  needs_review: "Revisão Necessária",
  published: "Publicado",
  error: "Erro",
  discontinued: "Descontinuado",
};

const statusColors: Record<string, string> = {
  pending: "bg-warning/10 text-warning border-warning/20",
  processing: "bg-primary/10 text-primary border-primary/20",
  optimized: "bg-success/10 text-success border-success/20",
  needs_review: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  published: "bg-primary/10 text-primary border-primary/20",
  error: "bg-destructive/10 text-destructive border-destructive/20",
  discontinued: "bg-destructive/10 text-destructive border-destructive/20",
};

type FilterStatus = Enums<"product_status"> | "all" | "discontinued";

const ALL_FIELDS: OptimizationField[] = OPTIMIZATION_FIELDS.map(f => f.key);
const ALL_PHASES = OPTIMIZATION_PHASES.map(p => p.phase);

function getMigrationStatus(product: Product): "migrated" | "partial" | "not_migrated" {
  const attrs = product.attributes;
  // Safety check: attributes must be an array to be processed
  if (!Array.isArray(attrs) || attrs.length === 0) return "not_migrated";
  
  const paAttrs = attrs.filter(a => 
    typeof a === 'object' && 
    a !== null && 
    'slug' in a && 
    typeof a.slug === 'string' && 
    a.slug.startsWith("pa_")
  );
  
  if (paAttrs.length >= 2) return "migrated";
  if (paAttrs.length === 1) return "partial";
  return "not_migrated";
}

function generateImageFilename(slug: string, index: number, imageUrl: string, ext: string): string {
  const urlLower = (imageUrl || "").toLowerCase();
  if (urlLower.includes("lifestyle")) return `${slug}-lifestyle.${ext}`;
  if (urlLower.includes("optimiz") || urlLower.includes("optimis")) return `${slug}-optimizada.${ext}`;
  if (urlLower.includes("detail") || urlLower.includes("detalhe") || urlLower.includes("pormenor")) return `${slug}-detalhe.${ext}`;
  if (urlLower.includes("dimension") || urlLower.includes("dimensao") || urlLower.includes("medida")) return `${slug}-dimensoes.${ext}`;
  if (urlLower.includes("back") || urlLower.includes("traseira") || urlLower.includes("posterior")) return `${slug}-traseira.${ext}`;
  switch(index) {
    case 0: return `${slug}.${ext}`;
    case 1: return `${slug}-vista.${ext}`;
    default: return `${slug}-detalhe-${index}.${ext}`;
  }
}

function generateImageAltText(productTitle: string, index: number, imageUrl: string): string {
  const urlLower = (imageUrl || "").toLowerCase();
  if (urlLower.includes("lifestyle")) return `${productTitle} - Lifestyle`;
  if (urlLower.includes("optimiz") || urlLower.includes("optimis")) return `${productTitle} - Imagem optimizada`;
  if (urlLower.includes("detail") || urlLower.includes("detalhe") || urlLower.includes("pormenor")) return `${productTitle} - Detalhe`;
  if (urlLower.includes("dimension") || urlLower.includes("dimensao") || urlLower.includes("medida")) return `${productTitle} - Dimensões`;
  if (urlLower.includes("back") || urlLower.includes("traseira") || urlLower.includes("posterior")) return `${productTitle} - Vista traseira`;
  switch(index) {
    case 0: return productTitle;
    case 1: return `${productTitle} - Vista`;
    default: return `${productTitle} - Detalhe ${index}`;
  }
}

const ProductsPage = () => {
  const [showBrandInput, setShowBrandInput] = useState(false);
  const [bulkBrandValue, setBulkBrandValue] = useState("");
  const [isInferringModels, setIsInferringModels] = useState(false);
  const [showInferModelDialog, setShowInferModelDialog] = useState(false);
  const { activeWorkspace, toggleVariableProducts } = useWorkspaceContext();
  const qc = useQueryClient();
  useRepairAttributes();
  const { enrich, isEnriching, missingVariations, createMissingVariations, progress: enrichProgress } = useEnrichProducts();
  const { processImages, processImagesByMode, isProcessing: isProcessingImages, progress: imgProgress } = useProcessImages();
  const { data: settings } = useSettings();
  const AI_MODELS = useActiveAiModels();
  const IMAGE_MODELS = useActiveImageModels();
  // Fetch which products have optimized/lifestyle images
  const { data: imageStatusMap } = useQuery({
    queryKey: ["product-image-status", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("images")
        .select("product_id, s3_key")
        .not("optimized_url", "is", null);
      if (error) throw error;
      const map: Record<string, { hasOptimized: boolean; hasLifestyle: boolean }> = {};
      for (const row of data || []) {
        if (!map[row.product_id]) map[row.product_id] = { hasOptimized: false, hasLifestyle: false };
        const key = (row.s3_key || "").toLowerCase();
        if (key.includes("lifestyle")) map[row.product_id].hasLifestyle = true;
        // Only mark as optimized if the s3_key contains "optimizada" (AI background removal)
        // Images migrated from suppliers are NOT considered optimized
        else if (key.includes("optimizada") || key.includes("background") || key.includes("processed")) {
          map[row.product_id].hasOptimized = true;
        }
      }
      return map;
    },
  });

  const updateStatus = useUpdateProductStatus();
  const { data: stats } = useProductStats();
  const optimizeProducts = useOptimizeProducts();
  const { activeJob, isCreating: isCreatingJob, createJob, cancelJob, dismissJob } = useOptimizationJob();
  const [showJobErrors, setShowJobErrors] = useState(false);
  const jobItems = useOptimizationJobItems(
    activeJob && (activeJob.status === "completed" || activeJob.status === "cancelled") && activeJob.failed_products > 0
      ? activeJob.id
      : null
  );
  const publishWoo = usePublishWooCommerce();
  const { activePublishJob, isCreating: isCreatingPublish, createPublishJob, cancelPublishJob, dismissPublishJob } = usePublishJob();
  const [publishBannerVisible, setPublishBannerVisible] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  useEffect(() => {
    if (activePublishJob?.status === "completed") {
      setPublishBannerVisible(true);
      const t = setTimeout(() => setPublishBannerVisible(false), 5000);
      return () => clearTimeout(t);
    } else if (activePublishJob && (activePublishJob.status === "processing" || activePublishJob.status === "queued" || activePublishJob.status === "scheduled")) {
      setPublishBannerVisible(true);
    } else {
      setPublishBannerVisible(false);
    }
  }, [activePublishJob?.status, activePublishJob?.id]);

  const deleteProducts = useDeleteProducts();
  const updateProduct = useUpdateProduct();
  const detectVariations = useDetectVariations();
  const applyVariations = useApplyVariations();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sourceFileFilter, setSourceFileFilter] = useState<string>("all");
  const [seoScoreFilter, setSeoScoreFilter] = useState<string>("all");
  const [hasKeywordFilter, setHasKeywordFilter] = useState<string>("all");
  const [productTypeFilter, setProductTypeFilter] = useState<string>("all");
  const [phaseFilter, setPhaseFilter] = useState<string>("all");
  const [wooFilter, setWooFilter] = useState<string>("all");
  const [migrationFilter, setMigrationFilter] = useState<string>("all");
  const [publishabilityFilter, setPublishabilityFilter] = useState<string>("all");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allPagesSelected, setAllPagesSelected] = useState(false);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [showFieldSelector, setShowFieldSelector] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Set<OptimizationField>>(new Set(ALL_FIELDS));
  const [selectedPhases, setSelectedPhases] = useState<Set<number>>(new Set(ALL_PHASES));
  const [pendingOptimizeIds, setPendingOptimizeIds] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("default");
  const [selectedImageModel, setSelectedImageModel] = useState<string>("default");
  const [confirmReoptimize, setConfirmReoptimize] = useState(false);
  const [backgroundMode, setBackgroundMode] = useState(true);
  const [skipKnowledge, setSkipKnowledge] = useState(false);
  const [skipScraping, setSkipScraping] = useState(false);
  const [skipReranking, setSkipReranking] = useState(false);
  const [includeUsoProfissional, setIncludeUsoProfissional] = useState(false);
  const [usoProfissionalInDescription, setUsoProfissionalInDescription] = useState(true);
  const [usoProfissionalInCustomField, setUsoProfissionalInCustomField] = useState(false);
  const [imageIssueFilter, setImageIssueFilter] = useState(false);
  // Modo granular: "off" | "optimize_only" | "lifestyle_only" | "optimize_and_lifestyle"
  // Persistido em localStorage; default = "optimize_only" (mais rápido, sem perda).
  const [imageProcessingMode, setImageProcessingMode] = useState<ImageProcessingMode>(() => {
    try {
      const saved = localStorage.getItem("optimize_image_processing_mode") as ImageProcessingMode | null;
      if (saved === "off" || saved === "optimize_only" || saved === "lifestyle_only" || saved === "optimize_and_lifestyle") return saved;
    } catch {}
    return IMAGE_PROCESSING_MODE_DEFAULT;
  });
  // Mantém o booleano legado em sync com o modo (default = on, porque modo default = optimize_only).
  const [includeImageProcessing, setIncludeImageProcessing] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("optimize_image_processing_mode") as ImageProcessingMode | null;
      if (saved === "off") return false;
      if (saved === "optimize_only" || saved === "lifestyle_only" || saved === "optimize_and_lifestyle") return true;
    } catch {}
    return IMAGE_PROCESSING_MODE_DEFAULT !== "off";
  });
  const [selectedPromptTemplate, setSelectedPromptTemplate] = useState<string>("active");
  const [selectedImagePromptTemplate, setSelectedImagePromptTemplate] = useState<string>(() => {
    try { return localStorage.getItem("optimize_image_prompt_template") || "active"; } catch { return "active"; }
  });

  // Fetch prompt templates for the selector
  const { data: promptTemplates } = useQuery({
    queryKey: ["prompt-templates-for-optimize", activeWorkspace?.id],
    enabled: !!activeWorkspace?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_templates")
        .select("id, prompt_name, prompt_type, is_active")
        .eq("workspace_id", activeWorkspace!.id)
        .in("prompt_type", ["description", "seo", "enrichment"])
        .order("prompt_type")
        .order("is_active", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  // Fetch image prompt templates for the image prompt selector
  const { data: imagePromptTemplates } = useQuery({
    queryKey: ["image-prompt-templates-for-optimize", activeWorkspace?.id],
    enabled: !!activeWorkspace?.id && (imageProcessingMode === "optimize_and_lifestyle" || imageProcessingMode === "lifestyle_only"),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_templates")
        .select("id, prompt_name, prompt_type, is_active")
        .eq("workspace_id", activeWorkspace!.id)
        .eq("prompt_type", "image")
        .order("is_active", { ascending: false })
        .order("prompt_name");
      if (error) throw error;
      return data || [];
    },
  });
  const [showVariations, setShowVariations] = useState(false);
  const [detectedGroups, setDetectedGroups] = useState<VariationGroup[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<"list" | "grouped">("list");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [exportSkuPrefix, setExportSkuPrefix] = useState("");
  const [dismissedMissing, setDismissedMissing] = useState(false);
  const [exportTarget, setExportTarget] = useState<"all" | "selected">("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [showCategoryReview, setShowCategoryReview] = useState(false);
  const PAGE_SIZE = 100;

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Server-side paginated products
  const serverFilters: ProductFilters = {
    search: debouncedSearch,
    status: statusFilter,
    category: categoryFilter,
    productType: productTypeFilter,
    sourceFile: sourceFileFilter,
    wooFilter,
    imageStatus: imageIssueFilter ? "any_issue" : "all",
    publishabilityDecision: publishabilityFilter,
    page: currentPage,
    pageSize: PAGE_SIZE,
  };
  const { data: paginatedData, isLoading } = useProducts(serverFilters);
  const products = paginatedData?.products ?? [];
  const totalCount = paginatedData?.totalCount ?? 0;
  const totalPages = paginatedData?.totalPages ?? 1;

  // Lightweight all-products for bulk operations (optimize family expansion, export, etc.)
  const { data: allProductsLight } = useAllProductIds();

  // Filter options from server
  const { data: filterOptions } = useProductFilterOptions();
  const uniqueCategories = filterOptions?.categories ?? [];
  const uniqueSourceFiles = filterOptions?.sourceFiles ?? [];

  // Workspace-scoped products for duplicate detection
  const workspaceProducts = useMemo(() => allProductsLight ?? [], [allProductsLight]);
  const { groups: duplicateGroups, run: runDuplicateDetection, isRunning: isDetectingDuplicates } = useDuplicateDetection(workspaceProducts as any);

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  // Batch progress tracking
  const [batchProgress, setBatchProgress] = useState<import("@/hooks/useOptimizeProducts").OptimizationProgress | null>(null);
  const cancellationTokenRef = useRef<CancellationToken | null>(null);

  const handleUpdatePublishability = async (productId: string, decision: 'publish' | 'skip') => {
    try {
      const { error } = await supabase
        .from("products")
        .update({ publishability_decision: decision })
        .eq("id", productId);

      if (error) throw error;

      toast.success(`Produto movido para ${decision === 'publish' ? 'Publicar' : 'Ignorar'}`);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });
    } catch (error: any) {
      toast.error("Erro ao atualizar decisão: " + error.message);
    }
  };

  const handleBulkUpdatePublishability = async (decision: 'publish' | 'skip') => {
    try {
      const ids = filtered.map(p => p.id);
      if (ids.length === 0) return;

      const { error } = await supabase
        .from("products")
        .update({ publishability_decision: decision })
        .in("id", ids);

      if (error) throw error;

      toast.success(`${ids.length} produtos movidos para ${decision === 'publish' ? 'Publicar' : 'Ignorar'}`);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });
    } catch (error: any) {
      toast.error("Erro ao atualizar decisões: " + error.message);
    }
  };

  // Background mode is now always the default — only allow foreground for very small batches
  useEffect(() => {
    if (pendingOptimizeIds.length >= 3) {
      setBackgroundMode(true);
    }
  }, [pendingOptimizeIds.length]);

  // Re-fetch properly
  const { data: issueCount } = useQuery({
    queryKey: ["product-image-issue-count-v3", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("products")
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", activeWorkspace!.id)
        .in("image_status", ["failed", "missing"]);
      if (error) throw error;
      return count || 0;
    }
  });

  const getProductPhases = useCallback((p: Product) => {
    const p1 = !!(p.optimized_title || p.optimized_description || p.optimized_short_description);
    const p2 = !!(p.meta_title || p.meta_description || p.seo_slug || (p.faq && (Array.isArray(p.faq) ? (p.faq as any[]).length > 0 : true)));
    const p3 = !!((p.upsell_skus && (p.upsell_skus as any[]).length > 0) || (p.crosssell_skus && (p.crosssell_skus as any[]).length > 0));
    return { p1, p2, p3 };
  }, []);

  // Client-side filters applied to already server-filtered data
  // Optimized to avoid heavy computation on every render
  const filtered = useMemo(() => {
    return products.filter((p) => {
      try {
        // SEO score filter
        if (seoScoreFilter !== "all") {
          const score = p.seo_score ?? (p ? calculateSeoScore(p).score : 0);
          if (seoScoreFilter === "good" && score < 80) return false;
          if (seoScoreFilter === "medium" && (score < 50 || score >= 80)) return false;
          if (seoScoreFilter === "weak" && score >= 50) return false;
        }

        // Has keyword filter
        if (hasKeywordFilter === "yes") {
          if (!Array.isArray(p.focus_keyword) || p.focus_keyword.length === 0) return false;
        } else if (hasKeywordFilter === "no") {
          if (Array.isArray(p.focus_keyword) && p.focus_keyword.length > 0) return false;
        }

        // Phase filter
        if (phaseFilter !== "all") {
          const phases = getProductPhases(p);
          if (phaseFilter === "missing1" && phases.p1) return false;
          if (phaseFilter === "missing2" && phases.p2) return false;
          if (phaseFilter === "missing3" && phases.p3) return false;
          if (phaseFilter === "complete" && (!phases.p1 || !phases.p2 || !phases.p3)) return false;
          if (phaseFilter === "none" && (phases.p1 || phases.p2 || phases.p3)) return false;
        }

        // Migration filter
        if (migrationFilter !== "all") {
          if (p.status !== "published" && migrationFilter !== "not_migrated") return false;
          if (p.status === "published" && getMigrationStatus(p) !== migrationFilter) return false;
        }

        return true;
      } catch (err) {
        console.error("Error filtering product:", p.id, err);
        return true; // Keep product in list if filtering fails
      }
    });
  }, [products, seoScoreFilter, hasKeywordFilter, phaseFilter, migrationFilter, getProductPhases]);

  // Reset page when server filters change
  useEffect(() => { setCurrentPage(1); }, [debouncedSearch, statusFilter, categoryFilter, sourceFileFilter, productTypeFilter, wooFilter]);

  // paginatedFiltered is the same as filtered since pagination is server-side now
  const paginatedFiltered = filtered;

  const publishStats = useMemo(() => {
    const results = Array.isArray(activePublishJob?.results) ? (activePublishJob.results as any[]) : [];
    const created = results.filter((r: any) => r.status === "created").length;
    const updated = results.filter((r: any) => r.status === "updated").length;
    const skipped = results.filter((r: any) => r.status === "skipped" || r.status === "skipped_complex").length;
    const errorsFromResults = results.filter((r: any) => r.status === "error").length;

    return {
      created,
      updated,
      confirmed: created + updated,
      skipped,
      errors: Math.max(errorsFromResults, activePublishJob?.failed_products ?? 0),
    };
  }, [activePublishJob?.results, activePublishJob?.failed_products]);

  // Force refresh when progress hits 100%
  useEffect(() => {
    if (activeJob && activeJob.processed_products >= activeJob.total_products && activeJob.total_products > 0) {
      const timer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["products"] });
        qc.invalidateQueries({ queryKey: ["product-stats"] });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [activeJob?.processed_products, activeJob?.total_products, qc]);

  useEffect(() => {
    if (activePublishJob && activePublishJob.processed_products >= activePublishJob.total_products && activePublishJob.total_products > 0) {
      const timer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["products"] });
        qc.invalidateQueries({ queryKey: ["product-stats"] });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [activePublishJob?.processed_products, activePublishJob?.total_products, qc]);

  // Build grouped view structure
  const groupedView = useMemo(() => {
    if (viewMode !== "grouped" || !Array.isArray(products)) return null;

    type GroupedItem = 
      | { type: "parent"; product: Product; children: Product[] }
      | { type: "standalone"; product: Product };

    const items: GroupedItem[] = [];
    const variationIds = new Set<string>();

    // Find all variable products and their children
    const variableProducts = filtered.filter(p => p && p.product_type === "variable");
    const allProds = products || [];

    for (const parent of variableProducts) {
      if (!parent) continue;
      const children = allProds.filter(p => p && p.parent_product_id === parent.id);
      children.forEach(c => c && variationIds.add(c.id));
      items.push({ type: "parent", product: parent, children });
    }

    // Add standalone products (simple or orphan variations not already shown)
    for (const p of filtered) {
      if (p && p.product_type !== "variable" && !variationIds.has(p.id)) {
        items.push({ type: "standalone", product: p });
      }
    }

    return items;
  }, [filtered, products, viewMode]);

  const toggleGroupExpand = (id: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setAllPagesSelected(false);
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const bulkAction = (status: Enums<"product_status">) => {
    const ids = Array.from(selected);
    // Process in batches of 500 for large selections
    const batchSize = 500;
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += batchSize) {
      batches.push(ids.slice(i, i + batchSize));
    }
    batches.forEach((batch) => {
      updateStatus.mutate({ ids: batch, status });
    });
    setSelected(new Set());
    setAllPagesSelected(false);
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length && !allPagesSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((p) => p.id)));
    }
    setAllPagesSelected(false);
  };

  const selectAllPages = () => {
    const allIds = (allProductsLight ?? [])
      .filter((p: any) => {
        if (statusFilter !== "all" && p.status !== statusFilter) return false;
        if (categoryFilter !== "all" && (p.category || "") !== categoryFilter) return false;
        if (productTypeFilter !== "all" && p.product_type !== productTypeFilter) return false;
        if (sourceFileFilter !== "all" && (p.source_file || "") !== sourceFileFilter) return false;
        if (wooFilter === "published" && !p.woocommerce_id) return false;
        if (wooFilter === "not_published" && p.woocommerce_id) return false;
        return true;
      })
      .map((p: any) => p.id);
    setSelected(new Set(allIds));
    setAllPagesSelected(true);
  };

  const handleBulkDelete = () => {
    if (confirm(`Tem a certeza que deseja eliminar ${selected.size} produto(s)? Esta ação é irreversível.`)) {
      const ids = Array.from(selected);
      // Chama o hook uma única vez com todos os IDs, o hook trata o batching sequencialmente
      deleteProducts.mutate(ids);
      setSelected(new Set());
      setAllPagesSelected(false);
    }
  };

  const handleDiscontinuedPublish = async () => {
    if (selected.size === 0 || !activeWorkspace) return;
    
    try {
      await createPublishJob({
        productIds: Array.from(selected),
        workspaceId: activeWorkspace.id,
        // Send stock to trigger the draft + 0 stock logic in edge function
        publishFields: ["stock"], 
        pricing: { forcePublish: true } as any
      });
      toast.success("Publicação de descontinuados iniciada!");
      setSelected(new Set());
    } catch (err: any) {
      toast.error(err.message);
    }
  };
  
  const handleInferModels = async (onlyMissing: boolean = true) => {
    if (selected.size === 0 || !activeWorkspace) return;
    
    setIsInferringModels(true);
    const selectedIds = Array.from(selected);
    const { data: { user } } = await supabase.auth.getUser();
    
    try {
      // Fetch relevant products
      let query = supabase
        .from("products")
        .select("id, sku, model")
        .in("id", selectedIds);
        
      if (onlyMissing) {
        query = query.is("model", null);
      }
      
      const { data: productsToUpdate, error: fetchError } = await query;
      
      if (fetchError) throw fetchError;
      if (!productsToUpdate || productsToUpdate.length === 0) {
        toast.info(onlyMissing ? "Todos os produtos selecionados já possuem modelo." : "Nenhum produto selecionado para atualizar.");
        return;
      }
      
      const updates = productsToUpdate.map(p => {
        const sku = p.sku || "";
        const suggested = sku.length > 2 ? sku.substring(2) : sku;
        return { 
          id: p.id, 
          model: suggested,
          workspace_id: activeWorkspace.id,
          user_id: user?.id
        };
      });
      
      // Batch update
      const batchSize = 50;
      let successCount = 0;
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        const { error: updateError } = await supabase.from("products").upsert(batch as any);
        
        if (updateError) {
          console.error("Erro no lote de modelos:", updateError);
          // Log errors to the new table
          if (user?.id) {
            const errorLogs = batch.map(item => ({
              workspace_id: activeWorkspace.id,
              user_id: user.id,
              operation_type: 'infer_model',
              product_id: item.id,
              sku: productsToUpdate.find(p => p.id === item.id)?.sku,
              error_message: updateError.message,
              error_detail: { code: updateError.code, hint: updateError.hint }
            }));
            await supabase.from("catalog_operation_errors").insert(errorLogs);
          }
          throw updateError;
        }
        successCount += batch.length;
      }
      
      toast.success(`${successCount} modelos inferidos com sucesso.`);
      qc.invalidateQueries({ queryKey: ["products"] });
      setSelected(new Set());
    } catch (error: any) {
      console.error("Erro ao inferir modelos:", error);
      toast.error("Erro ao inferir modelos: " + error.message);
    } finally {
      setIsInferringModels(false);
    }
  };

  const handleOptimizeClick = (ids: string[]) => {
    // Excluir descontinuados da otimização
    const validIds = ids.filter(id => {
      const p = products.find(prod => prod.id === id) || (allProductsLight ?? []).find((prod: any) => prod.id === id);
      return !p?.is_discontinued;
    });

    if (validIds.length === 0) {
      toast.warning("Nenhum produto válido para otimização selecionado (descontinuados são ignorados).");
      return;
    }

    // Auto-include entire family: parent + all siblings for variable products
    const allProducts = allProductsLight ?? [];
    const expandedIds = new Set(validIds);
    ids.forEach(id => {
      const p = allProducts.find(pr => pr.id === id);
      if (p?.product_type === "variable") {
        // Add all children of this variable product
        allProducts.filter(c => c.parent_product_id === id).forEach(c => expandedIds.add(c.id));
      } else if (p?.product_type === "variation" && p.parent_product_id) {
        // Add the parent variable product
        expandedIds.add(p.parent_product_id);
        // Add all sibling variations
        allProducts.filter(c => c.parent_product_id === p.parent_product_id).forEach(c => expandedIds.add(c.id));
      }
    });
    // Sort: variable parents first, then simple, then variations
    const finalIds = Array.from(expandedIds).sort((a, b) => {
      const pa = allProducts.find(pr => pr.id === a);
      const pb = allProducts.find(pr => pr.id === b);
      const order = (p: any) => p?.product_type === 'variable' ? 0 : p?.product_type === 'simple' ? 1 : 2;
      return order(pa) - order(pb);
    });
    if (finalIds.length > ids.length) {
      toast.info(`${finalIds.length - ids.length} produto(s) da mesma família incluído(s) automaticamente para otimização em grupo.`);
    }

    // Auto-enable skipScraping if all selected products already have technical_specs (web-enriched)
    const selectedProducts = allProducts.filter(p => finalIds.includes(p.id));
    const allEnriched = selectedProducts.length > 0 && selectedProducts.every((p: any) => p.technical_specs && p.technical_specs.length > 5);
    if (allEnriched) {
      setSkipScraping(true);
    }

    setPendingOptimizeIds(finalIds);
    setConfirmReoptimize(false);
    setShowFieldSelector(true);
  };

  const handleConfirmOptimize = () => {
    const phaseFields = OPTIMIZATION_PHASES
      .filter(p => selectedPhases.has(p.phase))
      .flatMap(p => p.fields);
    const fieldsToUse = phaseFields.filter(f => selectedFields.has(f));

    const speedFlags = {
      skipKnowledge,
      skipScraping,
      skipReranking,
    };

    if (backgroundMode) {
      createJob({
        productIds: pendingOptimizeIds,
        selectedPhases: Array.from(selectedPhases),
        fieldsToOptimize: fieldsToUse,
        modelOverride: selectedModel !== "default" ? selectedModel : undefined,
        workspaceId: activeWorkspace?.id,
        includeUsoProfissional,
        usoProfissionalRouting: includeUsoProfissional ? { inDescription: usoProfissionalInDescription, inCustomField: usoProfissionalInCustomField } : undefined,
        // Compat: mantemos o booleano mas o backend dá prioridade ao modo explícito.
        includeImageProcessing: imageProcessingMode !== "off",
        imageProcessingMode,
        promptTemplateId: selectedPromptTemplate !== "active" ? selectedPromptTemplate : undefined,
        imagePromptTemplateId: selectedImagePromptTemplate !== "active" ? selectedImagePromptTemplate : undefined,
        ...speedFlags,
      });
      setShowFieldSelector(false);
      setPendingOptimizeIds([]);
      setSelected(new Set());
      setSelectedModel("default");
      setBackgroundMode(true);
      return;
    }

    const nameMap: Record<string, string> = {};
    (allProductsLight ?? []).forEach((p: any) => {
      if (pendingOptimizeIds.includes(p.id)) {
        nameMap[p.id] = p.optimized_title || p.original_title || p.sku || p.id.slice(0, 8);
      }
    });

    const token = new CancellationToken();
    cancellationTokenRef.current = token;

    const directModeIds = [...pendingOptimizeIds];
    const directWorkspaceId = activeWorkspace?.id;
    const directIncludeUso = includeUsoProfissional;
    const directUsoRouting = includeUsoProfissional ? { inDescription: usoProfissionalInDescription, inCustomField: usoProfissionalInCustomField } : undefined;
    const directImageMode = imageProcessingMode;
    const directImagePromptTemplateId = selectedImagePromptTemplate !== "active" ? selectedImagePromptTemplate : undefined;

    optimizeProducts.mutate({
      productIds: directModeIds,
      fieldsToOptimize: fieldsToUse,
      selectedPhases: Array.from(selectedPhases),
      modelOverride: selectedModel !== "default" ? selectedModel : undefined,
      workspaceId: directWorkspaceId,
      productNames: nameMap,
      cancellationToken: token,
      ...speedFlags,
      onProgress: (progress) => {
        setBatchProgress(progress);
        if (progress.done >= progress.total || progress.cancelled) {
          setTimeout(() => setBatchProgress(null), 3000);
          // Post-optimization: trigger Uso Profissional and Images for direct mode
          if (progress.done >= progress.total && !progress.cancelled && directWorkspaceId) {
            (async () => {
              // Uso Profissional
              if (directIncludeUso) {
                let usoOkCount = 0;
                for (const pid of directModeIds) {
                  try {
                    const { data: prod } = await supabase.from("products")
                      .select("optimized_title, original_title, optimized_description, original_description, category, attributes")
                      .eq("id", pid).maybeSingle();
                    const { data: usoResult, error: usoErr } = await supabase.functions.invoke("generate-uso-profissional", {
                      body: {
                        workspaceId: directWorkspaceId,
                        productId: pid,
                        productTitle: prod?.optimized_title || prod?.original_title || "Produto",
                        productDescription: prod?.optimized_description || prod?.original_description || "",
                        productCategory: prod?.category || "",
                        productAttributes: prod?.attributes || [],
                        triggered_by: "pipeline",
                      },
                    });
                    if (!usoErr && usoResult && usoResult.intro) {
                      const upsertPayload = {
                        product_id: pid,
                        workspace_id: directWorkspaceId,
                        intro: usoResult.intro || null,
                        use_cases: usoResult.useCases || [],
                        professional_tips: usoResult.professionalTips || [],
                        target_profiles: usoResult.targetProfiles || [],
                        generated_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                        publish_enabled: (directUsoRouting?.inDescription ?? true) || (directUsoRouting?.inCustomField ?? false),
                        routing_in_description: directUsoRouting?.inDescription ?? true,
                        routing_in_custom_field: directUsoRouting?.inCustomField ?? false,
                        placement: (directUsoRouting?.inDescription ?? true) ? "before_faq" : "end_description",
                      };
                      console.log("[Uso Prof] Upserting:", { product_id: pid, workspace_id: directWorkspaceId, hasIntro: !!usoResult.intro });
                      const { data: upsertResult, error: upsertError } = await supabase.from("product_uso_profissional" as any).upsert(
                        upsertPayload as any,
                        { onConflict: "product_id,workspace_id" } as any
                      ).select();
                      if (upsertError) {
                        console.error("[Uso Prof] Upsert error:", upsertError);
                      } else {
                        console.log("[Uso Prof] Upsert success:", upsertResult);
                        window.dispatchEvent(new CustomEvent("uso-profissional-updated", {
                          detail: { productId: pid, workspaceId: directWorkspaceId },
                        }));
                        qc.invalidateQueries({ queryKey: ["products"] });
                        qc.invalidateQueries({ queryKey: ["product-stats"] });
                        qc.invalidateQueries({ queryKey: ["recent-activity"] });
                        qc.invalidateQueries({ queryKey: ["token-usage-summary"] });
                        qc.invalidateQueries({ queryKey: ["product-detail", pid] });
                        usoOkCount++;
                      }
                    } else {
                      console.warn("[Uso Prof] Edge function returned no intro:", { usoErr, usoResult });
                    }
                  } catch (e) { console.warn("Uso Prof direct mode error:", e); }
                }
                if (usoOkCount > 0) toast.success(`📖 Uso Profissional gerado para ${usoOkCount} produto(s)!`);
              }
              // Images — usa o helper que respeita o modo escolhido
              // ("off" → no-op, "optimize_only" → 1 chamada, "optimize_and_lifestyle" → 2 em paralelo)
              if (directImageMode !== "off") {
                try {
                  await processImagesByMode({
                    workspaceId: directWorkspaceId,
                    productIds: directModeIds,
                    mode: directImageMode,
                    imagePromptTemplateId: directImagePromptTemplateId,
                  });
                } catch (e) { console.warn("Image processing direct mode error:", e); }
              }
            })();
          }
        }
      },
    });
    setShowFieldSelector(false);
    setPendingOptimizeIds([]);
    setSelected(new Set());
    setSelectedModel("default");
    setBackgroundMode(true);
  };

  const togglePhase = (phase: number) => {
    setSelectedPhases(prev => {
      const next = new Set(prev);
      const phaseFields = OPTIMIZATION_PHASES.find(p => p.phase === phase)?.fields || [];
      if (next.has(phase)) {
        next.delete(phase);
        // Also remove this phase's fields
        setSelectedFields(prevF => {
          const nf = new Set(prevF);
          phaseFields.forEach(f => nf.delete(f));
          return nf;
        });
      } else {
        next.add(phase);
        // Also add this phase's fields
        setSelectedFields(prevF => {
          const nf = new Set(prevF);
          phaseFields.forEach(f => nf.add(f));
          return nf;
        });
      }
      return next;
    });
  };

  const handleCancelOptimize = () => {
    cancellationTokenRef.current?.cancel();
  };

  const toggleField = (field: OptimizationField) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      next.has(field) ? next.delete(field) : next.add(field);
      return next;
    });
  };

  // Inline edit handlers
  const startInlineEdit = (id: string, field: string, currentValue: string) => {
    setEditingCell({ id, field });
    setEditValue(currentValue);
  };

  const saveInlineEdit = () => {
    if (!editingCell) return;
    updateProduct.mutate({
      id: editingCell.id,
      updates: { [editingCell.field]: editValue || null },
    });
    setEditingCell(null);
  };

  const cancelInlineEdit = () => {
    setEditingCell(null);
  };

  // Update detailProduct when products data changes
  useEffect(() => {
    if (detailProduct && products) {
      const updated = products.find((p: Product) => p.id === detailProduct.id);
      if (updated) setDetailProduct(updated);
    }
  }, [products]);

  const statuses: { value: FilterStatus; label: string }[] = [
    { value: "all", label: "Todos" },
    { value: "pending", label: "Pendente" },
    { value: "processing", label: "A Processar" },
    { value: "optimized", label: "Otimizado" },
    { value: "needs_review", label: "Revisão Necessária" },
    { value: "published", label: "Publicado" },
    { value: "discontinued", label: "Descontinuados" },
    { value: "error", label: "Erro" },
  ];

  const PhaseIndicator = ({ product }: { product: Product }) => {
    const p1 = !!(product.optimized_title || product.optimized_description || product.optimized_short_description);
    const p2 = !!(product.meta_title || product.meta_description || product.seo_slug || product.faq);
    const p3 = !!((product.upsell_skus && (product.upsell_skus as any[]).length > 0) || (product.crosssell_skus && (product.crosssell_skus as any[]).length > 0));
    return (
      <div className="flex items-center justify-center gap-0.5">
        {[
          { done: p1, label: "1" },
          { done: p2, label: "2" },
          { done: p3, label: "3" },
        ].map(ph => (
          <span
            key={ph.label}
            className={cn(
              "inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-bold",
              ph.done ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground/50"
            )}
            title={`Fase ${ph.label}: ${ph.done ? "Concluída" : "Pendente"}`}
          >
            {ph.label}
          </span>
        ))}
      </div>
    );
  };

  const EMPTY_FIELD_CHECKS: { key: string; label: string }[] = [
    { key: "optimized_title", label: "Título" },
    { key: "optimized_description", label: "Descrição" },
    { key: "optimized_short_description", label: "Desc. Curta" },
    { key: "category", label: "Categoria" },
    { key: "meta_title", label: "Meta Title" },
    { key: "meta_description", label: "Meta Desc" },
    { key: "seo_slug", label: "Slug" },
    { key: "tags", label: "Tags" },
    
    { key: "image_urls", label: "Imagens" },
    { key: "focus_keyword", label: "Keyword" },
  ];

  const EmptyFieldsIndicator = ({ product }: { product: Product }) => {
    const empty = EMPTY_FIELD_CHECKS.filter(({ key }) => {
      const val = (product as any)[key];
      if (val == null) return true;
      if (typeof val === "string" && val.trim() === "") return true;
      if (Array.isArray(val) && val.length === 0) return true;
      return false;
    });
    if (empty.length === 0) return null;
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[9px] text-warning cursor-help"
        title={`Campos vazios: ${empty.map(e => e.label).join(", ")}`}
      >
        <AlertTriangle className="w-2.5 h-2.5" />
        {empty.length}
      </span>
    );
  };

  const ProductRow = ({ product }: { product: Product }) => (
    <tr
      className={cn(
        "border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer",
        product.status === "processing" && "bg-primary/5"
      )}
      onClick={() => setDetailProduct(product)}
    >
      <td className="p-3" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected.has(product.id)}
          onCheckedChange={() => toggleSelect(product.id)}
        />
      </td>
      <td className="p-3 font-mono text-xs" title={product.sku ?? undefined}>{product.sku ?? "—"}</td>
      <td className="p-3 max-w-[180px] truncate" title={product.original_title ?? undefined}>{product.original_title ?? "—"}</td>
      <td className="p-3 max-w-[180px]" onClick={(e) => e.stopPropagation()}>
        {editingCell?.id === product.id && editingCell.field === "optimized_title" ? (
          <div className="flex gap-1">
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="text-xs h-7"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveInlineEdit();
                if (e.key === "Escape") cancelInlineEdit();
              }}
            />
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={saveInlineEdit}>
              <Save className="w-3 h-3" />
            </Button>
          </div>
        ) : (
          <span
            className="truncate block text-primary font-medium cursor-text hover:bg-primary/5 rounded px-1 -mx-1"
            onDoubleClick={() => startInlineEdit(product.id, "optimized_title", product.optimized_title ?? "")}
            title={product.optimized_title || "Duplo-clique para editar"}
          >
            {product.optimized_title ?? "—"}
          </span>
        )}
      </td>
      <td className="p-3 max-w-[200px]" onClick={(e) => e.stopPropagation()}>
        <CategoryCell product={product} />
      </td>
      <td className="p-3 max-w-[140px]" onClick={(e) => e.stopPropagation()}>
        {editingCell?.id === product.id && editingCell.field === "optimized_short_description" ? (
          <div className="flex gap-1">
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="text-xs h-7"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveInlineEdit();
                if (e.key === "Escape") cancelInlineEdit();
              }}
            />
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={saveInlineEdit}>
              <Save className="w-3 h-3" />
            </Button>
          </div>
        ) : (
          <span
            className="truncate block text-xs cursor-text hover:bg-primary/5 rounded px-1 -mx-1"
            onDoubleClick={() => startInlineEdit(product.id, "optimized_short_description", product.optimized_short_description ?? "")}
            title={product.optimized_short_description || "Duplo-clique para editar"}
          >
            {product.optimized_short_description ?? "—"}
          </span>
        )}
      </td>
      <td className="p-3 max-w-[120px]" onClick={(e) => e.stopPropagation()}>
        {editingCell?.id === product.id && editingCell.field === "seo_slug" ? (
          <div className="flex gap-1">
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="text-xs h-7 font-mono"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveInlineEdit();
                if (e.key === "Escape") cancelInlineEdit();
              }}
            />
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={saveInlineEdit}>
              <Save className="w-3 h-3" />
            </Button>
          </div>
        ) : (
          <span
            className="truncate block text-xs font-mono text-muted-foreground cursor-text hover:bg-primary/5 rounded px-1 -mx-1"
            onDoubleClick={() => startInlineEdit(product.id, "seo_slug", product.seo_slug ?? "")}
            title={product.seo_slug || "Duplo-clique para editar"}
          >
            {product.seo_slug ?? "—"}
          </span>
        )}
      </td>
      <td className="p-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {product.product_type && product.product_type !== "simple" && (
            <Badge variant="secondary" className="text-[10px]">
              {product.product_type === "variable" ? "Variável" : "Variação"}
            </Badge>
          )}
          <Badge variant="outline" className={cn("text-xs", product.is_discontinued ? statusColors.discontinued : statusColors[product.status])}>
            {product.status === "processing" && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
            {product.is_discontinued ? statusLabels.discontinued : statusLabels[product.status]}
          </Badge>
          {product.woocommerce_id && (
            <div className="flex items-center gap-1">
              <Badge 
                variant="outline" 
                className="text-[10px] bg-success/10 text-success border-success/20 gap-0.5 cursor-pointer hover:bg-success/20 transition-colors"
                title={`Ver produto no site (ID: ${product.woocommerce_id})`}
                onClick={() => window.open(`${settings?.["woocommerce_url"] || ''}/?p=${product.woocommerce_id}`, '_blank')}
              >
                <Check className="w-2.5 h-2.5" />
                WC
              </Badge>
              <span 
                className="text-[9px] text-muted-foreground font-mono cursor-pointer hover:text-primary transition-colors"
                title="Abrir no WP Admin"
                onClick={() => window.open(`${settings?.["woocommerce_url"] || ''}/wp-admin/post.php?post=${product.woocommerce_id}&action=edit`, '_blank')}
              >
                #{product.woocommerce_id}
              </span>
            </div>
          )}
      {product.technical_specs && (
            <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20 gap-0.5" title="Enriquecido via Web">
              <Globe className="w-2.5 h-2.5" />
              Web
            </Badge>
          )}
          <EmptyFieldsIndicator product={product} />
          {imageStatusMap?.[product.id]?.hasOptimized && (
            <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20 gap-0.5" title="Imagem otimizada">
              <ImageIcon className="w-2.5 h-2.5" />
              Opt
            </Badge>
          )}
          {imageStatusMap?.[product.id]?.hasLifestyle && (
            <Badge variant="outline" className="text-[10px] bg-accent text-accent-foreground border-accent/50 gap-0.5" title="Imagem lifestyle">
              <Camera className="w-2.5 h-2.5" />
              Life
            </Badge>
          )}
          {product.status === "published" && (
            <>
              {getMigrationStatus(product) === "migrated" && (
                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
                  Migrado
                </Badge>
              )}
              {getMigrationStatus(product) === "partial" && (
                <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px]">
                  Parcial
                </Badge>
              )}
              {getMigrationStatus(product) === "not_migrated" && (
                <Badge variant="outline" className="text-muted-foreground text-[10px]">
                  Sem atributos
                </Badge>
              )}
            </>
          )}
          {product.publishability_decision && (
            <Badge 
              variant="outline" 
              className={cn(
                "text-[10px] gap-0.5",
                product.publishability_decision === 'publish' ? "bg-green-500/10 text-green-600 border-green-500/20" :
                product.publishability_decision === 'review' ? "bg-amber-500/10 text-amber-600 border-amber-500/20" :
                "bg-red-500/10 text-red-600 border-red-500/20"
              )}
              title={product.publishability_reason || ""}
            >
              {product.publishability_decision === 'publish' ? "✅" : 
               product.publishability_decision === 'review' ? "👁" : "❌"}
            </Badge>
          )}
        </div>
      </td>
      <td className="p-3 text-center">
        <PhaseIndicator product={product} />
      </td>
      <td className="p-3 text-center">
        {(() => {
          const score = product.seo_score ?? calculateSeoScore(product).score;
          if (score == null) return <Badge variant="outline" className="text-[10px] text-muted-foreground">—</Badge>;
          const emoji = score >= 90 ? "⭐" : score >= 70 ? "🟡" : score >= 50 ? "🟠" : "🔴";
          const colors = score >= 90 ? "bg-success/10 text-success border-success/20"
            : score >= 70 ? "bg-warning/10 text-warning border-warning/20"
            : score >= 50 ? "bg-orange-500/10 text-orange-600 border-orange-500/20"
            : "bg-destructive/10 text-destructive border-destructive/20";
          return <Badge variant="outline" className={cn("text-[10px] font-bold", colors)}>{emoji} {score}</Badge>;
        })()}
      </td>
      <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end gap-1">
          {publishabilityFilter !== "all" && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                onClick={() => handleUpdatePublishability(product.id, 'publish')}
                title="Publicar"
              >
                ✅
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={() => handleUpdatePublishability(product.id, 'skip')}
                title="Ignorar"
              >
                ❌
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setDetailProduct(product)}>
            <Edit className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => handleOptimizeClick([product.id])} disabled={optimizeProducts.isPending}>
            <Sparkles className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => updateStatus.mutate({ ids: [product.id], status: "optimized" })}>
            <Check className="w-3.5 h-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-4 sm:space-y-6 animate-fade-in">
      <div className="space-y-3">
        {issueCount !== undefined && issueCount > 0 && statusFilter !== "error" && !imageIssueFilter && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-amber-600" />
              <span className="text-sm text-amber-700">
                Existem <span className="font-bold">{issueCount}</span> produtos com problemas de imagens (falha no download ou sem imagem).
              </span>
            </div>
            <Button 
              size="sm" 
              variant="outline" 
              className="h-8 text-xs border-amber-500/50 text-amber-700 hover:bg-amber-500/20"
              onClick={() => {
                setStatusFilter("all");
                setImageIssueFilter(true);
              }}
            >
              Ver produtos sem imagem
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold text-foreground">Painel de Produtos</h1>
            <p className="text-muted-foreground text-xs sm:text-sm mt-0.5">{totalCount} produtos no total</p>
          </div>
          <Select onValueChange={(val) => {
            if (val === "clear") {
              setSelected(new Set());
              setAllPagesSelected(false);
              toast.info("Seleção limpa");
              return;
            }
            if (val === "optimized") {
              const ids = (allProductsLight ?? [])
                .filter((p: any) => p.status === "optimized")
                .map(p => p.id);
              setSelected(new Set(ids));
              setAllPagesSelected(true);
              toast.info(`${ids.length} produtos otimizados (prontos) selecionados`);
              return;
            }
            if (val === "needs_review") {
              const ids = (allProductsLight ?? [])
                .filter((p: any) => 
                  p.status === "needs_review" || 
                  (p.suggested_category && p.suggested_category !== p.category)
                )
                .map(p => p.id);
              setSelected(new Set(ids));
              setAllPagesSelected(true);
              toast.info(`${ids.length} produtos para revisão selecionados`);
              return;
            }
            const count = parseInt(val);
            if (!isNaN(count)) {
              const ids = filtered.slice(0, count).map(p => p.id);
              setSelected(new Set(ids));
              toast.info(`${ids.length} produtos selecionados`);
            }
          }}>
            <SelectTrigger className="w-[140px] sm:w-[200px] h-8 sm:h-9 text-xs sm:text-sm shrink-0">
              <SelectValue placeholder="Selecionar rápido..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="20">Primeiros 20</SelectItem>
              <SelectItem value="50">Primeiros 50</SelectItem>
              <SelectItem value="100">Primeiros 100</SelectItem>
              <SelectItem value={String(filtered.length)}>Todos visíveis ({filtered.length})</SelectItem>
              <SelectItem value="optimized" className="text-success font-medium">Prontos p/ Publicar (Otimizados)</SelectItem>
              <SelectItem value="needs_review" className="text-amber-600 font-medium">Para Rever Categorias (IA)</SelectItem>
              <SelectItem value="clear" className="text-destructive">Limpar Seleção</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-1.5 sm:gap-2 flex-wrap items-center">
          {/* Variable Products Toggle */}
          {activeWorkspace && (
            <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg border bg-muted/30">
              <GitBranch className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground" />
              <Label className="text-[10px] sm:text-xs cursor-pointer" htmlFor="var-toggle">Variáveis</Label>
              <Switch
                id="var-toggle"
                checked={activeWorkspace.has_variable_products}
                onCheckedChange={(checked) => toggleVariableProducts(activeWorkspace.id, checked)}
              />
            </div>
          )}
          <div className="flex items-center gap-1 border rounded-lg p-0.5 bg-muted/30">
            <Button
              size="sm"
              variant={viewMode === "list" ? "secondary" : "ghost"}
              className="text-xs h-7 px-2"
              onClick={() => setViewMode("list")}
            >
              <List className="w-3.5 h-3.5 mr-1" /> Lista
            </Button>
            <Button
              size="sm"
              variant={viewMode === "grouped" ? "secondary" : "ghost"}
              className="text-xs h-7 px-2"
              onClick={() => setViewMode("grouped")}
            >
              <Network className="w-3.5 h-3.5 mr-1" /> Agrupado
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            className={cn("text-xs h-8", duplicateGroups.length > 0 && "border-warning text-warning")}
            onClick={() => { runDuplicateDetection(); setShowDuplicates(true); }}
          >
            <Copy className="w-3.5 h-3.5 mr-1" />
            Duplicados{duplicateGroups.length > 0 ? ` (${duplicateGroups.length})` : ""}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-8 border-amber-500/50 text-amber-600"
            onClick={() => setShowCategoryReview(true)}
          >
            <Wand2 className="w-3.5 h-3.5 mr-1" />
            {selected.size > 0 ? `Rever Categorias IA (${selected.size} sel.)` : "Rever Categorias IA"}
            {(() => {
              if (selected.size > 0) return "";
              const catCount = (allProductsLight ?? []).filter((p: any) => p && p.suggested_category && p.suggested_category !== p.category).length;
              return catCount > 0 ? ` (${catCount})` : "";
            })()}
          </Button>
          <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => {
            setExportTarget("all");
            setExportSkuPrefix("");
            setShowExportDialog(true);
          }}>
            <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1" /> <span className="hidden sm:inline">Exportar </span>Excel
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-8 border-primary/50 text-primary"
            onClick={async () => {
              if (!activeWorkspace || selected.size === 0) {
                toast.warning("Selecione pelo menos um produto");
                return;
              }
              
              const productIds = Array.from(selected);
              const toastId = toast.loading(`A migrar imagens... (0/${productIds.length})`);
              const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
              
              let totalCached = 0;
              let totalFailed = 0;
              let totalSkipped = 0;

              // STEP 1: Try Edge Function first (fast, server-side)
              try {
                const { data, error } = await supabase.functions.invoke("cache-product-images", {
                  body: { productIds, workspaceId: activeWorkspace.id, overwrite: false }
                });
                
                if (!error && data) {
                  totalCached += data.cached || 0;
                  totalSkipped += data.skipped || 0;
                  totalFailed += data.failed || 0;
                }
              } catch (err) {
                console.warn("Edge Function failed, will retry failed images in browser:", err);
              }

              // STEP 2: For each product, check if any images are still external
              // (Edge Function failed to cache them) — retry in browser
              toast.loading(`A verificar imagens não migradas...`, { id: toastId });
              
              for (let pi = 0; pi < productIds.length; pi++) {
                const productId = productIds[pi];
                
                const { data: product } = await supabase
                  .from("products")
                  .select("id, sku, original_title, seo_slug, image_urls, workspace_id")
                  .eq("id", productId)
                  .single();
                
                if (!product?.image_urls?.length) continue;
                
                const imageUrls: string[] = Array.isArray(product.image_urls) ? product.image_urls : [];
                
                // Only process images that are still external (Edge Function didn't cache them)
                const stillExternal = imageUrls.filter(url => 
                  url && typeof url === 'string' &&
                  url.startsWith("http") && 
                  !url.includes(supabaseUrl) && 
                  !url.includes("supabase.co/storage")
                );
                
                if (stillExternal.length === 0) continue; // All cached by Edge Function ✅
                
                toast.loading(`A migrar ${stillExternal.length} imagens via browser (${pi + 1}/${productIds.length})...`, { id: toastId });
                
                const slug = (product.seo_slug || product.original_title || product.sku || "product")
                  .toLowerCase()
                  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "")
                  .substring(0, 60);
                
                const newImageUrls: string[] = [...imageUrls];
                let productChanged = false;
                
                for (let idx = 0; idx < imageUrls.length; idx++) {
                  const url = imageUrls[idx];
                  
                  // Skip already cached
                  if (!stillExternal.includes(url)) continue;
                  
                  try {
                    // Browser fetch — uses user's residential IP, bypasses CDN blocks
                    const resp = await fetch(url);
                    if (!resp.ok) {
                      const msg = `Browser fetch failed for ${url}: ${resp.status}`;
                      console.warn(msg);
                      totalFailed++;
                      
                      // Log error to database
                      const { data: userData } = await supabase.auth.getUser();
                      if (userData.user) {
                        const errorData: any = {
                          workspace_id: activeWorkspace.id,
                          user_id: userData.user.id,
                          operation_type: 'image_migration_browser',
                          sku: product.sku || product.id,
                          product_id: product.id,
                          error_message: msg,
                          error_detail: { url, status: resp.status, phase: 'browser_fetch' }
                        };
                        await supabase.from("catalog_operation_errors").insert(errorData);
                      }
                      continue;
                    }
                    
                    const blob = await resp.blob();
                    const contentType = resp.headers.get("content-type") || "image/jpeg";
                    const ext = contentType.includes("webp") ? "webp"
                      : contentType.includes("png") ? "png"
                      : contentType.includes("gif") ? "gif"
                      : "jpg";
                    
                    const filename = generateImageFilename(slug, idx, url, ext);
                    const storagePath = `${activeWorkspace.id}/${productId}/${filename}`;
                    
                    const { error: uploadError } = await supabase.storage
                      .from("product-images")
                      .upload(storagePath, blob, { contentType, upsert: true });
                    
                    if (uploadError) {
                      const msg = `Browser storage upload failed: ${uploadError.message}`;
                      console.warn(msg, uploadError);
                      totalFailed++;
                      
                      const { data: userData } = await supabase.auth.getUser();
                      if (userData.user) {
                        const errorData: any = {
                          workspace_id: activeWorkspace.id,
                          user_id: userData.user.id,
                          operation_type: 'image_migration_browser',
                          sku: product.sku || product.id,
                          product_id: product.id,
                          error_message: msg,
                          error_detail: { url, storagePath, error: uploadError, phase: 'browser_upload' }
                        };
                        await supabase.from("catalog_operation_errors").insert(errorData);
                      }
                      continue;
                    }
                    
                    const { data: { publicUrl } } = supabase.storage
                      .from("product-images")
                      .getPublicUrl(storagePath);
                    
                    newImageUrls[idx] = publicUrl;
                    productChanged = true;
                    totalCached++;
                    
                    // Subtract from failed count if Edge Function had counted this as failed
                    if (totalFailed > 0) totalFailed--;
                    
                    await supabase.from("images").upsert({
                      product_id: productId,
                      original_url: url,
                      optimized_url: publicUrl,
                      s3_key: storagePath,
                      sort_order: idx,
                      status: "done",
                    }, { onConflict: "product_id,sort_order" });
                    
                  } catch (err) {
                    console.warn(`Browser fetch exception for ${url}:`, err);
                    totalFailed++;
                  }
                }
                
                if (productChanged) {
                  await supabase
                    .from("products")
                    .update({ image_urls: newImageUrls })
                    .eq("id", productId);
                }
              }
              
              const msg = totalFailed > 0
                ? `Migração concluída: ${totalCached} migradas, ${totalSkipped} já existentes, ${totalFailed} falharam`
                : `✅ Migração concluída: ${totalCached} migradas, ${totalSkipped} já existentes`;
              
              totalFailed > 0
                ? toast.warning(msg, { id: toastId })
                : toast.success(msg, { id: toastId });
              
              qc.invalidateQueries({ queryKey: ["products"] });
            }}
          >
            <Download className="w-3.5 h-3.5 mr-1" />
            Migrar Imagens{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={imageIssueFilter ? "destructive" : "outline"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setImageIssueFilter(!imageIssueFilter)}
          >
            <Camera className={cn("w-3.5 h-3.5", imageIssueFilter ? "text-white" : "text-destructive")} />
            <span className={imageIssueFilter ? "text-white" : ""}>
              Sem Imagem ({issueCount || 0})
            </span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="text-xs h-8"
            onClick={() => {
              if (!activeWorkspace) return;
              // Parse supplier prefixes from settings
              try {
                const raw = settings?.suppliers_json;
                const suppliers = raw ? JSON.parse(raw) : [];
                const prefixes = suppliers.map((s: any) => ({
                  name: s.name || '',
                  prefix: s.prefix || '',
                  searchUrl: s.searchUrl || (s.url ? (s.url.includes('{sku}') ? s.url : s.url + '{sku}') : ''),
                  scrapingInstructions: s.scrapingInstructions || '',
                }));
                const selectedIds = selected.size > 0 ? Array.from(selected) : undefined;
                const validIds = selectedIds?.filter(id => {
                  const p = (allProductsLight ?? []).find((prod: any) => prod.id === id);
                  return !p?.is_discontinued;
                });
                
                enrich({
                  workspaceId: activeWorkspace.id,
                  supplierPrefixes: prefixes,
                  productIds: validIds,
                });
              } catch {
                toast.error("Erro ao ler prefixos de fornecedor. Verifique as Definições.");
              }
            }}
            disabled={isEnriching}
          >
            {isEnriching ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Globe className="w-3.5 h-3.5 mr-1" />}
            <span className="hidden sm:inline">Enriquecer </span>Web{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
        </div>
          <div className="flex items-center gap-1">
            <Select value={selectedImageModel} onValueChange={setSelectedImageModel}>
              <SelectTrigger className="h-8 text-xs w-[180px]">
                <SelectValue placeholder="Modelo Imagem" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Auto (Flash Image)</SelectItem>
                {IMAGE_MODELS.map((m) => (
                  <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Modo: só otimizar (rápido) ou otimizar + lifestyle (paralelo, mais caro) */}
            <Select
              value={imageProcessingMode === "off" ? "optimize_only" : imageProcessingMode}
              onValueChange={(v) => {
                const next = v as ImageProcessingMode;
                setImageProcessingMode(next);
                setIncludeImageProcessing(next !== "off");
                try { localStorage.setItem("optimize_image_processing_mode", next); } catch {}
              }}
            >
              <SelectTrigger className="h-8 text-xs w-[170px]" title="Modo de processamento de imagens">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="optimize_only">🖼️ Só otimizar</SelectItem>
                <SelectItem value="lifestyle_only">✨ Só lifestyle</SelectItem>
                <SelectItem value="optimize_and_lifestyle">🖼️ + ✨ Otimizar + Lifestyle</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-8"
              onClick={() => {
                if (!activeWorkspace) return;
                const ids = (selected.size > 0 ? Array.from(selected) : (allProductsLight ?? []).filter((p: any) => p.image_urls?.length > 0).map((p: any) => p.id).slice(0, 50))
                  .filter(id => {
                    const p = (allProductsLight ?? []).find((prod: any) => prod.id === id);
                    return !p?.is_discontinued;
                  });
                if (ids.length === 0) {
                  toast.warning("Nenhum produto com imagens para processar.");
                  return;
                }
                // Usa o helper que respeita o modo escolhido (paraleliza quando lifestyle).
                processImagesByMode({
                  workspaceId: activeWorkspace.id,
                  productIds: ids,
                  mode: imageProcessingMode === "off" ? "optimize_only" : imageProcessingMode,
                  modelOverride: selectedImageModel !== "default" ? selectedImageModel : undefined,
                  imagePromptTemplateId: selectedImagePromptTemplate !== "active" ? selectedImagePromptTemplate : undefined,
                });
              }}
              disabled={isProcessingImages}
            >
              {isProcessingImages ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5 mr-1" />}
              <span className="hidden sm:inline">Processar </span>Imagens{selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
          </div>
          {activeWorkspace?.has_variable_products && (
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-8"
              onClick={async () => {
                const selectedProducts = selected.size > 0
                  ? (allProductsLight ?? []).filter((p: any) => selected.has(p.id) && p.product_type === 'simple')
                  : (allProductsLight ?? []).filter((p: any) => p.product_type === 'simple').slice(0, 500);
                const result = await detectVariations.mutateAsync({
                  workspaceId: activeWorkspace.id,
                  products: selectedProducts.map(p => ({ id: p.id, sku: p.sku, original_title: p.original_title, optimized_title: p.optimized_title, category: p.category, original_price: p.original_price, original_description: p.original_description, short_description: p.short_description, product_type: p.product_type, attributes: p.attributes, crosssell_skus: p.crosssell_skus, upsell_skus: p.upsell_skus })),
                });
                if (result.groups.length > 0) {
                  setDetectedGroups(result.groups);
                  setSelectedGroups(new Set(result.groups.map((_, i) => i)));
                  setShowVariations(true);
                }
              }}
              disabled={detectVariations.isPending}
            >
              {detectVariations.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Layers className="w-3.5 h-3.5 mr-1" />}
              <span className="hidden sm:inline">Detetar </span>Variações{selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
          )}
          {selected.size > 0 && (
            <>
              <Button size="sm" className="text-xs h-8" onClick={() => bulkAction("optimized")}>
                <Check className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Aprovar </span>({selected.size})
              </Button>
              <Button size="sm" variant="destructive" className="text-xs h-8" onClick={() => bulkAction("error")}>
                <X className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Rejeitar </span>({selected.size})
              </Button>
              <Button size="sm" variant="destructive" className="text-xs h-8" onClick={handleBulkDelete} disabled={deleteProducts.isPending}>
                <Trash2 className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Eliminar </span>({selected.size})
              </Button>
              <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setShowPublishModal(true)} disabled={isCreatingPublish}>
                <Send className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Publicar </span>WC ({selected.size})
              </Button>
              {statusFilter === "discontinued" && (
                <Button size="sm" variant="outline" className="text-xs h-8 border-destructive text-destructive" onClick={handleDiscontinuedPublish} disabled={isCreatingPublish}>
                  <Send className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Enviar para WooCommerce como Rascunho </span>({selected.size})
                </Button>
              )}
              <Button size="sm" variant="secondary" className="text-xs h-8" onClick={() => handleOptimizeClick(Array.from(selected))} disabled={optimizeProducts.isPending}>
                <Sparkles className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Otimizar </span>IA ({selected.size})
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-8"
                onClick={() => setShowBrandInput(!showBrandInput)}
                disabled={selected.size === 0}
              >
                <Tag className="w-4 h-4 mr-2" />
                Definir Marca ({selected.size})
              </Button>

              {showBrandInput && (
                <div className="flex items-center gap-2">
                  <Input
                    value={bulkBrandValue}
                    onChange={e => setBulkBrandValue(e.target.value)}
                    placeholder="Nome da marca..."
                    className="h-8 w-48 text-sm"
                    onKeyDown={async e => {
                      if (e.key === "Enter" && bulkBrandValue.trim()) {
                        await supabase
                          .from("products")
                          .update({ brand: bulkBrandValue.trim() })
                          .in("id", Array.from(selected));
                        toast.success(`Marca "${bulkBrandValue.trim()}" aplicada a ${selected.size} produtos`);
                        setBulkBrandValue("");
                        setShowBrandInput(false);
                        qc.invalidateQueries({ queryKey: ["products"] });
                      }
                      if (e.key === "Escape") setShowBrandInput(false);
                    }}
                    autoFocus
                  />
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={async () => {
                      if (!bulkBrandValue.trim()) return;
                      await supabase
                        .from("products")
                        .update({ brand: bulkBrandValue.trim() })
                        .in("id", Array.from(selected));
                      toast.success(`Marca "${bulkBrandValue.trim()}" aplicada a ${selected.size} produtos`);
                      setBulkBrandValue("");
                      setShowBrandInput(false);
                      qc.invalidateQueries({ queryKey: ["products"] });
                    }}
                  >
                    Aplicar
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setShowBrandInput(false)}>
                    Cancelar
                  </Button>
                </div>
              )}
              <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setShowCompareModal(true)}>
                <GitCompare className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Comparar </span>IA ({selected.size})
              </Button>
              <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => {
                setExportTarget("selected");
                setExportSkuPrefix("");
                setShowExportDialog(true);
              }}>
                <Download className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Exportar Seleção </span>({selected.size})
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-8"
                onClick={() => setShowInferModelDialog(true)}
                disabled={selected.size === 0 || isInferringModels}
              >
                {isInferringModels ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Database className="w-3.5 h-3.5 mr-1" />}
                <span className="hidden sm:inline">Inferir Modelo</span> ({selected.size})
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-[10px] h-8 text-muted-foreground hover:text-primary transition-colors"
            onClick={async () => {
              if (!activeWorkspace) return;
              try {
                const { data, error } = await supabase.functions.invoke("extract-category-patterns", {
                  body: { workspaceId: activeWorkspace.id }
                });
                if (error) throw error;
                toast.success(data.message || "Padrões de categorização atualizados!");
              } catch (err: any) {
                toast.error(`Erro ao aprender padrões: ${err.message}`);
              }
            }}
          >
            🧠 Aprender Padrões
          </Button>
        </div>
      </div>


      {/* Batch Progress Bar */}
      {batchProgress && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {batchProgress.cancelled ? (
                  <Ban className="w-4 h-4 text-muted-foreground" />
                ) : batchProgress.done < batchProgress.total ? (
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                ) : (
                  <Check className="w-4 h-4 text-primary" />
                )}
                <span className="text-sm font-medium">
                  {batchProgress.cancelled
                    ? `Cancelado — ${batchProgress.done} de ${batchProgress.total} processados`
                    : batchProgress.done < batchProgress.total
                      ? `A otimizar: ${batchProgress.currentProductName}${batchProgress.currentPhaseLabel ? ` — ${batchProgress.currentPhaseLabel}` : ""}`
                      : "Otimização concluída!"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {batchProgress.estimatedSecondsLeft != null && batchProgress.done < batchProgress.total && !batchProgress.cancelled && (
                  <span className="text-xs text-muted-foreground">
                    ~{batchProgress.estimatedSecondsLeft > 60
                      ? `${Math.round(batchProgress.estimatedSecondsLeft / 60)}min`
                      : `${batchProgress.estimatedSecondsLeft}s`} restantes
                  </span>
                )}
                <span className="text-sm font-mono text-muted-foreground">
                  {batchProgress.done}/{batchProgress.total}
                </span>
                {batchProgress.done < batchProgress.total && !batchProgress.cancelled && (
                  <Button size="sm" variant="destructive" onClick={handleCancelOptimize} className="h-7 px-2 text-xs">
                    <Ban className="w-3 h-3 mr-1" /> Cancelar
                  </Button>
                )}
              </div>
            </div>
            <Progress value={(batchProgress.done / batchProgress.total) * 100} className="h-2" />
          </CardContent>
        </Card>
      )}

      {/* Enrichment Progress Bar */}
      {enrichProgress && enrichProgress.done < enrichProgress.total && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                <span className="text-sm font-medium">
                  A enriquecer: {enrichProgress.currentSku}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {enrichProgress.estimatedSecondsLeft != null && (
                  <span className="text-xs text-muted-foreground">
                    ~{enrichProgress.estimatedSecondsLeft > 60
                      ? `${Math.round(enrichProgress.estimatedSecondsLeft / 60)}min`
                      : `${enrichProgress.estimatedSecondsLeft}s`} restantes
                  </span>
                )}
                <span className="text-sm font-mono text-muted-foreground">
                  {enrichProgress.done}/{enrichProgress.total}
                </span>
              </div>
            </div>
            <Progress value={(enrichProgress.done / enrichProgress.total) * 100} className="h-2" />
          </CardContent>
        </Card>
      )}

      {/* Image Processing Progress Bar */}
      {imgProgress && imgProgress.done < imgProgress.total && (
        <Card className="border-purple-500/30 bg-purple-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                <span className="text-sm font-medium">
                  A processar imagens: {imgProgress.currentProduct}
                </span>
              </div>
              <span className="text-sm font-mono text-muted-foreground">
                {imgProgress.done}/{imgProgress.total}
              </span>
            </div>
            <Progress value={(imgProgress.done / imgProgress.total) * 100} className="h-2" />
          </CardContent>
        </Card>
      )}

      {activeJob && (activeJob.status === "processing" || activeJob.status === "queued") && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Rocket className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">
                  Background: {activeJob.current_product_name || "A processar..."}
                </span>
                <Badge variant="secondary" className="text-[10px]">4x paralelo</Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-muted-foreground">
                  {activeJob.processed_products}/{activeJob.total_products}
                </span>
                {activeJob.failed_products > 0 && (
                  <Badge variant="destructive" className="text-[10px]">
                    {activeJob.failed_products} erros
                  </Badge>
                )}
                <Button size="sm" variant="destructive" onClick={cancelJob} className="h-7 px-2 text-xs">
                  <Ban className="w-3 h-3 mr-1" /> Cancelar
                </Button>
              </div>
            </div>
            <Progress value={activeJob.total_products > 0 ? (activeJob.processed_products / activeJob.total_products) * 100 : 0} className="h-2" />
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Pode fechar o browser — o processamento continua em segundo plano.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Background Job Completed */}
      {activeJob && (activeJob.status === "completed" || activeJob.status === "cancelled") && (
        <Card className={cn(
          "border-l-4",
          activeJob.failed_products > 0 ? "border-l-destructive" : activeJob.status === "completed" ? "border-l-primary" : "border-l-warning"
        )}>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {activeJob.status === "completed" ? (
                  <Check className="w-4 h-4 text-primary" />
                ) : (
                  <Ban className="w-4 h-4 text-warning" />
                )}
                <span className="text-sm">
                  {activeJob.status === "completed"
                    ? `Job concluído: ${activeJob.processed_products - activeJob.failed_products} otimizados, ${activeJob.failed_products} erros`
                    : `Job cancelado: ${activeJob.processed_products} de ${activeJob.total_products} processados`
                  }
                </span>
                {activeJob.failed_products > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs border-destructive/50 text-destructive hover:bg-destructive/10"
                    onClick={() => setShowJobErrors((v) => !v)}
                  >
                    {showJobErrors ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
                    Ver erros ({activeJob.failed_products})
                  </Button>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={() => { dismissJob(); setShowJobErrors(false); }} className="h-7 px-2 text-xs">
                <XCircle className="w-3 h-3 mr-1" /> Fechar
              </Button>
            </div>

            {showJobErrors && activeJob.failed_products > 0 && (
              <div className="border border-destructive/20 rounded-md overflow-hidden">
                <div className="bg-destructive/5 px-3 py-1.5 text-xs font-medium text-destructive">
                  Produtos com erro
                </div>
                <div className="divide-y divide-border max-h-64 overflow-y-auto">
                  {jobItems.isLoading ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">A carregar erros...</div>
                  ) : (jobItems.data?.filter((item) => item.status === "error") || []).length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">Sem detalhes disponíveis.</div>
                  ) : (
                    jobItems.data!
                      .filter((item) => item.status === "error")
                      .map((item) => {
                        const prod = products?.find((p) => p.id === item.product_id);
                        const title = prod?.optimized_title || prod?.original_title || "Produto desconhecido";
                        const sku = prod?.sku || item.product_id.slice(0, 8);
                        return (
                          <div key={item.id} className="px-3 py-2 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <AlertTriangle className="w-3 h-3 text-destructive shrink-0" />
                              <span className="text-xs font-medium truncate">{title}</span>
                              <span className="text-[10px] text-muted-foreground font-mono shrink-0">SKU: {sku}</span>
                            </div>
                            <p className="text-[11px] text-destructive/80 pl-5 leading-snug">
                              {item.error_message || "Erro desconhecido"}
                            </p>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* WooCommerce Publish Job Progress */}
      {publishBannerVisible && activePublishJob && (activePublishJob.status === "processing" || activePublishJob.status === "queued" || activePublishJob.status === "scheduled" || activePublishJob.status === "completed") && (
        <Card className={cn(
          "border-primary/30",
          activePublishJob.status === "completed" ? "bg-success/5 border-success/30" : "bg-primary/5"
        )}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {activePublishJob.status === "scheduled" ? (
                  <Send className="w-4 h-4 text-primary" />
                ) : activePublishJob.status === "completed" ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                )}
                <span className="text-sm font-medium">
                  {activePublishJob.status === "scheduled"
                    ? `Agendado para ${activePublishJob.scheduled_for ? new Date(activePublishJob.scheduled_for).toLocaleString("pt-PT") : "..."}`
                    : activePublishJob.status === "completed"
                      ? "Publicado com sucesso"
                      : `A publicar no WC: ${activePublishJob.current_product_name || "A iniciar..."}`
                  }
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-muted-foreground">
                  {activePublishJob.status === "completed" ? activePublishJob.total_products : publishStats.confirmed}/{activePublishJob.total_products}
                </span>
                {publishStats.errors > 0 && (
                  <Badge variant="destructive" className="text-[10px]">
                    {publishStats.errors} erros
                  </Badge>
                )}
                {publishStats.skipped > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {publishStats.skipped} ignorados
                  </Badge>
                )}
                <Button size="sm" variant="outline" onClick={() => setLogsOpen(true)} className="h-7 px-2 text-xs">
                  <List className="w-3 h-3 mr-1" /> Ver logs
                </Button>
                {activePublishJob.status !== "completed" && (
                  <Button size="sm" variant="destructive" onClick={cancelPublishJob} className="h-7 px-2 text-xs">
                    <Ban className="w-3 h-3 mr-1" /> Cancelar
                  </Button>
                )}
              </div>
            </div>
            <Progress value={activePublishJob.status === "completed" ? 100 : (activePublishJob.total_products > 0 ? (publishStats.confirmed / activePublishJob.total_products) * 100 : 0)} className="h-2" />
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Só conta como publicado quando o WooCommerce confirma criação/atualização real.
            </p>
          </CardContent>
        </Card>
      )}


      {/* WooCommerce Publish Job Completed */}
      {activePublishJob && (activePublishJob.status === "cancelled" || activePublishJob.status === "failed") && (
        <Card className="border-l-4 border-l-warning">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Ban className="w-4 h-4 text-warning" />
                <span className="text-sm">
                  {activePublishJob.status === "failed" 
                    ? `Publicação falhou: ${activePublishJob.total_products} produtos` 
                    : `Publicação cancelada: ${publishStats.confirmed} publicados confirmados de ${activePublishJob.total_products}`
                  }
                </span>
              </div>
              <Button size="sm" variant="ghost" onClick={dismissPublishJob} className="h-7 px-2 text-xs">
                <XCircle className="w-3 h-3 mr-1" /> Fechar
              </Button>
            </div>
            {activePublishJob.results && (activePublishJob.results as any[]).length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {(activePublishJob.results as any[]).map((r: any, i: number) => {
                  const product = products.find(p => p.id === r.id);
                  const label = product?.optimized_title || product?.original_title || product?.sku || r.id?.slice(0, 8);
                  return (
                    <div key={i} className={cn(
                      "flex items-center gap-2 text-xs px-2 py-1 rounded",
                      r.status === "created" ? "bg-success/10 text-success" :
                      r.status === "updated" ? "bg-primary/10 text-primary" :
                      r.status === "error" ? "bg-destructive/5 text-destructive" :
                      "bg-muted text-muted-foreground"
                    )}>
                      {r.status === "created" ? <Check className="w-3 h-3 shrink-0" /> :
                       r.status === "updated" ? <Check className="w-3 h-3 shrink-0" /> :
                       r.status === "error" ? <X className="w-3 h-3 shrink-0" /> :
                       <Ban className="w-3 h-3 shrink-0" />}
                      <span className="truncate flex-1">{label}</span>
                      {r.status === "created" && <Badge className="text-[9px] bg-success/20 text-success border-success/30">Criado</Badge>}
                      {r.status === "updated" && <Badge className="text-[9px] bg-primary/20 text-primary border-primary/30">Atualizado</Badge>}
                      {r.woocommerce_id && (
                        <Badge variant="secondary" className="text-[9px]">WC #{r.woocommerce_id}</Badge>
                      )}
                      {r.error && (
                        <span className="text-[10px] text-destructive truncate max-w-[200px]" title={r.error}>{r.error}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {/* Missing variations warning banner */}
      {missingVariations.length > 0 && !dismissedMissing && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              <span className="font-semibold text-destructive text-sm">
                {missingVariations.length} variação(ões) em falta na lista
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (activeWorkspace) {
                    createMissingVariations(activeWorkspace.id, missingVariations);
                  }
                }}
              >
                Criar {missingVariations.length} variação(ões)
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDismissedMissing(true);
                }}
                className="text-muted-foreground"
              >
                Ignorar
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-40 overflow-y-auto">
            {missingVariations.map((mv, i) => (
              <div key={i} className="flex items-center gap-2 text-xs bg-background rounded px-3 py-1.5 border">
                <span className="font-mono font-semibold text-destructive">{mv.sku}</span>
                <span className="text-muted-foreground">({mv.value})</span>
                <span className="text-muted-foreground">← pai: {mv.parentSku}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Migration Progress Banner */}
      {(() => {
        const published = (products ?? []).filter(p => p.status === "published");
        const migrated = published.filter(p => getMigrationStatus(p) === "migrated");
        const publishedCount = published.length;
        const migratedCount = migrated.length;
        const migrationPct = publishedCount > 0 ? Math.round((migratedCount / publishedCount) * 100) : 0;
        return publishedCount > 0 ? (
          <div className="bg-primary/5 border border-primary/10 rounded-lg px-4 py-3 flex items-center gap-3">
            <Wand2 className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm text-muted-foreground flex-1">
              Migração de categorias:{" "}
              <span className="font-medium text-foreground">{migratedCount}</span>
              {" "}de{" "}
              <span className="font-medium text-foreground">{publishedCount}</span>
              {" "}produtos publicados já migrados
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7 bg-primary/10 border-primary/20 text-primary hover:bg-primary/20"
                onClick={() => {
                  const ids = (allProductsLight ?? [])
                    .filter((p: any) => p.status === "optimized")
                    .map(p => p.id);
                  setSelected(new Set(ids));
                  setAllPagesSelected(true);
                  toast.info(`${ids.length} produtos otimizados selecionados para publicação`);
                }}
              >
                Selecionar Prontos p/ Publicar
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7 bg-amber-500/10 border-amber-500/20 text-amber-600 hover:bg-amber-500/20"
                onClick={() => {
                  const ids = (allProductsLight ?? [])
                    .filter((p: any) => 
                      p.status === "needs_review" || 
                      (p.suggested_category && p.suggested_category !== p.category)
                    )
                    .map(p => p.id);
                  setSelected(new Set(ids));
                  setAllPagesSelected(true);
                  toast.info(`${ids.length} produtos para revisão selecionados`);
                }}
              >
                Selecionar Para Rever
              </Button>
            </div>
            <span className="text-sm font-medium text-primary">{migrationPct}%</span>
            <Progress value={migrationPct} className="w-24 h-1.5" />
          </div>
        ) : null;
      })()}
      {/* Publishability Quick Filters */}
      <div className="flex gap-2 flex-wrap mb-2">
        <Button 
          size="sm" 
          variant={publishabilityFilter === "publish" ? "default" : "outline"} 
          className={cn("h-8 text-xs", publishabilityFilter === "publish" && "bg-green-600 hover:bg-green-700")}
          onClick={() => setPublishabilityFilter(publishabilityFilter === "publish" ? "all" : "publish")}
        >
          ✅ Publicar ({stats?.publish || 0})
        </Button>
        <Button 
          size="sm" 
          variant={publishabilityFilter === "review" ? "default" : "outline"} 
          className={cn("h-8 text-xs", publishabilityFilter === "review" && "bg-amber-500 hover:bg-amber-600")}
          onClick={() => setPublishabilityFilter(publishabilityFilter === "review" ? "all" : "review")}
        >
          👁 Rever ({stats?.review || 0})
        </Button>
        <Button 
          size="sm" 
          variant={publishabilityFilter === "skip" ? "default" : "outline"} 
          className={cn("h-8 text-xs", publishabilityFilter === "skip" && "bg-red-600 hover:bg-red-700")}
          onClick={() => setPublishabilityFilter(publishabilityFilter === "skip" ? "all" : "skip")}
        >
          ❌ Ignorar ({stats?.skip || 0})
        </Button>
        <Button 
          size="sm" 
          variant={publishabilityFilter === "null" ? "default" : "outline"} 
          className="h-8 text-xs"
          onClick={() => setPublishabilityFilter(publishabilityFilter === "null" ? "all" : "null")}
        >
          ⚪ Não analisado ({stats?.unanalyzed || 0})
        </Button>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 sm:gap-3 items-center">
          <div className="relative flex-1 min-w-[150px] sm:min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Pesquisar por SKU ou título..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {/* Category filter */}
          {uniqueCategories.length > 0 && (
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[200px] h-9">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as categorias</SelectItem>
                {uniqueCategories.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex gap-1 sm:gap-1.5 flex-wrap">
            {statuses.map((s) => (
              <Button
                key={s.value}
                size="sm"
                className="text-xs h-7 sm:h-8 px-2 sm:px-3"
                variant={statusFilter === s.value ? "default" : "outline"}
                onClick={() => setStatusFilter(s.value)}
              >
                {s.label}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant={imageIssueFilter ? "default" : "outline"}
            className={cn("text-xs h-7 sm:h-8 px-2 sm:px-3", imageIssueFilter ? "bg-amber-600 hover:bg-amber-700" : "border-amber-500/50 text-amber-700 hover:bg-amber-500/10")}
            onClick={() => setImageIssueFilter(!imageIssueFilter)}
          >
            <ImageIcon className="w-3.5 h-3.5 mr-1" />
            Sem Imagens {issueCount !== undefined && issueCount > 0 && `(${issueCount})`}
          </Button>
          <Button
            size="sm"
            variant={showAdvancedFilters ? "secondary" : "outline"}
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
          >
            <Filter className="w-4 h-4 mr-1" />
            Filtros
            {(seoScoreFilter !== "all" || hasKeywordFilter !== "all" || sourceFileFilter !== "all" || productTypeFilter !== "all" || phaseFilter !== "all" || migrationFilter !== "all" || publishabilityFilter !== "all") && (
              <Badge variant="default" className="ml-1.5 h-5 w-5 p-0 flex items-center justify-center text-[10px]">
                {[seoScoreFilter, hasKeywordFilter, sourceFileFilter, productTypeFilter, phaseFilter, migrationFilter, publishabilityFilter].filter(f => f !== "all").length}
              </Badge>
            )}
          </Button>
        </div>

        {/* Advanced Filters */}
        {showAdvancedFilters && (
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                {/* SEO Score */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Score SEO</Label>
                  <Select value={seoScoreFilter} onValueChange={setSeoScoreFilter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="good">🟢 Bom (≥80)</SelectItem>
                      <SelectItem value="medium">🟡 Médio (50-79)</SelectItem>
                      <SelectItem value="weak">🔴 Fraco (&lt;50)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Focus Keywords */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Focus Keywords</Label>
                  <Select value={hasKeywordFilter} onValueChange={setHasKeywordFilter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="yes">Com keywords</SelectItem>
                      <SelectItem value="no">Sem keywords</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Source File */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Ficheiro Origem</Label>
                  <Select value={sourceFileFilter} onValueChange={setSourceFileFilter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {uniqueSourceFiles.map((sf) => (
                        <SelectItem key={sf} value={sf}>{sf}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Product Type */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Tipo</Label>
                  <Select value={productTypeFilter} onValueChange={setProductTypeFilter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="simple">Simples</SelectItem>
                      <SelectItem value="variable">Variável</SelectItem>
                      <SelectItem value="variation">Variação</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Phase Filter */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Fases</Label>
                  <Select value={phaseFilter} onValueChange={setPhaseFilter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      <SelectItem value="missing1">❌ Falta Fase 1</SelectItem>
                      <SelectItem value="missing2">❌ Falta Fase 2</SelectItem>
                      <SelectItem value="missing3">❌ Falta Fase 3</SelectItem>
                      <SelectItem value="complete">✅ Todas completas</SelectItem>
                      <SelectItem value="none">⚪ Nenhuma fase</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* WooCommerce */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">WooCommerce</Label>
                  <Select value={wooFilter} onValueChange={setWooFilter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="published">🟢 Publicados no WC</SelectItem>
                      <SelectItem value="not_published">⚪ Não publicados</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Migração */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Migração</Label>
                  <Select value={migrationFilter} onValueChange={setMigrationFilter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="migrated">Migrado</SelectItem>
                      <SelectItem value="partial">Parcial</SelectItem>
                      <SelectItem value="not_migrated">Sem atributos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end mt-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSeoScoreFilter("all");
                    setHasKeywordFilter("all");
                    setSourceFileFilter("all");
                    setProductTypeFilter("all");
                    setPhaseFilter("all");
                    setWooFilter("all");
                    setMigrationFilter("all");
                    setPublishabilityFilter("all");
                  }}
                >
                  Limpar filtros
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>Sem produtos encontrados.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-3 w-10">
                      <Checkbox
                        checked={filtered.length > 0 && (selected.size >= filtered.length || allPagesSelected)}
                        onCheckedChange={toggleSelectAll}
                      />
                    </th>
                    <th className="p-3 text-left font-medium text-muted-foreground">SKU</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Título Original</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Título Otimizado</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Categoria</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Desc. Curta</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Slug</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Estado</th>
                    <th className="p-3 text-center font-medium text-muted-foreground">Fases</th>
                    <th className="p-3 text-center font-medium text-muted-foreground">SEO</th>
                    <th className="p-3 text-right font-medium text-muted-foreground">Ações</th>
                  </tr>
                </thead>
                {/* Select all pages banner */}
                {selected.size >= filtered.length && selected.size > 0 && totalCount > filtered.length && !allPagesSelected && (
                  <caption className="caption-top">
                    <div className="bg-primary/10 text-primary text-sm py-2 px-4 text-center rounded-md mb-1">
                      {selected.size} produtos desta página selecionados.{" "}
                      <button className="underline font-semibold hover:text-primary/80" onClick={selectAllPages}>
                        Selecionar todos os {totalCount} produtos{statusFilter !== "all" ? ` (${statusFilter})` : ""}
                      </button>
                    </div>
                  </caption>
                )}
                {allPagesSelected && (
                  <caption className="caption-top">
                    <div className="bg-success/10 text-success text-sm py-2 px-4 text-center rounded-md mb-1">
                      ✓ Todos os {selected.size} produtos selecionados.{" "}
                      <button className="underline font-semibold hover:text-success/80" onClick={() => { setSelected(new Set()); setAllPagesSelected(false); }}>
                        Limpar seleção
                      </button>
                    </div>
                  </caption>
                )}
                <tbody>
                  {viewMode === "list" ? (
                    paginatedFiltered.map((product) => (
                      <ProductRow key={product.id} product={product} />
                    ))
                  ) : (
                    (groupedView ?? []).map((item) => {
                      if (item.type === "standalone") {
                        return <ProductRow key={item.product.id} product={item.product} />;
                      }
                      // Parent with children
                      const isExpanded = expandedGroups.has(item.product.id);
                      return (
                        <React.Fragment key={item.product.id}>
                          <tr
                            className={cn(
                              "border-b hover:bg-muted/30 transition-colors cursor-pointer bg-accent/30",
                              item.product.status === "processing" && "bg-primary/5"
                            )}
                            onClick={() => setDetailProduct(item.product)}
                          >
                            <td className="p-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1.5">
                                <Checkbox
                                  checked={selected.has(item.product.id)}
                                  onCheckedChange={() => toggleSelect(item.product.id)}
                                />
                                <button
                                  onClick={() => toggleGroupExpand(item.product.id)}
                                  className="p-0.5 rounded hover:bg-muted"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                                  )}
                                </button>
                              </div>
                            </td>
                            <td className="p-3 font-mono text-xs">
                              <div className="flex items-center gap-1.5">
                                <GitBranch className="w-3 h-3 text-primary shrink-0" />
                                {item.product.sku ?? "—"}
                              </div>
                            </td>
                            <td className="p-3 max-w-[180px] truncate font-medium" title={item.product.original_title ?? undefined}>{item.product.original_title ?? "—"}</td>
                            <td className="p-3 max-w-[180px] truncate text-primary font-medium" title={item.product.optimized_title ?? undefined}>{item.product.optimized_title ?? "—"}</td>
                            <td className="p-3 max-w-[200px]" onClick={(e) => e.stopPropagation()}>
                              <CategoryCell product={item.product} />
                            </td>
                            <td className="p-3 max-w-[140px] truncate text-xs" title={item.product.optimized_short_description ?? undefined}>{item.product.optimized_short_description ?? "—"}</td>
                            <td className="p-3 max-w-[120px] truncate text-xs font-mono text-muted-foreground" title={item.product.seo_slug ?? undefined}>{item.product.seo_slug ?? "—"}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-1.5">
                                <Badge variant="secondary" className="text-[10px]">Variável</Badge>
                                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                  {item.children.length} var.
                                </Badge>
                                <Badge variant="outline" className={cn("text-xs", statusColors[item.product.status])}>
                                  {statusLabels[item.product.status]}
                                </Badge>
                              </div>
                            </td>
                            <td className="p-3 text-center">
                              <PhaseIndicator product={item.product} />
                            </td>
                            <td className="p-3 text-center">
                              {(() => {
                                const score = item.product.seo_score ?? calculateSeoScore(item.product).score;
                                const emoji = score >= 90 ? "⭐" : score >= 70 ? "🟡" : score >= 50 ? "🟠" : "🔴";
                                const colors = score >= 90 ? "bg-success/10 text-success border-success/20"
                                  : score >= 70 ? "bg-warning/10 text-warning border-warning/20"
                                  : score >= 50 ? "bg-orange-500/10 text-orange-600 border-orange-500/20"
                                  : "bg-destructive/10 text-destructive border-destructive/20";
                                return <Badge variant="outline" className={cn("text-[10px] font-bold", colors)}>{emoji} {score}</Badge>;
                              })()}
                            </td>
                            <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-1">
                                {publishabilityFilter !== "all" && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                                      onClick={() => handleUpdatePublishability(item.product.id, 'publish')}
                                      title="Publicar"
                                    >
                                      ✅
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                      onClick={() => handleUpdatePublishability(item.product.id, 'skip')}
                                      title="Ignorar"
                                    >
                                      ❌
                                    </Button>
                                  </>
                                )}
                                <Button size="sm" variant="ghost" onClick={() => setDetailProduct(item.product)}>
                                  <Edit className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => handleOptimizeClick([item.product.id])} disabled={optimizeProducts.isPending}>
                                  <Sparkles className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && item.children.map((child) => (
                            <tr
                              key={child.id}
                              className={cn(
                                "border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer bg-muted/10",
                                child.status === "processing" && "bg-primary/5"
                              )}
                              onClick={() => setDetailProduct(child)}
                            >
                              <td className="p-3 pl-10" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  checked={selected.has(child.id)}
                                  onCheckedChange={() => toggleSelect(child.id)}
                                />
                              </td>
                              <td className="p-3 font-mono text-xs text-muted-foreground">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-muted-foreground/40">└</span>
                                  {child.sku ?? "—"}
                                </div>
                              </td>
                              <td className="p-3 max-w-[180px] truncate text-muted-foreground text-xs" title={child.original_title ?? undefined}>{child.original_title ?? "—"}</td>
                              <td className="p-3 max-w-[180px] truncate text-primary/70 text-xs" title={child.optimized_title ?? undefined}>{child.optimized_title ?? "—"}</td>
                              <td className="p-3 max-w-[140px]" onClick={(e) => e.stopPropagation()}>
                                <CategoryCell product={child} />
                              </td>
                              <td className="p-3 max-w-[140px] truncate text-xs text-muted-foreground" title={child.optimized_short_description ?? undefined}>{child.optimized_short_description ?? "—"}</td>
                              <td className="p-3 max-w-[120px] truncate text-xs font-mono text-muted-foreground/60" title={child.seo_slug ?? undefined}>{child.seo_slug ?? "—"}</td>
                              <td className="p-3">
                                <div className="flex items-center gap-1.5">
                                  <Badge variant="outline" className="text-[10px] text-muted-foreground border-dashed">Variação</Badge>
                                  <Badge variant="outline" className={cn("text-xs", statusColors[child.status])}>
                                    {statusLabels[child.status]}
                                  </Badge>
                                </div>
                              </td>
                              <td className="p-3 text-center">
                                <PhaseIndicator product={child} />
                              </td>
                              <td className="p-3 text-center">
                                {(() => {
                                  const score = child.seo_score ?? calculateSeoScore(child).score;
                                  const emoji = score >= 90 ? "⭐" : score >= 70 ? "🟡" : score >= 50 ? "🟠" : "🔴";
                                  const colors = score >= 90 ? "bg-success/10 text-success border-success/20"
                                    : score >= 70 ? "bg-warning/10 text-warning border-warning/20"
                                    : score >= 50 ? "bg-orange-500/10 text-orange-600 border-orange-500/20"
                                    : "bg-destructive/10 text-destructive border-destructive/20";
                                  return <Badge variant="outline" className={cn("text-[10px] font-bold", colors)}>{emoji} {score}</Badge>;
                                })()}
                              </td>
                              <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                                <div className="flex justify-end gap-1">
                                  {publishabilityFilter !== "all" && (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                                        onClick={() => handleUpdatePublishability(child.id, 'publish')}
                                        title="Publicar"
                                      >
                                        ✅
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                        onClick={() => handleUpdatePublishability(child.id, 'skip')}
                                        title="Ignorar"
                                      >
                                        ❌
                                      </Button>
                                    </>
                                  )}
                                  <Button size="sm" variant="ghost" onClick={() => setDetailProduct(child)}>
                                    <Edit className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination — always show product count */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between px-3 py-3 bg-card border rounded-lg">
          <span className="text-sm text-muted-foreground font-medium">
            {totalCount <= PAGE_SIZE
              ? `${totalCount} produto${totalCount !== 1 ? "s" : ""}`
              : `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, totalCount)} de ${totalCount} produtos`
            }
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setCurrentPage(1)}>«</Button>
              <Button size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>‹</Button>
              <span className="text-sm px-3 font-medium">Página {currentPage} / {totalPages}</span>
              <Button size="sm" variant="outline" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>›</Button>
              <Button size="sm" variant="outline" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(totalPages)}>»</Button>
            </div>
          )}
        </div>
      )}

      {/* Field Selector Dialog */}
      <Dialog open={showFieldSelector} onOpenChange={setShowFieldSelector}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5" />
              Campos a Otimizar
            </DialogTitle>
          </DialogHeader>
          {(() => {
            const alreadyOptimized = (allProductsLight ?? []).filter(
              (p: any) => pendingOptimizeIds.includes(p.id) && (p.status === "optimized" || p.status === "published")
            ).length;
            const pendingCount = pendingOptimizeIds.length - alreadyOptimized;
            return (
              <>
                <p className="text-sm text-muted-foreground">
                  Selecione os campos que pretende otimizar com IA para {pendingOptimizeIds.length} produto(s).
                </p>
                {alreadyOptimized > 0 && (
                  <div className="flex items-center gap-2 p-3 rounded-lg border border-warning/30 bg-warning/5">
                    <span className="text-warning text-lg">⚠️</span>
                    <div className="flex-1">
                      <p className="text-sm text-foreground">
                        <strong>{alreadyOptimized}</strong> produto(s) já estão otimizados{pendingCount > 0 ? ` e ${pendingCount} pendente(s)` : ""}.
                        Re-otimizar irá substituir os dados existentes.
                      </p>
                      <label className="flex items-center gap-2 mt-2 cursor-pointer">
                        <Checkbox
                          checked={confirmReoptimize}
                          onCheckedChange={(v) => setConfirmReoptimize(!!v)}
                        />
                        <span className="text-xs font-medium">Confirmo que pretendo re-otimizar</span>
                      </label>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
          <div className="space-y-3 mt-2">
            {OPTIMIZATION_PHASES.map((phaseInfo) => (
              <div key={phaseInfo.phase} className={cn(
                "rounded-lg border p-3 transition-colors",
                selectedPhases.has(phaseInfo.phase) ? "border-primary/40 bg-primary/5" : "border-border"
              )}>
                <label className="flex items-center gap-2 cursor-pointer mb-2">
                  <Checkbox
                    checked={selectedPhases.has(phaseInfo.phase)}
                    onCheckedChange={() => togglePhase(phaseInfo.phase)}
                  />
                  <div>
                    <span className="text-sm font-medium">Fase {phaseInfo.phase}: {phaseInfo.label}</span>
                    <p className="text-[10px] text-muted-foreground">{phaseInfo.description}</p>
                  </div>
                </label>
                {selectedPhases.has(phaseInfo.phase) && (
                  <div className="grid grid-cols-2 gap-1 ml-6">
                    {OPTIMIZATION_FIELDS.filter(f => f.phase === phaseInfo.phase).map((field) => (
                      <label key={field.key} className="flex items-center gap-1.5 p-1 rounded hover:bg-muted/50 cursor-pointer">
                        <Checkbox
                          checked={selectedFields.has(field.key)}
                          onCheckedChange={() => toggleField(field.key)}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-xs">{field.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <Button variant="ghost" size="sm" onClick={() => { setSelectedPhases(new Set(ALL_PHASES)); setSelectedFields(new Set(ALL_FIELDS)); }}>
              Selecionar Todos
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setSelectedPhases(new Set()); setSelectedFields(new Set()); }}>
              Limpar
            </Button>
          </div>
          {/* Model Override */}
          <div className="space-y-1.5 mt-3 pt-3 border-t">
            <Label className="text-xs font-medium">Modelo de IA</Label>
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Usar modelo padrão (Settings)</SelectItem>
                {AI_MODELS.map((m) => (
                  <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">Escolha um modelo diferente para esta otimização ou use o configurado nas Settings.</p>
          </div>
          {/* Speed Toggles */}
          <div className="space-y-2 mt-3 pt-3 border-t">
            <Label className="text-xs font-medium text-muted-foreground">⚡ Controlos de Velocidade</Label>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                <div>
                  <Label className="text-xs font-medium cursor-pointer" htmlFor="skip-knowledge">Desativar Base de Conhecimento (RAG)</Label>
                  <p className="text-[10px] text-muted-foreground">Ignora pesquisa em documentos. Mais rápido, menos contexto.</p>
                </div>
                <Switch id="skip-knowledge" checked={skipKnowledge} onCheckedChange={setSkipKnowledge} />
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                <div>
                   <Label className="text-xs font-medium cursor-pointer" htmlFor="skip-scraping">Desativar Scraping do Fornecedor</Label>
                   <p className="text-[10px] text-muted-foreground">
                     {skipScraping 
                       ? "🌐 Dados já enriquecidos via web — scraping desativado automaticamente." 
                       : "Não consulta páginas do fornecedor. Elimina ~2s por produto."}
                   </p>
                 </div>
                <Switch id="skip-scraping" checked={skipScraping} onCheckedChange={setSkipScraping} />
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                <div>
                  <Label className="text-xs font-medium cursor-pointer" htmlFor="skip-reranking">Desativar AI Reranking</Label>
                  <p className="text-[10px] text-muted-foreground">Usa ranking simples em vez de IA. Poupa 1 chamada de IA por produto.</p>
                </div>
                <Switch id="skip-reranking" checked={skipReranking} onCheckedChange={setSkipReranking} />
              </div>
            </div>
          </div>
          {/* Conteúdo Extra: Uso Profissional + Prompt Selector */}
          <div className="space-y-2 mt-3 pt-3 border-t">
            <Label className="text-xs font-medium text-muted-foreground">📖 Conteúdo Extra & Prompts</Label>
            <div className="space-y-1.5">
              <div className="rounded-lg bg-muted/30 overflow-hidden">
                <div className="flex items-center justify-between p-2">
                  <div>
                    <Label className="text-xs font-medium cursor-pointer" htmlFor="uso-prof">Gerar Uso Profissional</Label>
                    <p className="text-[10px] text-muted-foreground">Gera conteúdo editorial sobre uso profissional HORECA para cada produto.</p>
                  </div>
                  <Switch id="uso-prof" checked={includeUsoProfissional} onCheckedChange={setIncludeUsoProfissional} />
                </div>
                {includeUsoProfissional && (
                  <div className="px-3 pb-2 pt-1 border-t border-border/50 space-y-1.5">
                    <p className="text-[10px] font-medium text-muted-foreground">Destino do conteúdo:</p>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="uso-in-desc"
                        checked={usoProfissionalInDescription}
                        onCheckedChange={(v) => setUsoProfissionalInDescription(!!v)}
                        className="h-3.5 w-3.5"
                      />
                      <Label htmlFor="uso-in-desc" className="text-[11px] cursor-pointer">Na Descrição</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="uso-in-custom"
                        checked={usoProfissionalInCustomField}
                        onCheckedChange={(v) => setUsoProfissionalInCustomField(!!v)}
                        className="h-3.5 w-3.5"
                      />
                      <Label htmlFor="uso-in-custom" className="text-[11px] cursor-pointer">Campo Custom (<code className="text-[10px]">_product_conselhos</code>)</Label>
                    </div>
                    {!usoProfissionalInDescription && !usoProfissionalInCustomField && (
                      <p className="text-[10px] text-amber-600">⚠️ Selecione pelo menos um destino</p>
                    )}
                  </div>
                )}
              </div>
              <div className="rounded-lg bg-muted/30 overflow-hidden">
                <div className="p-2 space-y-2">
                  <div>
                    <Label className="text-xs font-medium">🖼️ Processamento de Imagens</Label>
                    <p className="text-[10px] text-muted-foreground">Escolhe o que correr depois da otimização de texto. Os modos seguintes correm em background, em paralelo com o resto do pipeline.</p>
                  </div>
                  <RadioGroup
                    value={imageProcessingMode}
                    onValueChange={(v) => {
                      const next = v as ImageProcessingMode;
                      setImageProcessingMode(next);
                      // Mantém o booleano legado em sync para qualquer UI que ainda dependa dele.
                      setIncludeImageProcessing(next !== "off");
                      try { localStorage.setItem("optimize_image_processing_mode", next); } catch {}
                    }}
                    className="gap-1.5"
                  >
                    <div className="flex items-start gap-2 rounded-md p-1.5 hover:bg-muted/40">
                      <RadioGroupItem value="off" id="img-mode-off" className="mt-0.5" />
                      <Label htmlFor="img-mode-off" className="text-[11px] cursor-pointer leading-tight">
                        <span className="font-medium">❌ Sem imagens</span>
                        <span className="block text-[10px] text-muted-foreground">Não processa imagens — mais rápido.</span>
                      </Label>
                    </div>
                    <div className="flex items-start gap-2 rounded-md p-1.5 hover:bg-muted/40">
                      <RadioGroupItem value="optimize_only" id="img-mode-opt" className="mt-0.5" />
                      <Label htmlFor="img-mode-opt" className="text-[11px] cursor-pointer leading-tight">
                        <span className="font-medium">🖼️ Só otimizar (recomendado)</span>
                        <span className="block text-[10px] text-muted-foreground">Limpa fundo, faz upscale. Mantém qualidade visual sem custo de IA generativa.</span>
                      </Label>
                    </div>
                    <div className="flex items-start gap-2 rounded-md p-1.5 hover:bg-muted/40">
                      <RadioGroupItem value="lifestyle_only" id="img-mode-life-only" className="mt-0.5" />
                      <Label htmlFor="img-mode-life-only" className="text-[11px] cursor-pointer leading-tight">
                        <span className="font-medium">✨ Só lifestyle</span>
                        <span className="block text-[10px] text-muted-foreground">Gera apenas as imagens contextuais HORECA com IA. Não toca nas imagens originais — mais barato que o modo combinado.</span>
                      </Label>
                    </div>
                    <div className="flex items-start gap-2 rounded-md p-1.5 hover:bg-muted/40">
                      <RadioGroupItem value="optimize_and_lifestyle" id="img-mode-life" className="mt-0.5" />
                      <Label htmlFor="img-mode-life" className="text-[11px] cursor-pointer leading-tight">
                        <span className="font-medium">🖼️ + ✨ Otimizar + Lifestyle</span>
                        <span className="block text-[10px] text-muted-foreground">Os 2 pipelines em paralelo. Mais lento e usa mais quota de IA, mas gera tudo de uma vez.</span>
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
                {(imageProcessingMode === "optimize_and_lifestyle" || imageProcessingMode === "lifestyle_only") && (
                  <div className="px-3 pb-2 pt-1 border-t border-border/50">
                    <Label className="text-xs font-medium">🖼️ Prompt de Imagem Lifestyle</Label>
                    <Select
                      value={selectedImagePromptTemplate}
                      onValueChange={(v) => {
                        setSelectedImagePromptTemplate(v);
                        try { localStorage.setItem("optimize_image_prompt_template", v); } catch {}
                      }}
                    >
                      <SelectTrigger className="h-8 mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">✅ Usar prompt ativo (padrão)</SelectItem>
                        {(imagePromptTemplates || []).map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.is_active ? "✅ " : ""}{t.prompt_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground mt-1">Só aplicado ao pipeline lifestyle. O padrão usa o prompt marcado como ativo no Prompt Governance.</p>
                  </div>
                )}
              </div>
              <div className="p-2 rounded-lg bg-muted/30">
                <Label className="text-xs font-medium">Prompt de Descrição</Label>
                <Select value={selectedPromptTemplate} onValueChange={setSelectedPromptTemplate}>
                  <SelectTrigger className="h-8 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">✅ Usar prompt ativo (padrão)</SelectItem>
                    {(promptTemplates || []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.is_active ? "✅ " : ""}{t.prompt_name} ({t.prompt_type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">Escolha qual prompt usar para esta otimização. O padrão usa o prompt marcado como ativo.</p>
              </div>
            </div>
          </div>
          {/* Background Mode Toggle */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t p-3 rounded-lg bg-primary/5 border-primary/20">
            <div className="flex items-center gap-2">
              <Rocket className="w-4 h-4 text-primary" />
              <div>
                <Label className="text-xs font-medium cursor-pointer" htmlFor="bg-mode">
                  Processamento em Background
                  <Badge variant="secondary" className="text-[10px] ml-1.5">Recomendado</Badge>
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  Processa em segundo plano com paralelismo. Pode fechar o browser — o progresso é guardado automaticamente.
                </p>
              </div>
            </div>
            <Switch
              id="bg-mode"
              checked={backgroundMode}
              onCheckedChange={setBackgroundMode}
              disabled={pendingOptimizeIds.length >= 10}
            />
          </div>
          {!backgroundMode && (
            <p className="text-[10px] text-amber-600 flex items-center gap-1 mt-1">
              <AlertTriangle className="w-3 h-3" />
              Modo direto: a UI ficará bloqueada durante o processamento. Recomendado apenas para 1-2 produtos.
            </p>
          )}
          {/* Summary of selected options */}
          <div className="mt-3 p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-1">
            <p className="text-xs font-semibold text-primary flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Resumo da Otimização
            </p>
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                {pendingOptimizeIds.length} produto(s)
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                {selectedFields.size} campo(s)
              </span>
              {Array.from(selectedPhases).sort().map(p => (
                <span key={p} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20">
                  Fase {p}
                </span>
              ))}
              {selectedModel !== "default" && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20">
                  🤖 {AI_MODELS.find(m => m.key === selectedModel)?.label || selectedModel}
                </span>
              )}
              {selectedPromptTemplate !== "active" && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                  📝 {(promptTemplates || []).find((t: any) => t.id === selectedPromptTemplate)?.prompt_name || "Custom"}
                </span>
              )}
              {includeUsoProfissional && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/10 text-green-700 dark:text-green-300 border border-green-500/20">
                  📖 Uso Profissional
                </span>
              )}
              {imageProcessingMode === "optimize_only" && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20">
                  🖼️ Só otimizar imagens
                </span>
              )}
              {imageProcessingMode === "optimize_and_lifestyle" && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20">
                  ✨ Otimizar + Lifestyle{selectedImagePromptTemplate !== "active" ? ` (${(imagePromptTemplates || []).find((t: any) => t.id === selectedImagePromptTemplate)?.prompt_name || "Custom"})` : ""}
                </span>
              )}
              {skipKnowledge && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                  ⚡ Sem Knowledge
                </span>
              )}
              {skipScraping && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                  ⚡ Sem Scraping
                </span>
              )}
              {backgroundMode && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                  🚀 Background
                </span>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFieldSelector(false)}>Cancelar</Button>
            {(() => {
              const hasAlreadyOptimized = (allProductsLight ?? []).some(
                (p: any) => pendingOptimizeIds.includes(p.id) && (p.status === "optimized" || p.status === "published")
              );
              return (
                <Button
                  onClick={handleConfirmOptimize}
                  disabled={selectedFields.size === 0 || optimizeProducts.isPending || isCreatingJob || (hasAlreadyOptimized && !confirmReoptimize)}
                >
                  {backgroundMode ? (
                    <Rocket className="w-4 h-4 mr-1" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-1" />
                  )}
                  {backgroundMode ? "Lançar em Background" : "Otimizar"} {pendingOptimizeIds.length} produto(s)
                </Button>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Variations Dialog */}
      <Dialog open={showVariations} onOpenChange={setShowVariations}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="w-5 h-5" />
              Variações Detetadas
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {detectedGroups.length} grupo(s) detetado(s). Pode mover produtos entre grupos, remover ou criar novos.
          </p>
          <div className="space-y-4 mt-2">
            {detectedGroups.map((group, idx) => (
              <Card key={idx} className={cn("transition-colors", selectedGroups.has(idx) && "border-primary")}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={selectedGroups.has(idx)}
                      onCheckedChange={() => {
                        setSelectedGroups(prev => {
                          const next = new Set(prev);
                          next.has(idx) ? next.delete(idx) : next.add(idx);
                          return next;
                        });
                      }}
                      className="mt-1"
                    />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={group.parent_title}
                          onChange={(e) => {
                            setDetectedGroups(prev => prev.map((g, i) =>
                              i === idx ? { ...g, parent_title: e.target.value } : g
                            ));
                          }}
                          className="text-sm font-medium h-8 flex-1"
                        />
                        <Input
                          value={group.attribute_name}
                          onChange={(e) => {
                            setDetectedGroups(prev => prev.map((g, i) =>
                              i === idx ? { ...g, attribute_name: e.target.value } : g
                            ));
                          }}
                          className="text-xs h-8 w-40"
                          placeholder="Atributo (ex: Tamanho)"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-destructive"
                          onClick={() => {
                            setDetectedGroups(prev => prev.filter((_, i) => i !== idx));
                            setSelectedGroups(prev => {
                              const next = new Set<number>();
                              prev.forEach(v => { if (v < idx) next.add(v); else if (v > idx) next.add(v - 1); });
                              return next;
                            });
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <div className="space-y-1.5">
                        {group.variations.map((v, vi) => {
                          const prod = products.find(p => p.id === v.product_id);
                          const sku = prod?.sku;
                          const title = prod?.original_title;
                          return (
                          <div key={vi} className="flex items-center gap-2 p-1.5 rounded bg-muted/30">
                            <Badge variant="secondary" className="text-xs shrink-0">{Object.values(v.attribute_values).join(" / ")}</Badge>
                            <Badge variant="outline" className="text-[10px] shrink-0 font-mono">
                              {sku || v.product_id.substring(0, 8)}
                            </Badge>
                            <span className="text-xs truncate flex-1 text-muted-foreground">
                              {title ?? ""}
                            </span>
                            {/* Move to another group */}
                            {detectedGroups.length > 1 && (
                              <Select
                                value=""
                                onValueChange={(targetIdx) => {
                                  const ti = parseInt(targetIdx);
                                  setDetectedGroups(prev => {
                                    const updated = [...prev];
                                    // Remove from current group
                                    updated[idx] = { ...updated[idx], variations: updated[idx].variations.filter((_, i) => i !== vi) };
                                    // Add to target group
                                    updated[ti] = { ...updated[ti], variations: [...updated[ti].variations, v] };
                                    // Remove empty groups
                                    return updated.filter(g => g.variations.length > 0);
                                  });
                                }}
                              >
                                <SelectTrigger className="h-6 w-24 text-[10px]">
                                  <span className="text-muted-foreground">Mover →</span>
                                </SelectTrigger>
                                <SelectContent>
                                  {detectedGroups.map((g, gi) =>
                                    gi !== idx ? (
                                      <SelectItem key={gi} value={String(gi)} className="text-xs">
                                        {g.parent_title.substring(0, 30)}
                                      </SelectItem>
                                    ) : null
                                  )}
                                </SelectContent>
                              </Select>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0"
                              onClick={() => {
                                setDetectedGroups(prev => {
                                  const updated = prev.map((g, i) =>
                                    i === idx ? { ...g, variations: g.variations.filter((_, j) => j !== vi) } : g
                                  );
                                  return updated.filter(g => g.variations.length > 0);
                                });
                              }}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                          );
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {group.variations.length} variações → 1 produto pai + {group.variations.length - 1} variação(ões)
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {/* Create new group */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
               setDetectedGroups(prev => [...prev, {
                 parent_title: "Novo Grupo",
                 attribute_names: ["Tamanho"],
                 variations: [],
               }]);
            }}
          >
            <Plus className="w-4 h-4 mr-1" /> Novo Grupo
          </Button>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVariations(false)}>Cancelar</Button>
            <Button
              onClick={async () => {
                const groupsToApply = detectedGroups.filter((g, i) => selectedGroups.has(i) && g.variations.length >= 2);
                if (groupsToApply.length === 0) {
                  toast("Selecione pelo menos 1 grupo com 2+ variações.");
                  return;
                }
                await applyVariations.mutateAsync({ groups: groupsToApply });
                setShowVariations(false);
                setDetectedGroups([]);
                setSelectedGroups(new Set());
              }}
              disabled={selectedGroups.size === 0 || applyVariations.isPending}
            >
              {applyVariations.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <GitBranch className="w-4 h-4 mr-1" />}
              Aplicar {selectedGroups.size} grupo(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Modal */}
      <ProductDetailModal
        product={detailProduct}
        onClose={() => setDetailProduct(null)}
      />

      {/* WooCommerce Publish Modal */}
      {(() => {
        // Compute publish info: auto-include parent + all siblings when a variation is selected,
        // and auto-include children when a variable parent is selected
        const selectedArr = Array.from(selected);
        const selectedProducts = (allProductsLight ?? []).filter((p: any) => selected.has(p.id));
        
        // 1) Variable parents selected → include their children
        const variableParentIds = selectedProducts.filter((p: any) => p.product_type === "variable").map((p: any) => p.id);
        const childVariations = (allProductsLight ?? []).filter((p: any) => p.parent_product_id && variableParentIds.includes(p.parent_product_id) && !selected.has(p.id));
        
        // 2) Variations selected → include their parent + all siblings
        const selectedVariations = selectedProducts.filter((p: any) => p.product_type === "variation" && p.parent_product_id);
        const extraParentIds = [...new Set(selectedVariations.map((p: any) => p.parent_product_id))].filter((pid: string) => !selected.has(pid) && !variableParentIds.includes(pid));
        const allFamilyParentIds = [...new Set([...variableParentIds, ...extraParentIds])];
        const siblingVariations = (allProductsLight ?? []).filter((p: any) => p.parent_product_id && allFamilyParentIds.includes(p.parent_product_id) && !selected.has(p.id));
        
        const autoIncluded = [...new Set([...childVariations.map((c: any) => c.id), ...extraParentIds, ...siblingVariations.map((c: any) => c.id)])];
        const allPublishIds = [...new Set([...selectedArr, ...autoIncluded])];
        const variationCount = autoIncluded.length;

        return (
          <WooPublishModal
            open={showPublishModal}
            onClose={() => setShowPublishModal(false)}
            productCount={allPublishIds.length}
            variableParentCount={allFamilyParentIds.length}
            autoIncludedVariationsCount={variationCount}
            isPending={isCreatingPublish}
            products={products.filter(p => allPublishIds.includes(p.id))}
            onConfirm={async (fields, pricing, scheduledFor, skuPrefix, turboMode) => {
              try {
                await createPublishJob({
                  productIds: allPublishIds,
                  publishFields: fields,
                  pricing,
                  scheduledFor,
                  workspaceId: activeWorkspace?.id,
                  skuPrefix,
                  turboMode,
                });
                setSelected(new Set());
                setShowPublishModal(false);
                toast.success("Publicação iniciada em background", {
                  description: `${allPublishIds.length} produto(s) a publicar${turboMode ? " (Turbo)" : ""}. Pode fechar o browser.`,
                });
              } catch (err: any) {
                console.error("[publish] Failed to start job", err);
                toast.error("Falha ao iniciar publicação", {
                  description: err?.message || "Erro desconhecido. Tente novamente.",
                });
              }
            }}
          />
        );
      })()}

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Download className="w-4 h-4" />
              Exportar para Excel
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {exportTarget === "selected" ? `Exportar ${selected.size} produto(s) selecionado(s).` : "Exportar todos os produtos."}
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">🏷️ Prefixo SKU (opcional)</Label>
              <p className="text-[11px] text-muted-foreground">Adiciona um prefixo aos SKUs que ainda não o tenham.</p>
              <Input
                placeholder="Ex: UD, PJ, LC..."
                value={exportSkuPrefix}
                onChange={e => setExportSkuPrefix(e.target.value.toUpperCase())}
                className="h-8 text-sm w-32"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowExportDialog(false)}>Cancelar</Button>
            <Button size="sm" onClick={async () => {
              const prefix = exportSkuPrefix.trim() || undefined;
              try {
                if (exportTarget === "selected" && !allPagesSelected) {
                  // If selection spans multiple pages, fetch all selected from DB
                  const selectedIds = Array.from(selected);
                  if (selectedIds.length <= PAGE_SIZE && selectedIds.every(id => products.some(p => p.id === id))) {
                    const prods = products.filter(p => selected.has(p.id));
                    await exportProductsToExcel(prods, "produtos-selecionados", prefix);
                  } else {
                    await exportAllProductsToExcel(activeWorkspace?.id || "", {
                      fileName: "produtos-selecionados",
                      skuPrefix: prefix,
                      statusFilter,
                    });
                  }
                  setSelected(new Set());
                } else {
                  // Fetch ALL products from DB, not just current page
                  await exportAllProductsToExcel(activeWorkspace?.id || "", {
                    fileName: "produtos-todos",
                    skuPrefix: prefix,
                    statusFilter,
                  });
                }
              } catch (e: any) {
                toast.error(e?.message ?? "Erro ao exportar produtos");
              }
              setShowExportDialog(false);
            }}>
              <Download className="w-4 h-4 mr-1" />
              Exportar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AiComparisonWizard
        open={showCompareModal}
        onOpenChange={setShowCompareModal}
        preSelectedProducts={products.filter((p) => selected.has(p.id))}
        allProducts={products}
      />
      <DuplicateDetectionDialog
        open={showDuplicates}
        onOpenChange={setShowDuplicates}
        groups={duplicateGroups}
        onDelete={(ids) => {
          deleteProducts.mutate(ids);
          setShowDuplicates(false);
        }}
        onOpenProduct={(id) => {
          const p = products.find(pr => pr.id === id);
          if (p) {
            setShowDuplicates(false);
            setDetailProduct(p);
          }
        }}
      />
      <CategoryReviewModal
        open={showCategoryReview}
        onOpenChange={setShowCategoryReview}
        products={(() => {
          const baseList = allProductsLight && allProductsLight.length > 0 
            ? allProductsLight 
            : (paginatedData?.products ?? []);
          
          if (selected.size === 0) return baseList;
          return baseList.filter((p: any) => selected.has(p.id));
        })() as any}
      />
      <PublishLogsModal
        jobId={activePublishJob?.id ?? null}
        open={logsOpen}
        onOpenChange={setLogsOpen}
      />
      
      <Dialog open={showInferModelDialog} onOpenChange={setShowInferModelDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Inferir Modelo do SKU</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Esta ação irá definir o campo "Modelo" removendo as 2 primeiras letras do SKU para os produtos selecionados.
            </p>
            <div className="flex flex-col gap-3">
              <Button 
                onClick={() => {
                  handleInferModels(true);
                  setShowInferModelDialog(false);
                }}
                className="justify-start gap-2 h-auto py-3 px-4"
                variant="outline"
              >
                <div className="text-left">
                  <div className="font-semibold text-sm">Apenas produtos sem modelo</div>
                  <div className="text-[11px] text-muted-foreground">Não altera produtos que já têm modelo definido.</div>
                </div>
              </Button>
              <Button 
                onClick={() => {
                  handleInferModels(false);
                  setShowInferModelDialog(false);
                }}
                className="justify-start gap-2 h-auto py-3 px-4"
                variant="outline"
              >
                <div className="text-left">
                  <div className="font-semibold text-sm">Todos os produtos selecionados</div>
                  <div className="text-[11px] text-muted-foreground text-destructive">Atenção: Irá sobrescrever modelos existentes.</div>
                </div>
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowInferModelDialog(false)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProductsPage;
