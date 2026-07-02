// iOS fetch shim — routes proxy server calls through native URLSession
// to bypass the Origin-header problem.
//
// Two things this shim handles, in order:
//
//   1. Relative URL rewriting: in the iOS WebView the page is served
//      from a custom scheme (Ori://localhost or capacitor://localhost),
//      so `/proxy/anthropic` resolves to e.g. `Ori://localhost/proxy/...`
//      which iOS rejects. We rewrite to the absolute production URL.
//
//   2. Origin bypass: even after the URL is absolute, the WebView's
//      patched fetch (whether through CapacitorHttp or the standard
//      WebKit fetch) attaches an `Origin: <scheme>://localhost` header.
//      Our proxy server's allowlist rejects every Capacitor-flavored
//      origin with 403. URLSession at the native level adds no Origin
//      header on its own, so by routing through the NativeHttp plugin
//      directly we send only the headers our JS code explicitly set —
//      no Origin, no browser-managed cookies, no preflight.
//
// On web this whole file is a no-op (Capacitor.getPlatform() !== "ios").

import { Capacitor, registerPlugin } from "@capacitor/core";

const NativeHttp = registerPlugin("NativeHttp");

// Native App Check (Apple App Attest) plugin — see AppCheckPlugin.swift.
const AppCheck = registerPlugin("AppCheck");

export const API_HOST = "https://talk-to-me.ideaflow.page";

// Cache the App Check token in memory until just before it expires, so we don't
// cross the JS↔native bridge on every request. App Attest tokens last ~1h; we
// refresh a minute early. Best-effort: if the plugin is missing (Firebase not
// yet wired into the Xcode project) or attestation fails, we return null and the
// request proceeds without a token (the server only rejects in enforce mode).
let _appCheckToken = null;
let _appCheckExpiry = 0;
async function getAppCheckToken() {
  if (_appCheckToken && Date.now() < _appCheckExpiry - 60_000) return _appCheckToken;
  try {
    const { token, expiresAt } = await AppCheck.getToken();
    _appCheckToken = token || null;
    _appCheckExpiry = typeof expiresAt === "number" ? expiresAt : 0;
    return _appCheckToken;
  } catch (err) {
    console.warn("[ios-fetch-shim] App Check token unavailable:", err?.message || err);
    return null;
  }
}

// Path prefixes that should be routed through the production proxy.
// Everything else (asset fetches, capacitor:// internal calls, direct
// external APIs like deepgram) is left alone.
const PROXIED_PREFIXES = ["/oura", "/proxy", "/calendar"];

function isProxiedPath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) return false;
  return PROXIED_PREFIXES.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p + "?"));
}

// Pull the path portion off any URL — works for both absolute
// (https://host/path) and Capacitor-WebView-relative (Ori://localhost/path).
function extractPath(url) {
  if (typeof url !== "string") return null;
  if (url.startsWith("/")) return url;
  const m = url.match(/^[^/]*:\/\/[^/]+(\/.*)?$/);
  return m ? (m[1] || "/") : null;
}

// Flatten any headers shape (Headers instance, plain object, or array
// of pairs) into a plain {key: value} dict for the native bridge.
function flattenHeaders(input) {
  const out = {};
  if (!input) return out;
  if (typeof Headers !== "undefined" && input instanceof Headers) {
    input.forEach((v, k) => { out[k] = v; });
    return out;
  }
  if (Array.isArray(input)) {
    for (const [k, v] of input) out[k] = String(v);
    return out;
  }
  if (typeof input === "object") {
    for (const [k, v] of Object.entries(input)) out[k] = String(v);
    return out;
  }
  return out;
}

// Read a Blob/File as base64 (no data: prefix).
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Blob read failed"));
    reader.onload = () => {
      const s = String(reader.result || "");
      resolve(s.includes(",") ? s.slice(s.indexOf(",") + 1) : s);
    };
    reader.readAsDataURL(blob);
  });
}

// Make a single native HTTP request and adapt the result to look like
// a standard fetch() Response so existing callers can use res.ok,
// res.status, res.json(), res.text(), res.headers.get() unchanged.
async function nativeFetch(absoluteUrl, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  const headers = flattenHeaders(init.headers);

  // The proxy server's allowlist rejects ANY request without an Origin
  // header (403 "Origin not allowed"). URLSession deliberately does not
  // attach one, so we set it explicitly to the WebView's actual origin
  // (e.g. "Ori://localhost"). That value is on the server's allowlist
  // alongside the dev / web origins.
  if (!headers["Origin"] && !headers["origin"] && typeof window !== "undefined" && window.location?.origin) {
    headers["Origin"] = window.location.origin;
  }

  // App Check: attach the native App Attest token so the server can verify the
  // request came from our genuine app. Best-effort (see getAppCheckToken).
  if (!headers["X-Firebase-AppCheck"]) {
    const appCheckToken = await getAppCheckToken();
    if (appCheckToken) headers["X-Firebase-AppCheck"] = appCheckToken;
  }

  let body = null;
  if (init.body != null) {
    if (typeof init.body === "string") {
      body = init.body;
    } else if (init.body instanceof URLSearchParams) {
      body = init.body.toString();
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      }
    } else if (typeof Blob !== "undefined" && init.body instanceof Blob) {
      // Binary bodies (audio files) don't survive utf-8 stringification —
      // .text() mangles every byte above 0x7F. Send base64 and flag it so
      // the server decodes before forwarding upstream.
      body = await blobToBase64(init.body);
      headers["x-body-b64"] = "1";
    } else if (typeof init.body === "object") {
      body = JSON.stringify(init.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }
  }

  let res;
  try {
    res = await NativeHttp.request({ url: absoluteUrl, method, headers, body });
  } catch (err) {
    // Log the actual native error before re-throwing — without this, the
    // call site only sees a generic CapacitorException and we lose the
    // URLSession message that says what really happened.
    console.error("[NativeHttp] request failed:", absoluteUrl, err?.message || err);
    throw err;
  }

  // Construct a real Response so res.ok / res.json() / res.text() / res.headers.get() all work.
  return new Response(res.body ?? "", {
    status: res.status,
    headers: res.headers || {},
  });
}

export function installFetchShim() {
  if (Capacitor.getPlatform() !== "ios") return;
  if (typeof window === "undefined" || !window.fetch) return;
  if (window.__oriFetchShimInstalled) return;
  window.__oriFetchShimInstalled = true;

  const origFetch = window.fetch.bind(window);

  window.fetch = function patchedFetch(input, init) {
    try {
      const urlString = typeof input === "string" ? input : (input?.url || "");
      const path = extractPath(urlString);

      if (path && isProxiedPath(path)) {
        // Build the absolute URL preserving the query string.
        const absoluteUrl = API_HOST + path;

        // If input was a Request object, copy its method/body/headers
        // into init unless init already overrides them.
        let finalInit = init || {};
        if (typeof Request !== "undefined" && input instanceof Request && !init) {
          finalInit = {
            method: input.method,
            headers: input.headers,
            // body intentionally not extracted from Request here — the
            // shapes we use throughout the app all pass body in init.
            // If a caller ever passes body via Request, native will
            // see method=POST with no body, which is detectable.
          };
        }

        return nativeFetch(absoluteUrl, finalInit);
      }
    } catch (err) {
      console.warn("[ios-fetch-shim] route failed, falling back to fetch:", err);
    }
    return origFetch(input, init);
  };
}
