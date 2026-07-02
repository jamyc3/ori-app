// Ori — shared journal-backfill runner (the pure orchestration half).
//
// The "read your imported / unread days" worker-pool, lifted out of CPI.jsx so
// BOTH the classic Analyze tab and the v2 free-30-day-read funnel drive ONE loop
// — they can't drift. The engine-bound per-day step lives in backfillDay.js;
// keeping it out of this file means the orchestration is importable under Node
// for deterministic tests (no engine, no network). The per-day step is injected
// (`analyzeDay`), defaulting to the real one via a lazy import so production
// callers don't have to wire it.

import { BATCH_CONCURRENCY } from './batch-analyze.js';

function emitLetterWritten() {
  try {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new Event('cpi:letter-written'));
    }
  } catch { /* non-browser / test env */ }
}

// Worker-pool over the given days. Every worker reads the SAME pre-run history
// snapshot — backfill doesn't need each day to see the prior day's fresh reading
// (see BATCH_CONCURRENCY rationale in batch-analyze.js). onProgress fires as a
// day starts ({completed,total,currentYmd}) and as it finishes (currentYmd null).
// Returns { entries, errors }; the caller merges entries into its history.
export async function runBackfill({
  days, historySnapshot = [], ctx = {}, onProgress,
  analyzeDay, concurrency = BATCH_CONCURRENCY,
}) {
  const list = Array.isArray(days) ? days : [];
  const total = list.length;
  const entries = [];
  const errors = [];
  if (total === 0) return { entries, errors };

  // Default to the real per-day reader via a LAZY import, so this module stays
  // engine-free at load time (tests inject their own analyzeDay and never reach
  // this line).
  const runDay = analyzeDay || (await import('./backfillDay.js')).analyzeBackfillDay;

  let nextIndex = 0;
  let completed = 0;
  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= total) return;
      const ymd = list[i];
      onProgress?.({ completed, total, currentYmd: ymd });
      try {
        const entry = await runDay(ymd, historySnapshot, ctx);
        if (entry) { entries.push(entry); emitLetterWritten(); }
      } catch (err) {
        errors.push({ ymd, message: err?.message || 'Unknown error' });
      }
      completed += 1;
      onProgress?.({ completed, total, currentYmd: null });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
  return { entries, errors };
}
