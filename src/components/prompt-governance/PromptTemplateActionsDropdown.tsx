import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Pencil, Copy, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import type { PromptTemplate } from "@/hooks/usePromptGovernance";

interface Props {
  template: PromptTemplate;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}

export function PromptTemplateActionsDropdown({ template, onEdit, onDuplicate, onArchive, onRestore, onDelete }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
        {template.workspace_id && (
          <DropdownMenuItem onClick={onEdit}><Pencil className="h-4 w-4 mr-2" />Editar</DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onDuplicate}><Copy className="h-4 w-4 mr-2" />Duplicar</DropdownMenuItem>
        {template.workspace_id && (
          <>
            <DropdownMenuSeparator />
            {template.is_active ? (
              <DropdownMenuItem onClick={onArchive}><Archive className="h-4 w-4 mr-2" />Arquivar</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={onRestore}><ArchiveRestore className="h-4 w-4 mr-2" />Restaurar</DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />Apagar
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
