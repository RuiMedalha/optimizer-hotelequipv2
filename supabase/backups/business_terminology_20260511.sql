-- Backup of business_terminology before terminology expansion (2026-05-11)
-- To restore: DELETE FROM business_terminology; then run these statements

INSERT INTO business_terminology (term, type, replacement, category, is_global, workspace_id) VALUES
('Campana', 'avoid', 'Campânula', 'Exaustão', true, NULL),
('Exaustã', 'avoid', 'Hotte de Cozinha', 'Exaustão', true, NULL),
('Campânula de Exaustão', 'preferred', 'Hotte de Cozinha Industrial', 'Exaustão', true, NULL),
('Hotte', 'preferred', 'Hotte de Cozinha', 'Exaustão', true, NULL),
('Hotte Industrial', 'preferred', 'Hotte Industrial Inox', 'Exaustão', true, NULL),
('Coifa', 'synonym', 'Hotte', 'Exaustão', true, NULL),
('Apanha-fumos', 'synonym', 'Exaustor Industrial', 'Exaustão', true, NULL),
('Exaustor Industrial', 'preferred', 'Exaustor Industrial', 'Exaustão', true, NULL),
('Frigorifico', 'synonym', 'Frigorífico', 'Frio', true, NULL),
('Nevera', 'avoid', 'Frigorífico Profissional', 'Frio', true, NULL),
('Cocina', 'avoid', 'Fogão Industrial', 'Cozedura', true, NULL),
('Plancha', 'synonym', 'Chapa de Grelhar', 'Cozedura', true, NULL);
