import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { directAICall } from "../_shared/ai/direct-ai-call.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHUNK_SIZE = 3;
const MAX_CHUNK_CONCURRENCY = 1;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // AI keys resolved automatically from env (GEMINI_API_KEY, OPENAI_API_KEY, etc.)
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { extractionId, chunkMode, chunkStart, chunkEnd, storagePath, overviewData, pdfBase64, languageHint } = body;

    if (!extractionId) throw new Error("extractionId required");

    // ==========================================
    // CHUNK MODE: Process a single page range
    // ==========================================
    if (chunkMode) {
      return await processChunk({
        supabase, supabaseUrl, serviceKey,
        extractionId, chunkStart, chunkEnd, storagePath, overviewData, pdfBase64,
      });
    }

    // ==========================================
    // MAIN MODE: Orchestrate the full extraction
    // ==========================================
    const { data: extraction, error: extErr } = await supabase
      .from("pdf_extractions")
      .select("*, uploaded_files:file_id(*)")
      .eq("id", extractionId)
      .single();
    if (extErr || !extraction) throw new Error("Extraction not found");

    await supabase.from("pdf_extractions").update({ status: "extracting" }).eq("id", extractionId);

    // Detach the long-running orchestration so the HTTP request returns
    // immediately and we don't hit WORKER_RESOURCE_LIMIT (CPU wall time).
    // The frontend polls pdf_extractions for progress.
    // @ts-ignore - EdgeRuntime is provided by Supabase edge runtime
    EdgeRuntime.waitUntil((async () => {
      try {
        await runOrchestration({
          supabase, supabaseUrl, serviceKey,
          extractionId, extraction, languageHint, startTime,
        });
      } catch (err) {
        console.error("Background orchestration failed:", err);
        await supabase.from("pdf_extractions")
          .update({ status: "error" })
          .eq("id", extractionId);
      }
    })());

    return new Response(JSON.stringify({
      success: true, extractionId, status: "extracting",
      message: "Extraction started in background. Poll pdf_extractions for progress.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: unknown) {
    console.error("extract-pdf-pages error:", e);
    try {
      const body = await req.clone().json();
      if (body?.extractionId && !body?.chunkMode) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, serviceKey);
        await supabase.from("pdf_extractions").update({ status: "error" }).eq("id", body.extractionId);
      }
    } catch { /* ignore */ }
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function runOrchestration(opts: {
  supabase: any; supabaseUrl: string; serviceKey: string;
  extractionId: string; extraction: any; languageHint?: string; startTime: number;
}) {
  const { supabase, supabaseUrl, serviceKey, extractionId, extraction, languageHint, startTime } = opts;
  {

    const fileRecord = extraction.uploaded_files;
    if (!fileRecord?.storage_path) throw new Error("No file storage_path");
    const storagePth = fileRecord.storage_path;

    // Load PDF once for overview — try both storage buckets
    let { data: fileData, error: dlErr } = await supabase.storage
      .from("catalogs")
      .download(storagePth);
    if (dlErr || !fileData) {
      console.warn(`Retry download from "knowledge-base" for ${storagePth}`);
      const fallback = await supabase.storage.from("knowledge-base").download(storagePth);
      fileData = fallback.data;
      dlErr = fallback.error;
    }
    if (dlErr || !fileData) throw new Error("Cannot download file: " + (dlErr?.message || "Object not found"));

    const pdfBuffer = await fileData.arrayBuffer();
    const pdfSizeMB = pdfBuffer.byteLength / (1024 * 1024);
    console.log(`PDF loaded for overview: ${pdfSizeMB.toFixed(2)} MB`);
    const overviewPdfBase64 = toBase64(pdfBuffer);

    const overviewResult = await directAICall({
      systemPrompt: "És um especialista em análise de documentos. Analisa este PDF e devolve um JSON conciso com a visão geral do documento.",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:application/pdf;base64,${overviewPdfBase64}` } },
          {
            type: "text",
            text: `Quickly analyze this PDF. Return JSON:
{"total_pages":N,"document_type":"product_catalog"|"price_list"|"technical_sheet"|"mixed"|"scanned_catalog","language":"xx","supplier_name":"...","has_images":bool,"is_scanned":bool,"estimated_products":N,"has_price_tables":bool,"price_table_type":"none"|"simple"|"tiered"|"bulk"|"discount_matrix","table_format":"tabular"|"cards"|"list"|"mixed","page_ranges":[{"start":1,"end":N,"content_type":"products"|"cover"|"index"|"notes"|"empty"|"price_list"}]}
Notes:
- set "is_scanned":true and "document_type":"scanned_catalog" if the PDF pages are images/scans with no selectable text layer.
- set "has_price_tables":true if any pages contain structured pricing grids, quantity-based pricing, tiered pricing, or discount matrices.
- set content_type "price_list" for pages that are primarily pricing tables without product descriptions.
Return ONLY valid JSON.`,
          },
        ],
      }],
      model: "gemini-2.5-flash",
      maxTokens: 2000,
    });

    // Free base64 from memory immediately
    // (JS GC will reclaim once we null the reference and move on)

    let overview: any = { total_pages: 1, page_ranges: [{ start: 1, end: 1, content_type: "products" }] };
    try {
      const content = overviewResult.choices?.[0]?.message?.content || "{}";
      overview = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    } catch { console.warn("Overview parse failed, using defaults"); }

    const totalPages = overview.total_pages || 1;
    await supabase.from("pdf_extractions").update({
      total_pages: totalPages,
      layout_analysis: overview,
    }).eq("id", extractionId);

    // Determine product page ranges
    const productRanges = (overview.page_ranges || []).filter(
      (r: any) => ["products", "specs", "mixed", "price_list"].includes(r.content_type)
    );
    if (productRanges.length === 0) {
      productRanges.push({ start: 1, end: totalPages, content_type: "products" });
    }

    // Check which pages are already extracted (resume support)
    const { data: existingPages } = await supabase
      .from("pdf_pages")
      .select("page_number")
      .eq("extraction_id", extractionId)
      .neq("status", "error");
    const alreadyDone = new Set((existingPages || []).map((p: any) => p.page_number));
    console.log(`Resume check: ${alreadyDone.size} pages already extracted`);

    // Build chunks only for missing pages
    const missingPages: number[] = [];
    for (const range of productRanges) {
      const rs = range.start || 1;
      const re = range.end || totalPages;
      for (let p = rs; p <= re; p++) {
        if (!alreadyDone.has(p)) missingPages.push(p);
      }
    }

    if (missingPages.length === 0) {
      // All pages already extracted — mark as reviewing and return
      await supabase.from("pdf_extractions").update({ status: "reviewing" }).eq("id", extractionId);
      return new Response(JSON.stringify({
        success: true, extractionId, totalPages,
        pagesProcessed: alreadyDone.size, resumed: true, message: "All pages already extracted",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Group missing pages into chunks
    missingPages.sort((a, b) => a - b);
    const chunks: { start: number; end: number }[] = [];
    for (let i = 0; i < missingPages.length; i += CHUNK_SIZE) {
      const group = missingPages.slice(i, i + CHUNK_SIZE);
      chunks.push({ start: group[0], end: group[group.length - 1] });
    }

    console.log(`Dispatching ${chunks.length} chunks for ${missingPages.length} missing pages (${alreadyDone.size} already done, concurrency=${MAX_CHUNK_CONCURRENCY})`);

    // Process chunks with bounded concurrency to prevent worker pressure
    const results: Array<{ chunk: { start: number; end: number }; ok: boolean; result: any }> = [];
    let cumulativeProcessed = alreadyDone.size;

    for (let i = 0; i < chunks.length; i += MAX_CHUNK_CONCURRENCY) {
      const batch = chunks.slice(i, i + MAX_CHUNK_CONCURRENCY);
      const batchResults = await Promise.all(batch.map((chunk) =>
        invokeChunkExtraction({
          supabaseUrl,
          serviceKey,
          extractionId,
          chunk,
          storagePath: storagePth,
          overviewData: {
            language: languageHint || overview.language,
            supplier_name: overview.supplier_name,
            document_type: overview.document_type,
            is_scanned: overview.is_scanned === true,
            has_price_tables: overview.has_price_tables === true,
            price_table_type: overview.price_table_type || "none",
            language_hint: languageHint || null,
          },
        })
      ));
      results.push(...batchResults);

      // Update processed_pages incrementally so the UI shows real progress
      for (const r of batchResults) {
        if (r.ok && r.result) {
          cumulativeProcessed += r.result.pagesProcessed || 0;
        } else {
          // Count error pages too
          cumulativeProcessed += (r.chunk.end - r.chunk.start + 1);
          console.error(`Chunk ${r.chunk.start}-${r.chunk.end} failed:`, r.result?.error);
          for (let p = r.chunk.start; p <= r.chunk.end; p++) {
            await supabase.from("pdf_pages").insert({
              extraction_id: extractionId,
              page_number: p,
              raw_text: `[Extraction failed]`,
              has_tables: false, has_images: false,
              confidence_score: 0, status: "error" as any,
              zones: [],
              page_context: { error: r.result?.error || "chunk failed" },
            });
          }
        }
      }
      // Update progress in DB after each batch
      await supabase.from("pdf_extractions").update({
        processed_pages: cumulativeProcessed,
      }).eq("id", extractionId);
    }

    const processingTime = Date.now() - startTime;
    // Compute totals from results
    let totalPagesProcessed = 0;
    let totalTablesCreated = 0;
    let totalRowsExtracted = 0;
    let confidenceSum = 0;
    for (const r of results) {
      if (r.ok && r.result) {
        totalPagesProcessed += r.result.pagesProcessed || 0;
        totalTablesCreated += r.result.tablesCreated || 0;
        totalRowsExtracted += r.result.rowsExtracted || 0;
        confidenceSum += r.result.confidenceSum || 0;
      }
    }

    await supabase.from("pdf_extractions").update({
      status: "processing",
      processed_pages: cumulativeProcessed,
      extraction_mode: "ai_vision_chunked",
      provider_used: "Lovable AI Gateway",
      provider_model: "google/gemini-2.5-flash",
      model_used: "google/gemini-2.5-flash",
      extraction_method: "ai_vision",
    }).eq("id", extractionId);

    await supabase.from("pdf_extraction_metrics").insert({
      extraction_id: extractionId,
      avg_confidence: totalPagesProcessed > 0 ? Math.round(confidenceSum / totalPagesProcessed) : 0,
      tables_detected: totalTablesCreated,
      rows_extracted: totalRowsExtracted,
      mapping_success_rate: 0,
      processing_time: processingTime,
    });

    // Auto-compile: run map-pdf-to-products to populate detected_products
    console.log("Auto-compiling products from extraction...");
    try {
      const mapResp = await fetch(`${supabaseUrl}/functions/v1/map-pdf-to-products`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          extractionId,
          workspaceId: extraction.workspace_id,
        }),
      });
      const mapResult = mapResp.ok ? await mapResp.json() : null;
      console.log(`Auto-compile result: ${mapResult?.rowsMapped || 0} products compiled`);
    } catch (mapErr) {
      console.error("Auto-compile failed:", mapErr);
      // Still mark as reviewing even if compile fails
    }

    // Final status update
    await supabase.from("pdf_extractions").update({ status: "reviewing" }).eq("id", extractionId);

    return new Response(JSON.stringify({
      success: true, extractionId, totalPages,
      pagesProcessed: cumulativeProcessed,
      pagesResumed: alreadyDone.size,
      pagesNewlyExtracted: totalPagesProcessed,
      tablesDetected: totalTablesCreated,
      productsExtracted: totalRowsExtracted,
      processingTimeMs: processingTime,
      chunksUsed: chunks.length,
      overview: {
        documentType: overview.document_type,
        language: overview.language,
        supplier: overview.supplier_name,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: unknown) {
    console.error("extract-pdf-pages error:", e);

    try {
      const body = await req.clone().json();
      if (body?.extractionId && !body?.chunkMode) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, serviceKey);
        await supabase
          .from("pdf_extractions")
          .update({ status: "error" })
          .eq("id", body.extractionId);
      }
    } catch {
      // ignore update failures in error path
    }

    return new Response(JSON.stringify({ error: e instanceof Error ? (e as Error).message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function invokeChunkExtraction(opts: {
  supabaseUrl: string;
  serviceKey: string;
  extractionId: string;
  chunk: { start: number; end: number };
  storagePath: string;
  overviewData: any;
  pdfBase64?: string;
}) {
  const { supabaseUrl, serviceKey, extractionId, chunk, storagePath, overviewData, pdfBase64 } = opts;

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/extract-pdf-pages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        extractionId,
        chunkMode: true,
        chunkStart: chunk.start,
        chunkEnd: chunk.end,
        storagePath,
        overviewData,
        pdfBase64,
      }),
    });

    const raw = await response.text();
    let result: any = {};
    try {
      result = raw ? JSON.parse(raw) : {};
    } catch {
      result = { error: raw || "Invalid JSON response from chunk" };
    }

    return { chunk, ok: response.ok, result };
  } catch (e: unknown) {
    return { chunk, ok: false, result: { error: e instanceof Error ? (e as Error).message : String(e) } };
  }
}

// ==========================================
// CHUNK PROCESSOR — runs in its own worker
// ==========================================
async function processChunk(opts: {
  supabase: any; supabaseUrl: string; serviceKey: string;
  extractionId: string; chunkStart: number; chunkEnd: number;
  storagePath: string; overviewData: any; pdfBase64?: string;
}) {
  const { supabase, extractionId, chunkStart, chunkEnd, storagePath, overviewData, pdfBase64 } = opts;

  let chunkPdfBase64 = pdfBase64;
  if (!chunkPdfBase64) {
    let { data: fileData, error: dlErr } = await supabase.storage.from("catalogs").download(storagePath);
    if (dlErr || !fileData) {
      const fallback = await supabase.storage.from("knowledge-base").download(storagePath);
      fileData = fallback.data;
      dlErr = fallback.error;
    }
    if (dlErr || !fileData) throw new Error("Chunk download failed: " + (dlErr?.message || "Object not found"));
    chunkPdfBase64 = toBase64(await fileData.arrayBuffer());
  }

  console.log(`Chunk: extracting pages ${chunkStart}-${chunkEnd}`);

  // Detect if this chunk likely contains scanned/image-only pages
  const isLikelyScanned = overviewData?.is_scanned === true || overviewData?.document_type === "scanned_catalog";
  const hasPriceTables = overviewData?.has_price_tables === true;
  const priceTableType = overviewData?.price_table_type || "none";
  const detectedLang = overviewData?.language_hint || overviewData?.language || "auto-detect";

  // Language-specific OCR instructions
  const LANG_OCR_HINTS: Record<string, string> = {
    "pt": "O documento está em PORTUGUÊS. Lê e extrai todo o texto em português, incluindo acentos e caracteres especiais (ã, õ, ç, é, etc.).",
    "es": "El documento está en ESPAÑOL. Lee y extrae todo el texto en español, incluyendo acentos y caracteres especiales (ñ, á, é, í, ó, ú, ü).",
    "en": "The document is in ENGLISH. Read and extract all text in English accurately.",
    "fr": "Le document est en FRANÇAIS. Lis et extrais tout le texte en français, y compris les accents et caractères spéciaux (é, è, ê, ë, à, â, ç, ô, û, etc.).",
    "de": "Das Dokument ist auf DEUTSCH. Lies und extrahiere den gesamten Text auf Deutsch, einschließlich Umlaute und Sonderzeichen (ä, ö, ü, ß).",
    "it": "Il documento è in ITALIANO. Leggi ed estrai tutto il testo in italiano, inclusi accenti e caratteri speciali (à, è, é, ì, ò, ù).",
    "nl": "Het document is in het NEDERLANDS. Lees en extraheer alle tekst in het Nederlands nauwkeurig.",
    "pl": "Dokument jest w języku POLSKIM. Przeczytaj i wyodrębnij cały tekst po polsku, w tym znaki specjalne (ą, ć, ę, ł, ń, ó, ś, ź, ż).",
    "zh": "文档为中文。请准确读取并提取所有中文文本，包括简体和繁体字符。",
    "ja": "ドキュメントは日本語です。漢字、ひらがな、カタカナを含むすべてのテキストを正確に読み取り、抽出してください。",
    "ko": "문서는 한국어입니다. 한글 텍스트를 정확하게 읽고 추출하세요.",
    "ar": "الوثيقة باللغة العربية. اقرأ واستخرج كل النص بالعربية بدقة، بما في ذلك التشكيل.",
    "tr": "Belge TÜRKÇE dilindedir. Tüm Türkçe metni, özel karakterler (ç, ğ, ı, ö, ş, ü) dahil olmak üzere doğru bir şekilde okuyun ve çıkarın.",
    "ru": "Документ на РУССКОМ языке. Прочитайте и извлеките весь текст на русском языке точно.",
  };

  const langHint = LANG_OCR_HINTS[detectedLang] || (detectedLang !== "auto-detect" ? `The document language is: ${detectedLang}. Extract all text accurately in this language, preserving special characters and diacritics.` : "");

  let aiResult: any;
  try {
    const systemPrompts: string[] = [];
    if (isLikelyScanned) {
      systemPrompts.push("És um especialista em OCR e extração de dados de catálogos digitalizados (scanned). Usa a tua capacidade de visão para LER TODO o texto visível nas imagens das páginas, incluindo texto em tabelas, cabeçalhos, rodapés e notas. Extrai TODOS os produtos com máxima precisão.");
    } else {
      systemPrompts.push("És um especialista em extração de dados de catálogos. Extrai TODOS os produtos deste catálogo PDF. Sê rigoroso e sistemático.");
    }
    if (langHint) {
      systemPrompts.push(`IDIOMA DO DOCUMENTO: ${langHint}`);
    }
    if (hasPriceTables) {
      systemPrompts.push("IMPORTANTE: Este documento contém tabelas de preços estruturadas. Deves extrair TODA a informação de preços incluindo: preços unitários, preços por quantidade/escalão (tiered pricing), descontos por volume, preços por embalagem, e quaisquer condições especiais de preço. Cada linha de preço deve ser capturada como um produto ou variante separado.");
    }
    aiResult = await directAICall({
      systemPrompt: systemPrompts.join("\n\n"),
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:application/pdf;base64,${chunkPdfBase64}` } },
          {
            type: "text",
            text: `${isLikelyScanned ? "[MODO OCR] Este PDF é digitalizado/escaneado. Usa visão para ler TODO o texto nas imagens.\n\n" : ""}${langHint ? `[IDIOMA: ${detectedLang.toUpperCase()}] ${langHint}\n\n` : ""}${hasPriceTables ? `[MODO TABELA DE PREÇOS - Tipo: ${priceTableType}] Este documento contém tabelas de preços. Extrai TODOS os preços, incluindo escalões de quantidade e descontos.\n\n` : ""}Extrai TODOS os produtos das páginas ${chunkStart} a ${chunkEnd} deste PDF.
Idioma: ${detectedLang}
Fornecedor: ${overviewData?.supplier_name || "desconhecido"}

IMPORTANT: All product titles, descriptions, categories and text fields MUST be extracted in the ORIGINAL LANGUAGE of the document (${detectedLang}). Do NOT translate to any other language.

Para cada produto devolve:
- sku, title, description, price (number), currency, category, dimensions, weight, material, color_options (array), technical_specs (object), confidence (0-100)
- detected_language: the ISO 639-1 language code of the extracted text (e.g. "pt", "en", "fr", "de", "es", "it", "zh", "ja", "ar")
- is_scanned: true se o texto foi extraído por OCR de uma imagem digitalizada
- pricing (objeto de preços estruturado, se aplicável):
  - unit_price: preço unitário base (number)
  - currency: moeda (string, ex: "EUR")
  - price_tiers: array de escalões de preço por quantidade [{"min_qty":N,"max_qty":N,"price":N,"discount_pct":N}]
  - bulk_price: preço para grandes quantidades (number)
  - pack_size: tamanho da embalagem (number)
  - pack_price: preço por embalagem (number)
  - rrp: preço recomendado de venda ao público (number)
  - margin_pct: margem percentual (number)
  - price_notes: notas adicionais sobre preço (string)
- images (array de objetos): Para CADA imagem de produto visível na página, indica:
  - image_description: descrição detalhada do que a imagem mostra (ângulo do produto, contexto, estilo)
  - alt_text: texto alternativo otimizado para SEO (máx 125 caracteres)
  - image_type: "product_photo"|"technical_drawing"|"lifestyle"|"packaging"|"detail_closeup"|"color_swatch"|"dimension_diagram"
  - position_on_page: "top"|"middle"|"bottom"|"left"|"right"|"center"
  - estimated_size: "small"|"medium"|"large"|"full_width"
  - contains_text: boolean (se a imagem tem texto sobreposto)
  - background: "white"|"transparent"|"lifestyle"|"colored"|"studio"

Formato JSON:
{"pages":[{"page_number":N,"page_type":"product_listing"|"price_list","is_scanned":bool,"detected_language":"xx","ocr_text":"raw OCR text if scanned","has_price_table":bool,"zones":["header","table","images","price_grid"],"section_title":"...","page_images_count":N,"products":[{...}]}]}
Devolve APENAS JSON válido.`,
          },
        ],
      }],
      model: "gemini-2.5-flash",
      maxTokens: 16000,
    });
  } catch (err) {
    console.error(`Chunk ${chunkStart}-${chunkEnd} AI failed:`, (err as Error).message);
    return new Response(JSON.stringify({
      error: "AI call failed", pagesProcessed: 0, tablesCreated: 0, rowsExtracted: 0, confidenceSum: 0,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let aiPayload: any = {};
  try {
    const content = aiResult.choices?.[0]?.message?.content || "{}";
    aiPayload = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
  } catch {
    console.error(`Chunk ${chunkStart}-${chunkEnd} returned non-JSON AI payload`);
    aiPayload = {};
  }

  const content = aiPayload?.choices?.[0]?.message?.content || "{}";
  let result: any = { pages: [] };
  try {
    result = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
  } catch {
    try {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) result = JSON.parse(m[0]);
    } catch {
      console.warn(`Chunk ${chunkStart}-${chunkEnd} returned unparsable content`);
      result = { pages: [] };
    }
  }

  const pages = result.pages || [];
  let pagesProcessed = 0;
  let tablesCreated = 0;
  let rowsExtracted = 0;
  let confidenceSum = 0;

  for (let p = chunkStart; p <= chunkEnd; p++) {
    const pageData = pages.find((pg: any) => pg.page_number === p);
    const products = pageData?.products || [];
    const zones = (pageData?.zones || []).map((z: string) => ({ type: z, content_summary: `${z} zone` }));

    const pageConfidence = products.length > 0
      ? Math.round(products.reduce((s: number, pr: any) => s + (pr.confidence || 70), 0) / products.length)
      : 30;
    confidenceSum += pageConfidence;

    const readableText = products.map((prod: any, i: number) => {
      const parts = [`[Product ${i + 1}]`];
      if (prod.sku) parts.push(`SKU: ${prod.sku}`);
      if (prod.title) parts.push(`Title: ${prod.title}`);
      if (prod.description) parts.push(`Description: ${prod.description}`);
      if (prod.price) parts.push(`Price: ${prod.currency || "€"}${prod.price}`);
      // Include structured pricing
      if (prod.pricing) {
        const pr = prod.pricing;
        if (pr.unit_price) parts.push(`Unit Price: ${pr.currency || "€"}${pr.unit_price}`);
        if (pr.rrp) parts.push(`RRP: ${pr.currency || "€"}${pr.rrp}`);
        if (pr.pack_size && pr.pack_price) parts.push(`Pack: ${pr.pack_size}x → ${pr.currency || "€"}${pr.pack_price}`);
        if (pr.bulk_price) parts.push(`Bulk Price: ${pr.currency || "€"}${pr.bulk_price}`);
        if (pr.margin_pct) parts.push(`Margin: ${pr.margin_pct}%`);
        if (Array.isArray(pr.price_tiers) && pr.price_tiers.length > 0) {
          parts.push(`Price Tiers:`);
          pr.price_tiers.forEach((t: any) => {
            const range = t.max_qty ? `${t.min_qty}-${t.max_qty}` : `${t.min_qty}+`;
            const disc = t.discount_pct ? ` (-${t.discount_pct}%)` : "";
            parts.push(`  ${range} units: ${pr.currency || "€"}${t.price}${disc}`);
          });
        }
        if (pr.price_notes) parts.push(`Price Notes: ${pr.price_notes}`);
      }
      if (prod.category) parts.push(`Category: ${prod.category}`);
      if (prod.dimensions) parts.push(`Dimensions: ${prod.dimensions}`);
      if (prod.material) parts.push(`Material: ${prod.material}`);
      // Include image details
      const images = prod.images || [];
      if (images.length > 0) {
        parts.push(`Images (${images.length}):`);
        images.forEach((img: any, idx: number) => {
          parts.push(`  [Image ${idx + 1}] ${img.image_type || "photo"}: ${img.image_description || "N/A"}`);
          if (img.alt_text) parts.push(`    Alt: ${img.alt_text}`);
        });
      } else if (prod.image_description) {
        parts.push(`Image: ${prod.image_description}`);
      }
      return parts.join("\n");
    }).join("\n\n");

    // Collect all image metadata for the page
    const pageImages = products.flatMap((prod: any, pi: number) => {
      const images = prod.images || [];
      if (images.length > 0) {
        return images.map((img: any, ii: number) => ({
          product_index: pi,
          product_sku: prod.sku,
          product_title: prod.title,
          image_index: ii,
          ...img,
        }));
      }
      if (prod.image_description) {
        return [{
          product_index: pi,
          product_sku: prod.sku,
          product_title: prod.title,
          image_index: 0,
          image_description: prod.image_description,
          alt_text: prod.image_description?.substring(0, 125),
          image_type: "product_photo",
        }];
      }
      return [];
    });

    const pageIsScanned = pageData?.is_scanned === true || isLikelyScanned;
    const ocrText = pageData?.ocr_text || "";

    const { data: pageRecord } = await supabase.from("pdf_pages").insert({
      extraction_id: extractionId,
      page_number: p,
      raw_text: readableText || ocrText || `[Page ${p} - no products]`,
      has_tables: products.length > 0,
      has_images: pageImages.length > 0,
      confidence_score: pageConfidence,
      status: "extracted" as any,
      zones, layout_zones: zones,
      is_scanned: pageIsScanned,
      ocr_text: pageIsScanned ? (ocrText || readableText) : null,
      page_context: {
        page_type: pageData?.page_type,
        section_title: pageData?.section_title,
        product_count: products.length,
        image_count: pageImages.length,
        language: overviewData?.language,
        supplier: overviewData?.supplier_name,
        is_scanned: pageIsScanned,
        extraction_method: pageIsScanned ? "ocr_vision" : "ai_vision",
      },
      vision_result: { products, page_type: pageData?.page_type, images: pageImages },
      text_result: { extraction_method: pageIsScanned ? "ocr_vision" : "ai_vision", language: overviewData?.language },
    }).select("id").single();

    if (pageRecord && products.length > 0) {
      // Detect if this page is a pricing table
      const hasPricingData = products.some((prod: any) => prod.pricing && (prod.pricing.unit_price || prod.pricing.price_tiers?.length > 0 || prod.pricing.bulk_price));
      const isPriceListPage = pageData?.page_type === "price_list" || pageData?.has_price_table === true;
      const detectedTableType = (hasPricingData || isPriceListPage) ? "pricing_table" : "product_table";

      // Build headers dynamically — add pricing columns when pricing data exists
      const baseHeaders = ["sku", "title", "description", "price", "category", "dimensions", "weight", "material", "image_description", "image_alt_text", "image_type", "image_count"];
      const baseColTypes = ["sku", "title", "description", "price", "category", "dimensions", "weight", "material", "image_url", "alt_text", "image_type", "count"];

      const pricingHeaders = hasPricingData ? ["unit_price", "rrp", "pack_size", "pack_price", "bulk_price", "margin_pct", "price_tiers", "price_notes"] : [];
      const pricingColTypes = hasPricingData ? ["price", "price", "quantity", "price", "price", "percentage", "pricing_tiers", "notes"] : [];

      const headers = [...baseHeaders, ...pricingHeaders];
      const colTypes = [...baseColTypes, ...pricingColTypes];

      const tableRows = products.map((prod: any, ri: number) => {
        const images = prod.images || [];
        const primaryImage = images[0] || {};
        const pricing = prod.pricing || {};
        return {
          row_index: ri,
          cells: headers.map((h, ci) => {
            let value = "";
            if (h === "price") value = prod.price ? `${prod.currency || "€"}${prod.price}` : "";
            else if (h === "image_description") value = primaryImage.image_description || prod.image_description || "";
            else if (h === "image_alt_text") value = primaryImage.alt_text || prod.image_description?.substring(0, 125) || "";
            else if (h === "image_type") value = primaryImage.image_type || "";
            else if (h === "image_count") value = images.length.toString();
            else if (h === "unit_price") value = pricing.unit_price ? `${pricing.currency || "€"}${pricing.unit_price}` : "";
            else if (h === "rrp") value = pricing.rrp ? `${pricing.currency || "€"}${pricing.rrp}` : "";
            else if (h === "pack_size") value = pricing.pack_size ? String(pricing.pack_size) : "";
            else if (h === "pack_price") value = pricing.pack_price ? `${pricing.currency || "€"}${pricing.pack_price}` : "";
            else if (h === "bulk_price") value = pricing.bulk_price ? `${pricing.currency || "€"}${pricing.bulk_price}` : "";
            else if (h === "margin_pct") value = pricing.margin_pct ? `${pricing.margin_pct}%` : "";
            else if (h === "price_tiers") value = Array.isArray(pricing.price_tiers) && pricing.price_tiers.length > 0 ? JSON.stringify(pricing.price_tiers) : "";
            else if (h === "price_notes") value = pricing.price_notes || "";
            else value = (prod[h] ?? "").toString();
            return { value, confidence: prod.confidence || 70, source: "ai_vision", header: h, semantic_type: colTypes[ci], validation_passed: !!value };
          }),
        };
      });

      const columnClassifications = headers.map((h, i) => ({
        index: i, header: h, semantic_type: colTypes[i], confidence: 85, source: "ai_vision",
      }));

      const { data: tableRec } = await supabase.from("pdf_tables").insert({
        page_id: pageRecord.id,
        table_index: tablesCreated,
        headers, rows: tableRows,
        confidence_score: pageConfidence,
        row_count: tableRows.length,
        col_count: headers.length,
        table_type: detectedTableType,
        column_classifications: columnClassifications,
        vision_source_data: { products, images: pageImages, pricing_detected: hasPricingData },
      }).select("id").single();

      if (tableRec) {
        const rowInserts = tableRows.map((r: any) => ({
          table_id: tableRec.id,
          row_index: r.row_index,
          cells: r.cells, vision_cells: r.cells, reconciled_cells: r.cells,
          row_context: { section: pageData?.section_title, supplier: overviewData?.supplier_name },
          mapping_confidence: r.cells.reduce((s: number, c: any) => s + c.confidence, 0) / Math.max(r.cells.length, 1),
          status: "unmapped" as any,
        }));
        await supabase.from("pdf_table_rows").insert(rowInserts);
        rowsExtracted += rowInserts.length;
      }
      tablesCreated++;
    }
    pagesProcessed++;
  }

  return new Response(JSON.stringify({
    pagesProcessed, tablesCreated, rowsExtracted, confidenceSum,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}
