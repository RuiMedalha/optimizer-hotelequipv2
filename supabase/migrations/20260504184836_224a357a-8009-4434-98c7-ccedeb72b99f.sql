CREATE TABLE IF NOT EXISTS public.category_learning_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  
  -- Pattern type
  pattern_type TEXT NOT NULL CHECK (pattern_type IN (
    'attribute_value',    -- Ex: basket_size = '35-40cm' -> category X
    'title_keyword',      -- Ex: title contains 'industrial' -> category Y
    'spec_range',         -- Ex: power between 10-15kW -> category Z
    'brand_model'         -- Ex: brand SAMMIC + model X -> category W
  )),
  
  -- Pattern definition
  pattern_key TEXT NOT NULL,      -- Ex: 'basket_size', 'title_keyword', 'power_kw'
  pattern_value TEXT NOT NULL,    -- Ex: '35-40', 'industrial', '10-15'
  pattern_operator TEXT DEFAULT '=', -- '=', 'contains', 'between', 'in'
  
  -- Learning metadata
  sample_count INTEGER DEFAULT 1, -- How many products match this pattern
  confidence NUMERIC(3,2) DEFAULT 1.00, -- 0.00-1.00
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Source
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'auto_detected', 'user_correction')),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(workspace_id, category_id, pattern_type, pattern_key, pattern_value)
);

-- Enable RLS
ALTER TABLE public.category_learning_patterns ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view patterns in their workspace"
ON public.category_learning_patterns
FOR SELECT
USING (workspace_id IN (
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
));

CREATE POLICY "Users can manage patterns in their workspace"
ON public.category_learning_patterns
FOR ALL
USING (workspace_id IN (
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_category_patterns_workspace ON public.category_learning_patterns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_category_patterns_category ON public.category_learning_patterns(category_id);
CREATE INDEX IF NOT EXISTS idx_category_patterns_type ON public.category_learning_patterns(pattern_type);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_category_learning_patterns_updated_at
    BEFORE UPDATE ON public.category_learning_patterns
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
