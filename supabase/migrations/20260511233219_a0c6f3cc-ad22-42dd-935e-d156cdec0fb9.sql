INSERT INTO business_terminology 
  (term, type, replacement, category, context, disambiguation, is_global) 
VALUES 
('Estantería','avoid','Móvel de Prateleiras Inox','Mobiliário','title',
 'REGRA: Se tem patas/pés reguláveis → "Móvel de Prateleiras Inox". Se fixo à parede → "Prateleira Mural Inox". NUNCA traduzir como "Estante" simples.',
 true),
('Mueble','avoid','Móvel Inox','Mobiliário','title',
 'Prefixo espanhol para móvel. Traduzir para o tipo específico: "Móvel de Prateleiras", "Módulo Neutro", "Armário Inox" conforme análise do produto.',
 true),
('Módulo de Prateleiras Inox','preferred',null,'Mobiliário','title',
 'Para móveis autoportantes com prateleiras e patas reguláveis.',
 true),
('Prateleira Mural Inox','preferred',null,'Mobiliário','title',
 'Para prateleiras fixas à parede sem patas.',
 true),
('Módulo Neutro Inox','preferred',null,'Mobiliário','title',
 'Para módulos neutros de apoio sem função térmica.',
 true)
ON CONFLICT DO NOTHING;