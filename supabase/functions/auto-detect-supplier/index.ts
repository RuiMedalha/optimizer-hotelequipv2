import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { workspace_id, file_name, source_url, headers, sample_data, source_type } = await req.json();
    if (!workspace_id) throw new Error("workspace_id required");

    const signals: Record<string, any> = {};
    let detectedName = "";
    let detectedDomain = "";
    let detectedBrand = "";
    let confidence = 0;

    // 1. Filename analysis
    if (file_name) {
      const cleanName = file_name.replace(/\.(xlsx|xls|csv|pdf|xml|json)$/i, "").replace(/[_-]/g, " ").trim();
      const parts = cleanName.split(/\s+/);
      if (parts.length > 0) {
        detectedName = parts.slice(0, 3).join(" ");
        signals.filename_hint = detectedName;
        confidence += 0.2;
      }
    }

    // 2. URL domain analysis
    if (source_url) {
      try {
        const url = new URL(source_url);
        detectedDomain = url.hostname.replace("www.", "");
        const domainParts = detectedDomain.split(".");
        if (domainParts.length >= 2) {
          detectedName = detectedName || domainParts[0].charAt(0).toUpperCase() + domainParts[0].slice(1);
          signals.domain_hint = detectedDomain;
          confidence += 0.3;
        }
      } catch {}
    }

    // 3. Header analysis for brand patterns
    if (headers && Array.isArray(headers)) {
      const brandHeaders = headers.filter((h: string) =>
        /brand|marca|fabricante|manufacturer|supplier|fornecedor/i.test(h)
      );
      if (brandHeaders.length > 0) {
        signals.brand_columns = brandHeaders;
        confidence += 0.1;
      }
    }

    // 4. Sample data analysis - detect repeated brands
    if (sample_data && Array.isArray(sample_data) && sample_data.length > 0) {
      const brandCounts: Record<string, number> = {};
      for (const row of sample_data.slice(0, 50)) {
        for (const [key, val] of Object.entries(row)) {
          if (/brand|marca|fabricante/i.test(key) && typeof val === "string" && val.trim()) {
            brandCounts[val.trim()] = (brandCounts[val.trim()] || 0) + 1;
          }
        }
        // Check titles for repeated brand prefix
        const title = (row as any).title || (row as any).name || (row as any).nome || (row as any).original_title || "";
        if (typeof title === "string" && title.length > 3) {
          const firstWord = title.split(/\s+/)[0];
          if (firstWord.length > 2) {
            brandCounts[firstWord] = (brandCounts[firstWord] || 0) + 1;
          }
        }
      }
      const sorted = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0 && sorted[0][1] >= 3) {
        detectedBrand = sorted[0][0];
        signals.repeated_brand = { brand: detectedBrand, occurrences: sorted[0][1] };
        confidence += 0.2;
      }

      // SKU pattern analysis
      const skuCol = headers?.find((h: string) => /sku|ref|code|codigo|référence/i.test(h));
      if (skuCol) {
        const skus = sample_data.map((r: any) => String(r[skuCol] || "")).filter(Boolean);
        const prefixes: Record<string, number> = {};
        for (const sku of skus) {
          const prefix = sku.replace(/[0-9]+$/, "");
          if (prefix.length >= 2) {
            prefixes[prefix] = (prefixes[prefix] || 0) + 1;
          }
        }
        const topPrefix = Object.entries(prefixes).sort((a, b) => b[1] - a[1]);
        if (topPrefix.length > 0 && topPrefix[0][1] >= 3) {
          signals.sku_prefix = { prefix: topPrefix[0][0], count: topPrefix[0][1] };
          confidence += 0.1;
        }
      }
    }

    confidence = Math.min(confidence, 1);

    // Try to match existing supplier
    let matchedSupplierId = null;
    if (detectedName || detectedDomain || detectedBrand) {
      const { data: existing } = await supabase
        .from("supplier_profiles")
        .select("id, supplier_name, supplier_code, base_url")
        .eq("workspace_id", workspace_id);

      if (existing) {
        for (const s of existing) {
          const nameMatch = detectedName && s.supplier_name?.toLowerCase().includes(detectedName.toLowerCase());
          const domainMatch = detectedDomain && s.base_url?.includes(detectedDomain);
          const codeMatch = detectedBrand && s.supplier_code?.toLowerCase() === detectedBrand.toLowerCase();
          if (nameMatch || domainMatch || codeMatch) {
            matchedSupplierId = s.id;
            confidence = Math.min(confidence + 0.2, 1);
            break;
          }
        }
      }
    }

    // If no match, create draft supplier profile
    if (!matchedSupplierId && detectedName && confidence >= 0.3) {
      const { data: newSupplier } = await supabase
        .from("supplier_profiles")
        .insert({
          workspace_id,
          supplier_name: detectedName,
          supplier_code: detectedBrand || null,
          base_url: source_url || null,
          status: "detected_unconfirmed",
        })
        .select("id")
        .single();
      if (newSupplier) matchedSupplierId = newSupplier.id;
    }

    // Save detection
    const { data: detection, error } = await supabase
      .from("supplier_auto_detections")
      .insert({
        workspace_id,
        file_name,
        source_url,
        source_type: source_type || "excel",
        detected_supplier_name: detectedName || null,
        detected_domain: detectedDomain || null,
        detected_brand: detectedBrand || null,
        detection_signals: signals,
        matched_supplier_id: matchedSupplierId,
        confidence,
        status: matchedSupplierId ? "matched" : "unmatched",
      })
      .select()
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({
      success: true,
      detection,
      matched_supplier_id: matchedSupplierId,
      confidence,
      signals,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
