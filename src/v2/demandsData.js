// Ori v2 — Demands daily values, one source of truth.
//
// Today's legend, the Ring detail chart, and the Day view all read the
// Demands ring through buildDemandsLookup() so the three surfaces can
// never disagree. A day's value (0–100) is the mean of the contributors
// that actually exist for that day — the same inputs v1's computeStats
// uses for the Demands bucket, with the same caps:
//
//   · Decisions named in the analyzed writing   min(1, decisionCount / 15)
//   · Context shifts (params.C)                 min(1, (C − 1) / 3)
//   · Interruption cost (calendar)              days with ≥1 meeting only
//   · Being-seen weight (calendar)              days with ≥1 meeting only
//
// Honesty: every contributor is observed (counted from your writing or
// your calendar) and the result is read against your own trend only —
// classifyBucket z-scores it over your last 30 days and stays "Warming
// up" below its 10-day baseline. Days with no contributor return null;
// nothing is interpolated or fabricated.

import { hasAnyFeed, allEvents } from '../calendar.js';
import {
  signalsForWindow,
  interruptionCost,
  beingSeenWeight,
} from '../calendar-signals.js';

function loadAnalyzedHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem('cpi-v2-data') || 'null');
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.history)) return parsed.history;
    return [];
  } catch {
    return [];
  }
}

// Bucket an entry by its LOCAL calendar day. Entry dates are full ISO
// timestamps (an evening letter writes `now.toISOString()`); slicing the first
// 10 chars uses the UTC date, which rolls to *tomorrow* for an evening writer
// behind UTC — so that day's Demands landed on the wrong date. Convert the
// timestamp to the local day instead (matching the Day view); a bare
// YYYY-MM-DD is already a calendar date and passes through unchanged.
function localDayKey(dateStr) {
  if (typeof dateStr !== 'string' || !dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Build a (dateKey → value|null) lookup over roughly the last `days`.
// Lookups outside the calendar window still get journal contributors.
export function buildDemandsLookup({ days = 35, now = new Date() } = {}) {
  // Latest analyzed entry per local date (history is newest-first).
  const journalByDate = new Map();
  for (const h of loadAnalyzedHistory()) {
    const d = localDayKey(h?.date);
    if (!d || journalByDate.has(d)) continue;
    journalByDate.set(d, h);
  }

  // Calendar signals per date — only when a source is connected.
  const calByDate = new Map();
  if (hasAnyFeed()) {
    try {
      for (const s of signalsForWindow(allEvents(), days, now) || []) {
        if (s?.date) calByDate.set(s.date, s);
      }
    } catch {
      // Calendar unreadable — journal contributors still apply.
    }
  }

  return function demandsValueFor(dateKey) {
    const vals = [];
    const h = journalByDate.get(dateKey);
    if (typeof h?.decisionCount === 'number') {
      vals.push(Math.min(1, h.decisionCount / 15));
    }
    if (h?.params?.C != null) {
      vals.push(Math.min(1, (h.params.C - 1) / 3));
    }
    const s = calByDate.get(dateKey);
    if (s && s.meetings > 0) {
      const ic = interruptionCost(s);
      if (typeof ic === 'number') vals.push(ic);
      const bs = beingSeenWeight(s);
      if (typeof bs === 'number') vals.push(bs);
    }
    if (!vals.length) return null;
    return (vals.reduce((a, b) => a + b, 0) / vals.length) * 100;
  };
}
