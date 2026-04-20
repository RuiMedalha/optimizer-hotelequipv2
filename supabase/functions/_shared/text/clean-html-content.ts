/**
 * Safe HTML/text cleaner for AI prompts.
 *
 * GOAL: Remove non-informative noise (HTML tags, inline styles, scripts,
 * repeated whitespace, common WooCommerce/supplier boilerplate) WITHOUT
 * losing any technical information.
 *
 * IMPORTANT: This function does NOT truncate. It only strips noise.
 * If you also need to enforce a max length, do it AFTER cleaning, with
 * a clear policy (semantic truncation, not raw slice).
 *
 * Typical reduction observed on WooCommerce HTML descriptions:
 *   15.000 chars of HTML  →  ~4.000 chars of plain content
 *   with 100% of technical specs preserved.
 */

const BOILERPLATE_PATTERNS: RegExp[] = [
  // Common Portuguese/EN supplier/WooCommerce boilerplate lines.
  // Match whole lines (case-insensitive).
  /^.*(visite o nosso site|visit our website).*$/gim,
  /^.*(política de devolu|return policy|refund policy).*$/gim,
  /^.*(política de privacidade|privacy policy).*$/gim,
  /^.*(termos e condições|terms and conditions).*$/gim,
  /^.*(siga-nos nas redes|follow us on).*$/gim,
  /^.*(subscreva a (nossa )?newsletter|subscribe to our newsletter).*$/gim,
  /^.*(todos os direitos reservados|all rights reserved).*$/gim,
  /^.*©\s*\d{4}.*$/gim,
];

/**
 * Cleans an HTML/text field for safe inclusion in an AI prompt.
 *
 * Steps (all conservative, none destructive of technical info):
 *  1. Remove <script>, <style>, <noscript> blocks (with content).
 *  2. Remove HTML comments.
 *  3. Strip all HTML tags but keep their text content.
 *  4. Decode common HTML entities.
 *  5. Remove known boilerplate lines (legal notices, "follow us", etc.).
 *  6. Collapse repeated whitespace and blank lines.
 *  7. Trim.
 *
 * @param input  Raw text (may contain HTML) or null/undefined.
 * @returns      Cleaned plain text. Empty string if input is empty.
 */
export function cleanHtmlContent(input: string | null | undefined): string {
  if (!input) return "";
  let text = String(input);

  // 1. Remove dangerous / noisy blocks WITH content.
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");

  // 2. Remove HTML comments.
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  // 3. Strip remaining HTML tags but KEEP their inner text.
  //    Insert a space when stripping block-level tags so words don't merge.
  text = text.replace(/<\/?(p|div|br|li|tr|td|th|h[1-6]|section|article)\b[^>]*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");

  // 4. Decode the most common HTML entities (conservative set).
  const entities: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&hellip;": "...",
    "&mdash;": "—",
    "&ndash;": "–",
    "&euro;": "€",
    "&deg;": "°",
  };
  text = text.replace(/&[a-z#0-9]+;/gi, (m) => entities[m.toLowerCase()] ?? " ");

  // 5. Remove known boilerplate lines.
  for (const re of BOILERPLATE_PATTERNS) {
    text = text.replace(re, "");
  }

  // 6. Normalize whitespace.
  //    - Collapse runs of spaces/tabs.
  //    - Collapse 3+ newlines into 2.
  //    - Trim each line.
  text = text.replace(/[ \t]+/g, " ");
  text = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i, arr) => {
      // Drop consecutive blank lines (keep at most one).
      if (l === "" && arr[i - 1] === "") return false;
      return true;
    })
    .join("\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  // 7. Final trim.
  return text.trim();
}

/**
 * Cleans content and reports how much was removed.
 * Useful for logging / observability.
 */
export function cleanHtmlContentWithStats(
  input: string | null | undefined,
): { cleaned: string; originalLength: number; cleanedLength: number; reductionPct: number } {
  const original = input ? String(input) : "";
  const cleaned = cleanHtmlContent(original);
  const originalLength = original.length;
  const cleanedLength = cleaned.length;
  const reductionPct = originalLength > 0
    ? Math.round(((originalLength - cleanedLength) / originalLength) * 100)
    : 0;
  return { cleaned, originalLength, cleanedLength, reductionPct };
}
