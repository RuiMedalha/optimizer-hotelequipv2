import type { Product } from "@/hooks/useProducts";

export interface SeoCheck {
  label: string;
  passed: boolean;
  weight: number;
  detail: string;
}

export function calculateSeoScore(product: Product): { score: number; checks: SeoCheck[] } {
  const checks: SeoCheck[] = [];

  // 1. Meta title exists and good length
  const metaTitle = product.meta_title ?? "";
  const mtLen = metaTitle.length;
  checks.push({
    label: "Meta Title",
    passed: mtLen >= 20 && mtLen <= 60,
    weight: 15,
    detail: mtLen === 0 ? "Em falta" : mtLen < 20 ? `Muito curto (${mtLen}/20)` : mtLen > 60 ? `Muito longo (${mtLen}/60)` : `OK (${mtLen} chars)`,
  });

  // 2. Meta description exists and good length
  const metaDesc = product.meta_description ?? "";
  const mdLen = metaDesc.length;
  checks.push({
    label: "Meta Description",
    passed: mdLen >= 50 && mdLen <= 160,
    weight: 15,
    detail: mdLen === 0 ? "Em falta" : mdLen < 50 ? `Muito curta (${mdLen}/50)` : mdLen > 160 ? `Muito longa (${mdLen}/160)` : `OK (${mdLen} chars)`,
  });

  // 3. SEO Slug exists
  const slug = product.seo_slug ?? "";
  checks.push({
    label: "SEO Slug",
    passed: slug.length > 0,
    weight: 10,
    detail: slug.length === 0 ? "Em falta" : `OK (${slug})`,
  });

  // 4. Focus keywords (array) - check if at least one exists and is present in meta title
  const focusKws: string[] = Array.isArray(product.focus_keyword) ? product.focus_keyword : [];
  if (focusKws.length > 0) {
    const primaryKw = focusKws[0];
    const normalizeStr = (s: string) => s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const keywordNorm = normalizeStr(primaryKw);
    const titleNorm = normalizeStr(metaTitle);
    const inTitle = titleNorm.includes(keywordNorm);
    
    checks.push({
      label: "Keyword no Meta Title",
      passed: inTitle,
      weight: 10,
      detail: inTitle ? `"${primaryKw}" presente` : `"${primaryKw}" ausente`,
    });
  } else {
    checks.push({
      label: "Focus Keywords",
      passed: false,
      weight: 10,
      detail: "Nenhuma definida",
    });
  }

  // 5. Optimized title exists
  checks.push({
    label: "Título Otimizado",
    passed: (product.optimized_title ?? "").length > 10,
    weight: 10,
    detail: (product.optimized_title ?? "").length === 0 ? "Em falta" : "OK",
  });

  // 6. Optimized description exists and has good length
  const desc = product.optimized_description ?? "";
  checks.push({
    label: "Descrição Otimizada",
    passed: desc.length > 100,
    weight: 10,
    detail: desc.length === 0 ? "Em falta" : desc.length < 100 ? `Curta (${desc.length} chars)` : "OK",
  });

  // 7. Short description
  checks.push({
    label: "Descrição Curta",
    passed: (product.optimized_short_description ?? "").length > 20,
    weight: 5,
    detail: (product.optimized_short_description ?? "").length === 0 ? "Em falta" : "OK",
  });

  // 8. FAQ present
  const faq = Array.isArray(product.faq) ? product.faq : [];
  checks.push({
    label: "FAQ",
    passed: faq.length >= 3,
    weight: 10,
    detail: faq.length === 0 ? "Em falta" : `${faq.length} pergunta(s)`,
  });

  // 9. Image alt texts — can be array [{url,alt_text}] or object {url: alt_text}
  const rawAlt = (product as any).image_alt_texts;
  let altCount = 0;
  if (Array.isArray(rawAlt)) {
    altCount = rawAlt.filter((a: any) => a?.alt_text || (typeof a === "string" && a)).length;
  } else if (rawAlt && typeof rawAlt === "object") {
    altCount = Object.values(rawAlt).filter((v: any) => typeof v === "string" && v.trim()).length;
  }
  const imageCount = (product.image_urls ?? []).length;
  checks.push({
    label: "Alt Text Imagens",
    passed: imageCount > 0 && altCount >= imageCount,
    weight: 10,
    detail: imageCount === 0 ? "Sem imagens" : `${altCount}/${imageCount} preenchidos`,
  });

  // 10. Headings H1/H2/H3 hierarchy
  const descHtml = product.optimized_description ?? "";
  const headingCheck = analyzeHeadingHierarchy(descHtml, focusKws);
  checks.push({
    label: "Headings H1/H2/H3",
    passed: headingCheck.failedCount === 0,
    weight: 10,
    detail: headingCheck.summary,
  });

  // 11. Category defined
  checks.push({
    label: "Categoria",
    passed: (product.category ?? "").length > 0,
    weight: 5,
    detail: (product.category ?? "").length === 0 ? "Em falta" : "OK",
  });

  // Calculate score
  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  const earnedWeight = checks.filter(c => c.passed).reduce((sum, c) => sum + c.weight, 0);
  const score = Math.round((earnedWeight / totalWeight) * 100);

  return { score, checks };
}

