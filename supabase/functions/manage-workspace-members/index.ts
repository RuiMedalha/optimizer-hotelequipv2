import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Handles: revoke-invitation, update-role, remove-member
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

    const body = await req.json();
    const { action, workspaceId } = body;

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: "workspaceId obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check caller permissions
    const { data: callerMember } = await adminClient
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    const callerRole = callerMember?.role;
    const isOwnerOrAdmin = callerRole === "owner" || callerRole === "admin";

    if (!isOwnerOrAdmin) {
      return new Response(JSON.stringify({ error: "Sem permissão" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = (data: any, status = 200) =>
      new Response(JSON.stringify(data), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // === REVOKE INVITATION ===
    if (action === "revoke-invitation") {
      const { invitationId } = body;
      if (!invitationId) return json({ error: "invitationId obrigatório" }, 400);

      await adminClient.from("workspace_invitations")
        .update({ status: "revoked" })
        .eq("id", invitationId)
        .eq("workspace_id", workspaceId);

      // Also revoke the pending member
      const { data: inv } = await adminClient.from("workspace_invitations")
        .select("email").eq("id", invitationId).single();
      if (inv) {
        await adminClient.from("workspace_members")
          .update({ status: "revoked", updated_at: new Date().toISOString() })
          .eq("workspace_id", workspaceId)
          .eq("email", inv.email)
          .eq("status", "pending");
      }

      await adminClient.from("audit_trail").insert({
        user_id: user.id, workspace_id: workspaceId,
        entity_type: "member", entity_id: invitationId,
        action: "reject", metadata: { action: "revoke-invitation" },
      });

      return json({ success: true });
    }

    // === UPDATE ROLE ===
    if (action === "update-role") {
      const { memberId, role } = body;
      if (!memberId || !role) return json({ error: "memberId e role obrigatórios" }, 400);

      const validRoles = ["admin", "editor", "viewer"];
      if (role === "owner" && callerRole !== "owner") {
        return json({ error: "Apenas o owner pode promover a owner" }, 403);
      }
      if (!validRoles.includes(role) && role !== "owner") {
        return json({ error: "Role inválida" }, 400);
      }

      const { data: target } = await adminClient.from("workspace_members")
        .select("id, role, user_id")
        .eq("id", memberId)
        .eq("workspace_id", workspaceId)
        .single();

      if (!target) return json({ error: "Membro não encontrado" }, 404);

      // Prevent demoting last owner
      if (target.role === "owner" && role !== "owner") {
        const { count } = await adminClient.from("workspace_members")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("role", "owner")
          .eq("status", "active");
        if ((count || 0) <= 1) {
          return json({ error: "Não é possível remover o último owner" }, 400);
        }
      }

      await adminClient.from("workspace_members")
        .update({ role, updated_at: new Date().toISOString() })
        .eq("id", memberId);

      await adminClient.from("audit_trail").insert({
        user_id: user.id, workspace_id: workspaceId,
        entity_type: "member", entity_id: memberId,
        action: "update",
        field_changes: { role: { before: target.role, after: role } },
      });

      return json({ success: true });
    }

    // === REMOVE MEMBER ===
    if (action === "remove-member") {
      const { memberId } = body;
      if (!memberId) return json({ error: "memberId obrigatório" }, 400);

      if (callerRole !== "owner") {
        return json({ error: "Apenas o owner pode remover membros" }, 403);
      }

      const { data: target } = await adminClient.from("workspace_members")
        .select("id, role, email")
        .eq("id", memberId)
        .eq("workspace_id", workspaceId)
        .single();

      if (!target) return json({ error: "Membro não encontrado" }, 404);

      if (target.role === "owner") {
        const { count } = await adminClient.from("workspace_members")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("role", "owner")
          .eq("status", "active");
        if ((count || 0) <= 1) {
          return json({ error: "Não é possível remover o último owner" }, 400);
        }
      }

      await adminClient.from("workspace_members")
        .update({ status: "revoked", updated_at: new Date().toISOString() })
        .eq("id", memberId);

      await adminClient.from("audit_trail").insert({
        user_id: user.id, workspace_id: workspaceId,
        entity_type: "member", entity_id: memberId,
        action: "delete", metadata: { email: target.email, role: target.role },
      });

      return json({ success: true });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
