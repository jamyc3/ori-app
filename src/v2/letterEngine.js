// Ori v2 — the letter writer.
//
// v1 generates the nightly letter inside CPI.jsx (the `analyze` flow):
// compose the day's text → analyzeWithClaude → computeHCPI → prepend a
// history entry to cpi-v2-data → store cpi_letter_<ymd>. That code is a
// v1 surface and can't be imported here, so this module re-assembles the
// same pipeline from the shared engine exports, writing the exact same
// shapes to the exact same keys. v1 reads letters written here
// indistinguishably from its own — and vice versa.
//
// Trigger model (Shell polls once a minute):
//   a letter is due when (1) today has at least one journal entry,
//   (2) no cpi_letter_<today> exists yet, and (3) the clock has passed
//   the user's letter time. Failures (offline, proxy down) back off for
//   ten minutes and try again — the banner just keeps saying "tonight".

import {
  analyzeWithClaude,
  streamLetterProse,
  computeHCPI,
  computeBiometricTrends,
  detectCrisis,
  getTimeContext,
  getOrCreateAnonId,
  getUserAge,
  buildEntrySnapshot,
  loadRepo,
  OURA_HISTORY_KEY,
  BIOMETRICS_KEY,
  LIFESTYLE_KEY,
  CHRONO_KEY,
  MODE_KEY,
} from '../engine.js';
import { composeSeedsForDay } from '../batch-analyze.js';
import { ymdISO } from '../dates.js';
import { PARTS_LIB } from '../LetterReading.jsx';
import { validateLetter } from './letterGate.js';
import { buildDemandsLookup } from './demandsData.js';
import { loadWho5History } from '../who5.js';

const HISTORY_KEY = 'cpi-v2-data';
const REFLECT_TIME_KEY = 'cpi_reflect_time';
const ATTEMPT_KEY = 'cpi_v2_letter_attempt_at';
// After a failed/interrupted write, how long before the background clock may
// retry. The old 10-minute lockout stranded the letter after a single network
// blip (a 25s call dies the instant the screen locks or the app backgrounds),
// leaving the user tapping "Read it now" into a dead zone. ~90s lets it self-heal.
const RETRY_MS = 90 * 1000;

// Same fallback chain CPI uses for wake time: today's manual override →
// wearable bedtime_end (≤28h old) → last known wake → 07:00.
function resolveWakeTime() {
  const today = ymdISO(new Date());
  try {
    const override = localStorage.getItem(`cpi_wake_override_${today}`);
    if (override) return override;
  } catch { /* fall through */ }
  try {
    const raw = localStorage.getItem(OURA_HISTORY_KEY);
    if (raw) {
      const map = JSON.parse(raw);
      const now = Date.now();
      for (const d of Object.keys(map).sort().reverse().slice(0, 3)) {
        const be = map[d]?.bedtimeEnd;
        if (!be) continue;
        const t = new Date(be).getTime();
        const delta = now - t;
        if (delta < 0 || delta > 28 * 60 * 60 * 1000) continue;
        const dt = new Date(be);
        return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
      }
    }
  } catch { /* fall through */ }
  try {
    const last = localStorage.getItem('cpi_wake_last');
    if (last) return last;
  } catch { /* fall through */ }
  return '07:00';
}

// The letter hour. v1 stores "HH:MM"; v2 onboarding stores the design's
// chip values ("8 PM" … "Sunrise"). Both parse here.
function letterHour() {
  let raw = '';
  try { raw = localStorage.getItem(REFLECT_TIME_KEY) || ''; } catch { /* default below */ }
  const hm = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return parseInt(hm[1], 10) + parseInt(hm[2], 10) / 60;
  // "8:30 PM" / "8:30 AM" — no current UI writes this shape, but legacy or
  // hand-edited values must not silently relocate the letter to the 9 PM
  // default (that reads as "my letter never came").
  const hmap = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (hmap) {
    const h = parseInt(hmap[1], 10) % 12;
    return (hmap[3].toUpperCase() === 'PM' ? h + 12 : h) + parseInt(hmap[2], 10) / 60;
  }
  const pm = raw.match(/^(\d{1,2})\s*PM$/i);
  if (pm) return (parseInt(pm[1], 10) % 12) + 12;
  // AM chips / morning reflect times (12 AM → 0, 7 AM → 7) — without this branch
  // any AM value silently fell through to the 9 PM default, relocating the
  // letter clock AND every notification by up to 12 hours.
  const am = raw.match(/^(\d{1,2})\s*AM$/i);
  if (am) return parseInt(am[1], 10) % 12;
  // "Sunrise" — the letter opens with the morning; due from 6 AM.
  if (/sunrise/i.test(raw)) return 6;
  return 21;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function loadHistory() {
  const parsed = readJson(HISTORY_KEY, []);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.history)) return parsed.history;
  return [];
}

