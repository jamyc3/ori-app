/* ─────────────────────────────────────────────────────────────────
   part-history — extended compute layer on top of parts-stats.js.

   Provides the rich per-part signals that drive the redesigned
   Part-detail screen, the All-Parts list, and the Inbox part-related
   cards. Built on the existing parts-stats.js primitives — does not
   replace them.

   What's new here (vs parts-stats.js):
   • Thank events — one new persistent store (`cpi_part_thanks` in
     localStorage). The user can acknowledge a part from the detail
     screen; the gesture differs by part type — thank / tend / receive
     (see thankModeFor). Events are tracked for ordering but do NOT
     advance familiarity (THANK_WEIGHT = 0, by design).
   • Familiarity stages — Newcomer / Regular / Frequent / Constant at
     thresholds 3 / 8 / 15 effective familiarity. Specified in
     prototype/docs/PARTS_PLAN.md.
   • Volume distribution per part — loud / present / brief shares,
     so the user can see HOW a part shows up, not just IF.
   • Co-occurrence — top other parts that share letters with this one.
   • Day-of-week affinity — only surfaces when there's enough data
     and a real peak (≥ 5 visits, peak ≥ 1.5× the average non-peak day).
   • Recent-vs-all-time trend — "louder" / "quieter" / "steady",
     gated on ≥ 60 days of writing history and ≥ 5 visits.
   • A single `statsFor(history, part, thanks)` entry point that
     returns everything a UI surface needs in one call.

   What's NOT new — visits, first/last seen, the z-score gating, and
   companion qualification still live in parts-stats.js. We reuse them.

   ━━━ INVARIANT — history is newest-first ━━━
   Same as parts-stats.js. Index 0 is the most recent entry. If you
   ever change storage to chronological order, every "last seen"
   number in this module silently inverts. Don't.

   Pure functions wherever possible. The only side-effecting bits are
   loadThanks/saveThanks/appendThank, which touch localStorage and
   gracefully degrade if storage is missing or quota-bound.
   ───────────────────────────────────────────────────────────────── */

import {
  partAppearanceDays,
  firstSeenForPart,
  lastSeenForPart,
  totalLetterDays,
  entryHasPart,
  personalDriverStats,
} from "./parts-stats.js";
import { ymdISO } from "./dates.js";

