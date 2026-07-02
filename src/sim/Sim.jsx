// Ori simulator — the control surface (dev route, ?sim=1).
//
// Pick a persona, scrub the day count, watch a live read-out of what the three
// rings WILL say (computed through the real classifyBucket, so the preview can't
// drift from the app), then seed and open Ori for real. The scrubber is the
// point: it collapses weeks into a slider so the normally-invisible things —
// baselines calibrating, the ≥10-day gate unlocking, trends forming — become
// something you can drag back and forth.
//
// This reuses the real storage layer (seed() writes through the shimmed
// localStorage) and the real engine math (classifyBucket), so "watch it light
// up" is the genuine pipeline, not a mock.

import { useMemo, useState } from 'react';
import { PERSONAS, PERSONA_KEYS, generate, seed, hasRealOriData, ENGINE_HISTORY_CAP } from './generate.js';
import { flushStorage } from '../storage.js';
import { classifyBucket } from '../bucket-state.js';
import { PARTS_LIB } from '../parts-lib.js';
import { partAppearanceDays } from '../parts-stats.js';

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Recompute the three buckets from a generated backup object exactly the way
// Today.jsx does — so the preview is a faithful dry-run, not a parallel guess.
function previewBuckets(data) {
  const today = iso(new Date());

  // Reserves ← cpi_oura_history sleepScore series.
  const ouraMap = data['cpi_oura_history'] || {};
  const ouraDays = Object.keys(ouraMap).sort();
  const reservesRecent = ouraDays.slice(-30)
    .map((d) => ouraMap[d]?.sleepScore).filter((v) => typeof v === 'number');
  const reservesToday = typeof ouraMap[today]?.sleepScore === 'number'
    ? ouraMap[today].sleepScore
    : reservesRecent[reservesRecent.length - 1] ?? null;

  // Form ← cpi_who5_history score series (last 30 days present).
  const who5Map = data['cpi_who5_history'] || {};
  const formRecent = Object.keys(who5Map).sort().slice(-30)
    .map((d) => who5Map[d]?.score).filter((v) => typeof v === 'number');
  const formToday = formRecent[formRecent.length - 1] ?? null;

  // Demands ← cpi-v2-data: mean of decisionCount/15 and (C-1)/3, ×100. No
  // calendar feed in the sim, so only the journal contributors apply.
  const v2 = Array.isArray(data['cpi-v2-data']) ? data['cpi-v2-data'] : [];
  const demandFor = (h) => {
    const vals = [];
    if (typeof h?.decisionCount === 'number') vals.push(Math.min(1, h.decisionCount / 15));
    if (h?.params?.C != null) vals.push(Math.min(1, (h.params.C - 1) / 3));
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) * 100 : null;
  };
  const demandsRecent = v2.slice(0, 30).map(demandFor).filter((v) => typeof v === 'number').reverse();
  const demandsToday = demandsRecent[demandsRecent.length - 1] ?? null;

  return {
    reserves: classifyBucket({ bucket: 'reserves', today: reservesToday, recent: reservesRecent }),
    demands: classifyBucket({ bucket: 'demands', today: demandsToday, recent: demandsRecent }),
    form: classifyBucket({ bucket: 'form', today: formToday, recent: formRecent }),
  };
}

