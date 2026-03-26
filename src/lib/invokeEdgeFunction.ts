import { supabase } from "@/integrations/supabase/client";

/**
 * Wrapper normalizado para chamadas a Supabase Edge Functions.
 *
 * Normaliza os dois tipos de erro possíveis:
 * - `error`      — falha HTTP / de rede (FunctionsHttpError, FunctionsFetchError)
 * - `data.error` — erro de aplicação devolvido no corpo da resposta JSON
 *
 * Em caso de sucesso, devolve `data` tipado como `T`.
 * Em caso de falha, lança sempre um `Error` com mensagem legível.
 */
export async function invokeEdgeFunction<T = unknown>(
  functionName: string,
  options?: { body?: unknown }
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, options);

  if (error) {
    // FunctionsHttpError expõe `.context` com o corpo da resposta HTTP,
    // que contém a mensagem de erro real devolvida pela edge function.
    // Tentamos extraí-la para produzir uma mensagem legível.
    const ctx = (error as any).context;
    if (ctx) {
      try {
        const body = typeof ctx.json === "function" ? await ctx.json() : ctx;
        const detail = body?.error ?? body?.message ?? body;
        if (detail && typeof detail === "string") {
          const err = new Error(detail);
          (err as any).cause = error;
          throw err;
        }
        if (detail && typeof detail === "object") {
          const err = new Error(JSON.stringify(detail));
          (err as any).cause = error;
          throw err;
        }
      } catch (parseErr) {
        // Se a extracção falhar e for o erro que relançámos, propaga-o.
        // Caso contrário, ignora e lança o erro original abaixo.
        if ((parseErr as any).cause === error) throw parseErr;
      }
    }
    throw error;
  }

  if (data?.error) {
    throw new Error(
      typeof data.error === "string" ? data.error : JSON.stringify(data.error)
    );
  }

  return data as T;
}
