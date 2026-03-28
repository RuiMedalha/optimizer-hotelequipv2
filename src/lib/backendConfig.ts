const FALLBACK_PROJECT_ID = "gnumneplpymgjztklcob";
const FALLBACK_BACKEND_URL = `https://${FALLBACK_PROJECT_ID}.supabase.co`;
const FALLBACK_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdudW1uZXBscHltZ2p6dGtsY29iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NjM3NzcsImV4cCI6MjA5MDEzOTc3N30.f1SvI8y7T5SFvSXMnPuvyZchPerDoea0fR8lO6oiBtA";

const envUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const envKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const backendConfig = {
  url: envUrl || FALLBACK_BACKEND_URL,
  publishableKey: envKey || FALLBACK_PUBLISHABLE_KEY,
  usingFallback: !envUrl || !envKey,
} as const;

export const hasRequiredBackendConfig = Boolean(
  backendConfig.url && backendConfig.publishableKey,
);