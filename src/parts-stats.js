/* ─────────────────────────────────────────────────────────────────
   parts-stats — pure helpers for cross-day part attendance and the
   Garden Keeper companion gate. Used by GardenKeeper.jsx (the roster
   render) and Patterns.jsx (the "plants in your garden" pill) — both
   surfaces MUST call into this module so their counts stay in lockstep.

   No React. No JSX. No PARTS_LIB import. Caller passes the parts-library
   object (or any iterable of part defs) when they need it. This keeps
   the module testable from a plain node script.

   ━━━ INVARIANT — history is newest-first ━━━
   `history` is the array stored on the React side, populated via
   `[entry, ...history]` in CPI.jsx. Index 0 is the most recent entry,
   index N-1 is the oldest.

   `lastSeenForPart` walks forward and returns the FIRST match — that
   only equals "last seen in real time" because of this ordering.
   `firstSeenForPart` walks backward for the same reason.

   If you ever change storage to chronological order, every Keeper date
   silently inverts. Don't. If you must, swap the iteration directions
   in the two helpers below.
   ───────────────────────────────────────────────────────────────── */

// Local YYYY-MM-DD key from a Date — shared so every distinct-day Set in
// this module uses identical keys. Zero-padded, local-time (never UTC) to
// avoid the "yesterday in PST" timezone bug documented in dates.js.
import { ymdISO } from "./dates.js";

// Companion threshold for Keeper persistence (Phase #3, scientist-grade fix).
// Companions need ≥N appearances within a rolling window before entering
// persistent Keeper claims. Single-letter companions still surface in their
// day's letter prose; this gate governs cross-day claims only.
export const COMPANION_MIN_APPEARANCES = 2;
export const COMPANION_WINDOW_DAYS = 30;

// Personal-baseline z-score gate (Phase #8, scientist-grade fix).
// The legacy ≥1.0 absolute floor is one-size-fits-all — high-intensity writers
// hit it constantly, low-intensity writers rarely. Z-score normalizes against
// the user's own 30-day distribution: a driver score qualifies only if it sits
// ≥1 SD above THEIR personal mean. Cold-start (< MIN_SAMPLES) falls back to
// the absolute floor so the gate stays honest for new users.
//
//   ZSCORE_WINDOW_DAYS  — rolling window for personal baseline
//   ZSCORE_MIN_SAMPLES  — below this, fall back to absolute floor
//   ZSCORE_THRESHOLD    — minimum SDs above personal mean to qualify
//   ZSCORE_MIN_SD       — below this, distribution is too tight to z-score
//                         (e.g., user almost never fires this driver) — fall
//                         back so we don't fire on tiny noise spikes
export const ZSCORE_WINDOW_DAYS = 30;
export const ZSCORE_MIN_SAMPLES = 14;
export const ZSCORE_THRESHOLD = 1.0;
export const ZSCORE_MIN_SD = 0.3;

/**
 * Per-driver personal baseline stats (mean, sd, n) over the rolling
 * ZSCORE_WINDOW_DAYS window. Used by `entryHasPart` to gate driver-derived
 * inclusions against the user's own distribution rather than a fixed floor.
 *
 * Returns `{ identity: {mean, sd, n}, social: {...}, ... }`. Drivers absent
 * from history simply don't appear in the result — callers should treat
 * "missing key" as "no baseline yet, fall back to absolute floor".
 *
 * Includes zero-scored days in the sample. A driver that's almost never
 * fired SHOULD have a low mean — a sudden spike is then a real signal.
 */
export function personalDriverStats(history, withinDays = ZSCORE_WINDOW_DAYS) {
  if (!Array.isArray(history)) return {};
  const cutoff = Date.now() - withinDays * 86400000;
  const buckets = {};
  for (const e of history) {
    const t = new Date(e?.date).getTime();
    if (isNaN(t) || t < cutoff) continue;
    const drivers = e?.drivers || {};
    for (const [k, v] of Object.entries(drivers)) {
      if (typeof v !== "number") continue;
      if (!buckets[k]) buckets[k] = [];
      buckets[k].push(v);
    }
  }
  const stats = {};
  for (const [key, values] of Object.entries(buckets)) {
    const n = values.length;
    if (n === 0) continue;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const sd = Math.sqrt(variance);
    stats[key] = { mean, sd, n };
  }
  return stats;
}

