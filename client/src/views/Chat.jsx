import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { apiPost } from '../lib/api.js';
import { useVoice } from '../lib/useVoice.js';
import TinManIcon from '../components/TinManIcon.jsx';
import ProjectTabs from '../components/ProjectTabs.jsx';
import {
  MicIcon,
  SpeakerOnIcon,
  SpeakerOffIcon,
  CopyIcon,
  CheckIcon,
  BookmarkIcon,
} from '../components/Icons.jsx';
import { SAVE_TYPES } from '../lib/saveTypes.js';
import { YBR_STEPS } from '../lib/ybrSteps.js';
import { WALKTHROUGH_KICKOFF } from '../lib/walkthrough.js';
import './Chat.css';

const WALKTHROUGH_OFFERED_KEY = 'tinman_walkthrough_offered';
// Which chat thread the owner last had open ('' / absent = the General thread).
const THREAD_STORAGE_KEY = 'tinman_chat_thread';

function TypingIndicator() {
  return (
    <div className="msg-row bot">
      <TinManIcon size={34} className="msg-avatar" />
      <div className="msg-bubble bot typing">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </div>
    </div>
  );
}

// Tappable starters shown on the empty chat screen — each fires a real message.
const QUICK_STARTS = [
  { label: 'Write me a Facebook ad', prompt: 'Help me write a Facebook ad for my best-selling product.' },
  { label: 'Build an irresistible offer', prompt: 'Walk me through building an irresistible offer for my shop.' },
  { label: 'Write a power guarantee', prompt: 'Help me write a power guarantee for my product.' },
  { label: 'Help me find my niche', prompt: "I'm not sure what niche to focus on. Help me figure it out." },
  { label: 'Follow-up email sequence', prompt: 'Write me a follow-up email sequence for new leads.' },
  { label: 'Come up with product titles', prompt: 'Help me come up with some strong product titles.' },
];

