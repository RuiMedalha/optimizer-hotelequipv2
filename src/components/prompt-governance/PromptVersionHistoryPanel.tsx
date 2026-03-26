import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Clock, GitCompare, RotateCcw } from "lucide-react";
import type { PromptVersion } from "@/hooks/usePromptGovernance";

interface Props {
  versions: PromptVersion[];
  selectedVersionId: string | null;
  onSelectVersion: (id: string) => void;
  onActivateVersion: (versionId: string) => void;
  onCompareVersions: (v1: PromptVersion, v2: PromptVersion) => void;
  templateId: string;
}

export function PromptVersionHistoryPanel({ versions, selectedVersionId, onSelectVersion, onActivateVersion, onCompareVersions, templateId }: Props) {
  const activeVersion = versions.find(v => v.is_active);

  return (
    <div className="space-y-3">
      {versions.length > 1 && activeVersion && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={versions.length < 2}
            onClick={() => {
              const prev = versions.find(v => !v.is_active);
              if (activeVersion && prev) onCompareVersions(prev, activeVersion);
            }}
          >
            <GitCompare className="h-4 w-4 mr-1" /> Comparar com anterior
          </Button>
        </div>
      )}

      {versions.map(v => (
        <Card
          key={v.id}
          className={`cursor-pointer transition-colors ${selectedVersionId === v.id ? "border-primary" : ""}`}
          onClick={() => onSelectVersion(v.id)}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {v.is_active
                  ? <CheckCircle className="w-4 h-4 text-green-500" />
                  : <Clock className="w-4 h-4 text-muted-foreground" />
                }
                <span className="font-medium">v{v.version_number}</span>
                {v.is_active && <Badge>Ativa</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {new Date(v.created_at).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                {!v.is_active && (
                  <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); onActivateVersion(v.id); }}>
                    <RotateCcw className="h-3 w-3 mr-1" /> Ativar
                  </Button>
                )}
              </div>
            </div>
            {v.version_notes && <p className="text-xs text-muted-foreground mb-2 italic">{v.version_notes}</p>}
            <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap max-h-24 overflow-auto">{v.prompt_text}</pre>
          </CardContent>
        </Card>
      ))}

      {versions.length === 0 && (
        <p className="text-muted-foreground text-center py-8">Nenhuma versão criada.</p>
      )}
    </div>
  );
}
