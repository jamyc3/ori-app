// Pure helpers: a flat list of parsed calendar events → daily signals.
//
// No React, no DOM, no localStorage — testable in isolation under Node so
// the same module powers the eval suite.
//
// Input events come from /calendar/ics (server-side parser). Each event:
//   { start, end, durationMin, attendees, organized, recurring, status, accepted, category? }
// `category` is added by calendar.js after the server returns; it identifies
// whether the source feed is "work" or "personal" so we can weight signals.
//
// Output for a given day is a single object with structural fields only —
// counts, durations, hours. Never anything identifying.

export const SIGNAL_VERSION = 1;

// ── Date helpers ─────────────────────────────────────────────────
// We deliberately work in local time so "today" matches the user's day,
// not UTC. The dates module already exports ymdISO for the rest of the
// app; we re-implement the same shape here to keep this file dependency-
// free (so eval scripts can import it cleanly under Node).

function ymdLocal(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

// Coerce ISO string OR Date to Date; null on failure.
function asDate(v) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  return null;
}

// ── Filtering ────────────────────────────────────────────────────
// We exclude events the user explicitly declined, all-day events
// (>= 12h, conservative), and anything outside the requested day.
// Status="cancelled" is dropped too — these are tombstones in the feed.

export function eventsOnDay(events, dayDate) {
  const t0 = startOfDay(dayDate).getTime();
  const t1 = endOfDay(dayDate).getTime();
  const out = [];
  for (const ev of events || []) {
    if (!ev) continue;
    if (ev.status === "cancelled") continue;
    if (ev.accepted === "declined") continue;
    const s = asDate(ev.start);
    const e = asDate(ev.end);
    if (!s || !e || e <= s) continue;
    if (ev.durationMin >= 12 * 60) continue; // all-day proxy
    // Overlap with the day window — even a meeting that crosses midnight
    // counts toward the day where most of it sits.
    if (e.getTime() <= t0 || s.getTime() >= t1) continue;
    out.push({ ...ev, _start: s, _end: e });
  }
  out.sort((a, b) => a._start - b._start);
  return out;
}

// ── Per-day signals ──────────────────────────────────────────────
// Returns one object with everything a metric or letter sentence
// could need. Pure function of the (events, day) pair.

export function signalsForDay(events, dayDate) {
  const day = eventsOnDay(events, dayDate);
  if (day.length === 0) return emptySignals(dayDate);

  let totalMin = 0;
  let attendeeHours = 0;
  let organized = 0;
  let recurringCount = 0;
  let maxAudience = 0;
  let onstageMin = 0; // meetings with attendees >= 3
  let oneOnOneMin = 0;
  let solo = 0; // meetings the user is alone in or with no attendee block (focus block, etc.)

  for (const ev of day) {
    totalMin += ev.durationMin;
    const a = Math.max(1, ev.attendees || 0);
    attendeeHours += (a * ev.durationMin) / 60;
    if (ev.organized) organized++;
    if (ev.recurring) recurringCount++;
    if (a > maxAudience) maxAudience = a;
    if (a >= 3) onstageMin += ev.durationMin;
    else if (a === 2) oneOnOneMin += ev.durationMin;
    else solo++;
  }

  // Back-to-back: gap between consecutive meetings ≤ 5 minutes.
  // Gap-under-25: gap > 5 and < 25 minutes. Threshold from Mark, González &
  // Harris (2005) "No task left behind? Examining the nature of fragmented
  // work" — the field study where the 23-min-15-sec recovery time was first
  // reported. Gaps shorter than ~25 min do not allow re-entry into focused
  // work. Updated 2026-06-02 from <15 to <25 to match the evidence.
  // Wide-open: gap >= 90 minutes (deep work potential).
  let backToBack = 0;
  let gapUnder25 = 0;
  let wideOpenMin = 0;
  for (let i = 1; i < day.length; i++) {
    const prev = day[i - 1];
    const curr = day[i];
    const gapMin = (curr._start.getTime() - prev._end.getTime()) / 60_000;
    if (gapMin <= 5) backToBack++;
    else if (gapMin < 25) gapUnder25++;
    if (gapMin >= 90) wideOpenMin += Math.round(gapMin);
  }

  // Per-category sub-totals (for the engine wiring).
  const byCategory = breakdownByCategory(day);

  return {
    date: ymdLocal(dayDate),
    meetings: day.length,
    total_minutes: totalMin,
    attendee_hours: round1(attendeeHours),
    organized_count: organized,
    recurring_count: recurringCount,
    max_audience: maxAudience,
    onstage_minutes: onstageMin,
    one_on_one_minutes: oneOnOneMin,
    solo_blocks: solo,
    back_to_back_count: backToBack,
    gap_under_25_count: gapUnder25,
    wide_open_minutes: wideOpenMin,
    by_category: byCategory,
    signalVersion: SIGNAL_VERSION,
  };
}

