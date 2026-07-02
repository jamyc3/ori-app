// Ori — shared date helpers (zero dependencies).
//
// ymd() was copy-pasted identically across several v2 surfaces (Inbox, Journal,
// PatternTiles, RingDetail, patternsData). One definition, imported everywhere.

// Local-aware YYYY-MM-DD (no UTC shift) — formats a Date in the user's own
// timezone, so "today" lines up with the calendar day they're living in.
export function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// The local calendar day an interaction BELONGS to — always the day it STARTED,
// never the moment it was submitted. This is the one rule for cross-midnight
// attribution: an entry begun 11:59 PM and saved 12:01 AM stays on the prior
// day, while a fresh entry begun 12:30 AM is the new day. `startedAt` may be a
// Date, a ms epoch, or an ISO string; null/garbage falls back to `now`
// (degrade-safe — same as the old submit-time behaviour, never throws).
export function entryDayFromStart(startedAt, now = new Date()) {
  if (startedAt == null) return ymd(now);
  const t = startedAt instanceof Date ? startedAt : new Date(startedAt);
  return isNaN(t.getTime()) ? ymd(now) : ymd(t);
}

// The canonical local day a check-in belongs to — used by the loadRepo date
// healer (migrateSeedDateDrift). Prefer the recorded sitting START; fall back to
// the submit time (uploadedAt) only for legacy entries written before start-time
// tracking. Mirrors exactly what saveTodayEntry stamps, so the heal is a no-op on
// correctly-dated entries and never drags a cross-midnight entry onto the next day.
export function canonicalCheckinDay({ startedAt, uploadedAt } = {}, now = new Date()) {
  return entryDayFromStart(startedAt != null ? startedAt : uploadedAt, now);
}

// A safe ISO stamp for a start time, stored alongside the entry (audit / future
// re-derivation). Falls back to now on null/garbage; never throws.
export function startIso(startedAt) {
  const t = startedAt == null ? new Date()
    : (startedAt instanceof Date ? startedAt : new Date(startedAt));
  return isNaN(t.getTime()) ? new Date().toISOString() : t.toISOString();
}
