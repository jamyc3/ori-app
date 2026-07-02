// Ori v2 — shared Patterns data loaders.
//
// One source of truth for the six lens findings + the day index, consumed by
// both the Patterns tab (the tiles) and PatternDetail (the drill-downs), so a
// tile and its detail can never read the user's history differently. Pure
// reads from localStorage; no React. The findings come from the same v1
// aggregators the classic app uses — real readings, "calibrating" until there
// is enough history.

import {
  rhythmsFinding,
  returnsFinding,
  driftsFinding,
  weatherFinding,
  streakStats,
  highlightsFinding,
} from '../patterns-aggregators.js';
import { pickActiveThread } from '../threads.js';
import { loadConfirmations } from '../confirmations.js';
import { PARTS_LIB } from '../LetterReading.jsx';
import { computeBiometricTrends, OURA_HISTORY_KEY, loadRepo } from '../engine.js';
import { loadSelfReportedSleepWindow } from '../sleep-window.js';
import { ymd } from '../date-util.js';

// Re-exported so existing consumers (Patterns, PatternDetail) keep importing
// ymd from here; the definition now lives in date-util.js.
export { ymd };

export function loadHistory() {
  try {
    const raw = localStorage.getItem('cpi-v2-data');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (parsed?.history || []);
  } catch {
    return [];
  }
}

export function entryDate(entry) {
  const v = entry?.date;
  if (!v) return null;
  // Parse YYYY-MM-DD as a LOCAL date (matching the aggregators) so a day
  // key never UTC-shifts to the day before in negative timezones — which
  // would make a lit streak cell fail to resolve back to its entry.
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// Map ISO day → the (first) entry written that day. Used to resolve a tapped
// calendar cell / scatter dot back to a real day.
export function historyByDay(history) {
  const map = {};
  for (const h of history || []) {
    const d = entryDate(h);
    if (!d) continue;
    const key = ymd(d);
    if (!map[key]) map[key] = h;
  }
  return map;
}

// Compute all six lens findings once, from the same inputs v1 uses.
export function computeFindings(history) {
  let ouraMap = null;
  try { ouraMap = JSON.parse(localStorage.getItem(OURA_HISTORY_KEY) || 'null'); } catch { /* none */ }
  let trends = null;
  try {
    if (ouraMap) trends = computeBiometricTrends(ouraMap, ymd(new Date()));
  } catch { /* sparse */ }
  const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
  const repoDates = safe(() => (loadRepo().entries || [])
    .map((e) => (typeof e?.date === 'string' ? e.date.slice(0, 10) : null))
    .filter(Boolean), []);
  // Drifts and the sleep Threads would otherwise narrate the same sleep story
  // side by side. Compute Drifts first; if it's showing a real sleep reading,
  // ask Threads to prefer a non-sleep thread (see pickActiveThread/avoidSleep).
  const drifts = safe(() => driftsFinding(history, trends, ouraMap), null);
  const driftsShowsSleep = !!(drifts && !drifts.calibrating);
  const rhythms = safe(() => rhythmsFinding(history, trends, ouraMap, { selfReportedSleepWindow: loadSelfReportedSleepWindow() }), null);
  return {
    streaks: safe(() => streakStats(history, repoDates), null),
    rhythms,
    returns: safe(() => returnsFinding(history, loadConfirmations(), PARTS_LIB), null),
    drifts,
    // Weekday strength is Rhythms' lens only now — Threads no longer carries it,
    // so there's no avoidWeekday to pass. Drifts still owns the sleep story.
    threads: safe(() => pickActiveThread(history, trends, ouraMap, { avoidSleep: driftsShowsSleep }), null),
    highlights: safe(() => highlightsFinding(history, 30), null),
    weather: safe(() => weatherFinding(history, trends, 30), null),
  };
}
