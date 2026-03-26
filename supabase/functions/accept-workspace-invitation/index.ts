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
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } }
    );
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: "Token é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find invitation
    const { data: invitation, error: invErr } = await adminClient
      .from("workspace_invitations")
      .select("*")
      .eq("token", token)
      .single();

    if (invErr || !invitation) {
      return new Response(JSON.stringify({ error: "Convite não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (invitation.status !== "pending") {
      return new Response(JSON.stringify({ error: `Convite já foi ${invitation.status}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      await adminClient.from("workspace_invitations")
        .update({ status: "expired" })
        .eq("id", invitation.id);
      return new Response(JSON.stringify({ error: "Convite expirado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();

    // Accept invitation
    await adminClient.from("workspace_invitations")
      .update({ status: "accepted", accepted_at: now })
      .eq("id", invitation.id);

    // Activate or create member
    const { data: existingMember } = await adminClient
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", invitation.workspace_id)
      .eq("email", invitation.email)
      .maybeSingle();

    if (existingMember) {
      await adminClient.from("workspace_members")
        .update({
          user_id: user.id,
          status: "active",
          role: invitation.role,
          accepted_at: now,
          updated_at: now,
        })
        .eq("id", existingMember.id);
    } else {
      await adminClient.from("workspace_members").insert({
        workspace_id: invitation.workspace_id,
        user_id: user.id,
        email: invitation.email,
        role: invitation.role,
        invited_by: invitation.invited_by,
        status: "active",
        accepted_at: now,
      });
    }

    // Audit trail
    await adminClient.from("audit_trail").insert({
      user_id: user.id,
      workspace_id: invitation.workspace_id,
      entity_type: "member",
      entity_id: invitation.id,
      action: "approve",
      metadata: { email: invitation.email, role: invitation.role },
    });

    return new Response(JSON.stringify({ 
      success: true, 
      workspaceId: invitation.workspace_id,
      role: invitation.role,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
