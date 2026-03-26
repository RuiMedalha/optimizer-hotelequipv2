import React, { useState, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, ImageIcon, Upload, Eye, Check, X, Loader2, Trash2, Link2, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { useAssets, useRegisterAsset, useReviewAsset, useDeleteAsset, useAssetProductLinks, useAssetVariants, Asset } from "@/hooks/useAssets";
import { toast } from "sonner";

const assetTypeLabels: Record<string, string> = {
  original: "Original",
  optimized: "Otimizada",
  lifestyle: "Lifestyle",
  technical: "Técnica",
  packshot: "Packshot",
  derived: "Derivada",
};

const statusColors: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  processing: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  error: "bg-destructive/10 text-destructive border-destructive/20",
  pending_review: "bg-blue-500/10 text-blue-700 border-blue-500/20",
  archived: "bg-muted text-muted-foreground",
};

const reviewColors: Record<string, string> = {
  unreviewed: "bg-muted text-muted-foreground",
  approved: "bg-emerald-500/10 text-emerald-700",
  rejected: "bg-destructive/10 text-destructive",
};

const AssetLibraryPage = () => {
  const { activeWorkspace } = useWorkspaceContext();
  const { data: assets, isLoading } = useAssets(activeWorkspace?.id);
  const registerAsset = useRegisterAsset();
  const reviewAsset = useReviewAsset();
  const deleteAsset = useDeleteAsset();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState("all");
  const [showUpload, setShowUpload] = useState(false);
  const [uploadUrl, setUploadUrl] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  const filtered = useMemo(() => {
    let list = assets || [];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        (a.original_filename || "").toLowerCase().includes(q) ||
        (a.ai_alt_text || "").toLowerCase().includes(q) ||
        (a.ai_tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    if (typeFilter !== "all") list = list.filter(a => a.asset_type === typeFilter);
    if (statusFilter !== "all") list = list.filter(a => a.status === statusFilter);
    if (reviewFilter !== "all") list = list.filter(a => a.review_status === reviewFilter);
    return list;
  }, [assets, search, typeFilter, statusFilter, reviewFilter]);

  const stats = useMemo(() => {
    const all = assets || [];
    return {
      total: all.length,
      originals: all.filter(a => a.asset_type === "original").length,
      approved: all.filter(a => a.review_status === "approved").length,
      pending: all.filter(a => a.review_status === "unreviewed").length,
    };
  }, [assets]);

  const handleUpload = useCallback(() => {
    if (!uploadUrl.trim() || !activeWorkspace) return;
    registerAsset.mutate({
      workspaceId: activeWorkspace.id,
      imageUrl: uploadUrl.trim(),
    }, {
      onSuccess: () => {
        setUploadUrl("");
        setShowUpload(false);
      }
    });
  }, [uploadUrl, activeWorkspace, registerAsset]);

  const handleReview = useCallback((assetId: string, status: string) => {
    if (!activeWorkspace) return;
    reviewAsset.mutate({ workspaceId: activeWorkspace.id, assetId, reviewStatus: status });
  }, [activeWorkspace, reviewAsset]);

  const handleDelete = useCallback((assetId: string) => {
    if (!activeWorkspace) return;
    deleteAsset.mutate({ workspaceId: activeWorkspace.id, assetId });
    setSelectedAsset(null);
  }, [activeWorkspace, deleteAsset]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Biblioteca de Assets</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie todos os assets visuais do seu workspace
          </p>
        </div>
        <Button onClick={() => setShowUpload(true)} size="sm">
          <Upload className="w-4 h-4 mr-1.5" />
          Adicionar Asset
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{stats.total}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-primary">{stats.originals}</p>
          <p className="text-xs text-muted-foreground">Originais</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-emerald-600">{stats.approved}</p>
          <p className="text-xs text-muted-foreground">Aprovadas</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
          <p className="text-xs text-muted-foreground">Pendentes</p>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Pesquisar por nome, tags..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9 text-sm" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36 h-9 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos Tipos</SelectItem>
            {Object.entries(assetTypeLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-9 text-xs"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos Estados</SelectItem>
            <SelectItem value="active">Ativo</SelectItem>
            <SelectItem value="processing">Processando</SelectItem>
            <SelectItem value="error">Erro</SelectItem>
            <SelectItem value="pending_review">Pendente</SelectItem>
          </SelectContent>
        </Select>
        <Select value={reviewFilter} onValueChange={setReviewFilter}>
          <SelectTrigger className="w-36 h-9 text-xs"><SelectValue placeholder="Review" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas Reviews</SelectItem>
            <SelectItem value="unreviewed">Sem Review</SelectItem>
            <SelectItem value="approved">Aprovada</SelectItem>
            <SelectItem value="rejected">Rejeitada</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{filtered.length} asset(s)</span>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Nenhum asset encontrado</p>
          <p className="text-xs mt-1">Adicione assets via URL ou através do processamento de imagens.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.slice(0, 200).map(asset => (
            <Card
              key={asset.id}
              className="overflow-hidden cursor-pointer transition-all hover:shadow-md group"
              onClick={() => setSelectedAsset(asset)}
            >
              <div className="relative aspect-square bg-muted flex items-center justify-center">
                {asset.public_url ? (
                  <>
                    <img
                      src={asset.public_url}
                      alt={asset.ai_alt_text || asset.original_filename || ""}
                      className="w-full h-full object-contain"
                      loading="lazy"
                      onError={(e) => {
                        const img = e.currentTarget;
                        img.style.display = "none";
                        const fallback = img.nextElementSibling as HTMLElement | null;
                        if (fallback) fallback.style.display = "flex";
                      }}
                    />
                    <div
                      className="absolute inset-0 items-center justify-center bg-muted"
                      style={{ display: "none" }}
                    >
                      <span className="text-xs text-muted-foreground">Imagem indisponível</span>
                    </div>
                  </>
                ) : (
                  <ImageIcon className="w-10 h-10 text-muted-foreground/30" />
                )}
                <div className="absolute top-1.5 left-1.5 flex gap-1">
                  <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", statusColors[asset.status] || "")}>
                    {asset.status}
                  </Badge>
                </div>
                <div className="absolute top-1.5 right-1.5">
                  <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", reviewColors[asset.review_status] || "")}>
                    {asset.review_status === "approved" ? <Check className="w-2.5 h-2.5" /> : asset.review_status === "rejected" ? <X className="w-2.5 h-2.5" /> : "?"}
                  </Badge>
                </div>
                {asset.quality_score != null && (
                  <div className="absolute bottom-1.5 right-1.5">
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                      <Star className="w-2.5 h-2.5 mr-0.5" />{asset.quality_score}
                    </Badge>
                  </div>
                )}
              </div>
              <CardContent className="p-2.5">
                <p className="text-xs font-medium truncate text-foreground">{asset.original_filename || "Asset"}</p>
                <div className="flex items-center gap-1 mt-1">
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0">{assetTypeLabels[asset.asset_type] || asset.asset_type}</Badge>
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0">{asset.source_kind}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Upload Dialog */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar Asset</DialogTitle>
            <DialogDescription>Insira a URL da imagem para registar no DAM.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="https://example.com/image.jpg"
              value={uploadUrl}
              onChange={e => setUploadUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleUpload()}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              A deduplicação por hash é automática — assets duplicados são reutilizados.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>Cancelar</Button>
            <Button onClick={handleUpload} disabled={!uploadUrl.trim() || registerAsset.isPending}>
              {registerAsset.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}
              Registar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Asset Detail Modal */}
      <Dialog open={!!selectedAsset} onOpenChange={open => !open && setSelectedAsset(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedAsset && <AssetDetailContent asset={selectedAsset} onReview={handleReview} onDelete={handleDelete} />}
        </DialogContent>
      </Dialog>
    </div>
  );
};

function AssetDetailContent({ asset, onReview, onDelete }: { asset: Asset; onReview: (id: string, s: string) => void; onDelete: (id: string) => void }) {
  const { data: links } = useAssetProductLinks(asset.id);
  const { data: variants } = useAssetVariants(asset.id);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ImageIcon className="w-5 h-5" />
          {asset.original_filename || "Asset"}
        </DialogTitle>
      </DialogHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Preview */}
        <div className="space-y-3">
          <div className="aspect-square bg-muted rounded-lg overflow-hidden flex items-center justify-center">
            {asset.public_url ? (
              <div className="relative w-full h-full">
                <img
                  src={asset.public_url}
                  alt={asset.ai_alt_text || ""}
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    const img = e.currentTarget;
                    img.style.display = "none";
                    const fallback = img.nextElementSibling as HTMLElement | null;
                    if (fallback) fallback.style.display = "flex";
                  }}
                />
                <div
                  className="absolute inset-0 items-center justify-center bg-muted"
                  style={{ display: "none" }}
                >
                  <span className="text-xs text-muted-foreground">Imagem indisponível</span>
                </div>
              </div>
            ) : (
              <ImageIcon className="w-16 h-16 text-muted-foreground/30" />
            )}
          </div>

          {/* QA Actions */}
          <div className="flex gap-2">
            <Button size="sm" variant={asset.review_status === "approved" ? "default" : "outline"} className="flex-1" onClick={() => onReview(asset.id, "approved")}>
              <Check className="w-4 h-4 mr-1" /> Aprovar
            </Button>
            <Button size="sm" variant={asset.review_status === "rejected" ? "destructive" : "outline"} className="flex-1" onClick={() => onReview(asset.id, "rejected")}>
              <X className="w-4 h-4 mr-1" /> Rejeitar
            </Button>
          </div>
        </div>

        {/* Metadata */}
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-2">Metadata</h3>
            <div className="space-y-1.5 text-xs">
              <MetaRow label="Tipo" value={assetTypeLabels[asset.asset_type] || asset.asset_type} />
              <MetaRow label="Fonte" value={asset.source_kind} />
              <MetaRow label="Formato" value={asset.format || "-"} />
              <MetaRow label="MIME" value={asset.mime_type || "-"} />
              {asset.width && asset.height && <MetaRow label="Dimensões" value={`${asset.width}×${asset.height}`} />}
              {asset.file_size && <MetaRow label="Tamanho" value={`${(asset.file_size / 1024).toFixed(1)} KB`} />}
              <MetaRow label="Hash" value={asset.file_hash ? asset.file_hash.substring(0, 16) + "..." : "-"} />
              <MetaRow label="Estado" value={asset.status} />
              <MetaRow label="Review" value={asset.review_status} />
              {asset.quality_score != null && <MetaRow label="Quality Score" value={String(asset.quality_score)} />}
            </div>
          </div>

          {asset.ai_alt_text && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">AI Alt Text</h3>
              <p className="text-xs text-muted-foreground">{asset.ai_alt_text}</p>
            </div>
          )}

          {asset.ai_tags && asset.ai_tags.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">AI Tags</h3>
              <div className="flex flex-wrap gap-1">
                {asset.ai_tags.map((t, i) => <Badge key={i} variant="secondary" className="text-[10px]">{t}</Badge>)}
              </div>
            </div>
          )}

          {links && links.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1">
                <Link2 className="w-3.5 h-3.5" /> Produtos Associados
              </h3>
              <div className="space-y-1">
                {links.map((l: any) => (
                  <div key={l.id} className="text-xs flex items-center gap-2 text-muted-foreground">
                    <Badge variant="outline" className="text-[9px]">{l.usage_context}</Badge>
                    <span className="truncate">{l.product_id.substring(0, 8)}...</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {variants && (variants as any[]).length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">Variantes</h3>
              <div className="grid grid-cols-3 gap-2">
                {(variants as any[]).map((v: any) => (
                  <div key={v.id} className="text-center">
                    {v.public_url && (
                      <div className="relative w-full aspect-square">
                        <img
                          src={v.public_url}
                          alt={v.variant_type}
                          className="w-full aspect-square object-contain bg-muted rounded"
                          onError={(e) => {
                            const img = e.currentTarget;
                            img.style.display = "none";
                            const fallback = img.nextElementSibling as HTMLElement | null;
                            if (fallback) fallback.style.display = "flex";
                          }}
                        />
                        <div
                          className="absolute inset-0 items-center justify-center bg-muted rounded"
                          style={{ display: "none" }}
                        >
                          <span className="text-xs text-muted-foreground">Imagem indisponível</span>
                        </div>
                      </div>
                    )}
                    <p className="text-[9px] text-muted-foreground mt-0.5">{v.variant_type} {v.width && `${v.width}×${v.height}`}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button variant="destructive" size="sm" className="w-full" onClick={() => onDelete(asset.id)}>
            <Trash2 className="w-4 h-4 mr-1" /> Arquivar Asset
          </Button>
        </div>
      </div>
    </>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

export default AssetLibraryPage;
