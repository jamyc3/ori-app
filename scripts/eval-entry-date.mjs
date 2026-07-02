#!/usr/bin/env node
// Eval — cross-midnight entry attribution (entryDayFromStart).
//
// The rule: an entry's date is the local day it STARTED, never when it was
// submitted. An entry begun 11:59 PM and saved 12:01 AM stays on the prior day;
// a fresh entry begun 12:30 AM is the new day. Pure + deterministic — every
// Date here is built with the LOCAL constructor (new Date(y, m, d, h, m)) so the
// expected ymd is computed in the same zone the runner uses, no TZ flakiness.
//   node scripts/eval-entry-date.mjs   (exit 1 on any failure)

import { entryDayFromStart, startIso, ymd, canonicalCheckinDay } from '../src/date-util.js';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

// Local instants (month index is 0-based → 4 = May).
const beforeMidnight = new Date(2026, 4, 16, 23, 59, 0);   // Sat 2026-05-16 23:59
const afterMidnight  = new Date(2026, 4, 17, 0, 1, 0);     // Sun 2026-05-17 00:01
const freshAfter     = new Date(2026, 4, 17, 0, 30, 0);    // Sun 2026-05-17 00:30
const lateNight      = new Date(2026, 4, 16, 23, 0, 0);    // Sat 23:00
const nextMorning    = new Date(2026, 4, 17, 2, 0, 0);     // Sun 02:00

console.log('Cross-midnight attribution — entryDayFromStart');

// THE bug: started 11:59 PM, "now" (submit) is 12:01 AM → prior day, not today.
ok('11:59 PM start, submitted 12:01 AM → prior day (2026-05-16)',
  entryDayFromStart(beforeMidnight, afterMidnight) === '2026-05-16');

// A genuinely new interaction after midnight → the new day.
ok('fresh 12:30 AM start → new day (2026-05-17)',
  entryDayFromStart(freshAfter, afterMidnight) === '2026-05-17');

// Long session that spans midnight stays on the start day.
ok('23:00 start, 02:00 submit → start day (2026-05-16)',
  entryDayFromStart(lateNight, nextMorning) === '2026-05-16');

// Accepts a ms epoch and an ISO string, not just a Date.
ok('accepts ms epoch', entryDayFromStart(beforeMidnight.getTime(), afterMidnight) === '2026-05-16');
ok('accepts ISO string', entryDayFromStart(beforeMidnight.toISOString(), afterMidnight) === ymd(beforeMidnight));

// Degrade-safe: missing/garbage start falls back to now (old submit-time behaviour).
ok('null start → falls back to now', entryDayFromStart(null, afterMidnight) === '2026-05-17');
ok('garbage start → falls back to now', entryDayFromStart('not-a-date', afterMidnight) === '2026-05-17');
ok('NaN/invalid Date → falls back to now', entryDayFromStart(new Date('x'), afterMidnight) === '2026-05-17');

// Same-day daytime entry is unaffected.
ok('ordinary 3 PM entry → that day',
  entryDayFromStart(new Date(2026, 4, 16, 15, 0, 0), new Date(2026, 4, 16, 15, 5, 0)) === '2026-05-16');

// startIso is safe + round-trips to the same local day.
ok('startIso(Date) round-trips to same local day',
  ymd(new Date(startIso(beforeMidnight))) === '2026-05-16');
ok('startIso(garbage) never throws → valid ISO',
  typeof startIso('xyz') === 'string' && !isNaN(new Date(startIso('xyz')).getTime()));

// ── The loadRepo date healer (migrateSeedDateDrift) must NOT re-date a
//    cross-midnight entry by submit time. This pins the exact heal logic. ──
console.log('\nloadRepo heal — canonicalCheckinDay prefers start over submit');

// Entry begun 11:59 PM, submitted 12:01 AM: heal keeps it on the start day —
// the regression that broke it once (migration recomputed from uploadedAt).
ok('startedAt present → heals to START day, NOT submit day',
  canonicalCheckinDay({ startedAt: beforeMidnight.toISOString(), uploadedAt: afterMidnight.toISOString() })
    === ymd(beforeMidnight));

// Legacy entry (no startedAt) → falls back to the submit (uploadedAt) local day,
// preserving the original seed-date-drift heal.
ok('no startedAt → falls back to uploadedAt local day',
  canonicalCheckinDay({ uploadedAt: afterMidnight.toISOString() }) === ymd(afterMidnight));

// A correctly start-dated entry is a NO-OP (heal must not churn/flip it).
ok('correctly-dated entry is a no-op (start day == heal day)',
  canonicalCheckinDay({ startedAt: beforeMidnight.toISOString(), uploadedAt: afterMidnight.toISOString() })
    === entryDayFromStart(beforeMidnight));

console.log(`\nEntry-date eval — ${pass}/${pass + fail} passing`);
if (fail) { console.error('FAIL — cross-midnight attribution broke.'); process.exit(1); }
console.log('PASS — entries are dated by when they started, not when they were saved.');
