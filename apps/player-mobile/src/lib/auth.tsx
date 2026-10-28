import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { errorMessage } from "@crowdquiz/shared";
import { getApi, getSupabase } from "./supabase";
import { deleteAllMyPhotos } from "./photos";
import { config, isConfigured } from "./config";

interface AuthState {
  ready: boolean;
  session: Session | null;
  user: User | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<{ needsEmailConfirmation: boolean }>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  /** Deletes the host's photos, then the account and everything it owns. */
  deleteAccount(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

function authMessage(raw: string): string {
  if (/invalid login/i.test(raw)) return "That email and password don't match.";
  if (/already registered|already been registered/i.test(raw)) return "An account with that email already exists. Try signing in.";
  if (/email not confirmed/i.test(raw)) return "Confirm your email first. We sent you a link.";
  if (/rate limit/i.test(raw)) return "Too many tries. Wait a minute and try again.";
  if (/network|fetch/i.test(raw)) return "Connection problem. Check your internet and try again.";
  return "Something went wrong. Try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!isConfigured);

  useEffect(() => {
    if (!isConfigured) return;
    const sb = getSupabase();
    void sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw new Error(authMessage(error.message));
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const { data, error } = await getSupabase().auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: { display_name: name.trim() },
        emailRedirectTo: config.siteUrl ? `${config.siteUrl}/auth/callback?next=/dashboard` : undefined,
      },
    });
    if (error) throw new Error(authMessage(error.message));
    return { needsEmailConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut();
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await getSupabase().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: config.siteUrl ? `${config.siteUrl}/auth/callback?next=/reset-password` : undefined,
    });
  }, []);

  const deleteAccount = useCallback(async () => {
    const sb = getSupabase();
    const { data: u } = await sb.auth.getUser();
    if (!u.user?.id) throw new Error("Please sign in again.");
    // Remove the host's photos first; they sit outside the database. Any the
    // website misses are queued for clean-up when the account is deleted.
    await deleteAllMyPhotos().catch(() => {});
    try {
      await getApi().deleteMyAccount();
    } catch (e) {
      throw new Error(errorMessage(e));
    }
    await sb.auth.signOut({ scope: "local" }).catch(() => {});
  }, []);

  const value = useMemo<AuthState>(
    () => ({ ready, session, user: session?.user ?? null, signIn, signUp, signOut, resetPassword, deleteAccount }),
    [ready, session, signIn, signUp, signOut, resetPassword, deleteAccount],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