/**
 * True if `part` was attached to this entry's letterParts, OR if a
 * driver-derived inclusion threshold fires.
 *
 * Driver path requires (ALL must hold):
 *   • driver score ≥ 1.0 (absolute floor — anything lower is keyword trace)
 *   • driver score / day's max ≥ 0.33 (relative threshold — only "present"
 *     or "loud" tier in the volumeFor() bucket math)
 *   • IF `stats` is provided AND we have a usable baseline for this driver
 *     (n ≥ ZSCORE_MIN_SAMPLES AND sd ≥ ZSCORE_MIN_SD): the score sits
 *     ≥ ZSCORE_THRESHOLD SDs above the user's personal mean.
 *
 * Without stats (or below sample/variance thresholds), the legacy absolute
 * + relative floor governs alone. This means the gate behaves identically
 * for new users and only tightens once a personal baseline exists.
 */
export function entryHasPart(entry, part, stats = null) {
  const lps = entry?.letterParts;
  if (Array.isArray(lps) && lps.some(p => p?.id === part.id)) return true;
  if (part?.driverKey) {
    const drivers = entry?.drivers || {};
    const score = drivers[part.driverKey] || 0;
    if (score < 1.0) return false;
    const maxScore = Math.max(0, ...Object.values(drivers).filter(v => typeof v === "number"));
    if (maxScore <= 0) return false;
    if (score / maxScore < 0.33) return false;

    // Personal-baseline check — only applied when we have a trustworthy
    // distribution to compare against. Otherwise the absolute + relative
    // checks above already passed, so we're good.
    const personal = stats?.[part.driverKey];
    if (personal && personal.n >= ZSCORE_MIN_SAMPLES && personal.sd >= ZSCORE_MIN_SD) {
      const z = (score - personal.mean) / personal.sd;
      return z >= ZSCORE_THRESHOLD;
    }
    return true;
  }
  return false;
}

/** True if any part visited on this entry (Claude-curated or driver-derived). */
export function entryHasAnyPart(entry) {
  if (Array.isArray(entry?.letterParts) && entry.letterParts.length > 0) return true;
  if (entry?.drivers && Object.values(entry.drivers).some(v => v > 0)) return true;
  return false;
}

/** Calendar-day distance from `iso` to today, ignoring time-of-day. */
export function daysSinceISO(iso) {
  if (!iso) return null;
  const then = new Date(iso);
  if (isNaN(then.getTime())) return null;
  const now = new Date();
  const ms = now.setHours(0, 0, 0, 0) - new Date(then).setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor(ms / 86400000));
}

/**
 * Most-recent appearance of `part`. Returns `{ date, daysAgo }` or `null`.
 * REQUIRES history newest-first. See module-level invariant.
 *
 * Computes personal-baseline stats once and threads them into every
 * `entryHasPart` call so the z-score gate stays consistent across the walk.
 */
export function lastSeenForPart(history, part) {
  if (!part || !Array.isArray(history)) return null;
  const stats = personalDriverStats(history);
  for (const entry of history) {
    if (entryHasPart(entry, part, stats)) {
      const days = daysSinceISO(entry.date);
      if (days != null) return { date: entry.date, daysAgo: days };
    }
  }
  return null;
}

/**
 * First (oldest) appearance of `part`. Walks history backward.
 * REQUIRES history newest-first. See module-level invariant.
 */
export function firstSeenForPart(history, part) {
  if (!part || !Array.isArray(history)) return null;
  const stats = personalDriverStats(history);
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entryHasPart(entry, part, stats)) {
      const days = daysSinceISO(entry.date);
      if (days != null) return { date: entry.date, daysAgo: days };
    }
  }
  return null;
}

/** Distinct calendar days where any part visited. Drives the 7-day calibration gate. */
export function daysWithPartsCount(history) {
  if (!Array.isArray(history)) return 0;
  const days = new Set();
  for (const e of history) {
    if (!entryHasAnyPart(e)) continue;
    const d = new Date(e?.date);
    if (!isNaN(d.getTime())) days.add(ymdISO(d));
  }
  return days.size;
}

/**
 * Distinct days a specific `part` appeared on. Pass `withinDays` to limit to
 * a rolling window (e.g. 30 for the companion gate).
 *
 * Personal-baseline stats are computed against the FULL history (z-score
 * window is independent of the appearance-counting window) so a 30-day
 * appearance count and a 30-day baseline aren't accidentally coupled.
 */
export function partAppearanceDays(history, part, withinDays = null) {
  if (!part || !Array.isArray(history)) return 0;
  const stats = personalDriverStats(history);
  const cutoff = withinDays != null ? Date.now() - withinDays * 86400000 : 0;
  const days = new Set();
  for (const e of history) {
    if (!entryHasPart(e, part, stats)) continue;
    const t = new Date(e?.date).getTime();
    if (isNaN(t)) continue;
    if (cutoff && t < cutoff) continue;
    const d = new Date(e.date);
    days.add(ymdISO(d));
  }
  return days.size;
}

