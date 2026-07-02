#!/usr/bin/env node
// Eval — v2 acknowledgment guardrail + calibration set (Phase 3).
//
// Two suites, both offline and deterministic (no API calls):
//
//  A. CONTRACT — feeds fixture *model outputs* to validateAcknowledgment and
//     pins the guardrail's behavior: engaged→validated, clinical language
//     stripped from anything user-facing, malformed input fails safe, the
//     person is never blocked. This is the runtime contract; mirrors
//     scripts/eval-letter-v2.mjs.
//
//  B. CALIBRATION — structurally validates scripts/acknowledgment-fixtures.mjs
//     (the definition of "genuine acknowledgment"). The fixtures' *judgments*
//     are exercised against the live model in Step 2; here we only guarantee
//     the set is well-formed so that step has a clean contract to run against.
//
// Run: node scripts/eval-acknowledgment.mjs   (exits 1 on any failure)

import {
  validateAcknowledgment, STANCES, MAX_MIRROR_LEN, scanDistress,
} from '../src/v2/acknowledgmentGate.js';
import {
  judgeAcknowledgment, buildAcknowledgmentRequest, parseAcknowledgmentResponse,
  hasReflectionConsent, grantReflectionConsent, revokeReflectionConsent, ACK_TOOL_NAME,
} from '../src/v2/acknowledgmentEngine.js';
import { CALIBRATION, STANCE_VALUES, PROBE_CALIBRATION } from './acknowledgment-fixtures.mjs';

// Minimal localStorage shim for Node so the consent gate is testable. Assigned
// unconditionally (matching part-history.test.js) so Node's own experimental
// localStorage is never touched — that keeps the build output warning-free.
const _ackStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (_ackStore.has(k) ? _ackStore.get(k) : null),
  setItem: (k, v) => _ackStore.set(k, String(v)),
  removeItem: (k) => _ackStore.delete(k),
  clear: () => _ackStore.clear(),
};

// ── harness ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name); console.log('    ' + (e.message || e)); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
async function atest(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name); console.log('    ' + (e.message || e)); failed++; }
}

// ── A. CONTRACT — the guardrail around the model's judgment ───────────────
console.log('Acknowledgment guardrail — contract');

