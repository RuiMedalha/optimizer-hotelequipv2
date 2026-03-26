import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { supplier_id, files } = await req.json();

    if (!supplier_id || !files?.length) {
      return new Response(JSON.stringify({ error: "supplier_id and files required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const classifyFile = (filename: string, mime: string) => {
      const ext = filename.split(".").pop()?.toLowerCase();
      let source_type = "excel";
      let source_role = "commercial";

      if (ext === "pdf" || mime?.includes("pdf")) { source_type = "pdf"; source_role = "technical"; }
      else if (ext === "xml" || mime?.includes("xml")) { source_type = "xml"; source_role = "stock"; }
      else if (ext === "csv" || ext === "xlsx" || ext === "xls") { source_type = "excel"; source_role = "commercial"; }
      else if (ext === "json") { source_type = "api"; source_role = "enrichment"; }
      else if (["jpg", "jpeg", "png", "webp", "zip"].includes(ext || "")) { source_type = "image_pack"; source_role = "assets"; }

      return { source_type, source_role };
    };

    const results = [];
    for (const file of files) {
      const { source_type, source_role } = classifyFile(file.filename, file.mime_type);

      // Upsert source profile
      const { data: existing } = await supabase
        .from("supplier_source_profiles")
        .select("id, reliability_score")
        .eq("supplier_id", supplier_id)
        .eq("source_type", source_type)
        .eq("source_role", source_role)
        .maybeSingle();

      if (!existing) {
        await supabase.from("supplier_source_profiles").insert({
          supplier_id, source_type, source_role, reliability_score: 0.5, priority_rank: 5,
        });
      }

      // Update file record if file_id provided
      if (file.file_id) {
        await supabase.from("uploaded_files").update({ supplier_id, source_type, source_role }).eq("id", file.file_id);
      }

      results.push({ filename: file.filename, source_type, source_role });
    }

    return new Response(JSON.stringify({ results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
