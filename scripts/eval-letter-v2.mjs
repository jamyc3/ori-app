#!/usr/bin/env node
// Eval — v2 letter quality gate.
//
// The gate (src/v2/letterGate.js) is the runtime contract between the
// LLM and the user: shape must be readable, language must stay off
// clinical/diagnostic territory, part references must resolve. This
// suite pins that contract with fixtures so a lexicon edit or a shape
// change can't silently weaken it. Offline and deterministic — no API
// calls. Run: node scripts/eval-letter-v2.mjs (exits 1 on any failure).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateLetter, CLINICAL_LEXICON } from '../src/v2/letterGate.js';

const KNOWN_PARTS = ['fire', 'protect', 'self', 'planner', 'watcher'];

function sourceOf(rel) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

function letterOf(overrides = {}) {
  return {
    letter: {
      headline: 'A steady day, carried well.',
      paragraphs: [
        'You wrote about the long afternoon and the walk that broke it open.',
        'The evening settled — your words got shorter and warmer at the same time.',
      ],
      parts: [{ id: 'planner', volume: 'present' }],
      ...overrides,
    },
  };
}

const CASES = [
  {
    name: 'well-formed letter passes',
    input: letterOf(),
    expect: (r) => r.ok === true,
  },
  {
    name: 'missing letter object fails',
    input: { insights: [] },
    expect: (r) => r.ok === false && r.problems.includes('letter missing'),
  },
  {
    name: 'empty headline fails',
    input: letterOf({ headline: '   ' }),
    expect: (r) => r.ok === false && r.problems.some((p) => p.includes('headline')),
  },
  {
    name: 'no paragraphs fails',
    input: letterOf({ paragraphs: [] }),
    expect: (r) => r.ok === false && r.problems.some((p) => p.includes('paragraphs')),
  },
  {
    name: 'whitespace-only paragraphs fail',
    input: letterOf({ paragraphs: ['  ', ''] }),
    expect: (r) => r.ok === false && r.problems.some((p) => p.includes('paragraphs')),
  },
  {
    name: 'diagnosis claim fails (you have ADHD)',
    input: letterOf({ paragraphs: ['The scattered afternoon suggests you have ADHD.'] }),
    expect: (r) => r.ok === false && r.problems.some((p) => p.includes('clinical')),
  },
  {
    name: 'clinical label fails (burnout)',
    input: letterOf({ headline: 'Burnout is setting in.' }),
    expect: (r) => r.ok === false && r.problems.some((p) => p.includes('clinical')),
  },
  {
    name: 'prescriptive language fails (medication)',
    input: letterOf({ paragraphs: ['Consider whether your medication needs adjusting.'] }),
    expect: (r) => r.ok === false && r.problems.some((p) => p.includes('clinical')),
  },
  {
    name: 'everyday heaviness passes (not pathologized)',
    input: letterOf({ paragraphs: ['A heavy day. The afternoon felt anxious and slow, and you still finished what mattered.'] }),
    expect: (r) => r.ok === true,
  },
  {
    name: 'unknown part ids are dropped, not fatal',
    input: letterOf({ parts: [{ id: 'planner' }, { id: 'gremlin-9000' }] }),
    expect: (r) => r.ok === true
      && r.letter.parts.length === 1
      && r.letter.parts[0].id === 'planner',
  },
  {
    name: 'parts survive untouched without knownPartIds',
    input: letterOf({ parts: [{ id: 'anything' }] }),
    opts: {},
    expect: (r) => r.ok === true && r.letter.parts.length === 1,
  },
  {
    name: 'sanitized paragraphs strip blanks but keep prose',
    input: letterOf({ paragraphs: ['Real words.', '   ', 'More real words.'] }),
    expect: (r) => r.ok === true && r.letter.paragraphs.length === 2,
  },
  // ── Auxiliary-channel scrub: insights + part notes must never carry
  //    clinical/citation language to the user (the gate used to scan only
  //    headline+paragraphs, so a cited insight reached the reader). ────────
  {
    name: 'insight with researcher citation is dropped, clean one kept',
    input: { ...letterOf(), insights: [
      { title: 'Trajectory', body: 'This matches Lim & Dinges (2010) on impaired performance.' },
      { title: 'Reframe', body: 'The skips are not laziness — a depleted system shedding non-essentials.' },
    ] },
    expect: (r) => r.ok === true && r.insights.length === 1 && /not laziness/.test(r.insights[0].body),
  },
  {
    name: 'insight with clinical register (allostatic) is dropped',
    input: { ...letterOf(), insights: [{ title: 'Pattern', body: 'A sustained allostatic load signature.' }] },
    expect: (r) => r.ok === true && r.insights.length === 0,
  },
  {
    name: 'insight citing a surname+year is dropped',
    input: { ...letterOf(), insights: [{ title: 'Pattern', body: 'Per McEwen, 1998, the stress response compounds.' }] },
    expect: (r) => r.ok === true && r.insights.length === 0,
  },
  {
    name: 'insight naming a theory (no year) is dropped',
    input: { ...letterOf(), insights: [{ title: 'Reframe', body: "This is Fredrickson's broaden-and-build theory in action." }] },
    expect: (r) => r.ok === true && r.insights.length === 0,
  },
  {
    name: 'insight appealing to "research shows" is dropped',
    input: { ...letterOf(), insights: [{ title: 'Pattern', body: 'Research shows short sleep impairs recovery.' }] },
    expect: (r) => r.ok === true && r.insights.length === 0,
  },
  {
    name: 'clean insight passes through untouched',
    input: { ...letterOf(), insights: [{ title: 'Reframe', body: 'Small thing, big difference is data, not modesty.' }] },
    expect: (r) => r.ok === true && r.insights.length === 1,
  },
  {
    name: 'clinical part-note is stripped, part still renders',
    input: letterOf({ parts: [{ id: 'planner', volume: 'present', note: 'The prefrontal load is elevated (McEwen, 1998).' }] }),
    expect: (r) => r.ok === true && r.letter.parts.length === 1 && r.letter.parts[0].note === '',
  },
  {
    name: 'benign part-note survives the scrub',
    input: letterOf({ parts: [{ id: 'planner', volume: 'present', note: 'Held the shape of the day so it would not fall apart.' }] }),
    expect: (r) => r.ok === true && r.letter.parts[0].note === 'Held the shape of the day so it would not fall apart.',
  },
  {
    name: 'physiological register in PROSE hard-fails (prefrontal)',
    input: letterOf({ paragraphs: ['The afternoon mirrors the prefrontal cost of a short night.'] }),
    expect: (r) => r.ok === false && r.problems.some((p) => p.includes('clinical')),
  },
  {
    name: 'a year alone in friendly prose does NOT hard-fail',
    input: letterOf({ paragraphs: ['You took the long way home, the way you used to back in 2019.'] }),
    expect: (r) => r.ok === true,
  },
];

