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
  workspace_id?: string | null;
}

interface Props {
  onSelect: (category: { id: string; name: string }) => void;
  suggestedIds?: string[];
  workspaceId?: string | null;
}

export function CategoryCascadingSelector({ onSelect, suggestedIds = [], workspaceId }: Props) {
  const [level1, setLevel1] = useState<string | null>(null);
  const [level2, setLevel2] = useState<string | null>(null);
  const [level3, setLevel3] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: roots, isLoading: loadingRoots } = useQuery({
    queryKey: ["category-roots", workspaceId],
    queryFn: async () => {
      let query = supabase
        .from("categories")
        .select("id, name, parent_id, workspace_id")
        .is("parent_id", null)
        .order("name");
      
      if (workspaceId) {
        query = query.or(`workspace_id.eq.${workspaceId},workspace_id.is.null`);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      // Filter out duplicates in names for display, preferring workspace-specific ones
      const uniqueNames = new Map();
      data?.forEach(cat => {
        if (!uniqueNames.has(cat.name) || (workspaceId && cat.workspace_id === workspaceId)) {
          uniqueNames.set(cat.name, cat);
        }
      });
      return Array.from(uniqueNames.values()) as Category[];
    }
  });

  const { data: level2Options, isLoading: loadingL2 } = useQuery({
    queryKey: ["category-sub", level1, workspaceId],
    enabled: !!level1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, parent_id, workspace_id")
        .eq("parent_id", level1)
        .order("name");
      if (error) throw error;
      return data as Category[];
    }
  });

  const { data: level3Options, isLoading: loadingL3 } = useQuery({
    queryKey: ["category-sub", level2, workspaceId],
    enabled: !!level2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, parent_id, workspace_id")
        .eq("parent_id", level2)
        .order("name");
      if (error) throw error;
      return data as Category[];
    }
  });

  const { data: searchResults, isLoading: loadingSearch } = useQuery({
    queryKey: ["category-search", search, workspaceId],
    enabled: search.length > 1,
    queryFn: async () => {
      // Use join to get parent name for context
      const { data, error } = await supabase
        .from("categories")
        .select(`
          id, 
          name, 
          parent_id, 
          workspace_id,
          parent:parent_id (
            name
          )
        `)
        .ilike("name", `%${search}%`)
        .limit(20);
      if (error) throw error;
      
      return data.map((cat: any) => ({
        ...cat,
        parentName: cat.parent?.name
      })) as (Category & { parentName?: string })[];
    }
  });

  const isLoading = loadingRoots || loadingL2 || loadingL3;

  const getLabel = (catId: string | null): string => {
    if (!catId) return "";
    const allOptions = [...(roots || []), ...(level2Options || []), ...(level3Options || []), ...(searchResults || [])];
    const cat = allOptions.find(c => c.id === catId);
    return cat ? cat.name : "";
  };

  if (loadingRoots && !roots) return <div className="flex items-center justify-center p-4"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Carregando categorias...</div>;

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

        {search && searchResults && searchResults.length > 0 && (
          <div className="bg-muted/30 border rounded-md p-1 mt-1 space-y-1">
            {searchResults.map(res => (
              <button
                key={res.id}
                onClick={() => onSelect({ id: res.id, name: res.parentName ? `${res.parentName} > ${res.name}` : res.name })}
                className="w-full text-left p-2 hover:bg-primary/10 rounded text-[11px] flex flex-col gap-0.5 transition-colors"
              >
                <span className="font-semibold">{res.name}</span>
                {res.parentName && <span className="text-[10px] text-muted-foreground italic truncate">em {res.parentName}</span>}
              </button>
            ))}
          </div>
        )}
        {search && searchResults && searchResults.length === 0 && !loadingSearch && (
          <div className="p-2 text-center text-[10px] text-muted-foreground italic">Nenhum resultado encontrado</div>
        )}
        {loadingSearch && (
          <div className="p-2 text-center text-[10px] text-muted-foreground italic flex items-center justify-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Pesquisando...
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
                {roots?.map(c => (
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
                <SelectTrigger className="h-9 text-left">
                  <SelectValue placeholder={loadingL2 ? "Carregando..." : "Selecione sub-categoria"} />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {level2Options?.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        {c.name}
                        {suggestedIds.includes(c.id) && <Badge variant="secondary" className="text-[8px] h-4">Sugestão</Badge>}
                      </div>
                    </SelectItem>
                  ))}
                  {!loadingL2 && (!level2Options || level2Options.length === 0) && (
                    <div className="p-2 text-center text-xs text-muted-foreground italic">Nenhuma sub-categoria</div>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Level 3 */}
          {level2 && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase text-muted-foreground px-1">Nível 3</label>
              <Select value={level3 || ""} onValueChange={(v) => setLevel3(v)}>
                <SelectTrigger className="h-9 text-left">
                  <SelectValue placeholder={loadingL3 ? "Carregando..." : "Selecione detalhe"} />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {level3Options?.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        {c.name}
                        {suggestedIds.includes(c.id) && <Badge variant="secondary" className="text-[8px] h-4">Sugestão</Badge>}
                      </div>
                    </SelectItem>
                  ))}
                  {!loadingL3 && (!level3Options || level3Options.length === 0) && (
                    <div className="p-2 text-center text-xs text-muted-foreground italic">Nenhum detalhe disponível</div>
                  )}
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
                if (finalId) {
                  onSelect({ id: finalId, name: getLabel(finalId) });
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
