import { Button } from "@/components/ui/button";
import { Pause, Play, XCircle, RotateCcw } from "lucide-react";

interface Props {
  status: string;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  size?: "sm" | "default";
}

export function JobLifecycleControls({ status, onPause, onResume, onCancel, onRetry, size = "sm" }: Props) {
  const isRunning = ["running", "in_progress", "processing"].includes(status);
  const isFailed = ["failed", "error"].includes(status);
  const isPaused = status === "paused";

  return (
    <div className="flex items-center gap-1">
      {isRunning && onPause && (
        <Button variant="outline" size={size} onClick={onPause}><Pause className="h-3 w-3 mr-1" />Pausar</Button>
      )}
      {isRunning && onCancel && (
        <Button variant="outline" size={size} onClick={onCancel}><XCircle className="h-3 w-3 mr-1" />Cancelar</Button>
      )}
      {isPaused && onResume && (
        <Button variant="outline" size={size} onClick={onResume}><Play className="h-3 w-3 mr-1" />Retomar</Button>
      )}
      {isFailed && onRetry && (
        <Button variant="outline" size={size} onClick={onRetry}><RotateCcw className="h-3 w-3 mr-1" />Re-tentar</Button>
      )}
    </div>
  );
}
