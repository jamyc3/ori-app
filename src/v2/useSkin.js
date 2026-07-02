// Ori v2 — skin switch utilities.
//
// The single source of truth for which version of the site renders.
//   - 'v2' (default) → v2/Shell.jsx mounts (the shipped design).
//   - 'v1'           → CPI.jsx mounts (classic — deep dashboards,
//                      integrations management).
//
// Classic is a VISIT, not a home: ?skin=v1 wins for that load only and
// is never persisted — v1 has no affordance to return to v2, so sticky
// v1 would strand people there. Legacy pre-launch 'ori-skin' = 'v1'
// keys are scrubbed on read for the same reason. Reopening the app at
// its root always lands on v2.

const STORAGE_KEY = 'ori-skin';
const VALID = new Set(['v1', 'v2']);

function readUrlParam() {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('skin');
    return VALID.has(v) ? v : null;
  } catch {
    return null;
  }
}

function readStorage() {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return VALID.has(v) ? v : null;
  } catch {
    return null;
  }
}

function writeStorage(skin) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, skin);
  } catch {
    // Storage unavailable (private mode, quota) — fall through silently.
  }
}

export function getSkin() {
  const fromUrl = readUrlParam();
  if (fromUrl === 'v2') {
    writeStorage('v2');
    return 'v2';
  }
  if (fromUrl === 'v1') return 'v1';
  if (readStorage() === 'v1') {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* fine */ }
  }
  return 'v2';
}

export function setSkin(skin) {
  // Only v2 may persist — see the header note on why classic never sticks.
  if (skin !== 'v2') return;
  writeStorage(skin);
}
