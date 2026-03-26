
-- ============================================================
-- BLOCO 3A: Workspace Collaboration & RBAC
-- ============================================================

-- 1. ENUMS
CREATE TYPE public.workspace_role AS ENUM ('owner', 'admin', 'editor', 'viewer');
CREATE TYPE public.workspace_member_status AS ENUM ('pending', 'active', 'revoked');
CREATE TYPE public.workspace_invitation_status AS ENUM ('pending', 'accepted', 'expired', 'revoked');

-- 2. Extend audit_entity_type enum for member/invitation tracking
-- (member and workspace already exist in audit_entity_type)

-- 3. TABLES

-- workspace_members
CREATE TABLE public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid,
  email text NOT NULL,
  role public.workspace_role NOT NULL DEFAULT 'viewer',
  invited_by uuid,
  invited_at timestamptz DEFAULT now(),
  accepted_at timestamptz,
  status public.workspace_member_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, email)
);

CREATE INDEX idx_workspace_members_workspace ON public.workspace_members(workspace_id);
CREATE INDEX idx_workspace_members_user ON public.workspace_members(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_workspace_members_email ON public.workspace_members(email);
CREATE INDEX idx_workspace_members_status ON public.workspace_members(status);
CREATE UNIQUE INDEX idx_workspace_members_ws_user ON public.workspace_members(workspace_id, user_id) WHERE user_id IS NOT NULL;

-- workspace_invitations
CREATE TABLE public.workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.workspace_role NOT NULL DEFAULT 'viewer',
  token text NOT NULL UNIQUE,
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  status public.workspace_invitation_status NOT NULL DEFAULT 'pending'
);

CREATE INDEX idx_workspace_invitations_workspace ON public.workspace_invitations(workspace_id);
CREATE INDEX idx_workspace_invitations_email ON public.workspace_invitations(email);
CREATE INDEX idx_workspace_invitations_status ON public.workspace_invitations(status);
CREATE INDEX idx_workspace_invitations_token ON public.workspace_invitations(token);

-- 4. ALTER workspaces: add default_language and plan_tier
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS default_language text DEFAULT 'pt-PT';
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS plan_tier text DEFAULT 'starter';

-- 5. PERMISSION FUNCTIONS (SECURITY DEFINER, safe search_path)

CREATE OR REPLACE FUNCTION public.get_workspace_role(_workspace_id uuid)
RETURNS public.workspace_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.workspace_members
  WHERE workspace_id = _workspace_id
    AND user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.workspace_role_rank(_role public.workspace_role)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _role
    WHEN 'owner' THEN 4
    WHEN 'admin' THEN 3
    WHEN 'editor' THEN 2
    WHEN 'viewer' THEN 1
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.has_workspace_access(_workspace_id uuid, _min_role public.workspace_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id
      AND user_id = auth.uid()
      AND status = 'active'
      AND public.workspace_role_rank(role) >= public.workspace_role_rank(_min_role)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_workspace(_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_workspace_access(_workspace_id, 'admin');
$$;

CREATE OR REPLACE FUNCTION public.can_edit_workspace_content(_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_workspace_access(_workspace_id, 'editor');
$$;

CREATE OR REPLACE FUNCTION public.can_publish_in_workspace(_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_workspace_access(_workspace_id, 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_owner(_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_workspace_access(_workspace_id, 'owner');
$$;

-- Hybrid access check: workspace member OR legacy owner
CREATE OR REPLACE FUNCTION public.has_workspace_access_hybrid(_workspace_id uuid, _min_role public.workspace_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    public.has_workspace_access(_workspace_id, _min_role)
    OR EXISTS (
      SELECT 1 FROM public.workspaces
      WHERE id = _workspace_id AND user_id = auth.uid()
    )
  );
$$;

-- 6. SEED: Create owner members for existing workspaces
INSERT INTO public.workspace_members (workspace_id, user_id, email, role, status, accepted_at, invited_at)
SELECT
  w.id,
  w.user_id,
  COALESCE(p.email, 'owner@workspace.local'),
  'owner'::public.workspace_role,
  'active'::public.workspace_member_status,
  now(),
  w.created_at
FROM public.workspaces w
LEFT JOIN public.profiles p ON p.user_id = w.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.workspace_members wm
  WHERE wm.workspace_id = w.id AND wm.user_id = w.user_id
);

-- 7. RLS ON NEW TABLES

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;

-- workspace_members: members can see their own workspace members, admins can manage
CREATE POLICY "Members can view workspace members"
  ON public.workspace_members FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

CREATE POLICY "Admins can insert workspace members"
  ON public.workspace_members FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_workspace(workspace_id) OR 
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND user_id = auth.uid()));

CREATE POLICY "Admins can update workspace members"
  ON public.workspace_members FOR UPDATE TO authenticated
  USING (public.can_manage_workspace(workspace_id) OR 
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND user_id = auth.uid()));

CREATE POLICY "Owners can delete workspace members"
  ON public.workspace_members FOR DELETE TO authenticated
  USING (public.is_workspace_owner(workspace_id) OR
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND user_id = auth.uid()));

-- workspace_invitations
CREATE POLICY "Members can view workspace invitations"
  ON public.workspace_invitations FOR SELECT TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

CREATE POLICY "Admins can insert workspace invitations"
  ON public.workspace_invitations FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_workspace(workspace_id) OR
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND user_id = auth.uid()));

