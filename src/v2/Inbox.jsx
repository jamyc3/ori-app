// Ori v2 — Inbox.
//
// Tonight (pending or fresh letter) + Earlier (past letters). Replaces the
// v1 "Today's Reading Card" pinned at the top of Analyze per the gap doc
// decision: the pending letter lives in the Inbox now.
//
// Tonight's pending/ready card, behavioral alerts, and a chronological
// list of past letters scanned from localStorage (cpi_letter_YYYY-MM-DD
// keys). Alerts are L3 observed claims gated by the Wilson-CI trigger
// layer (inboxAlerts.js): they fire only when the share-of-days math
// clears the same lines the patterns drawer uses, name their source, and
// are marked seen on view so each episode alerts once.

import { useEffect, useMemo } from 'react';
import './styles/inbox.css';
import { currentInboxAlerts, markAlertsSeen } from './inboxAlerts.js';
import { screenHighToday, screenAlertDay } from './screenTime.js';
import { loadWho5History } from '../who5.js';
import { PARTS_LIB } from '../LetterReading.jsx';
import { ProvenanceChip } from './Provenance.jsx';
import { ymd } from '../date-util.js';
import { missedLetterDays } from './letterEngine.js';
import { CrisisHelpFooter } from './CrisisSupport.jsx';
import { IconReflectSpiral } from './ReflectPage.jsx';

function todayKey() {
  return ymd(new Date());
}

// The letter time the user picked in onboarding ("9 PM", "Sunrise", …).
function letterTimePref() {
  try {
    return localStorage.getItem('cpi_reflect_time') || '9 PM';
  } catch {
    return '9 PM';
  }
}

function listLetterKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^cpi_letter_\d{4}-\d{2}-\d{2}$/.test(k)) keys.push(k);
    }
  } catch {
    // Storage unavailable — return empty list.
  }
  return keys.sort().reverse(); // newest first by ISO key sort
}

function readLetterPreview(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const letter = parsed?.result?.a?.letter;
    if (!letter) return null;
    const firstPara = Array.isArray(letter.paragraphs) ? letter.paragraphs[0] : null;
    const preview = (typeof firstPara === 'string' ? firstPara.trim() : '').slice(0, 110);
    return {
      key,
      date: key.replace(/^cpi_letter_/, ''),
      headline: typeof letter.headline === 'string' ? letter.headline.trim() : null,
      preview,
    };
  } catch {
    return null;
  }
}

function formatLetterDate(iso) {
  const parts = iso.split('-').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return iso;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4l-6 6 6 6" />
    </svg>
  );
}
function IconLetter() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 7 9-7" />
    </svg>
  );
}