// Parse an entry date to a LOCAL Date. A bare "YYYY-MM-DD" (what saveEntry
// writes) must be read as a local calendar day, NOT UTC midnight — otherwise
// new Date() interprets it as UTC and .getDay()/ymdISO shift a day back in
// negative-UTC zones (all of the Americas), mis-bucketing weekday affinity and
// breaking "first appearance today". Full ISO timestamps fall through to the
// Date constructor unchanged. Mirrors patterns-aggregators.js entryDate().
function localDateFromStamp(v) {
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// ── Constants ─────────────────────────────────────────────────────────
// All thresholds are specified in prototype/docs/PARTS_PLAN.md. Change them
// there first, then mirror here, so the spec and the code can never drift.

export const PART_THANKS_KEY = "cpi_part_thanks";

// ── Stage names — honest frequency labels ─────────────────────────────
// Stages reflect HOW OFTEN a part has shown up in letters, not relational
// depth. Earlier names (Stranger / Acquainted / Known / Close) suggested
// a quality of relationship that pure visit counts can't earn. These are
// frequency labels — true to the math, theory-clean under IFS.
//
// If relational quality (Self-energy co-occurrence, reflective tone,
// thank-to-visit ratio) lands later, we may re-introduce a separate
// "relational" axis. The frequency axis stays.

export const STAGE_NEWCOMER = "newcomer";
export const STAGE_REGULAR = "regular";
export const STAGE_FREQUENT = "frequent";
export const STAGE_CONSTANT = "constant";

export const STAGE_THRESHOLDS = {
  [STAGE_REGULAR]: 3,
  [STAGE_FREQUENT]: 8,
  [STAGE_CONSTANT]: 15,
};

// ── Thank weight — set to 0 by design ─────────────────────────────────
// Initially THANK_WEIGHT = 2 (one thank ≈ two visits worth of stage
// progression). An IFS reviewer flagged this as folding gamification
// into a clinical model — stages are evidence of what showed up, not
// of user clicks. Thanks are tracked (counts surface in the per-Part
// UI and drive UX reordering in sortPartsForList) but do NOT advance
// stage. Keep at 0 unless we add a separate engagement axis.

export const THANK_WEIGHT = 0;
export const RECENT_THANK_WINDOW_DAYS = 7;

// ── Thank modes — the gesture is not one act ──────────────────────────
// Per IFS (Schwartz), "thanking" differs by part type, and conflating them
// is a clinical error rather than a UX nicety:
//   • Protectors (managers + firefighters) — appreciation helps them
//     unblend and relax their grip. "Thank" is the right gesture.
//   • Exiles — you do NOT thank-and-move-on (that's a bypass). You tend the
//     need first, then witness. Mode: "tend".
//   • Self-energy figures — Self isn't thanked, it's received. Mode: "receive".
// The mode drives the button label, the confirmation word, and the framing
// in PartDetail.jsx. Copy lives there; the model (which part is which) lives
// here. Full rationale + decision log: prototype/docs/PARTS_PLAN.md.
export const THANK_MODE_THANK = "thank";
export const THANK_MODE_TEND = "tend";
export const THANK_MODE_RECEIVE = "receive";

// Classification mirrors IFS_ROLE in PartDetail.jsx: planner/watcher/hesitant
// are managers and seeker is a firefighter (all protectors → "thank"); tender
// is the one exile (→ "tend"); gentle/witness/maker are Self-energy companions
// (→ "receive"). Unknown ids default to "thank" — the safest gesture.
export const PART_THANK_MODE = {
  planner: THANK_MODE_THANK,
  watcher: THANK_MODE_THANK,
  hesitant: THANK_MODE_THANK,
  seeker: THANK_MODE_THANK,
  tender: THANK_MODE_TEND,
  gentle: THANK_MODE_RECEIVE,
  witness: THANK_MODE_RECEIVE,
  maker: THANK_MODE_RECEIVE,
};

export function thankModeFor(partId) {
  return PART_THANK_MODE[partId] || THANK_MODE_THANK;
}

export const DAY_OF_WEEK_MIN_VISITS = 5;
export const DAY_OF_WEEK_PEAK_RATIO = 1.5;
export const COOCCURRENCE_MIN_SHARED = 3;
export const COOCCURRENCE_TOP_K = 3;
export const TREND_WINDOW_DAYS = 30;
export const TREND_HISTORY_FLOOR_DAYS = 60;
export const TREND_MIN_VISITS = 5;
export const TREND_DELTA_THRESHOLD = 0.5;

// ── Thank events store ────────────────────────────────────────────────
// Shape on disk: ThankEvent[] under PART_THANKS_KEY in localStorage.
// ThankEvent = { partId: string, dateISO: string, letterDate?: string }.
//
// localStorage is the right home: each event is ~80 bytes; even a heavy
// user (1 thank/day for 10 years) caps at ~300KB. No need for IndexedDB.

export function loadThanks() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(PART_THANKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Malformed JSON or storage unavailable — return empty rather than crash.
    return [];
  }
}

export function saveThanks(thanks) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PART_THANKS_KEY, JSON.stringify(thanks));
  } catch {
    // Quota exceeded — accept the loss silently rather than crash the app.
    // A future improvement could prune oldest events.
  }
}

export function appendThank(partId, letterDate = null, now = new Date()) {
  if (!partId) return null;
  // Validate letterDate before storing. A malformed string would persist
  // silently and trip `new Date(letterDate)` consumers downstream. Rather
  // than store garbage, drop the field and keep the thank event intact.
  let safeLetterDate = null;
  if (letterDate) {
    const parsed = new Date(letterDate);
    if (!isNaN(parsed.getTime())) safeLetterDate = letterDate;
  }
  const thanks = loadThanks();
  const event = {
    partId: String(partId),
    dateISO: now.toISOString(),
    letterDate: safeLetterDate,
  };
  thanks.push(event);
  saveThanks(thanks);
  return event;
}

export function thanksFor(partId, thanks = null) {
  if (!partId) return 0;
  const t = thanks ?? loadThanks();
  let n = 0;
  for (const e of t) if (e?.partId === partId) n++;
  return n;
}

