import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Trash2, RefreshCw, Copy, Play, Eye, FileText, Edit, RotateCcw, X, Archive, Zap } from "lucide-react";

interface Props {
  job: any;
  onAction: (action: string, jobId: string) => void;
}

const DRAFT_STATES = ["queued", "parsing", "dry_run"];
const ACTIVE_STATES = ["importing", "mapping"];
const FINAL_STATES = ["done", "error"];

export function IngestionJobActionsDropdown({ job, onAction }: Props) {
  const isDraft = DRAFT_STATES.includes(job.status);
  const isActive = ACTIVE_STATES.includes(job.status);
  const isFinal = FINAL_STATES.includes(job.status);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => onAction("view", job.id)}>
          <Eye className="w-3 h-3 mr-2" /> Ver detalhes
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction("view_source", job.id)}>
          <FileText className="w-3 h-3 mr-2" /> Ver ficheiro fonte
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction("open_draft", job.id)}>
          <Zap className="w-3 h-3 mr-2" /> Ver auto-draft
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {isDraft && (
          <>
            <DropdownMenuItem onClick={() => onAction("run", job.id)}>
              <Play className="w-3 h-3 mr-2" /> Executar
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction("edit_corrections", job.id)}>
              <Edit className="w-3 h-3 mr-2" /> Editar correções
            </DropdownMenuItem>
          </>
        )}

        {isActive && (
          <DropdownMenuItem onClick={() => onAction("cancel", job.id)}>
            <X className="w-3 h-3 mr-2" /> Cancelar
          </DropdownMenuItem>
        )}

        {job.status === "error" && (
          <DropdownMenuItem onClick={() => onAction("retry_failed", job.id)}>
            <RotateCcw className="w-3 h-3 mr-2" /> Retry itens falhados
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => onAction("reparse", job.id)}>
          <RefreshCw className="w-3 h-3 mr-2" /> Re-parse
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction("remap", job.id)}>
          <RefreshCw className="w-3 h-3 mr-2" /> Re-mapear
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction("clone", job.id)}>
          <Copy className="w-3 h-3 mr-2" /> Clonar job
        </DropdownMenuItem>

        {isFinal && (
          <DropdownMenuItem onClick={() => onAction("reimport", job.id)}>
            <Play className="w-3 h-3 mr-2" /> Re-importar
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {isFinal && !isDraft && (
          <DropdownMenuItem onClick={() => onAction("archive", job.id)}>
            <Archive className="w-3 h-3 mr-2" /> Arquivar
          </DropdownMenuItem>
        )}

        {isDraft && (
          <DropdownMenuItem onClick={() => onAction("delete", job.id)} className="text-destructive">
            <Trash2 className="w-3 h-3 mr-2" /> Eliminar draft
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={() => onAction("delete_file", job.id)} className="text-destructive">
          <Trash2 className="w-3 h-3 mr-2" /> Eliminar ficheiro
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
