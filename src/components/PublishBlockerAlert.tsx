import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Ban, Lock, AlertTriangle, ShieldAlert, Send } from "lucide-react";
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
  onForcePublish?: () => void;
  isPublishing?: boolean;
}

const lockTypeLabels: Record<string, string> = {
  quality_gate: "Quality Gate",
  manual: "Bloqueio Manual",
  validation: "Validação",
  missing_data: "Dados em Falta",
};

const lockTypeIcons: Record<string, typeof AlertTriangle> = {
  quality_gate: ShieldAlert,
  validation: AlertTriangle,
  manual: Lock,
  missing_data: Ban,
};

export function PublishBlockerAlert({ locks, className, onForcePublish, isPublishing }: Props) {
  const activeLocks = locks.filter(l => l.is_active);
  const [confirmForce, setConfirmForce] = useState(false);

  if (activeLocks.length === 0) return null;

  const hasOnlyWarnings = activeLocks.every(l => l.lock_type === "validation" || l.lock_type === "quality_gate");

  return (
    <Alert variant="destructive" className={cn("border-destructive/30", className)}>
      <Ban className="h-4 w-4" />
      <AlertDescription>
        <div className="space-y-2">
          <div className="font-medium flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" />
            Publicação bloqueada ({activeLocks.length} {activeLocks.length === 1 ? "motivo" : "motivos"})
          </div>
          <ul className="text-xs space-y-1 ml-4 list-none">
            {activeLocks.map((lock) => {
              const Icon = lockTypeIcons[lock.lock_type] || Ban;
              return (
                <li key={lock.id} className="text-destructive/80 flex items-start gap-1.5">
                  <Icon className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>
                    <span className="font-medium">{lockTypeLabels[lock.lock_type] || lock.lock_type}:</span>{" "}
                    {lock.reason}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Force publish option */}
          {onForcePublish && hasOnlyWarnings && (
            <div className="pt-1 border-t border-destructive/20 mt-2">
              {!confirmForce ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                  onClick={() => setConfirmForce(true)}
                  disabled={isPublishing}
                >
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Publicar mesmo assim...
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-destructive/70">Tem a certeza? Os bloqueios serão ignorados.</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => {
                      onForcePublish();
                      setConfirmForce(false);
                    }}
                    disabled={isPublishing}
                  >
                    <Send className="w-3 h-3 mr-1" />
                    Confirmar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => setConfirmForce(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
