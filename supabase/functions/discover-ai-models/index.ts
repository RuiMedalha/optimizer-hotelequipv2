import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Curated model metadata with pricing, ratings, and descriptions
const MODEL_REGISTRY: Record<string, Record<string, {
  display_name: string;
  description: string;
  cost_input: number;
  cost_output: number;
  speed: number;
  accuracy: number;
  max_context: number | null;
  text: boolean;
  vision: boolean;
  tools: boolean;
  json_schema: boolean;
  structured: boolean;
}>> = {
  gemini_direct: {
    "gemini-2.5-pro": {
      display_name: "Gemini 2.5 Pro",
      description: "Top-tier. Raciocínio complexo, imagens+texto, contextos grandes.",
      cost_input: 1.25, cost_output: 10.0, speed: 6, accuracy: 10, max_context: 1048576,
      text: true, vision: true, tools: true, json_schema: true, structured: true,
    },
    "gemini-2.5-flash": {
      display_name: "Gemini 2.5 Flash",
      description: "Equilíbrio custo/qualidade. Bom para multimodal e raciocínio.",
      cost_input: 0.15, cost_output: 0.60, speed: 9, accuracy: 8, max_context: 1048576,
      text: true, vision: true, tools: true, json_schema: true, structured: true,
    },
    "gemini-2.5-flash-lite": {
      display_name: "Gemini 2.5 Flash Lite",
      description: "Mais rápido e barato. Classificação, sumários, tarefas simples.",
      cost_input: 0.075, cost_output: 0.30, speed: 10, accuracy: 6, max_context: 1048576,
      text: true, vision: true, tools: true, json_schema: true, structured: true,
    },
    "gemini-2.0-flash": {
      display_name: "Gemini 2.0 Flash",
      description: "Geração anterior rápida. Bom para tarefas gerais.",
      cost_input: 0.10, cost_output: 0.40, speed: 9, accuracy: 7, max_context: 1048576,
      text: true, vision: true, tools: true, json_schema: true, structured: true,
    },
  },
  openai_direct: {
    "gpt-4o": {
      display_name: "GPT-4o",
      description: "Multimodal potente. Raciocínio, contexto longo, texto+imagens.",
      cost_input: 2.50, cost_output: 10.0, speed: 7, accuracy: 9, max_context: 128000,
      text: true, vision: true, tools: true, json_schema: true, structured: true,
    },
    "gpt-4o-mini": {
      display_name: "GPT-4o Mini",
      description: "Custo reduzido com boa capacidade multimodal.",
      cost_input: 0.15, cost_output: 0.60, speed: 9, accuracy: 7, max_context: 128000,
      text: true, vision: true, tools: true, json_schema: true, structured: true,
    },
    "gpt-4.1": {
      display_name: "GPT-4.1",
      description: "Coding e instrução. Contexto de 1M tokens.",
      cost_input: 2.00, cost_output: 8.00, speed: 7, accuracy: 9, max_context: 1047576,
      text: true, vision: true, tools: true, json_schema: true, structured: true,
    },
    "gpt-4.1-mini": {
      display_name: "GPT-4.1 Mini",
      description: "Versão compacta do 4.1. Equilíbrio custo/performance.",
      cost_input: 0.40, cost_output: 1.60, speed: 9, accuracy: 7, max_context: 1047576,
      text: true, vision: true, tools: true, json_schema: true, structured: true,
    },
    "gpt-4.1-nano": {
      display_name: "GPT-4.1 Nano",
      description: "Ultra-rápido e barato. Ideal para alto volume.",
      cost_input: 0.10, cost_output: 0.40, speed: 10, accuracy: 6, max_context: 1047576,
      text: true, vision: true, tools: true, json_schema: true, structured: true,
    },
    "o4-mini": {
      display_name: "o4-mini",
      description: "Modelo de raciocínio compacto. STEM e coding.",
      cost_input: 1.10, cost_output: 4.40, speed: 7, accuracy: 9, max_context: 200000,
      text: true, vision: true, tools: true, json_schema: true, structured: true,
    },
  },
  anthropic_direct: {
    "claude-sonnet-4-20250514": {
      display_name: "Claude Sonnet 4",
      description: "Última geração. Raciocínio superior e fiabilidade.",
      cost_input: 3.00, cost_output: 15.00, speed: 7, accuracy: 10, max_context: 200000,
      text: true, vision: true, tools: true, json_schema: true, structured: true,
    },
    "claude-3-7-sonnet-20250219": {
      display_name: "Claude 3.7 Sonnet",
      description: "Raciocínio avançado com modo thinking. Versátil.",
      cost_input: 3.00, cost_output: 15.00, speed: 7, accuracy: 9, max_context: 200000,
      text: true, vision: true, tools: true, json_schema: true, structured: true,
    },
    "claude-3-5-sonnet-20241022": {
      display_name: "Claude 3.5 Sonnet v2",
      description: "Equilíbrio velocidade/inteligência. Versátil e fiável.",
      cost_input: 3.00, cost_output: 15.00, speed: 8, accuracy: 9, max_context: 200000,
      text: true, vision: true, tools: true, json_schema: true, structured: true,
    },
    "claude-3-haiku-20240307": {
      display_name: "Claude 3 Haiku",
      description: "Rápido e económico. Tarefas simples e respostas rápidas.",
      cost_input: 0.25, cost_output: 1.25, speed: 10, accuracy: 6, max_context: 200000,
      text: true, vision: true, tools: true, json_schema: false, structured: false,
    },
    "claude-3-opus-20240229": {
      display_name: "Claude 3 Opus",
      description: "Máxima capacidade. Raciocínio profundo e nuance.",
      cost_input: 15.00, cost_output: 75.00, speed: 5, accuracy: 10, max_context: 200000,
      text: true, vision: true, tools: true, json_schema: true, structured: true,
    },
  },
};

