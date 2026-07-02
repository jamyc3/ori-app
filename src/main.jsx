import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CPI from './CPI.jsx'
import V2Shell from './v2/Shell.jsx'
import { getSkin } from './v2/useSkin.js'
import { installFetchShim } from './ios-fetch-shim.js'
import { installWebAppCheckFetch } from './app-check.js'
import { hydrateStorage } from './storage.js'

// On iOS the WebView is served from a custom scheme; relative server-proxy
// fetches (e.g. /oura/*, /proxy/*, /calendar/*) need to be rewritten to the
// absolute production server URL. No-op on web.
installFetchShim()

// Web App Check: attach a reCAPTCHA Enterprise token to proxied requests so the
// server can verify they come from our app. No-op on iOS (native App Attest via
// the shim) and when Firebase App Check isn't configured.
installWebAppCheckFetch()

// Shim window.storage for standalone use (component expects a custom storage API)
window.storage = {
  get: (key) => Promise.resolve({ value: localStorage.getItem(key) }),
  set: (key, val) => Promise.resolve(localStorage.setItem(key, val)),
  delete: (key) => Promise.resolve(localStorage.removeItem(key)),
};

// Skin switch — v2 default; classic via ?skin=v1 for that load only (see useSkin.js).
const skin = getSkin();
const Root = skin === 'v2' ? V2Shell : CPI;

// The v2 tokens + theme cascade hang off <html> ([data-skin="v2"] and
// [data-tod] must sit on the same element). Set it before first paint so
// there's no flash of the v1 background.
if (skin === 'v2') {
  document.documentElement.setAttribute('data-skin', 'v2');
}

// The journal repo + wearable history live in IndexedDB behind the
// localStorage shim (storage.js). v1 hydrates them in a CPI effect and
// tolerates late arrival via its refresh ticks; v2 surfaces memoize their
// reads at mount, so the cache must be hydrated BEFORE the first render —
// otherwise a migrated user's journal, rings, and letter clock all see an
// empty store. Hydration is one IDB read; on failure we render anyway and
// getLarge() falls back to localStorage.
// Demo simulator (?sim=1) — fabricates a persona's history so anyone can try Ori
// on the web (or a fresh install) with a few weeks of data instead of an empty
// app. It's a CONTROL PANEL: it never seeds automatically — you pick a persona
// and explicitly click "seed and open Ori" — so simply landing on ?sim=1 can't
// touch anyone's data. (We tried gating prod on an empty store, but that blocked
// legit demo visitors whose earlier visit had left onboarding state behind; the
// explicit-seed step is the real safeguard, so ?sim=1 just opens the panel.)
function wantsSim() {
  try { return new URLSearchParams(window.location.search).get('sim') === '1'; }
  catch { return false; }
}

function simAllowed() {
  return wantsSim();
}

// Launch splash (index.html #ori-splash): hold the brand moment briefly, then
// fade it out and remove it once the app has mounted.
function dismissOriSplash() {
  const el = document.getElementById('ori-splash');
  if (!el) return;
  setTimeout(() => {
    el.classList.add('ori-splash-hide');
    setTimeout(() => el.remove(), 500);
  }, 700);
}

hydrateStorage()
  .catch(() => { /* IDB unavailable — localStorage fallback covers reads */ })
  .finally(() => {
    const root = createRoot(document.getElementById('root'));
    if (simAllowed()) {
      import('./sim/Sim.jsx').then(({ default: Sim }) => {
        root.render(<StrictMode><Sim /></StrictMode>);
        dismissOriSplash();
      });
      return;
    }
    root.render(
      <StrictMode>
        <Root />
      </StrictMode>,
    );
    dismissOriSplash();
  })

// Register the service worker — only in production builds, and only when supported.
// In dev, Vite's HMR handles reloads; a live SW would fight with it.
if ("serviceWorker" in navigator && !import.meta.env.DEV) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}
