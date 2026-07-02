// Pure helpers shared by TodaysReadingCard, WeeklyReadingCard, and
// Patterns. Extracted so node tests can exercise the state machines
// without rendering React. No localStorage / DOM access here.

import { ymdISO } from "./dates.js";

// Sunday-anchored ISO week key: returns YMD of the Sunday at or before
// the given date. So all 7 days of a week share the same key.
export function isoWeekKey(d = new Date()) {
  const day = new Date(d);
  const dow = day.getDay();
  day.setDate(day.getDate() - dow);
  return ymdISO(day);
}

// Has the day's reflect time elapsed for the supplied "now"? `reflectTime`
// is "HH:MM" (24h). Returns false on malformed input — the auto-scheduler
// must fail closed. Strict shape check is load-bearing: a string like
// ":30" parses to (NaN→0, 30) under naive Number coercion and would
// trigger a false "past reflect time" every day after 12:30am.
export function pastReflectTime(reflectTime, now = new Date()) {
  if (!reflectTime) return false;
  const s = String(reflectTime);
  if (!/^\d{1,2}:\d{1,2}$/.test(s)) return false;
  const [h, m] = s.split(":").map(Number);
  if (!Number.isFinite(h) || h < 0 || h > 23) return false;
  if (!Number.isFinite(m) || m < 0 || m > 59) return false;
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  return now.getTime() >= target.getTime();
}

// Daily card state machine. Inputs are pre-computed booleans/numbers;
// the function makes the picking deterministic and testable.
//   { hasTodayReading, seedsToday, pastWinding, generating } -> state
export function pickDailyState({ hasTodayReading, seedsToday, pastWinding, generating }) {
  if (generating) return "generating";
  if (hasTodayReading) return "ready";
  if (!seedsToday || seedsToday <= 0) return "quiet";
  if (pastWinding) return "imminent";
  return "anticipating";
}

// Weekly card state machine. Returns null on non-Sundays so the card
// itself can early-return.
//   { isSunday, hasWeekly, seedsThisWeek, pastWinding, generating } -> state | null
export function pickWeeklyState({ isSunday, hasWeekly, seedsThisWeek, pastWinding, generating }) {
  if (!isSunday) return null;
  if (generating) return "generating";
  if (hasWeekly) return "ready";
  if (!seedsThisWeek || seedsThisWeek <= 0) return "quiet";
  if (pastWinding) return "imminent";
  return "anticipating";
}

// Build the 28-day almanac cell array. Caller passes a `lookupLetter`
// fn that maps a YMD string to a boolean (or letter content) — this
// keeps the function pure and testable. No localStorage here.
//   build28Days(history, refDate, lookupLetter) -> Array<DayCell>
export function build28Days(history = [], refDate = new Date(), lookupLetter = () => false) {
  const out = [];
  const today = new Date(refDate);
  for (let i = 0; i < 28; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const ymd = ymdISO(d);
    const entry = (history || []).find(e => stampMatchesYMD(e?.date, ymd));
    const parts = (Array.isArray(entry?.letterParts) ? entry.letterParts : [])
      .map(p => p?.id)
      .filter(Boolean);
    out.push({
      ymd,
      dom: d.getDate(),
      dow: d.getDay(),
      parts,
      hasLetter: !!lookupLetter(ymd),
      isToday: i === 0,
      entry,
    });
  }
  return out;
}

// Local helper — same behaviour as dates.js stampMatchesDay but inlined
// here so cardStates.js doesn't pull in the date helpers' internals.
function stampMatchesYMD(stamp, ymd) {
  if (!stamp || !ymd) return false;
  if (typeof stamp === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stamp)) return stamp === ymd;
  try {
    const d = new Date(stamp);
    if (Number.isNaN(d.getTime())) return false;
    const sy = d.getFullYear();
    const sm = String(d.getMonth() + 1).padStart(2, "0");
    const sd = String(d.getDate()).padStart(2, "0");
    return `${sy}-${sm}-${sd}` === ymd;
  } catch { return false; }
}