// Validate which models are actually available via the provider API
async function validateModels(providerType: string, apiKey: string): Promise<string[]> {
  const available: string[] = [];
  const registry = MODEL_REGISTRY[providerType] || {};

  if (providerType === "openai_direct") {
    try {
      const resp = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        const apiModels = new Set((data.data || []).map((m: any) => m.id));
        for (const modelId of Object.keys(registry)) {
          if (apiModels.has(modelId)) available.push(modelId);
        }
        return available;
      }
    } catch { /* fall through to return all */ }
  }

  if (providerType === "gemini_direct") {
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
      );
      if (resp.ok) {
        const data = await resp.json();
        const apiModels = new Set((data.models || []).map((m: any) => m.name?.replace("models/", "")));
        for (const modelId of Object.keys(registry)) {
          if (apiModels.has(modelId)) available.push(modelId);
        }
        return available;
      }
    } catch { /* fall through */ }
  }

  // Anthropic doesn't have a public models list endpoint — return all curated
  if (providerType === "anthropic_direct") {
    return Object.keys(registry);
  }

  // Fallback: return all from registry
  return Object.keys(registry);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { workspaceId } = await req.json();
    if (!workspaceId) throw new Error("workspaceId required");

    // Get workspace owner for API key resolution
    const { data: wsData } = await supabase
      .from("workspaces")
      .select("user_id")
      .eq("id", workspaceId)
      .maybeSingle();
    const userId = wsData?.user_id;

    // Get all active providers for this workspace
    const { data: providers } = await supabase
      .from("ai_providers")
      .select("id, provider_type, provider_name")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true);

    if (!providers || providers.length === 0) {
      return new Response(JSON.stringify({ discovered: 0, message: "Nenhum provider ativo." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve API keys
    const envKeyMap: Record<string, string> = {
      gemini_direct: "GEMINI_API_KEY",
      openai_direct: "OPENAI_API_KEY",
      anthropic_direct: "ANTHROPIC_API_KEY",
    };
    const settingsKeyMap: Record<string, string> = {
      gemini_direct: "gemini_api_key",
      openai_direct: "openai_api_key",
      anthropic_direct: "anthropic_api_key",
    };

    let totalDiscovered = 0;
    const results: Record<string, number> = {};

    for (const provider of providers) {
      const registry = MODEL_REGISTRY[provider.provider_type];
      if (!registry) continue;

      // Resolve API key
      let apiKey = Deno.env.get(envKeyMap[provider.provider_type] || "") || null;
      if (!apiKey && userId && settingsKeyMap[provider.provider_type]) {
        const { data } = await supabase
          .from("settings")
          .select("value")
          .eq("user_id", userId)
          .eq("key", settingsKeyMap[provider.provider_type])
          .maybeSingle();
        apiKey = data?.value || null;
      }

      // Validate which models are available
      const availableModels = apiKey
        ? await validateModels(provider.provider_type, apiKey)
        : Object.keys(registry);

      // Upsert models into catalog
      for (const modelId of availableModels) {
        const meta = registry[modelId];
        if (!meta) continue;

        await supabase.from("ai_model_catalog").upsert({
          workspace_id: workspaceId,
          provider_type: provider.provider_type,
          model_id: modelId,
          display_name: meta.display_name,
          is_global: false,
          supports_text: meta.text,
          supports_vision: meta.vision,
          supports_tool_calls: meta.tools,
          supports_json_schema: meta.json_schema,
          supports_structured_output: meta.structured,
          cost_input_per_mtok: meta.cost_input,
          cost_output_per_mtok: meta.cost_output,
          speed_rating: meta.speed,
          accuracy_rating: meta.accuracy,
          max_context_tokens: meta.max_context,
        }, { onConflict: "workspace_id,provider_type,model_id", ignoreDuplicates: false });

        totalDiscovered++;
      }

      results[provider.provider_name] = availableModels.length;

      // Auto-set default_model if provider has none
      if (availableModels.length > 0) {
        const { data: currentProvider } = await supabase
          .from("ai_providers")
          .select("default_model")
          .eq("id", provider.id)
          .single();
        
        if (!currentProvider?.default_model) {
          // Pick best model (highest accuracy) as default
          const bestModel = availableModels
            .map(id => ({ id, acc: registry[id]?.accuracy || 0 }))
            .sort((a, b) => b.acc - a.acc)[0];
          
          await supabase.from("ai_providers")
            .update({ default_model: bestModel.id, updated_at: new Date().toISOString() })
            .eq("id", provider.id);
        }
      }
    }

    return new Response(JSON.stringify({ 
      discovered: totalDiscovered, 
      results,
      message: `Descobertos ${totalDiscovered} modelos.`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