function MessageActions({ content, onSave, onSaveToStep, projectActive }) {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stepMenuOpen, setStepMenuOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [stepSaved, setStepSaved] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  async function handleSave(type) {
    setMenuOpen(false);
    const ok = await onSave(content, type);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    }
  }

  async function handleSaveToStep(stepKey) {
    setStepMenuOpen(false);
    const ok = await onSaveToStep(content, stepKey);
    if (ok) {
      setStepSaved(true);
      setTimeout(() => setStepSaved(false), 1800);
    }
  }

  return (
    <div className="msg-actions">
      <button className="msg-action" onClick={handleCopy} title="Copy to clipboard">
        {copied ? <CheckIcon width={15} height={15} /> : <CopyIcon width={15} height={15} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>

      <div className="msg-save-wrap">
        <button
          className="msg-action"
          onClick={() => { setMenuOpen((o) => !o); setStepMenuOpen(false); }}
          title="Save this"
        >
          {saved ? <CheckIcon width={15} height={15} /> : <BookmarkIcon width={15} height={15} />}
          <span>{saved ? 'Saved' : 'Save'}</span>
        </button>
        {menuOpen && (
          <div className="msg-save-menu">
            <div className="msg-save-menu-label">Save as…</div>
            {SAVE_TYPES.map((t) => (
              <button key={t.value} onClick={() => handleSave(t.value)}>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* File this message directly into one of the project's 17 steps. Only
          offered when a project thread is open — a step always belongs to a
          project. This is the manual fallback for when the mentor doesn't emit
          a step marker on its own. */}
      {projectActive && (
        <div className="msg-save-wrap">
          <button
            className="msg-action"
            onClick={() => { setStepMenuOpen((o) => !o); setMenuOpen(false); }}
            title="Save to a project step"
          >
            {stepSaved ? <CheckIcon width={15} height={15} /> : <BookmarkIcon width={15} height={15} />}
            <span>{stepSaved ? 'Saved' : 'Save to step'}</span>
          </button>
          {stepMenuOpen && (
            <div className="msg-save-menu msg-step-menu">
              <div className="msg-save-menu-label">Save to step…</div>
              {YBR_STEPS.map((step, i) => (
                <button key={step.key} onClick={() => handleSaveToStep(step.key)} title={step.desc}>
                  <span className="msg-step-num">{i + 1}</span>
                  <span>{step.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Message({ role, content, onSave, onSaveToStep, projectActive }) {
  const isBot = role === 'assistant';
  return (
    <div className={'msg-row ' + (isBot ? 'bot' : 'user')}>
      {isBot && <TinManIcon size={34} className="msg-avatar" />}
      <div className="msg-col">
        <div className={'msg-bubble ' + (isBot ? 'bot' : 'user')}>
          {isBot ? (
            <div className="md"><ReactMarkdown>{content}</ReactMarkdown></div>
          ) : (
            content
          )}
        </div>
        {isBot && (
          <MessageActions
            content={content}
            onSave={onSave}
            onSaveToStep={onSaveToStep}
            projectActive={projectActive}
          />
        )}
      </div>
    </div>
  );
}

export default function Chat() {
  const { user, profile, refreshProfile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [voiceOut, setVoiceOut] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // Per-project chat threads. threadId === null is the shared "General" thread;
  // a project id scopes the conversation to that project. `threads` feeds the
  // header switcher. Seeded from localStorage so a refresh keeps you put.
  const [threadId, setThreadId] = useState(() => localStorage.getItem(THREAD_STORAGE_KEY) || null);
  const [threads, setThreads] = useState([]);
  const threadIdRef = useRef(threadId);
  // A message we want to send the moment a thread switch finishes loading (used
  // when a walkthrough is launched for a specific project from another view).
  const pendingSendRef = useRef(null);
  const [offerDismissed, setOfferDismissed] = useState(
    () => localStorage.getItem(WALKTHROUGH_OFFERED_KEY) === '1'
  );
  const scrollRef = useRef(null);
  // Fallback save target for the rare case where a walkthrough launched from the
  // General thread creates/adopts a project mid-conversation (threadId is still
  // null then). In every normal case the save target is the OPEN THREAD itself
  // (threadIdRef) — a completed step always files into the project whose thread
  // you're chatting in, never a stale "active project" from elsewhere. Seeded to
  // match the open thread so the two never disagree.
  const activeProjectRef = useRef(threadId);
  const activeProjectNameRef = useRef(null);
  // True once we're committed to a specific project for this walkthrough — set
  // when launched from a project's "Run the walkthrough" button, or after we
  // create/adopt one. While locked, the mentor re-announcing the project name
  // at kickoff must NOT spin up a duplicate project.
  const lockedProjectRef = useRef(false);
  // Ids of the messages that currently belong to the General thread (the ones on
  // screen). If a walkthrough started in General adopts/creates a project
  // mid-conversation, these get re-homed into that project so switching into its
  // thread keeps the conversation intact instead of blanking out.
  const generalMsgIdsRef = useRef([]);
  // Transient "Saved to <project> ✓" confirmation shown after the walkthrough
  // auto-saves a completed step into the active project.
  const [savedToast, setSavedToast] = useState(null);
  // The owner's saved shop rate (from the Pricing page), sent with each chat
  // request so the mentor can reference their real numbers and catch undercharging.
  const shopRateRef = useRef(null);
  const {
    recognitionSupported,
    speechSupported,
    listening,
    speaking,
    startListening,
    stopListening,
    speak,
    cancelSpeak,
  } = useVoice();

  // Initialize the read-aloud preference from the saved profile.
  useEffect(() => {
    if (profile) setVoiceOut(Boolean(profile.voice_enabled));
  }, [profile?.voice_enabled]);

  // Load the owner's saved shop rate once so the mentor can coach on real numbers.
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('shop_rate')
      .select('computed_rate_hr, computed_breakeven_hr')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => { shopRateRef.current = data || null; });
  }, [user?.id]);

  // Fetch the OPEN THREAD's project name so the "Saved to …" confirmation can
  // show it. Keyed on the open thread (not the profile's active project) so the
  // name always matches the project a completed step will actually file into.
  useEffect(() => {
    if (!threadId) { activeProjectNameRef.current = null; return; }
    supabase
      .from('projects')
      .select('name')
      .eq('id', threadId)
      .single()
      .then(({ data }) => {
        if (data) activeProjectNameRef.current = data.name;
      });
  }, [threadId]);

  // Keep a ref of the live thread id so fire-and-forget persistence tags the
  // right thread even if state has moved on.
  useEffect(() => { threadIdRef.current = threadId; }, [threadId]);

  // Unify: the active project (chosen in the sidebar or the Chat/Progress tab
  // bar) is the single source of truth. Whenever it changes, the open chat
  // thread follows it so selecting a project lands you straight in its chat.
  useEffect(() => {
    if (!profile) return;
    const next = profile.active_project_id || null;
    // persist=false: this switch is FOLLOWING the profile, so it must not write
    // the profile back (that echo + refreshProfile re-triggers this effect and,
    // with a stale closure, could land on the wrong project — the drift bug).
    if (next !== threadIdRef.current) switchThread(next, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.active_project_id]);

  // Load the project list that feeds the thread switcher, and drop a stale
  // selection back to General if its project was deleted.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const load = () => {
      supabase
        .from('projects')
        .select('id, name')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          if (cancelled) return;
          const list = data || [];
          setThreads(list);
          if (threadIdRef.current && !list.some((p) => p.id === threadIdRef.current)) {
            switchThread(null);
          }
        });
    };
    load();
    window.addEventListener('tinman:projects-changed', load);
    return () => { cancelled = true; window.removeEventListener('tinman:projects-changed', load); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Load the open thread's history. Re-runs whenever the thread changes, and
  // fires any send that was queued for after the switch.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setHistoryLoaded(false);
    let q = supabase
      .from('messages')
      .select('id, role, content, created_at')
      .eq('user_id', user.id);
    q = threadId ? q.eq('project_id', threadId) : q.is('project_id', null);
    q.order('created_at', { ascending: true }).then(({ data }) => {
      if (cancelled) return;
      const loaded = data ? data.map((m) => ({ role: m.role, content: m.content })) : [];
      setMessages(loaded);
      // Start tracking General-thread messages fresh on every thread load. Only
      // messages sent AFTER this point (i.e. the walkthrough we're about to run)
      // get re-homed if a project is adopted — pre-existing General chat stays in
      // General rather than being swept into the new project.
      generalMsgIdsRef.current = [];
      setHistoryLoaded(true);
      if (pendingSendRef.current) {
        const text = pendingSendRef.current;
        pendingSendRef.current = null;
        send(text, loaded); // build on this thread's freshly-loaded history
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, threadId]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  // Prefill the input when arriving from the Niche Library, then clear the
  // navigation state so it doesn't re-fire on back/refresh.
  useEffect(() => {
    if (location.state?.prefill) {
      setInput(location.state.prefill);
      navigate('.', { replace: true, state: null });
    }
  }, [location.state, navigate]);

  // Auto-fire a message on arrival (e.g. launching the guided walkthrough from
  // another view). Wait until history has loaded so the DB fetch doesn't clobber
  // the message we just sent.
  useEffect(() => {
    if (!historyLoaded || !location.state?.autosend) return;
    const text = location.state.autosend;
    const launchProjectId = 'projectId' in location.state ? (location.state.projectId || null) : undefined;
    navigate('.', { replace: true, state: null });
    // Launching for a specific project: open that project's thread first, then
    // queue the kickoff to fire once its history finishes loading.
    if (launchProjectId !== undefined && launchProjectId !== threadIdRef.current) {
      pendingSendRef.current = text;
      switchThread(launchProjectId);
      return;
    }
    // A walkthrough launched from a project carries its id; a generic launch
    // carries null, which clears any stale project so it won't be written into.
    if (launchProjectId !== undefined) {
      activeProjectRef.current = launchProjectId;
      activeProjectNameRef.current = location.state.projectName || null;
      // Only the walkthrough we're launching should re-home into a new project,
      // not any General chat that happened before it.
      generalMsgIdsRef.current = [];
      // A real id means "continue THIS project" — lock it so the mentor's
      // kickoff name announcement can't create a duplicate. A null id is a
      // fresh start, which should be free to create/adopt a project by name.
      lockedProjectRef.current = Boolean(launchProjectId);
    }
    send(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyLoaded, location.state]);

  function profileForApi() {
    if (!profile) return null;
    const { id, email, anthropic_api_key, created_at, updated_at, ...rest } = profile;
    return rest;
  }

  // Fire-and-forget persistence. The .then() is required: a supabase query
  // builder is lazy and won't send the request until it's awaited or thened.
  function persistMessage(role, content) {
    if (!user?.id) return Promise.resolve();
    // Capture which thread this row is being filed under at call time — the open
    // thread can change before the insert resolves.
    const onGeneral = !threadIdRef.current;
    return supabase
      .from('messages')
      .insert({ user_id: user.id, role, content, project_id: threadIdRef.current || null })
      .select('id')
      .single()
      .then(({ data, error: e }) => {
        if (e) { console.error('Failed to save message:', e.message); return; }
        // Track General-thread ids so a project adopted mid-conversation can
        // re-home the whole thread (see createProjectFromName).
        if (onGeneral && data) generalMsgIdsRef.current.push(data.id);
      });
  }

  // Switch the open chat thread (null = General). Persists the choice so a
  // refresh stays put, and points the walkthrough's save target at the same
  // project so any steps completed in this thread file into the right place.
  // `persist` controls whether this switch writes the profile's active project.
  // User-initiated switches (launching a project, dropping a deleted one) pass
  // true so the rest of the app follows. A switch that is itself FOLLOWING a
  // profile change passes false — writing back would loop through refreshProfile
  // and, with a stale closure, could drift to the wrong project.
  function switchThread(id, persist = true) {
    const next = id || null;
    if (next === threadIdRef.current) return;
    threadIdRef.current = next;
    if (next) localStorage.setItem(THREAD_STORAGE_KEY, next);
    else localStorage.removeItem(THREAD_STORAGE_KEY);
    activeProjectRef.current = next;
    activeProjectNameRef.current = next ? (threads.find((p) => p.id === next)?.name || null) : null;
    lockedProjectRef.current = Boolean(next);
    setThreadId(next);
    // Keep the profile's active project in lockstep so the Progress view + the
    // tab bar reflect the same project.
    if (persist && user?.id && next !== (profile?.active_project_id || null)) {
      supabase.from('profiles').update({ active_project_id: next }).eq('id', user.id).then(() => {
        refreshProfile?.();
        window.dispatchEvent(new Event('tinman:projects-changed'));
      });
    }
  }

  async function send(text, baseOverride) {
    const content = text.trim();
    if (!content || sending) return;

    setError('');
    setInput('');
    const userMsg = { role: 'user', content };
    // Normal sends build on the current messages; a send queued right after a
    // thread switch passes the freshly-loaded thread history explicitly, since
    // the closure's `messages` is still the old thread at that moment.
    const history = [...(baseOverride || messages), userMsg];
    setMessages(history);
    setSending(true);

    // Persist the user's message. Keep the promise so a project adopted later in
    // this turn can wait for the row to land before re-homing the thread.
    const userPersist = persistMessage('user', content);

    try {
      const { reply } = await apiPost('/chat', {
        messages: history,
        profile: profileForApi(),
        shopRate: shopRateRef.current,
        userApiKey: profile?.anthropic_api_key || null,
      });
      const { clean, stepKeys, projectName, summaries } = extractStepMarkers(reply);
      const botMsg = { role: 'assistant', content: clean };
      setMessages((prev) => [...prev, botMsg]);
      if (voiceOut && clean) speak(clean);
      const botPersist = persistMessage('assistant', clean);
      // Create the project before saving any steps so the active project is set.
      // Wait for both message rows to land first so the re-home (inside
      // createProjectFromName) sweeps the full conversation, not a partial one.
      if (projectName) {
        await Promise.all([userPersist, botPersist]);
        await createProjectFromName(projectName);
      }
      markStepsComplete(stepKeys, clean, summaries);
    } catch (err) {
      setError("The Tin Man couldn't respond just now. Please try again.");
      console.error(err);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  // Dictate into the input box; append so it doesn't clobber typed text.
  function handleMic() {
    if (listening) {
      stopListening();
      return;
    }
    startListening((text) => {
      setInput((prev) => (prev ? `${prev} ${text}` : text));
    });
  }

  // Pull the hidden markers the mentor emits during the guided walkthrough out
  // of the reply: [[STEP_DONE:ybr-N]] (a step was completed) and
  // [[PROJECT_NAME:...]] (name for a freshly started project). Returns the
  // cleaned text with every marker stripped, plus what they carried.
  function extractStepMarkers(text) {
    const stepRe = /\[\[STEP_DONE:(ybr-(?:1[0-7]|[1-9]))\]\]/g;
    const nameRe = /\[\[PROJECT_NAME:([^\]]+)\]\]/g;
    // A clean, self-contained recap of a step's deliverable, captured and saved
    // into the project file (and hidden from the chat). [\s\S] so it spans lines.
    const summaryRe = /\[\[STEP_SUMMARY:(ybr-(?:1[0-7]|[1-9]))\]\]([\s\S]*?)\[\[\/STEP_SUMMARY\]\]/g;
    const keys = new Set();
    let m;
    while ((m = stepRe.exec(text))) keys.add(m[1]);
    let projectName = null;
    let n;
    while ((n = nameRe.exec(text))) projectName = n[1].trim();
    const summaries = {};
    let s;
    while ((s = summaryRe.exec(text))) {
      const body = s[2].trim();
      if (body) summaries[s[1]] = body;
    }
    const clean = text
      .replace(summaryRe, '') // strip summary blocks before the loose-marker passes
      .replace(stepRe, '')
      .replace(nameRe, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { clean, stepKeys: [...keys], projectName, summaries };
  }

  // Create a project from the name the mentor captured, make it the active
  // walkthrough project, and persist that choice to the profile.
  async function createProjectFromName(name) {
    if (!user?.id || !name) return;
    // Already committed to a project (launched from its "Run the walkthrough"
    // button, or adopted earlier this session). The mentor re-announces the
    // name at kickoff — just keep the binding, never duplicate.
    if (lockedProjectRef.current && activeProjectRef.current) {
      activeProjectNameRef.current = name;
      return;
    }
    // Otherwise reuse an existing same-named project for this user if one
    // already exists, so repeat walkthroughs don't pile up duplicates.
    let projectId = null;
    const { data: existing } = await supabase
      .from('projects')
      .select('id')
      .eq('user_id', user.id)
      .eq('name', name)
      .order('created_at', { ascending: true })
      .limit(1);
    if (existing && existing[0]) {
      projectId = existing[0].id;
    } else {
      const { data, error } = await supabase
        .from('projects')
        .insert({ user_id: user.id, name })
        .select('id')
        .single();
      if (error || !data) {
        console.error('Failed to create project:', error?.message);
        return;
      }
      projectId = data.id;
    }
    // If this walkthrough began on the General thread, every message so far was
    // filed under General (project_id null). Move that conversation into the new
    // project NOW — before the profile update below flips the active project and
    // the open thread follows it — so switching into the project's thread keeps
    // the conversation intact instead of reloading to an empty thread.
    if (!threadIdRef.current && generalMsgIdsRef.current.length) {
      const ids = [...generalMsgIdsRef.current];
      const { error: moveErr } = await supabase
        .from('messages')
        .update({ project_id: projectId })
        .in('id', ids);
      if (moveErr) console.error('Failed to move conversation into project:', moveErr.message);
      else generalMsgIdsRef.current = [];
    }
    activeProjectRef.current = projectId;
    activeProjectNameRef.current = name;
    lockedProjectRef.current = true; // committed for the rest of this session
    supabase.from('profiles').update({ active_project_id: projectId }).eq('id', user.id).then(() => {
      refreshProfile?.();
      window.dispatchEvent(new Event('tinman:projects-changed'));
    });
  }

  // Check completed walkthrough steps off on the Progress page (same table the
  // Progress view writes to, under the user's own session). If the walkthrough
  // was launched for a project, also save the mentor's output into that
  // project's matching step so the owner can review it later.
  function markStepsComplete(stepKeys, content, summaries = {}) {
    if (!user?.id || stepKeys.length === 0) return;
    const now = new Date().toISOString();
    const rows = stepKeys.map((step_key) => ({
      user_id: user.id,
      step_key,
      completed: true,
      completed_at: now,
    }));
    supabase
      .from('progress')
      .upsert(rows, { onConflict: 'user_id,step_key' })
      .then(({ error: e }) => {
        if (e) console.error('Failed to mark step complete:', e.message);
      });

    // Always file into the project whose thread we're chatting in. Fall back to
    // activeProjectRef only for a General-thread walkthrough that created a
    // project mid-conversation (threadId still null). This is what guarantees a
    // step never leaks into another project's file.
    const projectId = threadIdRef.current || activeProjectRef.current;
    if (projectId) {
      // Save ONLY the finalized deliverable the mentor read back for a step
      // (its STEP_SUMMARY) — never the surrounding chat. Steps that produced a
      // keepable result write their content; the rest just check off, with
      // their content slot left untouched so nothing extraneous is stored and
      // any work saved earlier is preserved.
      const withSummary = stepKeys.filter((k) => summaries[k] && summaries[k].trim());
      const withoutSummary = stepKeys.filter((k) => !(summaries[k] && summaries[k].trim()));

      const writes = [];
      if (withSummary.length) {
        writes.push(
          supabase.from('project_steps').upsert(
            withSummary.map((step_key) => ({
              project_id: projectId,
              user_id: user.id,
              step_key,
              completed: true,
              completed_at: now,
              content: summaries[step_key].trim(),
            })),
            { onConflict: 'project_id,step_key' }
          )
        );
      }
      if (withoutSummary.length) {
        // Note: `content` is intentionally omitted so an upsert conflict leaves
        // any previously saved deliverable for this step in place.
        writes.push(
          supabase.from('project_steps').upsert(
            withoutSummary.map((step_key) => ({
              project_id: projectId,
              user_id: user.id,
              step_key,
              completed: true,
              completed_at: now,
            })),
            { onConflict: 'project_id,step_key' }
          )
        );
      }

      Promise.all(writes).then((results) => {
        const failed = results.find((r) => r.error);
        if (failed) {
          console.error('Failed to save project step:', failed.error.message);
          return;
        }
        window.dispatchEvent(new Event('tinman:projects-changed'));
        // Only crow about a save when an actual deliverable was filed.
        if (withSummary.length) {
          const label = activeProjectNameRef.current;
          setSavedToast(label ? `Saved to ${label}` : 'Saved to your project');
          setTimeout(() => setSavedToast(null), 3200);
        }
      });
    }
  }

  // Save a bot message to the user's saves library (Step 10 reads these).
  async function saveMessage(content, type) {
    if (!user?.id) return false;
    const { error: saveErr } = await supabase
      .from('saves')
      .insert({ user_id: user.id, content, type });
    return !saveErr;
  }

  // Manually file a chat message into one of the open project's 17 steps. This
  // is the owner-driven fallback for when the mentor doesn't emit a STEP_DONE
  // marker on its own: it writes the message text into project_steps.content and
  // marks the step complete, the same shape markStepsComplete uses. Only works
  // when a project thread is open (a step always belongs to a project).
  async function saveMessageToStep(content, stepKey) {
    const projectId = threadIdRef.current || activeProjectRef.current;
    if (!user?.id || !projectId || !stepKey) return false;
    const now = new Date().toISOString();
    const { error: stepErr } = await supabase
      .from('project_steps')
      .upsert(
        {
          project_id: projectId,
          user_id: user.id,
          step_key: stepKey,
          completed: true,
          completed_at: now,
          content: content.trim(),
        },
        { onConflict: 'project_id,step_key' }
      );
    if (stepErr) {
      console.error('Failed to save message to step:', stepErr.message);
      return false;
    }
    // Also tick the global progress checkmark so the slider/overview agree.
    supabase
      .from('progress')
      .upsert(
        { user_id: user.id, step_key: stepKey, completed: true, completed_at: now },
        { onConflict: 'user_id,step_key' }
      )
      .then(({ error: e }) => {
        if (e) console.error('Failed to mark step complete:', e.message);
      });
    window.dispatchEvent(new Event('tinman:projects-changed'));
    const stepNum = YBR_STEPS.findIndex((s) => s.key === stepKey) + 1;
    const label = activeProjectNameRef.current;
    setSavedToast(
      label ? `Saved to Step ${stepNum} · ${label}` : `Saved to Step ${stepNum}`
    );
    setTimeout(() => setSavedToast(null), 3200);
    return true;
  }

  // Flip read-aloud and persist the choice to the profile.
  async function toggleVoiceOut() {
    const next = !voiceOut;
    setVoiceOut(next);
    if (!next) cancelSpeak();
    if (user?.id) {
      await supabase.from('profiles').update({ voice_enabled: next }).eq('id', user.id);
      refreshProfile?.();
    }
  }

  function markOffered() {
    localStorage.setItem(WALKTHROUGH_OFFERED_KEY, '1');
    setOfferDismissed(true);
  }

  // Kick off the guided 17-step walkthrough as a real chat message. Launched
  // from the empty chat, so it isn't tied to a project — clear any stale one.
  function startWalkthrough() {
    markOffered();
    activeProjectRef.current = null;
    activeProjectNameRef.current = null;
    lockedProjectRef.current = false; // fresh start — let the name create/adopt a project
    generalMsgIdsRef.current = []; // only THIS walkthrough's messages re-home into the new project
    send(WALKTHROUGH_KICKOFF);
  }

  const firstName = (profile?.name || '').split(' ')[0];
  const currentThreadName = threadId ? (threads.find((p) => p.id === threadId)?.name || null) : null;

  return (
    <div className="chat">
      <ProjectTabs active="chat" />
      <header className="chat-header">
        <div className="chat-header-title">
          <TinManIcon size={30} className="chat-header-icon" />
          <div>
            <div className="chat-title">Tin Man Sales Mentor</div>
            <div className="chat-subtitle">Your CNC plasma sales coach</div>
          </div>
        </div>
        {speechSupported && (
          <button
            className={'chat-voice-toggle' + (voiceOut ? ' on' : '') + (speaking ? ' speaking' : '')}
            onClick={toggleVoiceOut}
            aria-pressed={voiceOut}
            aria-label={voiceOut ? 'Turn off read aloud' : 'Turn on read aloud'}
            title={voiceOut ? 'Read aloud: on' : 'Read aloud: off'}
          >
            {voiceOut ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
          </button>
        )}
      </header>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && !sending && (
          <div className="chat-empty">
            <TinManIcon size={72} className="chat-empty-icon" />
            <h2>{currentThreadName ? currentThreadName : (firstName ? `Hey ${firstName}!` : 'Hey there!')}</h2>
            <p>
              {currentThreadName
                ? `This is the chat for ${currentThreadName}. Everything you talk about here stays with this project.`
                : 'Ask me anything about growing your plasma business — pricing, ads, offers, guarantees, or finding your niche.'}
            </p>

            {!offerDismissed ? (
              <div className="chat-walkthrough-offer">
                <h3>Want me to walk you through the whole sales system?</h3>
                <p>
                  I'll take you through Charles's 17-step selling system one step at a
                  time, building your real offers, ads, and funnel around YOUR shop as we go.
                </p>
                <div className="chat-walkthrough-actions">
                  <button className="chat-walkthrough-start" onClick={startWalkthrough} disabled={sending}>
                    Yes — walk me through it
                  </button>
                  <button className="chat-walkthrough-later" onClick={markOffered} disabled={sending}>
                    Maybe later
                  </button>
                </div>
              </div>
            ) : (
              <button className="chat-walkthrough-launch" onClick={startWalkthrough} disabled={sending}>
                Walk me through the 17-step sales system
              </button>
            )}

            <div className="chat-quickstarts">
              {QUICK_STARTS.map((q) => (
                <button
                  key={q.label}
                  className="chat-quickstart"
                  onClick={() => send(q.prompt)}
                  disabled={sending}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <Message
            key={i}
            role={m.role}
            content={m.content}
            onSave={saveMessage}
            onSaveToStep={saveMessageToStep}
            projectActive={Boolean(threadId)}
          />
        ))}

        {sending && <TypingIndicator />}
      </div>

      {savedToast && (
        <div className="chat-saved-toast" role="status">
          <CheckIcon width={15} height={15} />
          <span>{savedToast}</span>
        </div>
      )}

      {error && <div className="chat-error">{error}</div>}

      <div className="chat-input-bar">
        {recognitionSupported && (
          <button
            className={'chat-mic' + (listening ? ' listening' : '')}
            onClick={handleMic}
            disabled={sending}
            aria-pressed={listening}
            aria-label={listening ? 'Stop listening' : 'Speak your message'}
            title={listening ? 'Listening… tap to stop' : 'Speak your message'}
          >
            <MicIcon />
          </button>
        )}
        <textarea
          className="chat-input"
          rows={1}
          placeholder={listening ? 'Listening…' : 'Message the Tin Man…'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <button
          className="chat-send"
          onClick={() => send(input)}
          disabled={sending || !input.trim()}
          aria-label="Send"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