let pass = 0;
const failures = [];
for (const c of CASES) {
  const opts = 'opts' in c ? c.opts : { knownPartIds: KNOWN_PARTS };
  const result = validateLetter(c.input, opts);
  if (c.expect(result)) {
    pass++;
    console.log(`  ✓ ${c.name}`);
  } else {
    failures.push(c.name);
    console.log(`  × ${c.name}`);
    console.log(`      got ok=${result.ok} problems=[${result.problems.join(' | ')}]`);
  }
}

// Lexicon sanity: every term lowercase (scan() lowercases input only).
for (const term of CLINICAL_LEXICON) {
  if (term !== term.toLowerCase()) {
    failures.push(`lexicon term not lowercase: ${term}`);
    console.log(`  × lexicon term not lowercase: ${term}`);
  }
}

// ── Id-space lock ────────────────────────────────────────────────
// letterEngine builds the gate's allowlist from Object.keys(PARTS_LIB).
// That is correct only while PARTS_LIB keys ≡ part ids — true by
// construction today (driver parts are re-keyed by p.id; each SELF_PARTS
// key equals its .id) — AND while the engine's own hardcoded letter-part
// allowlist names the same ids. Both invariants are asserted here against
// the actual source, so any drift fails the build instead of silently
// stripping parts from letters.
// The parts library was extracted to parts-lib.js (LetterReading.jsx now
// re-exports it); parse it at its source of truth.
const lrSource = sourceOf('../src/parts-lib.js');
const partsRegion = lrSource.slice(
  lrSource.indexOf('export const DRIVER_TO_PART'),
  lrSource.indexOf('export const PARTS_LIB'),
);
const libIds = [...partsRegion.matchAll(/\bid:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]).sort();

// SELF_PARTS keys must equal their own .id (driver parts are keyed by
// .id mechanically, so only the hand-keyed block can drift).
const selfRegion = partsRegion.slice(partsRegion.indexOf('export const SELF_PARTS'));
for (const m of selfRegion.matchAll(/^\s{2}(\w+):\s*\{\s*\n?\s*id:\s*"([a-z0-9-]+)"/gm)) {
  if (m[1] !== m[2]) {
    failures.push(`SELF_PARTS key/id mismatch: ${m[1]} vs ${m[2]}`);
    console.log(`  × SELF_PARTS key "${m[1]}" ≠ id "${m[2]}" — Object.keys(PARTS_LIB) is no longer the id space`);
  }
}

const engineSource = sourceOf('../src/engine.js');
const engineAllowMatch = engineSource.match(/allowedIds = new Set\(\[([^\]]+)\]\)/);
const engineAllowIds = engineAllowMatch
  ? [...engineAllowMatch[1].matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]).sort()
  : [];
if (!engineAllowIds.length) {
  failures.push('engine allowedIds set not found — id-space lock cannot verify');
  console.log('  × engine allowedIds set not found');
} else if (JSON.stringify(engineAllowIds) !== JSON.stringify(libIds)) {
  failures.push('id-space drift between engine allowlist and PARTS_LIB');
  console.log(`  × id-space drift:\n      engine:    ${engineAllowIds.join(', ')}\n      PARTS_LIB: ${libIds.join(', ')}`);
} else {
  console.log(`  ✓ id-space lock — engine allowlist ≡ PARTS_LIB ids (${libIds.length} ids)`);
}

console.log(`\nLetter gate eval — ${pass}/${CASES.length} cases passing`);
if (failures.length) {
  console.error(`FAIL — ${failures.length} failing: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('PASS — the gate holds the shape and the language line.');
