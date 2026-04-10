import { createContext, useContext, type Context } from "react";
import type { Session, User } from "@supabase/supabase-js";

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

declare global {
  var __HOTEL_EQUIP_AUTH_CONTEXT__:
    | Context<AuthContextType | undefined>
    | undefined;
}

const globalAuthContext = globalThis as typeof globalThis & {
  __HOTEL_EQUIP_AUTH_CONTEXT__?: Context<AuthContextType | undefined>;
};

export const AuthContext =
  globalAuthContext.__HOTEL_EQUIP_AUTH_CONTEXT__ ??
  createContext<AuthContextType | undefined>(undefined);

if (!globalAuthContext.__HOTEL_EQUIP_AUTH_CONTEXT__) {
  globalAuthContext.__HOTEL_EQUIP_AUTH_CONTEXT__ = AuthContext;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}