// ── Validated acknowledgments — the separate descriptive axis (Phase 3) ────
// A reflection-backed acknowledgment is a richer event than a tap: it carries
// the person's own words (a capped excerpt) and Ori's mirror, so the UI can
// surface CONTINUITY ("last time you turned toward X, you wrote …") — never a
// count, score, or streak (docs/PARTS_PLAN.md). Stored in the SAME
// cpi_part_thanks array as taps, distinguished by `validated: true`, so the
// existing sink-to-back ordering treats both alike. It does NOT touch
// familiarity: THANK_WEIGHT is 0, so neither taps nor validated reflections
// move the frequency stage. Local-only, like the journal — never sent anywhere.
//
// AckEvent (superset of ThankEvent):
//   { partId, dateISO, letterDate?, validated?: boolean,
//     reflection?: string (capped), mirror?: string (capped) }
export const ACK_REFLECTION_MAX = 280;

function _capped(s) {
  return typeof s === "string" && s.trim()
    ? s.trim().slice(0, ACK_REFLECTION_MAX)
    : null;
}

export function appendAcknowledgment(partId, opts = {}) {
  if (!partId) return null;
  const { validated = false, reflection = null, mirror = null, letterDate = null, now = new Date() } = opts;
  let safeLetterDate = null;
  if (letterDate) {
    const parsed = new Date(letterDate);
    if (!isNaN(parsed.getTime())) safeLetterDate = letterDate;
  }
  const event = {
    partId: String(partId),
    dateISO: now.toISOString(),
    letterDate: safeLetterDate,
    validated: validated === true,
  };
  const refl = _capped(reflection);
  const mir = _capped(mirror);
  if (refl) event.reflection = refl;
  if (mir) event.mirror = mir;
  const thanks = loadThanks();
  thanks.push(event);
  saveThanks(thanks);
  return event;
}

// Most recent VALIDATED acknowledgment for a part — the continuity surface.
// Returns { dateISO, reflection|null, mirror|null, daysAgo|null } or null.
export function lastAcknowledgmentFor(partId, thanks = null, now = new Date()) {
  if (!partId) return null;
  const t = thanks ?? loadThanks();
  let best = null;
  for (const e of t) {
    if (e?.partId !== partId || e?.validated !== true) continue;
    if (!best || (e.dateISO || "") > (best.dateISO || "")) best = e;
  }
  if (!best) return null;
  const ms = new Date(best.dateISO).getTime();
  const daysAgo = isNaN(ms) ? null : Math.floor((now.getTime() - ms) / 86400000);
  return { dateISO: best.dateISO, reflection: best.reflection ?? null, mirror: best.mirror ?? null, daysAgo };
}

// All validated acknowledgments for a part, newest-first — the trace/timeline.
export function acknowledgmentsFor(partId, thanks = null) {
  if (!partId) return [];
  const t = thanks ?? loadThanks();
  return t
    .filter((e) => e?.partId === partId && e?.validated === true)
    .sort((a, b) => (b.dateISO || "").localeCompare(a.dateISO || ""));
}

// ── Familiarity (effective = visits + THANK_WEIGHT × thanks) ──────────
// THANK_WEIGHT is 0 by design (see the locked decision above), so effective
// familiarity equals visit days: neither taps nor validated acknowledgments
// move the frequency stage. The multiplier stays in the formula only as the
// single switch if a separate engagement axis is ever introduced — it must
// never be folded back into this frequency stage (docs/PARTS_PLAN.md).

export function effectiveFamiliarity(history, part, thanks = null) {
  if (!part) return 0;
  const visits = partAppearanceDays(history, part);
  const t = thanksFor(part.id, thanks);
  return visits + THANK_WEIGHT * t;
}

export function stageFor(effective) {
  if (!Number.isFinite(effective) || effective < 0) return STAGE_NEWCOMER;
  if (effective >= STAGE_THRESHOLDS[STAGE_CONSTANT]) return STAGE_CONSTANT;
  if (effective >= STAGE_THRESHOLDS[STAGE_FREQUENT]) return STAGE_FREQUENT;
  if (effective >= STAGE_THRESHOLDS[STAGE_REGULAR]) return STAGE_REGULAR;
  return STAGE_NEWCOMER;
}

