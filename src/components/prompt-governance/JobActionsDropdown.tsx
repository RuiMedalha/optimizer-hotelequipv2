import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Pause, Play, XCircle, RotateCcw, Copy, Settings, Trash2 } from "lucide-react";

interface Props {
  status: string;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  onClone?: () => void;
  onViewConfig?: () => void;
  onDelete?: () => void;
}

export function JobActionsDropdown({ status, onPause, onResume, onCancel, onRetry, onClone, onViewConfig, onDelete }: Props) {
  const isRunning = ["running", "in_progress", "processing"].includes(status);
  const isFailed = ["failed", "error"].includes(status);
  const isDraft = status === "draft";
  const isPaused = status === "paused";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onViewConfig && <DropdownMenuItem onClick={onViewConfig}><Settings className="h-4 w-4 mr-2" />Ver Configuração</DropdownMenuItem>}
        {isRunning && onPause && <DropdownMenuItem onClick={onPause}><Pause className="h-4 w-4 mr-2" />Pausar</DropdownMenuItem>}
        {isRunning && onCancel && <DropdownMenuItem onClick={onCancel}><XCircle className="h-4 w-4 mr-2" />Cancelar</DropdownMenuItem>}
        {isPaused && onResume && <DropdownMenuItem onClick={onResume}><Play className="h-4 w-4 mr-2" />Retomar</DropdownMenuItem>}
        {isFailed && onRetry && <DropdownMenuItem onClick={onRetry}><RotateCcw className="h-4 w-4 mr-2" />Re-tentar</DropdownMenuItem>}
        {onClone && <DropdownMenuItem onClick={onClone}><Copy className="h-4 w-4 mr-2" />Clonar</DropdownMenuItem>}
        {isDraft && onDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />Apagar
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
