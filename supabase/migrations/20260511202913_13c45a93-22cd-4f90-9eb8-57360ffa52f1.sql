CREATE TABLE public.business_terminology (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id UUID REFERENCES public.workspaces(id),
    term TEXT NOT NULL,
    category TEXT, -- e.g., 'Exaustão', 'Frio', 'Cozedura'
    type TEXT CHECK (type IN ('preferred', 'avoid', 'synonym')),
    replacement TEXT, -- suggested replacement if type is 'avoid' or 'synonym'
    is_global BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.business_terminology ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Terminology is viewable by everyone in workspace or global" 
ON public.business_terminology FOR SELECT 
USING (is_global = true OR workspace_id IS NULL OR auth.uid() IN (SELECT user_id FROM public.workspace_members WHERE workspace_id = business_terminology.workspace_id));

-- Insert initial industry terms for exhaustion
INSERT INTO public.business_terminology (term, category, type, replacement, is_global) VALUES
('Campana', 'Exaustão', 'avoid', 'Campânula', true),
('Exaustã', 'Exaustão', 'avoid', 'Hotte de Cozinha', true),
('Campânula de Exaustão', 'Exaustão', 'preferred', 'Hotte de Cozinha Industrial', true),
('Hotte', 'Exaustão', 'preferred', 'Hotte de Cozinha', true),
('Hotte Industrial', 'Exaustão', 'preferred', 'Hotte Industrial Inox', true),
('Coifa', 'Exaustão', 'synonym', 'Hotte', true),
('Apanha-fumos', 'Exaustão', 'synonym', 'Exaustor Industrial', true),
('Exaustor Industrial', 'Exaustão', 'preferred', 'Exaustor Industrial', true);

-- Add some other common industry terms
INSERT INTO public.business_terminology (term, category, type, replacement, is_global) VALUES
('Frigorifico', 'Frio', 'synonym', 'Frigorífico', true),
('Nevera', 'Frio', 'avoid', 'Frigorífico Profissional', true),
('Cocina', 'Cozedura', 'avoid', 'Fogão Industrial', true),
('Plancha', 'Cozedura', 'synonym', 'Chapa de Grelhar', true);
