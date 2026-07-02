// Ori v2 — per-number provenance.
//
// The v1 honesty contract asks that every visible number can say where it
// came from without making the user hunt for a settings page. This is that
// affordance: a small ⓘ chip next to a metric opens a bottom sheet naming
// the honesty layer (the same four-layer vocabulary as HonestyLayers.jsx),
// the concrete source, and how the number is made. The registry below is
// the single place a metric's provenance is written down — surfaces pass
// metric ids, never loose copy, so the disclosure can't drift per-screen.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalA11y } from './useModalA11y.js';
import './styles/provenance.css';

// Where the wearable numbers (Reserves) actually came from. Oura and Apple
// Health merge into the SAME day-keyed history — `cpi_oura_history` is just the
// legacy key name — and every day carries a `source` tag: "oura", "apple-health",
// or "oura+apple-health". This resolves that into honest copy, so a chip never
// tells an Apple Health user the number came "from your Oura ring." Mirrors the
// source-adaptive label in engine.js. Pass a dateIso to read that one day's
// source (Day view); omit it to read across all synced days (Today / Ring detail).
export function wearableSource(dateIso) {
  let hasOura = false, hasApple = false;
  try {
    const map = JSON.parse(localStorage.getItem('cpi_oura_history') || '{}');
    const days = dateIso ? (map[dateIso] ? [map[dateIso]] : []) : Object.values(map);
    for (const d of days) {
      const s = String(d?.source || '').toLowerCase();
      if (s.includes('apple')) hasApple = true;
      if (s.includes('oura')) hasOura = true;
      // A day with a reading but no source tag predates source tagging — the
      // only wearable the legacy path ever wrote was Oura.
      if (!s && d?.sleepScore != null) hasOura = true;
    }
  } catch { /* no history yet */ }
  const kind = hasApple && hasOura ? 'both' : hasApple ? 'apple' : hasOura ? 'oura' : 'none';
  const label = kind === 'both' ? 'Apple Health and your Oura ring'
    : kind === 'apple' ? 'Apple Health'
    : kind === 'oura' ? 'your Oura ring'
    : 'your wearable';
  return { kind, label };
}

// Metric registry — every chip on every surface resolves here. A metric's
// `source`/`how` may be a function of the resolved wearable source (Reserves
// uses this so its provenance names the right device).
export const PROVENANCE = {
  reserves: {
    layer: 'l1',
    title: 'Reserves',
    meaning: 'How much you’ve got in the tank today — how rested and recovered you are going into the day.',
    source: (w) => w.kind === 'apple' ? 'from Apple Health · last night'
      : w.kind === 'both' ? 'from Apple Health + your Oura ring · last night'
      : w.kind === 'oura' ? 'from your Oura ring · last night'
      : 'from your wearable · last night',
    how: (w) => {
      if (w.kind === 'apple')
        return "How rested your body is for the day ahead — read from the sleep your iPhone recorded in Apple Health, turned into a 0–100 rested score. The only thing it's ever compared to is your own recent nights.";
      if (w.kind === 'both')
        return "How rested your body is for the day ahead — from your sleep: your Oura ring's score on the nights the ring has it, your Apple Health sleep otherwise. The only thing it's ever compared to is your own recent nights.";
      if (w.kind === 'oura')
        return "How rested your body is for the day ahead, read straight from your Oura ring's sleep score that morning. Ori shows it just as your ring reports it — and the only thing it's ever compared to is your own recent nights.";
      return "How rested your body is for the day ahead, read from your connected sleep source. The only thing it's ever compared to is your own recent nights.";
    },
  },
  demands: {
    layer: 'l3',
    title: 'Demands',
    meaning: 'How much the day is asking of you — how full, busy, or demanding it has been.',
    source: 'from your writing · and your calendar, if connected',
    how: "How much the day asked of you — drawn from what you wrote (the decisions it held, how much it pulled you around) and, when a calendar is connected, how full it was. Quiet days stay blank rather than guessed at.",
  },
  form: {
    layer: 'l2',
    title: 'Form',
    meaning: 'How you’re actually feeling in yourself today — your own sense of how you’re doing.',
    source: 'from your own check-in',
    how: 'Your own answer to a short, well-studied wellbeing check-in — five quick questions, in your words. It’s exactly what you said, nothing read between the lines.',
  },
  patterns: {
    layer: 'l3',
    title: 'Patterns',
    source: 'from your own history',
    how: "Something that has come up again and again across your own days. Ori waits until it has genuinely recurred before naming it — a day or two isn't a pattern yet — and when it stops repeating, it stops being named.",
  },
  letter: {
    layer: 'l4',
    title: 'The letter',
    source: 'written from your words',
    how: "Ori's reading of your day, written from your own words — an interpretation, not measurement. Let your own sense of the day be the final word over anything here that doesn't ring true.",
  },
  decisions: {
    layer: 'l4',
    title: 'Decisions',
    meaning: 'A place to park a decision that matters and make it at a clearer hour.',
    source: 'your sleep and your daily rhythm',
    how: "When a parked decision comes back is our best estimate from your recent sleep and your own daily rhythm — not a fixed time, which is why it reads as “around.” A clearer head tends to help; it isn't a guarantee, and you can always decide now. The quick check before you decide is just your own read on how clear you feel — never a score.",
  },
  streak: {
    layer: 'l3',
    title: 'Streak',
    source: 'from your own days',
    how: 'Simply the days in a row you’ve written, ending today. It only looks at whether you showed up each day — nothing more.',
  },
  hcpi: {
    layer: 'l4',
    title: 'The two-week shape',
    source: 'a gentle read across your days',
    how: 'A single, soft read of each day, drawn together from your sleep, your check-ins, and what your writing held. The trend and the “lifting / softening” word are that read over time — a feel for the fortnight, not a hard measurement.',
  },
};