// Did a stage boundary just get crossed? Used by the Inbox cadence engine
// to fire the part-familiarity-milestone card (see prototype/docs/PARTS_PLAN.md).
// Returns the NEW stage if crossed, or null. Downgrades return null too —
// effective familiarity only rises as visit days accrue (THANK_WEIGHT is 0),
// but defensively we don't fire on going-down.
export function stageTransition(prevEffective, nextEffective) {
  if (!Number.isFinite(prevEffective) || !Number.isFinite(nextEffective)) return null;
  if (nextEffective <= prevEffective) return null;
  const prev = stageFor(prevEffective);
  const next = stageFor(nextEffective);
  return prev === next ? null : next;
}

/**
 * Map effective familiarity to [0, 1] for the progress bar. Piecewise
 * linear across stage windows so the bar fills smoothly within a stage
 * rather than jumping at boundaries.
 *
 *   [0, 3)   → 0      .. 0.25   (Newcomer window)
 *   [3, 8)   → 0.25   .. 0.50   (Regular window)
 *   [8, 15)  → 0.50   .. 0.75   (Frequent window)
 *   [15, ∞)  → 0.75   .. 1      (Constant, asymptotic — 30 visits ≈ 1.0)
 */
export function familiarityFraction(effective) {
  if (!Number.isFinite(effective) || effective <= 0) return 0;
  const A = STAGE_THRESHOLDS[STAGE_REGULAR];   // 3
  const K = STAGE_THRESHOLDS[STAGE_FREQUENT];  // 8
  const C = STAGE_THRESHOLDS[STAGE_CONSTANT];  // 15
  if (effective >= C) {
    return Math.min(1, 0.75 + ((effective - C) / (C * 2)) * 0.25);
  }
  if (effective >= K) return 0.5 + ((effective - K) / (C - K)) * 0.25;
  if (effective >= A) return 0.25 + ((effective - A) / (K - A)) * 0.25;
  return (effective / A) * 0.25;
}

// ── Volume distribution per part ──────────────────────────────────────
// Returns the share of this part's appearances at each volume label.
// Only counts letterParts-attached appearances (where the volume label
// is meaningful) — driver-derived inclusions have no volume label and
// are excluded.

export function volumeDistributionFor(history, part) {
  const empty = { loud: 0, present: 0, brief: 0, total: 0 };
  if (!part || !Array.isArray(history)) return empty;
  let loud = 0, present = 0, brief = 0;
  for (const entry of history) {
    const lps = entry?.letterParts;
    if (!Array.isArray(lps)) continue;
    for (const lp of lps) {
      if (lp?.id !== part.id) continue;
      if (lp.volume === "loud") loud++;
      else if (lp.volume === "present") present++;
      else if (lp.volume === "brief") brief++;
    }
  }
  const total = loud + present + brief;
  if (total === 0) return empty;
  return {
    loud: loud / total,
    present: present / total,
    brief: brief / total,
    total,
  };
}

// ── Co-occurrence ─────────────────────────────────────────────────────
// Top other parts that share letters with this one. Only counts shared
// appearances through letterParts (Claude curated them together in the
// letter, which is a meaningful signal). Driver-derived combinations
// are excluded as too noisy at v1.
//
// Returns up to COOCCURRENCE_TOP_K pairs above the COOCCURRENCE_MIN_SHARED
// threshold, sorted by count then rate. Each pair carries:
//   • partId  — the other part's id
//   • count   — letters they shared
//   • rate    — count / total letters this part appeared in

export function coOccurrencesFor(history, part, opts = {}) {
  if (!part || !Array.isArray(history)) return [];
  const minShared = opts.minShared ?? COOCCURRENCE_MIN_SHARED;
  const topK = opts.topK ?? COOCCURRENCE_TOP_K;
  const counts = new Map();
  let selfLetters = 0;
  for (const entry of history) {
    const lps = entry?.letterParts;
    if (!Array.isArray(lps) || lps.length === 0) continue;
    if (!lps.some(p => p?.id === part.id)) continue;
    selfLetters++;
    for (const other of lps) {
      if (!other?.id || other.id === part.id) continue;
      counts.set(other.id, (counts.get(other.id) || 0) + 1);
    }
  }
  const out = [];
  for (const [partId, count] of counts) {
    if (count < minShared) continue;
    out.push({
      partId,
      count,
      rate: selfLetters > 0 ? count / selfLetters : 0,
    });
  }
  out.sort((a, b) => (b.count - a.count) || (b.rate - a.rate));
  return out.slice(0, topK);
}

