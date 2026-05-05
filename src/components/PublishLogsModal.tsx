import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Check, X, Clock, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { pt } from "date-fns/locale";

interface PublishLogsModalProps {
  jobId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface JobItem {
  id: string;
  product_id: string;
  status: string;
  woocommerce_id: number | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  retry_count: number;
  error_message: string | null;
}

interface JobInfo {
  id: string;
  status: string;
  total_products: number;
  processed_products: number;
  failed_products: number;
  current_product_name: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

const statusConfig: Record<string, { icon: any; color: string; label: string }> = {
  done: { icon: Check, color: "text-success", label: "OK" },
  error: { icon: X, color: "text-destructive", label: "Erro" },
  skipped: { icon: AlertTriangle, color: "text-warning", label: "Ignorado" },
  processing: { icon: Loader2, color: "text-primary animate-spin", label: "A processar" },
  queued: { icon: Clock, color: "text-muted-foreground", label: "Em fila" },
};

export function PublishLogsModal({ jobId, open, onOpenChange }: PublishLogsModalProps) {
  const [job, setJob] = useState<JobInfo | null>(null);
  const [items, setItems] = useState<JobItem[]>([]);
  const [products, setProducts] = useState<Record<string, { sku: string | null; title: string | null }>>({});
  const [loading, setLoading] = useState(false);

  const fetchAll = async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const [jobRes, itemsRes] = await Promise.all([
        supabase.from("publish_jobs").select("*").eq("id", jobId).single(),
        supabase.from("publish_job_items").select("*").eq("job_id", jobId).order("created_at", { ascending: true }),
      ]);
      if (jobRes.data) setJob(jobRes.data as any);
      if (itemsRes.data) {
        setItems(itemsRes.data as any);
        const ids = Array.from(new Set(itemsRes.data.map((i: any) => i.product_id)));
        if (ids.length) {
          const { data: prods } = await supabase.from("products").select("id, sku, optimized_title, original_title").in("id", ids);
          const map: Record<string, any> = {};
          (prods || []).forEach((p: any) => {
            map[p.id] = { sku: p.sku, title: p.optimized_title || p.original_title };
          });
          setProducts(map);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !jobId) return;
    fetchAll();

    const channel = supabase
      .channel(`logs-${jobId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "publish_job_items", filter: `job_id=eq.${jobId}` }, () => fetchAll())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "publish_jobs", filter: `id=eq.${jobId}` }, (p) => setJob(p.new as any))
      .subscribe();

    const interval = setInterval(fetchAll, 5000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, jobId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Logs de Publicação WooCommerce
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={fetchAll} disabled={loading}>
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </DialogTitle>
          <DialogDescription>
            Estado em tempo real de cada produto na fila de publicação.
          </DialogDescription>
        </DialogHeader>

        {job && (
          <div className="border rounded-lg p-3 bg-muted/30 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="font-medium">Estado:</span>
              <Badge variant={job.status === "completed" ? "default" : job.status === "failed" ? "destructive" : "secondary"}>
                {job.status}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span>Progresso:</span>
              <span className="font-mono">{job.processed_products}/{job.total_products} ({job.failed_products} falhas)</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Última atualização:</span>
              <span>{formatDistanceToNow(new Date(job.updated_at), { addSuffix: true, locale: pt })}</span>
            </div>
            {job.error_message && (
              <div className="text-destructive text-xs mt-2 p-2 bg-destructive/10 rounded">
                {job.error_message}
              </div>
            )}
          </div>
        )}

        <ScrollArea className="h-[50vh] pr-3">
          <div className="space-y-2">
            {items.length === 0 && !loading && (
              <p className="text-sm text-muted-foreground text-center py-8">Sem itens registados ainda.</p>
            )}
            {items.map((item) => {
              const cfg = statusConfig[item.status] || statusConfig.queued;
              const Icon = cfg.icon;
              const product = products[item.product_id];
              return (
                <div key={item.id} className="border rounded-lg p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.color}`} />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{product?.title || item.product_id.slice(0, 8)}</div>
                        <div className="text-xs text-muted-foreground flex gap-2 flex-wrap">
                          {product?.sku && <span>SKU: {product.sku}</span>}
                          {item.woocommerce_id && <span>WC#{item.woocommerce_id}</span>}
                          {item.duration_ms != null && <span>{(item.duration_ms / 1000).toFixed(1)}s</span>}
                          {item.retry_count > 0 && <span>retries: {item.retry_count}</span>}
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">{cfg.label}</Badge>
                  </div>
                  {item.error_message && (
                    <div className="text-xs text-destructive mt-2 p-2 bg-destructive/5 rounded font-mono whitespace-pre-wrap break-all">
                      {item.error_message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
