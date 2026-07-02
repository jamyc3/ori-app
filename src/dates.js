/* ─────────────────────────────────────────────────────────────────
   Date helpers shared between empty-state, keeper, and any other
   surface that needs honest "what day is it?" logic.

   Why this file exists:
     `new Date("2026-04-27")` parses YYYY-MM-DD as UTC midnight, which
     in any negative-UTC zone (PST/EST/CST/MST) becomes the day BEFORE
     in local time. `.getDate()` then returns 26 instead of 27. This
     bug burned us once already — a journal entry the user wrote today
     was shown as "yesterday" in the empty state. These helpers compare
     YYYY-MM-DD strings directly when they see that format, never going
     through the Date constructor for a timezone-shifted answer.
   ────────────────────────────────────────────────────────────────── */

// Local YYYY-MM-DD from a Date object. Always uses local methods (never UTC).
export function ymdISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Floor-divide ms-difference between two Date-coercible inputs into local-day
// boundaries. setHours(0,0,0,0) on both endpoints so DST changes don't drift.
export function daysBetween(a, b) {
  const aD = new Date(a); aD.setHours(0, 0, 0, 0);
  const bD = new Date(b); bD.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((aD - bD) / 86400000));
}

// Stamp-to-day comparison. Handles BOTH formats Ori uses:
//   · Bare YYYY-MM-DD ("2026-04-27") — journal entry date field
//   · Full ISO with time ("2026-04-27T18:35:12.040Z") — check-ins, uploadedAt
// Returns false (never throws) for null/undefined/garbage input.
export function stampMatchesDay(stamp, dayKey) {
  if (!stamp || !dayKey) return false;
  if (typeof stamp === "string") {
    // Bare YYYY-MM-DD → string equality, timezone-safe.
    if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return stamp === dayKey;
    // ISO with time → parse and compare local.
    if (stamp.includes("T")) {
      const d = new Date(stamp);
      return !isNaN(d.getTime()) && ymdISO(d) === dayKey;
    }
  }
  const d = new Date(stamp);
  return !isNaN(d.getTime()) && ymdISO(d) === dayKey;
}

// True if a journal entry counts as activity on `dayKey`. Two paths:
//   · uploadedAt — when the user added it to the app (action timestamp)
//   · date / dateEnd — the user-asserted span of the entry (may be backfilled)
// "Activity today" means EITHER they added it today OR its asserted span
// covers today. Both are honest interpretations of "I wrote today."
export function journalEntryCoversDay(entry, dayKey) {
  if (!entry) return false;
  if (entry.uploadedAt && stampMatchesDay(entry.uploadedAt, dayKey)) return true;
  if (entry.date) {
    if (stampMatchesDay(entry.date, dayKey)) return true;
    if (entry.dateEnd && typeof entry.date === "string" && typeof entry.dateEnd === "string") {
      if (entry.date <= dayKey && entry.dateEnd >= dayKey) return true;
    }
  }
  return false;
}
