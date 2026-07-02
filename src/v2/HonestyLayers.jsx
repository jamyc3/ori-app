// Ori v2 — Honesty layers explainer.
//
// Plain-language explanation of the four-layer honesty model that the
// build-time audit (scripts/audit-honesty.mjs) enforces. Replaces the
// classic-settings handoff in Settings → Trust → "How numbers are made".
//
// The labels and ordering mirror the locked design vocabulary captured in
// REDESIGN_GAP.md: Measured / You told me / A pattern I've seen / My reading.

import './styles/honesty.css';

const LAYERS = [
  {
    id: 'l1',
    glyph: '✓',
    label: 'Measured',
    eyebrow: 'the most solid',
    body:
      "This came straight from a device: sleep from your Oura ring or Apple Health, steps from your phone, events from your calendar. Nothing here is guessed. And when two sensors disagree, Ori tells you they disagree — it never averages the problem away.",
  },
  {
    id: 'l2',
    glyph: '"',
    label: 'You told me',
    eyebrow: 'your own words',
    body:
      "This came from you — your words and your daily check-ins. Ori turns them into a number using a short set of questions that have been tested on many people, so the number carries real meaning. It's still softer than a sensor: it's how the day felt, told honestly.",
  },
  {
    id: 'l3',
    glyph: '↻',
    label: 'A pattern I’ve seen',
    eyebrow: 'observed across your history',
    body:
      "This is something your own days keep repeating — not a one-off. Ori won't call it a pattern until it has shown up about three times and the math says it's unlikely to be coincidence. If it stops repeating, Ori stops saying it.",
  },
  {
    id: 'l4',
    glyph: '~',
    label: 'My reading',
    eyebrow: 'interpretive, the softest layer',
    body:
      "This is Ori's honest guess at what your day means — your evening letter lives mostly here. It's the softest layer: not a fact, never a diagnosis. If a line doesn't ring true, treat it as a question, not a verdict. You know your day better than Ori does.",
  },
];

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4l-6 6 6 6" />
    </svg>
  );
}

export default function HonestyLayers({ onBack }) {
  return (
    <section className="v2-honesty">
      <button type="button" className="v2-backrow" onClick={onBack} aria-label="Back to Settings">
        <IconChevronLeft />
        <span>Settings</span>
      </button>

      <h1 className="v2-honesty-title">How numbers are made.</h1>
      <p className="v2-honesty-lead">
        Every number Ori shows you sits on one of four layers. The harder the layer, the more weight you can put on it. Ori names the layer so you don't have to guess.
      </p>

      {LAYERS.map((row) => (
        <div key={row.id} className="v2-honesty-row">
          <span className={`v2-honesty-glyph ${row.id}`}>{row.glyph}</span>
          <div className="v2-honesty-body">
            <div className="v2-honesty-eyebrow">{row.eyebrow}</div>
            <h2 className="v2-honesty-label">{row.label}</h2>
            <p>{row.body}</p>
          </div>
        </div>
      ))}

      <div className="v2-honesty-foot">
        This page isn't a promise — it's a rule the app cannot break. Ori is built with a check that refuses to ship any number that doesn't have one of these four layers behind it.
      </div>
    </section>
  );
}