/** Total distinct letter-bearing days. Denominator for the frequency display. */
export function totalLetterDays(history) {
  if (!Array.isArray(history)) return 0;
  const days = new Set();
  for (const e of history) {
    const t = new Date(e?.date).getTime();
    if (isNaN(t)) continue;
    const d = new Date(e.date);
    days.add(ymdISO(d));
  }
  return days.size;
}

/**
 * Companion gate: companions need ≥COMPANION_MIN_APPEARANCES distinct days
 * within COMPANION_WINDOW_DAYS. Protectors always qualify — they're
 * driver-grounded and thresholded inside `entryHasPart`.
 */
export function companionQualifies(history, part) {
  if (part?.kind !== "companion") return true;
  return partAppearanceDays(history, part, COMPANION_WINDOW_DAYS) >= COMPANION_MIN_APPEARANCES;
}

// User-in-the-loop confirmation cooldown (Phase #6, scientist-grade fix).
// When a user dismisses a companion ("not yet"), we hide it from the Keeper
// roster for this many days before asking again. Confirmation has no
// expiry — it stands until the user actively rethinks.
export const CONFIRMATION_COOLDOWN_DAYS = 30;

/**
 * Whether a dismissal is still "active" (within cooldown). Pure function —
 * caller passes the confirmation record directly. Returns false if record
 * is missing, malformed, or its cooldown has expired.
 */
function isDismissalActive(confirmation, now = Date.now()) {
  if (confirmation?.state !== "dismissed") return false;
  const expiresAt = new Date(confirmation.askAgainAfter || 0).getTime();
  if (isNaN(expiresAt)) return false;
  return now < expiresAt;
}

/**
 * Single source of truth for "should this companion appear in the Keeper?"
 * Layers user-in-the-loop confirmation OVER the algorithmic gate:
 *
 *   • confirmed         → always in Keeper (user truth wins)
 *   • dismissed-active  → hidden, even if gate would pass (user truth wins)
 *   • no answer         → algorithmic gate decides
 *
 * Protectors are unaffected — companionQualifies returns true for them, and
 * confirmations don't gate them anyway. Returns boolean for direct render
 * gating; use `companionConfirmationStatus` if you need the state label.
 */
export function companionInKeeper(history, part, confirmation = null) {
  if (part?.kind === "companion") {
    if (confirmation?.state === "confirmed") return true;
    if (isDismissalActive(confirmation)) return false;
  }
  return companionQualifies(history, part);
}

/**
 * Returns the state label for UX rendering decisions:
 *   "confirmed" — show confirmed-tag, no question
 *   "dismissed" — companion is hidden (caller probably won't render at all)
 *   "qualified" — gate passed, no answer yet → SHOW question
 *   "filtered"  — gate failed, no answer → not in Keeper anyway
 *
 * Pure. Caller resolves the confirmation record from storage.
 */
export function companionConfirmationStatus(history, part, confirmation = null) {
  if (part?.kind !== "companion") return "qualified";
  if (confirmation?.state === "confirmed") return "confirmed";
  if (isDismissalActive(confirmation)) return "dismissed";
  return companionQualifies(history, part) ? "qualified" : "filtered";
}

/**
 * Render-class for a part — derived purely from `kind` metadata so every
 * surface (Keeper roster, day-inspector chip, letter postscript) classifies
 * identically. The visual contract:
 *   protector → filled glyph circle, moss "DRIVER-GROUNDED" tag
 *   companion → outlined glyph circle, bloom "LINGUISTIC" tag
 *   unknown   → faint outlined fallback (defensive — shouldn't occur in prod)
 *
 * Pure function. No history, no library lookups. Safe to call from any layer.
 */
export function partRenderClass(part) {
  if (part?.kind === "protector") return "protector";
  if (part?.kind === "companion") return "companion";
  return "unknown";
}

/**
 * Set of part IDs that qualify for Keeper persistence — passed the companion
 * gate (and any user-in-the-loop confirmation) AND have ever been seen.
 * Used by both GardenKeeper.jsx (roster) and Patterns.jsx (pill) so their
 * counts can never drift.
 *
 * `confirmations` is an optional `{ [partId]: { state, ... } }` record from
 * the user-confirmation store. When provided, confirmed companions stay in
 * the set even if the algorithmic gate hasn't been met yet, and dismissed
 * companions are excluded for their cooldown window.
 */
export function qualifiedPartIdsForKeeper(history, partsLib, confirmations = null) {
  const out = new Set();
  for (const part of Object.values(partsLib || {})) {
    const c = confirmations?.[part?.id] || null;
    if (!companionInKeeper(history, part, c)) continue;
    if (lastSeenForPart(history, part)) out.add(part.id);
  }
  return out;
}
