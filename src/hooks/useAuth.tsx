import { useState, useEffect, useCallback, createContext, useContext } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { backendConfig } from "@/lib/backendConfig";
import { getStorageItem, removeStorageItem } from "@/lib/safeStorage";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_INIT_TIMEOUT_MS = 8000;

function getAuthStorageKey() {
  try {
    const projectId = new URL(backendConfig.url).hostname.split(".")[0];
    return projectId ? `sb-${projectId}-auth-token` : null;
  } catch {
    return null;
  }
}

function isSessionShape(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<Session>;
  return Boolean(
    typeof candidate.access_token === "string" &&
    typeof candidate.refresh_token === "string" &&
    typeof candidate.expires_at === "number" &&
    candidate.user,
  );
}

function readStoredSession(): Session | null {
  const storageKey = getAuthStorageKey();
  if (!storageKey) return null;

  const raw = getStorageItem(storageKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const candidate = parsed?.currentSession ?? parsed;
    return isSessionShape(candidate) ? candidate : null;
  } catch {
    removeStorageItem(storageKey);
    return null;
  }
}

function clearStoredSession() {
  const storageKey = getAuthStorageKey();
  if (storageKey) removeStorageItem(storageKey);
}

function isSessionStillUsable(session: Session | null) {
  if (!session?.expires_at) return false;
  const now = Math.floor(Date.now() / 1000);
  return session.expires_at > now + 30;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    });

    const initializeAuth = async () => {
      const storedSession = readStoredSession();

      try {
        const { data, error } = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error("Auth session restore timed out")), SESSION_INIT_TIMEOUT_MS);
          }),
        ]);

        if (error) throw error;
        if (!isMounted) return;
        setSession(data.session);
        setUser(data.session?.user ?? null);
      } catch (error) {
        if (!isMounted) return;

        if (isSessionStillUsable(storedSession)) {
          console.warn("[useAuth] Falling back to cached session after refresh failure", error);
          setSession(storedSession);
          setUser(storedSession.user);
        } else {
          clearStoredSession();
          setSession(null);
          setUser(null);
          console.error("[useAuth] Failed to restore session", error);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void initializeAuth();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? new Error(error.message) : null };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    return { error: error ? new Error(error.message) : null };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (err) {
      console.error("[useAuth] signOut error, forcing local clear", err);
      clearStoredSession();
    }
    // Always force-clear local state even if network call fails
    setSession(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
