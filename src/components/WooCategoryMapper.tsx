import { useState, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowRight, Link2, Unlink, ChevronDown, ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { WooCategory } from "@/hooks/useWooImport";
import type { Category, CategoryTree } from "@/hooks/useCategories";

export interface CategoryMapping {
  [wooCategoryId: string]: string; // woo cat id → internal cat id
}

interface Props {
  wooCategories: WooCategory[];
  internalCategories: Category[];
  internalTree: CategoryTree[];
  mapping: CategoryMapping;
  onChange: (mapping: CategoryMapping) => void;
}

function flattenTree(tree: CategoryTree[]): { id: string; name: string; depth: number }[] {
  const result: { id: string; name: string; depth: number }[] = [];
  function walk(nodes: CategoryTree[]) {
    for (const n of nodes) {
      result.push({ id: n.id, name: n.name, depth: n.depth });
      walk(n.children);
    }
  }
  walk(tree);
  return result;
}

/** Build a WooCommerce category tree from flat list */
function buildWooTree(cats: WooCategory[]): (WooCategory & { depth: number; children: any[] })[] {
  const map = new Map<number, WooCategory & { depth: number; children: any[] }>();
  for (const c of cats) map.set(c.id, { ...c, depth: 0, children: [] });

  const roots: any[] = [];
  for (const c of cats) {
    const node = map.get(c.id)!;
    if (c.parent && map.has(c.parent)) {
      map.get(c.parent)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function setDepth(nodes: any[], d: number) {
    for (const n of nodes) {
      n.depth = d;
      setDepth(n.children, d + 1);
    }
  }
  setDepth(roots, 0);

  // Flatten
  const result: any[] = [];
  function walk(nodes: any[]) {
    for (const n of [...nodes].sort((a: any, b: any) => a.name.localeCompare(b.name))) {
      result.push(n);
      walk(n.children);
    }
  }
  walk(roots);
  return result;
}

export function WooCategoryMapper({ wooCategories, internalCategories, internalTree, mapping, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const wooTree = useMemo(() => buildWooTree(wooCategories), [wooCategories]);
  const flatInternal = useMemo(() => flattenTree(internalTree), [internalTree]);

  // Auto-match by woocommerce_id
  const autoMatched = useMemo(() => {
    const matched: CategoryMapping = {};
    for (const ic of internalCategories) {
      if (ic.woocommerce_id) {
        matched[String(ic.woocommerce_id)] = ic.id;
      }
    }
    return matched;
  }, [internalCategories]);

  const effectiveMapping = { ...autoMatched, ...mapping };
  const mappedCount = Object.keys(effectiveMapping).length;
  const totalWoo = wooCategories.length;

  const setMapping = (wooId: string, internalId: string | null) => {
    const next = { ...mapping };
    if (!internalId || internalId === "none") {
      delete next[wooId];
    } else {
      next[wooId] = internalId;
    }
    onChange(next);
  };

  if (wooCategories.length === 0 || internalCategories.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-between text-xs font-medium">
          <span className="flex items-center gap-2">
            <Link2 className="w-3.5 h-3.5" />
            Mapeamento de Categorias
            {mappedCount > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {mappedCount}/{totalWoo}
              </Badge>
            )}
          </span>
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ScrollArea className="max-h-[300px] mt-2">
          <div className="space-y-1.5 pr-2">
            {wooTree.map((wc) => {
              const currentVal = effectiveMapping[String(wc.id)] || "";
              const isAutoMatched = autoMatched[String(wc.id)] && !mapping[String(wc.id)];

              return (
                <div key={wc.id} className="flex items-center gap-2 text-xs">
                  <span
                    className="min-w-0 flex-1 truncate text-muted-foreground"
                    title={wc.name}
                    style={{ paddingLeft: `${wc.depth * 12}px` }}
                  >
                    {wc.name}
                    <span className="text-muted-foreground/50 ml-1">({wc.count})</span>
                  </span>
                  <ArrowRight className="w-3 h-3 shrink-0 text-muted-foreground/40" />
                  <Select
                    value={currentVal || "none"}
                    onValueChange={(v) => setMapping(String(wc.id), v)}
                  >
                    <SelectTrigger className="h-7 text-xs w-[180px] shrink-0">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Sem mapeamento</SelectItem>
                      {flatInternal.map((ic) => (
                        <SelectItem key={ic.id} value={ic.id}>
                          {"  ".repeat(ic.depth)}{ic.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isAutoMatched && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">auto</Badge>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
        {mappedCount > 0 && (
          <div className="flex justify-end mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-6"
              onClick={() => onChange({})}
            >
              <Unlink className="w-3 h-3 mr-1" />
              Limpar mapeamentos manuais
            </Button>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
