-- Create a table for category learning patterns
CREATE TABLE IF NOT EXISTS public.category_learning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_type_keywords text[],
  brand text,
  sku_prefix text,
  category_path text,
  category_id uuid REFERENCES public.categories(id),
  confidence integer DEFAULT 50,
  times_confirmed integer DEFAULT 0,
  times_corrected integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.category_learning ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read learning patterns
CREATE POLICY "Everyone can view learning patterns" 
ON public.category_learning FOR SELECT 
TO authenticated 
USING (true);

-- Allow authenticated users to insert/update learning patterns (it's a shared pool)
CREATE POLICY "Authenticated users can manage learning patterns" 
ON public.category_learning FOR ALL
TO authenticated 
USING (true)
WITH CHECK (true);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_category_learning_sku_prefix ON public.category_learning(sku_prefix);
CREATE INDEX IF NOT EXISTS idx_category_learning_brand ON public.category_learning(brand);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.category_learning
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();