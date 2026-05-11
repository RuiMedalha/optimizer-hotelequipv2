-- Create catalog_operation_errors table
CREATE TABLE IF NOT EXISTS public.catalog_operation_errors (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL,
    operation_type TEXT NOT NULL,
    product_id UUID,
    sku TEXT,
    error_message TEXT NOT NULL,
    error_detail JSONB,
    resolved BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.catalog_operation_errors ENABLE ROW LEVEL SECURITY;

-- Create policies for catalog_operation_errors
CREATE POLICY "Users can view their own workspace errors" 
ON public.catalog_operation_errors 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own workspace errors" 
ON public.catalog_operation_errors 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own workspace errors" 
ON public.catalog_operation_errors 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own workspace errors" 
ON public.catalog_operation_errors 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER update_catalog_operation_errors_updated_at
BEFORE UPDATE ON public.catalog_operation_errors
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Fix potential RLS issue for bulk updates on products
-- Ensure there is a policy allowing updates based on workspace_id + user_id
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'products' AND policyname = 'Users can update products in their workspace'
    ) THEN
        CREATE POLICY "Users can update products in their workspace" 
        ON public.products 
        FOR UPDATE 
        USING (auth.uid() = user_id OR workspace_id IN (SELECT id FROM workspaces WHERE user_id = auth.uid()));
    END IF;
END $$;