// ── Day-of-week affinity ──────────────────────────────────────────────
// Returns the peak weekday (0 = Sunday .. 6 = Saturday) ONLY when the
// part has both ≥ DAY_OF_WEEK_MIN_VISITS total visits AND its peak day
// is ≥ DAY_OF_WEEK_PEAK_RATIO × the average of non-peak days. Otherwise
// returns null — sample's too small to be honest.
//
// Uses the same `entryHasPart` definition as `partAppearanceDays` so
// the "≥ 5 visits" gate here matches the visit count surfaced on the
// stage/familiarity row. Without this alignment a part could show
// "Acquainted · 7 visits" yet have day-of-week silently refuse to
// surface because only the letterParts-attached subset was counted.
//
// Day-of-week is computed in the device's local timezone (matches the
// project convention in dates.js). A user who travels timezones may
// see day-of-week affinity computed against the device's current zone,
// not the zone of writing — accepted v1 limitation.

export function dayOfWeekPeakFor(history, part, statsArg = null) {
  if (!part || !Array.isArray(history)) return null;
  const stats = statsArg ?? personalDriverStats(history);
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  let total = 0;
  for (const entry of history) {
    if (!entryHasPart(entry, part, stats)) continue;
    const d = localDateFromStamp(entry?.date);
    if (!d) continue;
    buckets[d.getDay()]++;
    total++;
  }
  if (total < DAY_OF_WEEK_MIN_VISITS) return null;
  let peakDow = 0;
  let peakCount = -1;
  for (let i = 0; i < 7; i++) {
    if (buckets[i] > peakCount) {
      peakCount = buckets[i];
      peakDow = i;
    }
  }
  const otherAvg = (total - peakCount) / 6;
  if (otherAvg <= 0) {
    // Every visit landed on one weekday. Honest only if there are enough.
    return peakCount >= DAY_OF_WEEK_MIN_VISITS ? peakDow : null;
  }
  return peakCount / otherAvg >= DAY_OF_WEEK_PEAK_RATIO ? peakDow : null;
}

// ── Trend: recent vs all-time ─────────────────────────────────────────
// Compares the part's visit rate over the last TREND_WINDOW_DAYS to its
// rate over the rest of history. Returns "louder" / "quieter" / "steady",
// or null if not enough history for the comparison to be honest.
//
// Honesty gates:
//   • Total history must span ≥ TREND_HISTORY_FLOOR_DAYS (60). Below
//     that, "all-time" isn't really all-time.
//   • Part must have ≥ TREND_MIN_VISITS (5) total appearances.

export function trendLabelFor(history, part) {
  if (!part || !Array.isArray(history) || history.length === 0) return null;
  const totalDays = totalLetterDays(history);
  if (totalDays < TREND_HISTORY_FLOOR_DAYS) return null;
  const allVisits = partAppearanceDays(history, part);
  if (allVisits < TREND_MIN_VISITS) return null;
  const recentVisits = partAppearanceDays(history, part, TREND_WINDOW_DAYS);
  const olderVisits = allVisits - recentVisits;
  const olderDays = Math.max(1, totalDays - TREND_WINDOW_DAYS);
  const recentRate = recentVisits / TREND_WINDOW_DAYS;
  const olderRate = olderVisits / olderDays;
  if (olderRate <= 0) return recentVisits > 0 ? "louder" : null;
  const ratio = recentRate / olderRate;
  if (ratio >= 1 + TREND_DELTA_THRESHOLD) return "louder";
  if (ratio <= 1 - TREND_DELTA_THRESHOLD) return "quieter";
  return "steady";
}

// ── Quiet streak ──────────────────────────────────────────────────────
// Days since this part last appeared. Null if never seen.

export function quietStreakDaysFor(history, part) {
  const last = lastSeenForPart(history, part);
  return last ? last.daysAgo : null;
}

