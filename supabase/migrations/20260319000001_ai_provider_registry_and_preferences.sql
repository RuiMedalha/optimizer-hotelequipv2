-- Migration 1: ai_provider_registry and workspace_ai_preferences
-- Additive only — no destructive changes.

CREATE TABLE IF NOT EXISTS ai_provider_registry (
  id              TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  api_base_url    TEXT NOT NULL,
  api_key_env_var TEXT NOT NULL,
  auth_scheme     TEXT NOT NULL DEFAULT 'bearer',
  request_format  TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  is_legacy       BOOLEAN NOT NULL DEFAULT FALSE,
  priority        INT NOT NULL DEFAULT 50,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_ai_preferences (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id         UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  capability           TEXT NOT NULL DEFAULT '*',
  provider_id          TEXT REFERENCES ai_provider_registry(id),
  model_id             TEXT,
  fallback_provider_id TEXT REFERENCES ai_provider_registry(id),
  fallback_model_id    TEXT,
  temperature          NUMERIC DEFAULT 0.7,
  max_tokens           INT DEFAULT 2048,
  json_mode            BOOLEAN DEFAULT FALSE,
  enabled              BOOLEAN DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, capability)
);

ALTER TABLE ai_provider_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_ai_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_registry"
  ON ai_provider_registry FOR ALL TO service_role USING (true);

CREATE POLICY "workspace_members_read_preferences"
  ON workspace_ai_preferences FOR SELECT
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "service_role_full_access_preferences"
  ON workspace_ai_preferences FOR ALL TO service_role USING (true);
