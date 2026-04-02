import { useState, useCallback } from "react";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import {
  useSeoLifecycleList,
  useSeoLifecycleLogs,
  useSeoLifecycleStats,
  useSeoRedirects,
  useSeoLifecycleAction,
  type SeoLifecycleRecord,
} from "@/hooks/useSeoLifecycle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowRight,
  RefreshCw,
  Upload,
  Shield,
  ArrowLeftRight,
  Undo2,
  Zap,
  FileText,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

const PHASE_BADGES: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Ativo", variant: "default" },
  discontinued: { label: "Descontinuado", variant: "secondary" },
  pending_redirect: { label: "Pendente Redirect", variant: "outline" },
  redirected: { label: "Redireccionado", variant: "destructive" },
};

export default function SeoLifecyclePage() {
  const { activeWorkspace } = useWorkspaceContext();
  const workspaceId = activeWorkspace?.id;
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("lifecycle");
  const [selectedProduct, setSelectedProduct] = useState<SeoLifecycleRecord | null>(null);
  const [redirectDialog, setRedirectDialog] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState("");
  const [importDialog, setImportDialog] = useState(false);

  const { data: lifecycle = [], isLoading } = useSeoLifecycleList(workspaceId, phaseFilter);
  const { data: stats } = useSeoLifecycleStats(workspaceId);
  const { data: logs = [] } = useSeoLifecycleLogs(workspaceId, selectedProduct?.product_id);
  const { data: redirects = [] } = useSeoRedirects(workspaceId);
  const action = useSeoLifecycleAction();

  const handleForceRedirect = useCallback(() => {
    if (!selectedProduct || !workspaceId) return;
    action.mutate({
      action: "force_redirect",
      workspace_id: workspaceId,
      product_id: selectedProduct.product_id,
      destination_url: redirectUrl || undefined,
    });
    setRedirectDialog(false);
    setRedirectUrl("");
    setSelectedProduct(null);
  }, [selectedProduct, workspaceId, redirectUrl, action]);

  const handleRestore = useCallback(
    (productId: string) => {
      if (!workspaceId) return;
      action.mutate({ action: "restore", workspace_id: workspaceId, product_id: productId });
    },
    [workspaceId, action]
  );

  const handleExcelImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !workspaceId) return;

      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(ws);

      const items = rows
        .filter((r: any) => r.sku && r.action)
        .map((r: any) => ({
          sku: String(r.sku).trim(),
          action: String(r.action).trim().toLowerCase(),
          redirect_target_url: r.redirect_target_url ? String(r.redirect_target_url).trim() : undefined,
          days_before_redirect: r.days_before_redirect ? Number(r.days_before_redirect) : undefined,
        }));

      if (items.length === 0) {
        toast.error("Nenhum item válido encontrado no Excel");
        return;
      }

      action.mutate({ action: "bulk_import", workspace_id: workspaceId, items });
      setImportDialog(false);
    },
    [workspaceId, action]
  );

  const productTitle = (rec: SeoLifecycleRecord) =>
    rec.product?.optimized_title || rec.product?.original_title || rec.sku || "—";

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SEO Lifecycle</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gestão do ciclo de vida SEO dos produtos
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportDialog(true)}>
            <Upload className="w-4 h-4 mr-2" />
            Importar Excel
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(["active", "discontinued", "pending_redirect", "redirected"] as const).map((phase) => {
          const info = PHASE_BADGES[phase];
          return (
            <button
              key={phase}
              onClick={() => setPhaseFilter(phaseFilter === phase ? "all" : phase)}
              className={`rounded-xl border p-4 text-left transition-all hover:shadow-md ${
                phaseFilter === phase ? "ring-2 ring-primary border-primary" : "border-border"
              }`}
            >
              <p className="text-xs text-muted-foreground font-medium">{info.label}</p>
              <p className="text-2xl font-bold mt-1">{stats?.[phase] ?? 0}</p>
            </button>
          );
        })}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="lifecycle">
            <Shield className="w-4 h-4 mr-2" />
            Produtos
          </TabsTrigger>
          <TabsTrigger value="redirects">
            <ArrowLeftRight className="w-4 h-4 mr-2" />
            Redirects
          </TabsTrigger>
          <TabsTrigger value="logs">
            <FileText className="w-4 h-4 mr-2" />
            Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lifecycle" className="mt-4">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : lifecycle.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>Nenhum produto no ciclo de vida SEO</p>
              <p className="text-xs mt-1">
                Produtos descontinuados aparecerão aqui automaticamente
              </p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Fase</TableHead>
                    <TableHead>URL Atual</TableHead>
                    <TableHead>Redirect Para</TableHead>
                    <TableHead>Descontinuado</TableHead>
                    <TableHead>Dias</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lifecycle.map((rec) => {
                    const badge = PHASE_BADGES[rec.lifecycle_phase] || PHASE_BADGES.active;
                    return (
                      <TableRow key={rec.id}>
                        <TableCell className="font-medium max-w-[200px] truncate">
                          {productTitle(rec)}
                        </TableCell>
                        <TableCell className="text-xs font-mono">{rec.sku || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate">
                          {rec.current_url || "—"}
                        </TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate">
                          {rec.redirect_target_url || "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {rec.discontinued_at
                            ? new Date(rec.discontinued_at).toLocaleDateString("pt-PT")
                            : "—"}
                        </TableCell>
                        <TableCell>{rec.days_before_redirect ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            {rec.lifecycle_phase !== "redirected" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedProduct(rec);
                                  setRedirectDialog(true);
                                }}
                                title="Forçar redirect"
                              >
                                <Zap className="w-4 h-4" />
                              </Button>
                            )}
                            {rec.lifecycle_phase !== "active" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRestore(rec.product_id)}
                                title="Restaurar"
                              >
                                <Undo2 className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setSelectedProduct(selectedProduct?.id === rec.id ? null : rec)
                              }
                              title="Ver logs"
                            >
                              <FileText className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Logs panel for selected product */}
          {selectedProduct && !redirectDialog && (
            <div className="mt-4 rounded-lg border p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">
                Logs: {productTitle(selectedProduct)}
              </h3>
              {logs.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem logs</p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-auto">
                  {logs.map((l) => (
                    <div key={l.id} className="flex items-start gap-3 text-xs">
                      <span className="text-muted-foreground whitespace-nowrap">
                        {new Date(l.created_at).toLocaleString("pt-PT")}
                      </span>
                      <Badge variant="outline" className="shrink-0">
                        {l.event_type}
                      </Badge>
                      {l.old_phase && l.new_phase && (
                        <span className="flex items-center gap-1">
                          {PHASE_BADGES[l.old_phase]?.label || l.old_phase}
                          <ArrowRight className="w-3 h-3" />
                          {PHASE_BADGES[l.new_phase]?.label || l.new_phase}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="redirects" className="mt-4">
          {redirects.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ArrowLeftRight className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>Nenhum redirect criado</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Razão</TableHead>
                    <TableHead>Criado</TableHead>
                    <TableHead>Aplicado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {redirects.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs font-mono max-w-[200px] truncate">
                        {r.source_url}
                      </TableCell>
                      <TableCell className="text-xs font-mono max-w-[200px] truncate">
                        {r.destination_url}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.redirect_type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.status === "applied"
                              ? "default"
                              : r.status === "failed"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{r.reason || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {new Date(r.created_at).toLocaleDateString("pt-PT")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.applied_at
                          ? new Date(r.applied_at).toLocaleDateString("pt-PT")
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <LogsTab workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>

      {/* Force Redirect Dialog */}
      <Dialog open={redirectDialog} onOpenChange={setRedirectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Forçar Redireccionamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Produto: <strong>{selectedProduct && productTitle(selectedProduct)}</strong>
            </p>
            <div>
              <label className="text-sm font-medium">URL de destino (opcional)</label>
              <Input
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
                placeholder="/product-category/categoria/ ou deixar vazio para auto"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Se vazio, será usado: categoria primária → /loja/
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRedirectDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleForceRedirect} disabled={action.isPending}>
              {action.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Forçar Redirect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Excel Import Dialog */}
      <Dialog open={importDialog} onOpenChange={setImportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar Excel — SEO Lifecycle</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              O Excel deve ter as colunas: <code className="text-xs bg-muted px-1 py-0.5 rounded">sku</code>,{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">action</code> (discontinue / redirect_now / restore),{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">redirect_target_url</code> (opcional),{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">days_before_redirect</code> (opcional)
            </p>
            <Input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelImport} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LogsTab({ workspaceId }: { workspaceId: string | undefined }) {
  const { data: logs = [], isLoading } = useSeoLifecycleLogs(workspaceId);

  if (isLoading) return <Loader2 className="w-6 h-6 mx-auto animate-spin mt-8" />;

  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>Sem logs de lifecycle</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Evento</TableHead>
            <TableHead>Transição</TableHead>
            <TableHead>Detalhes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="text-xs">
                {new Date(l.created_at).toLocaleString("pt-PT")}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{l.event_type}</Badge>
              </TableCell>
              <TableCell className="text-xs">
                {l.old_phase && l.new_phase ? (
                  <span className="flex items-center gap-1">
                    {l.old_phase} <ArrowRight className="w-3 h-3" /> {l.new_phase}
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-xs max-w-[300px] truncate">
                {l.details ? JSON.stringify(l.details) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
