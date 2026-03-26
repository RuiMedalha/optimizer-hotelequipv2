import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, Rocket, Trash2, Eye, AlertTriangle, CheckCircle, MoreHorizontal, Edit, Archive, FileText } from "lucide-react";

interface Props {
  draft: any;
  onPromote: (draftId: string) => void;
  onDelete: (draftId: string) => void;
  onUpdate: (id: string, updates: Record<string, any>) => void;
  onArchive: (id: string) => void;
  isPromoting: boolean;
}

export function AutoPlaybookDraftPanel({ draft, onPromote, onDelete, onUpdate, onArchive, isPromoting }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState(draft?.playbook_name || "");

  if (!draft) return null;

  const confidence = Math.round((draft.confidence_score || 0) * 100);
  const reviewFields = draft.needs_review_fields || [];
  const mapping = draft.column_mapping || {};
  const mappedCount = Object.keys(mapping).length;

  return (
    <>
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              {confidence >= 70 ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              )}
              {draft.playbook_name}
              <Badge variant="outline" className="text-[10px]">{confidence}%</Badge>
              {draft.auto_generated && <Badge className="text-[10px] bg-primary/10 text-primary">Auto</Badge>}
              <Badge variant={draft.status === "promoted" ? "default" : "secondary"} className="text-[10px]">
                {draft.status}
              </Badge>
              {draft.version_number > 1 && (
                <Badge variant="outline" className="text-[10px]">v{draft.version_number}</Badge>
              )}
            </CardTitle>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setExpanded(!expanded)}>
                <Eye className="w-3 h-3 mr-1" /> {expanded ? "Ocultar" : "Detalhes"}
              </Button>
              {draft.status === "draft" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => onPromote(draft.id)}>
                      <Rocket className="w-3 h-3 mr-2" /> Promover a Playbook
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setNewName(draft.playbook_name); setRenameOpen(true); }}>
                      <Edit className="w-3 h-3 mr-2" /> Renomear
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {draft.ingestion_job_id && (
                      <DropdownMenuItem disabled>
                        <FileText className="w-3 h-3 mr-2" /> Origem: Ingestão
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => onArchive(draft.id)}>
                      <Archive className="w-3 h-3 mr-2" /> Arquivar
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onDelete(draft.id)} className="text-destructive">
                      <Trash2 className="w-3 h-3 mr-2" /> Eliminar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </CardHeader>

        {expanded && (
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-muted-foreground">Colunas mapeadas</p>
                <p className="font-medium">{mappedCount}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Regras matching</p>
                <p className="font-medium">{(draft.matching_rules || []).length}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Regras agrupamento</p>
                <p className="font-medium">{(draft.grouping_rules || []).length}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Campos a rever</p>
                <p className="font-medium">{reviewFields.length}</p>
              </div>
            </div>

            {draft.ingestion_job_id && (
              <p className="text-xs text-muted-foreground">
                📎 Gerado a partir de ingestão <span className="font-mono">{draft.ingestion_job_id.slice(0, 8)}</span>
              </p>
            )}

            <div>
              <p className="text-xs font-medium mb-1">Mapeamento</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(mapping).map(([header, field]) => (
                  <Badge key={header} variant="outline" className="text-[10px]">
                    {header} → {String(field)}
                  </Badge>
                ))}
              </div>
            </div>

            {reviewFields.length > 0 && (
              <div>
                <p className="text-xs font-medium mb-1 text-amber-600">Campos com baixa confiança</p>
                <div className="flex flex-wrap gap-1">
                  {reviewFields.map((f: string) => (
                    <Badge key={f} variant="secondary" className="text-[10px] border-amber-500/30">{f}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Renomear Draft</DialogTitle></DialogHeader>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome do draft" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>Cancelar</Button>
            <Button onClick={() => { onUpdate(draft.id, { playbook_name: newName }); setRenameOpen(false); }}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
