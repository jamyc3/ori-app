// WHO-5 Wellbeing Index — 5-item self-report instrument.
//
// Each item is a short statement; the user rates how much of today
// each one felt true on a 6-point Likert (0 = at no time → 5 = all
// of the time). Score = sum (0–25) × 4 = 0–100.
//
// Daily framing ("today, …") preserves item structure per Bech 2003
// and Krieger 2014. The original 2-week framing is also supported by
// Topp 2015. Reliability across populations: α = .83–.93.
//
// Storage is keyed by local-date YYYY-MM-DD in its own localStorage
// key, decoupled from the journal-entry history — WHO-5 can be logged
// without writing a journal that day, and journal entries can be
// saved without WHO-5.

export const WHO5_ITEMS = [
  { id: "cheerful", short: "Cheerful & good spirits", body: "I felt cheerful and in good spirits." },
  { id: "calm",     short: "Calm & relaxed",          body: "I felt calm and relaxed." },
  { id: "active",   short: "Active & vigorous",       body: "I felt active and vigorous." },
  { id: "rested",   short: "Fresh & rested",          body: "I woke up feeling fresh and rested." },
  { id: "interest", short: "Things that interest me", body: "My day was filled with things that interest me." },
];

export const WHO5_SCALE = [
  { v: 0, label: "At no time" },
  { v: 1, label: "Some of the time" },
  { v: 2, label: "Less than half" },
  { v: 3, label: "More than half" },
  { v: 4, label: "Most of the time" },
  { v: 5, label: "All of the time" },
];

// Topp 2015 cutoffs — published bands for the WHO-5 0–100 scale:
//   ≤28  — low wellbeing / consider follow-up
//   29–50 — below average
//   51–72 — typical
//   ≥73  — optimal
export const WHO5_BANDS = [
  { from: 0,  to: 28,  key: "low",     label: "Low" },
  { from: 29, to: 50,  key: "below",   label: "Below average" },
  { from: 51, to: 72,  key: "typical", label: "Typical" },
  { from: 73, to: 100, key: "optimal", label: "Optimal" },
];

// Returns 0–100 score from a 5-item Likert array, or null if invalid.
// Math: sum (0–25) * 4. Reference: Topp et al. 2015 (PMID 25831962).
export function scoreWho5(items) {
  if (!Array.isArray(items) || items.length !== 5) return null;
  let sum = 0;
  for (const v of items) {
    if (typeof v !== "number" || v < 0 || v > 5 || !Number.isFinite(v)) return null;
    sum += v;
  }
  return sum * 4;
}

export function bandFor(score) {
  if (typeof score !== "number" || isNaN(score)) return null;
  for (const b of WHO5_BANDS) {
    if (score >= b.from && score <= b.to) return b;
  }
  return null;
}

const STORAGE_KEY = "cpi_who5_history";

function ymdLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Full WHO-5 history map keyed by YYYY-MM-DD (local date):
//   { "2026-05-13": { items: [4,3,4,3,4], score: 72, ts: "..." } }
export function loadWho5History() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

// Save today's WHO-5. items: number[5], each 0–5.
export function saveTodayWho5(items, when = new Date()) {
  const score = scoreWho5(items);
  if (score == null) return null;
  const dateKey = ymdLocal(when);
  const map = loadWho5History();
  map[dateKey] = { items: items.slice(), score, ts: when.toISOString() };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* ignore quota */ }
  try { window.dispatchEvent(new Event("cpi:who5-updated")); } catch { /* ignore */ }
  return { date: dateKey, score, items: items.slice() };
}

export function todayWho5(when = new Date()) {
  const k = ymdLocal(when);
  const map = loadWho5History();
  return map[k] || null;
}

// Returns chronological list of WHO-5 entries within the last `days`
// days. Missing days are skipped, not nulled — array length = count
// of days with data. Used by the Day-to-day steadiness card and the
// Wellbeing baro once those swap over (later PRs).
export function recentWho5(days = 30, when = new Date()) {
  const map = loadWho5History();
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(when); d.setDate(when.getDate() - i);
    const k = ymdLocal(d);
    if (map[k]) out.push({ date: k, score: map[k].score, items: map[k].items });
  }
  return out;
}

// Chronological 14-day (or N-day) chart series of WHO-5 scores
// normalized to 0–1 for the ChartCard component. Missing days are
// null, preserving the date axis so a sparse WHO-5 history still
// renders a continuous chart with visible gaps.
export function who5Series(days = 14, when = new Date()) {
  const map = loadWho5History();
  const out = [];
  const today = new Date(when); today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const k = ymdLocal(d);
    const entry = map[k];
    out.push({
      date: d,
      value: entry && typeof entry.score === "number" ? entry.score / 100 : null,
    });
  }
  return out;
}

// First-N WHO-5 anchor — median of the earliest N days with a logged
// WHO-5 score. Returned as a normalized 0–1 value to match the chart
// series scale. Null until the user has at least N days logged.
export function firstNAnchorWho5(n = 30) {
  const map = loadWho5History();
  const dated = [];
  for (const [k, v] of Object.entries(map)) {
    if (typeof v?.score !== "number") continue;
    const t = new Date(k + "T00:00:00").getTime();
    if (!Number.isFinite(t)) continue;
    dated.push({ t, v: v.score / 100 });
  }
  if (dated.length < n) return null;
  dated.sort((a, b) => a.t - b.t);
  const first = dated.slice(0, n).map((d) => d.v).sort((a, b) => a - b);
  // True median — average the two middle values for an even count, matching the
  // shared median rule (engine.js / inboxAlerts). Picking the upper-middle
  // biased the frozen anchor slightly high on even windows.
  const m = Math.floor(first.length / 2);
  return first.length % 2 ? first[m] : (first[m - 1] + first[m]) / 2;
}
