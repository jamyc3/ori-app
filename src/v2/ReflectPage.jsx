// Ori v2 — the Reflect page (full-screen home for the "say a little" flow).
//
// One continuing conversation with a part, on its own page. Replaces the cramped
// inline panel (AckReflect) that lived at the bottom of PartDetail. Three things
// this page gets right that the inline flow didn't:
//
//   1. The input is INVISIBLE, like the Today capture screen — the question is a
//      quiet heading that STAYS PUT while you write or speak, the writing area is
//      open space (no box), and dictated words land in that space, not a strip.
//   2. "Say more" HOLDS THE THREAD. Each turn (the question Ori asked + what you
//      answered) is carried into the next judge call, so the next question goes a
//      step DEEPER instead of restarting the opener. After a few turns it closes
//      gently rather than looping.
//   3. Same consent, same privacy, same crisis short-circuit as before — a
//      distress signal is never recorded and never deepened (handled in the
//      engine/gate; this page only renders the support card it returns).
//
// Logic parity with the old flow: consent→input→result, judge fail-safe, crisis
// short-circuit (never recorded), validated → mirror + journal copy, not-validated
// → the gesture still lands.

import { useCallback, useMemo, useState } from 'react';
import { appendThank, appendAcknowledgment, lastAcknowledgmentFor } from '../part-history.js';
import {
  judgeAcknowledgment, hasReflectionConsent, grantReflectionConsent,
} from './acknowledgmentEngine.js';
import { useVoice, reflectSttLanguage } from '../integrations/deepgram.js';
import { partDescOf } from '../parts-lib.js';
import { buildKeyterms } from '../voiceVocabulary.js';
import { loadRepo } from '../engine.js';
import { reflectEnabled } from './AckReflect.jsx';
import { SupportCard } from './CrisisSupport.jsx';
import { saveReflectionEntry } from './reflectionJournal.js';
import './styles/parts.css';
import './styles/capture.css';
import './styles/reflect.css';

// How many turns deep a single sitting goes before Ori closes the loop. Three is
// "you've really stayed with this" — enough to deepen, short of an interrogation.
const MAX_TURNS = 3;

// The reflect mark — an inward spiral (turning inward / contemplation). Matches
// the app's line aesthetic (stroke 1.7, round caps). Used both as the PartDetail
// doorway icon and this page's header glyph.
export function IconReflectSpiral({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.6 12.0 L12.7 12.1 L12.8 12.3 L12.8 12.5 L12.8 12.7 L12.8 12.9 L12.7 13.1 L12.5 13.3 L12.3 13.5 L12.0 13.7 L11.7 13.7 L11.4 13.8 L11.0 13.7 L10.6 13.6 L10.3 13.4 L10.0 13.2 L9.7 12.8 L9.5 12.4 L9.3 12.0 L9.2 11.5 L9.2 11.0 L9.4 10.5 L9.6 10.0 L9.9 9.5 L10.3 9.1 L10.8 8.7 L11.4 8.4 L12.0 8.3 L12.7 8.2 L13.4 8.3 L14.1 8.4 L14.7 8.8 L15.3 9.2 L15.9 9.8 L16.3 10.4 L16.6 11.2 L16.8 12.0 L16.8 12.9 L16.7 13.7 L16.5 14.6 L16.0 15.4 L15.5 16.1 L14.7 16.8 L13.9 17.3 L13.0 17.6 L12.0 17.9 L11.0 17.9 L9.9 17.7 L8.9 17.4 L7.9 16.8 L7.1 16.1 L6.3 15.3 L5.7 14.3 L5.3 13.2 L5.1 12.0 L5.1 10.8 L5.3 9.6 L5.7 8.4 L6.4 7.3 L7.2 6.3 L8.2 5.4 L9.4 4.7 L10.6 4.3 L12.0 4.0 L13.4 4.1 L14.8 4.3 L16.1 4.8 L17.4 5.6 L18.5 6.5 L19.5 7.7 L20.2 9.0 L20.7 10.5 L21.0 12.0" />
    </svg>
  );
}

function MicGlyph({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
function IconChevronLeft() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4l-6 6 6 6" />
    </svg>
  );
}
function IconArrow() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M3 8h9M8 4l4 4-4 4" />
    </svg>
  );
}
function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

// One line per earlier turn — quiet, dimmed, so the person can see the path they
// took without it competing with the live question. Their own words, capped.
function ThreadSoFar({ thread }) {
  if (!thread.length) return null;
  return (
    <div className="v2-reflect-thread" aria-label="What you've said so far">
      {thread.map((t, i) => (
        <p key={i} className="v2-reflect-thread-line">
          {t.a.length > 120 ? `${t.a.slice(0, 120).trim()}…` : t.a}
        </p>
      ))}
    </div>
  );
}

