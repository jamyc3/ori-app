// Ori simulator — scalability / persona stress harness (offline, Node).
//
//   node src/sim/measure.mjs            → all personas × {30,90,180,365} days
//
// Measures, per persona × horizon: data volume (and which store it lands in —
// the capped ~5 MB localStorage vs the IDB-backed large keys), how many days
// each surface actually USES (vs stores), which parts surface, and where the
// built-in ceilings bite. Pure data + the real pure-JS analysis modules; no
// browser, no model calls.

// storage.js touches localStorage at import — stub it before anything loads it.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 };

const { generate, PERSONA_KEYS, PERSONAS, ENGINE_HISTORY_CAP } = await import('./generate.js');
const { classifyBucket } = await import('../bucket-state.js');
const { PARTS_LIB } = await import('../parts-lib.js');
const { partAppearanceDays } = await import('../parts-stats.js');

const HORIZONS = [30, 90, 180, 365];
const LARGE_KEYS = new Set(['cpi_oura_history', 'cpi_journal_repo']); // IDB-backed
const LOCALSTORAGE_CAP = 5 * 1024 * 1024; // ~5 MB practical ceiling
const bytes = (v) => Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v), 'utf8');
const kb = (n) => (n / 1024).toFixed(1) + 'kb';

function ringStates(data) {
  const o = data['cpi_oura_history'] || {};
  const od = Object.keys(o).sort();
  const rRec = od.slice(-30).map((d) => o[d]?.sleepScore).filter((v) => typeof v === 'number');
  const w = data['cpi_who5_history'] || {};
  const wd = Object.keys(w).sort();
  const fRec = wd.slice(-30).map((d) => w[d].score);
  const v2 = data['cpi-v2-data'] || [];
  const dem = v2.slice(0, 30).map((h) => {
    const vals = [];
    if (typeof h.decisionCount === 'number') vals.push(Math.min(1, h.decisionCount / 15));
    if (h.params?.C != null) vals.push(Math.min(1, (h.params.C - 1) / 3));
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) * 100 : null;
  }).filter((v) => v != null).reverse();
  return {
    reserves: classifyBucket({ bucket: 'reserves', today: rRec[rRec.length - 1] ?? null, recent: rRec }).state,
    demands: classifyBucket({ bucket: 'demands', today: dem[dem.length - 1] ?? null, recent: dem }).state,
    form: classifyBucket({ bucket: 'form', today: fRec[fRec.length - 1] ?? null, recent: fRec }).state,
  };
}

// Which parts surface, and which have crossed the trend gate (≥60-day span +
// ≥5 visits) — using the same partAppearanceDays() the app's Parts tab uses.
function partsSurfacing(data) {
  const history = data['cpi-v2-data'] || [];
  const out = [];
  for (const part of Object.values(PARTS_LIB)) {
    const visits = partAppearanceDays(history, part);
    if (visits >= 1) out.push({ name: part.name, visits, trend: visits >= 5 });
  }
  return out.sort((a, b) => b.visits - a.visits);
}

console.log(`\nOri simulator — scalability across ${PERSONA_KEYS.length} personas`);
console.log(`engine history cap = ${ENGINE_HISTORY_CAP} entries · localStorage cap ≈ ${kb(LOCALSTORAGE_CAP)}\n`);

for (const persona of PERSONA_KEYS) {
  console.log(`\n━━ ${PERSONAS[persona].label}  (${persona})`);
  for (const days of HORIZONS) {
    const data = generate(persona, days);
    const keys = Object.keys(data).filter((k) => k !== '_simMeta');

    let lsBytes = 0, idbBytes = 0, dayRingKeys = 0, letterKeys = 0;
    for (const k of keys) {
      const b = bytes(data[k]);
      if (LARGE_KEYS.has(k)) idbBytes += b; else lsBytes += b;
      if (k.startsWith('cpi_day_rings_')) dayRingKeys++;
      if (k.startsWith('cpi_letter_')) letterKeys++;
    }
    const nights = Object.keys(data['cpi_oura_history'] || {}).length;
    const checkins = Object.keys(data['cpi_who5_history'] || {}).length;
    const v2 = data['cpi-v2-data'] || [];
    const entries = (data['cpi_journal_repo']?.entries || []).length;
    const r = ringStates(data);
    const parts = partsSurfacing(data);
    // Real part-trend gate is BOTH ≥5 visits AND a ≥60-day history span.
    const trended = days >= 60 ? parts.filter((p) => p.trend).length : 0;
    const lsPct = ((lsBytes / LOCALSTORAGE_CAP) * 100).toFixed(1);
    const capFlag = v2.length > ENGINE_HISTORY_CAP ? `  ⚠ v2 history ${v2.length} > ${ENGINE_HISTORY_CAP} cap (app would retain ${ENGINE_HISTORY_CAP})` : '';

    console.log(
      `  ${String(days).padStart(3)}d │ ` +
      `store: ${nights}N/${checkins}W/${v2.length}A/${entries}J ` +
      `│ localStorage ${kb(lsBytes).padStart(7)} (${lsPct}% of cap, ${dayRingKeys} ring + ${letterKeys} letter keys) ` +
      `│ IDB ${kb(idbBytes).padStart(7)} ` +
      `│ rings: ${r.reserves}/${r.demands}/${r.form} ` +
      `│ parts: ${parts.length} (${trended} trend-ready)` + capFlag
    );
  }
}

console.log(`\nLegend: store = N nights / W check-ins / A analyzed-days / J journal entries.`);
console.log(`Surfaces USE only their windows regardless of store: Reserves/Form/Demands/Patterns ≈ last 30–35 days; part-trends need a ≥60-day span.\n`);
