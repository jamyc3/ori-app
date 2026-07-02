// Ori v2 — voice listening surface.
//
// Full-viewport replaces Today when the user taps the orb. Wires the shared
// useVoice hook from integrations/deepgram.js — the same code v1's Analyze
// tab uses, so the live transcription engine is unchanged. We consume; we
// don't modify (OAuth boundary applies broadly to integrations/).
//
// Flow:
//   · Mount → auto-start mic. Interim transcript streams in faded ink;
//     finalized chunks land in solid ink (concatenated into `finalText`).
//   · Stop button → submit `finalText` via shared saveTodayEntry helper →
//     Shell flips to Handoff. Same code path as the write capture's Done.
//   · "Write instead" → escapes to Capture with the accumulated transcript
//     as seedText, where the user can edit before submitting.
//   · Unsupported (no Deepgram key, no MediaRecorder) → renders a polite
//     fallback and routes the user to the write capture instead.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './styles/listen.css';
import { useVoice, reflectSttLanguage } from '../integrations/deepgram.js';
import { t, uiLang } from './i18n.js';
import { saveTodayEntry } from './saveEntry.js';
import { CrisisHelpFooter } from './CrisisSupport.jsx';
import { collectLowConf, mergeLowConf } from '../voiceConfidence.js';
import { buildKeyterms } from '../voiceVocabulary.js';
import { loadRepo } from '../engine.js';

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4l-6 6 6 6" />
    </svg>
  );
}

function Wave({ paused }) {
  return (
    <div className={`v2-wave${paused ? ' paused' : ''}`} aria-hidden="true">
      <i /><i /><i /><i /><i /><i />
    </div>
  );
}

