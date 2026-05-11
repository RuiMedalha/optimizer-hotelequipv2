import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ChevronDown, Sparkles, Check, Info, MousePointer2 } from "lucide-react";
import { useCategoryLearning } from "@/hooks/useCategoryLearning";
import { CategoryCascadingSelector } from "./CategoryCascadingSelector";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  product: any;
  onSelectSuggestion?: (categoryName: string, confidence?: number) => void;
  currentOverride?: string | null;
  currentOverrideConfidence?: number;
}

export function CategoryCell({ product, onSelectSuggestion, currentOverride, currentOverrideConfidence }: Props) {
  const [open, setOpen] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const { suggestions, isLoading, confirmCategory, isConfirming } = useCategoryLearning(product);

  const handleSelect = (categoryId: string, categoryName: string, source: string, confidence?: number) => {
    const isCorrection = suggestions && suggestions[0]?.category_id !== categoryId;
    if (onSelectSuggestion) {
      onSelectSuggestion(categoryName, confidence);
    } else {
      confirmCategory({ categoryId, categoryName, isCorrection });
    }
    setOpen(false);
    setShowManual(false);
  };

  const primarySuggestion = suggestions?.[0];
  const secondarySuggestion = suggestions?.[1];

  return (
    <div className="flex flex-col gap-1 w-full" onClick={(e) => e.stopPropagation()}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="group cursor-pointer">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1 min-w-0">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={cn(
                        "text-xs block transition-colors cursor-help break-words max-w-full",
                        product.category ? "text-foreground font-medium" : "text-muted-foreground italic"
                      )}>
                        {product.category || "Sem categoria"}
                      </span>
                    </TooltipTrigger>
                    {product.category && (
                      <TooltipContent side="top" className="max-w-md break-words">
                        <p className="text-xs">
                          {product.category.split(' > ').map((part: string, i: number, arr: string[]) => (
                            <span key={i}>
                              <span className="font-medium">{part}</span>
                              {i < arr.length - 1 && <span className="text-muted-foreground mx-1">→</span>}
                            </span>
                          ))}
                        </p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
                <ChevronDown className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              {currentOverride && (
                <div className="flex items-start gap-1.5 p-1.5 bg-success/10 border border-success/30 rounded-md shadow-sm">
                  <Check className="w-3.5 h-3.5 text-success mt-0.5 shrink-0" />
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between w-full">
                      <span className="text-[10px] font-bold text-success uppercase tracking-wider">Vai aprovar:</span>
                      {currentOverrideConfidence && (
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-success/30 text-success bg-success/5 font-bold">
                          {currentOverrideConfidence}% Confiança
                        </Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-success font-semibold leading-tight break-words">
                      {currentOverride}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Suggestions indicators below the main category */}
            {!currentOverride && (
              <div className="mt-1.5 flex flex-col gap-1.5">
                {!product.category && primarySuggestion && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div 
                          className={cn(
                            "flex items-start gap-1.5 text-[10px] text-primary font-bold bg-primary/5 border border-primary/20 p-1.5 rounded transition-all shadow-sm hover:bg-primary/10",
                            onSelectSuggestion ? "cursor-pointer" : "cursor-help"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onSelectSuggestion) {
                              onSelectSuggestion(primarySuggestion.category_name, primarySuggestion.confidence);
                            } else {
                              handleSelect(primarySuggestion.category_id, primarySuggestion.category_name, primarySuggestion.source, primarySuggestion.confidence);
                            }
                          }}
                        >
                          <Sparkles className="w-3 h-3 mt-0.5 shrink-0" />
                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <span className="leading-tight break-words">{primarySuggestion.category_name}</span>
                            <span className="text-[9px] opacity-70" title="Pontuação de confiança">⭐ {primarySuggestion.confidence}% confiança</span>
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-md break-words">
                        <p className="text-xs">
                          {primarySuggestion.category_name.split(' > ').map((part: string, i: number, arr: string[]) => (
                            <span key={i}>
                              <span className="font-medium">{part}</span>
                              {i < arr.length - 1 && <span className="text-muted-foreground mx-1">→</span>}
                            </span>
                          ))}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                {secondarySuggestion && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div 
                          className={cn(
                            "flex items-start gap-1.5 text-[10px] text-orange-600 font-bold bg-orange-50 border border-orange-200 p-1.5 rounded transition-all shadow-sm hover:bg-orange-100",
                            onSelectSuggestion ? "cursor-pointer" : "cursor-help"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onSelectSuggestion) {
                              onSelectSuggestion(secondarySuggestion.category_name, secondarySuggestion.confidence);
                            } else {
                              handleSelect(secondarySuggestion.category_id, secondarySuggestion.category_name, secondarySuggestion.source, secondarySuggestion.confidence);
                            }
                          }}
                        >
                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <span className="leading-tight break-words">{secondarySuggestion.category_name}</span>
                            <span className="text-[9px] opacity-70" title="Pontuação de confiança">⭐ {secondarySuggestion.confidence}% confiança</span>
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-md break-words">
                        <p className="text-xs">
                          {secondarySuggestion.category_name.split(' > ').map((part: string, i: number, arr: string[]) => (
                            <span key={i}>
                              <span className="font-medium">{part}</span>
                              {i < arr.length - 1 && <span className="text-muted-foreground mx-1">→</span>}
                            </span>
                          ))}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                {product.category && primarySuggestion && primarySuggestion.category_name !== product.category && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div 
                          className="flex items-start gap-1.5 text-[10px] text-destructive font-bold bg-destructive/5 border border-destructive/20 p-1.5 rounded cursor-help hover:bg-destructive/10 transition-all"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelect(primarySuggestion.category_id, primarySuggestion.category_name, primarySuggestion.source);
                          }}
                        >
                          <MousePointer2 className="w-3 h-3 mt-0.5 shrink-0 rotate-45" />
                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <span className="italic leading-tight break-words text-muted-foreground">Corrigir para:</span>
                            <span className="leading-tight break-words">{primarySuggestion.category_name}</span>
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-md break-words">
                        <p className="text-xs">
                          <span className="text-muted-foreground mr-1 italic">Corrigir para:</span>
                          {primarySuggestion.category_name.split(' > ').map((part: string, i: number, arr: string[]) => (
                            <span key={i}>
                              <span className="font-medium">{part}</span>
                              {i < arr.length - 1 && <span className="text-muted-foreground mx-1">→</span>}
                            </span>
                          ))}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            )}
          </div>
        </PopoverTrigger>

        <PopoverContent className="w-[300px] p-0" align="start">
          <div className="p-3 border-b bg-muted/30">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Sparkles className="w-3 h-3 text-primary" />
              Sugestões IA & Aprendizagem
            </h4>
          </div>
          
          <div className="p-2 space-y-1">
            {isLoading ? (
              <div className="p-4 text-center text-xs text-muted-foreground">A calcular sugestões...</div>
            ) : suggestions?.length ? (
              suggestions.map((s, i) => (
                <button
                  key={s.category_id}
                  className={cn(
                    "w-full text-left p-2 rounded-md hover:bg-muted transition-colors flex flex-col gap-0.5 relative group",
                    s.category_name === product.category && "bg-primary/5 ring-1 ring-primary/20"
                  )}
                  onClick={() => handleSelect(s.category_id, s.category_name, s.source)}
                  disabled={isConfirming}
                >
                  <div className="flex items-center justify-between gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-xs font-semibold truncate pr-8 cursor-help">{s.category_name}</span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-md break-words">
                          <p className="text-xs">
                            {s.category_name.split(' > ').map((part: string, i: number, arr: string[]) => (
                              <span key={i}>
                                <span className="font-medium">{part}</span>
                                {i < arr.length - 1 && <span className="text-muted-foreground mx-1">→</span>}
                              </span>
                            ))}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <Badge 
                      variant={s.confidence > 80 ? "default" : "secondary"} 
                      className="text-[9px] h-4 px-1 shrink-0"
                    >
                      {s.confidence}%
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                    {s.source === 'prefix' ? 'Baseado em prefixo SKU' : 'Análise IA'}
                    {s.reason && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="w-2.5 h-2.5" />
                          </TooltipTrigger>
                          <TooltipContent className="text-[10px] max-w-[200px]">
                            {s.reason}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  {s.category_name === product.category && (
                    <Check className="w-3 h-3 text-primary absolute right-2 bottom-2" />
                  )}
                </button>
              ))
            ) : (
              <div className="p-4 text-center text-xs text-muted-foreground italic">Nenhuma sugestão encontrada</div>
            )}
          </div>

          <div className="p-2 border-t">
            {!showManual ? (
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full justify-start text-xs font-medium"
                onClick={() => setShowManual(true)}
              >
                Escolher manualmente...
              </Button>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                <CategoryCascadingSelector 
                  onSelect={(cat) => handleSelect(cat.id, cat.name, 'manual')}
                  suggestedIds={suggestions?.map(s => s.category_id) || []}
                  workspaceId={product.workspace_id}
                />
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