// ── Frequency rate ────────────────────────────────────────────────────
// Visits divided by total letter days. 0..1.

export function frequencyRateFor(history, part) {
  const total = totalLetterDays(history);
  if (total === 0) return 0;
  return partAppearanceDays(history, part) / total;
}

// ── First-time-today detection ────────────────────────────────────────
// True if today's letter contains this part AND no prior history entry
// did. Used by the Inbox first-time-appearance card (cadence rule #9).

export function isFirstAppearanceToday(history, part, now = new Date()) {
  if (!part || !Array.isArray(history) || history.length === 0) return false;
  const today = history[0];
  if (!today?.date) return false;
  const entryDate = localDateFromStamp(today.date);
  if (!entryDate) return false;
  // history[0] being newest does not mean it is *today*. Confirm before
  // claiming a first-encounter — otherwise the Inbox would fire "Met
  // today: X" for a part the user actually met N days ago.
  if (ymdISO(entryDate) !== ymdISO(now)) return false;
  const todayLps = Array.isArray(today?.letterParts) ? today.letterParts : [];
  if (!todayLps.some(p => p?.id === part.id)) return false;
  for (let i = 1; i < history.length; i++) {
    const lps = history[i]?.letterParts;
    if (Array.isArray(lps) && lps.some(p => p?.id === part.id)) return false;
  }
  return true;
}

// ── Unified entry point ───────────────────────────────────────────────
// Single read for any UI surface that needs the full picture of a part.
// Pass `thanks` explicitly when computing for many parts to avoid
// re-reading localStorage per call.

export function statsFor(history, part, thanks = null) {
  if (!part) return null;
  const t = thanks ?? loadThanks();
  // Compute the personal driver baseline once for this call rather than
  // letting each helper recompute it internally. dayOfWeekPeakFor accepts
  // it directly; the other walkers still pay their own cost (acceptable
  // at v1; revisit if profiling shows the 9-part batch is slow).
  const driverStats = personalDriverStats(history);
  const visits = partAppearanceDays(history, part);
  const thanksCount = thanksFor(part.id, t);
  const effective = visits + THANK_WEIGHT * thanksCount;
  return {
    visits,
    firstSeen: firstSeenForPart(history, part),
    lastSeen: lastSeenForPart(history, part),
    quietStreakDays: quietStreakDaysFor(history, part),
    frequencyRate: frequencyRateFor(history, part),
    thanks: thanksCount,
    effective,
    stage: stageFor(effective),
    familiarityFraction: familiarityFraction(effective),
    volumeDistribution: volumeDistributionFor(history, part),
    coOccurrences: coOccurrencesFor(history, part),
    dayOfWeekPeak: dayOfWeekPeakFor(history, part, driverStats),
    trendLabel: trendLabelFor(history, part),
    firstAppearanceToday: isFirstAppearanceToday(history, part),
  };
}

// ── Sort for All-Parts list ───────────────────────────────────────────
// "Thanking a part moves it to the back" — but only for a window, so
// the user can re-encounter parts they've sat with. Within tied groups,
// sort by effective familiarity DESC so well-met parts surface above
// strangers.

export function sortPartsForList(history, parts, thanks = null, now = new Date()) {
  if (!Array.isArray(parts)) return [];
  const t = thanks ?? loadThanks();
  const lastThanked = new Map();
  for (const evt of t) {
    if (!evt?.partId) continue;
    const cur = lastThanked.get(evt.partId);
    if (!cur || evt.dateISO > cur) lastThanked.set(evt.partId, evt.dateISO);
  }
  const windowMs = RECENT_THANK_WINDOW_DAYS * 86400000;
  const nowMs = now.getTime();
  function sinkScore(partId) {
    const ts = lastThanked.get(partId);
    if (!ts) return 0;
    const ms = new Date(ts).getTime();
    if (isNaN(ms) || ms > nowMs) return 0;
    const ageMs = nowMs - ms;
    if (ageMs > windowMs) return 0;
    return windowMs - ageMs;
  }
  return [...parts].sort((a, b) => {
    const sa = sinkScore(a.id);
    const sb = sinkScore(b.id);
    if (sa !== sb) return sa - sb;
    return effectiveFamiliarity(history, b, t) - effectiveFamiliarity(history, a, t);
  });
}
