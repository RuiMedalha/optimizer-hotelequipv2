
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { sanitizeErrorMessage } from "@/lib/sanitize-error";

export interface ImageProcessProgress {
  total: number;
  done: number;
  currentProduct: string;
}

export function useProcessImages() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ImageProcessProgress | null>(null);
  const qc = useQueryClient();

  const processImages = async ({
    workspaceId,
    productIds,
    mode = "optimize",
    modelOverride,
  }: {
    workspaceId: string;
    productIds: string[];
    mode?: "optimize" | "lifestyle";
    modelOverride?: string;
  }) => {
    setIsProcessing(true);
    setProgress({ total: productIds.length, done: 0, currentProduct: "" });

    try {
      // Process in batches of 2 (AI image processing is slow)
      const batchSize = 2;
      let totalProcessed = 0;
      let totalSkipped = 0;
      let totalFailed = 0;

      for (let i = 0; i < productIds.length; i += batchSize) {
        const batch = productIds.slice(i, i + batchSize);
        setProgress({
          total: productIds.length,
          done: i,
          currentProduct: `Lote ${Math.floor(i / batchSize) + 1}`,
        });

        const body: Record<string, unknown> = { productIds: batch, workspaceId, mode };
        if (modelOverride) body.modelOverride = modelOverride;

        const { data, error } = await supabase.functions.invoke(
          "process-product-images",
          { body }
        );

        if (error) {
          totalFailed += batch.length;
          continue;
        }

        totalProcessed += data.processed || 0;
        totalSkipped += data.skipped || 0;
        totalFailed += data.failed || 0;

        qc.invalidateQueries({ queryKey: ["products"] });
        qc.invalidateQueries({ queryKey: ["processed-images"] });
        qc.invalidateQueries({ queryKey: ["product-images"] });
      }

      setProgress({
        total: productIds.length,
        done: productIds.length,
        currentProduct: "",
      });

      if (totalProcessed > 0) {
        const modeLabel = mode === "lifestyle" ? "lifestyle" : "otimizada(s)";
        toast.success(
          `${totalProcessed} imagem(ns) ${modeLabel}!${totalSkipped > 0 ? ` (${totalSkipped} sem imagens)` : ""}`
        );
      } else if (totalSkipped > 0) {
        toast.info("Nenhum produto tinha imagens para processar.");
      } else {
        toast.warning("Nenhuma imagem foi processada.");
      }

      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["processed-images"] });
      qc.invalidateQueries({ queryKey: ["product-images"] });
      return { totalProcessed, totalSkipped, totalFailed };
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : "Erro ao processar imagens";
      toast.error(sanitizeErrorMessage(rawMsg).message);
      return null;
    } finally {
      setIsProcessing(false);
      setTimeout(() => setProgress(null), 2000);
    }
  };

  return { processImages, isProcessing, progress };
}
