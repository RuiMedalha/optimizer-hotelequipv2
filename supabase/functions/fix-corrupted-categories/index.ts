import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspaceId, categoryIds } = await req.json();

    if (!workspaceId || typeof workspaceId !== "string") {
      return new Response(JSON.stringify({ error: "workspaceId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return new Response(JSON.stringify({ error: "categoryIds array is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load all workspace categories
    const { data: allCats, error: catsErr } = await supabase
      .from("categories")
      .select("id, name, slug, parent_id, woocommerce_id")
      .eq("workspace_id", workspaceId);
    if (catsErr) throw catsErr;

    const catNameMap = new Map((allCats || []).map(c => [c.name.toLowerCase().trim(), c]));

    let fixed = 0;
    let skipped = 0;
    const errors: string[] = [];
    const report: Array<{ original: string; action: string; details: string }> = [];

    for (const catId of categoryIds) {
      const cat = (allCats || []).find(c => c.id === catId);
      if (!cat) { skipped++; continue; }

      try {
        if (cat.name.includes(">")) {
          // Split hierarchy path
          const parts = cat.name.split(">").map((s: string) => s.trim()).filter(Boolean);
          if (parts.length < 2) { skipped++; continue; }

          // Find or create each part in the hierarchy
          let currentParentId: string | null = null;
          let leafCatId: string | null = null;

          for (let i = 0; i < parts.length; i++) {
            const partName = parts[i];
            const existing = catNameMap.get(partName.toLowerCase());

            if (existing && existing.id !== cat.id) {
              currentParentId = existing.id;
              leafCatId = existing.id;
            } else {
              // Create the category
              const slug = partName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
              const { data: created, error: createErr } = await supabase
                .from("categories")
                .insert({
                  workspace_id: workspaceId,
                  name: partName,
                  slug,
                  parent_id: currentParentId,
                })
                .select("id")
                .single();

              if (createErr) {
                errors.push(`Failed to create "${partName}": ${createErr.message}`);
                break;
              }
              currentParentId = created.id;
              leafCatId = created.id;
              catNameMap.set(partName.toLowerCase(), { ...cat, id: created.id, name: partName });
            }
          }

          if (leafCatId && leafCatId !== cat.id) {
            // Move products from corrupted category to the leaf
            const { error: updateErr } = await supabase
              .from("products")
              .update({ category: parts[parts.length - 1], category_id: leafCatId })
              .eq("workspace_id", workspaceId)
              .eq("category_id", cat.id);

            if (updateErr) {
              errors.push(`Failed to move products for "${cat.name}": ${updateErr.message}`);
            }

            // Delete the corrupted category
            const { error: delErr } = await supabase
              .from("categories")
              .delete()
              .eq("id", cat.id);

            if (delErr) {
              errors.push(`Failed to delete corrupted "${cat.name}": ${delErr.message}`);
            } else {
              fixed++;
              report.push({
                original: cat.name,
                action: "split_hierarchy",
                details: `Split into ${parts.length} levels, leaf: "${parts[parts.length - 1]}"`,
              });
            }
          }
        } else if (cat.name.includes("|")) {
          // Multi-category: split by | and assign products to each
          const parts = cat.name.split("|").map((s: string) => s.trim()).filter(Boolean);

          for (const partName of parts) {
            const existing = catNameMap.get(partName.toLowerCase());
            if (!existing || existing.id === cat.id) {
              // Create category for this part
              const slug = partName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
              const { data: created, error: createErr } = await supabase
                .from("categories")
                .insert({
                  workspace_id: workspaceId,
                  name: partName,
                  slug,
                  parent_id: null,
                })
                .select("id")
                .single();

              if (createErr) {
                errors.push(`Failed to create "${partName}" from multi-cat: ${createErr.message}`);
              }
            }
          }

          // Delete the corrupted category
          const { error: delErr } = await supabase
            .from("categories")
            .delete()
            .eq("id", cat.id);

          if (delErr) {
            errors.push(`Failed to delete multi-cat "${cat.name}": ${delErr.message}`);
          } else {
            fixed++;
            report.push({
              original: cat.name,
              action: "split_multi",
              details: `Split into ${parts.length} separate categories`,
            });
          }
        }
      } catch (err) {
        errors.push(`Error processing "${cat.name}": ${err instanceof Error ? err.message : "Unknown"}`);
      }
    }

    return new Response(JSON.stringify({ fixed, skipped, errors, report }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("fix-corrupted-categories error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
