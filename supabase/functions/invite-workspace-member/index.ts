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

    const { workspaceId, email, role } = await req.json();
    if (!workspaceId || !email || !role) {
      return new Response(JSON.stringify({ error: "workspaceId, email e role são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validRoles = ["admin", "editor", "viewer"];
    if (!validRoles.includes(role)) {
      return new Response(JSON.stringify({ error: "Role inválida. Usar: admin, editor, viewer" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check caller has admin/owner access
    const { data: callerMember } = await adminClient
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!callerMember || !["owner", "admin"].includes(callerMember.role)) {
      return new Response(JSON.stringify({ error: "Sem permissão para convidar membros" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if already a member
    const { data: existing } = await adminClient
      .from("workspace_members")
      .select("id, status")
      .eq("workspace_id", workspaceId)
      .eq("email", email.toLowerCase())
      .maybeSingle();

    if (existing && existing.status === "active") {
      return new Response(JSON.stringify({ error: "Este email já é membro ativo deste workspace" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate unique token
    const token = crypto.randomUUID() + "-" + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    // Create invitation
    const { data: invitation, error: invErr } = await adminClient
      .from("workspace_invitations")
      .insert({
        workspace_id: workspaceId,
        email: email.toLowerCase(),
        role,
        token,
        invited_by: user.id,
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (invErr) throw invErr;

    // Create pending member if not exists
    if (existing && existing.status === "revoked") {
      await adminClient
        .from("workspace_members")
        .update({ status: "pending", role, invited_by: user.id, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else if (!existing) {
      await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          email: email.toLowerCase(),
          role,
          invited_by: user.id,
          status: "pending",
        });
    }

    // Audit trail
    await adminClient.from("audit_trail").insert({
      user_id: user.id,
      workspace_id: workspaceId,
      entity_type: "member",
      entity_id: invitation.id,
      action: "create",
      metadata: { email: email.toLowerCase(), role, invitation_token: token },
    });

    return new Response(JSON.stringify({ 
      success: true, 
      invitationId: invitation.id,
      token,
      expiresAt 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
