import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Brain, CheckCircle, DollarSign, Gauge, Zap } from "lucide-react";

interface Alternative {
  engine: string;
  label: string;
  pros: string;
  cost: string;
}

interface Props {
  recommendation: {
    recommended: string;
    confidence: number;
    estimated_accuracy: number;
    estimated_cost_usd: number;
    alternatives: Alternative[];
  } | null;
  selectedEngine: string;
  onEngineChange: (engine: string) => void;
  onAccept: () => void;
  isProcessing?: boolean;
}

const engineLabels: Record<string, string> = {
  lovable_gateway: "Lovable AI Gateway",
  gemini_vision: "Google Gemini Vision",
  openai_vision: "OpenAI Vision",
  ocr_rules: "OCR + Regras",
};

export function EngineRecommendationCard({ recommendation, selectedEngine, onEngineChange, onAccept, isProcessing }: Props) {
  if (!recommendation) return null;

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="h-4 w-4" /> Motor de Extração Recomendado
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Recommendation summary */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
          <CheckCircle className="h-5 w-5 text-primary shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">{engineLabels[recommendation.recommended] || recommendation.recommended}</p>
            <div className="flex gap-3 mt-1">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Gauge className="h-3 w-3" /> Confiança: {recommendation.confidence}%
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Zap className="h-3 w-3" /> Precisão: {recommendation.estimated_accuracy}%
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <DollarSign className="h-3 w-3" /> ~${recommendation.estimated_cost_usd.toFixed(3)}
              </span>
            </div>
          </div>
        </div>

        {/* Engine selection */}
        <RadioGroup value={selectedEngine} onValueChange={onEngineChange}>
          {(recommendation.alternatives || []).map((alt) => (
            <div key={alt.engine} className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted/50">
              <RadioGroupItem value={alt.engine} id={alt.engine} />
              <Label htmlFor={alt.engine} className="flex-1 cursor-pointer">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{alt.label}</p>
                    <p className="text-xs text-muted-foreground">{alt.pros}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{alt.cost}</Badge>
                </div>
              </Label>
              {alt.engine === recommendation.recommended && (
                <Badge variant="default" className="text-[10px]">Recomendado</Badge>
              )}
            </div>
          ))}
        </RadioGroup>

        <Button onClick={onAccept} disabled={isProcessing} className="w-full">
          {isProcessing ? "A processar..." : `Extrair com ${engineLabels[selectedEngine] || selectedEngine}`}
        </Button>
      </CardContent>
    </Card>
  );
}
