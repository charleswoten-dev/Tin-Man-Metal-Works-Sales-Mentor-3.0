import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import OnboardingTour from './OnboardingTour.jsx';
import OnboardingQuestions from './OnboardingQuestions.jsx';
import ApiTransition from './ApiTransition.jsx';
import StartFreshModal from './StartFreshModal.jsx';
import ImportCalculatorData from './ImportCalculatorData.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import './Layout.css';

export default function Layout() {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [savesCount, setSavesCount] = useState(0);
  const [projects, setProjects] = useState([]); // [{ id, name }] for the sidebar switcher
  const [activeId, setActiveId] = useState(null); // selected project id (optimistic)
  const [activeCount, setActiveCount] = useState(0); // completed steps in the selected project
  const [startFreshOpen, setStartFreshOpen] = useState(false);
  const [replayTour, setReplayTour] = useState(false); // user-triggered re-run of the menu tour

  // Let any screen replay the menu walkthrough by firing this event (e.g. the
  // "Replay walkthrough" button in the Chat header).
  useEffect(() => {
    const onReplay = () => setReplayTour(true);
    window.addEventListener('tinman:replay-tour', onReplay);
    return () => window.removeEventListener('tinman:replay-tour', onReplay);
  }, []);

  // Mirror the persisted active project into local state so the sidebar can
  // also update it optimistically when the user switches.
  useEffect(() => {
    setActiveId(profile?.active_project_id || null);
  }, [profile?.active_project_id]);

  // Load the projects list + the active project's completed-step count. Exposed
  // so it can run on route change AND in response to the projects-changed event.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const load = () => {
      supabase
        .from('saves')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .then(({ count }) => !cancelled && setSavesCount(count || 0));
      supabase
        .from('projects')
        .select('id, name')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .then(({ data }) => !cancelled && setProjects(data || []));
      if (!activeId) {
        setActiveCount(0);
        return;
      }
      supabase
        .from('project_steps')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', activeId)
        .eq('completed', true)
        .then(({ count }) => !cancelled && setActiveCount(count || 0));
    };

    load();
    window.addEventListener('tinman:projects-changed', load);
    return () => {
      cancelled = true;
      window.removeEventListener('tinman:projects-changed', load);
    };
  }, [user?.id, location.pathname, activeId]);

  // Switch the active project from the sidebar: set it active (so the
  // walkthrough saves into it + the slider tracks it) and open its detail view.
  const handleSelectProject = async (project) => {
    if (!user?.id) return;
    setActiveId(project.id); // optimistic — slider/highlight update immediately
    await supabase.from('profiles').update({ active_project_id: project.id }).eq('id', user.id);
    refreshProfile?.();
    navigate('/progress', { state: { openProjectId: project.id } });
  };

  // Prefer the onboarding name; fall back to the email handle until it's set.
  const displayName =
    profile?.name || user?.email?.split('@')[0] || 'Friend';

  // Wipe the user's data back to a brand-new account, then hard-reload so the
  // chat clears and onboarding runs again. Account + connected API key are kept.
  const handleStartFreshConfirm = async () => {
    if (!user?.id) return false;
    try {
      await Promise.all([
        supabase.from('messages').delete().eq('user_id', user.id),
        supabase.from('saves').delete().eq('user_id', user.id),
        supabase.from('progress').delete().eq('user_id', user.id),
        supabase.from('wins').delete().eq('user_id', user.id),
      ]);
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({
          name: null,
          plasma_work: null,
          time_in_business: null,
          work_status: null,
          monthly_revenue: null,
          best_products: null,
          best_customers: null,
          biggest_struggle: null,
          niche: null,
          onboarding_completed: false,
          tour_completed: false,
        })
        .eq('id', user.id);
      if (profileErr) return false;
      window.location.href = '/chat';
      return true;
    } catch {
      return false;
    }
  };

  // Mark the walkthrough done so it never auto-shows again. Also clears a manual
  // replay so the tour closes when finished/skipped.
  const finishTour = async () => {
    setReplayTour(false);
    if (user?.id) {
      await supabase.from('profiles').update({ tour_completed: true }).eq('id', user.id);
      refreshProfile?.();
    }
  };

  // First-run flow: collect onboarding answers, THEN run the guided tour. Each
  // gate waits for the profile to load so we don't flash either prematurely.
  // A manual replay also shows the tour (once onboarding is done).
  const showOnboarding = Boolean(profile) && profile.onboarding_completed === false;
  const showTour =
    Boolean(profile) &&
    profile.onboarding_completed === true &&
    (replayTour || profile.tour_completed === false);

  return (
    <div className="app-shell">
      <Sidebar
        user={{ name: displayName }}
        projects={projects}
        activeProjectId={activeId}
        activeProjectCount={activeCount}
        onSelectProject={handleSelectProject}
        savesCount={savesCount}
        onStartFresh={() => setStartFreshOpen(true)}
        onSignOut={signOut}
      />
      <main className="app-content">
        {!showOnboarding && !showTour && <ApiTransition />}
        <Outlet />
      </main>
      {showOnboarding && <OnboardingQuestions onFinish={refreshProfile} />}
      {showTour && <OnboardingTour onFinish={finishTour} />}
      {/* Offer to import data carried over from the free calculator — only once
          onboarding + tour are done so prompts don't stack. */}
      {!showOnboarding && !showTour && <ImportCalculatorData />}
      {startFreshOpen && (
        <StartFreshModal
          onConfirm={handleStartFreshConfirm}
          onCancel={() => setStartFreshOpen(false)}
        />
      )}
    </div>
  );
}
