import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { apiStream } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  PRODUCT_ASSETS,
  buildProductContext,
  buildLeadMagnetExamplePrompt,
  hasProductContext,
  parseLeadMagnetIdeas,
  renderMarkdownToPdf,
} from '../lib/productAssets.js';
import LandingMockup from './LandingMockup.jsx';
import './ProductAssets.css';

// Strip the fields the chat endpoint doesn't want (matches Chat.jsx).
function profileForApi(profile) {
  if (!profile) return null;
  const { id, email, anthropic_api_key, created_at, updated_at, ...rest } = profile;
  return rest;
}

// Shared PDF export: light background, real selectable text (copy-pasteable),
// emojis stripped (PDF fonts can't render color emoji). jsPDF loads on demand.
async function exportPdf(content, title, filenameBase) {
  let jsPDF;
  try {
    ({ jsPDF } = await import('jspdf'));
  } catch {
    return false;
  }
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  renderMarkdownToPdf(doc, content, { title });
  const safe = String(filenameBase || title)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  doc.save(`${safe || 'document'}.pdf`);
  return true;
}

// The four "write my ___ for this product" buttons shown on a completed project.
// Rendered in two places (the celebration card and the bottom action bar); each
// instance is self-contained. `variant` only changes styling.
export default function ProductAssets({ project, steps, shopRate, onSaveAsset, variant = 'bar' }) {
  const { profile } = useAuth();
  const [busyId, setBusyId] = useState(null);
  const [errorId, setErrorId] = useState(null);
  const [modal, setModal] = useState(null); // { asset, content, saveState }
  const ready = hasProductContext(steps);

  // Shared streaming call to the mentor: one user message + the owner's
  // profile/shop rate. onText(fullSoFar) fires as each chunk arrives.
  async function streamPrompt(prompt, onText, maxTokens = 4096) {
    const content = await apiStream(
      '/chat/stream',
      {
        messages: [{ role: 'user', content: prompt }],
        profile: profileForApi(profile),
        shopRate: shopRate || null,
        userApiKey: profile?.anthropic_api_key || null,
        maxTokens,
      },
      onText
    );
    if (!content) throw new Error('Empty reply');
    return content;
  }

  async function generate(asset) {
    if (busyId) return;
    setBusyId(asset.id);
    setErrorId(null);
    // Open the result window immediately and stream the copy in live, so there's
    // no long blank wait — the owner watches it get written.
    setModal({ asset, content: '', saveState: 'streaming', streaming: true });
    try {
      const ctx = buildProductContext(steps);
      const content = await streamPrompt(asset.buildPrompt(project.name, ctx), (full) => {
        setModal((m) => (m && m.asset.id === asset.id ? { ...m, content: full } : m));
      });

      // Auto-save into the matching step when it's still empty. If the owner
      // already has work saved there, don't clobber it — the modal offers a
      // clearly-labelled "replace" button instead.
      const existing = steps?.[asset.stepKey]?.content?.trim();
      let saveState = 'unsaved';
      if (!existing) {
        await onSaveAsset(asset.stepKey, content);
        saveState = 'saved';
      }
      setModal((m) => (m && m.asset.id === asset.id ? { ...m, content, saveState, streaming: false } : m));
    } catch {
      setErrorId(asset.id);
      // If the stream stalled after writing some copy, keep what came through
      // (unsaved) so it isn't lost — otherwise close the empty window.
      setModal((m) =>
        m && m.asset.id === asset.id && (m.content || '').trim()
          ? { ...m, streaming: false, saveState: 'unsaved' }
          : null
      );
    } finally {
      setBusyId(null);
    }
  }

  async function replaceStep() {
    if (!modal) return;
    await onSaveAsset(modal.asset.stepKey, modal.content);
    setModal((m) => (m ? { ...m, saveState: 'saved' } : m));
  }

  return (
    <>
      <div className={'asset-buttons ' + variant}>
        {PRODUCT_ASSETS.map((a) => (
          <button
            key={a.id}
            type="button"
            className="asset-btn"
            disabled={!ready || Boolean(busyId)}
            onClick={() => generate(a)}
            title={ready ? `Write my ${a.label} for ${project.name}` : 'Add some work to your steps first'}
          >
            <span className="asset-btn-icon" aria-hidden="true">{a.icon}</span>
            <span className="asset-btn-label">
              {busyId === a.id ? 'Writing…' : a.id === 'lead-magnets' ? 'Create 3 lead magnet ideas' : `Write my ${a.label}`}
            </span>
          </button>
        ))}
      </div>

      {!ready && (
        <p className="asset-hint">
          Run the walkthrough to fill in your steps — then the Tin Man can write these from your own work.
        </p>
      )}
      {errorId && (
        <p className="asset-error">That one didn't go through. Give it another click.</p>
      )}

      {modal && modal.asset.id === 'lead-magnets' && (
        <LeadMagnetModal
          project={project}
          modal={modal}
          productContext={buildProductContext(steps)}
          streamPrompt={streamPrompt}
          onClose={() => setModal(null)}
          onReplace={replaceStep}
        />
      )}
      {modal && modal.asset.id !== 'lead-magnets' && (
        <AssetModal
          project={project}
          modal={modal}
          onClose={() => setModal(null)}
          onReplace={replaceStep}
        />
      )}
    </>
  );
}