export default function Inbox({ onClose, onOpenLetter, onOpenReflect }) {
  const today = todayKey();
  const allKeys = useMemo(() => listLetterKeys(), []);
  const todayLetterExists = allKeys.includes(`cpi_letter_${today}`);

  // Behavioral alerts — computed once per open, marked seen on view so
  // an episode alerts once rather than every visit.
  const alerts = useMemo(() => {
    try {
      return currentInboxAlerts(loadWho5History(), {
        screenHigh: screenHighToday(),   // false until the Screen Time signal lands
        today: screenAlertDay(),
      });
    } catch { return []; }
  }, []);
  useEffect(() => {
    if (alerts.length) markAlertsSeen(alerts.map((a) => a.id));
  }, [alerts]);

  const alertTitle = (a) => {
    if (a.kind === 'part-stable') {
      const name = PARTS_LIB?.[a.partId]?.name || a.partId;
      return `${name} has settled in`;
    }
    if (a.kind === 'part-untended') {
      const name = PARTS_LIB?.[a.partId]?.name || a.partId;
      return `${name} keeps showing up`;
    }
    return a.title;
  };

  const earlier = useMemo(() => {
    // Letters older than 7 days are archived out of the Inbox — they still live
    // in the Journal, the inbox just stops holding onto them. Keys are local
    // YYYY-MM-DD, so a lexical >= against the cutoff date is a date comparison.
    const cutoff = ymd(new Date(Date.now() - 7 * 86400000));
    return allKeys
      .filter((k) => k !== `cpi_letter_${today}`)
      .filter((k) => k.replace(/^cpi_letter_/, '') >= cutoff)
      .slice(0, 30)
      .map(readLetterPreview)
      .filter(Boolean);
  }, [allKeys, today]);

  // Days with words but no letter yet — nights the app wasn't open at the letter
  // hour. They're not lost: the letter waits here to be read on demand. Look back
  // far enough to surface a long journal (months/years of entries), not just the
  // last week — otherwise a fat journal shows an almost-empty inbox.
  const waiting = useMemo(() => {
    try { return missedLetterDays(400); } catch { return []; }
  }, []);

  return (
    <section className="v2-inbox-sheet">
      <button type="button" className="v2-backrow" onClick={onClose} aria-label="Close Inbox">
        <IconChevronLeft />
        <span>Today</span>
      </button>

      <h1 className="v2-inbox-title">Inbox</h1>

      <div className="v2-inbox-sec">Tonight</div>
      {todayLetterExists ? (
        <button
          type="button"
          className="v2-inbox-item"
          onClick={() => onOpenLetter?.(today)}
        >
          <span className="v2-ii-ic"><IconLetter /></span>
          <span className="v2-ii-tx">
            <b>Today's letter is ready</b>
            <span>Tap to read.</span>
          </span>
        </button>
      ) : (
        <div className="v2-inbox-item pending">
          <span className="v2-ii-dot" />
          <span className="v2-ii-tx">
            <b>Arrives around {letterTimePref()}</b>
            <span>Your letter is still being written from today.</span>
          </span>
        </div>
      )}

      {waiting.length > 0 && (
        <>
          <div className="v2-inbox-sec" style={{ marginTop: 28 }}>Ready to read</div>
          {waiting.slice(0, 120).map((iso) => (
            <button
              key={iso}
              type="button"
              className="v2-inbox-item"
              onClick={() => onOpenLetter?.(iso)}
            >
              <span className="v2-ii-ic"><IconLetter /></span>
              <span className="v2-ii-tx">
                <b>{formatLetterDate(iso)}</b>
                <span>Your letter is waiting — tap to read it.</span>
              </span>
            </button>
          ))}
        </>
      )}

      {alerts.length > 0 && (
        <>
          <div className="v2-inbox-sec" style={{ marginTop: 28 }}>
            Noticed
            {' '}<ProvenanceChip metric="patterns" />
          </div>
          {alerts.map((a) => (
            a.kind === 'part-untended' && onOpenReflect ? (
              // The one tappable alert: a tending invitation opens the Reflect
              // page for that part. The rest are quiet observations (static).
              <button
                key={a.id}
                type="button"
                className="v2-inbox-item"
                onClick={() => onOpenReflect(a.partId)}
              >
                <span className="v2-ii-ic"><IconReflectSpiral size={16} /></span>
                <span className="v2-ii-tx">
                  <b>{alertTitle(a)}</b>
                  <span>{a.body}</span>
                  <i className="v2-ii-src">{a.source}</i>
                </span>
              </button>
            ) : (
              <div key={a.id} className="v2-inbox-item static">
                <span className="v2-ii-dot" />
                <span className="v2-ii-tx">
                  <b>{alertTitle(a)}</b>
                  <span>{a.body}</span>
                  <i className="v2-ii-src">{a.source}</i>
                </span>
              </div>
            )
          ))}
        </>
      )}

      <div className="v2-inbox-sec" style={{ marginTop: 28 }}>Earlier</div>
      {earlier.length === 0 ? (
        <>
          <p className="v2-inbox-empty">No past letters yet. Each evening's letter lands here.</p>
          <button
            type="button"
            className="v2-inbox-item"
            onClick={() => onOpenLetter?.('sample')}
          >
            <span className="v2-ii-ic"><IconLetter /></span>
            <span className="v2-ii-tx">
              <b>Read a sample letter</b>
              <span>What an evening's letter looks like — parts and all.</span>
            </span>
          </button>
        </>
      ) : (
        earlier.map((row) => (
          <button
            key={row.key}
            type="button"
            className="v2-inbox-item"
            onClick={() => onOpenLetter?.(row.date)}
          >
            <span className="v2-ii-ic"><IconLetter /></span>
            <span className="v2-ii-tx">
              <b>{formatLetterDate(row.date)}</b>
              <span>{row.headline || row.preview || 'A letter from Ori.'}</span>
            </span>
          </button>
        ))
      )}
      <CrisisHelpFooter />
    </section>
  );
}
