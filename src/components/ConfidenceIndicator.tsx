import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  score: number | null | undefined;
  source?: string;
  fieldName?: string;
  size?: "sm" | "default";
  className?: string;
}

function getColor(score: number): { dot: string; text: string; bg: string } {
  if (score >= 75) return { dot: "bg-success", text: "text-success", bg: "bg-success/10" };
  if (score >= 40) return { dot: "bg-warning", text: "text-warning", bg: "bg-warning/10" };
  return { dot: "bg-destructive", text: "text-destructive", bg: "bg-destructive/10" };
}

export function ConfidenceIndicator({ score, source, fieldName, size = "default", className }: Props) {
  if (score == null) return null;

  const colors = getColor(score);
  const label = source ? `${source} · ${score}%` : `${score}%`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 cursor-default",
            colors.bg,
            size === "sm" && "text-[10px]",
            size === "default" && "text-xs",
            className
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", colors.dot)} />
          <span className={colors.text}>{score}%</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="space-y-0.5">
          {fieldName && <div className="font-medium">{fieldName}</div>}
          <div>Confiança: {score}%</div>
          {source && <div>Fonte: {source}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
