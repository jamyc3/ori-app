// Ori v2 — the reflect flow (Phase 3, Step 3, PartDetail-only slice).
//
// The opt-in "say a little about this part" doorway. Quiet by design (pulled,
// never pushed). Flow: closed → consent (once) → write → judge → result.
// Result branches, all handled here:
//   • concern   → a fixed, caring support card (NO model-authored crisis copy);
//                 the gesture is NOT recorded — a crisis isn't bookkeeping.
//   • validated → the mirror (reflectBack) + the optional friend-question.
//   • not validated → a gentle invite to say more; the local gesture still lands.
//
// The reflection text input here is a write box. The seeded-voice path (via
// Shell's listen view) is the deferred slice — wired once the parallel session's
// Shell.jsx edits land.
//
// In local dev the proxy has no key, so judge() fails safe to not-validated —
// the consent and concern paths still work fully offline (concern short-circuits
// before any model call).

import { useCallback, useState } from 'react';
import { appendThank, appendAcknowledgment, lastAcknowledgmentFor } from '../part-history.js';
import {
  judgeAcknowledgment, hasReflectionConsent, grantReflectionConsent,
} from './acknowledgmentEngine.js';
import { useVoice, reflectSttLanguage } from '../integrations/deepgram.js';
import { SupportCard } from './CrisisSupport.jsx';
import { saveReflectionEntry } from './reflectionJournal.js';
import { reflectKilled } from './remoteConfig.js';

// DEPLOY GATE — ENABLED 2026-06-15 under a recorded OPERATOR RISK-ACCEPTANCE
// (docs/ACK_REFLECT_SIGNOFF.md), NOT a professional clinical/legal sign-off.
// Pre-conditions that made that acceptance defensible:
//   • Option A: the crisis card no longer vouches for specific numbers — it
//     routes to the local emergency line + findahelpline.com (professionally
//     maintained), so the highest-stakes failure (a wrong number) is gone.
//   • The sub-processors (model + Deepgram) are already live for letters/voice,
//     so this flag introduces no new data flow — only distress detection + a
//     mirror line. A detection miss degrades to the normal mirror (low harm).
// Unreviewed residual the operator accepted: detection fail-open offline (A1)
// and the distress-card copy/tone (A2). Revisit with a clinician when possible.
// Dev/testing escape hatch (unchanged): localStorage 'ori_ack_reflect' = '1'.
const ACK_REFLECT_ENABLED = true;
// Exported so the relocated flow (ReflectPage) and the PartDetail doorway gate on
// the SAME literal this tripwire (scripts/check-ack-reflect-gate.mjs) reads here —
// flipping it OFF must actually take the crisis-capable flow offline everywhere.
export function reflectEnabled() {
  // Remote killswitch (operator env flip on the VPS, mirrored at boot by
  // remoteConfig.js). Checked FIRST and can only disable: a safety issue in
  // this crisis-capable flow must be stoppable without an app release.
  if (reflectKilled()) return false;
  if (ACK_REFLECT_ENABLED) return true;
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('ori_ack_reflect') === '1'; }
  catch { return false; }
}

// The crisis SupportCard (distress off-ramp) now lives in CrisisSupport.jsx,
// shared with the always-on Parts footer directory. This flow uses the
// empathetic RESPONSE variant; it stays gated behind ACK_REFLECT_ENABLED.