const CONTRACT = [
  {
    name: 'engaged + clean mirror → validated, stance kept, mirror kept',
    out: { engaged: true, stance: 'toward', reflectBack: 'You met the watcher with some warmth.' },
    expect: (r) => r.validated === true && r.stance === 'toward'
      && r.reflectBack === 'You met the watcher with some warmth.' && r.problems.length === 0,
  },
  {
    name: 'flooded reflection still lands (blended)',
    out: { engaged: true, stance: 'blended', reflectBack: 'It had you flooded — turning toward it still counts.' },
    expect: (r) => r.validated === true && r.stance === 'blended' && r.reflectBack !== null,
  },
  {
    name: 'pushing-away still lands (away)',
    out: { engaged: true, stance: 'away', reflectBack: 'The frustration is loud right now.' },
    expect: (r) => r.validated === true && r.stance === 'away',
  },
  {
    name: 'not engaged → not validated, stance null, gentle invite preserved',
    out: { engaged: false, inviteDeeper: 'Want to say how the watcher shows up for you?' },
    expect: (r) => r.validated === false && r.stance === null
      && r.reflectBack === null && r.inviteDeeper === 'Want to say how the watcher shows up for you?',
  },
  {
    name: 'clinical language in mirror is DROPPED, but it still lands',
    out: { engaged: true, stance: 'toward', reflectBack: 'This sounds like depression you should treat.' },
    expect: (r) => r.validated === true && r.reflectBack === null
      && r.problems.some((p) => p.includes('reflectBack clinical')),
  },
  {
    name: 'clinical language in invite is DROPPED',
    out: { engaged: false, inviteDeeper: 'That is the therapy you need.' },
    expect: (r) => r.inviteDeeper === null && r.problems.some((p) => p.includes('inviteDeeper clinical')),
  },
  {
    name: 'null model output fails safe (no throw, not validated)',
    out: null,
    expect: (r) => r.validated === false && r.reflectBack === null
      && r.problems.some((p) => p.includes('no model output')),
  },
  {
    name: 'empty object → not validated, all null, no throw',
    out: {},
    expect: (r) => r.validated === false && r.stance === null && r.reflectBack === null,
  },
  {
    name: 'engaged must be strict boolean (string "yes" is not true)',
    out: { engaged: 'yes', stance: 'toward' },
    expect: (r) => r.validated === false,
  },
  {
    name: 'invalid stance on an engaged result defaults to toward + notes it',
    out: { engaged: true, stance: 'sideways', reflectBack: 'ok' },
    expect: (r) => r.validated === true && r.stance === 'toward'
      && r.problems.some((p) => p.includes('stance')),
  },
  {
    name: 'over-long mirror is truncated to the bound',
    out: { engaged: true, stance: 'toward', reflectBack: 'x'.repeat(MAX_MIRROR_LEN + 60) },
    expect: (r) => r.reflectBack !== null && r.reflectBack.length <= MAX_MIRROR_LEN,
  },
  {
    name: 'partId echoes the part passed in',
    out: { engaged: true, stance: 'toward', reflectBack: 'ok' },
    opts: { part: { id: 'watcher' } },
    expect: (r) => r.partId === 'watcher',
  },
  {
    name: 'a non-question invite is flagged (a friend asks, not tells)',
    out: { engaged: false, inviteDeeper: 'Say more about it.' },
    expect: (r) => r.inviteDeeper === 'Say more about it.'
      && r.problems.some((p) => p.includes('not a question')),
  },
  {
    name: 'a forced concern suppresses mirror/probe and never validates',
    out: { engaged: true, stance: 'toward', reflectBack: 'nice', inviteDeeper: 'what?' },
    opts: { concern: true },
    expect: (r) => r.concern === true && r.validated === false
      && r.reflectBack === null && r.inviteDeeper === null && r.stance === null,
  },
  {
    name: 'a model-flagged concern routes to support, not a routine acknowledgment',
    out: { engaged: true, stance: 'toward', reflectBack: 'nice', concern: true },
    expect: (r) => r.concern === true && r.validated === false && r.reflectBack === null,
  },
];

for (const c of CONTRACT) {
  test(c.name, () => {
    const r = validateAcknowledgment(c.out, c.opts || {});
    assert(c.expect(r), 'unexpected: ' + JSON.stringify(r));
  });
}

// ── B. CALIBRATION — the set is well-formed for Step 2 ────────────────────
console.log('\nAcknowledgment calibration — fixtures well-formed');

test('calibration set is non-empty', () => {
  assert(Array.isArray(CALIBRATION) && CALIBRATION.length >= 12,
    `expected >= 12 fixtures, got ${CALIBRATION?.length}`);
});

test('every fixture has id/part/reflection and a boolean engaged', () => {
  for (const f of CALIBRATION) {
    assert(typeof f.id === 'string' && f.id, `bad id: ${JSON.stringify(f)}`);
    assert(typeof f.part === 'string' && f.part, `bad part in ${f.id}`);
    assert(typeof f.reflection === 'string', `bad reflection in ${f.id}`);
    assert(f.expected && typeof f.expected.engaged === 'boolean', `bad expected.engaged in ${f.id}`);
  }
});

test('stance is a valid enum when engaged, and null when not', () => {
  for (const f of CALIBRATION) {
    if (f.expected.engaged) {
      assert(STANCE_VALUES.includes(f.expected.stance), `engaged fixture ${f.id} needs a valid stance`);
    } else {
      assert(f.expected.stance === null, `non-engaged fixture ${f.id} must have stance null`);
    }
  }
});

test('fixture ids are unique', () => {
  const ids = CALIBRATION.map((f) => f.id);
  assert(new Set(ids).size === ids.length, 'duplicate fixture id');
});

