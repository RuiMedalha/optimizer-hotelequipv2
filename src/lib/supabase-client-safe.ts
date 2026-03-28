import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { backendConfig } from "@/lib/backendConfig";

if (backendConfig.usingFallback) {
  console.warn("[boot] Missing build-time backend config, using embedded publishable fallback.");
}

export const supabase = createClient<Database>(backendConfig.url, backendConfig.publishableKey, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});