// The write/speak input — its own component so useVoice (mic + Deepgram) only
// mounts while the user is actually in the input phase, never on the idle
// doorway. Finalized chunks append to the text; interim streams faded; submit
// folds in any trailing interim. Falls back to typing if voice isn't supported.
function MicGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function XGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function ReflectInput({ part, text, setText, busy, onSubmit, onCancel }) {
  const onChunk = useCallback((chunk) => {
    setText((t) => `${t} ${chunk}`.replace(/\s+/g, ' ').trimStart());
  }, [setText]);
  const { listening, warming, interim, supported, error, toggle, flushPending } = useVoice(onChunk, { autoResume: false, language: reflectSttLanguage() });

  const handleSubmit = useCallback(async () => {
    // Batch-fallback mode: fold the in-flight window in BEFORE the phase flips
    // to `result` — after that, this input unmounts and late text is lost.
    const late = await flushPending();
    const folded = `${text} ${interim || ''} ${late || ''}`.replace(/\s+/g, ' ').trim();
    if (listening) toggle();
    onSubmit(folded);
  }, [text, interim, listening, toggle, onSubmit, flushPending]);

  const handleCancel = useCallback(() => {
    if (listening) toggle();
    onCancel();
  }, [listening, toggle, onCancel]);

  const hasContent = (`${text} ${interim || ''}`).trim().length > 0;
  const micLabel = warming ? 'Warming…' : listening ? 'Stop' : 'Speak';

  return (
    <div className="v2-ack-zone">
      <label className="v2-ack-label" htmlFor="v2-ack-text">
        What is {part.name} holding for you right now?
      </label>
      <textarea
        id="v2-ack-text"
        className="v2-ack-text"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="A sentence is enough — type it, or tap Speak. There's no right answer."
        autoFocus
      />
      {listening && interim ? <p className="v2-ack-interim">{interim}</p> : null}
      {error ? <p className="v2-ack-interim">Voice isn't available — type instead.</p> : null}
      {/* One compact line: Reflect grows, Speak is a mic icon, Cancel sits at the
          end — so the row stays a single thumb-height strip just above the
          keyboard instead of wrapping to two rows that the keyboard shoves around. */}
      <div className="v2-ack-actions">
        <button type="button" className="v2-ack-btn primary" onClick={handleSubmit} disabled={busy || !hasContent}>
          {busy ? 'Reflecting…' : 'Reflect'}
        </button>
        {supported && (
          <button
            type="button"
            className={`v2-ack-mic${listening ? ' rec' : ''}`}
            onClick={toggle}
            disabled={busy}
            aria-label={listening ? 'Stop recording' : 'Speak your reflection'}
            title={micLabel}
          >
            <MicGlyph />
          </button>
        )}
        <button
          type="button"
          className="v2-ack-mic v2-ack-x"
          onClick={handleCancel}
          disabled={busy}
          aria-label="Cancel"
          title="Cancel"
        >
          <XGlyph />
        </button>
      </div>
    </div>
  );
}

export default function AckReflect({ part, onLanded }) {
  const [phase, setPhase] = useState('closed'); // closed | consent | input | result
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [priorAck, setPriorAck] = useState(() => lastAcknowledgmentFor(part.id));

  const open = useCallback(() => {
    setResult(null);
    setPhase(hasReflectionConsent() ? 'input' : 'consent');
  }, []);

  const allow = useCallback(() => { grantReflectionConsent(); setPhase('input'); }, []);

  const submit = useCallback(async (override) => {
    const reflection = (typeof override === 'string' ? override : text).trim();
    if (!reflection || busy || !part) return;
    setBusy(true);
    let r;
    try {
      // Wall-clock backstop (same lesson as the letter's): the engine has no
      // client-side timeout by design, so a stalled judge request would strand
      // this spinner forever. Past 30s we fall to the same safe default as an
      // error — the gesture still lands, the words still reach the journal.
      r = await Promise.race([
        judgeAcknowledgment(reflection, part),
        new Promise((resolve) => setTimeout(() => resolve(null), 30_000)),
      ]);
      if (!r) r = { validated: false, concern: false };
    } catch {
      r = { validated: false, concern: false }; // defensive; judge already fails safe
    }
    // Consent can vanish between opening this flow and submitting (revoked in
    // Privacy in another tab). If the judge says it needs consent, ask again —
    // never record the gesture, save the reflection, or show the "that counts"
    // mirror for something the user hasn't consented to processing.
    if (r?.needsConsent) {
      setBusy(false);
      setPhase('consent');
      return;
    }
    // A crisis is never bookkeeping. Otherwise the gesture lands locally whether
    // or not the reflection validated. A validated reflection records the richer
    // event (reflection + mirror) on the descriptive axis; a non-validated one
    // lands as a plain gesture.
    if (!r.concern) {
      // One timestamp shared by the part-record and the journal copy, so a later
      // backfill recognises them as the same event (idempotent — no duplicate).
      const now = new Date();
      if (r.validated) {
        appendAcknowledgment(part.id, { validated: true, reflection, mirror: r.reflectBack || null, now });
        setPriorAck(lastAcknowledgmentFor(part.id));
      } else {
        appendThank(part.id, null, now);
      }
      // Mirror the FULL reflection into the journal (visible in the Journal tab),
      // for validated AND not — so your words are never silently dropped.
      saveReflectionEntry(part.id, reflection, { dateISO: now.toISOString() });
      onLanded?.();
    }
    setResult(r);
    setBusy(false);
    setPhase('result');
  }, [text, busy, part, onLanded]);

  const reset = useCallback(() => { setText(''); setResult(null); setPhase('closed'); }, []);
  const sayMore = useCallback(() => { setText(''); setResult(null); setPhase('input'); }, []);

  // Deploy gate: render nothing unless explicitly enabled (see ACK_REFLECT_ENABLED).
  // Placed after all hooks so the rules of hooks hold.
  if (!reflectEnabled()) return null;

  if (phase === 'closed') {
    return (
      <div className="v2-ack-closed">
        {priorAck?.reflection && (
          <p className="v2-ack-continuity">Last time, you wrote: “{priorAck.reflection}”</p>
        )}
        <button type="button" className="v2-ack-doorway" onClick={open}>
          Say a little about {part.name} →
        </button>
      </div>
    );
  }

  if (phase === 'consent') {
    return (
      <div className="v2-ack-zone">
        <p className="v2-ack-consent-lead">Before you share this</p>
        <p className="v2-ack-consent-body">
          What you write stays yours. To reflect it back to you, Ori sends just
          these words to the same AI that writes your letters — so unlike the
          taps you make (those never leave your phone), this note does. If you
          speak instead of type, a transcription service (Deepgram) turns your
          voice into words first. You can change your mind any time in Export &amp; privacy.
        </p>
        <div className="v2-ack-actions">
          <button type="button" className="v2-ack-btn" onClick={allow}>Okay, share it</button>
          <button type="button" className="v2-ack-btn ghost" onClick={reset}>Not now</button>
        </div>
      </div>
    );
  }

  if (phase === 'input') {
    return (
      <ReflectInput part={part} text={text} setText={setText} busy={busy} onSubmit={submit} onCancel={reset} />
    );
  }

  // phase === 'result'
  if (result?.concern) {
    return <div className="v2-ack-zone"><SupportCard onClose={reset} /></div>;
  }
  return (
    <div className="v2-ack-zone">
      {result?.validated && result.reflectBack && (
        <p className="v2-ack-mirror">{result.reflectBack}</p>
      )}
      {!result?.validated && (
        <p className="v2-ack-mirror soft">You stayed with {part.name} for a moment. That counts.</p>
      )}
      {result?.inviteDeeper && (
        <p className="v2-ack-invite">{result.inviteDeeper}</p>
      )}
      <div className="v2-ack-actions">
        {result?.inviteDeeper && (
          <button type="button" className="v2-ack-btn" onClick={sayMore}>Say more</button>
        )}
        <button type="button" className="v2-ack-btn ghost" onClick={reset}>Done</button>
      </div>
    </div>
  );
}
