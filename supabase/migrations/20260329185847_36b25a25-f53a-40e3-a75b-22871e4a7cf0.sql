
-- Allow global routing rules (workspace_id NULL = applies to all workspaces)
ALTER TABLE public.ai_routing_rules ALTER COLUMN workspace_id DROP NOT NULL;
