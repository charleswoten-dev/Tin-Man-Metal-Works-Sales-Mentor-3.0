import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { captureIncomingImport } from './lib/importHandoff.js';

// If the visitor arrived from the free calculator via an upgrade link, grab the
// shop-rate/quotes payload from the URL hash before anything else renders.
captureIncomingImport();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register the service worker only in production builds so it never caches
// stale assets during local development (Vite hot-reload).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