export function ProvenanceChip({ metric, metrics, className = '', dateIso }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null);
  useModalA11y(open, () => setOpen(false), dialogRef);
  const ids = (metrics || [metric]).filter((id) => PROVENANCE[id]);
  // A single metric that carries a plain-language `meaning` leads with "what
  // this means" (the everyday sense of it), then keeps the provenance as a
  // quiet second note. Combined chips and meaning-less metrics keep the
  // original where-it-comes-from layout.
  const single = ids.length === 1 ? PROVENANCE[ids[0]] : null;
  const lead = single?.meaning || null;
  // Resolve the real wearable source only while the sheet is open (one cheap
  // history read), so Reserves names the device that actually fed the number.
  const w = open ? wearableSource(dateIso) : null;

  // Escape closes, and the sheet swallows background scroll while open.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!ids.length) return null;

  return (
    <>
      <button
        type="button"
        className={`v2-prov-chip ${className}`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        aria-label={lead ? `What ${single.title} means` : 'Where this number comes from'}
        title={lead ? `What ${single.title} means` : 'Where this number comes from'}
      >
        i
      </button>
      {open && createPortal(
        <div className="v2-prov-scrim" onClick={() => setOpen(false)} role="presentation">
          <div
            className="v2-prov-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Where this comes from"
            tabIndex={-1}
            ref={dialogRef}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="v2-prov-grab" aria-hidden="true" />
            {lead ? (
              <>
                <div className="v2-prov-eyebrow-head">What this means</div>
                <h2 className="v2-prov-head">{single.title}</h2>
                <p className="v2-prov-meaning">{lead}</p>
                <div className="v2-prov-row">
                  <div className="v2-prov-body">
                    <div className="v2-prov-sub">Where it comes from</div>
                    <div className="v2-prov-src">{typeof single.source === 'function' ? single.source(w) : single.source}</div>
                    <p className="v2-prov-how">{typeof single.how === 'function' ? single.how(w) : single.how}</p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="v2-prov-eyebrow-head">What you’re looking at</div>
                <h2 className="v2-prov-head">Where this comes from</h2>
                {ids.map((id) => {
                  const m = PROVENANCE[id];
                  const src = typeof m.source === 'function' ? m.source(w) : m.source;
                  const how = typeof m.how === 'function' ? m.how(w) : m.how;
                  return (
                    <div key={id} className="v2-prov-row">
                      <div className="v2-prov-body">
                        <div className="v2-prov-title">{m.title}</div>
                        <div className="v2-prov-src">{src}</div>
                        <p className="v2-prov-how">{how}</p>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
            <div className="v2-prov-foot">
              Ori never shows you a number without saying where it came from.
            </div>
            <button type="button" className="v2-prov-close" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default ProvenanceChip;
