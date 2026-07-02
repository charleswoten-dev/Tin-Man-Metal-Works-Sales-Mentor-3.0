import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { YBR_STEPS } from '../lib/ybrSteps.js';
import { WALKTHROUGH_KICKOFF, walkthroughKickoffForProject } from '../lib/walkthrough.js';
import { CheckIcon } from '../components/Icons.jsx';
import ProjectTabs from '../components/ProjectTabs.jsx';
import ProductAssets from '../components/ProductAssets.jsx';
import './Progress.css';

export default function Progress() {
  const { user, profile, refreshProfile } = useAuth();
  const activeId = profile?.active_project_id || null;
  const navigate = useNavigate();
  const location = useLocation();
  const [done, setDone] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null); // step_key currently writing

  // Projects
  const [projects, setProjects] = useState([]);
  const [stepCounts, setStepCounts] = useState({}); // project_id -> completed count
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [openProject, setOpenProject] = useState(null); // selected project object

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    supabase
      .from('progress')
      .select('step_key, completed')
      .eq('user_id', user.id)
      .then(({ data }) => {
        const set = new Set((data || []).filter((r) => r.completed).map((r) => r.step_key));
        setDone(set);
        setLoading(false);
      });
  }, [user?.id]);

  // Load projects + a count of completed steps per project (one query each).
  function loadProjects() {
    if (!user?.id) return;
    setProjectsLoading(true);
    Promise.all([
      supabase
        .from('projects')
        .select('id, name, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('project_steps')
        .select('project_id, completed')
        .eq('user_id', user.id)
        .eq('completed', true),
    ]).then(([{ data: projs }, { data: steps }]) => {
      const counts = {};
      (steps || []).forEach((s) => {
        counts[s.project_id] = (counts[s.project_id] || 0) + 1;
      });
      setProjects(projs || []);
      setStepCounts(counts);
      setProjectsLoading(false);
    });
  }

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // The open detail is derived from the single active project: pick one (here,
  // in the sidebar, or in the tab bar) and its checkmarked modules open; clear
  // it (General) and we fall back to the overall list. Keeps every view aligned.
  useEffect(() => {
    if (location.state?.openProjectId) {
      // Legacy nav payload — clear it; the active project drives the view now.
      navigate(location.pathname, { replace: true, state: {} });
    }
    if (!activeId) {
      setOpenProject(null);
      return;
    }
    if (!projects.length) return;
    setOpenProject(projects.find((p) => p.id === activeId) || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, projects, location.state?.openProjectId]);

  // Set the active project on the profile — the shared source of truth that the
  // chat thread and this detail view both follow.
  async function selectProject(id) {
    const next = id || null;
    if (next === activeId || !user?.id) return;
    await supabase.from('profiles').update({ active_project_id: next }).eq('id', user.id);
    refreshProfile?.();
    window.dispatchEvent(new Event('tinman:projects-changed'));
  }

  async function toggle(stepKey) {
    if (!user?.id || saving) return;
    const completed = !done.has(stepKey);

    // Optimistic update.
    setDone((prev) => {
      const next = new Set(prev);
      if (completed) next.add(stepKey);
      else next.delete(stepKey);
      return next;
    });
    setSaving(stepKey);

    const { error } = await supabase.from('progress').upsert(
      {
        user_id: user.id,
        step_key: stepKey,
        completed,
        completed_at: completed ? new Date().toISOString() : null,
      },
      { onConflict: 'user_id,step_key' }
    );

    // Roll back on failure.
    if (error) {
      setDone((prev) => {
        const next = new Set(prev);
        if (completed) next.delete(stepKey);
        else next.add(stepKey);
        return next;
      });
    }
    setSaving(null);
  }

  async function createProject(e) {
    e?.preventDefault();
    const name = newName.trim();
    if (!user?.id || !name || creating) return;
    setCreating(true);
    const { data, error } = await supabase
      .from('projects')
      .insert({ user_id: user.id, name })
      .select('id, name, created_at')
      .single();
    if (!error && data) {
      setProjects((prev) => [data, ...prev]);
      setNewName('');
      window.dispatchEvent(new Event('tinman:projects-changed'));
    }
    setCreating(false);
  }

  async function deleteProject(e, project) {
    e.stopPropagation();
    if (!window.confirm(`Delete the project "${project.name}"? This removes its saved work and can't be undone.`)) return;
    setProjects((prev) => prev.filter((p) => p.id !== project.id));
    if (project.id === activeId) await selectProject(null);
    await supabase.from('projects').delete().eq('id', project.id);
    window.dispatchEvent(new Event('tinman:projects-changed'));
  }

  const completedCount = done.size;
  const total = YBR_STEPS.length;
  const pct = Math.round((completedCount / total) * 100);
  const allDone = completedCount === total;

  if (openProject) {
    return (
      <ProjectDetail
        project={openProject}
        onBack={async () => {
          await selectProject(null);
          loadProjects();
        }}
        onDeleted={(id) => {
          selectProject(null);
          setProjects((prev) => prev.filter((p) => p.id !== id));
        }}
        onRunWalkthrough={async () => {
          await supabase.from('profiles').update({ active_project_id: openProject.id }).eq('id', user.id);
          refreshProfile?.();
          navigate('/chat', {
            state: {
              autosend: walkthroughKickoffForProject(openProject.name),
              projectId: openProject.id,
              projectName: openProject.name,
            },
          });
        }}
        onNewProject={async () => {
          await supabase.from('profiles').update({ active_project_id: null }).eq('id', user.id);
          refreshProfile?.();
          navigate('/chat', { state: { autosend: WALKTHROUGH_KICKOFF, projectId: null } });
        }}
      />
    );
  }

  return (
    <div className="progress-view">
      <ProjectTabs active="progress" />
      <header className="view-header">
        <div>
          <h1>My Progress</h1>
          <p>Your journey down the Yellow Brick Road — check off each step as you finish it.</p>
        </div>
        <button
          className="progress-walkthrough-btn"
          onClick={() => navigate('/chat', { state: { autosend: WALKTHROUGH_KICKOFF, projectId: null } })}
        >
          Walk me through these
        </button>
      </header>

      <div className="progress-list-wrap">
        <div className="progress-summary">
          <div className="progress-bar-row">
            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="progress-bar-count">
              {completedCount}/{total}
            </span>
          </div>
          {allDone ? (
            <p className="progress-tagline done">You've walked the whole road — every step done. 🎉</p>
          ) : (
            <p className="progress-tagline">
              {completedCount === 0
                ? "Let's get started — step one is finding your dream buyer."
                : `${total - completedCount} steps left to the Emerald City.`}
            </p>
          )}
        </div>

        {loading ? (
          <div className="progress-loading">Loading your progress…</div>
        ) : (
          <ol className="progress-list">
            {YBR_STEPS.map((step, i) => {
              const checked = done.has(step.key);
              return (
                <li key={step.key} className={'progress-step' + (checked ? ' done' : '')}>
                  <span className="progress-step-num">{i + 1}</span>
                  <button
                    className="progress-check"
                    onClick={() => toggle(step.key)}
                    aria-pressed={checked}
                    aria-label={checked ? 'Mark incomplete' : 'Mark complete'}
                  >
                    {checked && <CheckIcon width={16} height={16} />}
                  </button>
                  <div className="progress-step-text" onClick={() => toggle(step.key)}>
                    <span className="progress-step-title">{step.title}</span>
                    <span className="progress-step-desc">{step.desc}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {/* Projects */}
        <section className="projects-section">
          <div className="projects-head">
            <h2>Projects</h2>
            <p>Save each product you're building as its own project — your work for every step lives inside it for later.</p>
          </div>

          <form className="project-create" onSubmit={createProject}>
            <input
              type="text"
              className="project-create-input"
              placeholder="Name a new project (e.g. Custom Fire Pits)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={80}
            />
            <button type="submit" className="project-create-btn" disabled={!newName.trim() || creating}>
              {creating ? 'Adding…' : 'Add project'}
            </button>
          </form>

          {projectsLoading ? (
            <div className="progress-loading">Loading your projects…</div>
          ) : projects.length === 0 ? (
            <div className="projects-empty">No projects yet — name one above to start saving your work step by step.</div>
          ) : (
            <ul className="projects-list">
              {projects.map((p) => {
                const c = stepCounts[p.id] || 0;
                const ppct = Math.round((c / total) * 100);
                return (
                  <li key={p.id} className="project-card" onClick={() => selectProject(p.id)}>
                    <div className="project-card-main">
                      <span className="project-card-name">{p.name}</span>
                      <div className="project-card-bar-row">
                        <div className="project-card-bar-track">
                          <div className="project-card-bar-fill" style={{ width: `${ppct}%` }} />
                        </div>
                        <span className="project-card-count">{c}/{total}</span>
                      </div>
                    </div>
                    <span className="project-card-open">Open →</span>
                    <button
                      className="project-card-delete"
                      onClick={(e) => deleteProject(e, p)}
                      title="Delete project"
                      aria-label={`Delete ${p.name}`}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function ProjectDetail({ project, onBack, onDeleted, onRunWalkthrough, onNewProject }) {
  const { user } = useAuth();
  const total = YBR_STEPS.length;
  const [steps, setSteps] = useState({}); // step_key -> { completed, content, notes }
  const [loading, setLoading] = useState(true);
  const [openKey, setOpenKey] = useState(null);
  const [draft, setDraft] = useState(''); // Tin Man's output
  const [draftNotes, setDraftNotes] = useState(''); // owner's own notes
  const [savingKey, setSavingKey] = useState(null);
  const [shopRate, setShopRate] = useState(null);
  const listRef = useRef(null);

  // The owner's saved shop rate — passed to the asset generators so the mentor
  // writes with their real numbers (same source the chat uses).
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('shop_rate')
      .select('computed_rate_hr, computed_breakeven_hr')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setShopRate(data || null));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    // Switching projects in place (via the dropdown) reuses this component, so
    // close any open editor and clear its draft — otherwise the previous
    // project's saved content lingers on screen under the new project's name,
    // making every project look like it holds the same work.
    setOpenKey(null);
    setDraft('');
    setDraftNotes('');
    setSteps({});
    setLoading(true);
    supabase
      .from('project_steps')
      .select('step_key, completed, content, notes')
      .eq('project_id', project.id)
      .then(({ data }) => {
        const map = {};
        (data || []).forEach((r) => {
          map[r.step_key] = { completed: r.completed, content: r.content || '', notes: r.notes || '' };
        });
        setSteps(map);
        setLoading(false);
      });
  }, [user?.id, project.id]);

  function upsertStep(stepKey, patch) {
    const prev = steps[stepKey] || { completed: false, content: '', notes: '' };
    const next = { ...prev, ...patch };
    setSteps((s) => ({ ...s, [stepKey]: next }));
    return supabase.from('project_steps').upsert(
      {
        project_id: project.id,
        user_id: user.id,
        step_key: stepKey,
        completed: next.completed,
        completed_at: next.completed ? new Date().toISOString() : null,
        content: next.content,
        notes: next.notes,
      },
      { onConflict: 'project_id,step_key' }
    );
  }

  async function toggleStep(stepKey) {
    const prev = steps[stepKey] || { completed: false, content: '' };
    await upsertStep(stepKey, { completed: !prev.completed });
    window.dispatchEvent(new Event('tinman:projects-changed'));
  }

  function openEditor(stepKey) {
    if (openKey === stepKey) {
      setOpenKey(null);
      return;
    }
    setOpenKey(stepKey);
    setDraft((steps[stepKey]?.content) || '');
    setDraftNotes((steps[stepKey]?.notes) || '');
  }

  async function saveContent(stepKey) {
    setSavingKey(stepKey);
    await upsertStep(stepKey, { content: draft, notes: draftNotes });
    setSavingKey(null);
    setOpenKey(null);
  }

  // Save a generated asset into its matching step's content (keeps completed +
  // notes as-is). If that step's editor is open, refresh the draft so the new
  // work shows immediately instead of the stale textarea value.
  async function saveAssetToStep(stepKey, content) {
    await upsertStep(stepKey, { content });
    if (openKey === stepKey) setDraft(content);
    window.dispatchEvent(new Event('tinman:projects-changed'));
  }

  async function handleDelete() {
    if (!window.confirm(`Delete the project "${project.name}"? This removes its saved work and can't be undone.`)) return;
    await supabase.from('projects').delete().eq('id', project.id);
    window.dispatchEvent(new Event('tinman:projects-changed'));
    onDeleted(project.id);
  }

  const completedCount = Object.values(steps).filter((s) => s.completed).length;
  const pct = Math.round((completedCount / total) * 100);
  const allDone = !loading && completedCount === total;

  return (
    <div className="progress-view">
      <ProjectTabs active="progress" />
      <header className="view-header project-detail-header">
        <div>
          <button className="project-back" onClick={onBack}>← All projects</button>
          <h1>{project.name}</h1>
          <p>Click any step to see or edit what you did for this project.</p>
        </div>
        <div className="project-detail-actions">
          <button className="progress-walkthrough-btn" onClick={onRunWalkthrough}>
            Run the walkthrough for this project
          </button>
          <button className="project-delete" onClick={handleDelete}>Delete project</button>
        </div>
      </header>

      <div className="progress-list-wrap">
        <div className="progress-summary">
          <div className="progress-bar-row">
            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="progress-bar-count">{completedCount}/{total}</span>
          </div>
        </div>

        {allDone && (
          <Celebration
            key={`cele-${project.id}`}
            projectName={project.name}
            onNewProject={onNewProject}
            onReview={() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            assetProps={{ project, steps, shopRate, onSaveAsset: saveAssetToStep }}
          />
        )}

        {loading ? (
          <div className="progress-loading">Loading this project…</div>
        ) : (
          <ol className="progress-list" ref={listRef}>
            {YBR_STEPS.map((step, i) => {
              const s = steps[step.key] || { completed: false, content: '', notes: '' };
              const isOpen = openKey === step.key;
              const hasContent = Boolean((s.content && s.content.trim()) || (s.notes && s.notes.trim()));
              return (
                <li key={step.key} className={'progress-step project-step' + (s.completed ? ' done' : '')}>
                  <div className="project-step-row">
                    <span className="progress-step-num">{i + 1}</span>
                    <button
                      className="progress-check"
                      onClick={() => toggleStep(step.key)}
                      aria-pressed={s.completed}
                      aria-label={s.completed ? 'Mark incomplete' : 'Mark complete'}
                    >
                      {s.completed && <CheckIcon width={16} height={16} />}
                    </button>
                    <div className="progress-step-text" onClick={() => openEditor(step.key)}>
                      <span className="progress-step-title">
                        {step.title}
                        {hasContent && <span className="project-step-flag">saved</span>}
                      </span>
                      <span className="progress-step-desc">{step.desc}</span>
                    </div>
                    <button className="project-step-toggle" onClick={() => openEditor(step.key)}>
                      {isOpen ? 'Close' : hasContent ? 'View / edit' : 'Add notes'}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="project-step-editor">
                      <label className="project-step-field-label">The Tin Man's work for this step</label>
                      <textarea
                        className="project-step-textarea"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Run the walkthrough and the Tin Man's output for this step lands here. You can also paste your own copy, ad, or offer."
                        rows={6}
                      />
                      <label className="project-step-field-label">My notes</label>
                      <textarea
                        className="project-step-textarea"
                        value={draftNotes}
                        onChange={(e) => setDraftNotes(e.target.value)}
                        placeholder="Your own notes for this step — tweaks, reminders, what worked. The walkthrough never overwrites this."
                        rows={4}
                      />
                      <div className="project-step-editor-actions">
                        <button
                          className="project-step-save"
                          onClick={() => saveContent(step.key)}
                          disabled={savingKey === step.key}
                        >
                          {savingKey === step.key ? 'Saving…' : 'Save'}
                        </button>
                        <button className="project-step-cancel" onClick={() => setOpenKey(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {allDone && !loading && (
          <section className="asset-bar-section">
            <h3>Turn this product into marketing</h3>
            <p className="asset-bar-lead">
              One click each — the Tin Man writes it from everything you built for {project.name}, saves it
              into the matching step, and you can download it as a PDF.
            </p>
            <ProductAssets
              project={project}
              steps={steps}
              shopRate={shopRate}
              onSaveAsset={saveAssetToStep}
              variant="bar"
            />
          </section>
        )}
      </div>
    </div>
  );
}

// Shown when every step of a project is complete: a one-shot confetti burst
// over a congratulations card. The confetti pieces are generated once and
// animate via pure CSS (no dependency).
const CONFETTI_COLORS = ['#00C853', '#00E676', '#9be7b4', '#ffffff', '#1f8f4e'];

function Celebration({ projectName, onNewProject, onReview, assetProps }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        left: Math.random() * 100,
        bg: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: Math.random() * 0.6,
        scale: 0.7 + Math.random() * 0.8,
      })),
    []
  );

  return (
    <div className="cele">
      <div className="cele-confetti" aria-hidden="true">
        {pieces.map((p, i) => (
          <i
            key={i}
            style={{
              left: `${p.left}%`,
              background: p.bg,
              animationDelay: `${p.delay}s`,
              transform: `scale(${p.scale})`,
            }}
          />
        ))}
      </div>
      <div className="cele-card">
        <div className="cele-emoji">🎉</div>
        <h2>You finished the full selling system!</h2>
        <p>
          All 17 steps done for <span className="nm">{projectName}</span>. That's the whole playbook,
          Charles — most folks never make it this far. You've got a real plan to sell this product now.
          Go put it to work, then come back and run the next one.
        </p>
        <div className="cele-actions">
          <button className="cele-btn" onClick={onNewProject}>Start a new project</button>
          <button className="cele-btn ghost" onClick={onReview}>Review my answers</button>
        </div>

        {assetProps && (
          <div className="cele-assets">
            <p className="cele-assets-lead">Or let the Tin Man turn this product into ready-to-use marketing:</p>
            <ProductAssets {...assetProps} variant="celebration" />
          </div>
        )}
      </div>
    </div>
  );
}