function letterExistsFor(ymd) {
  try {
    return Boolean(localStorage.getItem(`cpi_letter_${ymd}`));
  } catch {
    return false;
  }
}

function attemptedRecently() {
  try {
    const at = Number(localStorage.getItem(ATTEMPT_KEY) || 0);
    return Date.now() - at < RETRY_MS;
  } catch {
    return false;
  }
}

export function letterDueNow(now = new Date()) {
  const today = ymdISO(now);
  if (letterExistsFor(today)) return false;
  if (attemptedRecently()) return false;
  const hourNow = now.getHours() + now.getMinutes() / 60;
  if (hourNow < letterHour()) return false;
  try {
    const composed = composeSeedsForDay(loadRepo(), today);
    return Boolean(composed?.text && composed.text.trim());
  } catch {
    return false;
  }
}

// Today's letter hour as a concrete local Date (e.g. 20:00 today). Used to
// schedule the local-notification reminder so the letter reaches the user at
// their chosen time even when the app is closed.
export function letterHourToday(now = new Date()) {
  const h = letterHour();
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
}

// Whether today's letter already exists in the cache.
export function letterExistsToday() {
  return letterExistsFor(ymdISO(new Date()));
}

// Whether a given local day has any words to write a letter from — gates the
// "Read it now" affordance on the Letter screen for that day (today, or a past
// day whose letter was never written because the app wasn't open at its hour).
export function dayHasWords(iso) {
  try {
    const composed = composeSeedsForDay(loadRepo(), iso);
    return Boolean(composed?.text && composed.text.trim());
  } catch {
    return false;
  }
}

export function todayHasWords() {
  return dayHasWords(ymdISO(new Date()));
}

// What a given day's letter would be composed from, right now: the entry COUNT
// (the reliable signal — "you recorded 3 more journals") and the text length (a
// secondary signal for a longer edit at the same count). composeSeedsForDay's
// `seedCount` is exactly the entries the letter is built from, so this matches
// the letter's own view of the day.
function composedNow(iso) {
  try {
    const c = composeSeedsForDay(loadRepo(), iso);
    return { count: c?.seedCount || 0, len: (c?.text || '').trim().length };
  } catch {
    return { count: 0, len: 0 };
  }
}

// A few words, not a whitespace/recompose blip — the length growth (at the same
// entry count) needed before a stored letter counts as out of date.
const STALE_MIN_GROWTH = 12;

// Today's letter is a LIVING DRAFT: reading it early and then reflecting more
// should not strand you on the first version. A stored letter is "stale" when
// the day has MORE entries than it was built from (the primary signal), or its
// words grew meaningfully at the same count. Only today qualifies (a past day
// receives no new words); crisis sentinels never regenerate. Letters written
// before tracking existed get their baselines backfilled lazily here, so they
// start tracking from this moment instead of forcing a needless rewrite.
export function letterStaleFor(iso, now = new Date()) {
  if (iso !== ymdISO(now)) return false;
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(`cpi_letter_${iso}`) || 'null'); } catch { return false; }
  if (!stored || stored.crisis || !stored.result) return false;
  const live = composedNow(iso);
  if (typeof stored.srcCount !== 'number' || typeof stored.srcLen !== 'number') {
    try {
      stored.srcCount = live.count;
      stored.srcLen = live.len;
      localStorage.setItem(`cpi_letter_${iso}`, JSON.stringify(stored));
    } catch { /* best effort — just won't track until next write */ }
    return false;
  }
  return live.count > stored.srcCount || live.len > stored.srcLen + STALE_MIN_GROWTH;
}

