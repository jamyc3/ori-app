// Ori v2 — quiet check-in (WHO-5).
//
// The design's "Talk — quiet check-in" screen: after an entry is captured,
// one calm question at a time before the handoff. The design labels it
// "question N of 5" — the WHO-5 is a 5-item instrument and a score only
// exists once all five are answered (scoreWho5 returns null otherwise),
// so the sequence runs all five items. Skip abandons the check-in without
// writing anything; we never store a partial or imputed score.
//
// The response scale is the engine's validated 6-point Likert (0–5,
// Bech 2003) — the design mock drew 5 dots, but the instrument's anchors
// win over the sketch; the visual language (growing dot, end labels) is
// kept.

import { useRef, useState } from 'react';
import './styles/checkin.css';
import { WHO5_ITEMS, WHO5_SCALE, saveTodayWho5 } from '../who5.js';

// Compact labels under the dots — a plain, monotonic frequency ladder so the
// six points read at a glance. The validated WHO-5 anchors ("Less than half of
// the time", etc.) stay on each dot as its aria-label, and the stored 0–5 value
// is unchanged, so scoring is untouched — this is display wording only. (The
// old '<Half'/'>Half' pair read as two competing "halfs"; this ladder doesn't.)
// Indexes match WHO5_SCALE.
const SHORT_LABELS = ['Never', 'Rarely', 'Sometimes', 'Often', 'Mostly', 'Always'];

function IconArrow() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M3 8h9M8 4l4 4-4 4" />
    </svg>
  );
}

export default function CheckIn({ onDone, onSkip }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [picked, setPicked] = useState(null);
  const dotsRef = useRef([]);

  const item = WHO5_ITEMS[index];
  const isLast = index === WHO5_ITEMS.length - 1;

  // ARIA radiogroup keyboard support — arrows move AND select (per the radio
  // pattern), Home/End jump to the ends. Without this the six dots are tabbable
  // but inert, so a keyboard/switch user can't complete the validated check-in.
  const onScaleKey = (e) => {
    const n = WHO5_SCALE.length;
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const ni = e.key === 'Home' ? 0 : n - 1;
      setPicked(WHO5_SCALE[ni].v);
      dotsRef.current[ni]?.focus();
      return;
    }
    let dir = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') dir = 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') dir = -1;
    else return;
    e.preventDefault();
    const cur = picked == null
      ? (dir === 1 ? -1 : n)
      : WHO5_SCALE.findIndex((s) => s.v === picked);
    const ni = (cur + dir + n) % n;
    setPicked(WHO5_SCALE[ni].v);
    dotsRef.current[ni]?.focus();
  };
  // Roving tabindex: the selected dot owns the tab stop; if none picked yet, the
  // first dot does, so a single Tab lands inside the group.
  const selIdx = picked == null ? 0 : WHO5_SCALE.findIndex((s) => s.v === picked);

  const handleContinue = () => {
    if (picked == null) return;
    const next = [...answers, picked];
    if (isLast) {
      saveTodayWho5(next);
      onDone?.();
      return;
    }
    setAnswers(next);
    setPicked(null);
    setIndex(index + 1);
  };

  return (
    <section className="v2-checkin">
      <div className="v2-ci-eyebrow">
        Before we close the day · question {index + 1} of {WHO5_ITEMS.length}
      </div>

      <div className="v2-ci-center">
        {/* The item statement is kept verbatim — rephrasing a validated
            instrument's wording would break what the score means. */}
        <div className="v2-ci-q">{item.body}</div>
        <div className="v2-ci-lead">How much of the time was this true today?</div>

        <div>
          <div className="v2-ci-scale" role="radiogroup" aria-label={item.short} onKeyDown={onScaleKey}>
            {WHO5_SCALE.map((s, i) => (
              <button
                key={s.v}
                type="button"
                role="radio"
                aria-checked={picked === s.v}
                aria-label={s.label}
                tabIndex={i === selIdx ? 0 : -1}
                ref={(el) => { dotsRef.current[i] = el; }}
                className={`v2-ci-dot${picked === s.v ? ' sel' : ''}`}
                onClick={() => setPicked(s.v)}
              />
            ))}
          </div>
          <div className="v2-ci-labels" aria-hidden="true">
            {SHORT_LABELS.map((l, i) => (
              <span key={l} className={picked === i ? 'on' : ''}>{l}</span>
            ))}
          </div>
        </div>

        <p className="v2-ci-note">
          A few quiet questions tonight. They fold into your reading — never a separate test.
        </p>
      </div>

      <div className="v2-ci-foot">
        <button type="button" className="v2-ci-ghost" onClick={onSkip}>skip</button>
        <button
          type="button"
          className="v2-pill-btn"
          onClick={handleContinue}
          disabled={picked == null}
        >
          {isLast ? 'Done' : 'Continue'}
          <IconArrow />
        </button>
      </div>
    </section>
  );
}
