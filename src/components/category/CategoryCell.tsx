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
}

export function CategoryCell({ product }: Props) {
  const [open, setOpen] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const { suggestions, isLoading, confirmCategory, isConfirming } = useCategoryLearning(product);

  const handleSelect = (categoryId: string, categoryName: string, source: string) => {
    const isCorrection = suggestions && suggestions[0]?.category_id !== categoryId;
    confirmCategory({ categoryId, categoryName, isCorrection });
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
            <div className="flex items-center gap-1 min-w-0">
              <span className={cn(
                "text-xs truncate max-w-[160px] block transition-colors",
                product.category ? "text-foreground font-medium" : "text-muted-foreground italic"
              )}>
                {product.category || "Sem categoria"}
              </span>
              <ChevronDown className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>

            {/* Suggestions indicators below the main category */}
            {!product.category && primarySuggestion && (
              <div 
                className="mt-1 flex items-center gap-1.5 text-[10px] text-primary font-bold bg-primary/5 border border-primary/20 px-1.5 py-0.5 rounded cursor-pointer hover:bg-primary/10 transition-all shadow-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(primarySuggestion.category_id, primarySuggestion.category_name, primarySuggestion.source);
                }}
              >
                <Sparkles className="w-2.5 h-2.5" />
                <span className="truncate max-w-[120px]">{primarySuggestion.category_name}</span>
                <span className="ml-auto opacity-70">{primarySuggestion.confidence}%</span>
              </div>
            )}

            {product.category && primarySuggestion && primarySuggestion.category_name !== product.category && (
              <div 
                className="mt-1 flex items-center gap-1.5 text-[10px] text-destructive font-bold bg-destructive/5 border border-destructive/20 px-1.5 py-0.5 rounded cursor-pointer hover:bg-destructive/10 transition-all"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(primarySuggestion.category_id, primarySuggestion.category_name, primarySuggestion.source);
                }}
              >
                <MousePointer2 className="w-2.5 h-2.5 rotate-45" />
                <span className="truncate max-w-[120px] italic">Melhorar para: {primarySuggestion.category_name}</span>
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
                    <span className="text-xs font-semibold truncate pr-8">{s.category_name}</span>
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
                />
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
