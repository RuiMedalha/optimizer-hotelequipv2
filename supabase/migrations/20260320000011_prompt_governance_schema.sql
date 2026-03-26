-- Block 2: Prompt governance schema changes
-- 1. Allow global (workspace_id = NULL) prompt templates
-- 2. Unique index on prompt_templates(prompt_name) for global templates — enables
--    ON CONFLICT (prompt_name) DO NOTHING in seed migration (idempotency)
-- 3. Fix RLS on prompt_templates: drop old "ws access" FOR ALL policy; add split policies
--    that correctly allow SELECT/write on global rows (workspace_id IS NULL)
-- 4. Fix RLS on prompt_versions: allow access to versions of global templates
-- 5. Allow global routing rules (workspace_id = NULL) in ai_routing_rules
-- 6. Add prompt_version_id to log tables for traceability

-- ── prompt_templates: allow global (workspace_id = NULL) ─────────────────────
ALTER TABLE prompt_templates ALTER COLUMN workspace_id DROP NOT NULL;

-- Unique index so the seed migration can conflict on prompt_name for global rows
CREATE UNIQUE INDEX IF NOT EXISTS prompt_templates_global_name_idx
  ON prompt_templates (prompt_name)
  WHERE workspace_id IS NULL;

-- Drop ALL existing prompt_templates policies (including old "ws access" FOR ALL)
-- and replace with correct split policies that handle NULL workspace_id
DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "ws access" ON prompt_templates';
  EXECUTE 'DROP POLICY IF EXISTS "Users can manage workspace prompt_templates" ON prompt_templates';
  EXECUTE 'DROP POLICY IF EXISTS "Users can view global or workspace prompt_templates" ON prompt_templates';
  EXECUTE 'DROP POLICY IF EXISTS "Users can insert prompt templates" ON prompt_templates';
  EXECUTE 'DROP POLICY IF EXISTS "Users can update prompt templates" ON prompt_templates';
  EXECUTE 'DROP POLICY IF EXISTS "Users can delete prompt templates" ON prompt_templates';
END $$;

CREATE POLICY "Users can view global or workspace prompt_templates"
  ON prompt_templates FOR SELECT TO authenticated
  USING (workspace_id IS NULL OR public.has_workspace_access(workspace_id, 'viewer'));

CREATE POLICY "Users can insert prompt templates"
  ON prompt_templates FOR INSERT TO authenticated
  WITH CHECK (workspace_id IS NULL OR public.can_manage_workspace(workspace_id));

CREATE POLICY "Users can update prompt templates"
  ON prompt_templates FOR UPDATE TO authenticated
  USING (workspace_id IS NULL OR public.can_manage_workspace(workspace_id));

CREATE POLICY "Users can delete prompt templates"
  ON prompt_templates FOR DELETE TO authenticated
  USING (workspace_id IS NULL OR public.can_manage_workspace(workspace_id));

-- ── prompt_versions: allow access to versions of global templates ─────────────
-- The existing "access via template" policy uses has_workspace_access_hybrid(t.workspace_id, ...)
-- which fails when t.workspace_id IS NULL (global template). Replace it.
DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "access via template" ON prompt_versions';
  EXECUTE 'DROP POLICY IF EXISTS "Users can view global or workspace prompt_versions" ON prompt_versions';
END $$;

CREATE POLICY "Users can view global or workspace prompt_versions"
  ON prompt_versions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM prompt_templates t
      WHERE t.id = template_id
        AND (
          t.workspace_id IS NULL
          OR public.has_workspace_access(t.workspace_id, 'viewer')
        )
    )
  );

-- ── ai_routing_rules: allow global (workspace_id = NULL) ─────────────────────
ALTER TABLE ai_routing_rules ALTER COLUMN workspace_id DROP NOT NULL;

-- The existing UNIQUE(workspace_id, task_type) constraint requires both NOT NULL.
-- Drop it and replace with two partial unique indexes that handle NULLs correctly.
ALTER TABLE ai_routing_rules
  DROP CONSTRAINT IF EXISTS ai_routing_rules_workspace_id_task_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS ai_routing_rules_global_task_type_idx
  ON ai_routing_rules (task_type)
  WHERE workspace_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_routing_rules_workspace_task_type_idx
  ON ai_routing_rules (workspace_id, task_type)
  WHERE workspace_id IS NOT NULL;

-- Update RLS on ai_routing_rules
DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Users can manage workspace ai_routing_rules" ON ai_routing_rules';
  EXECUTE 'DROP POLICY IF EXISTS "Users can view global or workspace ai_routing_rules" ON ai_routing_rules';
  EXECUTE 'DROP POLICY IF EXISTS "Users can manage ai_routing_rules" ON ai_routing_rules';
  EXECUTE 'DROP POLICY IF EXISTS "Users can update ai_routing_rules" ON ai_routing_rules';
  EXECUTE 'DROP POLICY IF EXISTS "Users can delete ai_routing_rules" ON ai_routing_rules';
END $$;

CREATE POLICY "Users can view global or workspace ai_routing_rules"
  ON ai_routing_rules FOR SELECT TO authenticated
  USING (workspace_id IS NULL OR public.has_workspace_access(workspace_id, 'viewer'));

CREATE POLICY "Users can manage ai_routing_rules"
  ON ai_routing_rules FOR INSERT TO authenticated
  WITH CHECK (workspace_id IS NULL OR public.can_manage_workspace(workspace_id));

CREATE POLICY "Users can update ai_routing_rules"
  ON ai_routing_rules FOR UPDATE TO authenticated
  USING (workspace_id IS NULL OR public.can_manage_workspace(workspace_id));

CREATE POLICY "Users can delete ai_routing_rules"
  ON ai_routing_rules FOR DELETE TO authenticated
  USING (workspace_id IS NULL OR public.can_manage_workspace(workspace_id));

-- ── optimization_logs: add prompt_version_id for traceability ────────────────
-- NOTE: chunks_used and rag_match_types already exist (added in a prior migration).
ALTER TABLE optimization_logs
  ADD COLUMN IF NOT EXISTS prompt_version_id uuid REFERENCES prompt_versions(id);

-- ── ai_usage_logs: add prompt_version_id for traceability ────────────────────
ALTER TABLE ai_usage_logs
  ADD COLUMN IF NOT EXISTS prompt_version_id uuid REFERENCES prompt_versions(id);
