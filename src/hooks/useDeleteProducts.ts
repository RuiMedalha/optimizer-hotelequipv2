import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useDeleteProducts() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const batchSize = 100; // Reduzido de 500 para evitar timeout
      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        console.log(`Eliminando lote de ${batch.length} produtos... (${i}/${ids.length})`);
        const { error } = await supabase
          .from("products")
          .delete()
          .in("id", batch);
        if (error) throw error;
        // Pequena pausa para o banco respirar se for uma exclusão muito grande
        if (ids.length > 500) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    },
    onSuccess: (_, ids) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });
      qc.invalidateQueries({ queryKey: ["recent-activity"] });
      toast.success(`${ids.length} produto(s) eliminado(s) com sucesso.`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