test('the calibration set covers both lands and gentle-invite outcomes', () => {
  assert(CALIBRATION.some((f) => f.expected.engaged), 'no engaged fixtures');
  assert(CALIBRATION.some((f) => !f.expected.engaged), 'no non-engaged fixtures');
});

test('it includes the crux: a flooded/blended reflection that still lands', () => {
  assert(CALIBRATION.some((f) => f.expected.engaged && f.expected.stance === 'blended'),
    'missing a blended-but-engaged case — the witness-not-judge crux');
});

test('guardrail enum matches the fixtures enum', () => {
  assert(STANCES.length === STANCE_VALUES.length && STANCES.every((s) => STANCE_VALUES.includes(s)),
    'STANCES (gate) and STANCE_VALUES (fixtures) drifted');
});

test('probe calibration set exists, labeled good/bad, covers both', () => {
  assert(Array.isArray(PROBE_CALIBRATION) && PROBE_CALIBRATION.length >= 4,
    `expected >= 4 probe fixtures, got ${PROBE_CALIBRATION?.length}`);
  for (const p of PROBE_CALIBRATION) {
    assert(typeof p.probe === 'string' && p.probe, `bad probe in ${p.id}`);
    assert(typeof p.good === 'boolean', `probe ${p.id} needs good:boolean`);
  }
  assert(PROBE_CALIBRATION.some((p) => p.good) && PROBE_CALIBRATION.some((p) => !p.good),
    'need both good and bad probe exemplars');
});

// ── C. ENGINE — request build, parse, orchestration (stubbed model) ───────
console.log('\nAcknowledgment engine — request / parse / orchestration');

test('buildAcknowledgmentRequest carries the model, tool, and the reflection', () => {
  const body = buildAcknowledgmentRequest('I see you, watcher.', { id: 'watcher', name: 'the watcher', desc: 'Reads the room.' });
  assert(body.model && body.tool_choice?.name === ACK_TOOL_NAME, 'wrong model/tool_choice');
  assert(body.tools?.[0]?.input_schema?.required?.includes('engaged'), 'engaged not required');
  const content = body.messages?.[0]?.content || '';
  assert(content.includes('I see you, watcher.') && content.includes('the watcher'), 'reflection/part missing from message');
});

test('parseAcknowledgmentResponse extracts the tool_use input', () => {
  const data = { content: [{ type: 'tool_use', name: ACK_TOOL_NAME, input: { engaged: true, stance: 'toward' } }] };
  const raw = parseAcknowledgmentResponse(data);
  assert(raw && raw.engaged === true && raw.stance === 'toward', 'did not extract input');
});

test('parseAcknowledgmentResponse returns null when no tool_use', () => {
  assert(parseAcknowledgmentResponse({ content: [{ type: 'text', text: 'hi' }] }) === null, 'should be null');
});

await atest('judge: no consent → needsConsent, model never called', async () => {
  let called = 0;
  const r = await judgeAcknowledgment('I see you, watcher.', { id: 'watcher' },
    { consent: false, call: async () => { called++; return {}; } });
  assert(r.needsConsent === true, 'should ask for consent');
  assert(called === 0, 'must not call the model without consent');
});

await atest('judge: empty reflection never calls the model, not validated', async () => {
  let called = 0;
  const r = await judgeAcknowledgment('   ', { id: 'watcher' },
    { consent: true, call: async () => { called++; return {}; } });
  assert(called === 0, 'must not call the model on empty input');
  assert(r.validated === false, 'empty is not validated');
});

await atest('judge: a good model judgment flows through the gate', async () => {
  const stub = async () => ({ content: [{ type: 'tool_use', name: ACK_TOOL_NAME,
    input: { engaged: true, stance: 'toward', reflectBack: 'You met it with warmth.' } }] });
  const r = await judgeAcknowledgment('I see you, watcher.', { id: 'watcher' }, { consent: true, call: stub });
  assert(r.validated === true && r.stance === 'toward' && r.reflectBack === 'You met it with warmth.',
    'gate did not pass it through: ' + JSON.stringify(r));
});

