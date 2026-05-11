-- Backup de dados da tabela business_terminology em 2026-05-11
-- Para restaurar: DELETE FROM business_terminology; e depois executar estes INSERTS.

INSERT INTO public.business_terminology (term, type, replacement, category, is_global, workspace_id) VALUES
('Campana', 'synonym', 'Campânula', 'Exaustão', true, NULL),
('Campana', 'synonym', 'Hotte', 'Exaustão', true, NULL),
('Cocina', 'avoid', 'Fogão Industrial', 'Cozedura', true, NULL),
('Plancha', 'synonym', 'Chapa de Grelhar', 'Cozedura', true, NULL);
