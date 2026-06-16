import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { apiPost } from '../lib/api.js';
import { useVoice } from '../lib/useVoice.js';
import TinManIcon from '../components/TinManIcon.jsx';
import {
  MicIcon,
  SpeakerOnIcon,
  SpeakerOffIcon,
  CopyIcon,
  CheckIcon,
  BookmarkIcon,
} from '../components/Icons.jsx';
import { SAVE_TYPES } from '../lib/saveTypes.js';
import { WALKTHROUGH_KICKOFF } from '../lib/walkthrough.js';
import './Chat.css';

const WALKTHROUGH_OFFERED_KEY = 'tinman_walkthrough_offered';

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

function MessageActions({ content, onSave }) {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saved, setSaved] = useState(false);

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

  return (
    <div className="msg-actions">
      <button className="msg-action" onClick={handleCopy} title="Copy to clipboard">
        {copied ? <CheckIcon width={15} height={15} /> : <CopyIcon width={15} height={15} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>

      <div className="msg-save-wrap">
        <button
          className="msg-action"
          onClick={() => setMenuOpen((o) => !o)}
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
    </div>
  );
}

function Message({ role, content, onSave }) {
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
        {isBot && <MessageActions content={content} onSave={onSave} />}
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
  const [offerDismissed, setOfferDismissed] = useState(
    () => localStorage.getItem(WALKTHROUGH_OFFERED_KEY) === '1'
  );
  const scrollRef = useRef(null);
  // Project the guided walkthrough auto-saves each completed step into. Seeded
  // from the saved profile (survives refresh) and overridden by nav state when
  // the walkthrough is launched for a specific project from the Progress page.
  const activeProjectRef = useRef(null);
  const activeProjectNameRef = useRef(null);
  // True once we're committed to a specific project for this walkthrough — set
  // when launched from a project's "Run the walkthrough" button, or after we
  // create/adopt one. While locked, the mentor re-announcing the project name
  // at kickoff must NOT spin up a duplicate project.
  const lockedProjectRef = useRef(false);
  // Transient "Saved to <project> ✓" confirmation shown after the walkthrough
  // auto-saves a completed step into the active project.
  const [savedToast, setSavedToast] = useState(null);
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

  // Seed the active walkthrough project from the saved profile, and fetch its
  // name so the save confirmation can show it.
  useEffect(() => {
    if (profile && activeProjectRef.current == null) {
      activeProjectRef.current = profile.active_project_id || null;
      if (profile.active_project_id) {
        supabase
          .from('projects')
          .select('name')
          .eq('id', profile.active_project_id)
          .single()
          .then(({ data }) => {
            if (data) activeProjectNameRef.current = data.name;
          });
      }
    }
  }, [profile?.active_project_id]);

  // Load this user's saved history on mount.
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (data) setMessages(data.map((m) => ({ role: m.role, content: m.content })));
        setHistoryLoaded(true);
      });
  }, [user?.id]);

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
    // A walkthrough launched from a project carries its id; a generic launch
    // carries null, which clears any stale project so it won't be written into.
    if ('projectId' in location.state) {
      activeProjectRef.current = location.state.projectId || null;
      activeProjectNameRef.current = location.state.projectName || null;
      // A real id means "continue THIS project" — lock it so the mentor's
      // kickoff name announcement can't create a duplicate. A null id is a
      // fresh start, which should be free to create/adopt a project by name.
      lockedProjectRef.current = Boolean(location.state.projectId);
    }
    navigate('.', { replace: true, state: null });
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
    if (!user?.id) return;
    supabase
      .from('messages')
      .insert({ user_id: user.id, role, content })
      .then(({ error: e }) => {
        if (e) console.error('Failed to save message:', e.message);
      });
  }

  async function send(text) {
    const content = text.trim();
    if (!content || sending) return;

    setError('');
    setInput('');
    const userMsg = { role: 'user', content };
    const history = [...messages, userMsg];
    setMessages(history);
    setSending(true);

    // Persist the user's message (fire and forget).
    persistMessage('user', content);

    try {
      const { reply } = await apiPost('/chat', {
        messages: history,
        profile: profileForApi(),
        userApiKey: profile?.anthropic_api_key || null,
      });
      const { clean, stepKeys, projectName, summaries } = extractStepMarkers(reply);
      const botMsg = { role: 'assistant', content: clean };
      setMessages((prev) => [...prev, botMsg]);
      if (voiceOut && clean) speak(clean);
      persistMessage('assistant', clean);
      // Create the project before saving any steps so the active project is set.
      if (projectName) await createProjectFromName(projectName);
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

    const projectId = activeProjectRef.current;
    if (projectId) {
      const projectRows = stepKeys.map((step_key) => ({
        project_id: projectId,
        user_id: user.id,
        step_key,
        completed: true,
        completed_at: now,
        // Prefer the clean per-step deliverable; fall back to the full reply.
        content: summaries[step_key] || content || null,
      }));
      supabase
        .from('project_steps')
        .upsert(projectRows, { onConflict: 'project_id,step_key' })
        .then(({ error: e }) => {
          if (e) {
            console.error('Failed to save project step:', e.message);
            return;
          }
          window.dispatchEvent(new Event('tinman:projects-changed'));
          const label = activeProjectNameRef.current;
          setSavedToast(label ? `Saved to ${label}` : 'Saved to your project');
          setTimeout(() => setSavedToast(null), 3200);
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
    send(WALKTHROUGH_KICKOFF);
  }

  const firstName = (profile?.name || '').split(' ')[0];

  return (
    <div className="chat">
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
            <h2>{firstName ? `Hey ${firstName}!` : 'Hey there!'}</h2>
            <p>Ask me anything about growing your plasma business — pricing, ads, offers, guarantees, or finding your niche.</p>

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
          <Message key={i} role={m.role} content={m.content} onSave={saveMessage} />
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
