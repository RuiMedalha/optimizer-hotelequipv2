import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function guessExt(url: string, contentType: string | null): string {
  if (contentType?.includes("webp")) return "webp";
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("gif")) return "gif";
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return "jpg";
  
  const urlExt = url.split(".").pop()?.split("?")[0]?.toLowerCase();
  if (urlExt && ["jpg", "jpeg", "png", "webp", "gif"].includes(urlExt)) {
    return urlExt === "jpeg" ? "jpg" : urlExt;
  }
  return "jpg";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { productIds, workspaceId, overwrite = false } = body;

    if (!productIds?.length || !workspaceId) {
      throw new Error("productIds and workspaceId are required");
    }

    // Ensure bucket exists
    await supabase.storage.createBucket("product-images", {
      public: true,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"]
    }).catch(() => { /* bucket might already exist */ });

    let totalProcessed = 0;
    let totalCached = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    // Process in batches of 5 to avoid timeouts
    const batchSize = 5;
    for (let i = 0; i < productIds.length; i += batchSize) {
      const batch = productIds.slice(i, i + batchSize);
      
      const { data: products, error: fetchError } = await supabase
        .from("products")
        .select("id, sku, original_title, seo_slug, image_urls, workspace_id")
        .in("id", batch);

      if (fetchError) throw fetchError;

      for (const product of products || []) {
        const imageUrls = Array.isArray(product.image_urls) ? product.image_urls : [];
        if (imageUrls.length === 0) {
          totalSkipped++;
          continue;
        }

        const newImageUrls = [...imageUrls];
        let productChanged = false;

        for (let idx = 0; idx < imageUrls.length; idx++) {
          const url = imageUrls[idx];
          if (!url || typeof url !== "string") continue;

          // a. Skip if URL already starts with Supabase Storage URL
          if (url.includes(supabaseUrl) && url.includes("/storage/v1/object/public/product-images/")) {
            totalSkipped++;
            continue;
          }

          // b. Skip if overwrite=false and a cached version already exists in images table
          if (!overwrite) {
            const { data: existing } = await supabase
              .from("images")
              .select("optimized_url")
              .eq("product_id", product.id)
              .eq("original_url", url)
              .not("optimized_url", "is", null)
              .maybeSingle();

            if (existing?.optimized_url) {
              newImageUrls[idx] = existing.optimized_url;
              productChanged = true;
              totalSkipped++;
              continue;
            }
          }

          // c. Download the image with browser-like headers
          try {
            console.log(`[cache-images] Downloading ${url} for product ${product.id}`);
            const resp = await fetch(url, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
                "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
                "Referer": "https://www.google.com/",
              },
            });

            if (!resp.ok) {
              console.warn(`[cache-images] Download failed (${resp.status}) for ${url}`);
              totalFailed++;
              continue;
            }

            const blob = await resp.blob();
            const contentType = resp.headers.get("content-type");
            
            // e. Generate filename from product slug
            const baseSlug = (product.seo_slug || product.original_title || product.sku || "product")
              .toLowerCase()
              .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")
              .substring(0, 60) || "product";
            
            const ext = guessExt(url, contentType);
            const filename = idx === 0 ? `${baseSlug}.${ext}` : `${baseSlug}-${idx + 1}.${ext}`;
            const storagePath = `${workspaceId}/${product.id}/${filename}`;

            // f. Upload to Supabase Storage
            const { data: uploadData, error: uploadError } = await supabase.storage
              .from("product-images")
              .upload(storagePath, blob, {
                contentType: contentType || `image/${ext === "jpg" ? "jpeg" : ext}`,
                upsert: true,
              });

            if (uploadError) {
              console.error(`[cache-images] Upload failed for ${storagePath}:`, uploadError);
              totalFailed++;
              continue;
            }

            // g. Get public URL
            const { data: { publicUrl } } = supabase.storage
              .from("product-images")
              .getPublicUrl(storagePath);

            // h. Record in images table
            await supabase.from("images").upsert({
              product_id: product.id,
              original_url: url,
              optimized_url: publicUrl,
              s3_key: storagePath,
              status: "done",
              sort_order: idx,
            }, { onConflict: "product_id,original_url" });

            newImageUrls[idx] = publicUrl;
            productChanged = true;
            totalCached++;

          } catch (err) {
            console.error(`[cache-images] Exception processing ${url}:`, err);
            totalFailed++;
          }
        }

        // 3. Update product image_urls array
        if (productChanged) {
          await supabase
            .from("products")
            .update({ image_urls: newImageUrls })
            .eq("id", product.id);
        }
        totalProcessed++;
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        processed: totalProcessed, 
        cached: totalCached, 
        failed: totalFailed, 
        skipped: totalSkipped 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: e.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
