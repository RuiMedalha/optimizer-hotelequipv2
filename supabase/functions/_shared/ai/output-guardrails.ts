// supabase/functions/_shared/ai/output-guardrails.ts
// Post-processing guardrails for AI-generated product fields.
// All functions are pure (no side effects). Never throws.

/** Trim a string to maxLen characters at the last word boundary before the limit. */
function trimToWord(value: string, maxLen: number): string {
  if (!value || value.length <= maxLen) return value;
  const cut = value.substring(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 0 ? cut.substring(0, lastSpace).trimEnd() : cut;
}

/**
 * Trim a string to maxLen characters in an HTML-safe way.
 * Finds the last `>` before maxLen to avoid cutting inside a tag's content,
 * then walks back to before any unclosed `<` tag, then applies fallbackFn.
 * If no `>` exists before maxLen, delegates directly to fallbackFn.
 */
function trimHtmlSafe(
  value: string,
  maxLen: number,
  fallbackFn: (v: string, n: number) => string,
): string {
  if (!value || value.length <= maxLen) return value;
  // Find the last `>` at or before maxLen
  const cut = value.substring(0, maxLen);
  const lastClose = cut.lastIndexOf(">");
  if (lastClose < 0) {
    // No HTML structure detected — use fallback directly
    return fallbackFn(value, maxLen);
  }
  // Work from lastClose backward to find any unclosed `<`
  const beforeClose = cut.substring(0, lastClose + 1);
  const lastOpen = beforeClose.lastIndexOf("<");
  if (lastOpen >= 0) {
    // Check if there is a matching `>` after this `<` within beforeClose
    const closeAfterOpen = beforeClose.indexOf(">", lastOpen);
    if (closeAfterOpen < 0) {
      // Unclosed tag found — trim to before the `<`
      const safeEnd = beforeClose.substring(0, lastOpen).trimEnd();
      return fallbackFn(safeEnd, safeEnd.length);
    }
  }
  // All tags are closed — apply fallback to the cut at lastClose+1
  return fallbackFn(value, lastClose + 1);
}

/** Trim a string to maxLen characters at the last sentence boundary (. ! ?). */
function trimToSentence(value: string, maxLen: number): string {
  if (!value || value.length <= maxLen) return value;
  const cut = value.substring(0, maxLen);
  // Find the last sentence-ending punctuation before the cut point.
  // Check both "punct+space" and "punct+newline" patterns so sentences that
  // end right at or near the boundary are not missed.
  const lastSentence = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
    cut.lastIndexOf(".\n"),
    cut.lastIndexOf("!\n"),
    cut.lastIndexOf("?\n"),
    // Also handle sentence ending exactly at the cut boundary (no trailing space)
    cut.endsWith(".") ? cut.length - 1 : -1,
    cut.endsWith("!") ? cut.length - 1 : -1,
    cut.endsWith("?") ? cut.length - 1 : -1,
  );
  if (lastSentence > 0) {
    // Keep the punctuation character
    return cut.substring(0, lastSentence + 1).trimEnd();
  }
  // Fall back to word boundary if no sentence boundary found
  return trimToWord(value, maxLen);
}

/** Normalize an SEO slug: lowercase, trim, replace spaces/underscores with hyphens. */
function normalizeSlug(value: string, maxLen: number): string {
  if (!value) return value;
  return value
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .substring(0, maxLen)
    .replace(/-+$/, ""); // remove trailing hyphens
}

export interface OptimizedFields {
  optimized_title?: string;
  meta_title?: string;
  meta_description?: string;
  seo_slug?: string;
  optimized_short_description?: string;
  optimized_description?: string;
  [key: string]: unknown;
}

/**
 * Apply field-level length guardrails to AI-generated product fields.
 * Returns a new object — does not mutate the input.
 *
 * Limits:
 *   optimized_title              → 100 chars (word boundary)
 *   meta_title                   → 60 chars (word boundary)
 *   meta_description             → 160 chars (sentence boundary)
 *   seo_slug                     → 100 chars (slug normalization)
 *   optimized_short_description  → 1000 chars (sentence boundary)
 */
export function enforceFieldLimits(fields: OptimizedFields): OptimizedFields {
  const result = { ...fields };

  if (typeof result.optimized_title === "string") {
    result.optimized_title = trimToWord(result.optimized_title, 100);
  }
  if (typeof result.meta_title === "string") {
    result.meta_title = trimToWord(result.meta_title, 60);
  }
  if (typeof result.meta_description === "string") {
    result.meta_description = trimToSentence(result.meta_description, 160);
  }
  if (typeof result.seo_slug === "string") {
    result.seo_slug = normalizeSlug(result.seo_slug, 100);
  }
  if (typeof result.optimized_short_description === "string") {
    result.optimized_short_description = trimHtmlSafe(
      result.optimized_short_description,
      1000,
      trimToSentence,
    );
  }
  if (typeof result.optimized_description === "string") {
    result.optimized_description = trimHtmlSafe(
      result.optimized_description,
      5000,
      trimToWord,
    );
  }

  return result;
}

