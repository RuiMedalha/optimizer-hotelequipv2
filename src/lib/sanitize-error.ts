// src/lib/sanitize-error.ts
// Converts raw error strings (including HTML error pages) to clean user-facing messages.

/**
 * Detects HTML content in an error string and returns a clean message.
 * For normal strings, truncates if too long.
 */
export function sanitizeErrorMessage(raw: string): { message: string; hasDetail: boolean } {
  if (!raw || !raw.trim()) return { message: "Erro desconhecido", hasDetail: false };

  // Detect HTML error pages (502, 503, etc.)
  if (/<html|<!doctype|<body|<head/i.test(raw)) {
    const titleMatch = raw.match(/<title[^>]*>([^<]+)<\/title>/i);
    const h1Match = raw.match(/<h\d[^>]*>([^<]+)<\/h\d>/i);
    const extracted = (titleMatch?.[1] || h1Match?.[1] || "Erro do servidor")
      .replace(/&[a-z]+;/gi, " ").trim();
    return { message: `Erro do provider/gateway: ${extracted}`, hasDetail: true };
  }

  // Truncate very long strings
  if (raw.length > 150) {
    return { message: raw.slice(0, 150) + "…", hasDetail: true };
  }

  return { message: raw, hasDetail: false };
}
