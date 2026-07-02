// Batch-analyze helpers — pure functions used by CPI's batch-runner hook
// to find which imported journal days still need a Claude reading, build
// the per-day seed text the analyzer expects, and compute the canonical
// timestamps for backfilled entries.
//
// No state lives here. The runner (in CPI.jsx) holds React state and calls
// analyzeWithClaude / computeHCPI / save once per day; this module just
// gives it the inputs.

// Free-tier cap. Imports above this count are still allowed; only the
// most-recent BATCH_FREE_LIMIT days get analyzed automatically. The
// remainder shows behind a "Premium" lock per the agreed product spec
// (subscription comes in a later phase).
export const BATCH_FREE_LIMIT = 30;

// How many Claude calls are in flight at once during the batch. Each
// call to analyzeWithClaude is independent for backfill purposes — the
// system prompt + the history snapshot the user already has on device
// is what the model needs to ground a reading. The recursive "day N
// sees day N-1's reading" link only matters for live readToday, not for
// recreating the past. Running 5 in parallel takes a 30-day batch from
// ~30 minutes (sequential, 60s/call) down to ~6 minutes, well within
// Anthropic's tier-2 OTPM ceiling at typical 1500-token output sizes.
export const BATCH_CONCURRENCY = 5;

function localYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Resolve a repo entry's calendar day to YYYY-MM-DD in the user's local
// timezone. Prefers `date` when it's already in that shape; falls back to
// `uploadedAt` (an ISO timestamp), which is what photo / paste / audio
// imports usually carry. Returns null if neither produces a real date.
function entryToYmd(e) {
  if (typeof e?.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(e.date)) {
    return e.date.slice(0, 10);
  }
  const ts = e?.uploadedAt || e?.date;
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return localYmd(d);
  }
  return null;
}

// All days in the journal repo that have writing but no saved Claude
// reading yet. Sorted ascending (oldest first) so the batch can run in
// the order that lets each day see the prior days' history as context.
// Today is excluded — the live Read-today flow owns that surface.
export function findUnanalyzedDays(repo) {
  const todayYmd = localYmd(new Date());
  const seen = new Set();
  const days = [];
  for (const e of (repo?.entries || [])) {
    if (e?.source === "reflection") continue; // reflections are visible-only, never drive a letter
    const ymd = entryToYmd(e);
    if (!ymd) continue;
    if (ymd === todayYmd) continue;
    if (seen.has(ymd)) continue;
    const text = String(e?.rawText || e?.transcription || "").trim();
    if (!text) continue;
    try {
      // localStorage shim returns null for unknown keys.
      if (localStorage.getItem(`cpi_letter_${ymd}`)) continue;
    } catch { /* treat as not analyzed */ }
    seen.add(ymd);
    days.push(ymd);
  }
  days.sort();
  return days;
}

// Compose the per-day seed bundle for a backfilled analysis — mirrors
// composeTodaySeeds in CPI.jsx but for a specific historical date.
// Returns the prefixed text Claude sees (with [H:MM AM] markers so the
// model can reason about the day's arc) and a plain version we store in
// the resulting check-in row.
export function composeSeedsForDay(repo, ymd) {
  const entries = (repo?.entries || []).filter(e => entryToYmd(e) === ymd && e?.source !== "reflection");
  // Coerce to a numeric epoch on BOTH sides — real captures store createdAt as a
  // number, but the Sim/imports store it as an ISO string, and `string - string`
  // is NaN, leaving the day's entries (and the [H:MM] arc the prompt reasons over)
  // in undefined order.
  const epochOf = (e) => typeof e?.createdAt === "number"
    ? e.createdAt
    : new Date(e?.createdAt || e?.uploadedAt || 0).getTime();
  entries.sort((a, b) => epochOf(a) - epochOf(b));
  const prefixed = [];
  const plain = [];
  for (const s of entries) {
    const ts = s.createdAt
      ? new Date(s.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : (typeof s.uploadedAt === "string" ? new Date(s.uploadedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null);
    const txt = String(s.text || s.transcription || s.rawText || "").trim();
    if (!txt) continue;
    prefixed.push(ts ? `[${ts}] ${txt}` : txt);
    plain.push(txt);
  }
  return {
    text: prefixed.join("\n\n"),
    plain: plain.join("\n\n"),
    seedCount: prefixed.length,
  };
}

// Canonical timestamp for a backfilled check-in row. We don't actually
// know when the user wrote on that day, so we pin to 8pm local — that
// drops the row into the "evening" period everywhere it's used and keeps
// the timestamp stable across reloads (no Date.now drift between runs).
export function backfillEntryTimestamp(ymd) {
  // Local 8pm as a TZ-less ISO string — NOT `.toISOString()`, which converts to
  // UTC and rolls west-of-UTC users into the NEXT calendar day, so the backfilled
  // row mis-files one day forward of its letter. A TZ-less string round-trips
  // through new Date() as local (same fix as letterEngine's localStamp).
  return `${ymd}T20:00:00`;
}

// Pick the most-recent N days to honor the free-tier cap. We take the
// tail of the sorted list (sorted ascending) so the user gets readings
// for their most-recent writing first — that's what they're most likely
// to want to read, and it gives Patterns immediately-useful context.
// Returns the slice, still in ascending order so the batch runs
// oldest → newest inside the cap.
export function selectFreeWindow(allUnanalyzed, limit = BATCH_FREE_LIMIT) {
  if (!Array.isArray(allUnanalyzed) || allUnanalyzed.length === 0) return [];
  return allUnanalyzed.slice(-limit);
}
