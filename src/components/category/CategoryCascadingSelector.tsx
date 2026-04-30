import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";

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

  const roots = useMemo(() => 
    categories?.filter(c => !c.parent_id) || [], 
    [categories]
  );

  const level2Options = useMemo(() => 
    level1 ? categories?.filter(c => c.parent_id === level1) || [] : [],
    [level1, categories]
  );

  const level3Options = useMemo(() => 
    level2 ? categories?.filter(c => c.parent_id === level2) || [] : [],
    [level2, categories]
  );

  const filteredRoots = useMemo(() => {
    if (!search) return roots;
    return roots.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));
  }, [roots, search]);

  const getFullPath = (catId: string): string => {
    const cat = categories?.find(c => c.id === catId);
    if (!cat) return "";
    if (cat.parent_id) {
      return `${getFullPath(cat.parent_id)} > ${cat.name}`;
    }
    return cat.name;
  };

  if (isLoading) return <div className="flex items-center justify-center p-4"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Carregando categorias...</div>;

  return (
    <div className="space-y-4 p-2">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Pesquisar categoria principal..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-9"
        />
      </div>

      <div className="grid grid-cols-1 gap-3">
        {/* Level 1 */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase text-muted-foreground">Principal</label>
          <Select value={level1 || ""} onValueChange={(v) => { setLevel1(v); setLevel2(null); setLevel3(null); }}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione nível 1" />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              {filteredRoots.map(c => (
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
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Secundária</label>
            <Select value={level2 || ""} onValueChange={(v) => { setLevel2(v); setLevel3(null); }}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Selecione nível 2" />
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
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Sub-secundária</label>
            <Select value={level3 || ""} onValueChange={(v) => setLevel3(v)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Selecione nível 3" />
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
      </div>

      <div className="pt-2 border-t mt-2">
        <Button 
          className="w-full" 
          disabled={!level1}
          onClick={() => {
            const finalId = level3 || level2 || level1;
            if (finalId) {
              onSelect({ id: finalId, name: getFullPath(finalId) });
            }
          }}
        >
          Confirmar Seleção
        </Button>
      </div>
    </div>
  );
}
