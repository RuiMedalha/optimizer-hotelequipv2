// ──────────────────────────────────────────────────────────────────────────
//  publish-woocommerce-turbo
//
//  TURBO: Must remain functionally identical to publish-woocommerce
//  Only difference: parallel batch processing
//
//  Estratégia (aditiva — não substitui o publish-woocommerce clássico):
//    1) Pre-upload das imagens únicas para /wp/v2/media (com dedup por SHA-256)
//       → reduz drasticamente a pressão de disco /tmp do WordPress (uma única
//       escrita por imagem em vez de uma por produto).
//    2) Payload consolidado (título + descrição + curta + preço + sale + sku +
//       categorias + tags + meta SEO + FAQ + Uso Profissional + Upsells +
//       Brand) num único objeto por produto.
//    3) Chamada /wc/v3/products/batch (50 produtos/lote) com create/update.
//    4) Itens que falham no batch (ou que não são "simple") são delegados
//       de volta ao publish-woocommerce clássico, item-a-item, garantindo
//       que NADA é perdido.
//
//  Reutiliza a tabela publish_jobs e o realtime já existentes.
// ──────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const TURBO_BATCH_SIZE = 20; // Reduced from 50 to 20 to avoid timeouts during image pre-upload and batch processing
const SELF_INVOKE_RETRIES = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface WooResult {
  id: string;
  status: string;
  woocommerce_id?: number;
  error?: string;
}

