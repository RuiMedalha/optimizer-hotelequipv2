import { Alert, AlertDescription } from "@/components/ui/alert";
import { Ban, Lock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface PublishLock {
  id: string;
  reason: string;
  lock_type: string;
  locked_at: string;
  is_active: boolean;
}

interface Props {
  locks: PublishLock[];
  className?: string;
}

const lockTypeLabels: Record<string, string> = {
  quality_gate: "Quality Gate",
  manual: "Bloqueio Manual",
  validation: "Validação",
  missing_data: "Dados em Falta",
};

export function PublishBlockerAlert({ locks, className }: Props) {
  const activeLocks = locks.filter(l => l.is_active);
  if (activeLocks.length === 0) return null;

  return (
    <Alert variant="destructive" className={cn("border-destructive/30", className)}>
      <Ban className="h-4 w-4" />
      <AlertDescription>
        <div className="space-y-1">
          <div className="font-medium flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" />
            Publicação bloqueada ({activeLocks.length} {activeLocks.length === 1 ? "motivo" : "motivos"})
          </div>
          <ul className="text-xs space-y-0.5 ml-4 list-disc">
            {activeLocks.map((lock) => (
              <li key={lock.id} className="text-destructive/80">
                <span className="font-medium">{lockTypeLabels[lock.lock_type] || lock.lock_type}:</span>{" "}
                {lock.reason}
              </li>
            ))}
          </ul>
        </div>
      </AlertDescription>
    </Alert>
  );
}