/** Result of output validation. */
export interface ValidationResult {
  valid: boolean;
  issues: string[];
}

/**
 * Derive which fields should be treated as required based on what was requested.
 * If no requestedFields provided, uses the legacy default set.
 */
export function getRequiredFields(requestedFields?: string[]): string[] {
  if (!requestedFields || requestedFields.length === 0) {
    return ["optimized_title", "optimized_short_description", "meta_title", "meta_description"];
  }
  const required: string[] = [];
  if (requestedFields.includes("title")) required.push("optimized_title");
  if (requestedFields.includes("short_description")) required.push("optimized_short_description");
  if (requestedFields.includes("meta_title")) required.push("meta_title");
  if (requestedFields.includes("meta_description")) required.push("meta_description");
  return required;
}

/**
 * Validate AI-generated product output fields.
 * Returns { valid: boolean; issues: string[] }.
 * Does not throw. Issues array is empty when valid === true.
 *
 * Checks:
 *   1. Required fields are present and non-empty.
 *   2. Description fields end with sentence-ending punctuation (not abrupt).
 *   3. HTML fields do not have broken (unclosed) tags.
 *   4. No unresolved placeholders ({{...}}) in any text field.
 */
export function validateProductOutput(fields: OptimizedFields, requestedFields?: string[]): ValidationResult {
  const issues: string[] = [];

  // 1. Required fields must be non-empty strings (dynamic based on requested fields)
  const REQUIRED = getRequiredFields(requestedFields);
  for (const field of REQUIRED) {
    const val = fields[field];
    if (typeof val !== "string" || val.trim().length === 0) {
      issues.push(`required field "${field}" is empty or missing`);
    }
  }

  // 2. Description fields must not end abruptly (last visible char must be sentence-ending punctuation)
  const DESCRIPTION_FIELDS = [
    "optimized_short_description",
    "optimized_description",
  ] as const;
  for (const field of DESCRIPTION_FIELDS) {
    const val = fields[field];
    if (typeof val !== "string" || val.trim().length === 0) continue;
    // Strip HTML tags to get visible text
    const visibleText = val.replace(/<[^>]+>/g, "").trim();
    if (visibleText.length === 0) continue;
    const lastChar = visibleText[visibleText.length - 1];
    if (!/[.!?]/.test(lastChar)) {
      issues.push(`field "${field}" ends abruptly (last visible char: "${lastChar}")`);
    }
  }

  // 3. HTML fields must not have broken (unclosed) tags
  const HTML_FIELDS = [
    "optimized_short_description",
    "optimized_description",
  ] as const;
  for (const field of HTML_FIELDS) {
    const val = fields[field];
    if (typeof val !== "string" || val.trim().length === 0) continue;
    // Check for any `<tag...` without a matching `>` — simple heuristic
    const openWithoutClose = /<[^>]*$/.test(val);
    if (openWithoutClose) {
      issues.push(`field "${field}" contains an unclosed HTML tag`);
    }
    // Check for unmatched block-level open tags (e.g. <table without </table>)
    const BLOCK_TAGS = ["table", "thead", "tbody", "tr", "td", "th", "ul", "ol", "li"];
    for (const tag of BLOCK_TAGS) {
      const openCount = (val.match(new RegExp(`<${tag}[\\s>]`, "gi")) || []).length;
      const closeCount = (val.match(new RegExp(`</${tag}>`, "gi")) || []).length;
      if (openCount !== closeCount) {
        issues.push(
          `field "${field}" has mismatched <${tag}> tags (${openCount} open, ${closeCount} close)`,
        );
      }
    }
  }

  // 4. No unresolved placeholders ({{...}}) in any text field
  const PLACEHOLDER_REGEX = /\{\{[^}]+\}\}/g;
  const ALL_TEXT_FIELDS = [
    "optimized_title", "optimized_short_description", "optimized_description",
    "meta_title", "meta_description",
  ];
  for (const field of ALL_TEXT_FIELDS) {
    const val = fields[field];
    if (typeof val === "string" && PLACEHOLDER_REGEX.test(val)) {
      const matches = val.match(PLACEHOLDER_REGEX) || [];
      issues.push(`field "${field}" contains unresolved placeholder(s): ${matches.join(", ")}`);
    }
  }

  return { valid: issues.length === 0, issues };
}