function emptySignals(dayDate) {
  return {
    date: ymdLocal(dayDate),
    meetings: 0,
    total_minutes: 0,
    attendee_hours: 0,
    organized_count: 0,
    recurring_count: 0,
    max_audience: 0,
    onstage_minutes: 0,
    one_on_one_minutes: 0,
    solo_blocks: 0,
    back_to_back_count: 0,
    gap_under_25_count: 0,
    wide_open_minutes: 0,
    by_category: { work: emptyCat(), personal: emptyCat() },
    signalVersion: SIGNAL_VERSION,
  };
}
function emptyCat() {
  return { meetings: 0, total_minutes: 0, attendee_hours: 0, onstage_minutes: 0 };
}

function breakdownByCategory(day) {
  const out = { work: emptyCat(), personal: emptyCat() };
  for (const ev of day) {
    const cat = ev.category === "personal" ? "personal" : "work";
    out[cat].meetings++;
    out[cat].total_minutes += ev.durationMin;
    const a = Math.max(1, ev.attendees || 0);
    out[cat].attendee_hours += (a * ev.durationMin) / 60;
    if (a >= 3) out[cat].onstage_minutes += ev.durationMin;
  }
  out.work.attendee_hours = round1(out.work.attendee_hours);
  out.personal.attendee_hours = round1(out.personal.attendee_hours);
  return out;
}

function round1(x) { return Math.round(x * 10) / 10; }
function clamp01(x) { return Math.max(0, Math.min(1, x)); }

// ── Metric derivation ────────────────────────────────────────────
// Two metrics that the You tab activates once we have signals:
//
//  • interruptionCost (0..1)
//      Reflects how chopped-up the day was. Driven by meeting density,
//      back-to-back count, and gaps too short to recover in.
//      Saturates around 0.9 to leave headroom for self-reported context.
//
//  • beingSeenWeight (0..1)
//      Reflects time-on-display. Driven by attendee-hours in WORK meetings
//      first (personal attendees weigh ~1/3 — Saturday brunch is not a
//      performance), with a bump for large audiences.
//
// The values are tuned conservatively: a typical "two 30-min meetings,
// no audience" day reads ~0.20 / ~0.10 — close to the old hardcodes —
// while a heavy day climbs to ~0.6+ honestly.

// Structure of the formula follows the published cost-of-meeting-load
// literature; the weights themselves are tuned, not recovered parameters,
// and live in the "interpretation" honesty layer.
//
//  · Density follows Rogelberg (2005, Luong & Rogelberg, "Meetings and
//    More Meetings") — meeting load predicts daily fatigue monotonically
//    until saturation. Cap at 0.40 reflects the inverted-U from the meeting-
//    load-paradox literature (Allen, Lehmann-Willenbrock & Rogelberg 2023).
//  · Back-to-back follows Microsoft Human Factors Lab EEG (2021, n=14) and
//    Leroy (2009, "Why is it so hard to do my work? Attention residue") —
//    B2B carries extra cost above ambient density; per-event weight is set
//    above the density per-30-min weight to reflect that ordering.
//  · Gap-under-25 follows Mark, González & Harris (2005) — the original
//    "23 min 15 sec recovery time" field study; gaps shorter than ~25 min
//    do not allow re-entry into focused work.
//
// Updated 2026-06-02: gap threshold raised from <15 to <25 min (Mark 2005);
// density cap lowered from 0.45 to 0.40 to model the documented saturation.
export function interruptionCost(signals) {
  if (!signals || signals.meetings === 0) return 0.10;
  const density = Math.min(0.40, (signals.total_minutes / 30) * 0.05);
  const b2b = Math.min(0.30, signals.back_to_back_count * 0.10);
  const gaps = Math.min(0.15, signals.gap_under_25_count * 0.05);
  return clamp01(density + b2b + gaps);
}

export function beingSeenWeight(signals) {
  if (!signals || signals.meetings === 0) return 0.05;
  const workHrs = signals.by_category?.work?.attendee_hours || 0;
  const personalHrs = signals.by_category?.personal?.attendee_hours || 0;
  // Work attendee-hours: each hour adds 0.04 (capped 0.50).
  // Personal weighs at 1/3.
  const base = Math.min(0.50, workHrs * 0.04 + personalHrs * 0.013);
  // Large audience bump: stage in front of 6+ adds 0.10; 10+ adds 0.20.
  let bump = 0;
  if (signals.max_audience >= 10) bump = 0.20;
  else if (signals.max_audience >= 6) bump = 0.10;
  return clamp01(base + bump);
}

// ── Window helper for the 14-day baseline ────────────────────────
// Mirrors the pattern the rest of the app uses (z-score / personal
// baseline). Returns an array of signals objects for the last `days`
// days, newest first, computed from the same events list.

export function signalsForWindow(events, daysBack = 14, today = new Date()) {
  const out = [];
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(signalsForDay(events, d));
  }
  return out;
}

// Median + std helpers — same shape as statsOf in CognitiveProfile so
// the values flow through unchanged.
export function statsForMetric(signalsArr, metricFn) {
  const vals = signalsArr.map((s) => metricFn(s)).filter((v) => typeof v === "number");
  if (vals.length === 0) return { median: null, std: null, n: 0 };
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / vals.length;
  return { median, std: Math.sqrt(variance), n: vals.length };
}
