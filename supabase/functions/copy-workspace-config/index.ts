import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Copies AI providers, routing rules, prompt templates and categories
 * from a source workspace to a newly created target workspace.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { sourceWorkspaceId, targetWorkspaceId, copyProviders, copyRouting, copyPrompts, copyCategories } = await req.json();

    if (!sourceWorkspaceId || !targetWorkspaceId) {
      return new Response(JSON.stringify({ error: "sourceWorkspaceId e targetWorkspaceId são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stats = { providers: 0, routing: 0, prompts: 0, categories: 0 };

    // 1. Copy AI Providers
    if (copyProviders) {
      const { data: providers } = await supabase
        .from("ai_providers")
        .select("*")
        .eq("workspace_id", sourceWorkspaceId);

      if (providers?.length) {
        const providerIdMap = new Map<string, string>();
        for (const p of providers) {
          const oldId = p.id;
          const { id: _, created_at: _c, updated_at: _u, ...rest } = p;
          const { data: newP } = await supabase
            .from("ai_providers")
            .insert({ ...rest, workspace_id: targetWorkspaceId })
            .select("id")
            .single();
          if (newP) {
            providerIdMap.set(oldId, newP.id);
            stats.providers++;
          }
        }

        // 2. Copy Routing Rules (depends on provider IDs)
        if (copyRouting) {
          const { data: rules } = await supabase
            .from("ai_routing_rules")
            .select("*")
            .eq("workspace_id", sourceWorkspaceId);

          if (rules?.length) {
            for (const r of rules) {
              const { id: _, created_at: _c, updated_at: _u, ...rest } = r;
              await supabase.from("ai_routing_rules").insert({
                ...rest,
                workspace_id: targetWorkspaceId,
                provider_id: r.provider_id ? (providerIdMap.get(r.provider_id) || null) : null,
                fallback_provider_id: r.fallback_provider_id ? (providerIdMap.get(r.fallback_provider_id) || null) : null,
              });
              stats.routing++;
            }
          }
        }
      }
    }

    // 3. Copy Prompt Templates
    if (copyPrompts) {
      const { data: templates } = await supabase
        .from("prompt_templates")
        .select("*")
        .eq("workspace_id", sourceWorkspaceId)
        .eq("is_active", true);

      if (templates?.length) {
        for (const t of templates) {
          const { id: _, created_at: _c, updated_at: _u, archived_at: _a, ...rest } = t;
          await supabase.from("prompt_templates").insert({
            ...rest,
            workspace_id: targetWorkspaceId,
          });
          stats.prompts++;
        }
      }
    }

    // 4. Copy Categories (preserving hierarchy)
    if (copyCategories) {
      const { data: cats } = await supabase
        .from("categories")
        .select("*")
        .eq("workspace_id", sourceWorkspaceId)
        .order("sort_order", { ascending: true });

      if (cats?.length) {
        const catIdMap = new Map<string, string>();

        // First pass: top-level categories (no parent)
        const topLevel = cats.filter(c => !c.parent_id);
        const nested = cats.filter(c => !!c.parent_id);

        for (const c of topLevel) {
          const oldId = c.id;
          const { id: _, created_at: _c, updated_at: _u, ...rest } = c;
          const { data: newC } = await supabase
            .from("categories")
            .insert({ ...rest, workspace_id: targetWorkspaceId, parent_id: null })
            .select("id")
            .single();
          if (newC) {
            catIdMap.set(oldId, newC.id);
            stats.categories++;
          }
        }

        // Second pass: nested categories
        for (const c of nested) {
          const oldId = c.id;
          const { id: _, created_at: _c, updated_at: _u, ...rest } = c;
          const newParentId = c.parent_id ? (catIdMap.get(c.parent_id) || null) : null;
          const { data: newC } = await supabase
            .from("categories")
            .insert({ ...rest, workspace_id: targetWorkspaceId, parent_id: newParentId })
            .select("id")
            .single();
          if (newC) {
            catIdMap.set(oldId, newC.id);
            stats.categories++;
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
