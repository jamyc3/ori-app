// Ori v2 — Inbox behavioral alerts (the Wilson-CI trigger layer).
//
// The design deferred alerts like "Form is lifting" until they could be
// L3-honest: an alert is a claim that something REPEATED across the
// user's own days, so it only fires when the binomial math agrees. Same
// statistical gate as the v1 patterns drawer (Wilson 95% score interval,
// Brown et al.): a share-of-days claim fires only when the interval's
// Wilson 95% lower bound clears the line, never on the point estimate alone.
// (That methodology stays in here — the user-facing `source` copy says it plainly.)
//
//   · Part settled in   — a part appeared on enough of the last 28
//     writing days that the CI lower bound ≥ 0.70 (the drawer's own
//     "stable" line; needs ≥14 writing days for the CI to be that tight).
//   · Form lifting      — of the last 7 logged WHO-5 check-ins, the
//     share at-or-above the user's trailing median has CI lower > 0.50:
//     "more often than not, and the math agrees it isn't chance." (The
//     0.70 line is unreachable at n=7 — even 7/7 bounds at 0.646 — so a
//     majority line is the strongest claim a week of check-ins supports.)
//   · Form softening    — same share's CI upper < 0.50, mirrored.
//
// Pure core (computeAlerts) takes plain data so the eval suite runs it
// under Node; the storage shell (currentInboxAlerts) reads the same keys
// the rest of v2 uses and dedupes via cpi_v2_alerts_seen so an alert
// fires once per episode, not every time the Inbox opens.

const STABLE_LINE = 0.70;
const MAJORITY_LINE = 0.50;
const WINDOW_WRITING_DAYS = 28;
const MIN_WRITING_DAYS = 14;   // below this, CIs are wider than the lines
const WHO5_RECENT = 7;
const WHO5_BASELINE_DAYS = 30;
const SEEN_KEY = 'cpi_v2_alerts_seen';
const RESURFACE_MS = 14 * 24 * 60 * 60 * 1000;

// A part "recurs across your days" by the SAME gate the patterns drawer and the
// part-stable alert use: the Wilson 95% lower bound must clear the stable line,
// and there must be enough writing days for that CI to be that tight. Exported
// so PartDetail's on-part tending line rests on the identical math (one source).
export function partClearsRecurrence(days, writingDays) {
  if (!(writingDays >= MIN_WRITING_DAYS)) return false;
  return wilsonCI(days, writingDays)[0] >= STABLE_LINE;
}

export function wilsonCI(k, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const phat = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const halfW = (z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - halfW), Math.min(1, center + halfW)];
}

function median(xs) {
  const ys = xs.filter((v) => typeof v === 'number' && !isNaN(v)).slice().sort((a, b) => a - b);
  if (!ys.length) return null;
  const mid = Math.floor(ys.length / 2);
  return ys.length % 2 === 0 ? (ys[mid - 1] + ys[mid]) / 2 : ys[mid];
}

