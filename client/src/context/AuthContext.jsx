import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
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

  // Serialize active-project switches. The active project is a single field on
  // the profile that many views read. When the user switches projects quickly,
  // firing several independent "update + refetch" round-trips lets them resolve
  // OUT OF ORDER, so the app can settle on whichever request happened to land
  // last instead of the project they actually clicked last (in chat this reads
  // as "the bot forgot what it was doing" — you're on the wrong project's
  // thread). Fix: update the local profile optimistically and IMMEDIATELY (so
  // every view switches deterministically in click order), and chain the DB
  // writes so they commit in the same order — the last click always wins.
  const activeChainRef = useRef(Promise.resolve());
  const setActiveProject = useCallback(
    (id) => {
      const next = id || null;
      setProfile((p) => (p ? { ...p, active_project_id: next } : p));
      const run = activeChainRef.current
        .catch(() => {})
        .then(async () => {
          const uid = session?.user?.id;
          if (!uid) return;
          await supabase.from('profiles').update({ active_project_id: next }).eq('id', uid);
        });
      activeChainRef.current = run;
      return run;
    },
    [session?.user?.id]
  );

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
    setActiveProject,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