CREATE POLICY "Admins can update workspace invitations"
  ON public.workspace_invitations FOR UPDATE TO authenticated
  USING (public.can_manage_workspace(workspace_id) OR
    EXISTS (SELECT 1 FROM public.workspaces WHERE id = workspace_id AND user_id = auth.uid()));

-- 8. UPDATE RLS ON EXISTING TABLES (HYBRID: workspace_members OR legacy user_id)

-- workspaces: add member-based access alongside existing owner policies
CREATE POLICY "Workspace members can view workspaces"
  ON public.workspaces FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspaces.id
        AND wm.user_id = auth.uid()
        AND wm.status = 'active'
    )
  );

-- workspace_ai_settings: hybrid
DROP POLICY IF EXISTS "Users can manage their workspace AI settings" ON public.workspace_ai_settings;
CREATE POLICY "Users can manage their workspace AI settings"
  ON public.workspace_ai_settings FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- workspace_notification_settings: hybrid
DROP POLICY IF EXISTS "Users can manage their workspace notification settings" ON public.workspace_notification_settings;
CREATE POLICY "Users can manage their workspace notification settings"
  ON public.workspace_notification_settings FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'admin'));

-- workspace_supplier_configs: hybrid
DROP POLICY IF EXISTS "Users can manage their workspace supplier configs" ON public.workspace_supplier_configs;
CREATE POLICY "Users can manage their workspace supplier configs"
  ON public.workspace_supplier_configs FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- workspace_prompt_profiles: hybrid
DROP POLICY IF EXISTS "Users can manage their workspace prompt profiles" ON public.workspace_prompt_profiles;
CREATE POLICY "Users can manage their workspace prompt profiles"
  ON public.workspace_prompt_profiles FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'editor'));

-- workspace_publish_profiles: hybrid
DROP POLICY IF EXISTS "Users can manage their workspace publish profiles" ON public.workspace_publish_profiles;
CREATE POLICY "Users can manage their workspace publish profiles"
  ON public.workspace_publish_profiles FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'admin'));

-- quality_gates: hybrid
DROP POLICY IF EXISTS "Users can manage their workspace quality gates" ON public.quality_gates;
CREATE POLICY "Users can manage their workspace quality gates"
  ON public.quality_gates FOR ALL TO authenticated
  USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'))
  WITH CHECK (public.has_workspace_access_hybrid(workspace_id, 'admin'));

-- Enable realtime for workspace_members
ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_members;
