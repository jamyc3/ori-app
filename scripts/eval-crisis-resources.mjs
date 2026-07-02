#!/usr/bin/env node
// Eval — localized crisis resources (Phase 3). Offline/deterministic.
// Verifies the safety-critical behavior: the universal directory is ALWAYS
// present, an unknown country never blanks the card, and a bad remote refresh
// can never degrade the bundled floor. Run: node scripts/eval-crisis-resources.mjs

const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => _store.set(k, String(v)),
  removeItem: (k) => _store.delete(k),
  clear: () => _store.clear(),
};

const {
  resourcesForUser, detectCountry, loadDb, refreshCrisisResources,
  BUNDLED_RESOURCES, UNIVERSAL, FIND_A_HELPLINE, CRISIS_DB_VERSION,
  VOUCH_LOCALIZED_LINES,
} = await import('../src/v2/crisisResources.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name); console.log('    ' + (e.message || e)); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
const atest = async (name, fn) => { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.log('  ✗ ' + name); console.log('    ' + (e.message || e)); failed++; } };

console.log('Crisis resources');

test('Option A: with vouching OFF, no specific lines render — only the universal floor', () => {
  // The launch posture (VOUCH_LOCALIZED_LINES=false): we do not put our name
  // behind any single number; everyone routes to findahelpline + emergency.
  const r = resourcesForUser('US');
  if (VOUCH_LOCALIZED_LINES) {
    assert(r.country === 'US' && r.lines.length >= 1, 'US lines missing');
    assert(r.lines.some((l) => l.tel === '988'), '988 missing');
  } else {
    assert(r.lines.length === 0, 'vouching OFF must render no specific country lines');
  }
  assert(r.universal.directoryUrl === FIND_A_HELPLINE, 'universal directory missing');
  assert(typeof r.universal.emergency === 'string' && r.universal.emergency, 'must always name emergency');
});

test('an UNKNOWN country never blanks the card — universal always present', () => {
  const r = resourcesForUser('ZZ');
  assert(r.lines.length === 0, 'unknown should have no country lines');
  assert(r.universal.directoryUrl === FIND_A_HELPLINE, 'must still offer findahelpline');
  assert(typeof r.universal.emergency === 'string' && r.universal.emergency, 'must still name emergency');
});

test('country code still normalizes (resolved for copy even when lines are withheld)', () => {
  assert(resourcesForUser('gb').country === 'GB', 'gb should normalize to GB');
  if (VOUCH_LOCALIZED_LINES) {
    assert(resourcesForUser('gb').lines.some((l) => l.tel === '116123'), 'Samaritans missing for GB');
  } else {
    assert(resourcesForUser('gb').lines.length === 0, 'vouching OFF withholds GB lines');
  }
});

test('every bundled line has a label and at least one of tel/sms', () => {
  for (const [code, entry] of Object.entries(BUNDLED_RESOURCES)) {
    assert(entry.name && Array.isArray(entry.lines) && entry.lines.length, `${code} malformed`);
    for (const l of entry.lines) {
      assert(typeof l.label === 'string' && l.label, `${code} line missing label`);
      assert(l.tel || l.sms, `${code} line "${l.label}" has no tel/sms`);
    }
  }
});

test('detectCountry honors the explicit override', () => {
  localStorage.setItem('ori_crisis_country', 'au');
  assert(detectCountry() === 'AU', 'override not honored');
  localStorage.removeItem('ori_crisis_country');
});

test('loadDb returns the bundled floor when no cache', () => {
  _store.clear();
  const db = loadDb();
  assert(db.version === CRISIS_DB_VERSION && db.countries.US, 'bundled floor missing');
});

await atest('a malformed remote refresh is rejected — floor unchanged', async () => {
  _store.clear();
  const badFetch = async () => ({ ok: true, json: async () => ({ nope: true }) });
  const ok = await refreshCrisisResources('/x.json', badFetch);
  assert(ok === false, 'bad db should be rejected');
  assert(loadDb().countries.US, 'floor must be intact after a bad refresh');
});

await atest('a valid remote refresh is cached and used', async () => {
  _store.clear();
  const goodDb = { version: '2099-01-01', countries: { US: { name: 'United States', lines: [{ label: 'Call 988', tel: '988' }] }, FR: { name: 'France', lines: [{ label: 'Call 3114', tel: '3114' }] } } };
  const goodFetch = async () => ({ ok: true, json: async () => goodDb });
  const ok = await refreshCrisisResources('/x.json', goodFetch);
  assert(ok === true, 'valid db should be accepted');
  assert(loadDb().version === '2099-01-01', 'cached db should be active');
  // The remote refresh still caches at the data layer; whether it SURFACES as
  // rendered lines is gated by the vouching switch (Option A).
  if (VOUCH_LOCALIZED_LINES) {
    assert(resourcesForUser('FR').lines.some((l) => l.tel === '3114'), 'refreshed FR entry should resolve');
  } else {
    assert(resourcesForUser('FR').lines.length === 0, 'vouching OFF withholds even refreshed lines');
  }
});

await atest('a network failure never throws and keeps the floor', async () => {
  _store.clear();
  const boom = async () => { throw new Error('offline'); };
  const ok = await refreshCrisisResources('/x.json', boom);
  assert(ok === false, 'failure returns false');
  assert(loadDb().countries.US, 'floor intact when offline');
});

console.log(`\n  ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
