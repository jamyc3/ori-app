// Ori — one historical day's backfill reading (the engine-bound half).
//
// Split out from backfillRunner.js so the worker-pool orchestration stays
// importable under Node for tests, while this half (which pulls the full engine)
// holds the per-day work: compose seeds → ask Claude → compute HCPI → write the
// SAME cpi_letter_<ymd> + history row a live reading writes (the exact shape v2's
// Inbox/Day read back, verified). The Claude call is injectable for tests.

import {
  analyzeWithClaude, computeHCPI, computeBiometricTrends,
  getOrCreateAnonId, getUserAge, buildEntrySnapshot,
  loadRepo, OURA_HISTORY_KEY, detectCrisis,
} from './engine.js';
import { ANALYSIS_VERSION } from './flags.js';
import { composeSeedsForDay, backfillEntryTimestamp } from './batch-analyze.js';

// ctx: { biometrics, lifestyle, mode, wakeTime, chronotype }.
// Returns the history row (and writes cpi_letter_<ymd>), or null when the day
// has no usable text.
export async function analyzeBackfillDay(ymd, historySnapshot, ctx, { analyze = analyzeWithClaude } = {}) {
  const { biometrics, lifestyle, mode = 'full', wakeTime = '07:00', chronotype = null } = ctx || {};

  const composed = composeSeedsForDay(loadRepo(), ymd);
  if (!composed.text) return null;

  // Crisis gate — same screen as the nightly letter (writeLetterFor). The bulk
  // 30-day funnel is a SEPARATE path into the model, so it must screen too, or
  // imported crisis writing in the last 30 days gets sent to Claude — exactly
  // what the nightly gate prevents. On a hit: never call the model, write the
  // {crisis:true} sentinel (Day/Letter route to verified support, kept out of
  // the Inbox), mark it read, and return null so the runner skips the day.
  if (detectCrisis([{ rawText: composed.plain || composed.text }]).length > 0) {
    try {
      localStorage.setItem(`cpi_letter_${ymd}`, JSON.stringify({ date: ymd, crisis: true, at: new Date().toISOString() }));
      localStorage.setItem(`cpi_letter_read_${ymd}`, '1');
    } catch { /* storage unavailable — still never call the model */ }
    return null;
  }

  // History context for this single day = entries dated strictly before it,
  // newest-first (the order analyzeWithClaude expects). A snapshot, so parallel
  // workers don't have to coordinate.
  const historyBefore = (historySnapshot || [])
    .filter((e) => typeof e?.date === 'string' && e.date.slice(0, 10) < ymd)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  let biometricTrends = null;
  try {
    const raw = localStorage.getItem(OURA_HISTORY_KEY);
    if (raw) biometricTrends = computeBiometricTrends(JSON.parse(raw), ymd);
  } catch { /* ignore */ }

  const a = await analyze(composed.text, '', historyBefore, biometricTrends, biometrics, lifestyle, { mode });

  const wH = parseInt(wakeTime.split(':')[0], 10) + parseInt(wakeTime.split(':')[1], 10) / 60;
  const bioWithSri = {
    ...biometrics,
    sri7d: biometricTrends?.sri ?? biometrics?.sri7d ?? null,
    sleepDebt7d: biometricTrends?.sleepDebtH ?? biometrics?.sleepDebt7d ?? null,
  };
  const h = computeHCPI(wH, a, historyBefore, bioWithSri, lifestyle, chronotype);

  const entry = {
    date: backfillEntryTimestamp(ymd),
    analysisVersion: ANALYSIS_VERSION, wakeTime, period: 'evening', checkInNum: 1,
    dayDesc: (composed.plain || composed.text).substring(0, 600),
    hcpi: h.HCPI,
    params: { S: a.S, C: a.C, mu: a.mu, psi: a.psi, W: a.W, L: a.L },
    drivers: a.driverScores,
    E0: h.E0, recentStrain: h.recentStrain, lambda: h.lambda,
    chronotype, decisionCount: a.decisionCount,
    lingeringDriver: a.lingeringDriver || null,
    sourceMode: mode, seedCount: composed.seedCount,
    letterParts: Array.isArray(a?.letter?.parts)
      ? a.letter.parts.map((p) => ({ id: p?.id, volume: p?.volume })).filter((p) => p.id)
      : null,
    anonId: getOrCreateAnonId(), ageAtEntry: getUserAge(),
    bioSnapshot: buildEntrySnapshot(bioWithSri, biometricTrends),
    backfilled: true,
  };

  try {
    localStorage.setItem(`cpi_letter_${ymd}`, JSON.stringify({ date: ymd, result: { a, h } }));
  } catch { /* ignore */ }
  return entry;
}
