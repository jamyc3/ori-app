// Ori v2 — capture screen (text first, dictation on tap).
//
// Full-viewport surface that replaces Today when the user taps the orb or
// the "Prefer to write it down" button.
//   - Prompt + textarea + draft autosave + Done.
//   - On Done, persist to the shared journal repo via repoAdd (same shape
//     and storage v1 uses, so v1's analyze pipeline picks it up next time
//     CPI mounts — no data divergence, no double-spend on Claude calls).
//   - The mic toggles the shared useVoice hook (same Deepgram engine as
//     Listen): finalized chunks append into the textarea where they can
//     be edited; interim words preview in the status line. Environments
//     without voice support simply don't render the mic.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './styles/capture.css';
import { saveTodayEntry } from './saveEntry.js';
import { useVoice, reflectSttLanguage } from '../integrations/deepgram.js';
import { t } from './i18n.js';
import { CrisisHelpFooter } from './CrisisSupport.jsx';
import { collectLowConf, mergeLowConf } from '../voiceConfidence.js';
import { buildKeyterms } from '../voiceVocabulary.js';
import { loadRepo } from '../engine.js';

const DRAFT_KEY = 'cpi_v2_capture_draft';
const PROMPT_PLACEHOLDER =
  'Write as much or as little as you like — Ori reads it the same way it listens.';

// Drafts carry their own start time so a note begun before midnight and finished
// after it still dates to the day it started. Stored as JSON now; old bare-string
// drafts are read back transparently (startedAt unknown → null).
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return { text: '', startedAt: null };
    if (raw[0] !== '{') return { text: raw, startedAt: null }; // legacy bare string
    const o = JSON.parse(raw);
    return { text: typeof o?.text === 'string' ? o.text : '', startedAt: o?.startedAt ?? null };
  } catch {
    return { text: '', startedAt: null };
  }
}

function saveDraft(text, startedAt) {
  try {
    if (text.trim()) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, startedAt }));
    } else {
      localStorage.removeItem(DRAFT_KEY);
    }
  } catch {
    // Storage full or unavailable — silent fall-through, the user can still submit.
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // No-op.
  }
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
function IconMic({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

export default function Capture({ onBack, onSubmitted, seedText }) {
  // Precedence: an explicit seed (e.g. transcript from Listen → write
  // instead) wins over any saved draft so the user sees their just-spoken
  // words and can edit them. Otherwise restore the autosaved draft.
  const draft0 = useMemo(() => loadDraft(), []);
  const [text, setText] = useState(() => {
    if (seedText && seedText.trim()) return seedText;
    return draft0.text;
  });
  // When this capture session began — drives the entry's date (cross-midnight
  // safe). A resumed draft keeps its ORIGINAL start; otherwise it's now (open).
  const [startedAt] = useState(() => draft0.startedAt || Date.now());
  const [status, setStatus] = useState(text ? (seedText ? t('From your voice', 'তোমার কথা থেকে') : t('Draft loaded', 'খসড়া তোলা হয়েছে')) : '');
  const textareaRef = useRef(null);
  const saveTimer = useRef(null);
  // Words Deepgram was unsure of, accumulated across the dictation so the saved
  // entry can faintly flag them for a one-tap fix in the Day view.
  const lowConfRef = useRef([]);

  // Dictation — finalized chunks land in the textarea like typed words,
  // so editing and draft autosave behave identically for voice and keys.
  const handleVoiceResult = useCallback((chunk, meta) => {
    setText((prev) => (prev.trim() ? `${prev.trim()} ${chunk}` : chunk));
    lowConfRef.current = mergeLowConf(lowConfRef.current, collectLowConf(meta?.words));
  }, []);
  // The user's recurring names, fed to Deepgram so they stop being misheard.
  // Built once per open from the journal they've already written.
  const keyterms = useMemo(() => buildKeyterms(loadRepo().entries), []);
  // autoResume so a dictation interrupted by lock-screen / a notification on iOS
  // self-heals the mic on return, instead of coming back to a dead, silent input
  // (the same watchdog Listen relies on — Capture is a voice path too).
  const { listening, interim, supported, error: voiceError, toggle, flushPending } = useVoice(handleVoiceResult, { autoResume: true, keyterms, language: reflectSttLanguage() });

  // Focus the textarea on mount so the user can type immediately.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Debounced draft autosave on every change.
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveDraft(text, startedAt);
      setStatus(text.trim() ? t('Draft saved', 'খসড়া রাখা হলো') : '');
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [text, startedAt]);

  const canSubmit = text.trim().length > 0 || Boolean(interim && interim.trim());

  const handleSubmit = async () => {
    if (!canSubmit) return;
    // Batch-fallback mode: the last window of speech may still be raw PCM —
    // await its transcript BEFORE saving, or it lands after unmount and is lost.
    const late = await flushPending();
    if (listening) toggle();
    // Words still in `interim` are real speech — keep them on submit regardless
    // of `listening`. A user who taps the mic off (listening→false) before Done
    // can still have their last, not-yet-finalized phrase sitting in `interim`;
    // gating on `listening` silently dropped it. (Matches Listen.jsx.)
    const full = `${text} ${interim || ''} ${late || ''}`.replace(/\s+/g, ' ').trim();
    if (!full) return;
    saveTodayEntry(full, { lowConf: lowConfRef.current, startedAt });
    lowConfRef.current = [];
    clearDraft();
    setText('');
    onSubmitted?.();
  };

  const handleMic = () => {
    if (!supported) return;
    toggle();
    textareaRef.current?.focus();
  };

  const statusLine = listening
    ? (interim ? `… ${interim.slice(-80)}` : t('Listening…', 'শুনছি…'))
    : (voiceError ? voiceError : status);

  return (
    <div className="v2-capture">
      <button type="button" className="v2-backrow" onClick={onBack} aria-label={t('Back to Today', 'আজকে ফিরে যাও')}>
        <IconChevronLeft />
        <span>{t('Today', 'আজ')}</span>
      </button>

      <h1 className="v2-write-prompt">{t('How was today?', 'আজ কেমন কাটল?')}</h1>

      <textarea
        ref={textareaRef}
        className="v2-write-area"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t(PROMPT_PLACEHOLDER, 'যতটা খুশি লেখো — অরি ঠিক যেমন শোনে, তেমন করেই পড়ে।')}
        aria-label={t('Write about your day', 'তোমার দিনের কথা লেখো')}
      />

      <div className="v2-write-foot">
        <span className={`v2-write-status${listening ? ' listening' : ''}`}>{statusLine}</span>
        {supported && (
          <button
            type="button"
            className={`v2-write-mic${listening ? ' on' : ''}`}
            onClick={handleMic}
            aria-label={listening ? t('Stop dictating', 'বলা থামাও') : t('Dictate instead of typing', 'লেখার বদলে বলো')}
            aria-pressed={listening}
          >
            <IconMic />
          </button>
        )}
        <button
          type="button"
          className="v2-pill-btn"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {t('Done', 'হয়ে গেছে')}
          <IconArrow />
        </button>
      </div>
      <CrisisHelpFooter />
    </div>
  );
}