// The v2 reset locks page scroll (html/body overflow:hidden, height:100%) and
// the sim renders straight into <body>, outside the app's .v2-frame scroller —
// so this page needs its OWN full-viewport scroller or its lower controls are
// unreachable.
const scroller = { position: 'fixed', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#faf7f1' };
const wrap = { maxWidth: 560, margin: '0 auto', padding: '28px 20px 80px', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#2b2620' };
const card = { background: '#fff', border: '1px solid #e7e1d8', borderRadius: 16, padding: 18, marginBottom: 16, boxShadow: '0 1px 2px rgba(0,0,0,.03)' };
const ringRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 0', borderBottom: '1px solid #f0ebe3' };

export default function Sim() {
  const [persona, setPersona] = useState('burnout');
  const [days, setDays] = useState(23);
  const [busy, setBusy] = useState(false);

  const data = useMemo(() => generate(persona, days), [persona, days]);
  const preview = useMemo(() => previewBuckets(data), [data]);
  const counts = useMemo(() => {
    const history = data['cpi-v2-data'] || [];
    const parts = Object.values(PARTS_LIB)
      .filter((p) => partAppearanceDays(history, p) >= 1).length;
    let lsBytes = 0;
    const large = new Set(['cpi_oura_history', 'cpi_journal_repo']);
    for (const [k, v] of Object.entries(data)) {
      if (k === '_simMeta' || large.has(k)) continue;
      lsBytes += new Blob([typeof v === 'string' ? v : JSON.stringify(v)]).size;
    }
    return {
      nights: Object.keys(data['cpi_oura_history'] || {}).length,
      checkins: Object.keys(data['cpi_who5_history'] || {}).length,
      entries: (data['cpi_journal_repo']?.entries || []).length,
      letters: Object.keys(data).filter((k) => k.startsWith('cpi_letter_')).length,
      analyzed: history.length,
      parts,
      trendReady: days >= 60,
      lsKb: (lsBytes / 1024).toFixed(0),
      lsPct: ((lsBytes / (5 * 1024 * 1024)) * 100).toFixed(1),
      overCap: history.length > ENGINE_HISTORY_CAP,
    };
  }, [data, days]);

  const warming = days < 10;

  const handleSeed = async () => {
    // Seeding WIPES all existing Ori data. In production a user can reach ?sim=1
    // with a real journal — confirm before destroying it (the empty-store case
    // seeds straight through, so the demo flow stays one tap).
    if (hasRealOriData() && !window.confirm(
      'This replaces everything in Ori — your journal, letters, and history — with a generated demo. This can’t be undone. Continue?'
    )) return;
    setBusy(true);
    try {
      seed(persona, days);
      // The journal repo is an IDB-backed large key written fire-and-forget;
      // assigning '/' immediately can abort that transaction and land on an
      // empty journal (same race the Restore-from-backup path guards). Flush
      // the in-flight writes so the seeded history is durable before we reload.
      await flushStorage();
    } finally {
      window.location.assign('/');
    }
  };

  return (
    <div style={scroller}>
    <div style={wrap}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Ori — simulator</h1>
      <p style={{ color: '#7d7468', margin: '0 0 20px', fontSize: 14 }}>
        Fabricate a believable history and load it into the real app. The rings below
        are computed through Ori’s actual engine — this is a dry-run, not a mockup.
      </p>

      <div style={card}>
        <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Persona</label>
        <div style={{ display: 'grid', gap: 8 }}>
          {PERSONA_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setPersona(k)}
              style={{
                textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                border: persona === k ? '2px solid #b08d57' : '1px solid #e7e1d8',
                background: persona === k ? '#fbf7f0' : '#fff',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{PERSONAS[k].label}</div>
              <div style={{ fontSize: 12, color: '#7d7468', marginTop: 2 }}>{PERSONAS[k].blurb}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>History length</label>
          <span style={{ fontSize: 18, fontWeight: 700 }}>{days} days</span>
        </div>
        <input
          type="range" min={3} max={180} value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#b8b09d', marginTop: 2 }}>
          <span>3d</span><span>10d (baseline)</span><span>60d (trends)</span><span>6 mo</span>
        </div>
        <p style={{ fontSize: 12, color: warming ? '#b06a2f' : '#7d7468', margin: '8px 0 0' }}>
          {warming
            ? `Below the 10-day baseline — the rings will honestly say "warming up". Drag past 10 to watch them calibrate.`
            : `${counts.nights} nights · ${counts.checkins} check-ins · ${counts.entries} journal entries · ${counts.parts}/8 parts${counts.trendReady ? ' (trends unlocked)' : ' (trends need 60d)'}`}
        </p>
        <p style={{ fontSize: 11, color: counts.overCap ? '#b06a2f' : '#9c9388', margin: '4px 0 0' }}>
          localStorage ≈ {counts.lsKb} kb ({counts.lsPct}% of ~5 MB cap) · {counts.analyzed} analyzed days
          {counts.overCap ? ` — over the ${ENGINE_HISTORY_CAP}-entry engine cap; the live app would keep the latest ${ENGINE_HISTORY_CAP}` : ''}
        </p>
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>What Today will read</div>
        {['reserves', 'demands', 'form'].map((b) => (
          <div key={b} style={ringRow}>
            <span style={{ textTransform: 'capitalize', fontSize: 14 }}>{b}</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {preview[b].state}
              {preview[b].z != null && (
                <span style={{ color: '#9c9388', fontWeight: 400, marginLeft: 8 }}>
                  z {preview[b].z.toFixed(2)}
                </span>
              )}
            </span>
          </div>
        ))}
        {PERSONAS[persona].wearable === false && (
          <p style={{ fontSize: 12, color: '#7d7468', margin: '8px 0 0' }}>
            No wearable — Reserves stays warming up; Ori runs in Reflect mode (Form only).
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={handleSeed}
        disabled={busy}
        style={{
          width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer',
          background: '#2b2620', color: '#fff', fontSize: 15, fontWeight: 600,
        }}
      >
        {busy ? 'Seeding…' : 'Seed & open Ori →'}
      </button>
      <p style={{ fontSize: 11, color: '#9c9388', textAlign: 'center', marginTop: 10 }}>
        Wipes existing Ori data on this device, then writes this history and opens the app.
      </p>
    </div>
    </div>
  );
}
