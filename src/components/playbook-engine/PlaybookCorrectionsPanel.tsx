import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Send, Loader2, History } from "lucide-react";

interface Props {
  supplierId?: string;
  draftId?: string;
  overrides: any[];
  onApplyInstruction: (instruction: string) => void;
  onApplyCorrection: (correction: { type: string; key: string; value: any }) => void;
  isApplying: boolean;
}

export function PlaybookCorrectionsPanel({ supplierId, draftId, overrides, onApplyInstruction, onApplyCorrection, isApplying }: Props) {
  const [instruction, setInstruction] = useState("");

  const handleSubmit = () => {
    if (!instruction.trim()) return;
    onApplyInstruction(instruction.trim());
    setInstruction("");
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          Correções e Instruções
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Instruction input */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Escreva uma instrução curta para corrigir o mapeamento:
          </p>
          <div className="flex gap-2">
            <Textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              placeholder='Ex: "a coluna C é o SKU", "as variações são pelo comprimento", "ignorar a secção promocional"'
              className="text-sm min-h-[60px]"
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
              }}
            />
            <Button size="sm" className="self-end" onClick={handleSubmit} disabled={isApplying || !instruction.trim()}>
              {isApplying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {["a coluna X é o SKU", "ignorar coluna Y", "variações são pelo comprimento"].map(hint => (
              <Badge
                key={hint}
                variant="outline"
                className="text-[10px] cursor-pointer hover:bg-accent"
                onClick={() => setInstruction(hint)}
              >
                {hint}
              </Badge>
            ))}
          </div>
        </div>

        {/* Override history */}
        {overrides.length > 0 && (
          <div>
            <p className="text-xs font-medium flex items-center gap-1 mb-2">
              <History className="w-3 h-3" /> Correções guardadas ({overrides.length})
            </p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {overrides.slice(0, 20).map((o: any) => (
                <div key={o.id} className="flex items-center gap-2 text-xs bg-muted/50 rounded px-2 py-1">
                  <Badge variant="outline" className="text-[9px]">{o.override_type}</Badge>
                  <span className="font-mono">{o.override_key}</span>
                  {o.instruction && <span className="text-muted-foreground truncate">"{o.instruction}"</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
