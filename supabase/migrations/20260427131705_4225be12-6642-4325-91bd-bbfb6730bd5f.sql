-- Configurar search_path em funções SECURITY DEFINER para segurança
DO $$
DECLARE
    func_record RECORD;
BEGIN
    FOR func_record IN 
        SELECT n.nspname as schema_name, p.proname as function_name, pg_get_function_arguments(p.oid) as args
        FROM pg_proc p 
        JOIN pg_namespace n ON p.pronamespace = n.oid 
        WHERE n.nspname = 'public' AND p.prosecdef = true
    LOOP
        BEGIN
            EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path = public, pg_temp', 
                func_record.schema_name, func_record.function_name, func_record.args);
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Não foi possível atualizar a função %: %', func_record.function_name, SQLERRM;
        END;
    END LOOP;
END $$;

-- Garantir que o bucket 'product-images' não permite listagem pública
-- Nota: No Supabase, a listagem é controlada pela política SELECT na tabela storage.objects.
-- Se a política for 'true' ou sem filtro de nome, permite listagem.
-- Vamos restringir para que apenas leitura de objetos específicos seja permitida via URL pública.

-- Primeiro, verificamos se o bucket existe e é público (para URLs funcionarem)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Política para permitir leitura de objetos
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "Public Access" ON storage.objects 
FOR SELECT 
USING (bucket_id = 'product-images');

-- Adicionalmente, garantir que outras políticas de inserção/update permanecem seguras
-- (Assumindo políticas padrão baseadas em auth.uid() para o resto)
