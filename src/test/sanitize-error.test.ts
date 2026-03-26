// src/test/sanitize-error.test.ts
// Imports the real module — do NOT inline the function here.
import { describe, it, expect } from "vitest";
import { sanitizeErrorMessage } from "../lib/sanitize-error";

describe("sanitizeErrorMessage", () => {
  it("returns clean message for normal error string", () => {
    const { message, hasDetail } = sanitizeErrorMessage("Timeout ao chamar o modelo");
    expect(message).toBe("Timeout ao chamar o modelo");
    expect(hasDetail).toBe(false);
  });

  it("detects 502 HTML error page and returns clean message", () => {
    const html = "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>";
    const { message, hasDetail } = sanitizeErrorMessage(html);
    expect(message).toContain("502 Bad Gateway");
    expect(message).not.toContain("<html");
    expect(hasDetail).toBe(true);
  });

  it("truncates very long error strings", () => {
    const long = "A".repeat(300);
    const { message, hasDetail } = sanitizeErrorMessage(long);
    expect(message.length).toBeLessThanOrEqual(154); // 150 + "…"
    expect(hasDetail).toBe(true);
  });

  it("handles empty string", () => {
    const { message } = sanitizeErrorMessage("");
    expect(message).toBe("Erro desconhecido");
  });

  it("handles HTML without title — falls back to generic", () => {
    const html = "<html><body>Service Unavailable</body></html>";
    const { message } = sanitizeErrorMessage(html);
    expect(message).toContain("Erro do provider/gateway");
    expect(message).not.toContain("<html");
  });
});
