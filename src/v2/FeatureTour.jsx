// First-run feature tour — a spotlight coachmark deck that walks a new user
// through Ori's core features in order: voice input → journaling → the evening
// letter (inbox) → patterns → settings.
//
// Robustness notes (learned on-device, build 29):
//  - Rendered through a PORTAL to document.body so the app's swipe-back /
//    pull-to-refresh / no-zoom touch handling can't swallow taps on the controls.
//  - Controls live in a FULL-WIDTH card pinned to the top or bottom edge (flipped
//    away from the highlighted element) so Next/Back/Skip can never clip off-screen.
//  - The highlighted element is itself tappable (a transparent hit-target over it)
//    and advances the tour, so a tap always does something.
//
// All five steps show in BOTH modes (tabs + inbox are persistent chrome). Only the
// Patterns step copy adapts. Honest timing: the letter step says "tonight"; the
// ~7-day expectation lives on the Patterns step.

import { useState, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './styles/featureTour.css';

export function tourSteps(reflect) {
  return [
    {
      sel: '[data-tour="voice"]',
      title: 'Talk about your day',
      body: 'This is your mic. Tap it anytime to speak your day out loud, like telling a friend — a sentence is plenty, and there’s no quiz.',
    },
    {
      sel: '[data-tour="write"]',
      title: 'Or write it down',
      body: 'Prefer typing to the mic? Tap here to write your day instead. Everything — written or spoken — is saved in your Journal (the second tab below), by date.',
    },
    {
      sel: '[data-tour="inbox"]',
      title: 'Your evening letter',
      body: 'Tonight, at the time you chose, Ori writes you one short letter and leaves it here. Add more to your day before then and it rewrites itself to match.',
    },
    {
      sel: '[data-tour="tab-patterns"]',
      title: 'Patterns take about a week',
      body: reflect
        ? 'Trends gather here as you write — give it about seven days. Quiet at first is normal, not broken. Body-based trends appear if you connect a wearable later.'
        : 'Trends gather here as you write — give it about seven days. Quiet at first is normal, not broken. Sleep and body threads come from your wearable.',
    },
    {
      sel: '[data-tour="tab-settings"]',
      title: 'Change anything here',
      body: 'Letter time, words-only or words-plus-body, connecting a wearable, replaying this tour — it all lives under the gear. That’s it — enjoy your evenings.',
    },
  ];
}

export default function FeatureTour({ steps, onClose }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState(null);
  const step = steps[i];
  const last = i === steps.length - 1;
  const advance = () => (last ? onClose() : setI((n) => Math.min(n + 1, steps.length - 1)));
  const back = () => setI((n) => Math.max(0, n - 1));

  const measure = useCallback(() => {
    const el = typeof document !== 'undefined' && document.querySelector(step.sel);
    if (!el) { setBox(null); return; }
    const r = el.getBoundingClientRect();
    setBox({ x: r.left, y: r.top, w: r.width, h: r.height });
  }, [step]);

  useLayoutEffect(() => {
    measure();
    const onR = () => measure();
    window.addEventListener('resize', onR);
    window.addEventListener('orientationchange', onR);
    const t = setTimeout(measure, 80);
    return () => {
      window.removeEventListener('resize', onR);
      window.removeEventListener('orientationchange', onR);
      clearTimeout(t);
    };
  }, [measure]);

  if (typeof document === 'undefined') return null;

  const PAD = 10;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 844;
  // Pin the card to the edge FARTHEST from the highlighted element so it never
  // covers the target and never clips. Target low on screen → card at top.
  const targetLow = box ? (box.y + box.h / 2) > vh * 0.5 : false;

  const overlay = (
    <div className="v2-tour" role="dialog" aria-modal="true" aria-label="Feature tour">
      {/* transparent full-screen tap-blocker (stops the page beneath being hit) */}
      <div className="v2-tour-dim" />
      {box && (
        <>
          {/* visual: dim everything except a bright ring around the target */}
          <div
            className="v2-tour-spot"
            style={{ left: box.x - PAD, top: box.y - PAD, width: box.w + PAD * 2, height: box.h + PAD * 2 }}
          />
          {/* the target itself is tappable — advances the tour */}
          <button
            type="button"
            className="v2-tour-hit"
            aria-label="Next"
            onClick={advance}
            style={{ left: box.x - PAD, top: box.y - PAD, width: box.w + PAD * 2, height: box.h + PAD * 2 }}
          />
        </>
      )}
      <div className={`v2-tour-card ${targetLow ? 'at-top' : 'at-bottom'}`}>
        <div className="v2-tour-h">{step.title}</div>
        <p className="v2-tour-p">{step.body}</p>
        <div className="v2-tour-dots" aria-hidden="true">
          {steps.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}
        </div>
        <div className="v2-tour-row">
          <button type="button" className="v2-tour-skip" onClick={onClose}>Skip</button>
          <span className="v2-tour-nav">
            {i > 0 && <button type="button" className="v2-tour-back" onClick={back}>Back</button>}
            <button type="button" className="v2-tour-next" onClick={advance}>{last ? 'Done' : 'Next'}</button>
          </span>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
