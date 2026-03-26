import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  qualityScore: number | null;
  validationStatus?: string | null;
  className?: string;
}

export function TrustScoreCard({ qualityScore, validationStatus, className }: Props) {
  if (qualityScore == null) return null;

  const color = qualityScore >= 70 ? "text-success" : qualityScore >= 40 ? "text-warning" : "text-destructive";
  const bg = qualityScore >= 70 ? "bg-success/10" : qualityScore >= 40 ? "bg-warning/10" : "bg-destructive/10";
  const label = qualityScore >= 70 ? "Bom" : qualityScore >= 40 ? "Médio" : "Fraco";

  const statusLabel: Record<string, { text: string; color: string }> = {
    valid: { text: "Validado", color: "text-success" },
    partial: { text: "Com avisos", color: "text-warning" },
    invalid: { text: "Inválido", color: "text-destructive" },
    unvalidated: { text: "Não validado", color: "text-muted-foreground" },
  };

  const vs = statusLabel[validationStatus || "unvalidated"] || statusLabel.unvalidated;

  return (
    <Card className={className}>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-4">
          <div className={cn("w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold", bg, color)}>
            {qualityScore}
          </div>
          <div>
            <p className={cn("text-sm font-semibold", color)}>{label}</p>
            <p className={cn("text-xs", vs.color)}>{vs.text}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
