import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface CategorySuggestion {
  category_id: string;
  category_name: string;
  confidence: number;
  reason?: string;
  source: 'ai' | 'prefix' | 'pattern';
}

export function useCategoryLearning(product: any) {
  const qc = useQueryClient();

  // Extract SKU prefix (first few non-numeric characters or as defined by the user)
  const skuPrefix = product?.sku ? (product.sku.match(/^[A-Z]+/)?.[0] || product.sku.substring(0, 3)) : null;

  const { data: suggestions, isLoading } = useQuery({
    queryKey: ["category-suggestions", product?.id, skuPrefix],
    enabled: !!product?.id,
    queryFn: async () => {
      // 1. Check for SKU prefix matches in category_learning
      let prefixMatch = null;
      if (skuPrefix) {
        const { data } = await supabase
          .from("category_learning")
          .select("*")
          .eq("sku_prefix", skuPrefix)
          .order("times_confirmed", { ascending: false })
          .limit(1);
        
        if (data && data.length > 0) {
          prefixMatch = {
            category_id: data[0].category_id,
            category_name: data[0].category_path,
            confidence: Math.min(95, 50 + (data[0].times_confirmed * 5) - (data[0].times_corrected * 10)),
            source: 'prefix' as const,
            reason: `Padrão detetado para prefixo ${skuPrefix}`
          };
        }
      }

      // 2. Fallback or additional from product.suggested_categories (already from AI)
      const aiSuggestions = (product.suggested_categories || []).map((s: any) => ({
        category_id: s.category_id,
        category_name: s.category_name,
        confidence: Math.round(s.confidence_score * 100),
        source: 'ai' as const,
        reason: s.reasoning
      }));

      // Combine and deduplicate
      const combined = prefixMatch ? [prefixMatch, ...aiSuggestions] : aiSuggestions;
      const seen = new Set();
      return combined.filter((s: any) => {
        if (!s.category_id || seen.has(s.category_id)) return false;
        seen.add(s.category_id);
        return true;
      }).sort((a: any, b: any) => b.confidence - a.confidence).slice(0, 3);
    }
  });

  const confirmCategory = useMutation({
    mutationFn: async ({ categoryId, categoryName, isCorrection }: { categoryId: string, categoryName: string, isCorrection?: boolean }) => {
      // 1. Update Product
      const { error: productError } = await supabase
        .from("products")
        .update({
          category_id: categoryId,
          category: categoryName,
          suggested_category: null,
          suggested_categories: null
        })
        .eq("id", product.id);

      if (productError) throw productError;

      // 2. Update Learning Data
      if (skuPrefix) {
        // Find existing entry for this prefix and category
        const { data: existing } = await supabase
          .from("category_learning")
          .select("id, times_confirmed, times_corrected")
          .eq("sku_prefix", skuPrefix)
          .eq("category_id", categoryId)
          .limit(1);

        if (existing && existing.length > 0) {
          await supabase
            .from("category_learning")
            .update({
              times_confirmed: existing[0].times_confirmed + 1
            })
            .eq("id", existing[0].id);
        } else {
          await supabase
            .from("category_learning")
            .insert({
              sku_prefix: skuPrefix,
              category_id: categoryId,
              category_path: categoryName,
              brand: product.brand,
              times_confirmed: 1,
              confidence: 60
            });
        }

        // If it was a correction, increment corrected count for the AI suggestion's pattern
        if (isCorrection && product.suggested_categories?.[0]?.category_id) {
          const aiCatId = product.suggested_categories[0].category_id;
          const { data: aiPattern } = await supabase
            .from("category_learning")
            .select("id, times_corrected")
            .eq("sku_prefix", skuPrefix)
            .eq("category_id", aiCatId)
            .limit(1);

          if (aiPattern && aiPattern.length > 0) {
            await supabase
              .from("category_learning")
              .update({
                times_corrected: aiPattern[0].times_corrected + 1
              })
              .eq("id", aiPattern[0].id);
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["category-suggestions"] });
      toast.success("Categoria confirmada e sistema atualizado!");
    },
    onError: (err: Error) => {
      toast.error(`Erro ao confirmar categoria: ${err.message}`);
    }
  });

  return {
    suggestions,
    isLoading,
    confirmCategory: confirmCategory.mutate,
    isConfirming: confirmCategory.isPending
  };
}