// The invisible input — a pinned question heading (stays put while writing or
// speaking), a borderless growing write area (dictated words land here), and a
// quiet foot: a faint status line, a mic, and the Reflect pill. Mirrors Capture.
function ReflectInput({ question, text, setText, busy, onSubmit, onCancel, thread }) {
  const onChunk = useCallback((chunk) => {
    setText((prev) => (prev.trim() ? `${prev.trim()} ${chunk}` : chunk));
  }, [setText]);
  // Match the Today/Capture voice path exactly — the known-good config:
  //   • autoResume:true → the iOS watchdog self-heals a stalled WKWebView mic
  //     socket (restart on >1.5s of no audio), the fix for fragmented/garbled
  //     dictation that never recovers.
  //   • keyterms from the user's own journal → Deepgram (nova-3) stops mishearing
  //     their recurring words. Built once per open.
  const keyterms = useMemo(() => buildKeyterms(loadRepo().entries), []);
  const { listening, warming, interim, supported, error, toggle, flushPending } = useVoice(onChunk, { autoResume: true, keyterms, language: reflectSttLanguage() });

  const handleSubmit = useCallback(async () => {
    // Batch-fallback mode: fold the still-in-flight window in BEFORE freezing
    // the reflection text — a late onResult can't reach a submitted answer.
    const late = await flushPending();
    const folded = `${text} ${interim || ''} ${late || ''}`.replace(/\s+/g, ' ').trim();
    if (listening) toggle();
    onSubmit(folded);
  }, [text, interim, listening, toggle, onSubmit, flushPending]);

  const hasContent = (`${text} ${interim || ''}`).trim().length > 0;
  const statusLine = listening
    ? (interim ? `… ${interim.slice(-80)}` : 'Listening…')
    : (error ? "Voice isn't available — type instead." : (warming ? 'Warming…' : ''));

  return (
    <div className="v2-reflect-input">
      {/* The pinned question — a quiet heading that does NOT move while you write
          or speak (the Today-page pattern). */}
      <h2 className="v2-write-prompt v2-reflect-q">{question}</h2>

      <textarea
        className="v2-write-area"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="A sentence is enough — type it, or tap the mic. There's no right answer."
        aria-label="Your reflection"
        autoFocus
      />

      <ThreadSoFar thread={thread} />

      {/* One quiet row: close · status · mic · Reflect — no stacked "Not now". */}
      <div className="v2-write-foot v2-reflect-foot">
        <button type="button" className="v2-reflect-x" onClick={onCancel} aria-label="Not now">
          <IconClose />
        </button>
        <span className={`v2-write-status${listening ? ' listening' : ''}`}>{statusLine}</span>
        {supported && (
          <button
            type="button"
            className={`v2-write-mic${listening ? ' on' : ''}`}
            onClick={toggle}
            disabled={busy}
            aria-label={listening ? 'Stop speaking' : 'Speak instead of typing'}
            aria-pressed={listening}
          >
            <MicGlyph />
          </button>
        )}
        <button type="button" className="v2-pill-btn" onClick={handleSubmit} disabled={busy || !hasContent}>
          {busy ? 'Reflecting…' : 'Reflect'}
          <IconArrow />
        </button>
      </div>
    </div>
  );
}