interface HeadingAnalysis {
  rules: { label: string; passed: boolean; message: string }[];
  failedCount: number;
  summary: string;
}

export function analyzeHeadingHierarchy(html: string, focusKeywords: string[]): HeadingAnalysis {
  const rules: { label: string; passed: boolean; message: string }[] = [];

  if (typeof window === "undefined" || !html) {
    return { rules: [], failedCount: 0, summary: "Sem descrição para analisar" };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const h1s = doc.querySelectorAll("h1");
  const h2s = doc.querySelectorAll("h2");
  const h3s = doc.querySelectorAll("h3");

  // RULE 1: No H1 in description
  const noH1 = h1s.length === 0;
  rules.push({
    label: "H1",
    passed: noH1,
    message: noH1 ? `H1: ausente ✅` : `H1 encontrado na descrição — deve ser apenas o título do produto`,
  });

  // RULE 2: At least 2 H2 or H3
  const hasEnoughHeadings = h2s.length >= 2 || h3s.length >= 2;
  rules.push({
    label: "H2/H3",
    passed: hasEnoughHeadings,
    message: hasEnoughHeadings
      ? `H2/H3: ${h2s.length + h3s.length} encontrados ✅`
      : `Adiciona pelo menos 2 secções com H2 ou H3`,
  });

  // RULE 3: Focus keyword in first H2 or H3
  const firstHeading = doc.querySelector("h2, h3");
  const firstHeadingText = firstHeading?.textContent?.toLowerCase() ?? "";
  const kwInHeading = focusKeywords.length > 0 && focusKeywords.some(kw =>
    kw.split(/\s+/).some(word => firstHeadingText.includes(word.toLowerCase()))
  );
  const kwCheckApplicable = focusKeywords.length > 0 && firstHeading;
  rules.push({
    label: "Keyword",
    passed: !kwCheckApplicable || kwInHeading,
    message: kwInHeading || !kwCheckApplicable
      ? `Keyword no heading: ${kwInHeading ? "✅" : "N/A"}`
      : `Focus keyword ausente nos headings da descrição`,
  });

  // RULE 4: No skipping levels (H3 without H2)
  // In WooCommerce, H2 is used for the product title, so H3 in description is acceptable
  const h3WithoutH2 = h3s.length > 0 && h2s.length === 0;
  rules.push({
    label: "Hierarquia",
    passed: true, // Always pass — H3-only is acceptable in WooCommerce context
    message: h3WithoutH2
      ? `Hierarquia: H3 sem H2 (aceitável — WooCommerce usa H2 no título) ✅`
      : `Hierarquia: OK ✅`,
  });

  const failedCount = rules.filter(r => !r.passed).length;
  const summary = rules.map(r => r.message).join(" | ");

  return { rules, failedCount, summary };
}

export function getSeoFixSuggestions(checks: SeoCheck[]): string[] {
  const suggestions: string[] = [];
  for (const check of checks) {
    if (check.passed) continue;
    switch (check.label) {
      case "Meta Title":
        suggestions.push("Otimize o produto para gerar um Meta Title com 20-60 caracteres.");
        break;
      case "Meta Description":
        suggestions.push("Otimize a Fase 2 (SEO) para gerar uma Meta Description com 50-160 caracteres.");
        break;
      case "SEO Slug":
        suggestions.push("Execute a otimização SEO para gerar automaticamente o slug.");
        break;
      case "Focus Keywords":
      case "Keyword no Meta Title":
        suggestions.push("Otimize o produto para gerar Focus Keywords e garantir que aparecem no título.");
        break;
      case "Título Otimizado":
        suggestions.push("Execute a Fase 1 (Conteúdo Base) para gerar um título otimizado.");
        break;
      case "Descrição Otimizada":
        suggestions.push("Otimize a Fase 1 para gerar uma descrição detalhada (>100 caracteres).");
        break;
      case "Descrição Curta":
        suggestions.push("Otimize a Fase 1 para gerar uma descrição curta para o WooCommerce.");
        break;
      case "FAQ":
        suggestions.push("Otimize a Fase 2 (SEO) para gerar pelo menos 3 perguntas FAQ.");
        break;
      case "Alt Text Imagens":
        suggestions.push("Otimize a Fase 2 para gerar alt text para todas as imagens do produto.");
        break;
      case "Categoria":
        suggestions.push("Defina manualmente ou otimize com Fase 1 para sugerir uma categoria.");
        break;
      case "Headings H1/H2/H3":
        suggestions.push("Revise a descrição para ter hierarquia de headings correta (sem H1, pelo menos 2 H2/H3, keyword no primeiro heading).");
        break;
    }
  }
  return suggestions;
}

export function getSeoScoreColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  return "text-red-600";
}

export function getSeoScoreBg(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 50) return "bg-yellow-500";
  return "bg-red-500";
}
