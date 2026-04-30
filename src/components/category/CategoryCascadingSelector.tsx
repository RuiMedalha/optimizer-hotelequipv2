import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
}

interface Props {
  onSelect: (category: { id: string; name: string }) => void;
  suggestedIds?: string[];
}

export function CategoryCascadingSelector({ onSelect, suggestedIds = [] }: Props) {
  const [level1, setLevel1] = useState<string | null>(null);
  const [level2, setLevel2] = useState<string | null>(null);
  const [level3, setLevel3] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: categories, isLoading } = useQuery({
    queryKey: ["all-categories-tree"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, parent_id")
        .order("name");
      if (error) throw error;
      return data as Category[];
    }
  });

  const getFullPath = (catId: string, list: Category[]): string => {
    const cat = list.find(c => c.id === catId);
    if (!cat) return "";
    if (cat.parent_id) {
      const parentPath = getFullPath(cat.parent_id, list);
      return parentPath ? `${parentPath} > ${cat.name}` : cat.name;
    }
    return cat.name;
  };

  const searchResults = useMemo(() => {
    if (!search || !categories) return [];
    const query = search.toLowerCase();
    return categories
      .filter(c => c.name.toLowerCase().includes(query))
      .map(c => ({
        id: c.id,
        name: c.name,
        fullPath: getFullPath(c.id, categories)
      }))
      .sort((a, b) => a.fullPath.localeCompare(b.fullPath))
      .slice(0, 10);
  }, [search, categories]);

  const roots = useMemo(() => 
    categories?.filter(c => !c.parent_id) || [], 
    [categories]
  );

  if (isLoading) return <div className="flex items-center justify-center p-4"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Carregando categorias...</div>;

  return (
    <div className="space-y-4 p-2">
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase text-muted-foreground px-1">Pesquisar ou Navegar</label>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Pesquisar categoria (ex: Perfumes)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>

        {search && searchResults.length > 0 && (
          <div className="bg-muted/30 border rounded-md p-1 mt-1 space-y-1">
            {searchResults.map(res => (
              <button
                key={res.id}
                onClick={() => onSelect({ id: res.id, name: res.fullPath })}
                className="w-full text-left p-2 hover:bg-primary/10 rounded text-[11px] flex flex-col gap-0.5 transition-colors"
              >
                <span className="font-semibold">{res.name}</span>
                <span className="text-muted-foreground truncate">{res.fullPath}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!search && (
        <div className="grid grid-cols-1 gap-3 pt-2">
          {/* Level 1 */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase text-muted-foreground px-1">Nível 1</label>
            <Select value={level1 || ""} onValueChange={(v) => { setLevel1(v); setLevel2(null); setLevel3(null); }}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Selecione categoria" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {roots.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    <div className="flex items-center gap-2">
                      {c.name}
                      {suggestedIds.includes(c.id) && <Badge variant="secondary" className="text-[8px] h-4">Sugestão</Badge>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Level 2 */}
          {level1 && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase text-muted-foreground px-1">Nível 2</label>
              <Select value={level2 || ""} onValueChange={(v) => { setLevel2(v); setLevel3(null); }}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecione sub-categoria" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {level2Options.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        {c.name}
                        {suggestedIds.includes(c.id) && <Badge variant="secondary" className="text-[8px] h-4">Sugestão</Badge>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Level 3 */}
          {level2 && level3Options.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase text-muted-foreground px-1">Nível 3</label>
              <Select value={level3 || ""} onValueChange={(v) => setLevel3(v)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecione detalhe" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {level3Options.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        {c.name}
                        {suggestedIds.includes(c.id) && <Badge variant="secondary" className="text-[8px] h-4">Sugestão</Badge>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="pt-2 border-t mt-2">
            <Button 
              className="w-full" 
              disabled={!level1}
              onClick={() => {
                const finalId = level3 || level2 || level1;
                if (finalId && categories) {
                  onSelect({ id: finalId, name: getFullPath(finalId, categories) });
                }
              }}
            >
              Confirmar Navegação
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