await atest('judge: clinical language from the model is stripped, still lands', async () => {
  const stub = async () => ({ content: [{ type: 'tool_use', name: ACK_TOOL_NAME,
    input: { engaged: true, stance: 'toward', reflectBack: 'This is your depression.' } }] });
  const r = await judgeAcknowledgment('...', { id: 'watcher' }, { consent: true, call: stub });
  assert(r.validated === true && r.reflectBack === null, 'clinical mirror should be dropped but still land');
});

await atest('judge: a transport failure fails safe (not validated, no throw)', async () => {
  const boom = async () => { throw new Error('proxy down'); };
  const r = await judgeAcknowledgment('I see you, watcher.', { id: 'watcher' }, { consent: true, call: boom });
  assert(r.validated === false, 'failure must fail safe to not-validated');
});

test('consent store: grant → has → revoke', () => {
  revokeReflectionConsent();
  assert(hasReflectionConsent() === false, 'should start without consent');
  grantReflectionConsent();
  assert(hasReflectionConsent() === true, 'grant should stick');
  revokeReflectionConsent();
  assert(hasReflectionConsent() === false, 'revoke should clear');
});

// ── D. SAFETY — distress backstop + off-ramp ──────────────────────────────
console.log('\nAcknowledgment safety — distress off-ramp');

test('scanDistress catches explicit risk phrases', () => {
  assert(scanDistress("everyone would be better off if i wasn't here anymore"), 'missed a risk phrase');
  assert(scanDistress('honestly i just want to die'), 'missed a risk phrase');
});
test('scanDistress does not fire on a benign reflection', () => {
  assert(!scanDistress('the planner held my day together and i noticed'), 'false positive');
});
test('scanDistress catches the expanded explicit variants/evasions', () => {
  for (const p of [
    'i just want to unalive myself',
    'honestly i wish i was dead',
    "i don't want to live anymore",
    'there is nothing to live for',
    'i thought about taking my own life',
    "i've been thinking i should just end myself",
  ]) assert(scanDistress(p), `missed expanded risk phrase: ${p}`);
});
test('scanDistress does NOT over-route collision-prone benign text', () => {
  // These contain substrings of rejected lexicon candidates — must stay clean,
  // or ordinary writing routes to a crisis card.
  for (const b of [
    'i ran 5 kms this morning and felt great',
    'cutting myself some slack today, that counts',
    'i cut myself shaving, minor annoyance',
    'i think i overdose on caffeine most mornings',
    'i was dead tired but pushed through',
  ]) assert(!scanDistress(b), `over-routed benign text: ${b}`);
});

await atest('judge: explicit risk language → concern, model NEVER called', async () => {
  let called = 0;
  const r = await judgeAcknowledgment("honestly everyone would be better off without me",
    { id: 'tender' }, { consent: true, call: async () => { called++; return {}; } });
  assert(called === 0, 'must not call the model on a distress signal');
  assert(r.concern === true && r.validated === false, 'must route to support, not validate');
  assert(r.reflectBack === null && r.inviteDeeper === null, 'must not surface any mirror/probe');
});

await atest('judge: model-flagged concern (nuanced) is suppressed and routed', async () => {
  const stub = async () => ({ content: [{ type: 'tool_use', name: ACK_TOOL_NAME,
    input: { engaged: true, stance: 'blended', reflectBack: 'heavy', inviteDeeper: 'where?', concern: true } }] });
  const r = await judgeAcknowledgment('a subtle one the lexicon misses', { id: 'tender' }, { consent: true, call: stub });
  assert(r.concern === true && r.validated === false && r.reflectBack === null, 'model concern must suppress + route');
});

// ── report ────────────────────────────────────────────────────────────────
console.log(`\n  ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