// Pure: compute alerts from plain inputs.
//   partDays:    { [partId]: number }  — days the part appeared, within window
//   writingDays: number                — unique writing days in window
//   who5:        number[]              — logged scores, oldest → newest
//   screenHigh:  boolean               — today's evening phone use crossed 2.5h
//   today:       'YYYY-MM-DD'          — local day key, makes the screen alert
//                                        fire at most once per day (date-scoped id)
export function computeAlerts({ partDays = {}, writingDays = 0, who5 = [], screenHigh = false, today = null, ackedPartIds = null } = {}) {
  const alerts = [];

  // A single observed fact, not a share-of-days claim: the evening crossed the
  // 2.5-hour line on the apps the user chose to watch. No CI gate (it's one
  // measured threshold crossing, not a recurrence). Date-scoped id + the Inbox's
  // mark-seen-on-open keeps it to one appearance for the day. Gentle, never
  // shaming (engagement = a mirror, not a nag).
  if (screenHigh && today) {
    alerts.push({
      id: `screen-high:${today}`,
      kind: 'screen-high',
      title: 'A long evening on your phone',
      body: 'Over 2½ hours this evening on the apps you’re watching — just noticing it with you, no pressure.',
      source: 'from Screen Time on this device · your own evening, nothing leaves your phone',
    });
  }

  if (writingDays >= MIN_WRITING_DAYS) {
    // When the caller tells us which parts have been reflected on (real usage
    // always does), a part that clears the recurrence gate but has NEVER been
    // sat with becomes a gentle TENDING invitation — same statistical gate as
    // part-stable, plus the local fact of zero validated reflections. Without
    // ack info (offline eval / legacy callers), behave exactly as before:
    // part-stable fires on recurrence alone. Mutually exclusive per part, so a
    // recurring part raises one card, not two.
    const ackProvided = Array.isArray(ackedPartIds);
    const acked = ackProvided ? new Set(ackedPartIds.map(String)) : null;
    for (const [partId, days] of Object.entries(partDays)) {
      if (!partClearsRecurrence(days, writingDays)) continue;
      if (ackProvided && !acked.has(partId)) {
        alerts.push({
          id: `part-untended:${partId}`,
          kind: 'part-untended',
          partId,
          title: null, // rendered with the part's display name + tap → Reflect
          body: `Showing up on ${days} of your last ${writingDays} writing days — and you haven't sat with it yet. A moment with it, when you're ready?`,
          source: `seen across ${writingDays} of your writing days · an invitation, never a read on how you're doing`,
        });
      } else {
        alerts.push({
          id: `part-stable:${partId}`,
          kind: 'part-stable',
          partId,
          title: null, // rendered with the part's display name
          body: `On ${days} of your last ${writingDays} writing days — steadily enough that the math agrees it's not coincidence.`,
          source: `seen across ${writingDays} of your writing days — steady enough to read as real, not chance`,
        });
      }
    }
  }

  if (who5.length >= WHO5_RECENT + 3) {
    const recent = who5.slice(-WHO5_RECENT);
    const baseline = median(who5.slice(-WHO5_BASELINE_DAYS, -WHO5_RECENT));
    if (baseline != null) {
      // Ties count toward neither direction — a week sitting exactly on
      // the median is "holding steady", not lifting or softening, so each
      // claim gets its own strict count and its own lower bound.
      const above = recent.filter((v) => v > baseline).length;
      const below = recent.filter((v) => v < baseline).length;
      const [loAbove] = wilsonCI(above, recent.length);
      const [loBelow] = wilsonCI(below, recent.length);
      if (loAbove > MAJORITY_LINE) {
        alerts.push({
          id: 'form-lifting',
          kind: 'form-lifting',
          title: 'Form has been lifting',
          body: `${above} of your last ${recent.length} check-ins sat above your usual.`,
          source: `your check-ins against your own usual — clearly more often than not`,
        });
      } else if (loBelow > MAJORITY_LINE) {
        alerts.push({
          id: 'form-softening',
          kind: 'form-softening',
          title: 'Form has been softening',
          body: `${below} of your last ${recent.length} check-ins sat below your usual — worth being gentle with the week.`,
          source: `your check-ins against your own usual — clearly more often than not`,
        });
      }
    }
  }

  return alerts;
}

// ── Storage shell ────────────────────────────────────────────────

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem('cpi-v2-data') || 'null');
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.history)) return parsed.history;
    return [];
  } catch {
    return [];
  }
}

// Part ids with at least one VALIDATED acknowledgment (a reflection the person
// actually sat with), read straight from the part-history store so this module
// stays import-free and the offline eval keeps running under Node. A tap alone
// (validated !== true) does NOT count as having sat with the part.
function loadAckedPartIds() {
  try {
    const raw = JSON.parse(localStorage.getItem('cpi_part_thanks') || '[]');
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.filter((e) => e?.validated === true && e?.partId).map((e) => String(e.partId)))];
  } catch {
    return [];
  }
}

