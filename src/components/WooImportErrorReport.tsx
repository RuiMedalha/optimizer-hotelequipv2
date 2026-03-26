import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export interface ImportError {
  sku: string;
  title: string;
  error: string;
  phase: string; // "insert" | "variation"
}

interface Props {
  errors: ImportError[];
}

export function WooImportErrorReport({ errors }: Props) {
  const [open, setOpen] = useState(errors.length <= 10);

  if (errors.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-between text-xs text-destructive">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            {errors.length} produto(s) com erro
          </span>
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ScrollArea className="max-h-[250px] mt-2">
          <div className="space-y-1.5">
            {errors.map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-xs p-2 rounded bg-destructive/5 border border-destructive/10">
                <AlertTriangle className="w-3 h-3 text-destructive shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium truncate">{e.title || e.sku}</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">{e.phase}</Badge>
                  </div>
                  {e.sku && <span className="text-muted-foreground">SKU: {e.sku}</span>}
                  <p className="text-destructive/80 mt-0.5 break-words">{e.error}</p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  );
}