// ── Self-invoke (continuação do job) ───────────────────────────────────────
async function selfInvokeTurbo(authHeader: string, jobId: string, startIndex: number) {
  const payload = JSON.stringify({ jobId, startIndex });
  for (let attempt = 1; attempt <= SELF_INVOKE_RETRIES; attempt++) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/publish-woocommerce-turbo`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: payload,
      });
      if (r.ok) return true;
      if (r.status !== 429 && r.status < 500) {
        console.error(`[turbo] self-invoke non-retryable ${r.status}`);
        return false;
      }
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
    } catch (e) {
      console.warn(`[turbo] self-invoke attempt ${attempt} threw`, e);
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
    }
  }
  return false;
}

// ── Single-product POST/PUT inline (reaproveita o WC já autenticado) ──────
// Substitui a delegação assíncrona ao clássico para garantir que NUNCA marcamos
// um produto como "publicado" antes do WooCommerce confirmar com um ID real.
async function publishSingleInline(
  baseUrl: string,
  auth: string,
  product: any,
  payload: Record<string, unknown>,
  supabase: any,
): Promise<{ ok: boolean; woocommerce_id?: number; mode: "create" | "update"; error?: string }> {
  let isUpdate = !!product.woocommerce_id;
  
  // ── SE NÃO TEM woocommerce_id, tenta encontrar por SKU para evitar duplicados ──
  if (!isUpdate && product.sku) {
    try {
      const searchUrl = `${baseUrl}/wp-json/wc/v3/products?sku=${encodeURIComponent(product.sku)}`;
      const searchResp = await fetch(searchUrl, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (searchResp.ok) {
        const existing = await searchResp.json();
        if (Array.isArray(existing) && existing.length > 0 && existing[0].id) {
          product.woocommerce_id = existing[0].id;
          isUpdate = true;
          console.log(`[turbo] SKU ${product.sku} found on WC (ID: ${existing[0].id}). Switching to UPDATE mode.`);
          
          // Update local DB to keep sync
          await supabase.from("products")
            .update({ woocommerce_id: existing[0].id })
            .eq("id", product.id);
        }
      }
    } catch (e) {
      console.warn(`[turbo] SKU search failed for ${product.sku}:`, e);
    }
  }

  const url = isUpdate
    ? `${baseUrl}/wp-json/wc/v3/products/${product.woocommerce_id}`
    : `${baseUrl}/wp-json/wc/v3/products`;
    
  try {
    const r = await fetch(url, {
      method: isUpdate ? "PUT" : "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return { ok: false, mode: isUpdate ? "update" : "create", error: `WC ${r.status}: ${text.slice(0, 200)}` };
    }
    const data = await r.json();
    if (!data?.id) return { ok: false, mode: isUpdate ? "update" : "create", error: "WC respondeu sem ID" };
    return { ok: true, mode: isUpdate ? "update" : "create", woocommerce_id: Number(data.id) };
  } catch (e: any) {
    return { ok: false, mode: isUpdate ? "update" : "create", error: e?.message || "Exceção HTTP" };
  }
}

// ── WooCommerce config (mesma origem que o clássico) ──────────────────────
async function getWooConfig(supabase: any) {
  const { data: settings } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["woocommerce_url", "woocommerce_consumer_key", "woocommerce_consumer_secret"]);
  const map: Record<string, string> = {};
  settings?.forEach((s: any) => { map[s.key] = s.value; });
  const wooUrl = map["woocommerce_url"];
  const wooKey = map["woocommerce_consumer_key"];
  const wooSecret = map["woocommerce_consumer_secret"];
  if (!wooUrl || !wooKey || !wooSecret) return null;
  return { baseUrl: wooUrl.replace(/\/+$/, ""), auth: btoa(`${wooKey}:${wooSecret}`) };
}

// ── Hash SHA-256 de um buffer (para dedup de imagens) ──────────────────────
async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateImageFilename(slug: string, index: number, imageUrl: string, ext: string): string {
  const urlLower = (imageUrl || "").toLowerCase();
  if (urlLower.includes("lifestyle")) return `${slug}-lifestyle.${ext}`;
  if (urlLower.includes("optimiz") || urlLower.includes("optimis")) return `${slug}-optimizada.${ext}`;
  if (urlLower.includes("detail") || urlLower.includes("detalhe") || urlLower.includes("pormenor")) return `${slug}-detalhe.${ext}`;
  if (urlLower.includes("dimension") || urlLower.includes("dimensao") || urlLower.includes("medida")) return `${slug}-dimensoes.${ext}`;
  if (urlLower.includes("back") || urlLower.includes("traseira") || urlLower.includes("posterior")) return `${slug}-traseira.${ext}`;
  switch(index) {
    case 0: return `${slug}.${ext}`;
    case 1: return `${slug}-vista.${ext}`;
    default: return `${slug}-detalhe-${index}.${ext}`;
  }
}

function generateImageAltText(productTitle: string, index: number, imageUrl: string): string {
  const urlLower = (imageUrl || "").toLowerCase();
  if (urlLower.includes("lifestyle")) return `${productTitle} - Lifestyle`;
  if (urlLower.includes("optimiz") || urlLower.includes("optimis")) return `${productTitle} - Imagem optimizada`;
  if (urlLower.includes("detail") || urlLower.includes("detalhe") || urlLower.includes("pormenor")) return `${productTitle} - Detalhe`;
  if (urlLower.includes("dimension") || urlLower.includes("dimensao") || urlLower.includes("medida")) return `${productTitle} - Dimensões`;
  if (urlLower.includes("back") || urlLower.includes("traseira") || urlLower.includes("posterior")) return `${productTitle} - Vista traseira`;
  switch(index) {
    case 0: return productTitle;
    case 1: return `${productTitle} - Vista`;
    default: return `${productTitle} - Detalhe ${index}`;
  }
}

const sanitizeFilename = (s: string) =>
  String(s || "image").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 100);

const guessExt = (url: string, ct: string | null): string => {
  const fromUrl = url.match(/\.(jpe?g|png|webp|gif|avif)(?:\?|$)/i)?.[1]?.toLowerCase();
  if (fromUrl) return fromUrl === "jpg" ? "jpg" : fromUrl;
  if (ct?.includes("png")) return "png";
  if (ct?.includes("webp")) return "webp";
  if (ct?.includes("gif")) return "gif";
  return "jpg";
};

interface MediaUploadResult { id: number; source_url: string; }

// ── Pre-upload de imagens (uma única vez por hash) ─────────────────────────
async function preuploadMedia(
  baseUrl: string,
  auth: string,
  imageUrls: string[],
  altByUrl: Map<string, string>,
  hashCache: Map<string, MediaUploadResult>,
  altCache: Map<string, string>,
): Promise<Map<string, MediaUploadResult>> {
  const result = new Map<string, MediaUploadResult>();
  const concurrency = 4;
  const queue = [...new Set(imageUrls.filter(Boolean))];

  const worker = async () => {
    while (queue.length > 0) {
      const url = queue.shift()!;
      try {
        // Already attempted in this session?
        if (altCache.has(url)) {
          // we still need the media id — use cached if present
        }
        const resp = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          },
        });
        if (!resp.ok) {
          console.warn(`[turbo] image fetch failed ${resp.status} ${url}`);
          continue;
        }
        const ct = resp.headers.get("content-type");
        const buf = await resp.arrayBuffer();
        const hash = await sha256Hex(buf);

        // Dedup: if this hash was uploaded already in this session, reuse it
        const existing = hashCache.get(hash);
        if (existing) {
          result.set(url, existing);
          continue;
        }

        const ext = guessExt(url, ct);
        // Using generateImageFilename instead of sanitizeFilename
        const slugForFilename = sanitizeFilename(url.split("/").pop()?.split("?")[0] || "image");
        // We find the index of this url in the original allImageUrls to pass to generateImageFilename
        const urlIndex = imageUrls.indexOf(url);
        const filename = generateImageFilename(slugForFilename, urlIndex === -1 ? 0 : urlIndex, url, ext);
        const blob = new Blob([buf], { type: ct || `image/${ext === "jpg" ? "jpeg" : ext}` });
        const formData = new FormData();
        formData.append("file", new File([blob], filename, { type: blob.type }));
        const altText = altByUrl.get(url);
        if (altText) {
          formData.append("alt_text", altText);
          formData.append("title", altText);
        }

        const upResp = await fetch(`${baseUrl}/wp-json/wp/v2/media`, {
          method: "POST",
          headers: { Authorization: `Basic ${auth}` },
          body: formData,
        });
        if (!upResp.ok) {
          const errBody = await upResp.text().catch(() => "");
          console.warn(`[turbo] /wp/v2/media upload failed ${upResp.status} for ${url} :: ${errBody.slice(0, 200)}`);
          continue;
        }
        const media = await upResp.json();
        const entry: MediaUploadResult = { id: media.id, source_url: media.source_url };
        hashCache.set(hash, entry);
        result.set(url, entry);
        if (altText) altCache.set(url, altText);
      } catch (e) {
        console.warn(`[turbo] image upload exception ${url}`, e);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return result;
}

// ── Categorias: resolve hierarquia local → woocommerce_id ──────────────────
async function resolveCategories(supabase: any, product: any): Promise<Array<{ id: number }> | undefined> {
  if (product.category_id) {
    const { data: cat } = await supabase
      .from("categories")
      .select("woocommerce_id, parent_id")
      .eq("id", product.category_id)
      .single();
    if (cat?.woocommerce_id) {
      const ids: Array<{ id: number }> = [{ id: cat.woocommerce_id }];
      let pid = cat.parent_id;
      while (pid) {
        const { data: p } = await supabase
          .from("categories")
          .select("woocommerce_id, parent_id")
          .eq("id", pid)
          .single();
        if (p?.woocommerce_id) ids.push({ id: p.woocommerce_id });
        pid = p?.parent_id || null;
      }
      return ids;
    }
  }
  return undefined;
}

// ── Resolve SKUs → woocommerce_ids (para upsells/cross-sells) ──────────────
async function resolveSkusToWooIds(supabase: any, skus: any): Promise<number[]> {
  let arr: string[] = [];
  if (Array.isArray(skus)) {
    arr = skus.map((x: any) => typeof x === "string" ? x : (x?.sku || "")).filter(Boolean);
  }
  if (arr.length === 0) return [];
  const { data: rows } = await supabase
    .from("products")
    .select("woocommerce_id")
    .in("sku", arr)
    .not("woocommerce_id", "is", null);
  return (rows || []).map((r: any) => Number(r.woocommerce_id)).filter((n: number) => Number.isFinite(n) && n > 0);
}

// ── Fetch FAQ rows (mesma origem que o clássico) ───────────────────────────
async function fetchFaq(supabase: any, productId: string): Promise<Array<{ q: string; a: string }>> {
  const { data } = await supabase
    .from("faqs")
    .select("question, answer, sort_order")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });
  return (data || []).map((r: any) => ({ q: r.question, a: r.answer })).filter(x => x.q && x.a);
}

async function fetchUsoProfissional(supabase: any, productId: string): Promise<string | null> {
  const { data } = await supabase
    .from("product_uso_profissional")
    .select("intro, use_cases, professional_tips, target_profiles")
    .eq("product_id", productId)
    .maybeSingle();

  if (!data) return null;

  // Convert structured data back to HTML if needed, or return null if empty
  // Actually, we already have professional_use_content in the products table
  // so we'll prefer that in buildConsolidatedPayload.
  return null; 
}

 function buildFaqHtml(faq: any[]): string {
   if (!Array.isArray(faq) || faq.length === 0) return "";
   const items = faq.slice(0, 5).map((item: any) => {
    const q = typeof item === "string" ? item : (item?.question || item?.q || "");
    const a = typeof item === "string" ? "" : (item?.answer || item?.a || "");
    if (!q) return "";
    // Match the style generated by the AI in optimize-product for consistency
    return `<div style="margin-bottom:16px;">
      <p style="font-weight:bold; color:#2c2c2c; margin:0 0 4px;">${q}</p>
      <p style="color:#374151; line-height:1.6; margin:0 0 12px;">${a}</p>
    </div>`;
  }).filter(Boolean);
  if (items.length === 0) return "";
  return `<!-- HOTELEQUIP:FAQ_START --><div class="product-faq" style="margin-top:24px; margin-bottom:22px;">\n<h3 style="margin:0 0 12px; font-size:18px; font-weight:700; color:#00526d; border-bottom:2px solid #e5e7eb; padding-bottom:6px;">Perguntas Frequentes</h3>\n${items.join("")}\n</div><!-- HOTELEQUIP:FAQ_END -->`;
}

function buildUsoProfissionalHtml(data: any): string {
  if (!data) return "";
  const sections: string[] = [];
  sections.push(`<h3 style="font-size:1.1em;font-weight:600;margin-bottom:0.75em;color:#00526d;">Como é usado por profissionais</h3>`);
  if (data.intro) sections.push(`<p style="color:#374151;line-height:1.7;margin:0 0 1em;">${data.intro}</p>`);
  if (Array.isArray(data.use_cases) && data.use_cases.length > 0) {
    const items = data.use_cases.map((uc: any) => {
      const title = uc.context || uc.title || uc.name || "";
      const desc = uc.description || uc.text || "";
      return title && desc ? `<li style="margin-bottom:0.5em;"><strong>${title}:</strong> ${desc}</li>` : (title || desc ? `<li style="margin-bottom:0.5em;">${title || desc}</li>` : "");
    }).filter(Boolean);
    if (items.length > 0) {
      sections.push(`<h4 style="font-weight:600;margin:1em 0 0.5em;color:#00526d;">Contextos de utilização</h4><ul style="padding-left:1.25em;color:#374151;line-height:1.6;">${items.join("")}</ul>`);
    }
  }
  if (Array.isArray(data.professional_tips) && data.professional_tips.length > 0) {
    const items = data.professional_tips.map((t: any) => {
      let text = typeof t === "string" ? t : (t?.tip || t?.text || "");
      text = text.replace(/^(Dica Profissional|Professional Tip):\s*/i, "");
      return text ? `<li style="margin-bottom:0.25em;">${text}</li>` : "";
    }).filter(Boolean);
    if (items.length > 0) {
      sections.push(`<h4 style="font-weight:600;margin:1em 0 0.5em;color:#00526d;">Dicas de profissionais</h4><ul style="padding-left:1.25em;color:#374151;line-height:1.6;">${items.join("")}</ul>`);
    }
  }
  return `<!-- HOTELEQUIP:USO_PROFISSIONAL_START --><div class="uso-profissional-hotelequip" style="margin-top:2em;padding-top:1.5em;border-top:1px solid #e5e7eb;">${sections.join("")}</div><!-- HOTELEQUIP:USO_PROFISSIONAL_END -->`;
}

function buildUsoProfissionalJson(data: any): any[] {
  if (!data) return [];
  const repeater: any[] = [];
  if (data.intro) repeater.push({ title: "Introdução", description: String(data.intro) });
  if (Array.isArray(data.use_cases)) {
    for (const uc of data.use_cases) {
      repeater.push({ title: String(uc?.context || uc?.title || uc?.name || "Caso de Uso"), description: String(uc?.description || uc?.text || (typeof uc === 'string' ? uc : '')) });
    }
  }
  if (Array.isArray(data.professional_tips)) {
    for (const tip of data.professional_tips) {
      let text = String(typeof tip === "string" ? tip : (tip?.description || tip?.text || tip?.tip || ""));
      text = text.replace(/^(Dica Profissional|Professional Tip):\s*/i, "");
      if (text) repeater.push({ title: "Dica Profissional", description: text });
    }
  }
  return repeater;
}

function injectOrReplaceBlock(description: string, startMarker: string, endMarker: string, newBlock: string): string {
  const startIdx = description.indexOf(startMarker);
  const endIdx = description.indexOf(endMarker);
  if (startIdx >= 0 && endIdx >= 0) return description.substring(0, startIdx) + newBlock + description.substring(endIdx + endMarker.length);
  return description + newBlock;
}

function stripHtml(value: string): string {
  if (!value) return "";
  return value.replace(/<[^>]*>?/gm, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// ── Build consolidated payload (simple products) ───────────────────────────
function buildConsolidatedPayload(
  product: any,
  has: (k: string) => boolean,
  imageMap: Map<string, MediaUploadResult>,
  categoryIds: Array<{ id: number }> | undefined,
  faqs: any[],
  usoData: any,
  upsellIds: number[],
  crosssellIds: number[],
  markupPercent: number,
  discountPercent: number,
  altByUrl: Map<string, string>,
  seoPlugin: string = 'rankmath'
): Record<string, unknown> {
  const wp: Record<string, unknown> = { 
    type: "simple",
    status: "publish",
    catalog_visibility: "visible",
    /* PAUSED - was overwriting stock settings
    manage_stock: false,
    stock_status: "instock",
    */
  };

  if (has("title")) wp.name = product.optimized_title || product.original_title || "Sem título";
  if (has("description")) {
    let desc = product.optimized_description || product.original_description || "";
    
    // Rule 2 & 3: Strip existing FAQ and Uso Profissional HTML
    desc = desc.replace(/<!-- HOTELEQUIP:FAQ_START -->[\s\S]*?<!-- HOTELEQUIP:FAQ_END -->/gi, "");
    desc = desc.replace(/<div[^>]*class=["']hotelequip-faq["'][\s\S]*?<\/div>/gi, "");
    desc = desc.replace(/<div[^>]*class=["']product-faq["'][\s\S]*?<\/div>/gi, "");
    desc = desc.replace(/<!-- HOTELEQUIP:USO_PROFISSIONAL_START -->[\s\S]*?<!-- HOTELEQUIP:USO_PROFISSIONAL_END -->/gi, "");
    desc = desc.replace(/<div[^>]*class=["']uso-profissional[^"']*["'][\s\S]*?<\/div>/gi, "");

    // Ensure product-description is closed if it exists but is not closed at the end
    if (desc.includes('class="product-description"') && !desc.trim().endsWith('</div>')) {
      desc = desc.trim() + "</div>";
    }

    // Rule 3: Add Uso Profissional if requested
    if (has("uso_profissional_in_description") && usoData && usoData.publish_enabled) {
      const usoHtml = buildUsoProfissionalHtml(usoData);
      if (usoHtml) {
        desc = injectOrReplaceBlock(desc, "<!-- HOTELEQUIP:USO_PROFISSIONAL_START -->", "<!-- HOTELEQUIP:USO_PROFISSIONAL_END -->", usoHtml);
      }
    }

    // Rule 2: Add FAQ if requested
    if (has("faq_in_description") && faqs.length > 0) {
      const faqHtml = buildFaqHtml(faqs);
      if (faqHtml) {
        desc = injectOrReplaceBlock(desc, "<!-- HOTELEQUIP:FAQ_START -->", "<!-- HOTELEQUIP:FAQ_END -->", faqHtml);
      }
    }
    
    wp.description = desc.trim();
  }
  if (has("short_description")) {
    const raw = product.optimized_short_description || product.short_description || "";
    wp.short_description = raw
      ? `<div class="hotelequip-short-description" style="background:linear-gradient(135deg,#eef6fb 0%,#e8f1f8 100%);border-left:4px solid #0077b6;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:12px;"><p style="color:#1a3a4a;font-size:15px;line-height:1.7;margin:0;">${raw}</p></div>`
      : "";
  }
  if (has("price")) {
    let basePrice = parseFloat(product.optimized_price || product.original_price || "0") || 0;
    if (markupPercent > 0) basePrice = basePrice * (1 + markupPercent / 100);
    wp.regular_price = basePrice.toFixed(2);
    if (has("sale_price") && discountPercent > 0) {
      wp.sale_price = (basePrice * (1 - discountPercent / 100)).toFixed(2);
    }
  }
  if (has("sale_price") && !wp.sale_price) {
    const sp = product.optimized_sale_price ?? product.sale_price;
    if (sp != null) wp.sale_price = String(sp);
  }
  if (has("sku") && product.sku) wp.sku = product.sku;

  if (has("images") && Array.isArray(product.image_urls) && product.image_urls.length > 0) {
    const imgs: any[] = [];
    for (let i = 0; i < product.image_urls.length; i++) {
      const url = product.image_urls[i];
      if (!url || typeof url !== "string") continue; // Added safety check
      const media = imageMap.get(url);
      const altText = altByUrl.get(url) || "";
      if (media) {
        imgs.push(altText ? { id: media.id, alt: altText, position: i } : { id: media.id, position: i });
      } else {
        imgs.push(altText ? { src: url, alt: altText, position: i } : { src: url, position: i });
      }
    }
    if (imgs.length > 0) wp.images = imgs;
  }

  if (has("categories") && categoryIds && categoryIds.length > 0) wp.categories = categoryIds;

  if (has("tags") && Array.isArray(product.tags) && product.tags.length > 0) {
    wp.tags = product.tags
      .map((t: any) => typeof t === "string" ? t.trim() : (t?.name || ""))
      .filter((t: string) => t.length > 0)
      .map((name: string) => ({ name }));
  }

  // ── Meta_data consolidado ──
  const meta: Array<{ key: string; value: any }> = [];
  
  // Rule 1: _product_faqs from product.faq
  if (Array.isArray(product.faq) && product.faq.length > 0) {
    meta.push({
      key: "_product_faqs",
      value: JSON.stringify(product.faq.map((f: any) => ({
        question: f.question || f.q || "",
        answer: f.answer || f.a || "",
      })))
    });
  } else if (faqs.length > 0) {
    meta.push({
      key: "_product_faqs",
      value: JSON.stringify(faqs.map((f: any) => ({
        question: f.question || f.q || "",
        answer: f.answer || f.a || "",
      })))
    });
  }

  // Rule 3: _product_conselhos
  if (usoData && usoData.publish_enabled) {
    meta.push({ key: "_product_conselhos", value: buildUsoProfissionalJson(usoData) });
    const plainReview = stripHtml(buildUsoProfissionalHtml(usoData));
    meta.push({ key: "_editorial_review", value: plainReview });
    
    if (seoPlugin === 'rankmath') {
      const schema = {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": wp.name || product.optimized_title || product.original_title,
        "review": {
          "@type": "Review",
          "reviewRating": { "@type": "Rating", "ratingValue": "5", "bestRating": "5" },
          "author": { "@type": "Organization", "name": "HotelEquip" },
          "reviewBody": plainReview
        }
      };
      meta.push({ key: 'rank_math_schema_Product', value: JSON.stringify(schema) });
    }
  }

  if (has("meta_title") && product.meta_title) meta.push({ key: "_yoast_wpseo_title", value: String(product.meta_title) });
  if (has("meta_description") && product.meta_description) meta.push({ key: "_yoast_wpseo_metadesc", value: String(product.meta_description) });
  
  if (Array.isArray(product.focus_keyword) && product.focus_keyword.length > 0) {
    meta.push({ key: "_yoast_wpseo_focuskw", value: String(product.focus_keyword[0]) });
  }

  if (Array.isArray(product.attributes)) {
    for (const a of product.attributes) {
      const n = String(a?.name || "").toLowerCase().trim();
      if (n === "marca" || n === "brand") {
        const v = String(a?.value || a?.options?.[0] || "").trim();
        if (v) {
          meta.push({ key: "_brand", value: v });
          meta.push({ key: "xstore_brand", value: v });
          meta.push({ key: "brand_id", value: v });
        }
        break;
      }
    }
  }
  if (meta.length > 0) wp.meta_data = meta;

  // ── Attributes (Marca, Modelo, EAN only) ──────────────────────────────────
  if (product.product_type !== "variable" && !product.parent_product_id) {
    const attrPayload: Array<{ name: string; options: string[]; visible: boolean; variation: boolean }> = [];
    
    // /* PAUSED: Only sync these 3 attributes to WooCommerce
    const ALLOWED_ATTRIBUTES = ["marca", "brand", "modelo", "model", "ean", "gtin", "código de barras"];
    // */
    
    // From product.attributes array
    if (Array.isArray(product.attributes)) {
      for (const a of product.attributes) {
        const n = String(a?.name || "").toLowerCase().trim();
        // /* PAUSED: Filter allowed attributes */
        // if (!ALLOWED_ATTRIBUTES.some(allowed => n.includes(allowed))) continue;
        const values: string[] = [];
        if (a?.value) values.push(String(a.value));
        if (Array.isArray(a?.values)) for (const v of a.values) values.push(String(v));
        if (Array.isArray(a?.options)) for (const v of a.options) values.push(String(v));
        if (values.length === 0) continue;
        attrPayload.push({ name: a.name || n, options: [...new Set(values)], visible: true, variation: false });
      }
    }
    
    // Always add Marca from product.brand if not already in attributes
    if (product.brand && !attrPayload.some(a => a.name.toLowerCase().includes("marca") || a.name.toLowerCase().includes("brand"))) {
      attrPayload.push({ name: "Marca", options: [product.brand], visible: true, variation: false });
    }
    
    // Always add Modelo from product.model if not already in attributes
    if (product.model && !attrPayload.some(a => a.name.toLowerCase().includes("modelo") || a.name.toLowerCase().includes("model"))) {
      attrPayload.push({ name: "Modelo", options: [product.model], visible: true, variation: false });
    }
    
    // Always add EAN from product.ean if not already in attributes
    if (product.ean && !attrPayload.some(a => a.name.toLowerCase().includes("ean") || a.name.toLowerCase().includes("gtin"))) {
      attrPayload.push({ name: "EAN", options: [String(product.ean)], visible: true, variation: false });
    }
    
    if (attrPayload.length > 0) wp.attributes = attrPayload;
  }

  if (has("upsells") && upsellIds.length > 0) wp.upsell_ids = upsellIds;
  if (has("crosssells") && crosssellIds.length > 0) wp.cross_sell_ids = crosssellIds;

  return wp;
}

// ── HTTP main handler ──────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } },
    );
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json();

    // Workspace permission check (mesmo do clássico)
    if (!body.jobId && body.workspaceId) {
      const { data: m } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", body.workspaceId)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();
      if (m) {
        const rank = ({ owner: 4, admin: 3, editor: 2, viewer: 1 } as any)[m.role] || 0;
        if (rank < 3) {
          return new Response(JSON.stringify({ error: "Sem permissão para publicar (mínimo: admin)" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // ── MODE: Continue an existing job ───────────────────────────────────
    if (body.jobId && body.startIndex !== undefined) {
      const { jobId, startIndex } = body;
      const { data: job, error: jobErr } = await adminClient
        .from("publish_jobs").select("*").eq("id", jobId).single();
      if (jobErr || !job) {
        return new Response(JSON.stringify({ error: "Job não encontrado" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (job.status === "cancelled") {
        return new Response(JSON.stringify({ status: "cancelled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const wooConfig = await getWooConfig(supabase);
      if (!wooConfig) {
        await adminClient.from("publish_jobs").update({
          status: "failed",
          error_message: "Credenciais WooCommerce não configuradas.",
          completed_at: new Date().toISOString(),
        }).eq("id", jobId);
        return new Response(JSON.stringify({ error: "Credenciais WC ausentes" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { baseUrl, auth } = wooConfig;
      const fields = job.publish_fields && Array.isArray(job.publish_fields) && job.publish_fields.length > 0 ? new Set(job.publish_fields) : null;
      const has = (k: string) => !fields || fields.has(k);
      const pricing = job.pricing || {};
      const markupPercent = pricing?.markupPercent ?? 0;
      const discountPercent = pricing?.discountPercent ?? 0;

      const productIds = job.product_ids as string[];
      const endIndex = Math.min(startIndex + TURBO_BATCH_SIZE, productIds.length);
      const lotIds = productIds.slice(startIndex, endIndex);

      const { data: lotProducts } = await supabase
        .from("products").select("*").in("id", lotIds);
      const byId = new Map<string, any>((lotProducts || []).map((p: any) => [p.id, p]));
      const lot = lotIds.map((id) => byId.get(id)).filter(Boolean);

      const existingResults = (job.results || []) as WooResult[];

      // Atualizar nome corrente
      if (lot.length > 0) {
        const first = lot[0].optimized_title || lot[0].original_title || lot[0].sku || lot[0].id.slice(0, 8);
        await adminClient.from("publish_jobs").update({
          current_product_name: `${first} (Turbo +${lot.length - 1})`,
          status: "processing",
          started_at: job.started_at || new Date().toISOString(),
        }).eq("id", jobId);
      }

      // ── 1) SEPARAR: simples (Turbo) vs complexos (delegate to Classic) ──
      const simpleProducts: any[] = [];
      const complexProducts: any[] = [];
      for (const p of lot) {
        if (p.product_type === "variable" || p.parent_product_id) {
          complexProducts.push(p);
        } else {
          simpleProducts.push(p);
        }
      }

      // ── 2) Produtos COMPLEXOS (variable / variation): Turbo NÃO os publica.
      //     Marcamos como "skipped_complex" para que o utilizador veja claramente
      //     que precisam do modo Clássico. NÃO são contados como "publicados".
      if (complexProducts.length > 0) {
        for (const p of complexProducts) {
          existingResults.push({
            id: p.id,
            status: "skipped_complex",
            error: "Produto variável/variação — use o modo Clássico para publicar",
          });
        }
        // Sync processed_products for complex products that are skipped
        await adminClient.from("publish_jobs").update({
          processed_products: startIndex + complexProducts.length,
          results: existingResults,
        }).eq("id", jobId);
      }

      // ── 3) PROCESSAR simples em modo Turbo ──
      if (simpleProducts.length > 0) {
        // 3a) Recolher imagens únicas + alt texts
        let allImageUrls = new Set<string>();
        const altByUrl = new Map<string, string>();
        
        for (const p of simpleProducts) {
          if (!has("images")) break;
          
          const currentProductImageUrls = Array.isArray(p.image_urls) ? p.image_urls : [];
          
          // Cache external images to Supabase Storage before publishing
          const externalImages = currentProductImageUrls.filter(url => 
            url && typeof url === "string" &&
            !url.includes(Deno.env.get("SUPABASE_URL") || "") && 
            url.startsWith("http")
          );

          if (externalImages.length > 0) {
            console.log(`[turbo] Caching ${externalImages.length} external images for product ${p.id}...`);
            try {
              const cacheResp = await fetch(`${SUPABASE_URL}/functions/v1/cache-product-images`, {
                method: "POST",
                headers: { Authorization: authHeader!, "Content-Type": "application/json" },
                body: JSON.stringify({ productIds: [p.id], workspaceId: p.workspace_id, overwrite: false }),
              });
              
              if (cacheResp.ok) {
                // Reload product image_urls from DB
                const { data: refreshed } = await adminClient
                  .from("products")
                  .select("image_urls")
                  .eq("id", p.id)
                  .single();
                if (refreshed?.image_urls) {
                  p.image_urls = refreshed.image_urls;
                  console.log(`[turbo] Product ${p.id} images refreshed (now from Supabase Storage)`);
                }
              }
            } catch (err) {
              console.warn(`[turbo] Failed to cache images for product ${p.id}:`, err);
            }
          }

          if (Array.isArray(p.image_urls)) {
            for (let i = 0; i < p.image_urls.length; i++) {
              const url = p.image_urls[i];
              if (!url || typeof url !== "string") continue;
              allImageUrls.add(url);
              
              const rawAlts = p.image_alt_texts;
              let alt = "";
              if (rawAlts && typeof rawAlts === "object" && !Array.isArray(rawAlts)) {
                alt = String((rawAlts as any)[url] || "");
              } else if (Array.isArray(rawAlts)) {
                const m = rawAlts.find((x: any) => x?.url === url);
                if (m) alt = String(m.alt_text || "");
              }
              
              if (!alt && has("image_alt_text")) {
                const productTitle = String(p.optimized_title || p.original_title || p.sku || "").trim();
                if (productTitle) alt = generateImageAltText(productTitle, i, url);
              }
              
              if (alt) altByUrl.set(url, alt);
            }
          }
        }

        // 3b) Pre-upload (com dedup por hash)
        const hashCache = new Map<string, MediaUploadResult>();
        const altCache = new Map<string, string>();
        const imageMap = has("images") && allImageUrls.size > 0
          ? await preuploadMedia(baseUrl, auth, [...allImageUrls], altByUrl, hashCache, altCache)
          : new Map<string, MediaUploadResult>();
        console.log(`[turbo] pre-uploaded ${imageMap.size}/${allImageUrls.size} unique images (dedup hits=${allImageUrls.size - hashCache.size})`);

        // 3c) Construir payloads em paralelo
        const payloads = await Promise.all(simpleProducts.map(async (p) => {
          const [categoryIds, upsellIds, crosssellIds, usoData] = await Promise.all([
            has("categories") ? resolveCategories(supabase, p) : Promise.resolve(undefined),
            has("upsells") ? resolveSkusToWooIds(supabase, p.upsell_skus || []) : Promise.resolve([]),
            has("crosssells") ? resolveSkusToWooIds(supabase, p.crosssell_skus || []) : Promise.resolve([]),
            adminClient.from("product_uso_profissional").select("*").eq("product_id", p.id).maybeSingle().then(({data}: any) => data),
          ]);

          const faqs = Array.isArray(p.faq) ? p.faq : await fetchFaq(supabase, p.id).catch(() => []);

          const wp = buildConsolidatedPayload(
            p, has, imageMap, categoryIds, faqs, usoData, upsellIds, crosssellIds,
            markupPercent, discountPercent, altByUrl,
          );
          return { product: p, payload: wp };
        }));

        // 3d) Separar create vs update
        const create: any[] = [];
        const update: any[] = [];
        const indexMap: { product: any; bucket: "create" | "update"; pos: number }[] = [];
        for (const { product, payload } of payloads) {
          if (product.woocommerce_id) {
            indexMap.push({ product, bucket: "update", pos: update.length });
            update.push({ id: product.woocommerce_id, ...payload });
          } else {
            indexMap.push({ product, bucket: "create", pos: create.length });
            create.push(payload);
          }
        }

        // 3e) Chamar /products/batch
        const batchBody: any = {};
        if (create.length > 0) batchBody.create = create;
        if (update.length > 0) batchBody.update = update;

        let batchResp: any = null;
        let batchOk = false;
        try {
          const r = await fetch(`${baseUrl}/wp-json/wc/v3/products/batch`, {
            method: "POST",
            headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
            body: JSON.stringify(batchBody),
          });
          if (r.ok) {
            batchResp = await r.json();
            batchOk = true;
          } else {
            const text = await r.text().catch(() => "");
            console.warn(`[turbo] batch POST failed status=${r.status} :: ${text.slice(0, 400)}`);
          }
        } catch (e) {
          console.warn("[turbo] batch POST exception", e);
        }

        const failedToFallback: Array<{ product: any; payload: Record<string, unknown> }> = [];
        // Mapa rápido id-produto → payload para retry inline (sem reconstruir)
        const payloadByProductId = new Map<string, Record<string, unknown>>();
        for (const { product, payload } of payloads) payloadByProductId.set(product.id, payload);

        if (batchOk && batchResp) {
          const createdArr = Array.isArray(batchResp.create) ? batchResp.create : [];
          const updatedArr = Array.isArray(batchResp.update) ? batchResp.update : [];
          for (const map of indexMap) {
            const arr = map.bucket === "create" ? createdArr : updatedArr;
            const r = arr[map.pos];
            if (r && r.id && !r.error) {
              await supabase.from("products")
                .update({ 
                  woocommerce_id: r.id, 
                  status: "published",
                  workflow_state: "published"
                })
                .eq("id", map.product.id);

              /* PAUSED — Second POST was overwriting product data (manage_stock, stock_status)
              // Second POST to force WooCommerce cache invalidation and frontend rendering
              try {
                const wcEndpoint = r.id 
                  ? `${baseUrl}/wp-json/wc/v3/products/${r.id}`
                  : null;
                if (wcEndpoint) {
                  await fetch(wcEndpoint, {
                    method: "PUT",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Basic ${auth}`,
                    },
                    body: JSON.stringify({ 
                      status: "publish",
                      catalog_visibility: "visible",
                      manage_stock: false,
                      stock_status: "instock",
                      date_modified: new Date().toISOString().replace('T', ' ').split('.')[0],
                      meta_data: [{ key: "_lovable_last_sync", value: new Date().toISOString() }]
                    }),
                  });
                }
              } catch (cacheErr) {
                console.warn("[turbo] Cache invalidation POST failed (non-critical):", cacheErr);
              }
              END PAUSED */

              // ... keep existing code (removing individual n8n call)
              existingResults.push({
                id: map.product.id,
                status: map.bucket === "create" ? "created" : "updated",
                woocommerce_id: r.id,
              });
              await adminClient.from("publish_job_items").insert({
                job_id: jobId,
                product_id: map.product.id,
                status: "done",
                woocommerce_id: r.id,
                publish_fields: job.publish_fields || [],
                completed_at: new Date().toISOString(),
              });
            } else {
              const errMsg = r?.error?.message || r?.message || "Falha em batch";
              console.warn(`[turbo] item failed in batch product=${map.product.id}: ${errMsg} → retry inline`);
              failedToFallback.push({ product: map.product, payload: payloadByProductId.get(map.product.id) || {} });
            }
          }

          // Trigger refresh triggers (n8n)
          try {
            // Collect all WC IDs from this batch
            const batchWcIds = batchResp?.create?.map((r: any) => r.id).filter(Boolean) || [];
            const updateWcIds = batchResp?.update?.map((r: any) => r.id).filter(Boolean) || [];
            const allWcIds = [...batchWcIds, ...updateWcIds];

            if (allWcIds.length > 0) {
              // 1. n8n trigger
              try {
                const n8nWebhook = "https://n8n.hotelequip.pt/webhook/refresh-wc-product";
                await fetch(n8nWebhook, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    woocommerce_ids: allWcIds,
                    base_url: baseUrl,
                  }),
                });
              } catch (n8nErr) {
                console.warn("[turbo] n8n refresh trigger failed (non-critical):", n8nErr);
              }
            }
          } catch (refreshErr) {
            console.warn("[turbo] Batch refresh sequence failed (non-critical):", refreshErr);
          }
        } else {
          // Batch inteiro falhou → retry inline para TODOS
          console.warn("[turbo] full batch failed → retry inline all");
          for (const { product, payload } of payloads) {
            failedToFallback.push({ product, payload });
          }
        }

        // 3f) Retry INLINE (item-a-item) para os falhados — só marca como
        //     publicado quando o WooCommerce confirma com um ID real.
        if (failedToFallback.length > 0) {
          for (const { product, payload } of failedToFallback) {
            const res = await publishSingleInline(baseUrl, auth, product, payload, supabase);
            if (res.ok && res.woocommerce_id) {
              await supabase.from("products")
                .update({ 
                  woocommerce_id: res.woocommerce_id, 
                  status: "published",
                  workflow_state: "published"
                })
                .eq("id", product.id);

              /* PAUSED — Second POST was overwriting product data (manage_stock, stock_status)
              // Second POST to force WooCommerce cache invalidation and frontend rendering
              try {
                const wcEndpoint = res.woocommerce_id 
                  ? `${baseUrl}/wp-json/wc/v3/products/${res.woocommerce_id}`
                  : null;
                if (wcEndpoint) {
                  await fetch(wcEndpoint, {
                    method: "PUT",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Basic ${auth}`,
                    },
                    body: JSON.stringify({ 
                      status: "publish",
                      catalog_visibility: "visible",
                      manage_stock: false,
                      stock_status: "instock",
                      date_modified: new Date().toISOString().replace('T', ' ').split('.')[0],
                      meta_data: [{ key: "_lovable_last_sync", value: new Date().toISOString() }]
                    }),
                  });
                }
              } catch (cacheErr) {
                console.warn("[turbo] Cache invalidation POST failed (non-critical):", cacheErr);
              }
              END PAUSED */
              existingResults.push({
                id: product.id,
                status: res.mode === "create" ? "created" : "updated",
                woocommerce_id: res.woocommerce_id,
              });
              await adminClient.from("publish_job_items").insert({
                job_id: jobId,
                product_id: product.id,
                status: "done",
                woocommerce_id: res.woocommerce_id,
                publish_fields: job.publish_fields || [],
                completed_at: new Date().toISOString(),
              });
            } else {
              existingResults.push({
                id: product.id,
                status: "error",
                error: res.error || "Falha desconhecida ao publicar inline",
              });
            }
          }
        }
      }

      // 4) Persistir progresso
      const newFailed = existingResults.filter(r => r.status === "error").length - (job.failed_products || 0);
      await adminClient.from("publish_jobs").update({
        processed_products: endIndex,
        failed_products: Math.max(0, (job.failed_products || 0) + Math.max(0, newFailed)),
        results: existingResults,
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);

      // 5) Próximo lote ou finalizar
      if (endIndex < productIds.length) {
        const { data: check } = await adminClient.from("publish_jobs").select("status").eq("id", jobId).single();
        if (check?.status !== "cancelled") {
          // @ts-ignore EdgeRuntime
          EdgeRuntime.waitUntil(selfInvokeTurbo(authHeader!, jobId, endIndex));
        }
      } else {
        await adminClient.from("publish_jobs").update({
          status: "completed",
          completed_at: new Date().toISOString(),
        }).eq("id", jobId);
      }

      return new Response(JSON.stringify({ status: "processing", jobId, mode: "turbo" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── MODE: Create a new Turbo job ──────────────────────────────────────
    const { productIds, publishFields, pricing, scheduledFor, workspaceId, forcePublish } = body;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum produto selecionado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Expand variable parents → include children (mesma lógica do clássico)
    const { data: selectedProducts } = await supabase
      .from("products").select("id, product_type, parent_product_id").in("id", productIds);
    const variableParentIds = (selectedProducts || []).filter((p: any) => p.product_type === "variable").map((p: any) => p.id);
    const variationParentIds = (selectedProducts || []).filter((p: any) => p.product_type === "variation" && p.parent_product_id).map((p: any) => p.parent_product_id);
    const allFamily = [...new Set([...variableParentIds, ...variationParentIds])];
    let allIds = [...productIds];
    if (allFamily.length > 0) {
      const { data: children } = await supabase.from("products").select("id").in("parent_product_id", allFamily);
      const childIds = (children || []).map((c: any) => c.id);
      allIds = [...new Set([...allIds, ...allFamily, ...childIds])];
    }

    const isScheduled = scheduledFor && new Date(scheduledFor) > new Date();
    const status = isScheduled ? "scheduled" : "queued";

    const { data: newJob, error: insertErr } = await adminClient
      .from("publish_jobs")
      .insert({
        user_id: user.id,
        workspace_id: workspaceId || null,
        status,
        total_products: allIds.length,
        product_ids: allIds,
        publish_fields: publishFields || [],
        pricing: { ...(pricing || {}), ...(forcePublish ? { forcePublish: true } : {}), batchMode: true },
        scheduled_for: scheduledFor || null,
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    if (!isScheduled) {
      // @ts-ignore EdgeRuntime
      EdgeRuntime.waitUntil(selfInvokeTurbo(authHeader!, newJob.id, 0));
    }

    return new Response(JSON.stringify({ jobId: newJob.id, mode: "turbo" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido";
    console.error("[turbo] handler error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