// How many of today's entries the stored letter has NOT yet read — drives the
// "Read again · N new" affordance. 0 when there's nothing new, no letter, a
// crisis day, or a legacy letter with no recorded baseline.
export function newEntriesSince(iso, now = new Date()) {
  if (iso !== ymdISO(now)) return 0;
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(`cpi_letter_${iso}`) || 'null'); } catch { return 0; }
  if (!stored || stored.crisis || !stored.result || typeof stored.srcCount !== 'number') return 0;
  return Math.max(0, composedNow(iso).count - stored.srcCount);
}

// The nights the app wasn't open at the letter hour leave a day with words but
// no letter. These aren't lost — the letter waits to be read on demand. Returns
// those local days within the last `withinDays`, newest first, excluding today
// (handled by the live clock). Surfaced in the Inbox and the Day view.
export function missedLetterDays(withinDays = 7, now = new Date()) {
  const today = ymdISO(now);
  const cutoff = ymdISO(new Date(now.getTime() - withinDays * 86400000));
  const seen = new Set();
  const out = [];
  try {
    const repo = loadRepo();
    const entries = Array.isArray(repo?.entries) ? repo.entries : [];
    for (const e of entries) {
      let iso = null;
      if (typeof e?.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(e.date)) iso = e.date.slice(0, 10);
      else if (e?.createdAt) { const d = new Date(e.createdAt); if (!isNaN(d.getTime())) iso = ymdISO(d); }
      if (!iso || seen.has(iso)) continue;
      seen.add(iso);
      if (iso >= today || iso < cutoff) continue;     // today is the live clock's; older than the window is archived
      if (letterExistsFor(iso)) continue;             // already written
      if (!dayHasWords(iso)) continue;                // must compose to real text
      out.push(iso);
    }
  } catch { /* no repo — nothing waiting */ }
  return out.sort().reverse();
}

let inFlight = false;

