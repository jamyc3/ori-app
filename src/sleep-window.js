/* ─────────────────────────────────────────────────────────────────
   sleep-window — storage and helpers for a user's self-reported
   sleep window (bedtime + wake time). Drives chronotype detection
   when device data (Oura, Apple Health) isn't available, and is the
   silent floor under the hybrid stack:

     1. Oura bedtimeStart/End for ≥7 nights → use device per-night
     2. Apple Health Sleep Analysis (future) → same
     3. Self-reported window from this module → constant midpoint
     4. Nothing → leave chronotype null

   Times are stored as minutes since local 00:00:
     1380 = 11:00 PM, 420 = 7:00 AM
   This avoids the parsing fragility of "23:00" string formats and
   makes midpoint math just (bed + duration / 2) % 1440.

   Storage shape:
     {
       bedtimeMin: 1380,   // 11pm
       wakeMin: 420,       // 7am
       updatedAt: "2026-05-12T22:55:00.000Z"
     }
   ──────────────────────────────────────────────────────────────── */

export const SLEEP_WINDOW_KEY = "ori_sleep_window";

// Dismissal timestamp for the in-app "tell us your sleep window" nudge.
// Stored as an ISO string. While within SLEEP_NUDGE_COOLDOWN_DAYS of that
// timestamp the nudge stays hidden; after that it can re-surface if the
// user still hasn't set a window and still has no device data.
export const SLEEP_NUDGE_DISMISSED_KEY = "ori_sleep_nudge_dismissed_at";
export const SLEEP_NUDGE_COOLDOWN_DAYS = 30;
export const SLEEP_NUDGE_MIN_WRITING_DAYS = 14;

/**
 * Parse a "HH:MM" string into minutes since 00:00. Returns null on
 * anything malformed. Used by the time pickers in WelcomeGarden and
 * Settings, which both produce HTML <input type="time"> values.
 */
export function parseTimeToMinutes(timeStr) {
  if (typeof timeStr !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(timeStr);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (isNaN(h) || isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Inverse of parseTimeToMinutes — produces "HH:MM" for <input type="time">. */
export function minutesToTime(min) {
  if (typeof min !== "number" || isNaN(min)) return "";
  const h = Math.floor(min / 60) % 24;
  const m = Math.floor(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Load the user's self-reported sleep window from localStorage.
 * Returns { bedtimeMin, wakeMin, midpointMin, durationMin } or null.
 *
 * Midpoint math handles the across-midnight case: when wake < bed
 * numerically (e.g. bed=23:00, wake=07:00), sleep crosses midnight and
 * duration = (1440 - bed) + wake. Otherwise duration = wake - bed.
 * Midpoint = (bed + duration / 2) mod 1440 — for a typical 11pm→7am
 * window that puts midpoint at 3:00 AM (180 min before sunrise).
 */
export function loadSelfReportedSleepWindow() {
  try {
    const raw = localStorage.getItem(SLEEP_WINDOW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const bed = typeof parsed?.bedtimeMin === "number" ? parsed.bedtimeMin : null;
    const wake = typeof parsed?.wakeMin === "number" ? parsed.wakeMin : null;
    if (bed == null || wake == null) return null;
    return computeWindowDerived(bed, wake);
  } catch {
    return null;
  }
}

/**
 * Pure helper — given raw bedtime/wake minutes, compute the derived
 * shape (duration + midpoint). Exposed so callers (onboarding,
 * settings) can preview the derived values without round-tripping
 * through localStorage.
 */
export function computeWindowDerived(bedtimeMin, wakeMin) {
  const duration = wakeMin > bedtimeMin ? wakeMin - bedtimeMin : (1440 - bedtimeMin) + wakeMin;
  const midpointMin = (bedtimeMin + duration / 2) % 1440;
  return { bedtimeMin, wakeMin, midpointMin, durationMin: duration };
}

/** Persist the window to localStorage. Pass null to clear. */
export function saveSelfReportedSleepWindow(bedtimeMin, wakeMin) {
  try {
    if (bedtimeMin == null || wakeMin == null) {
      localStorage.removeItem(SLEEP_WINDOW_KEY);
      return;
    }
    localStorage.setItem(SLEEP_WINDOW_KEY, JSON.stringify({
      bedtimeMin,
      wakeMin,
      updatedAt: new Date().toISOString(),
    }));
  } catch {
    /* ignore */
  }
}

/**
 * Decide whether to surface the in-app "tell us your sleep window" nudge.
 * Pure: takes the same inputs Patterns.jsx already has on hand.
 *
 * Show only when ALL of these hold:
 *   1. User has no self-reported sleep window already.
 *   2. User has fewer than 7 nights of Oura bedtime data in the recent
 *      window (≥7 nights is the threshold derivedChronotype uses to
 *      consider device data sufficient on its own).
 *   3. User has written for ≥14 days (so the nudge is grounded in actual
 *      use — we're not pushing onboarding extras on a new user).
 *   4. Nudge wasn't dismissed within the last cooldown window.
 */
export function shouldShowSleepNudge(history, ouraMap, now = Date.now()) {
  if (loadSelfReportedSleepWindow()) return false;

  let ouraNights = 0;
  if (ouraMap && typeof ouraMap === "object") {
    const cutoff = now - 30 * 86400000;
    for (const ymd of Object.keys(ouraMap)) {
      const e = ouraMap[ymd];
      if (!e?.bedtimeStart || !e?.bedtimeEnd) continue;
      const t = new Date(e.bedtimeStart).getTime();
      if (isNaN(t) || t < cutoff) continue;
      ouraNights++;
    }
  }
  if (ouraNights >= 7) return false;

  const writingDays = new Set();
  for (const e of history || []) {
    const v = e?.date;
    if (!v) continue;
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      writingDays.add(v.slice(0, 10));
      continue;
    }
    const d = new Date(v);
    if (!isNaN(d.getTime())) {
      writingDays.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
  }
  if (writingDays.size < SLEEP_NUDGE_MIN_WRITING_DAYS) return false;

  try {
    const raw = localStorage.getItem(SLEEP_NUDGE_DISMISSED_KEY);
    if (raw) {
      const dismissedAt = new Date(raw).getTime();
      if (!isNaN(dismissedAt) && now - dismissedAt < SLEEP_NUDGE_COOLDOWN_DAYS * 86400000) {
        return false;
      }
    }
  } catch { /* ignore */ }

  return true;
}

/** Mark the nudge as dismissed — starts a fresh cooldown. */
export function dismissSleepNudge() {
  try {
    localStorage.setItem(SLEEP_NUDGE_DISMISSED_KEY, new Date().toISOString());
  } catch { /* ignore */ }
}
