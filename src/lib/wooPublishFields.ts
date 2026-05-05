// WooCommerce publish field groups and individual fields

export interface WooPublishField {
  key: string;
  label: string;
  group: string;
  description?: string;
}

export interface WooPublishGroup {
  key: string;
  label: string;
  icon: string;
  fields: WooPublishField[];
}

export const WOO_PUBLISH_GROUPS: WooPublishGroup[] = [
  {
    key: "content",
    label: "Conteúdo",
    icon: "📝",
    fields: [
      { key: "title", label: "Título", group: "content" },
      { key: "description", label: "Descrição", group: "content" },
      { key: "short_description", label: "Descrição Curta", group: "content" },
    ],
  },
  {
    key: "extra_content",
    label: "Conteúdo Extra",
    icon: "📋",
    fields: [
      { key: "faq_in_description", label: "FAQ na Descrição", group: "extra_content", description: "Injeta as FAQ no final da descrição do produto" },
      { key: "faq_custom_field", label: "FAQ → Campo Custom (_product_faqs)", group: "extra_content", description: "Envia FAQ para meta field _product_faqs em formato repeater [{question, answer}]" },
      { key: "uso_profissional_in_description", label: "Uso Profissional na Descrição", group: "extra_content", description: "Injeta o bloco de uso profissional na descrição" },
      { key: "uso_profissional_custom_field", label: "Uso Profissional → Campo Custom (_product_conselhos)", group: "extra_content", description: "Envia uso profissional para meta field _product_conselhos em formato repeater [{title, description}]" },
    ],
  },
  {
    key: "media",
    label: "Media",
    icon: "🖼️",
    fields: [
      { key: "images", label: "Imagens", group: "media" },
      { key: "image_alt_text", label: "Alt Text das Imagens", group: "media" },
      { key: "skip_original_images", label: "Excluir imagens originais", group: "media", description: "Não enviar as imagens originais se existirem versões otimizadas" },
      { key: "skip_lifestyle_images", label: "Excluir imagens lifestyle", group: "media", description: "Não enviar as imagens lifestyle geradas por IA" },
    ],
  },
  {
    key: "pricing",
    label: "Preço",
    icon: "💰",
    fields: [
      { key: "price", label: "Preço Regular", group: "pricing" },
      { key: "sale_price", label: "Preço Promocional", group: "pricing" },
    ],
  },
  {
    key: "taxonomy",
    label: "Taxonomias",
    icon: "🏷️",
    fields: [
      { key: "categories", label: "Categorias", group: "taxonomy" },
      { key: "tags", label: "Tags", group: "taxonomy" },
    ],
  },
  {
    key: "seo",
    label: "SEO (Yoast/RankMath)",
    icon: "🔍",
    fields: [
      { key: "meta_title", label: "Meta Title", group: "seo" },
      { key: "meta_description", label: "Meta Description", group: "seo" },
      { key: "slug", label: "Slug", group: "seo" },
    ],
  },
  {
    key: "commercial",
    label: "Comercial",
    icon: "🔗",
    fields: [
      { key: "sku", label: "SKU", group: "commercial" },
      { key: "upsells", label: "Upsells", group: "commercial" },
      { key: "crosssells", label: "Cross-sells", group: "commercial" },
    ],
  },
];

export const ALL_WOO_FIELD_KEYS = WOO_PUBLISH_GROUPS.flatMap(g => g.fields.map(f => f.key));

export const DEFAULT_WOO_FIELDS = ALL_WOO_FIELD_KEYS.filter(k => 
  k !== "meta_title" && k !== "meta_description" && k !== "slug" &&
  k !== "faq_custom_field" && k !== "uso_profissional_custom_field"
);

export const SETTING_KEY_WOO_PUBLISH_FIELDS = "woo_publish_fields_json";