// Write (or back-fill) the letter for a given local day. Defaults to today.
// The letter is generated on demand from that day's words, so a night you never
// opened the app isn't lost — its letter simply waits to be read, and this is
// what reads it. Today's write also advances the live history + "latest reading"
// and arms the retry clock; a back-fill for a PAST day writes only that day's
// letter (and its frozen day-rings if missing), never disturbing the
// newest-first history or the latest-reading pointer.
export async function writeLetterFor(targetIso, { force = false, onProse = null } = {}) {
  if (inFlight) return null;
  const now = new Date();
  const today = ymdISO(now);
  const iso = targetIso || today;
  const isToday = iso === today;
  // `force` regenerates an existing letter (today's living draft picking up new
  // reflections); the default still no-ops when a letter is already cached.
  if (!force && letterExistsFor(iso)) return null;

  const composed = (() => {
    try { return composeSeedsForDay(loadRepo(), iso); } catch { return null; }
  })();
  if (!composed?.text || !composed.text.trim()) return { error: 'no-words' };
  // What this letter is being written from — entry count + text length — stored
  // so a later open can tell whether the day has grown (new reflections) and the
  // draft should be refreshed.
  const srcLen = composed.text.trim().length;
  const srcCount = composed.seedCount || 0;

  // Crisis gate — the always-on nightly letter must never generate AI prose
  // over self-harm / crisis writing. This is the same deterministic detector
  // (CRISIS_PATTERNS) the Today capture surface already runs on entries; here
  // it guards the one surface that slipped through. On a hit we suppress the
  // letter entirely (the model is NEVER called with this text), persist a
  // sentinel so the background clock stops and the day stably routes to
  // support, and mark it read so a withheld letter can't pose as unread mail.
  // The Letter/Inbox surfaces render verified crisis lines for a crisis day.
  if (detectCrisis([{ rawText: composed.plain || composed.text }]).length > 0) {
    try {
      localStorage.setItem(`cpi_letter_${iso}`, JSON.stringify({ date: iso, crisis: true, at: now.toISOString() }));
      localStorage.setItem(`cpi_letter_read_${iso}`, '1');
    } catch { /* storage unavailable — still never generate a letter */ }
    window.dispatchEvent(new Event('cpi:letter-written'));
    return { crisis: true };
  }

  inFlight = true;
  // Only the live (today) write arms the background retry-backoff clock.
  if (isToday) { try { localStorage.setItem(ATTEMPT_KEY, String(Date.now())); } catch { /* best effort */ } }

  try {
    const history = loadHistory();
    const biometrics = readJson(BIOMETRICS_KEY, null);
    const lifestyle = readJson(LIFESTYLE_KEY, { hydration: 6, exercise: 'none' });
    const chronotype = (() => {
      try { return localStorage.getItem(CHRONO_KEY) || 'flexible'; } catch { return 'flexible'; }
    })();
    const mode = (() => {
      try { return localStorage.getItem(MODE_KEY) || 'full'; } catch { return 'full'; }
    })();

    let biometricTrends = null;
    const ouraMap = readJson(OURA_HISTORY_KEY, null);
    if (ouraMap) {
      try { biometricTrends = computeBiometricTrends(ouraMap, iso); } catch { /* sparse data */ }
    }

    // Quality gate: the letter must have a readable shape and stay off
    // clinical/diagnostic language before it's stored. One retry, then
    // fail closed — the attempt backoff keeps the banner on "tonight"
    // rather than showing an unvetted letter.
    const knownPartIds = Object.keys(PARTS_LIB || {});

    // Call A (streamed prose) — ONLY when the caller wants live streaming (the
    // "read it now" tap passes onProse) and the language supports it. Runs IN
    // PARALLEL with the structured Call B below. Failures are swallowed: Call B's
    // letter is the source of truth and fallback, so streaming never regresses it.
    const lang = (() => {
      try { return localStorage.getItem('ori_reflect_lang') === 'bn' ? 'bn' : 'en'; } catch { return 'en'; }
    })();
    const proseP = (onProse && lang !== 'bn')
      ? streamLetterProse(composed.text, '', history, biometricTrends, biometrics, lifestyle, { mode }, onProse).catch(() => null)
      : Promise.resolve(null);

    // Call B (structured) — scores, insights, parts, tier. Source of truth + the
    // clinical/shape gate (one retry, then fail closed).
    let a = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const candidate = await analyzeWithClaude(composed.text, '', history, biometricTrends, biometrics, lifestyle, { mode });
      const check = validateLetter(candidate, { knownPartIds });
      if (check.ok) {
        // check.insights is the clinical-free subset; check.letter has any
        // clinical part-notes stripped. Store the sanitized forms so no
        // user-visible channel (prose, insight fallback, or part blurb)
        // can carry clinical/citation language.
        a = { ...candidate, letter: check.letter, insights: check.insights };
        break;
      }
      console.warn(`Letter gate (attempt ${attempt + 1}):`, check.problems.join('; '));
    }
    if (!a) { try { await proseP; } catch { /* ignore */ } return { error: 'gate' }; }

    // Prefer the streamed prose for what the user READS (headline + paragraphs),
    // keeping Call B's parts/tier/scores. Re-run the SAME gate on the merged
    // letter so streamed prose gets the identical clinical/shape scrub; if it
    // doesn't pass, keep Call B's already-validated letter.
    const prose = await proseP;
    if (prose?.headline && Array.isArray(prose.paragraphs) && prose.paragraphs.length) {
      const mergedCandidate = { ...a, letter: { ...a.letter, headline: prose.headline, paragraphs: prose.paragraphs } };
      const mcheck = validateLetter(mergedCandidate, { knownPartIds });
      if (mcheck.ok) a = { ...a, letter: mcheck.letter };
      else console.warn('Streamed prose failed the gate; keeping the structured letter:', (mcheck.problems || []).join('; '));
    }

    const wake = resolveWakeTime();
    const wH = parseInt(wake.split(':')[0], 10) + parseInt(wake.split(':')[1], 10) / 60;
    const bioWithSri = {
      ...biometrics,
      sri7d: biometricTrends?.sri ?? biometrics?.sri7d ?? null,
      sleepDebt7d: biometricTrends?.sleepDebtH ?? biometrics?.sleepDebt7d ?? null,
    };
    const h = computeHCPI(wH, a, history, bioWithSri, lifestyle, chronotype);

    // Persist the letter FIRST — it's the source of truth the UI reads. If this
    // throws (quota), return the honest error path instead of reporting success:
    // otherwise cpi_letter_<iso> never lands, loadLetterFor returns null, and
    // the screen spins until the 40s timeout shows a false "offline".
    try {
      const stored = JSON.stringify({ date: iso, result: { a, h }, srcLen, srcCount });
      // "cpi_last_reading" is the LATEST reading — only today's write owns it; a
      // back-fill of a past day must never pose as the newest reading.
      if (isToday) localStorage.setItem('cpi_last_reading', stored);
      localStorage.setItem(`cpi_letter_${iso}`, stored);
    } catch {
      return { error: 'offline' };
    }

    // The analyzed history (cpi-v2-data) is newest-first, so ONLY today's letter
    // prepends an entry. Back-filling a past day must not prepend — it would pose
    // as the newest reading and skew "last entry"/ordering — that day already
    // carries its own capture-time readings.
    if (isToday) {
      // A forced regeneration REPLACES today's prior reading rather than stacking
      // a duplicate — otherwise re-reading after more words would pile multiple
      // same-day readings into the history (skewing charts + "last reading").
      const baseHistory = force
        ? history.filter((e) => !(typeof e?.date === 'string' && e.date.slice(0, 10) === iso))
        : history;
      const todaysInHistory = baseHistory.filter(
        (e) => typeof e?.date === 'string' && e.date.slice(0, 10) === iso
      ).length;
      const tc = getTimeContext();
      // Stamp in LOCAL time, never UTC. toISOString() files an evening entry under
      // the NEXT calendar day for any user west of UTC, hiding the letter from
      // "today" views. A local datetime string (no trailing Z) round-trips back as
      // local time and slices to the correct local day.
      const p2 = (n) => String(n).padStart(2, '0');
      const localStamp = `${iso}T${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;
      // Mirrors the live entry shape CPI's analyze() writes — same fields, same
      // order of meaning, so every v1 dashboard reads it natively.
      const entry = {
        date: localStamp,
        wakeTime: wake,
        period: tc.period,
        checkInNum: todaysInHistory + 1,
        dayDesc: (composed.plain || composed.text).substring(0, 300),
        hcpi: h.HCPI,
        params: { S: a.S, C: a.C, mu: a.mu, psi: a.psi, W: a.W, L: a.L },
        drivers: a.driverScores,
        E0: h.E0,
        recentStrain: h.recentStrain,
        lambda: h.lambda,
        chronotype,
        decisionCount: a.decisionCount,
        lingeringDriver: a.lingeringDriver || null,
        letterParts: Array.isArray(a?.letter?.parts)
          ? a.letter.parts.map((p) => ({ id: p?.id, volume: p?.volume })).filter((p) => p.id)
          : null,
        anonId: getOrCreateAnonId(),
        ageAtEntry: getUserAge(),
        bioSnapshot: buildEntrySnapshot(bioWithSri, biometricTrends),
      };
      const nH = [entry, ...baseHistory].slice(0, 200);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(nH)); } catch { /* history is best-effort */ }
    }
    window.dispatchEvent(new Event('cpi:letter-written'));

    // Freeze where the day landed — Reserves / Demands / Form — keyed by the
    // LOCAL day, but ONLY if not already snapshotted: a back-fill must never
    // clobber the note taken when the day was live. The journal reads this frozen
    // note instead of recomputing later, so a past day never drifts.
    try {
      if (!localStorage.getItem(`cpi_day_rings_${iso}`)) {
        const ouraDays = JSON.parse(localStorage.getItem('cpi_oura_history') || '{}');
        const reserves = typeof ouraDays?.[iso]?.sleepScore === 'number'
          ? Math.round(ouraDays[iso].sleepScore) : null;
        let demands = null;
        try { const v = buildDemandsLookup()(iso); if (typeof v === 'number') demands = Math.round(v); } catch { /* no demands sources */ }
        let form = null;
        try {
          // loadWho5History() is a map keyed by local YYYY-MM-DD — a direct lookup,
          // not a for...of (which threw on the object and left form perpetually null).
          const who5Day = (loadWho5History() || {})[iso];
          if (who5Day && typeof who5Day.score === 'number') form = Math.round(who5Day.score);
        } catch { /* no check-ins */ }
        localStorage.setItem(`cpi_day_rings_${iso}`, JSON.stringify({ reserves, demands, form, at: now.toISOString() }));
      }
    } catch { /* snapshot is best-effort */ }

    return { a, h };
  } catch {
    // Offline / proxy unreachable — ATTEMPT_KEY already set, so the next
    // poll backs off for RETRY_MS and the banner keeps saying "tonight".
    return { error: 'offline' };
  } finally {
    inFlight = false;
  }
}

// Today's letter — the live nightly write (Shell's clock, the notification tap,
// and the "Read it now" affordance on today's letter all route here).
export async function writeTodaysLetter() {
  return writeLetterFor(ymdISO(new Date()));
}
