// Web App Check — proves a /proxy/* request comes from a genuine instance of
// our web app, using Firebase App Check with the reCAPTCHA Enterprise provider.
// The token is attached as the `X-Firebase-AppCheck` header (the same header the
// iOS app sends via native App Attest); the proxy server verifies it.
//
// Two deliberate no-op conditions so nothing currently live breaks:
//   • Not configured — if the VITE_FIREBASE_* / reCAPTCHA env vars are absent
//     (e.g. a build before the project was wired up), init is skipped and the
//     fetch patch passes everything through untouched.
//   • iOS — on the Capacitor app, App Check tokens come from native App Attest
//     (see ios-fetch-shim.js). The web reCAPTCHA path runs only on platform=web.
//
// Public config values (apiKey, appId, reCAPTCHA site key, …) are NOT secrets —
// they are meant to ship in the client bundle. The verification secret lives
// only on the server (the Admin service account).

import { Capacitor } from '@capacitor/core';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;

// Path prefixes routed through the proxy — must mirror ios-fetch-shim.js.
const PROXIED_PREFIXES = ['/oura', '/proxy', '/calendar'];

function isConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.appId && firebaseConfig.projectId && RECAPTCHA_SITE_KEY);
}

function extractPath(url) {
  if (typeof url !== 'string') return null;
  if (url.startsWith('/')) return url;
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return null;
  }
}

function isProxiedPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return false;
  return PROXIED_PREFIXES.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));
}

// ── Lazy App Check init (memoized) ──────────────────────────────────────
let appCheckPromise = null;

async function ensureAppCheck() {
  if (appCheckPromise) return appCheckPromise;
  appCheckPromise = (async () => {
    const { initializeApp, getApps } = await import('firebase/app');
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');

    // Local dev: App Attest / reCAPTCHA can't attest a dev box, so Firebase
    // accepts a registered debug token instead. Set it (from a gitignored env
    // var) before initializeAppCheck — DEV only; never in a production build.
    if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
    }

    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    return initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  })();
  return appCheckPromise;
}

// Returns a current App Check token, or null if unavailable. Never throws.
export async function getAppCheckToken() {
  if (!isConfigured()) return null;
  try {
    const appCheck = await ensureAppCheck();
    const { getToken } = await import('firebase/app-check');
    const { token } = await getToken(appCheck, /* forceRefresh */ false);
    return token || null;
  } catch (e) {
    console.warn('[app-check] web getToken failed:', e?.message || e);
    return null;
  }
}

// Patch window.fetch so every proxied request carries the App Check token.
// No-op on iOS (native path) and when App Check isn't configured.
export function installWebAppCheckFetch() {
  if (typeof window === 'undefined' || !window.fetch) return;
  if (Capacitor.getPlatform() !== 'web') return; // iOS handled by ios-fetch-shim
  if (!isConfigured()) return;                    // not wired up yet → leave fetch alone
  if (window.__oriWebAppCheckInstalled) return;
  window.__oriWebAppCheckInstalled = true;

  const origFetch = window.fetch.bind(window);

  window.fetch = async function appCheckFetch(input, init) {
    try {
      const urlString = typeof input === 'string' ? input : (input?.url || '');
      const path = extractPath(urlString);
      if (path && isProxiedPath(path)) {
        const token = await getAppCheckToken();
        if (token) {
          if (typeof Request !== 'undefined' && input instanceof Request && !init) {
            const headers = new Headers(input.headers);
            headers.set('X-Firebase-AppCheck', token);
            return origFetch(new Request(input, { headers }));
          }
          const headers = new Headers((init && init.headers) || undefined);
          headers.set('X-Firebase-AppCheck', token);
          return origFetch(input, { ...init, headers });
        }
      }
    } catch (e) {
      console.warn('[app-check] web fetch attach failed, proceeding without token:', e?.message || e);
    }
    return origFetch(input, init);
  };
}
