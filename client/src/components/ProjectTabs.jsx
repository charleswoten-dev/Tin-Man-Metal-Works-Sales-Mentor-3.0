import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { ChatIcon, ProgressIcon } from './Icons.jsx';
import './ProjectTabs.css';

// Unified project workspace bar shown atop both Chat and Progress. The project
// picker here is the single source of truth: selecting a project makes it the
// active project everywhere, so the chat thread AND the progress detail both
// follow it. The Chat/Progress tabs flip between the two views for that same
// project without ever touching the sidebar.
export default function ProjectTabs({ active }) {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  // Reflect a fresh pick instantly; clear it once the profile refetch catches up.
  const [optimisticId, setOptimisticId] = useState(undefined);
  const activeId = optimisticId !== undefined ? optimisticId : (profile?.active_project_id || null);

  useEffect(() => { setOptimisticId(undefined); }, [profile?.active_project_id]);

  // Keep the picker in sync with the project list (and any add/delete elsewhere).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const load = () => {
      supabase
        .from('projects')
        .select('id, name')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .then(({ data }) => { if (!cancelled) setProjects(data || []); });
    };
    load();
    window.addEventListener('tinman:projects-changed', load);
    return () => { cancelled = true; window.removeEventListener('tinman:projects-changed', load); };
  }, [user?.id]);

  // Set the active project on the profile — the one place every view reads from.
  async function selectProject(id) {
    const next = id || null;
    if (next === activeId || !user?.id) return;
    setOptimisticId(next);
    await supabase.from('profiles').update({ active_project_id: next }).eq('id', user.id);
    refreshProfile?.();
    window.dispatchEvent(new Event('tinman:projects-changed'));
  }

  return (
    <div className="project-tabs">
      <div className="project-tabs-project">
        <span className="project-tabs-label">Project</span>
        <select
          className="project-tabs-select"
          value={activeId || ''}
          onChange={(e) => selectProject(e.target.value || null)}
          title="Switch project"
        >
          <option value="">General</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="project-tabs-toggle" role="tablist" aria-label="Project view">
        <button
          type="button"
          role="tab"
          aria-selected={active === 'chat'}
          className={'project-tab' + (active === 'chat' ? ' active' : '')}
          onClick={() => active !== 'chat' && navigate('/chat')}
        >
          <ChatIcon className="project-tab-icon" width={16} height={16} />
          <span>Chat</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === 'progress'}
          className={'project-tab' + (active === 'progress' ? ' active' : '')}
          onClick={() => active !== 'progress' && navigate('/progress')}
        >
          <ProgressIcon className="project-tab-icon" width={16} height={16} />
          <span>Progress</span>
        </button>
      </div>
    </div>
  );
}
