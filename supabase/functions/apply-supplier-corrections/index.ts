import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspace_id, supplier_id, corrections, instruction, draft_id } = await req.json();
    if (!workspace_id) throw new Error("workspace_id required");

    const results: any[] = [];

    // Process natural language instruction
    if (instruction) {
      const parsed = parseInstruction(instruction);
      for (const p of parsed) {
        const { data } = await supabase.from("supplier_overrides").insert({
          workspace_id,
          supplier_id: supplier_id || null,
          override_type: p.type,
          override_key: p.key,
          override_value: p.value,
          instruction,
          source: "instruction",
        }).select().single();
        if (data) results.push(data);
      }
    }

    // Process direct corrections (mapping overrides)
    if (corrections && Array.isArray(corrections)) {
      for (const c of corrections) {
        const { data } = await supabase.from("supplier_overrides").insert({
          workspace_id,
          supplier_id: supplier_id || null,
          override_type: c.type || "column_mapping",
          override_key: c.key,
          override_value: c.value || {},
          instruction: c.instruction || null,
          source: "manual",
        }).select().single();
        if (data) results.push(data);
      }
    }

    // Update draft if provided
    if (draft_id && corrections) {
      const { data: draft } = await supabase
        .from("supplier_playbook_drafts")
        .select("column_mapping")
        .eq("id", draft_id)
        .single();

      if (draft) {
        const updatedMapping = { ...(draft.column_mapping as any) };
        for (const c of corrections) {
          if (c.type === "column_mapping") {
            updatedMapping[c.key] = c.value?.field || c.value;
          }
        }
        await supabase
          .from("supplier_playbook_drafts")
          .update({ column_mapping: updatedMapping, updated_at: new Date().toISOString() })
          .eq("id", draft_id);
      }
    }

    // Record learning event
    if (supplier_id && results.length > 0) {
      await supabase.from("supplier_learning_events").insert({
        supplier_id,
        event_type: "correction",
        event_payload: { corrections_count: results.length, instruction: instruction || null },
        learning_status: "approved",
      });
    }

    return new Response(JSON.stringify({
      success: true,
      overrides_created: results.length,
      overrides: results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function parseInstruction(instruction: string): Array<{ type: string; key: string; value: any }> {
  const results: Array<{ type: string; key: string; value: any }> = [];
  const lower = instruction.toLowerCase();

  // "a coluna X é o SKU"
  const colMatch = lower.match(/coluna\s+([a-z0-9_"]+)\s+(?:é|e)\s+(?:o\s+)?(\w+)/i);
  if (colMatch) {
    results.push({
      type: "column_mapping",
      key: colMatch[1].replace(/"/g, ""),
      value: { field: mapFieldAlias(colMatch[2]) },
    });
  }

  // "ignorar coluna X" or "ignorar secção X"
  const ignoreMatch = lower.match(/ignorar\s+(?:a\s+)?(?:coluna|secção|seção|section)\s+(.+)/i);
  if (ignoreMatch) {
    results.push({
      type: "ignore_section",
      key: ignoreMatch[1].trim(),
      value: { action: "ignore" },
    });
  }

  // "variações são pelo comprimento/cor/tamanho"
  const varMatch = lower.match(/varia(?:ções|tion|ntes?)\s+(?:são|sao|are)\s+(?:pelo|pela|por|by)\s+(.+)/i);
  if (varMatch) {
    results.push({
      type: "variation_rule",
      key: varMatch[1].trim(),
      value: { variation_axis: varMatch[1].trim() },
    });
  }

  // If nothing matched, store as generic instruction
  if (results.length === 0) {
    results.push({
      type: "generic_instruction",
      key: "instruction",
      value: { text: instruction },
    });
  }

  return results;
}

function mapFieldAlias(alias: string): string {
  const map: Record<string, string> = {
    sku: "sku", referencia: "sku", reference: "sku", ref: "sku",
    nome: "original_title", name: "original_title", titulo: "original_title", title: "original_title",
    descricao: "original_description", description: "original_description",
    preco: "original_price", price: "original_price", preço: "original_price",
    categoria: "category", category: "category",
    imagem: "image_urls", image: "image_urls",
    ean: "ean",
  };
  return map[alias.toLowerCase()] || alias;
}
