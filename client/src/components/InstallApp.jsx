import { useEffect, useState } from 'react';
import './InstallApp.css';

// ---------------------------------------------------------------------------
// "Install app" button for the sidebar footer. On Chrome/Edge (desktop +
// Android) the browser fires `beforeinstallprompt`, which we stash and replay
// on click to pop the native install dialog (drops a real desktop / home-screen
// icon). Safari and iOS expose no programmatic hook, so there we show a small
// modal with the manual "Add to Home Screen" steps. Hides itself when the app
// is already running installed (standalone display mode).
// ---------------------------------------------------------------------------

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
}

export default function InstallApp() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return;
    }
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      setShowHelp(false);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  const handleClick = async () => {
    if (deferred) {
      deferred.prompt();
      try { await deferred.userChoice; } catch { /* dismissed */ }
      setDeferred(null);
    } else {
      setShowHelp(true);
    }
  };

  return (
    <>
      <button
        type="button"
        className="install-app-btn"
        onClick={handleClick}
        title="Install this app on your device for one-click access"
      >
        <span className="install-app-icon" aria-hidden="true">⬇</span>
        <span>Install app</span>
      </button>

      {showHelp && <InstallHelp onClose={() => setShowHelp(false)} />}
    </>
  );
}

function InstallHelp({ onClose }) {
  const ios = isIOS();
  return (
    <div className="install-help-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="install-help" onClick={(e) => e.stopPropagation()}>
        <button className="install-help-x" onClick={onClose} aria-label="Close">×</button>
        <h3>Add this app to your device</h3>
        <p className="install-help-sub">
          It installs straight from your browser — no app store, nothing to download.
        </p>

        {ios ? (
          <ol className="install-steps">
            <li>Tap the <b>Share</b> button (the square with an arrow) at the bottom of Safari.</li>
            <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
            <li>Tap <b>Add</b> — the Tin Man icon now lives on your home screen.</li>
          </ol>
        ) : (
          <>
            <div className="install-help-block">
              <h4>On a computer (Chrome or Edge)</h4>
              <ol className="install-steps">
                <li>Look for the <b>install icon</b> in the address bar (a small monitor with a ⬇, on the right).</li>
                <li>Click it, then click <b>Install</b>.</li>
                <li>An icon appears on your <b>desktop</b> and Start menu — double-click it anytime.</li>
              </ol>
            </div>
            <div className="install-help-block">
              <h4>On an Android phone (Chrome)</h4>
              <ol className="install-steps">
                <li>Tap the <b>⋮</b> menu (top right).</li>
                <li>Tap <b>Install app</b> (or <b>Add to Home screen</b>).</li>
                <li>The icon lands on your home screen.</li>
              </ol>
            </div>
            <div className="install-help-block">
              <h4>On an iPhone (Safari)</h4>
              <ol className="install-steps">
                <li>Tap the <b>Share</b> button, then <b>Add to Home Screen</b>, then <b>Add</b>.</li>
              </ol>
            </div>
          </>
        )}

        <button className="install-help-done" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
