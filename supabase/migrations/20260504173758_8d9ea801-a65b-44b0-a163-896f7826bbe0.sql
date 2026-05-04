-- Create workspace_settings table
CREATE TABLE IF NOT EXISTS public.workspace_settings (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE UNIQUE,
    seo_plugin TEXT NOT NULL DEFAULT 'rankmath',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view settings for their workspaces" 
ON public.workspace_settings 
FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.workspace_members 
        WHERE workspace_members.workspace_id = workspace_settings.workspace_id 
        AND workspace_members.user_id = auth.uid()
    )
);

CREATE POLICY "Admins can update settings for their workspaces" 
ON public.workspace_settings 
FOR UPDATE 
USING (
    EXISTS (
        SELECT 1 FROM public.workspace_members 
        WHERE workspace_members.workspace_id = workspace_settings.workspace_id 
        AND workspace_members.user_id = auth.uid()
        AND workspace_members.role IN ('owner', 'admin')
    )
);

CREATE POLICY "Admins can insert settings for their workspaces" 
ON public.workspace_settings 
FOR INSERT 
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.workspace_members 
        WHERE workspace_members.workspace_id = workspace_settings.workspace_id 
        AND workspace_members.user_id = auth.uid()
        AND workspace_members.role IN ('owner', 'admin')
    )
);

-- Comment
COMMENT ON COLUMN workspace_settings.seo_plugin IS 'SEO plugin used in WooCommerce: rankmath, yoast, none, or custom:{prefix}';

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_workspace_settings_updated_at
BEFORE UPDATE ON public.workspace_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();