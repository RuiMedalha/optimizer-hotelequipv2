import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) throw new Error("Não autenticado");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: ue } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (ue || !user) throw new Error("Não autenticado");

    const { action, workspaceId, productId, usageContext, imageUrl, assetId, sortOrder, reviewStatus } = await req.json();

    if (!workspaceId) throw new Error("workspaceId obrigatório");

    // ACTION: upload / register a new asset from URL
    if (action === "register" || !action) {
      if (!imageUrl) throw new Error("imageUrl obrigatório");

      // Calculate hash from URL for dedup
      const encoder = new TextEncoder();
      const data = encoder.encode(imageUrl);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const fileHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

      // Check for existing asset with same hash in workspace
      const { data: existing } = await sb
        .from("asset_library")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("file_hash", fileHash)
        .maybeSingle();

      let asset = existing;
      let deduplicated = false;

      if (existing) {
        deduplicated = true;
      } else {
        // Detect format from URL
        const urlLower = imageUrl.toLowerCase();
        let format = "unknown";
        let mimeType = "image/jpeg";
        if (urlLower.includes(".png")) { format = "png"; mimeType = "image/png"; }
        else if (urlLower.includes(".webp")) { format = "webp"; mimeType = "image/webp"; }
        else if (urlLower.includes(".gif")) { format = "gif"; mimeType = "image/gif"; }
        else if (urlLower.includes(".svg")) { format = "svg"; mimeType = "image/svg+xml"; }
        else { format = "jpeg"; mimeType = "image/jpeg"; }

        const filename = imageUrl.split("/").pop()?.split("?")[0] || "image";

        const { data: newAsset, error: insertErr } = await sb
          .from("asset_library")
          .insert({
            workspace_id: workspaceId,
            original_filename: filename,
            public_url: imageUrl,
            file_hash: fileHash,
            mime_type: mimeType,
            format,
            asset_type: "original",
            source_kind: "upload",
            status: "active",
          })
          .select()
          .single();

        if (insertErr) throw insertErr;
        asset = newAsset;
      }

      // Link to product if requested
      if (productId && asset) {
        const context = usageContext || "gallery";
        const order = sortOrder ?? 0;

        // Check if link already exists
        const { data: existingLink } = await sb
          .from("asset_product_links")
          .select("id")
          .eq("asset_id", asset.id)
          .eq("product_id", productId)
          .eq("usage_context", context)
          .maybeSingle();

        if (!existingLink) {
          await sb.from("asset_product_links").insert({
            asset_id: asset.id,
            product_id: productId,
            usage_context: context,
            sort_order: order,
          });
        }
      }

      return new Response(JSON.stringify({
        asset,
        deduplicated,
        linked: !!productId,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ACTION: link an existing asset to a product
    if (action === "link") {
      if (!assetId || !productId) throw new Error("assetId e productId obrigatórios");
      const context = usageContext || "gallery";

      const { data: existingLink } = await sb
        .from("asset_product_links")
        .select("id")
        .eq("asset_id", assetId)
        .eq("product_id", productId)
        .eq("usage_context", context)
        .maybeSingle();

      if (existingLink) {
        return new Response(JSON.stringify({ linked: true, existing: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await sb.from("asset_product_links").insert({
        asset_id: assetId,
        product_id: productId,
        usage_context: context,
        sort_order: sortOrder ?? 0,
      });

      return new Response(JSON.stringify({ linked: true, existing: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: review asset
    if (action === "review") {
      if (!assetId || !reviewStatus) throw new Error("assetId e reviewStatus obrigatórios");

      await sb.from("asset_library")
        .update({ review_status: reviewStatus })
        .eq("id", assetId);

      return new Response(JSON.stringify({ updated: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: delete asset
    if (action === "delete") {
      if (!assetId) throw new Error("assetId obrigatório");

      await sb.from("asset_library")
        .update({ status: "archived" })
        .eq("id", assetId);

      return new Response(JSON.stringify({ archived: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Ação desconhecida: ${action}`);
  } catch (err: unknown) {
    console.error("manage-assets error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? (err as Error).message : "Erro interno" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
