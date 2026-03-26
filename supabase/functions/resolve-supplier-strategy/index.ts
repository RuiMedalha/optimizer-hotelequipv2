import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { supplier_id } = await req.json();

    if (!supplier_id) {
      return new Response(JSON.stringify({ error: "supplier_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch all supplier data in parallel
    const [sourceProfiles, fieldTrust, matchingRules, groupingRules, taxonomyProfile, promptProfiles, decisionMemory] = await Promise.all([
      supabase.from("supplier_source_profiles").select("*").eq("supplier_id", supplier_id).order("priority_rank"),
      supabase.from("supplier_field_trust_rules").select("*").eq("supplier_id", supplier_id),
      supabase.from("supplier_matching_rules").select("*").eq("supplier_id", supplier_id).eq("is_active", true).order("rule_weight", { ascending: false }),
      supabase.from("supplier_grouping_rules").select("*").eq("supplier_id", supplier_id),
      supabase.from("supplier_taxonomy_profiles").select("*").eq("supplier_id", supplier_id).maybeSingle(),
      supabase.from("supplier_prompt_profiles").select("*").eq("supplier_id", supplier_id).eq("is_active", true),
      supabase.from("supplier_decision_memory").select("*").eq("supplier_id", supplier_id).order("success_rate", { ascending: false }).limit(20),
    ]);

    // Determine if auto or review needed
    const avgReliability = sourceProfiles.data?.reduce((s: number, p: any) => s + (p.reliability_score || 0), 0) / (sourceProfiles.data?.length || 1);
    const needs_review = avgReliability < 0.6;

    const strategy = {
      source_profiles: sourceProfiles.data || [],
      field_trust: fieldTrust.data || [],
      matching_rules: matchingRules.data || [],
      grouping_rules: groupingRules.data || [],
      taxonomy: taxonomyProfile.data || null,
      prompts: promptProfiles.data || [],
      decision_memory: decisionMemory.data || [],
      recommended_mode: needs_review ? "review" : "auto",
      average_reliability: avgReliability,
    };

    return new Response(JSON.stringify({ strategy }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