// ---- Standard single-document result (landing page, emails, ad) ----
function AssetModal({ project, modal, onClose, onReplace }) {
  const { asset, content, saveState, streaming } = modal;
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [showMockup, setShowMockup] = useState(false);
  const isLanding = asset.id === 'landing-page';

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the text is still on screen to copy by hand */
    }
  }

  async function downloadPdf() {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      await exportPdf(content, `${project.name} — ${asset.docTitle}`, `${project.name}-${asset.docTitle}`);
    } finally {
      setPdfBusy(false);
    }
  }

  async function replace() {
    setSaving(true);
    await onReplace();
    setSaving(false);
  }

  return (
    <>
      <div className="asset-modal-overlay" onClick={onClose}>
        <div className="asset-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={asset.docTitle}>
          <header className="asset-modal-head">
            <div>
              <h3>{asset.icon} {asset.docTitle}</h3>
              <span className="asset-modal-sub">{project.name}</span>
            </div>
            <button className="asset-modal-x" onClick={onClose} aria-label="Close">✕</button>
          </header>

          <div className="asset-modal-body md">
            <ReactMarkdown>{content}</ReactMarkdown>
            {streaming && <span className="asset-caret" aria-hidden="true" />}
          </div>

          <footer className="asset-modal-actions">
            <div className="asset-modal-save-state">
              {streaming ? (
                <span className="asset-writing">✍️ Writing your {asset.docTitle.toLowerCase()}…</span>
              ) : saveState === 'saved' ? (
                <span className="asset-saved">✓ Saved to {asset.stepLabel}</span>
              ) : (
                <button className="asset-action ghost" onClick={replace} disabled={saving}>
                  {saving ? 'Saving…' : `Replace ${asset.stepLabel} with this`}
                </button>
              )}
            </div>
            <div className="asset-modal-buttons">
              {isLanding && (
                <button className="asset-action" onClick={() => setShowMockup(true)} disabled={streaming}>Preview as a landing page</button>
              )}
              <button className="asset-action" onClick={copy} disabled={streaming}>{copied ? 'Copied ✓' : 'Copy'}</button>
              <button className="asset-action primary" onClick={downloadPdf} disabled={pdfBusy || streaming}>
                {pdfBusy ? 'Building PDF…' : 'Download PDF'}
              </button>
            </div>
          </footer>
        </div>
      </div>

      {isLanding && showMockup && (
        <LandingMockup project={project} content={content} onClose={() => setShowMockup(false)} />
      )}
    </>
  );
}