export default function Listen({ onBack, onSubmitted, onWriteInstead }) {
  const [finalText, setFinalText] = useState('');
  // When this voice session opened — drives the entry's date so a reflection
  // spoken across midnight stays on the day it began (cross-midnight safe).
  const [startedAt] = useState(() => Date.now());
  // Words Deepgram was unsure of, accumulated across the dictation so the saved
  // entry can faintly flag them for a one-tap fix in the Day view.
  const lowConfRef = useRef([]);

  // The most-recent finalized chunk, announced on its own (small) live region —
  // see the transcript box note below.
  const [lastChunk, setLastChunk] = useState('');

  // Each finalized chunk from Deepgram is appended to the running transcript.
  const handleResult = useCallback((chunk, meta) => {
    setFinalText((prev) => (prev ? `${prev} ${chunk}`.replace(/\s+/g, ' ') : chunk));
    setLastChunk(chunk);
    lowConfRef.current = mergeLowConf(lowConfRef.current, collectLowConf(meta?.words));
  }, []);

  // The user's recurring names, fed to Deepgram so they stop being misheard.
  const keyterms = useMemo(() => buildKeyterms(loadRepo().entries), []);
  // autoResume: if the phone sleeps mid-thought, a fresh mic warms up and picks
  // back up the moment you return — never a silent button.
  const { listening, warming, interim, supported, error, toggle, flushPending } = useVoice(handleResult, { autoResume: true, keyterms, language: reflectSttLanguage() });

  // The transcript lives in one bounded, scrollable box (not free-flowing text
  // that grows off-screen and pushes the stop button away). Keep it pinned to
  // the newest words as they stream in, so the latest line is always visible.
  const scrollRef = useRef(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [finalText, interim]);

  // Auto-start the mic on mount when supported. If permission is denied,
  // useVoice reports it via `error`; the user can retry via the stop/start
  // button (toggle) or escape to write mode.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    // Guard on a ref, not the `listening` state — `toggle()`→`start()` is async,
    // so under StrictMode's mount→cleanup→mount the second run still sees stale
    // `listening:false` and starts a SECOND mic/socket, orphaning the first.
    // Once per mount, full stop.
    if (supported && !autoStartedRef.current && !listening) {
      autoStartedRef.current = true;
      toggle();
    }
    // Cleanup happens inside useVoice when this component unmounts (its
    // own useEffect on listening/cleanup chain handles socket + stream
    // shutdown). No need to mirror that here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  const handleStop = async () => {
    // In batch-fallback mode (provider outage) the last window of speech is
    // still un-transcribed PCM — await it BEFORE saving, or the closing
    // sentence would arrive after this screen unmounted and be dropped.
    const late = await flushPending();
    if (listening) toggle();
    // Deepgram finalizes with a lag — words still in `interim` are real
    // speech the user expects to be kept. Submit both.
    const text = `${finalText} ${interim || ''} ${late || ''}`.replace(/\s+/g, ' ').trim();
    if (text) {
      saveTodayEntry(text, { lowConf: lowConfRef.current, startedAt });
      lowConfRef.current = [];
      onSubmitted?.();
    } else {
      // Nothing captured — the stop square means "close", so close back
      // to Today. Routing to the write screen here read as a wrong turn.
      onBack?.();
    }
  };

  const handleWriteInstead = () => {
    if (listening) toggle();
    onWriteInstead?.(`${finalText} ${interim || ''}`.replace(/\s+/g, ' ').trim());
  };

  // Unsupported environments: render a graceful escape hatch.
  if (!supported) {
    return (
      <div className="v2-listen">
        <button type="button" className="v2-backrow" onClick={onBack} aria-label={t('Back to Today', 'আজকে ফিরে যাও')}>
          <IconChevronLeft />
          <span>{t('Today', 'আজ')}</span>
        </button>
        <div className="v2-listen-center">
          <div className="v2-listen-transcript">
            <span className="v2-empty-cue">
              {t("Voice isn't available in this browser. You can still write today.", 'এই ব্রাউজারে ভয়েস কাজ করছে না। তুমি লিখে রাখতে পারো।')}
            </span>
          </div>
        </div>
        <div className="v2-listen-foot">
          <button type="button" className="v2-pill-btn" onClick={handleWriteInstead}>
            {t('Write instead', 'বরং লিখি')}
          </button>
        </div>
      </div>
    );
  }

  const transcriptContent = (() => {
    if (finalText || interim) {
      return (
        <>
          {finalText}
          {finalText && interim ? ' ' : ''}
          {interim ? <span className="v2-pend">{interim}</span> : null}
        </>
      );
    }
    return <span className="v2-empty-cue">{t('Tell me about today…', 'আজকের কথা বলো…')}</span>;
  })();

  // Match what handleStop actually submits (it includes interim) — otherwise the
  // button is labelled "Close" while a tap saves the entry, misleading AT users.
  const canStop = Boolean(`${finalText} ${interim || ''}`.trim());

  return (
    <div className="v2-listen">
      <div className="v2-listen-head">
        <span className="v2-listen-eyebrow">{warming ? t('Warming up…', 'প্রস্তুত হচ্ছে…') : listening ? t('Listening', 'শুনছি') : t('Paused', 'থেমে আছে')}</span>
        {/* Bengali is voice-only for now (no on-screen keyboard wired), so the
            optional "write instead" toggle is hidden — the unsupported-browser
            fallback above still offers writing if the mic genuinely can't run. */}
        {uiLang() !== 'bn' && (
          <button
            type="button"
            className="v2-listen-write-toggle"
            onClick={handleWriteInstead}
          >
            write instead
          </button>
        )}
      </div>

      <div className="v2-listen-center">
        <Wave paused={!listening} />
        {/* The visible transcript streams interim words many times a second; if
            it were a live region a screen reader would re-read the whole growing
            block on every frame. Keep it silent and announce only the latest
            finalized chunk through a tiny off-screen polite region. */}
        <div className="v2-listen-transcript" ref={scrollRef}>
          {transcriptContent}
        </div>
        <span
          aria-live="polite"
          style={{ position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}
        >
          {lastChunk}
        </span>
        {error ? <div className="v2-listen-error">{error}</div> : null}
      </div>

      <div className="v2-listen-foot">
        <span className="v2-listen-cue">
          {warming ? t('Reconnecting your mic…', 'মাইক আবার জুড়ছে…') : canStop ? t('Tap when you’re done', 'শেষ হলে চাপো') : t('Speak when you’re ready', 'তৈরি হলে বলো')}
        </span>
        {/* Never disabled: with words it submits, without it closes —
            a dead stop button stranded people when the mic failed. */}
        <button
          type="button"
          className="v2-stopbtn"
          onClick={handleStop}
          aria-label={canStop ? t('Stop and submit', 'থামো এবং জমা দাও') : t('Close', 'বন্ধ করো')}
        >
          <span className="v2-sq" />
        </button>
      </div>
      <CrisisHelpFooter />
    </div>
  );
}