function loadSeen() {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

// Inputs from the same stores every other v2 surface reads: part-days
// over the most-recent 28 unique writing days (sliding through actual
// writing, mirroring the v1 drawer), WHO-5 scores oldest→newest.
function gatherInputs(who5History) {
  // Day bucketing matches the siblings (demandsData.js, Day.jsx): prefer
  // the entry's own ISO date prefix, else the LOCAL ymd of the parsed
  // timestamp — never toISOString, which flips evening entries onto the
  // next UTC day (the exact hours Ori is used).
  const dayKeyOf = (h) => {
    if (typeof h?.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(h.date)) {
      return h.date.slice(0, 10);
    }
    const d = h?.date ? new Date(h.date) : null;
    if (!d || isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const entriesByDay = new Map();
  for (const h of loadHistory()) {
    const dayKey = dayKeyOf(h);
    if (!dayKey) continue;
    if (!entriesByDay.has(dayKey)) entriesByDay.set(dayKey, []);
    entriesByDay.get(dayKey).push(h);
  }
  const windowDays = [...entriesByDay.keys()].sort().reverse().slice(0, WINDOW_WRITING_DAYS);
  const partDays = {};
  for (const dayKey of windowDays) {
    const seenToday = new Set();
    for (const h of entriesByDay.get(dayKey) || []) {
      for (const p of (h?.letterParts || [])) {
        if (p?.id && !seenToday.has(p.id)) {
          seenToday.add(p.id);
          partDays[p.id] = (partDays[p.id] || 0) + 1;
        }
      }
    }
  }
  return { partDays, writingDays: windowDays.length, who5: normalizeWho5(who5History) };
}

// who5.js `loadWho5History()` returns a MAP keyed by date
// ({ 'YYYY-MM-DD': { score, ts } }); some callers pass an array of
// { score, when }. Accept either and return scores oldest→newest. (Without
// this, gatherInputs called .filter on the map object and threw — which the
// caller's try/catch silently swallowed, zeroing EVERY inbox alert.)
export function normalizeWho5(who5History) {
  if (Array.isArray(who5History)) {
    return who5History
      .filter((e) => e && typeof e.score === 'number' && e.when)
      .sort((a, b) => new Date(a.when) - new Date(b.when))
      .map((e) => e.score);
  }
  if (who5History && typeof who5History === 'object') {
    return Object.entries(who5History)
      .filter(([, v]) => v && typeof v.score === 'number')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) // by date key, oldest→newest
      .map(([, v]) => v.score);
  }
  return [];
}

// Alerts that should show in the Inbox right now: computed, then deduped
// against the seen map so each fires once per RESURFACE window.
//
// The Screen Time flag is passed IN by the caller (Inbox.jsx) rather than read
// here, so this module stays free of the @capacitor/core import and the eval
// suite can keep running it under Node.
export function currentInboxAlerts(who5History, { screenHigh = false, today = null } = {}) {
  const alerts = computeAlerts({ ...gatherInputs(who5History), ackedPartIds: loadAckedPartIds(), screenHigh, today });
  const seen = loadSeen();
  const now = Date.now();
  return alerts.filter((a) => {
    const at = seen[a.id] ? new Date(seen[a.id]).getTime() : 0;
    return !(at && now - at < RESURFACE_MS);
  });
}

// Parts that clear the recurrence gate but have never been reflected on — the
// set behind both the Inbox tending nudge and PartDetail's on-part line. Same
// math (partClearsRecurrence) and same ack source as currentInboxAlerts, so the
// two surfaces can never disagree about whether a part "keeps showing up".
export function untendedPartIds() {
  const { partDays, writingDays } = gatherInputs();
  const acked = new Set(loadAckedPartIds());
  const out = [];
  for (const [partId, days] of Object.entries(partDays)) {
    if (partClearsRecurrence(days, writingDays) && !acked.has(partId)) out.push(partId);
  }
  return out;
}

export function markAlertsSeen(ids) {
  if (!ids?.length) return;
  const seen = loadSeen();
  const iso = new Date().toISOString();
  for (const id of ids) seen[id] = iso;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* quota */ }
}
