import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ProductWorkflow = 
  | "draft" | "enriching" | "review" | "approved" 
  | "publishing" | "published" | "archived" | "rejected";

const workflowConfig: Record<ProductWorkflow, { label: string; className: string }> = {
  draft: { label: "Rascunho", className: "bg-muted text-muted-foreground border-border" },
  enriching: { label: "A Enriquecer", className: "bg-primary/10 text-primary border-primary/20" },
  review: { label: "Em Revisão", className: "bg-warning/10 text-warning border-warning/20" },
  approved: { label: "Aprovado", className: "bg-success/10 text-success border-success/20" },
  publishing: { label: "A Publicar", className: "bg-primary/10 text-primary border-primary/20 animate-pulse" },
  published: { label: "Publicado", className: "bg-success/10 text-success border-success/20" },
  archived: { label: "Arquivado", className: "bg-muted text-muted-foreground border-border" },
  rejected: { label: "Rejeitado", className: "bg-destructive/10 text-destructive border-destructive/20" },
};

interface Props {
  state: ProductWorkflow | null | undefined;
  size?: "sm" | "default";
  className?: string;
}

export function WorkflowStateBadge({ state, size = "default", className }: Props) {
  const workflow = state || "draft";
  const config = workflowConfig[workflow] || workflowConfig.draft;

  return (
    <Badge
      variant="outline"
      className={cn(
        config.className,
        size === "sm" && "text-[10px] px-1.5 py-0",
        className
      )}
    >
      {config.label}
    </Badge>
  );
}
