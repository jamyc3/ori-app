#!/usr/bin/env node
// Eval — voice transcription confidence (the "did Ori hear that right?" layer).
//
// The flag drives an EDIT affordance that can change the user's journal, so the
// core has to be exact: it must surface only the words Deepgram was unsure of,
// it must NEVER drop or alter a character of what was said (the join invariant),
// and it must degrade to "no flags" on any junk shape rather than throw (a
// Deepgram schema change must not break capture). Offline + deterministic.
// Run: node scripts/eval-voice-confidence.mjs (exit 1 on fail).

import {
  LOW_CONF, normalizeWord, collectLowConf, mergeLowConf, lowConfSet, tokenizeWithFlags,
} from '../src/voiceConfidence.js';

const eqArr = (a, b) => Array.isArray(a) && Array.isArray(b)
  && a.length === b.length && a.every((v, i) => JSON.stringify(v) === JSON.stringify(b[i]));

const CASES = [
  {
    name: 'normalizeWord strips surrounding punctuation + lowercases',
    run: () => normalizeWord('Seen.') === 'seen'
      && normalizeWord('(mean)') === 'mean'
      && normalizeWord('don’t') === 'don’t'.toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, ''),
  },
  {
    name: 'collectLowConf keeps only words below the threshold, deduped',
    run: () => eqArr(
      collectLowConf([
        { word: 'I', confidence: 0.99 },
        { word: 'felt', confidence: 0.98 },
        { word: 'seen', confidence: 0.42 },
      ]),
      [{ w: 'seen', c: 0.42 }],
    ),
  },
  {
    name: 'collectLowConf prefers punctuated_word and keeps the LOWEST conf for a repeat',
    run: () => eqArr(
      collectLowConf([
        { word: 'her', punctuated_word: 'her,', confidence: 0.5 },
        { word: 'her', punctuated_word: 'her.', confidence: 0.3 },
      ]),
      [{ w: 'her', c: 0.3 }],
    ),
  },
  {
    name: 'collectLowConf is defensive: junk / missing words → [] (never throws)',
    run: () => eqArr(collectLowConf(null), [])
      && eqArr(collectLowConf(undefined), [])
      && eqArr(collectLowConf('nope'), [])
      && eqArr(collectLowConf([null, { word: 'x' }, { confidence: 0.1 }]), []),
  },
  {
    name: 'threshold boundary: exactly LOW_CONF is NOT flagged (only strictly below)',
    run: () => eqArr(collectLowConf([{ word: 'edge', confidence: LOW_CONF }]), []),
  },
  {
    name: 'mergeLowConf accumulates across chunks, keeping the lowest per word',
    run: () => eqArr(
      mergeLowConf([{ w: 'seen', c: 0.5 }], [{ w: 'seen', c: 0.3 }, { w: 'walk', c: 0.4 }]),
      [{ w: 'seen', c: 0.3 }, { w: 'walk', c: 0.4 }],
    ),
  },
  {
    name: 'mergeLowConf tolerates null acc / batch',
    run: () => eqArr(mergeLowConf(null, null), [])
      && eqArr(mergeLowConf(null, [{ w: 'a', c: 0.1 }]), [{ w: 'a', c: 0.1 }]),
  },
  {
    name: 'tokenizeWithFlags flags the misheard word and nothing else',
    run: () => {
      const toks = tokenizeWithFlags('I felt seen today', [{ w: 'seen', c: 0.4 }]);
      const flagged = toks.filter((t) => t.flagged).map((t) => t.text);
      return eqArr(flagged, ['seen']);
    },
  },
  {
    name: 'tokenizeWithFlags matches across case + trailing punctuation',
    run: () => {
      const toks = tokenizeWithFlags('Was I Seen?', [{ w: 'seen', c: 0.4 }]);
      return toks.some((t) => t.flagged && t.text === 'Seen?');
    },
  },
  {
    name: 'JOIN INVARIANT: tokens always reconstruct the original text exactly',
    run: () => {
      const inputs = [
        'I felt seen today',
        '  spaced   out  words ',
        'newlines\nand\ttabs kept',
        'punctuation, intact! right?',
        '',
      ];
      return inputs.every((s) => tokenizeWithFlags(s, [{ w: 'seen', c: 0.4 }]).map((t) => t.text).join('') === s);
    },
  },
  {
    name: 'no low-conf words → one unflagged token (cheap path, text intact)',
    run: () => {
      const toks = tokenizeWithFlags('a clean entry', []);
      return toks.length === 1 && toks[0].flagged === false && toks[0].text === 'a clean entry';
    },
  },
  {
    name: 'whitespace tokens are never flagged',
    run: () => tokenizeWithFlags('seen   seen', [{ w: 'seen', c: 0.4 }])
      .filter((t) => /^\s+$/.test(t.text)).every((t) => t.flagged === false),
  },
  {
    name: 'lowConfSet normalizes its members',
    run: () => {
      const s = lowConfSet([{ w: 'Seen.' }, { w: 'WALK' }]);
      return s.has('seen') && s.has('walk');
    },
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

console.log(`\nVoice confidence eval — ${pass}/${CASES.length} cases passing`);
if (failures.length) {
  console.error(`FAIL — ${failures.join(', ')}`);
  process.exit(1);
}
console.log('PASS — flags only the unsure words, never drops a character.');
