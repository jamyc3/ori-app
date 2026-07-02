#!/usr/bin/env node
// Eval — the shared backfill worker-pool (src/backfillRunner.js).
//
// This is the loop BOTH the classic Analyze tab and the v2 free-30-day-read
// funnel will drive, so its orchestration must be exact: process every day,
// respect the concurrency cap, capture a per-day failure WITHOUT aborting the
// batch, and report progress. The per-day reader (engine + Claude) is injected
// so this runs deterministically under Node with no network. The real per-day
// assembly is a verbatim lift of v1's proven code (build-checked) and is
// verified live once an API key is present.
// Run: node scripts/eval-backfill-runner.mjs (exit 1 on fail).

globalThis.window = { dispatchEvent: () => true };
globalThis.Event = class { constructor(t) { this.type = t; } };

const { runBackfill } = await import('../src/backfillRunner.js');

const results = [];
const check = (name, ok) => { results.push(ok); console.log(`  ${ok ? '✓' : '×'} ${name}`); };

// 7 days, concurrency 3, one day throws mid-batch.
const days = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'];
let active = 0; let maxActive = 0; const progress = []; const started = [];
const analyzeDay = async (ymd) => {
  active += 1; maxActive = Math.max(maxActive, active);
  await new Promise((r) => setTimeout(r, 5));
  active -= 1;
  started.push(ymd);
  if (ymd === 'd4') throw new Error('boom');
  return { date: `${ymd}T20:00:00`, id: ymd };
};
const { entries, errors } = await runBackfill({
  days, ctx: {}, concurrency: 3, analyzeDay, onProgress: (p) => progress.push(p),
});

check('every non-erroring day produced an entry (6 of 7)', entries.length === 6);
check('the erroring day is captured in errors, not thrown (1, d4)', errors.length === 1 && errors[0].ymd === 'd4');
check('a mid-batch failure does NOT abort the rest (all 7 attempted)', started.length === 7);
check('concurrency cap respected (max in-flight ≤ 3, and it did parallelise)', maxActive <= 3 && maxActive > 1);
check('onProgress fired on start + finish for every day (≥ 14)', progress.length >= days.length * 2);
check('returns a well-formed {entries, errors} result', Array.isArray(entries) && Array.isArray(errors));

// Empty input is a no-op, not a crash.
const empty = await runBackfill({ days: [], analyzeDay });
check('empty day list → {entries:[],errors:[]} no-op', empty.entries.length === 0 && empty.errors.length === 0);

// concurrency never exceeds the day count.
let maxActive2 = 0; let active2 = 0;
await runBackfill({
  days: ['only'], concurrency: 5,
  analyzeDay: async () => { active2 += 1; maxActive2 = Math.max(maxActive2, active2); await new Promise((r) => setTimeout(r, 2)); active2 -= 1; return { date: 'x' }; },
});
check('spawns at most `days.length` workers (1 day → 1 worker)', maxActive2 === 1);

const passed = results.filter(Boolean).length;
console.log(`\nBackfill runner eval — ${passed}/${results.length} cases passing`);
if (passed !== results.length) { console.error('FAIL'); process.exit(1); }
console.log('PASS — every day read, cap respected, one failure never sinks the batch.');
