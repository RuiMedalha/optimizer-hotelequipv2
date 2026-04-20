
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

/**
 * Modos de processamento de imagens disponíveis em toda a app.
 *
 *  - "off":                    não processa imagens.
 *  - "optimize_only":          só corre o pipeline de otimização (limpar fundo,
 *                              upscale). Mais rápido. Recomendado por defeito.
 *  - "optimize_and_lifestyle": corre os dois pipelines (optimize + lifestyle).
 *                              Quando usado via {@link useProcessImages.processImagesByMode}
 *                              os dois lotes correm em PARALELO para reduzir
 *                              tempo total à custa de mais quota AI simultânea.
 */
export type ImageProcessingMode = "off" | "optimize_only" | "optimize_and_lifestyle";

export const IMAGE_PROCESSING_MODE_DEFAULT: ImageProcessingMode = "optimize_only";

export function useProcessImages() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ImageProcessProgress | null>(null);
  const qc = useQueryClient();

  const processImages = async ({
    workspaceId,
    productIds,
    mode = "optimize",
    modelOverride,
    imagePromptTemplateId,
  }: {
    workspaceId: string;
    productIds: string[];
    mode?: "optimize" | "lifestyle";
    modelOverride?: string;
    imagePromptTemplateId?: string;
  }) => {
    // Guard: imagePromptTemplateId só aplica ao modo lifestyle.
    // Em modo "optimize" ignoramos para evitar misturar comportamentos.
    const safeTemplateId = mode === "lifestyle" ? imagePromptTemplateId : undefined;
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
        if (safeTemplateId) body.imagePromptTemplateId = safeTemplateId;

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

  /**
   * Helper de alto nível: corre o pipeline correto consoante o modo escolhido.
   *
   * Regras:
   *  - "off"                    → no-op (devolve null).
   *  - "optimize_only"          → 1 chamada (mode: "optimize").
   *  - "optimize_and_lifestyle" → 2 chamadas em PARALELO (Promise.all):
   *                               optimize + lifestyle. Reduz tempo total
   *                               à custa de mais quota AI simultânea.
   */
  const processImagesByMode = async (params: {
    workspaceId: string;
    productIds: string[];
    mode: ImageProcessingMode;
    modelOverride?: string;
    imagePromptTemplateId?: string;
  }) => {
    const { workspaceId, productIds, mode, modelOverride, imagePromptTemplateId } = params;
    if (mode === "off" || productIds.length === 0) return null;

    if (mode === "optimize_only") {
      return processImages({ workspaceId, productIds, mode: "optimize", modelOverride });
    }

    // optimize_and_lifestyle → paraleliza os dois lotes.
    const [optRes, lifeRes] = await Promise.all([
      processImages({ workspaceId, productIds, mode: "optimize", modelOverride }),
      processImages({ workspaceId, productIds, mode: "lifestyle", modelOverride, imagePromptTemplateId }),
    ]);
    return { optimize: optRes, lifestyle: lifeRes };
  };

  return { processImages, processImagesByMode, isProcessing, progress };
}
