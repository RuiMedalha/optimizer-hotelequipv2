
-- ORQ-10: Channel Transformation & Payload Builder

CREATE TYPE public.payload_status_enum AS ENUM ('queued','building','built','validated','invalid','published','error');
CREATE TYPE public.channel_asset_status_enum AS ENUM ('selected','optimized','rejected','missing');
CREATE TYPE public.snapshot_type_enum AS ENUM ('pre_publish','published','post_sync','remote_state');

-- channel_payloads
CREATE TABLE public.channel_payloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id uuid,
  canonical_product_id uuid REFERENCES public.canonical_products(id) ON DELETE SET NULL,
  payload_version integer NOT NULL DEFAULT 1,
  payload_status public.payload_status_enum NOT NULL DEFAULT 'queued',
  payload_data jsonb DEFAULT '{}',
  validation_status text DEFAULT 'pending',
  validation_errors jsonb DEFAULT '[]',
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_channel_payloads_workspace ON public.channel_payloads(workspace_id);
CREATE INDEX idx_channel_payloads_channel ON public.channel_payloads(channel_id);
CREATE INDEX idx_channel_payloads_canonical ON public.channel_payloads(canonical_product_id);
CREATE INDEX idx_channel_payloads_status ON public.channel_payloads(payload_status);
ALTER TABLE public.channel_payloads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage channel_payloads in workspace" ON public.channel_payloads FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- channel_payload_fields
CREATE TABLE public.channel_payload_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_payload_id uuid NOT NULL REFERENCES public.channel_payloads(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  source_field_name text,
  source_value jsonb,
  transformed_value jsonb,
  transformer_used text,
  validation_status text DEFAULT 'valid',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_channel_payload_fields_payload ON public.channel_payload_fields(channel_payload_id);
ALTER TABLE public.channel_payload_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage channel_payload_fields via payload" ON public.channel_payload_fields FOR ALL USING (
  EXISTS (SELECT 1 FROM public.channel_payloads cp WHERE cp.id = channel_payload_id AND public.has_workspace_access_hybrid(cp.workspace_id, 'viewer'))
);

-- channel_payload_assets
CREATE TABLE public.channel_payload_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_payload_id uuid NOT NULL REFERENCES public.channel_payloads(id) ON DELETE CASCADE,
  asset_id uuid,
  variant_id uuid,
  usage_context text DEFAULT 'gallery',
  sort_order integer DEFAULT 0,
  channel_asset_status public.channel_asset_status_enum NOT NULL DEFAULT 'selected',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_channel_payload_assets_payload ON public.channel_payload_assets(channel_payload_id);
ALTER TABLE public.channel_payload_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage channel_payload_assets via payload" ON public.channel_payload_assets FOR ALL USING (
  EXISTS (SELECT 1 FROM public.channel_payloads cp WHERE cp.id = channel_payload_id AND public.has_workspace_access_hybrid(cp.workspace_id, 'viewer'))
);

-- channel_payload_logs
CREATE TABLE public.channel_payload_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_payload_id uuid NOT NULL REFERENCES public.channel_payloads(id) ON DELETE CASCADE,
  step_name text NOT NULL,
  status text DEFAULT 'success',
  input_payload jsonb,
  output_payload jsonb,
  error_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_channel_payload_logs_payload ON public.channel_payload_logs(channel_payload_id);
ALTER TABLE public.channel_payload_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage channel_payload_logs via payload" ON public.channel_payload_logs FOR ALL USING (
  EXISTS (SELECT 1 FROM public.channel_payloads cp WHERE cp.id = channel_payload_id AND public.has_workspace_access_hybrid(cp.workspace_id, 'viewer'))
);

-- channel_sync_snapshots
CREATE TABLE public.channel_sync_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id uuid,
  canonical_product_id uuid REFERENCES public.canonical_products(id) ON DELETE SET NULL,
  channel_product_id text,
  snapshot_type public.snapshot_type_enum NOT NULL DEFAULT 'pre_publish',
  snapshot_payload jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_channel_sync_snapshots_workspace ON public.channel_sync_snapshots(workspace_id);
CREATE INDEX idx_channel_sync_snapshots_canonical ON public.channel_sync_snapshots(canonical_product_id);
ALTER TABLE public.channel_sync_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage channel_sync_snapshots in workspace" ON public.channel_sync_snapshots FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
