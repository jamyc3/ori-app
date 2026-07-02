// Ori v2 — crisis support surfaces (Phase 3). SAFETY-CRITICAL copy.
//
// Two DISTINCT surfaces share one set of verified, one-tap localized lines
// (crisisResources.js) but differ in framing and in how they're gated:
//
//   1. SupportCard — the distress RESPONSE. Empathetic copy that PRESUMES the
//      person is in distress. Shown only by the reflect flow's concern off-ramp,
//      which stays behind ACK_REFLECT_ENABLED (the unreviewed-detection gate).
//      Do NOT surface this from a self-initiated entry point — its copy is wrong
//      for someone who tapped "get help" for a friend or out of curiosity, and
//      it's the copy specifically under clinical review (PHASE3_REVIEW_SCOPE A2).
//
//   2. CrisisDirectory / CrisisHelpFooter — the self-initiated DIRECTORY. Neutral,
//      factual copy that presumes nothing about the user's state. Safe to be
//      reachable ALWAYS (a public-resource directory, the kind app stores
//      encourage; MHACSAF: crisis resources should be readily reachable). This is
//      the always-on footer link on Parts — it runs NO model and NO detection,
//      only routes to public, verified hotlines + findahelpline.
//
// Narrower review surface for #2 (vs. the gated card): just "are the numbers
// right" (verified + localized in crisisResources.js) and "is the copy
// non-presuming" (it is). No distress detection, so none of the duty-of-care /
// SaMD concerns that gate the reflect flow apply here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resourcesForUser, refreshCrisisResources } from './crisisResources.js';
import { useModalA11y } from './useModalA11y.js';

// The shared, one-tap list: localized lines + the universal floor (local
// emergency number + findahelpline, ALWAYS shown). Identical routing for both
// surfaces — only the surrounding copy differs. Bold links + generous tap
// targets (MHACSAF: minimal interaction cost).
function CrisisLines({ res }) {
  return (
    <ul className="v2-ack-support-res">
      <li>
        <strong>If you might be in immediate danger</strong>, call {res.universal.emergency} now.
      </li>
      {res.lines.map((line, i) => (
        <li key={i}>
          {line.tel
            ? <a className="v2-ack-res-link" href={`tel:${line.tel}`}>{line.label}</a>
            : line.sms
              ? <a className="v2-ack-res-link" href={`sms:${line.sms}`}>{line.label}</a>
              : <strong>{line.label}</strong>}
          {line.note ? ` — ${line.note}` : ''}{line.hours ? ` · ${line.hours}` : ''}
        </li>
      ))}
      <li>
        {res.lines.length ? 'More lines near you: ' : 'Find a free, confidential line in your country: '}
        <a className="v2-ack-res-link" href={res.universal.directoryUrl} target="_blank" rel="noopener noreferrer">findahelpline.com</a>
      </li>
    </ul>
  );
}

// Best-effort: pull the latest crisis DB so a corrected number propagates without
// an app update. Bundled set is the floor; failure changes nothing. Shared by
// both surfaces.
function useCrisisResources() {
  const res = useMemo(() => resourcesForUser(), []);
  useEffect(() => { refreshCrisisResources(); }, []);
  return res;
}

// ── 1. Distress RESPONSE card — empathetic, presumes distress ───────────────
// Evidence-grounded (MHACSAF / #chatsafe / WHO): one-tap, call+text, 24/7,
// jurisdiction fallback, trusted-person emphasis, no risk assessment, no
// diagnosis, no platitudes. Gated behind ACK_REFLECT_ENABLED via its only caller.
export function SupportCard({ onClose }) {
  const res = useCrisisResources();
  return (
    <div className="v2-ack-support" role="alert">
      <p className="v2-ack-support-lead">
        It sounds like you're carrying something really heavy right now — and you
        don't have to carry it alone.
      </p>
      <p className="v2-ack-support-body">
        Ori is a journal, not a person, and it isn't the right place for this.
        Please reach out to someone who can be with you — a person you trust, or a
        trained counselor — right now.
      </p>
      <CrisisLines res={res} />
      <button type="button" className="v2-ack-btn ghost" onClick={onClose}>Close</button>
    </div>
  );
}

// ── 2. Self-initiated DIRECTORY — neutral, presumes nothing ─────────────────
// The content behind the always-on footer link. Same verified lines; factual
// framing, so it's appropriate whether the person needs help themselves, is
// helping someone else, or is just looking.
function CrisisDirectory({ onClose }) {
  const res = useCrisisResources();
  return (
    <div className="v2-crisis-card" role="dialog" aria-modal="true" aria-label="Crisis and support lines">
      <p className="v2-crisis-lead">Crisis &amp; support lines</p>
      <p className="v2-crisis-body">
        If you or someone you know needs help now, these are free, confidential
        lines staffed by trained people.
      </p>
      <CrisisLines res={res} />
      <button type="button" className="v2-ack-btn ghost" onClick={onClose}>Close</button>
    </div>
  );
}

// Always-on entry point: a quiet "In crisis? Get help" link that opens the
// neutral directory in a lightweight overlay. Reachable regardless of
// ACK_REFLECT_ENABLED — it surfaces only public, verified hotlines.
export function CrisisHelpFooter() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // Escape-to-close + focus move-in / restore-on-close.
  const dialogRef = useRef(null);
  useModalA11y(open, close, dialogRef);
  return (
    <div className="v2-crisis-foot">
      <button type="button" className="v2-crisis-link" onClick={() => setOpen(true)}>
        In crisis? Get help
      </button>
      {open && (
        <div className="v2-crisis-overlay" role="presentation" onClick={close}>
          <div className="v2-crisis-overlay-inner" tabIndex={-1} ref={dialogRef} onClick={(e) => e.stopPropagation()}>
            <CrisisDirectory onClose={close} />
          </div>
        </div>
      )}
    </div>
  );
}
