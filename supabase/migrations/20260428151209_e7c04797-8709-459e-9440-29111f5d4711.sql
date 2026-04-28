-- Tabela de Aliases de SKU (Memória de Correspondência)
CREATE TABLE public.sku_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
    sku_site TEXT NOT NULL,
    sku_supplier TEXT NOT NULL,
    confirmed_by UUID REFERENCES auth.users(id),
    times_used INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(workspace_id, supplier_id, sku_supplier)
);

-- Tabela de Regras de Campo (Governança)
CREATE TYPE field_sync_rule AS ENUM ('supplier_wins', 'site_wins', 'lowest_value', 'manual_review');

CREATE TABLE public.field_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    rule field_sync_rule NOT NULL DEFAULT 'manual_review',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(workspace_id, supplier_id, field_name)
);

-- Tabela de Staging para Sincronização (O "Purgatório")
CREATE TYPE match_method_type AS ENUM ('exact', 'normalized', 'fuzzy', 'ean', 'manual');

CREATE TABLE public.sync_staging (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES public.supplier_profiles(id) ON DELETE CASCADE,
    ingestion_job_id UUID,
    
    -- Identidade
    sku_supplier TEXT,
    sku_site_target TEXT,
    existing_product_id UUID REFERENCES public.products(id),
    
    -- Scores de Confiança
    confidence_score INTEGER CHECK (confidence_score BETWEEN 0 AND 100),
    match_method match_method_type,
    
    -- Dados para Comparação (Diff)
    supplier_data JSONB NOT NULL,
    site_data JSONB, -- Estado atual no site (null se for novo produto)
    proposed_changes JSONB, -- O que o motor sugere aplicar
    
    -- Status do Processo
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'flagged')),
    review_notes TEXT,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    reviewed_by UUID REFERENCES auth.users(id),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.sku_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_staging ENABLE ROW LEVEL SECURITY;

-- Políticas de Acesso
CREATE POLICY "Users can manage their workspace aliases" ON public.sku_aliases
    FOR ALL USING (workspace_id IN (SELECT id FROM workspaces));

CREATE POLICY "Users can manage their workspace field rules" ON public.field_rules
    FOR ALL USING (workspace_id IN (SELECT id FROM workspaces));

CREATE POLICY "Users can manage their workspace sync staging" ON public.sync_staging
    FOR ALL USING (workspace_id IN (SELECT id FROM workspaces));

-- Gatilhos para Updated At
CREATE TRIGGER update_sku_aliases_updated_at BEFORE UPDATE ON public.sku_aliases FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_field_rules_updated_at BEFORE UPDATE ON public.field_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sync_staging_updated_at BEFORE UPDATE ON public.sync_staging FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();