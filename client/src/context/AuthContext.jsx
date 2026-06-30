import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (uid) => {
    if (!uid) {
      setProfile(null);
      return null;
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single();
    setProfile(data ?? null);
    return data ?? null;
  }, []);

  useEffect(() => {
    let mounted = true;

    // Supabase getSession() can hang indefinitely if the project is unreachable
    // (e.g. free-tier auto-pause), freezing the app on the splash screen because
    // setLoading(false) never runs. Force-clear loading after 8s so we fall
    // through to the sign-in screen instead of spinning forever.
    const timeout = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 8000);

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (mounted) setSession(data.session);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
        clearTimeout(timeout);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (mounted) setSession(newSession);
    });
    return () => {
      mounted = false;
      clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load the profile row whenever the signed-in user changes.
  useEffect(() => {
    fetchProfile(session?.user?.id);
  }, [session?.user?.id, fetchProfile]);

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    signIn: (email, password) =>
      supabase.auth.signInWithPassword({ email, password }),
    signUp: (email, password) =>
      supabase.auth.signUp({ email, password }),
    signOut: () => supabase.auth.signOut(),
    refreshProfile: () => fetchProfile(session?.user?.id),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
