
-- Enums
CREATE TYPE public.channel_type_enum AS ENUM ('woocommerce', 'shopify', 'amazon', 'google_merchant', 'csv_export', 'api_endpoint', 'marketplace');
CREATE TYPE public.channel_job_status_enum AS ENUM ('queued', 'running', 'completed', 'failed');

-- 1. Channels
CREATE TABLE public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_name text NOT NULL,
  channel_type public.channel_type_enum NOT NULL,
  status text DEFAULT 'active',
  config jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_access_channels" ON public.channels FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));
CREATE TRIGGER update_channels_updated_at BEFORE UPDATE ON public.channels FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Channel Connections
CREATE TABLE public.channel_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  connection_name text,
  credentials jsonb DEFAULT '{}',
  settings jsonb DEFAULT '{}',
  status text DEFAULT 'connected',
  last_sync_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.channel_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_access_channel_connections" ON public.channel_connections FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 3. Channel Field Mappings
CREATE TABLE public.channel_field_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  canonical_field text NOT NULL,
  channel_field text NOT NULL,
  transformation_rules jsonb,
  required boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.channel_field_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_access_channel_field_mappings" ON public.channel_field_mappings FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 4. Channel Category Mappings
CREATE TABLE public.channel_category_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  internal_category text,
  channel_category text,
  confidence integer DEFAULT 50,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.channel_category_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_access_channel_category_mappings" ON public.channel_category_mappings FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 5. Channel Attribute Mappings
CREATE TABLE public.channel_attribute_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  attribute_name text NOT NULL,
  channel_attribute_name text NOT NULL,
  required boolean DEFAULT false,
  transformation_rules jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.channel_attribute_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_access_channel_attribute_mappings" ON public.channel_attribute_mappings FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 6. Channel Product Data (snapshots)
CREATE TABLE public.channel_product_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  payload jsonb,
  status text DEFAULT 'pending',
  external_id text,
  last_published_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(product_id, channel_id)
);
ALTER TABLE public.channel_product_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_access_channel_product_data" ON public.channel_product_data FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 7. Channel Publish Jobs
CREATE TABLE public.channel_publish_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  job_status public.channel_job_status_enum DEFAULT 'queued',
  total_products integer DEFAULT 0,
  processed_products integer DEFAULT 0,
  failed_products integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.channel_publish_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_access_channel_publish_jobs" ON public.channel_publish_jobs FOR ALL USING (public.has_workspace_access_hybrid(workspace_id, 'viewer'));

-- 8. Channel Publish Job Items
CREATE TABLE public.channel_publish_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.channel_publish_jobs(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  status text DEFAULT 'queued',
  external_id text,
  payload jsonb,
  response jsonb,
  error_message text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.channel_publish_job_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_access_channel_publish_job_items" ON public.channel_publish_job_items FOR ALL USING (
  EXISTS (SELECT 1 FROM public.channel_publish_jobs j WHERE j.id = job_id AND public.has_workspace_access_hybrid(j.workspace_id, 'viewer'))
);