// ---- Lead magnets: the 3 ideas, each with a "See an example" that opens a
//      full worked example in its own window with its own Download PDF. ----
function LeadMagnetModal({ project, modal, productContext, streamPrompt, onClose, onReplace }) {
  const { asset, content, saveState, streaming } = modal;
  const ideas = useMemo(() => parseLeadMagnetIdeas(content), [content]);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [busyIdx, setBusyIdx] = useState(null);
  const [errIdx, setErrIdx] = useState(null);
  const [example, setExample] = useState(null); // { idea, content, streaming }

  async function seeExample(idea, idx) {
    if (busyIdx !== null) return;
    setBusyIdx(idx);
    setErrIdx(null);
    setExample({ idea, content: '', streaming: true });
    try {
      const ex = await streamPrompt(
        buildLeadMagnetExamplePrompt(project.name, idea.title, idea.body, productContext),
        (full) => setExample((e) => (e && e.idea === idea ? { ...e, content: full } : e))
      );
      setExample((e) => (e && e.idea === idea ? { ...e, content: ex, streaming: false } : e));
    } catch {
      setErrIdx(idx);
      setExample(null);
    } finally {
      setBusyIdx(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function downloadPdf() {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      await exportPdf(content, `${project.name} — ${asset.docTitle}`, `${project.name}-lead-magnet-ideas`);
    } finally {
      setPdfBusy(false);
    }
  }

  async function replace() {
    setSaving(true);
    await onReplace();
    setSaving(false);
  }

  return (
    <>
      <div className="asset-modal-overlay" onClick={onClose}>
        <div className="asset-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={asset.docTitle}>
          <header className="asset-modal-head">
            <div>
              <h3>{asset.icon} {asset.docTitle}</h3>
              <span className="asset-modal-sub">{project.name}</span>
            </div>
            <button className="asset-modal-x" onClick={onClose} aria-label="Close">✕</button>
          </header>

          <div className="asset-modal-body">
            {streaming ? (
              <div className="md">
                <ReactMarkdown>{content}</ReactMarkdown>
                <span className="asset-caret" aria-hidden="true" />
              </div>
            ) : (
              ideas.map((idea, i) => (
                <div className="lm-idea" key={i}>
                  <h4 className="lm-idea-title">{i + 1}. {idea.title}</h4>
                  {idea.body && (
                    <div className="md lm-idea-body">
                      <ReactMarkdown>{idea.body}</ReactMarkdown>
                    </div>
                  )}
                  <div className="lm-idea-actions">
                    <button
                      className="asset-action primary"
                      onClick={() => seeExample(idea, i)}
                      disabled={busyIdx !== null}
                    >
                      {busyIdx === i ? 'Building example…' : 'See an example'}
                    </button>
                    {errIdx === i && <span className="asset-error">Didn't go through — try again.</span>}
                  </div>
                </div>
              ))
            )}
          </div>

          <footer className="asset-modal-actions">
            <div className="asset-modal-save-state">
              {streaming ? (
                <span className="asset-writing">✍️ Writing your 3 lead magnet ideas…</span>
              ) : saveState === 'saved' ? (
                <span className="asset-saved">✓ Saved to {asset.stepLabel}</span>
              ) : (
                <button className="asset-action ghost" onClick={replace} disabled={saving}>
                  {saving ? 'Saving…' : `Replace ${asset.stepLabel} with this`}
                </button>
              )}
            </div>
            <div className="asset-modal-buttons">
              <button className="asset-action" onClick={copy} disabled={streaming}>{copied ? 'Copied ✓' : 'Copy'}</button>
              <button className="asset-action primary" onClick={downloadPdf} disabled={pdfBusy || streaming}>
                {pdfBusy ? 'Building PDF…' : 'Download PDF'}
              </button>
            </div>
          </footer>
        </div>
      </div>

      {example && (
        <LeadMagnetExampleModal
          project={project}
          idea={example.idea}
          content={example.content}
          streaming={example.streaming}
          onClose={() => setExample(null)}
        />
      )}
    </>
  );
}

// A single lead magnet's full worked example, in its own window. Download PDF
// saves the whole window: the idea details + the example.
function LeadMagnetExampleModal({ project, idea, content, streaming, onClose }) {
  const [copied, setCopied] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  // Everything shown in this window, combined for copy + PDF.
  const full = `## ${idea.title}\n\n${idea.body ? idea.body + '\n\n' : ''}---\n\n## Example\n\n${content}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function downloadPdf() {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      await exportPdf(full, `${project.name} — Lead Magnet: ${idea.title}`, `${project.name}-lead-magnet-${idea.title}`);
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div className="asset-modal-overlay lm-example-overlay" onClick={onClose}>
      <div className="asset-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Example: ${idea.title}`}>
        <header className="asset-modal-head">
          <div>
            <h3>🧲 Lead Magnet Example</h3>
            <span className="asset-modal-sub">{idea.title} · {project.name}</span>
          </div>
          <button className="asset-modal-x" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="asset-modal-body md">
          {idea.body && (
            <>
              <div className="lm-example-idea md">
                <ReactMarkdown>{idea.body}</ReactMarkdown>
              </div>
              <hr className="lm-example-rule" />
            </>
          )}
          <ReactMarkdown>{content}</ReactMarkdown>
          {streaming && <span className="asset-caret" aria-hidden="true" />}
        </div>

        <footer className="asset-modal-actions">
          <div className="asset-modal-save-state">
            {streaming && <span className="asset-writing">✍️ Writing your example…</span>}
          </div>
          <div className="asset-modal-buttons">
            <button className="asset-action" onClick={copy} disabled={streaming}>{copied ? 'Copied ✓' : 'Copy'}</button>
            <button className="asset-action primary" onClick={downloadPdf} disabled={pdfBusy || streaming}>
              {pdfBusy ? 'Building PDF…' : 'Download PDF'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
