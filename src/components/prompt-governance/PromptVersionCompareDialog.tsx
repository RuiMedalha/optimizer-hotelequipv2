import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { PromptVersion } from "@/hooks/usePromptGovernance";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionA: PromptVersion | null;
  versionB: PromptVersion | null;
}

export function PromptVersionCompareDialog({ open, onOpenChange, versionA, versionB }: Props) {
  if (!versionA || !versionB) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-auto">
        <DialogHeader><DialogTitle>Comparar Versões</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline">v{versionA.version_number}</Badge>
              {versionA.is_active && <Badge>Ativa</Badge>}
              <span className="text-xs text-muted-foreground">{new Date(versionA.created_at).toLocaleDateString("pt-PT")}</span>
            </div>
            {versionA.version_notes && <p className="text-xs italic text-muted-foreground">{versionA.version_notes}</p>}
            <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap max-h-[50vh] overflow-auto border">{versionA.prompt_text}</pre>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline">v{versionB.version_number}</Badge>
              {versionB.is_active && <Badge>Ativa</Badge>}
              <span className="text-xs text-muted-foreground">{new Date(versionB.created_at).toLocaleDateString("pt-PT")}</span>
            </div>
            {versionB.version_notes && <p className="text-xs italic text-muted-foreground">{versionB.version_notes}</p>}
            <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap max-h-[50vh] overflow-auto border">{versionB.prompt_text}</pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
