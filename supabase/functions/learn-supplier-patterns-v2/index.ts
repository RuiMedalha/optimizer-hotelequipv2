import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function detectSkuFamilies(skus: string[]): Record<string, string[]> {
  const families: Record<string, string[]> = {};
  for (const sku of skus) {
    const match = sku.match(/^([A-Za-z]+)/);
    if (match) {
      const prefix = match[1].toUpperCase();
      if (!families[prefix]) families[prefix] = [];
      families[prefix].push(sku);
    }
  }
  // Only keep families with 2+ members
  return Object.fromEntries(Object.entries(families).filter(([_, v]) => v.length >= 2));
}

function detectRecurringAttributes(products: any[]): Record<string, number> {
  const attrCounts: Record<string, number> = {};
  for (const p of products) {
    if (p.attributes && typeof p.attributes === "object") {
      for (const key of Object.keys(p.attributes)) {
        attrCounts[key] = (attrCounts[key] || 0) + 1;
      }
    }
  }
  return attrCounts;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { supplier_id, workspace_id } = await req.json();

    if (!supplier_id || !workspace_id) {
      return new Response(JSON.stringify({ error: "supplier_id and workspace_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch products for this supplier
    const { data: products } = await supabase
      .from("products")
      .select("sku, original_title, attributes")
      .eq("workspace_id", workspace_id)
      .eq("supplier_ref", supplier_id)
      .limit(500);

    const patterns = [];
    const now = new Date().toISOString();

    // 1. SKU Family patterns
    const skus = (products || []).map((p: any) => p.sku).filter(Boolean);
    const families = detectSkuFamilies(skus);
    for (const [prefix, members] of Object.entries(families)) {
      patterns.push({
        supplier_id,
        pattern_type: "sku_prefix",
        pattern_key: prefix,
        pattern_value: { prefix, member_count: members.length, samples: members.slice(0, 5) },
        occurrences: members.length,
        confidence: Math.min(0.5 + members.length * 0.05, 0.95),
        last_seen_at: now,
      });
    }

    // 2. Recurring attributes
    const attrCounts = detectRecurringAttributes(products || []);
    for (const [attr, count] of Object.entries(attrCounts)) {
      if (count >= 3) {
        patterns.push({
          supplier_id,
          pattern_type: "recurring_attribute",
          pattern_key: attr,
          pattern_value: { attribute_name: attr, occurrences: count },
          occurrences: count,
          confidence: Math.min(0.4 + count * 0.03, 0.9),
          last_seen_at: now,
        });
      }
    }

    // 3. Name structure patterns
    const titles = (products || []).map((p: any) => p.original_title).filter(Boolean);
    const avgWords = titles.length ? titles.reduce((s: number, t: string) => s + t.split(/\s+/).length, 0) / titles.length : 0;
    if (titles.length >= 5) {
      patterns.push({
        supplier_id,
        pattern_type: "name_structure",
        pattern_key: "avg_word_count",
        pattern_value: { avg_words: Math.round(avgWords), total_titles: titles.length },
        occurrences: titles.length,
        confidence: 0.7,
        last_seen_at: now,
      });
    }

    // Upsert patterns
    if (patterns.length) {
      for (const p of patterns) {
        const { data: existing } = await supabase
          .from("supplier_patterns")
          .select("id, occurrences")
          .eq("supplier_id", supplier_id)
          .eq("pattern_type", p.pattern_type)
          .eq("pattern_key", p.pattern_key)
          .maybeSingle();

        if (existing) {
          await supabase.from("supplier_patterns").update({
            occurrences: existing.occurrences + p.occurrences,
            confidence: p.confidence,
            pattern_value: p.pattern_value,
            last_seen_at: now,
          }).eq("id", existing.id);
        } else {
          await supabase.from("supplier_patterns").insert(p);
        }
      }
    }

    return new Response(JSON.stringify({ patterns_detected: patterns.length, families: Object.keys(families) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
