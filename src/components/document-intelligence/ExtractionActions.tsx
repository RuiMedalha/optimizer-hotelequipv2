import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreHorizontal, RotateCcw, Copy, Archive, Trash2, Eye, Zap } from "lucide-react";
import { useReprocessExtraction } from "@/hooks/useDocumentIntelligence";
import { EXECUTION_MODES, PROVIDER_TYPES } from "@/hooks/useDocumentIntelligence";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ExtractionActionsProps {
  extraction: any;
  onViewDetails?: (id: string) => void;
}

export function ExtractionActionsDropdown({ extraction, onViewDetails }: ExtractionActionsProps) {
  const reprocess = useReprocessExtraction();
  const queryClient = useQueryClient();
  const [reprocessMode, setReprocessMode] = useState("auto");

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("pdf_extractions")
        .update({ archived_at: new Date().toISOString(), status: "done" } as any)
        .eq("id", extraction.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Extração arquivada");
      queryClient.invalidateQueries({ queryKey: ["pdf-extractions"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      // Only allow delete of draft/queued extractions
      if (extraction.status === "done") {
        throw new Error("Não é possível apagar extrações concluídas");
      }
      const { error } = await supabase
        .from("pdf_extractions")
        .delete()
        .eq("id", extraction.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Extração eliminada");
      queryClient.invalidateQueries({ queryKey: ["pdf-extractions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onViewDetails?.(extraction.id)}>
          <Eye className="h-4 w-4 mr-2" /> Ver Detalhes
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => reprocess.mutate({ extractionId: extraction.id, mode: "auto" })}>
          <RotateCcw className="h-4 w-4 mr-2" /> Reprocessar (Auto)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => reprocess.mutate({ extractionId: extraction.id, mode: "quality_optimized" })}>
          <Zap className="h-4 w-4 mr-2" /> Reprocessar (Qualidade)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => archiveMutation.mutate()}>
          <Archive className="h-4 w-4 mr-2" /> Arquivar
        </DropdownMenuItem>
        {(extraction.status === "queued" || extraction.status === "error") && (
          <DropdownMenuItem onClick={() => deleteMutation.mutate()} className="text-destructive">
            <Trash2 className="h-4 w-4 mr-2" /> Eliminar
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ProviderSelectionProps {
  mode: string;
  onModeChange: (mode: string) => void;
  manualProvider?: string;
  onManualProviderChange?: (provider: string) => void;
}

export function ProviderModeSelector({ mode, onModeChange, manualProvider, onManualProviderChange }: ProviderSelectionProps) {
  return (
    <div className="flex items-center gap-2">
      <Select value={mode} onValueChange={onModeChange}>
        <SelectTrigger className="w-[160px] h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EXECUTION_MODES.map(m => (
            <SelectItem key={m.value} value={m.value}>
              <div>
                <p className="text-xs font-medium">{m.label}</p>
                <p className="text-[10px] text-muted-foreground">{m.description}</p>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {mode === "manual" && onManualProviderChange && (
        <Select value={manualProvider || ""} onValueChange={onManualProviderChange}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue placeholder="Provider..." />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_TYPES.map(pt => (
              <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
