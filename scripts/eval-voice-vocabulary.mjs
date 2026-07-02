#!/usr/bin/env node
// Eval — per-user voice vocabulary (Deepgram keyterm prompting).
//
// Keyterms are sent to Deepgram to boost recognition, so the builder must be
// disciplined: surface the user's RECURRING names, never sentence-initial
// grammar capitals or common words, stay well under the term cap, and encode
// safely into the listen URL. Offline + deterministic.
// Run: node scripts/eval-voice-vocabulary.mjs (exit 1 on fail).

import { buildKeyterms, withKeyterms, MAX_KEYTERMS } from '../src/voiceVocabulary.js';

const eqArr = (a, b) => Array.isArray(a) && Array.isArray(b)
  && a.length === b.length && a.every((v, i) => v === b[i]);

const E = (t) => ({ transcription: t });

const CASES = [
  {
    name: 'recurring name (≥2, mid-sentence) becomes a keyterm',
    run: () => eqArr(
      buildKeyterms([E('Lunch with Maya today'), E('Called Maya back')]),
      ['Maya'],
    ),
  },
  {
    name: 'a one-off name is NOT a keyterm (needs to recur)',
    run: () => eqArr(buildKeyterms([E('Met Devesh once')]), []),
  },
  {
    name: 'sentence-initial capital (grammar, not a name) is excluded',
    run: () => eqArr(buildKeyterms([E('Today was hard'), E('Today I rested')]), []),
  },
  {
    name: 'common capitalised stop-words never leak in',
    run: () => eqArr(buildKeyterms([E('And then I left'), E('And so it went'), E('But I stayed')]), []),
  },
  {
    name: 'lowercase everyday words are ignored; only proper nouns count',
    run: () => eqArr(buildKeyterms([E('the meeting ran long'), E('the meeting helped')]), []),
  },
  {
    name: 'most-frequent-first ordering, then alphabetical tie-break',
    run: () => {
      // Names kept mid-sentence (a filler word at index 0) so the sentence-
      // initial skip doesn't eat them. Maya 3, Devi 3 → tie → alphabetical.
      const out = buildKeyterms([
        E('x Maya y Devi'), E('x Maya'), E('x Maya z Devi'), E('x Devi'),
      ]);
      return eqArr(out, ['Devi', 'Maya']);
    },
  },
  {
    name: 'respects the max cap',
    run: () => {
      const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'];
      const entries = [];
      for (const n of names) { entries.push(E(`x ${n}`)); entries.push(E(`y ${n}`)); }
      return buildKeyterms(entries, { max: 5 }).length === 5 && MAX_KEYTERMS === 40;
    },
  },
  {
    name: 'defensive: junk / empty input → []',
    run: () => eqArr(buildKeyterms(null), []) && eqArr(buildKeyterms([null, {}, { transcription: '' }]), []),
  },
  {
    name: 'reads rawText when transcription is absent',
    run: () => eqArr(buildKeyterms([{ rawText: 'hi Priya' }, { rawText: 'bye Priya' }]), ['Priya']),
  },
  {
    name: 'withKeyterms appends encoded keyterm params, leaves base intact',
    run: () => {
      const url = withKeyterms('wss://x/listen?model=nova-3', ['Maya', 'San José']);
      return url === 'wss://x/listen?model=nova-3&keyterm=Maya&keyterm=San%20Jos%C3%A9';
    },
  },
  {
    name: 'withKeyterms with no terms returns the base URL unchanged',
    run: () => withKeyterms('wss://x/listen?model=nova-3', []) === 'wss://x/listen?model=nova-3'
      && withKeyterms('wss://x/listen?model=nova-3', null) === 'wss://x/listen?model=nova-3',
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

console.log(`\nVoice vocabulary eval — ${pass}/${CASES.length} cases passing`);
if (failures.length) {
  console.error(`FAIL — ${failures.join(', ')}`);
  process.exit(1);
}
console.log('PASS — recurring names become keyterms; grammar capitals and stop-words never do.');
