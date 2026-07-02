// Ori v2 — defer-to-window decisions.
//
// A decision is not a cost to be counted — it's something the day asks of you,
// and *when* you make a consequential one tends to matter more than how many you
// made. This module lets a user PARK a decision and resurface it inside their
// next "sharp window" (the chronotype-anchored peak band the engine already
// computes), rather than deciding it at the tail of a long day.
//
// Data discipline: records are APPEND-ONLY. Parking adds; revisiting/ deciding
// flips a status field and stamps a time — we never delete a decision, so the
// history of what you parked and how it landed survives to power personal
// calibration later. Storage is plain localStorage (the data is tiny), mirroring
// the cpi_checkin pattern.

// ── Honesty / clinical audit (INTERNAL — never shown to users) ───────────────
// Layer map + caveats for everything this feature derives. User-facing copy
// names none of this; the instrument and the timing model live here, behind.
//  · Window = INTERPRETATION (L4): a measured wearable wake time read through an unvalidated chronotype peak-window model — an estimate, never a measured time.
//  · "Defer to a sharper hour" is a reasonable extrapolation from circadian-cognition and sleep-loss research, not a tested intervention: timing helps on average, it is not a guarantee.
//  · Clarity check = VALIDATED SELF-REPORT (L2): the Karolinska Sleepiness Scale (Åkerstedt 1990), used as alertness, never a decision-quality score; a foggy reading is permission to wait, never a verdict on judgment.
//  · No clinical or medical claim is made anywhere in this feature.

const KEY = 'cpi_parked_decisions';

// Chronotype peak bands, in hours-since-wake — kept in lockstep with
// engine.js getPhaseAlignment()'s PEAK_BANDS. (Duplicated, not imported, so this
// stays a tiny dependency-light module; if the engine bands move, move these.)
const PEAK_BANDS = {
  morning:  { start: 2, end: 5 },
  flexible: { start: 3, end: 6 },
  evening:  { start: 5, end: 10 },
};

function loadMap() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveMap(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* best-effort */ }
  emit();
}

function emit() {
  try { window.dispatchEvent(new Event('cpi:parked-updated')); } catch { /* noop */ }
}

