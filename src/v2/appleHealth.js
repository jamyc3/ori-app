// Ori v2 — Apple Health connect + delta sync, natively in the v2 skin.
//
// v1 runs the HealthKit permission flow from Settings and the periodic
// delta sync inside CPI's focus tick — neither executes while the v2
// shell is mounted, so on iOS a granted connection silently stopped
// syncing under v2. This module mirrors v1's storage and merge exactly
// (same `apple_health_granted` flag, same ahSyncWindow/high-water-mark
// bookkeeping, same biometrics write with manual-field preservation), so
// a connection made or synced here is indistinguishable from one made in
// classic. The ZIP-export backfill stays a classic surface.

import {
  ahSyncWindow,
  recordAhHwm,
  mergeAppleHealthIntoHistory,
  biometricsFromDayEntry,
  BIOMETRICS_KEY,
} from '../engine.js';
import {
  isAvailable,
  requestPermission,
  appleHealthAggregateRange,
} from '../integrations/apple-health.js';

const GRANTED_KEY = 'apple_health_granted';
const LAST_SYNC_KEY = 'cpi_ah_last_sync';
const SEEN_KEY = 'cpi_ah_seen_at';

export function appleHealthAvailable() {
  return isAvailable();
}

export function appleHealthGranted() {
  try { return localStorage.getItem(GRANTED_KEY) === 'true'; } catch { return false; }
}

export function appleHealthLastSync() {
  try { return localStorage.getItem(LAST_SYNC_KEY); } catch { return null; }
}

// Pull the current window, merge fill-missing-only, refresh biometrics
// (preserving manually entered fields), and announce the sync.
async function pullAndMerge() {
  const { start, end } = ahSyncWindow();
  const result = await appleHealthAggregateRange({ start, end });
  if (!result?.entries?.length) return { ok: true, days: 0 };
  const merged = mergeAppleHealthIntoHistory(result.entries);
  recordAhHwm();
  try { localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString()); } catch { /* quota */ }
  if (merged.latestDay) {
    const bio = biometricsFromDayEntry(merged.latestDay);
    if (bio) {
      let preserved = {};
      try {
        const prev = JSON.parse(localStorage.getItem(BIOMETRICS_KEY) || 'null');
        if (prev) {
          for (const k of ['manualSleepMin', 'manualSleepQual', 'manualReadiness', 'manualSleep']) {
            if (prev[k] != null) preserved[k] = prev[k];
          }
        }
      } catch { /* start fresh */ }
      try {
        localStorage.setItem(BIOMETRICS_KEY, JSON.stringify({ ...bio, ...preserved }));
      } catch { /* quota */ }
    }
  }
  try { window.dispatchEvent(new CustomEvent('cpi:wearable-synced')); } catch { /* no listeners */ }
  return { ok: true, days: result.entries.length };
}

// Connect from v2 Sources: permission prompt → flags → first pull.
export async function connectAppleHealth() {
  if (!isAvailable()) return { ok: false, error: 'Apple Health is only available in the iOS app.' };
  const perm = await requestPermission();
  if (!perm.granted) {
    return { ok: false, error: 'Health access wasn’t granted. You can allow it in iOS Settings → Health → Data Access.' };
  }
  try {
    localStorage.setItem(GRANTED_KEY, 'true');
    localStorage.setItem(SEEN_KEY, new Date().toISOString());
  } catch { /* quota */ }
  try {
    return await pullAndMerge();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Manual "Sync now" from v2 Sources.
export async function syncAppleHealthNow() {
  if (!isAvailable() || !appleHealthGranted()) return { ok: false, error: 'Not connected' };
  try {
    return await pullAndMerge();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Periodic delta sync — v2 Shell calls this on mount, mirroring the age
// gate CPI's tick uses so the pull doesn't fire on every app open.
export async function syncAppleHealthIfDue(thresholdMs = 60 * 60 * 1000) {
  if (!isAvailable() || !appleHealthGranted()) return { ok: false, skipped: true };
  const last = appleHealthLastSync();
  const age = last ? Date.now() - new Date(last).getTime() : Infinity;
  if (age <= thresholdMs) return { ok: true, skipped: true };
  try {
    return await pullAndMerge();
  } catch {
    return { ok: false, skipped: false };
  }
}

export function disconnectAppleHealth() {
  // iOS owns the actual permission — revoking happens in the Health app.
  // Ori-side, stop reading: clear the grant flag; history already merged
  // stays (deletable in Export & privacy), same contract as Oura.
  try {
    localStorage.removeItem(GRANTED_KEY);
    // Also clear the "seen at" marker — the web/non-iOS Sources pill reads it
    // as a fallback (ahGranted || ahOn), so without this the row keeps saying
    // "Connected" after a disconnect, disagreeing with the Settings summary.
    localStorage.removeItem(SEEN_KEY);
  } catch { /* fine */ }
}
