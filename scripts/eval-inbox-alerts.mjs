#!/usr/bin/env node
// Eval — v2 Inbox alert triggers (the Wilson-CI layer).
//
// An Inbox alert is an L3 claim: "this repeated across your days." These
// fixtures pin the statistical gates so a threshold tweak can't silently
// let point-estimate noise start firing push-style claims. Offline and
// deterministic. Run: node scripts/eval-inbox-alerts.mjs (exit 1 on fail).

import { readFileSync } from 'node:fs';
import { computeAlerts, wilsonCI, normalizeWho5, partClearsRecurrence } from '../src/v2/inboxAlerts.js';

const near = (x, target, tol = 0.01) => Math.abs(x - target) <= tol;
const eqArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
const INBOX_SRC = readFileSync(new URL('../src/v2/inboxAlerts.js', import.meta.url), 'utf8');

const CASES = [
  // Regression guard for the silent-zeroing bug: loadWho5History() returns a
  // date-keyed MAP, but gatherInputs once assumed an array → .filter threw →
  // try/catch swallowed it → EVERY inbox alert returned zero. normalizeWho5 must
  // accept the map shape and return scores oldest→newest.
  {
    name: 'normalizeWho5 accepts a date-keyed MAP (the real bug shape) → scores oldest→newest',
    run: () => eqArr(
      normalizeWho5({ '2026-06-02': { score: 80 }, '2026-06-01': { score: 60 }, '2026-06-03': { score: 72 } }),
      [60, 80, 72],
    ),
  },
  {
    name: 'normalizeWho5 still accepts the legacy array shape',
    run: () => eqArr(
      normalizeWho5([{ score: 80, when: '2026-06-02' }, { score: 60, when: '2026-06-01' }]),
      [60, 80],
    ),
  },
  {
    name: 'normalizeWho5 never throws on junk (null/number/string) → []',
    run: () => eqArr(normalizeWho5(null), []) && eqArr(normalizeWho5(42), []) && eqArr(normalizeWho5('x'), []),
  },
  {
    name: 'wilsonCI(14,14) lower ≈ 0.785 (clears 0.70)',
    run: () => near(wilsonCI(14, 14)[0], 0.785),
  },
  {
    name: 'wilsonCI(10,14) lower stays under 0.70 (p̂=0.71 alone is not enough)',
    run: () => wilsonCI(10, 14)[0] < 0.70,
  },
  {
    name: 'wilsonCI(0,7) upper ≈ 0.354',
    run: () => near(wilsonCI(0, 7)[1], 0.354),
  },
  {
    name: 'part on 14/14 writing days → part-stable fires',
    run: () => computeAlerts({ partDays: { planner: 14 }, writingDays: 14 })
      .some((a) => a.id === 'part-stable:planner'),
  },
  {
    name: 'part on 12/14 days → no alert (CI straddles the line)',
    run: () => computeAlerts({ partDays: { planner: 12 }, writingDays: 14 }).length === 0,
  },
  // ── part-untended (the tending nudge, Path A: same gate + zero reflections) ──
  {
    name: 'partClearsRecurrence matches the part-stable gate (14/14 yes, 12/14 no, 10/10 no)',
    run: () => partClearsRecurrence(14, 14) === true
      && partClearsRecurrence(12, 14) === false
      && partClearsRecurrence(10, 10) === false,
  },
  {
    name: 'cleared gate + never reflected on → part-untended fires, NOT part-stable',
    run: () => {
      const a = computeAlerts({ partDays: { planner: 14 }, writingDays: 14, ackedPartIds: [] });
      return a.some((x) => x.id === 'part-untended:planner')
        && !a.some((x) => x.id === 'part-stable:planner');
    },
  },
  {
    name: 'cleared gate + already reflected on → part-stable fires, NOT part-untended',
    run: () => {
      const a = computeAlerts({ partDays: { planner: 14 }, writingDays: 14, ackedPartIds: ['planner'] });
      return a.some((x) => x.id === 'part-stable:planner')
        && !a.some((x) => x.id === 'part-untended:planner');
    },
  },
  {
    name: 'part-untended rests on the recurrence gate (12/14 unreflected → still silent)',
    run: () => computeAlerts({ partDays: { planner: 12 }, writingDays: 14, ackedPartIds: [] }).length === 0,
  },
  {
    name: 'no ack info (legacy/offline) → part-stable, never part-untended',
    run: () => {
      const a = computeAlerts({ partDays: { planner: 14 }, writingDays: 14 });
      return a.some((x) => x.id === 'part-stable:planner')
        && !a.some((x) => x.kind === 'part-untended');
    },
  },
  {
    name: 'part-untended source is plain + framed as an invitation (no instrument jargon)',
    run: () => {
      const a = computeAlerts({ partDays: { planner: 14 }, writingDays: 14, ackedPartIds: [] })
        .find((x) => x.kind === 'part-untended');
      return a && /invitation/i.test(a.source)
        && !/Wilson|WHO-5|median|95%|lower bound/i.test(a.source);
    },
  },
  {
    name: 'under 14 writing days → never fires, even at 10/10',
    run: () => computeAlerts({ partDays: { planner: 10 }, writingDays: 10 }).length === 0,
  },
  {
    name: '7/7 check-ins above usual → form-lifting fires',
    run: () => computeAlerts({
      who5: [60, 64, 62, 58, 61, 60, 63, 80, 82, 81, 84, 80, 83, 82],
    }).some((a) => a.id === 'form-lifting'),
  },
  {
    name: '5/7 above usual → no alert (majority not significant at n=7)',
    run: () => computeAlerts({
      who5: [60, 64, 62, 58, 61, 60, 63, 80, 82, 40, 84, 30, 83, 82],
    }).length === 0,
  },
  {
    name: '7/7 below usual → form-softening fires',
    run: () => computeAlerts({
      who5: [60, 64, 62, 58, 61, 60, 63, 40, 42, 38, 41, 39, 43, 44],
    }).some((a) => a.id === 'form-softening'),
  },
  {
    name: 'flat week (every check-in equals the median) → silent, ties claim nothing',
    run: () => computeAlerts({
      who5: [60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60],
    }).length === 0,
  },
  {
    name: 'ties + a few above → still silent (ties never count toward lifting)',
    run: () => computeAlerts({
      who5: [60, 60, 60, 60, 60, 60, 60, 60, 60, 80, 82, 60, 60, 81],
    }).length === 0,
  },
  {
    name: 'too few check-ins (<10) → silent',
    run: () => computeAlerts({ who5: [60, 61, 80, 82, 81, 84, 80, 83, 82] }).length === 0,
  },
  {
    name: 'screen-high default off → no screen alert without the flag',
    run: () => computeAlerts({ who5: [] }).every((a) => a.kind !== 'screen-high'),
  },
  {
    name: 'screen-high fires once, date-scoped id, when today crossed 2.5h',
    run: () => {
      const a = computeAlerts({ screenHigh: true, today: '2026-06-17' })
        .find((x) => x.kind === 'screen-high');
      return a && a.id === 'screen-high:2026-06-17';
    },
  },
  {
    name: 'screen-high needs a day key (no id collision / no fire without a date)',
    run: () => computeAlerts({ screenHigh: true, today: null })
      .every((a) => a.kind !== 'screen-high'),
  },
  {
    name: 'screen-high source is plain + names on-device (no minutes, no jargon)',
    run: () => {
      const a = computeAlerts({ screenHigh: true, today: '2026-06-17' })
        .find((x) => x.kind === 'screen-high');
      return a && /screen time/i.test(a.source) && /your phone/i.test(a.source)
        && !/\d+\s*min|minutes|Wilson|95%/i.test(a.source);
    },
  },
  {
    // The alert must carry an honest provenance line, but in PLAIN language —
    // the Wilson/WHO-5 machinery is documented in the source, never shown to users.
    name: 'alert source is present and plain (no instrument jargon leaked to users)',
    run: () => {
      const s = computeAlerts({ partDays: { planner: 14 }, writingDays: 14 })[0].source;
      return typeof s === 'string' && s.length > 0
        && !/Wilson|WHO-5|median|95%|lower bound/i.test(s);
    },
  },
  {
    // …and the statistical gate it rests on stays documented internally, so the
    // honesty audit can keep pinning it even though users never see the term.
    name: 'Wilson methodology stays documented in the source (internal comment)',
    run: () => INBOX_SRC.includes('Wilson 95%'),
  },
];

let pass = 0;
const failures = [];
for (const c of CASES) {
  let ok = false;
  try { ok = c.run(); } catch (e) { ok = false; console.log(`      threw: ${e.message}`); }
  if (ok) { pass++; console.log(`  ✓ ${c.name}`); }
  else { failures.push(c.name); console.log(`  × ${c.name}`); }
}

console.log(`\nInbox alerts eval — ${pass}/${CASES.length} cases passing`);
if (failures.length) {
  console.error(`FAIL — ${failures.join(', ')}`);
  process.exit(1);
}
console.log('PASS — alerts fire only when the interval clears the line.');
