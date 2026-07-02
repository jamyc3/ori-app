// Ori v2 — Oura connect, natively in the v2 skin.
//
// v1's Connect button navigates to the server's /oura/oauth/start; the
// server runs the OAuth dance and redirects back with tokens in the URL
// hash (#oura_oauth=success&access_token=…). Until now only CPI.jsx
// parsed that hash — connecting from v2 silently dropped the tokens on
// return. This module mirrors CPI's storage exactly (same keys, same
// expiry math) and runs the same initial history sync via the shared
// engine, so a connection made in v2 is indistinguishable from one made
// in v1. The integrations/ OAuth boundary is untouched — we only consume
// engine exports.

import {
  fetchOuraRange,
  mergeOuraHistory,
  recordOuraHwm,
  ouraSyncWindow,
  OURA_HISTORY_KEY,
  OURA_ACCESS_KEY,
  OURA_REFRESH_KEY,
  OURA_EXPIRES_KEY,
  OURA_LAST_SYNC_KEY,
} from '../engine.js';

const OURA_OAUTH_ERR_KEY = 'cpi_oura_oauth_error';

// A failed OAuth return used to vanish into console.error — the user landed
// back on a "Not connected" row with no idea why. Stash the reason so the
// next visit to Connected sources can explain it, then clear it.
export function takeOuraOAuthError() {
  try {
    const v = localStorage.getItem(OURA_OAUTH_ERR_KEY);
    if (v) localStorage.removeItem(OURA_OAUTH_ERR_KEY);
    return v || null;
  } catch {
    return null;
  }
}

// Migration: early v2 builds stored the access token under
// 'cpi_oura_access' — a key nothing in the engine or v1 reads, which made
// a v2-made connection invisible everywhere else. Move it to the real key
// once, at module load (Shell imports this module on every boot).
try {
  const stray = localStorage.getItem('cpi_oura_access');
  if (stray && !localStorage.getItem(OURA_ACCESS_KEY)) {
    localStorage.setItem(OURA_ACCESS_KEY, stray);
  }
  if (stray) localStorage.removeItem('cpi_oura_access');
} catch { /* storage unavailable */ }

export function isNativeIOS() {
  try {
    return window.Capacitor?.getPlatform?.() === 'ios';
  } catch {
    return false;
  }
}

// Kick off the server-side OAuth flow, returning to the current v2 page.
export function startOuraConnect() {
  const returnTo = `${window.location.origin}${window.location.pathname}?skin=v2`;
  window.location.href = `/oura/oauth/start?return_to=${encodeURIComponent(returnTo)}`;
}

// Parse an OAuth return hash string and persist tokens the way v1 does.
// Returns the access token on success, null otherwise. Shared by the web
// return (window.location.hash) and the iOS deep-link return.
function storeTokensFromHash(hash) {
  if (!hash || !hash.includes('oura_oauth=')) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const status = params.get('oura_oauth');
  if (status === 'error') {
    const reason = params.get('reason') || 'unknown';
    console.error('Oura OAuth error:', reason);
    try { localStorage.setItem(OURA_OAUTH_ERR_KEY, reason); } catch { /* quota */ }
    return null;
  }
  if (status !== 'success') return null;
  const access = params.get('access_token');
  const refresh = params.get('refresh_token');
  const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
  if (!access) return null;
  try {
    localStorage.setItem(OURA_ACCESS_KEY, access);
    if (refresh) localStorage.setItem(OURA_REFRESH_KEY, refresh);
    localStorage.setItem(OURA_EXPIRES_KEY, String(Date.now() + expiresIn * 1000));
    localStorage.removeItem(OURA_OAUTH_ERR_KEY);
  } catch { /* quota — token at least lives for this session via state */ }
  return access;
}

// Web return path: parse window.location.hash if present and clean the URL.
export function handleOuraCallbackHash() {
  const hash = window.location.hash;
  if (!hash || !hash.includes('oura_oauth=')) return null;
  const token = storeTokensFromHash(hash);
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch { /* history unavailable */ }
  return token;
}

// ── iOS native OAuth round-trip ──────────────────────────────────
// The WKWebView page lives on a custom scheme, so a same-window OAuth
// redirect can't come back. Instead: open the server's OAuth start in
// the system browser sheet with return_to=app.neon.ori://oauth-callback
// (the one non-web return the server allowlists). The server's callback
// redirect fires the app's URL scheme; Capacitor reports it via
// appUrlOpen; we parse the same hash and run the same initial sync.

const IOS_CALLBACK = 'app.neon.ori://oauth-callback';

export async function startOuraConnectNative() {
  const { API_HOST } = await import('../ios-fetch-shim.js');
  const { Browser } = await import('@capacitor/browser');
  const url = `${API_HOST}/oura/oauth/start?return_to=${encodeURIComponent(IOS_CALLBACK)}`;
  await Browser.open({ url });
}

// Install once (Shell mount). Safe no-op outside the iOS app.
let nativeListenerInstalled = false;
export function installNativeOAuthListener() {
  if (!isNativeIOS() || nativeListenerInstalled) return;
  nativeListenerInstalled = true;
  (async () => {
    try {
      const { App } = await import('@capacitor/app');
      App.addListener('appUrlOpen', async ({ url }) => {
        if (typeof url !== 'string' || !url.startsWith(IOS_CALLBACK)) return;
        try {
          const { Browser } = await import('@capacitor/browser');
          Browser.close().catch(() => {});
        } catch { /* sheet already closed */ }
        const hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
        const token = storeTokensFromHash(hash);
        if (token) await initialOuraSync(token);
      });
    } catch (e) {
      console.warn('appUrlOpen listener unavailable:', e);
    }
  })();
}

// First sync after connect — same window, merge, and bookkeeping as v1's
// resync path. Fire-and-forget; rings pick the history up on next render.
export async function initialOuraSync(token) {
  if (!token) return null;
  try {
    const { start, end } = ouraSyncWindow();
    const mode = (() => {
      try { return localStorage.getItem('cpi_mode') || 'full'; } catch { return 'full'; }
    })();
    const res = await fetchOuraRange(token, start, end, () => {}, { mode });
    if (!res?.connected || !res.historyMap) return null;
    let stored = {};
    try {
      const raw = localStorage.getItem(OURA_HISTORY_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch { /* start fresh */ }
    const merged = mergeOuraHistory(stored, res.historyMap);
    try {
      localStorage.setItem(OURA_HISTORY_KEY, JSON.stringify(merged));
      localStorage.setItem(OURA_LAST_SYNC_KEY, new Date().toISOString());
    } catch { /* quota */ }
    recordOuraHwm();
    try { window.dispatchEvent(new Event('cpi:wearable-synced')); } catch { /* no listeners */ }
    return merged;
  } catch {
    return null;
  }
}
