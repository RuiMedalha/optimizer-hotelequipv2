import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MAX_PROCESSING_MS = 95_000; // keep safe headroom before timeout
const CONCURRENCY = 4; // raised from 2 → 4 (≈2× throughput; Lovable AI Gateway tolerates this)
const SELF_INVOKE_RETRIES = 5;
const TERMINAL_JOB_STATUSES = new Set(["completed", "cancelled", "failed"]);

const TELEGRAM_API_URL = "https://api.telegram.org";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendTelegramNotification(chatId: string, message: string) {
  try {
    const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");
    if (!TELEGRAM_API_KEY) {
      console.warn("TELEGRAM_API_KEY not configured, skipping notification");
      return;
    }
    const response = await fetch(`${TELEGRAM_API_URL}/bot${TELEGRAM_API_KEY}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      console.warn(`Telegram notification failed [${response.status}]: ${errText}`);
    } else {
      console.log("📨 Telegram notification sent");
    }
  } catch (err: unknown) {
    console.warn("Telegram notification error (non-fatal):", err);
  }
}

async function selfInvokeWithRetry(authHeader: string, jobId: string, startIndex: number) {
  const payload = JSON.stringify({ jobId, startIndex });

  for (let attempt = 1; attempt <= SELF_INVOKE_RETRIES; attempt++) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/optimize-batch`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: payload,
      });

      if (response.ok) return true;

      const isRetryable = response.status === 429 || response.status >= 500;
      if (!isRetryable) {
        const body = await response.text();
        console.error(`Self-invoke non-retryable error: ${response.status} ${body}`);
        return false;
      }

      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
      console.warn(`Self-invoke retry ${attempt}/${SELF_INVOKE_RETRIES} in ${delayMs}ms`);
      await sleep(delayMs);
    } catch (err: unknown) {
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
      console.warn(`Self-invoke exception retry ${attempt}/${SELF_INVOKE_RETRIES} in ${delayMs}ms`, err);
      await sleep(delayMs);
    }
  }

  return false;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const { jobId, startIndex } = body;
    const requestedStartIndex = Number.isInteger(startIndex) && startIndex >= 0 ? startIndex : undefined;

    // Workspace membership check for new jobs
    if (!jobId && body.workspaceId) {
      const adminClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {});
      const { data: memberCheck } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", body.workspaceId)
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();
      // Hybrid: allow if member with editor+ OR legacy owner
      if (memberCheck) {
        const rank = { owner: 4, admin: 3, editor: 2, viewer: 1 }[memberCheck.role] || 0;
        if (rank < 2) {
          return new Response(JSON.stringify({ error: "Sem permissão para otimizar neste workspace (mínimo: editor)" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      // If no memberCheck, fallback to legacy RLS (backward compat)
    }

    let job: any;

    if (jobId) {
      // Resume existing job
      const { data, error } = await supabase
        .from("optimization_jobs")
        .select("*")
        .eq("id", jobId)
        .single();
      if (error || !data) {
        return new Response(JSON.stringify({ error: "Job not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      job = data;
      const resolvedProcessedProducts = job.processed_products || 0;
      const isTerminalJob = TERMINAL_JOB_STATUSES.has(job.status)
        || resolvedProcessedProducts >= (job.total_products || 0)
        || !!job.completed_at;

      if (isTerminalJob) {
        const terminalStatus = TERMINAL_JOB_STATUSES.has(job.status) ? job.status : "completed";
        return new Response(JSON.stringify({ status: terminalStatus, jobId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (job.status === "queued") {
        await supabase
          .from("optimization_jobs")
          .update({ status: "processing", updated_at: new Date().toISOString(), error_message: null })
          .eq("id", job.id);

        job = {
          ...job,
          status: "processing",
          error_message: null,
        };
      }
    } else {
      // Create new job and return immediately (background kickoff)
      const {
        productIds,
        selectedPhases,
        fieldsToOptimize,
        modelOverride,
        workspaceId,
        skipKnowledge,
        skipScraping,
        skipReranking,
        includeUsoProfissional,
        usoProfissionalRouting,
        includeImageProcessing,
        promptTemplateId,
        imagePromptTemplateId,
      } = body;

      if (!Array.isArray(productIds) || productIds.length === 0) {
        return new Response(JSON.stringify({ error: "productIds é obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await supabase
        .from("optimization_jobs")
        .insert({
          user_id: userId,
          workspace_id: workspaceId || null,
          product_ids: productIds,
          total_products: productIds.length,
          status: "processing",
          selected_phases: selectedPhases || [],
          fields_to_optimize: fieldsToOptimize || [],
          model_override: modelOverride || null,
          started_at: new Date().toISOString(),
          results: JSON.parse(JSON.stringify({ skipKnowledge, skipScraping, skipReranking, includeUsoProfissional: !!includeUsoProfissional, usoProfissionalRouting: usoProfissionalRouting || null, includeImageProcessing: !!includeImageProcessing, promptTemplateId: promptTemplateId || null, imagePromptTemplateId: imagePromptTemplateId || null })),
        })
        .select("id")
        .single();

      if (error || !data?.id) throw error || new Error("Failed to create job");

      console.log(`🚀 Job ${data.id} created: ${productIds.length} products, concurrency ${CONCURRENCY}`);

      // Fire-and-forget worker invocation (same function in resume mode)
      fetch(`${SUPABASE_URL}/functions/v1/optimize-batch`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jobId: data.id, startIndex: 0 }),
      }).catch((err) => console.error("Initial worker invoke failed:", err));

      return new Response(
        JSON.stringify({
          status: "queued",
          jobId: data.id,
          totalProducts: productIds.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // === STRATEGY B: Pre-cache common data ONCE ===
    // Fetch product names for progress updates
    const { data: productData } = await supabase
      .from("products")
      .select("id, original_title, optimized_title, sku")
      .in("id", job.product_ids);

    const productNameMap: Record<string, string> = {};
    (productData || []).forEach((p: any) => {
      productNameMap[p.id] = p.optimized_title || p.original_title || p.sku || p.id.slice(0, 8);
    });

    // Determine phases to process
    const PHASE_CONFIGS = [
      { phase: 1, fields: ["title", "description", "short_description", "tags", "category"] },
      { phase: 2, fields: ["meta_title", "meta_description", "seo_slug", "faq", "image_alt"] },
      { phase: 3, fields: ["price", "upsells", "crosssells"] },
    ];

    const selectedPhases = job.selected_phases?.length > 0
      ? PHASE_CONFIGS.filter((p) => job.selected_phases.includes(p.phase))
      : [{ phase: 0, fields: [] }]; // phase 0 = all fields

    const allProductIds: string[] = job.product_ids;
    const startTime = Date.now();
    let currentIndex = Math.max(requestedStartIndex ?? (job.processed_products || 0), 0);
    let totalProcessed = job.processed_products || 0;
    let totalFailed = job.failed_products || 0;
    let halfNotified = totalProcessed >= Math.floor(allProductIds.length / 2); // skip if already past 50%

    // Fetch Telegram chat_id for notifications
    const { data: telegramSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "telegram_chat_id")
      .eq("user_id", userId)
      .maybeSingle();
    const telegramChatId = telegramSetting?.value || null;

    console.log(`📦 Processing from index ${currentIndex}, ${allProductIds.length - currentIndex} remaining`);

    // === STRATEGY D: Process products in parallel batches of CONCURRENCY ===
    while (currentIndex < allProductIds.length) {
      // Check timeout — strategy A: self-invoke to continue
      if (Date.now() - startTime > MAX_PROCESSING_MS) {
        console.log(`⏱️ Timeout approaching at index ${currentIndex}, self-invoking to continue...`);

        const continued = await selfInvokeWithRetry(authHeader, job.id, currentIndex);

        if (!continued) {
          await supabase
            .from("optimization_jobs")
            .update({
              status: "queued",
              error_message: "Job pausado por rate limit temporário; wakeup automático irá retomar.",
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          return new Response(
            JSON.stringify({
              status: "paused",
              jobId: job.id,
              processedSoFar: totalProcessed,
              nextIndex: currentIndex,
            }),
            { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            status: "continuing",
            jobId: job.id,
            processedSoFar: totalProcessed,
            nextIndex: currentIndex,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check if job was cancelled
      const { data: jobCheck } = await supabase
        .from("optimization_jobs")
        .select("status")
        .eq("id", job.id)
        .single();

      if (jobCheck?.status === "cancelled") {
        console.log(`❌ Job ${job.id} cancelled at index ${currentIndex}`);
        break;
      }

      // Get batch of products
      const batchIds = allProductIds.slice(currentIndex, currentIndex + CONCURRENCY);
      const batchName = productNameMap[batchIds[0]] || `Produto ${currentIndex + 1}`;

      // Mark batch as processing in products table (best effort)
      await supabase
        .from("products")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .in("id", batchIds);

      // Update job progress (realtime will push this to frontend)
      await supabase
        .from("optimization_jobs")
        .update({
          current_product_name: batchName,
          processed_products: totalProcessed,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      // Process batch in parallel — each call to optimize-product handles one product
      // For each product, process all selected phases sequentially
      // Extract speed flags from job results (stored at creation)
      const jobFlags = (typeof job.results === 'object' && !Array.isArray(job.results)) ? job.results as any : {};
      const speedFlags = {
        skipKnowledge: jobFlags.skipKnowledge || false,
        skipScraping: jobFlags.skipScraping || false,
        skipReranking: jobFlags.skipReranking || false,
      };
      const jobIncludeUsoProfissional = jobFlags.includeUsoProfissional || false;
      const jobUsoProfissionalRouting = jobFlags.usoProfissionalRouting || { inDescription: true, inCustomField: false };
      const jobIncludeImageProcessing = jobFlags.includeImageProcessing || false;
      const jobPromptTemplateId = jobFlags.promptTemplateId || null;
      const jobImagePromptTemplateId = jobFlags.imagePromptTemplateId || null;

      const batchResults = await Promise.allSettled(
        batchIds.map(async (productId) => {
          const itemStartedAt = new Date().toISOString();
          const itemStartMs = Date.now();
          let productOk = false;
          let lastError = "";
          let usoStatus: string | null = null;
          for (const phaseConfig of selectedPhases) {
            try {
              const callBody: any = {
                productIds: [productId],
                workspaceId: job.workspace_id,
                modelOverride: job.model_override,
                ...(jobPromptTemplateId ? { promptTemplateId: jobPromptTemplateId } : {}),
                ...speedFlags,
              };

              if (phaseConfig.phase === 0) {
                if (job.fields_to_optimize?.length > 0) {
                  callBody.fieldsToOptimize = job.fields_to_optimize;
                }
              } else {
                callBody.phase = phaseConfig.phase;
                if (job.fields_to_optimize?.length > 0) {
                  callBody.fieldsToOptimize = phaseConfig.fields.filter(
                    (f: string) => job.fields_to_optimize.includes(f)
                  );
                } else {
                  callBody.fieldsToOptimize = phaseConfig.fields;
                }
              }

              const response = await fetch(
                `${SUPABASE_URL}/functions/v1/optimize-product`,
                {
                  method: "POST",
                  headers: {
                    Authorization: authHeader,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(callBody),
                }
              );

              if (!response.ok) {
                const errText = await response.text();
                console.error(`Product ${productId} phase ${phaseConfig.phase} failed: ${response.status} ${errText}`);
                lastError = errText;
                // Write job item for error
                await supabase.from("optimization_job_items").insert({
                  job_id: job.id,
                  product_id: productId,
                  status: "error",
                  fields_optimized: callBody.fieldsToOptimize || [],
                  model_used: job.model_override || null,
                  started_at: itemStartedAt,
                  completed_at: new Date().toISOString(),
                  duration_ms: Date.now() - itemStartMs,
                  error_message: errText.substring(0, 500),
                });
                return { productId, status: "error", error: errText };
              }

              const data = await response.json();
              if (data.error) {
                const dataError = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
                lastError = dataError;
                await supabase.from("optimization_job_items").insert({
                  job_id: job.id,
                  product_id: productId,
                  status: "error",
                  fields_optimized: callBody.fieldsToOptimize || [],
                  model_used: job.model_override || null,
                  started_at: itemStartedAt,
                  completed_at: new Date().toISOString(),
                  duration_ms: Date.now() - itemStartMs,
                  error_message: dataError.substring(0, 500),
                });
                return { productId, status: "error", error: dataError };
              }

              const resultItems = Array.isArray(data?.results) ? data.results : [];
              if (resultItems.length === 0) {
                lastError = "optimize-product returned 200 with empty or missing results";
                await supabase.from("optimization_job_items").insert({
                  job_id: job.id,
                  product_id: productId,
                  status: "error",
                  fields_optimized: callBody.fieldsToOptimize || [],
                  model_used: job.model_override || null,
                  started_at: itemStartedAt,
                  completed_at: new Date().toISOString(),
                  duration_ms: Date.now() - itemStartMs,
                  error_message: lastError.substring(0, 500),
                });
                return { productId, status: "error", error: lastError };
              }

              const errorItems = resultItems.filter((r: any) => r?.status === "error");
              if (errorItems.length > 0) {
                const firstError = errorItems.find((r: any) => typeof r?.error === "string")?.error;
                lastError = firstError || "optimize-product returned item-level errors";
                await supabase.from("optimization_job_items").insert({
                  job_id: job.id,
                  product_id: productId,
                  status: "error",
                  fields_optimized: callBody.fieldsToOptimize || [],
                  model_used: job.model_override || null,
                  started_at: itemStartedAt,
                  completed_at: new Date().toISOString(),
                  duration_ms: Date.now() - itemStartMs,
                  error_message: lastError.substring(0, 500),
                });
                return { productId, status: "error", error: lastError };
              }

              productOk = resultItems.length > 0 && errorItems.length === 0;
            } catch (err: any) {
              console.error(`Product ${productId} phase ${phaseConfig.phase} error:`, (err as Error).message);
              lastError = (err as Error).message;
              await supabase.from("optimization_job_items").insert({
                job_id: job.id,
                product_id: productId,
                status: "error",
                started_at: itemStartedAt,
                completed_at: new Date().toISOString(),
                duration_ms: Date.now() - itemStartMs,
                error_message: (err as Error).message?.substring(0, 500),
              });
              return { productId, status: "error", error: (err as Error).message };
            }
          }

          // After all phases, call generate-uso-profissional if enabled
          if (productOk && jobIncludeUsoProfissional) {
            try {
              const productInfo = productData?.find((p: any) => p.id === productId);
              const { data: fullProduct } = await supabase
                .from("products")
                .select("optimized_title, original_title, optimized_description, original_description, category, attributes")
                .eq("id", productId)
                .maybeSingle();

              const usoProfBody = {
                workspaceId: job.workspace_id,
                productId,
                productTitle: fullProduct?.optimized_title || fullProduct?.original_title || productInfo?.optimized_title || productInfo?.original_title || "Produto",
                productDescription: fullProduct?.optimized_description || fullProduct?.original_description || "",
                productCategory: fullProduct?.category || "",
                productAttributes: fullProduct?.attributes || [],
              };

              const usoResponse = await fetch(
                `${SUPABASE_URL}/functions/v1/generate-uso-profissional`,
                {
                  method: "POST",
                  headers: {
                    Authorization: authHeader,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(usoProfBody),
                }
              );

              if (!usoResponse.ok) {
                const errText = await usoResponse.text();
                console.warn(`Uso Profissional for ${productId} failed: ${usoResponse.status} ${errText}`);
                usoStatus = `failed: ${usoResponse.status}`;
              } else {
                // Save the result to product_uso_profissional table
                const usoResult = await usoResponse.json();
                if (usoResult && usoResult.intro) {
                  const serviceClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
                  const { data: savedUso, error: saveUsoError } = await serviceClient
                    .from("product_uso_profissional")
                    .upsert({
                      product_id: productId,
                      workspace_id: job.workspace_id,
                      intro: usoResult.intro || null,
                      use_cases: usoResult.useCases || [],
                      professional_tips: usoResult.professionalTips || [],
                      target_profiles: usoResult.targetProfiles || [],
                      generated_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                      publish_enabled: true,
                      routing_in_description: jobUsoProfissionalRouting.inDescription ?? true,
                      routing_in_custom_field: jobUsoProfissionalRouting.inCustomField ?? false,
                    }, { onConflict: "product_id,workspace_id" })
                    .select("id, product_id")
                    .maybeSingle();

                  if (saveUsoError) {
                    console.warn(`Uso Profissional save failed for ${productId}:`, saveUsoError);
                    usoStatus = `save_failed: ${saveUsoError.message?.substring(0, 100)}`;
                  } else {
                    console.log(`📖 Uso Profissional generated & saved for ${productId}`, savedUso);
                    usoStatus = "generated";
                  }
                } else {
                  console.warn(`Uso Profissional for ${productId}: empty result`);
                  usoStatus = "empty_result";
                }
              }
            } catch (usoErr: any) {
              console.warn(`Uso Profissional error for ${productId} (non-fatal):`, usoErr?.message);
              usoStatus = `error: ${usoErr?.message?.substring(0, 100)}`;
            }
          }

          // === SEPARAR IMAGENS DO BATCH (opção 3) ===
          // Disparar fire-and-forget para não bloquear o batch de texto.
          // Texto fica concluído rapidamente; imagens correm em paralelo no
          // process-product-images sem ocupar tempo do worker do optimize-batch.
          // Optimize e lifestyle ficam SEMPRE separados (chamadas independentes).
          if (productOk && jobIncludeImageProcessing) {
            // 1) Otimização/upscale (não bloqueia)
            fetch(`${SUPABASE_URL}/functions/v1/process-product-images`, {
              method: "POST",
              headers: { Authorization: authHeader, "Content-Type": "application/json" },
              body: JSON.stringify({
                productIds: [productId],
                workspaceId: job.workspace_id,
                mode: "optimize",
              }),
            }).then((r) => {
              if (!r.ok) console.warn(`[bg] optimize image ${productId} → ${r.status}`);
              else console.log(`🖼️ [bg] optimize queued for ${productId}`);
            }).catch((e) => console.warn(`[bg] optimize image error ${productId}:`, e?.message));

            // 2) Lifestyle (separado, também fire-and-forget)
            fetch(`${SUPABASE_URL}/functions/v1/process-product-images`, {
              method: "POST",
              headers: { Authorization: authHeader, "Content-Type": "application/json" },
              body: JSON.stringify({
                productIds: [productId],
                workspaceId: job.workspace_id,
                mode: "lifestyle",
                ...(jobImagePromptTemplateId ? { imagePromptTemplateId: jobImagePromptTemplateId } : {}),
              }),
            }).then((r) => {
              if (!r.ok) console.warn(`[bg] lifestyle ${productId} → ${r.status}`);
              else console.log(`🎨 [bg] lifestyle queued for ${productId}`);
            }).catch((e) => console.warn(`[bg] lifestyle error ${productId}:`, e?.message));
          }

          // Write successful job item
          const durationMs = Date.now() - itemStartMs;
          await supabase.from("optimization_job_items").insert({
            job_id: job.id,
            product_id: productId,
            status: productOk ? "done" : "error",
            fields_optimized: job.fields_to_optimize || [],
            model_used: job.model_override || null,
            started_at: itemStartedAt,
            completed_at: new Date().toISOString(),
            duration_ms: durationMs,
            error_message: productOk ? (usoStatus && usoStatus !== "generated" ? `Uso Profissional: ${usoStatus}` : null) : lastError?.substring(0, 500),
          });
          return { productId, status: productOk ? "optimized" : "error", usoStatus };
        })
      );

      // Count results
      for (const result of batchResults) {
        if (result.status === "fulfilled" && result.value.status === "optimized") {
          totalProcessed++;
        } else {
          totalFailed++;
          totalProcessed++;
        }
      }

      currentIndex += batchIds.length;

      // Update progress after each batch
      await supabase
        .from("optimization_jobs")
        .update({
          processed_products: totalProcessed,
          failed_products: totalFailed,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      console.log(`✅ Batch done: ${totalProcessed}/${allProductIds.length} (${totalFailed} failed)`);

      // === 50% Telegram notification ===
      if (!halfNotified && telegramChatId && totalProcessed >= Math.floor(allProductIds.length / 2)) {
        halfNotified = true;
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        await sendTelegramNotification(
          telegramChatId,
          `⏳ <b>Otimização a 50%</b>\n\n📦 ${totalProcessed}/${allProductIds.length} produtos\n❌ ${totalFailed} erro(s)\n⏱️ ${elapsed}s decorridos`
        );
      }
    }

    // Check final status
    const { data: finalJobCheck } = await supabase
      .from("optimization_jobs")
      .select("status")
      .eq("id", job.id)
      .single();

    const finalStatus = finalJobCheck?.status === "cancelled" ? "cancelled" : "completed";
    await supabase
      .from("optimization_jobs")
      .update({
        status: finalStatus,
        processed_products: totalProcessed,
        failed_products: totalFailed,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    console.log(`🏁 Job ${job.id} ${finalStatus}: ${totalProcessed} processed, ${totalFailed} failed`);

    // === Notifications (Telegram + WhatsApp) ===
    const ok = totalProcessed - totalFailed;
    const elapsedSec = Math.round((Date.now() - startTime) / 1000);

    // Telegram
    if (telegramChatId) {
      const msg = finalStatus === "completed"
        ? `✅ <b>Otimização concluída!</b>\n\n📦 ${ok} produto(s) otimizado(s)\n❌ ${totalFailed} erro(s)\n⏱️ Tempo: ${elapsedSec}s`
        : `⚠️ <b>Job cancelado</b>\n\n${totalProcessed} de ${job.total_products} processados`;
      await sendTelegramNotification(telegramChatId, msg);
    }

    // WhatsApp webhook
    try {
      const { data: whatsappSetting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "whatsapp_webhook_url")
        .eq("user_id", userId)
        .maybeSingle();

      if (whatsappSetting?.value) {
        const message = finalStatus === "completed"
          ? `✅ *Otimização concluída!*\n\n📦 ${ok} produto(s) otimizado(s)\n❌ ${totalFailed} erro(s)\n⏱️ Tempo: ${elapsedSec}s`
          : `⚠️ *Job cancelado*\n\n${totalProcessed} de ${job.total_products} processados`;

        await fetch(whatsappSetting.value, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            jobId: job.id,
            status: finalStatus,
            processed: totalProcessed,
            failed: totalFailed,
            timestamp: new Date().toISOString(),
          }),
        });
        console.log("📱 WhatsApp notification sent");
      }
    } catch (whatsErr) {
      console.warn("WhatsApp notification failed (non-fatal):", whatsErr);
    }

    return new Response(
      JSON.stringify({
        status: finalStatus,
        jobId: job.id,
        processed: totalProcessed,
        failed: totalFailed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("optimize-batch error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