function makeId() {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// Most-recent wearable-derived wake time within the last ~28h, in ms — mirrors
// engine.js minutesSinceLastWake() but returns the wake instant, which we need
// to place the window on the wall clock. Null = no trustworthy wake time.
function lastWakeMs(historyMap) {
  if (!historyMap) return null;
  const now = Date.now();
  const dates = Object.keys(historyMap).sort().reverse().slice(0, 3);
  for (const d of dates) {
    const be = historyMap[d]?.bedtimeEnd;
    if (!be) continue;
    const wakeMs = new Date(be).getTime();
    const delta = now - wakeMs;
    if (delta < 0 || delta > 28 * 60 * 60 * 1000) continue;
    return wakeMs;
  }
  return null;
}

// When does the user's next sharp window open?
//   { at: Date|null, status: 'now'|'today'|'tomorrow'|'unknown' }
// 'unknown' is the honest answer when there's no wearable wake time — the caller
// should resurface on next app-open rather than invent a clock time.
export function nextSharpWindow(historyMap, chronotype) {
  const band = PEAK_BANDS[chronotype] || PEAK_BANDS.flexible;
  const wakeMs = lastWakeMs(historyMap);
  if (wakeMs == null) return { at: null, status: 'unknown' };
  const now = Date.now();
  const Ha = (now - wakeMs) / 3600000;
  if (Ha >= band.start && Ha < band.end) return { at: new Date(now), status: 'now' };
  if (Ha < band.start) return { at: new Date(wakeMs + band.start * 3600000), status: 'today' };
  // Peak already passed today — assume a similar wake ~24h on.
  return { at: new Date(wakeMs + 24 * 3600000 + band.start * 3600000), status: 'tomorrow' };
}

// Park a decision. Returns the stored record. `weight` is the user's own sense
// of how much it matters — never a computed judgement.
export function parkDecision({ text, weight = 'consequential' }, historyMap, chronotype) {
  const map = loadMap();
  const win = nextSharpWindow(historyMap, chronotype);
  const rec = {
    id: makeId(),
    text: String(text || '').trim(),
    weight,
    createdAt: new Date().toISOString(),
    resurfaceAt: win.at ? win.at.toISOString() : null,
    windowStatus: win.status,           // now | today | tomorrow | unknown
    chronotype: chronotype || 'flexible',
    status: 'parked',                   // parked → revisited (append-only; never deleted)
  };
  map[rec.id] = rec;
  saveMap(map);
  return rec;
}

// Karolinska Sleepiness Scale (Åkerstedt 1990): 1 = extremely alert … 9 =
// fighting sleep. Same validated 1–9 probe as components/Surveys.jsx KssEditor
// (duplicated here to keep the v2 surface self-contained — the scale is a fixed
// standard, so there's nothing to drift). We surface it as a pre-decision
// clarity check because sleepiness quietly dents judgment, and store it so we
// can later learn how a person's alertness tracks with their decisions.
export const KSS_LABELS = {
  1: 'Extremely alert', 2: 'Very alert', 3: 'Alert', 4: 'Fairly alert',
  5: 'Neither alert nor sleepy', 6: 'Some signs of sleepiness',
  7: 'Sleepy, no effort to stay awake', 8: 'Sleepy, some effort to stay awake',
  9: 'Fighting sleep',
};

// Attach a clarity reading (KSS 1–9) to a decision. Additive: leaves status and
// every other field untouched; just records the reading and when it was taken.
export function recordClarity(id, kss) {
  const map = loadMap();
  if (map[id]) {
    map[id] = { ...map[id], clarityKss: kss, clarityAt: new Date().toISOString() };
    saveMap(map);
  }
}

// Flip a parked decision to revisited. Non-destructive: the record stays, with a
// revisitedAt stamp, seeding the personal decision history (Phase 3/4).
export function markRevisited(id) {
  const map = loadMap();
  if (map[id] && map[id].status === 'parked') {
    map[id] = { ...map[id], status: 'revisited', revisitedAt: new Date().toISOString() };
    saveMap(map);
  }
}

// Record how a revisited decision landed, a while later (additive — never
// deletes). This is the look-back loop: it gives a gentle reason to return AND
// builds the personal sense of which calls went well. outcome: 'glad' | 'mixed' | 'regret'.
export function recordOutcome(id, outcome) {
  const map = loadMap();
  if (map[id]) {
    map[id] = { ...map[id], outcome, outcomeAt: new Date().toISOString() };
    saveMap(map);
  }
}

// Decisions made a few days back with no look-back yet — worth a quiet "how did
// that land?". Keyed off revisitedAt so it only surfaces once the call has had
// time to play out (default ~5 days).
export function lookBackDecisions(now = Date.now(), minAgeDays = 5) {
  const cutoff = now - minAgeDays * 86400000;
  return loadDecisions().filter((d) =>
    d.status === 'revisited' && !d.outcome && d.revisitedAt && new Date(d.revisitedAt).getTime() <= cutoff);
}

// All decisions, newest first.
export function loadDecisions() {
  return Object.values(loadMap()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

// Still-parked decisions whose window has arrived (resurfaceAt <= now, or an
// unknown window we surface on sight). These are the ones to nudge about.
export function readyDecisions(now = Date.now()) {
  return loadDecisions().filter((d) =>
    d.status === 'parked' && (d.windowStatus === 'unknown' || (d.resurfaceAt && new Date(d.resurfaceAt).getTime() <= now)));
}

// Still-parked decisions whose window is in the future.
export function upcomingDecisions(now = Date.now()) {
  return loadDecisions().filter((d) =>
    d.status === 'parked' && d.resurfaceAt && new Date(d.resurfaceAt).getTime() > now);
}

// Soonest future resurface instant across all parked decisions (for scheduling a
// single notification), or null.
export function nextResurfaceAt(now = Date.now()) {
  const times = upcomingDecisions(now).map((d) => new Date(d.resurfaceAt).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

// ── Phase 4: "you've faced this before" — retrieval over your own history ─────
// A dependency-free, on-device matcher: token cosine over the user's PAST
// decisions that carry a recorded outcome. This is the honest, private version
// of "personalize from your data" — pure retrieval, nothing leaves the device,
// no training. Kept behind one function so the matcher can later be swapped for
// on-device neural embeddings (Apple NaturalLanguage / transformers.js) without
// touching the surface.
const STOP = new Set(['the', 'a', 'an', 'to', 'or', 'and', 'of', 'my', 'our', 'i', 'it', 'its', 'is', 'on', 'in', 'for', 'with', 'at', 'this', 'that', 'be', 'do', 'should', 'whether', 'if', 'am', 'are', 'was', 'were', 'have', 'has', 'about', 'vs', 'than', 'then', 'now', 'not']);

function tokenize(s) {
  return (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 2 && !STOP.has(t));
}

function cosineSim(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const af = {}, bf = {};
  for (const t of aTokens) af[t] = (af[t] || 0) + 1;
  for (const t of bTokens) bf[t] = (bf[t] || 0) + 1;
  let dot = 0, na = 0, nb = 0;
  for (const t in af) { na += af[t] * af[t]; if (bf[t]) dot += af[t] * bf[t]; }
  for (const t in bf) nb += bf[t] * bf[t];
  return dot / ((Math.sqrt(na) * Math.sqrt(nb)) || 1);
}

// Past decisions (with a recorded outcome) that rhyme with `text`, strongest
// first. High threshold + a soft surface so a loose match never overclaims.
export function similarPastDecisions(text, { max = 1, minScore = 0.34 } = {}) {
  const q = tokenize(text);
  if (q.length < 2) return [];
  return loadDecisions()
    .filter((d) => d.outcome && d.text)
    .map((d) => ({ d, score: cosineSim(q, tokenize(d.text)) }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.d);
}