// Full-page reflect flow. `onBack` returns to the part it was opened from.
export default function ReflectPage({ part, onBack, onLanded, backLabel }) {
  const [phase, setPhase] = useState(() => (hasReflectionConsent() ? 'input' : 'consent'));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  // The question currently on screen. Starts as the opener; each "Say more"
  // advances it to Ori's last inviteDeeper so the thread climbs.
  const openingQuestion = part ? `What is ${part.name} holding for you right now?` : '';
  const [question, setQuestion] = useState(openingQuestion);
  // The conversation so far, oldest first: { q, a, mirror }. Fed to the engine
  // so each turn deepens instead of restarting.
  const [thread, setThread] = useState([]);
  // The answer just submitted — folded into the thread when they tap "Say more".
  const [lastAnswer, setLastAnswer] = useState('');
  const [priorAck] = useState(() => (part ? lastAcknowledgmentFor(part.id) : null));
  // When this reflection sitting opened — drives the journal entry's date so a
  // reflection that crosses midnight stays on the day it began. Held across the
  // whole "Say more" thread (one sitting = one start).
  const [startedAt] = useState(() => Date.now());

  const allow = useCallback(() => { grantReflectionConsent(); setPhase('input'); }, []);

  const submit = useCallback(async (override) => {
    const reflection = (typeof override === 'string' ? override : text).trim();
    if (!reflection || busy || !part) return;
    setBusy(true);
    let r;
    try { r = await judgeAcknowledgment(reflection, part, { thread }); }
    catch { r = { validated: false, concern: false }; }
    if (r?.needsConsent) { setBusy(false); setPhase('consent'); return; }
    if (!r.concern) {
      const now = new Date();
      if (r.validated) {
        appendAcknowledgment(part.id, { validated: true, reflection, mirror: r.reflectBack || null, now });
      } else {
        appendThank(part.id, null, now);
      }
      saveReflectionEntry(part.id, reflection, { dateISO: now.toISOString(), startedAt });
      onLanded?.();
    }
    setLastAnswer(reflection);
    setResult(r);
    setBusy(false);
    setPhase('result');
  }, [text, busy, part, thread, onLanded, startedAt]);

  // "Say more" — hold the thread, climb. Fold the turn just finished into the
  // history, move Ori's deeper question into the pinned slot, clear the box.
  const sayMore = useCallback(() => {
    setThread((prev) => [...prev, { q: question, a: lastAnswer, mirror: result?.reflectBack || null }]);
    setQuestion(result?.inviteDeeper || question);
    setText('');
    setResult(null);
    setPhase('input');
  }, [question, lastAnswer, result]);

  // Deploy gate (after all hooks, rules-of-hooks safe): the relocated flow ships
  // crisis content (SupportCard), so it stays dark unless the same flag the
  // tripwire reads in AckReflect is on.
  if (!part || !reflectEnabled()) return null;

  // After MAX_TURNS answered, close the loop gently instead of inviting more.
  const turnsDone = thread.length + 1; // the current result counts as one
  const canGoDeeper = result?.inviteDeeper && turnsDone < MAX_TURNS;
  const priorWords = priorAck?.reflection
    ? (priorAck.reflection.length > 90 ? `${priorAck.reflection.slice(0, 90).trim()}…` : priorAck.reflection)
    : null;

  return (
    <section className="v2-pd v2-reflect">
      <div className="v2-pd-top">
        <button type="button" className="v2-backrow" onClick={onBack} aria-label={`Back to ${(backLabel || part.name).toLowerCase()}`}>
          <IconChevronLeft />
          <span>{backLabel || part.name}</span>
        </button>
      </div>

      <div className="v2-reflect-head">
        <div className="v2-reflect-mark" style={{ color: part.color || 'var(--forest)' }} aria-hidden="true">
          <IconReflectSpiral size={30} />
        </div>
        <h1 className="v2-pd-name">Reflect with {part.name}</h1>
        {partDescOf(part, reflectSttLanguage()) && (
          <p className="v2-pd-desc">{partDescOf(part, reflectSttLanguage())}</p>
        )}
      </div>

      {/* The prior-sitting throughline is noise on the opener — surface it only
          once they've stayed and gone a turn deeper (the "second question"). */}
      {priorWords && phase === 'input' && thread.length > 0 && (
        <p className="v2-ack-continuity">Last time, you wrote: “{priorWords}”</p>
      )}

      {phase === 'consent' && (
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
            <button type="button" className="v2-ack-btn ghost" onClick={onBack}>Not now</button>
          </div>
        </div>
      )}

      {phase === 'input' && (
        <ReflectInput
          question={question}
          text={text}
          setText={setText}
          busy={busy}
          onSubmit={submit}
          onCancel={onBack}
          thread={thread}
        />
      )}

      {phase === 'result' && result?.concern && (
        <div className="v2-ack-zone"><SupportCard onClose={onBack} /></div>
      )}
      {phase === 'result' && !result?.concern && (
        <div className="v2-ack-zone">
          {result?.validated && result.reflectBack && (
            <p className="v2-ack-mirror">{result.reflectBack}</p>
          )}
          {!result?.validated && (
            <p className="v2-ack-mirror soft">You stayed with {part.name} for a moment. That counts.</p>
          )}
          {canGoDeeper && <p className="v2-ack-invite">{result.inviteDeeper}</p>}
          {!canGoDeeper && result?.inviteDeeper && (
            <p className="v2-ack-invite soft">You’ve really stayed with this — that’s enough for tonight.</p>
          )}

          <ThreadSoFar thread={thread} />

          <div className="v2-ack-actions">
            {canGoDeeper && (
              <button type="button" className="v2-ack-btn" onClick={sayMore}>Say more</button>
            )}
            <button type="button" className="v2-ack-btn ghost" onClick={onBack}>Done</button>
          </div>
        </div>
      )}
    </section>
  );
}
