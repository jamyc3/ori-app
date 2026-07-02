// Ori v2 — Today landing.
//
// Greeting header (time-of-day + date + day count, Inbox icon with unread
// badge) → pending-letter banner → "How was today?" → breathing orb →
// "Tap to speak" → "Prefer to write it down" → three-row ring legend
// (Reserves · Demands · Form) with per-ring score + state word, per the
// design's Today screen. Reflect mode renders a smaller sage orb and a
// Form-only legend — Reserves (wearable) and Demands (calendar) have no
// source in words-only mode, so they don't appear at all.
//
// Honesty: ring values come from real engine sources (Oura sleepScore for
// Reserves, WHO-5 for Form, and for Demands the observed contributors in
// demandsData.js — decisions and context shifts counted from the analyzed
// writing, meeting load from a connected calendar). classifyBucket keeps
// every ring on "Warming up" until its own 10-day baseline exists, and no
// score number is shown before that. The day counter is the count of days
// since the first journal entry — observed, not estimated. The Inbox badge
// counts letters that exist and haven't been opened yet.

import { useEffect, useMemo, useState } from 'react';
import './styles/today.css';
import { classifyBucket } from '../bucket-state.js';
import { recentWho5 } from '../who5.js';
import { detectCrisis, loadRepo } from '../engine.js';
import { reflectSttLanguage } from '../integrations/deepgram.js';
import { t } from './i18n.js';
import { buildDemandsLookup } from './demandsData.js';
import { ProvenanceChip } from './Provenance.jsx';
import { CrisisHelpFooter } from './CrisisSupport.jsx';

const BUCKET_META = {
  reserves: { label: 'Reserves', dot: 'amber' },
  demands:  { label: 'Demands',  dot: 'ink' },
  form:     { label: 'Form',     dot: 'sage' },
};

// LOCAL date — toISOString would flip to tomorrow during the evening
// (UTC midnight), which is exactly when Ori is used.
function todayIso(when = new Date()) {
  return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
}

// Oura history lives in localStorage as a date-keyed map.
function loadOuraHistoryMap() {
  try {
    const raw = localStorage.getItem('cpi_oura_history');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function deriveBucketInputs(bucket) {
  if (bucket === 'reserves') {
    const map = loadOuraHistoryMap();
    const dates = Object.keys(map).sort();
    const recent = dates
      .slice(-30)
      .map((d) => map[d]?.sleepScore)
      .filter((v) => typeof v === 'number');
    const isoToday = todayIso();
    const todayVal = typeof map[isoToday]?.sleepScore === 'number'
      ? map[isoToday].sleepScore
      : (recent.length > 0 ? recent[recent.length - 1] : null);
    return { today: todayVal, recent };
  }
  if (bucket === 'form') {
    const entries = recentWho5(30) || [];
    const recent = entries.map((e) => e?.score).filter((v) => typeof v === 'number');
    const today = recent.length > 0 ? recent[recent.length - 1] : null;
    return { today, recent };
  }
  // Demands — observed contributors per day (decisions + context shifts
  // from the analyzed writing, meeting load from a connected calendar),
  // through the same lookup Ring detail and Day view chart from.
  const lookup = buildDemandsLookup();
  const isoToday = todayIso();
  const recent = [];
  const base = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    const v = lookup(todayIso(d));
    if (typeof v === 'number') recent.push(v);
  }
  const todayVal = lookup(isoToday) ?? (recent.length > 0 ? recent[recent.length - 1] : null);
  return { today: todayVal, recent };
}

// Letters that exist but have never been opened (Letter.jsx writes the
// cpi_letter_read_<date> mark on open).
function countUnreadLetters() {
  let count = 0;
  try {
    // Match the Inbox's 7-day archive window: letters older than a week stop
    // counting toward the glow, so an unread letter doesn't nag forever.
    const cutoff = todayIso(new Date(Date.now() - 7 * 86400000));
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = k && k.match(/^cpi_letter_(\d{4}-\d{2}-\d{2})$/);
      if (m && m[1] >= cutoff && !localStorage.getItem(`cpi_letter_read_${m[1]}`)) count++;
    }
  } catch {
    // Storage unavailable — no badge.
  }
  return count;
}

// "Sam's evenings" → "Sam"; any other garden name passes through.
function greetingName() {
  try {
    const name = (localStorage.getItem('cpi_garden_name') || '').trim();
    const m = name.match(/^(.+?)['’]s\s+evenings$/i);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

function greetingWord(when = new Date()) {
  const h = when.getHours();
  if (h < 12) return t('Good morning', 'শুভ সকাল');
  if (h < 18) return t('Good afternoon', 'শুভ দুপুর');
  return t('Good evening', 'শুভ সন্ধ্যা');
}

// Day count since the first journal entry, inclusive. Null until an entry
// exists — we never invent a streak.
function dayNumber() {
  try {
    const raw = localStorage.getItem('cpi_journal_repo');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed?.entries) ? parsed.entries
      : (Array.isArray(parsed) ? parsed : []);
    let earliest = null;
    for (const e of entries) {
      let iso = null;
      if (typeof e?.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(e.date)) {
        iso = e.date.slice(0, 10);
      } else if (e?.createdAt) {
        const d = new Date(e.createdAt);
        if (!isNaN(d.getTime())) iso = todayIso(d);
      }
      if (iso && (!earliest || iso < earliest)) earliest = iso;
    }
    if (!earliest) return null;
    const [y, m, d] = earliest.split('-').map((p) => parseInt(p, 10));
    const start = new Date(y, m - 1, d);
    const now = new Date();
    const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - start) / 86400000) + 1;
    return days > 0 ? days : null;
  } catch {
    return null;
  }
}

function readMode() {
  try {
    return localStorage.getItem('cpi_mode') === 'reflect' ? 'reflect' : 'full';
  } catch {
    return 'full';
  }
}

function IconMic({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="4" width="6" height="11" rx="3" />
      <path d="M5 11c0 3.9 3.1 7 7 7s7-3.1 7-7" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}
function IconPen() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21l3-1 11-11-2-2L4 18z" />
      <path d="M14 6l4 4" />
    </svg>
  );
}
function IconInbox() {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 13l2.5-7.5A2 2 0 0 1 7.4 4h7.2a2 2 0 0 1 1.9 1.5L19 13" />
      <path d="M3 13h4l1.2 2.2h5.6L15 13h4v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export default function Today({ onCapture, onListen, onOpenRing, onOpenInbox, onOpenSources }) {
  const [unread, setUnread] = useState(countUnreadLetters);
  // Adaptive nudge: if the user lingers on Today without acting, the orb and
  // the write pill start to sparkle after ~10s, inviting them to begin.
  // Any touch/scroll/keypress resets the timer — they're clearly engaged.
  const [idle, setIdle] = useState(false);
  // Bumps whenever underlying data changes while Today stays mounted —
  // a wearable sync finishing, a check-in saved, the tab refocusing.
  // Without this the rings compute once at mount and sit on "warming
  // up" until a hard reload, even though the data already landed.
  const [dataTick, setDataTick] = useState(0);

  // Re-read on focus, and the moment the letter engine announces a fresh
  // letter (same-tab writes don't fire the storage event).
  useEffect(() => {
    const refresh = () => {
      setUnread(countUnreadLetters());
      setDataTick((t) => t + 1);
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('cpi:letter-written', refresh);
    window.addEventListener('cpi:wearable-synced', refresh);
    window.addEventListener('cpi:who5-updated', refresh);
    window.addEventListener('cpi:calendar-synced', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('cpi:letter-written', refresh);
      window.removeEventListener('cpi:wearable-synced', refresh);
      window.removeEventListener('cpi:who5-updated', refresh);
      window.removeEventListener('cpi:calendar-synced', refresh);
    };
  }, []);

  // Idle-sparkle timer — re-arm on any real activity, fire after 10s of stillness.
  useEffect(() => {
    let t;
    const arm = () => {
      clearTimeout(t);
      setIdle(false);
      t = setTimeout(() => setIdle(true), 8000);
    };
    arm();
    const onActivity = () => arm();
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('touchstart', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('touchstart', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, []);

  const mode = readMode();
  const isReflect = mode === 'reflect';

  const buckets = useMemo(() => {
    // Reflect is words-only: Reserves (wearable) and Demands (calendar)
    // have no source there, so only Form — fed by the check-ins — shows.
    const ids = isReflect ? ['form'] : ['reserves', 'demands', 'form'];
    return ids.map((bucket) => {
      const { today, recent } = deriveBucketInputs(bucket);
      const result = classifyBucket({ bucket, today, recent });
      // Score shown only when today's value is a real reading from its
      // source (Oura / WHO-5) — never for Warming up.
      const score = typeof today === 'number' && result.state !== 'Warming up'
        ? Math.round(today)
        : null;
      return { bucket, score, ...result };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReflect, dataTick]);

  // Crisis surfacing — v1's detectCrisis over today's entries. When it
  // hits, real resources come before everything else on the screen.
  const crisis = useMemo(() => {
    try {
      const iso = todayIso();
      const entries = (loadRepo().entries || []).filter((e) => {
        const d = typeof e?.date === 'string' ? e.date.slice(0, 10)
          : (e?.createdAt ? todayIso(new Date(e.createdAt)) : null);
        return d === iso;
      });
      return detectCrisis(entries).length > 0;
    } catch {
      return false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataTick]);

  const name = greetingName();
  const dayN = dayNumber();
  const now = new Date();
  const dateLine = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    + (dayN ? ` · day ${dayN}` : '');

  // The orb opens voice listening; the pen pill opens text capture. Both
  // routes converge on the same repoAdd path via the shared saveTodayEntry
  // helper (see Listen.jsx, Capture.jsx).
  const handleOrb = () => (onListen || onCapture)?.();
  const handleWrite = () => onCapture?.();
  // Bengali has no on-screen keyboard for most testers and typing isn't wired
  // for the bn letter path yet, so a Bengali user gets a voice-only hero —
  // the "Prefer to write it down" pill is hidden while বাংলা is selected.
  const isBengali = reflectSttLanguage() === 'bn';
  // Reflect mode now uses the SAME full-size orb as Full mode (user decision
  // 2026-06-30): the old 140px "small sage orb" read as undersized — a tiny mic
  // floating in a lot of empty space on a real phone. So no mode shrinks the orb.
  const orbSmall = false;
  const handleRingTap = (bucketId) => () => onOpenRing?.(bucketId);

  return (
    <>
      {/* Greeting header — design's .hdr with greeting, date · day N, Inbox. */}
      <div className="v2-today-hdr">
        <div>
          <div className="v2-greeting">{greetingWord(now)}{name ? `, ${name}` : ''}</div>
          <div className="v2-date">{dateLine}</div>
        </div>
        <button
          type="button"
          data-tour="inbox"
          className={`v2-inbox-btn${unread > 0 ? ' has-unread' : ''} ${unread >= 6 ? 'lvl-3' : unread >= 3 ? 'lvl-2' : unread > 0 ? 'lvl-1' : ''}`.trim()}
          aria-label={unread > 0 ? `${t('Open Inbox', 'ইনবক্স খোলো')} — ${unread} ${t('unread', 'অপঠিত')}` : t('Open Inbox', 'ইনবক্স খোলো')}
          onClick={onOpenInbox}
        >
          <IconInbox />
          {/* No count number — the glow + fill level says "letters are
              waiting"; the exact number lives inside the inbox. */}
        </button>
      </div>

      {crisis && (
        <div className="v2-crisis" role="alert">
          <b>If tonight is heavy, you don't have to carry it alone.</b>
          <span>
            <a href="tel:988">Call or text 988 (US)</a> · <a href="sms:741741&body=HOME">text HOME to 741741</a> · <a href="https://findahelpline.com" target="_blank" rel="noopener noreferrer">find a helpline anywhere</a>
          </span>
          <i>Ori is a journal, not a crisis service — these are real people who can help right now.</i>
        </div>
      )}

      {/* The letter's status lives in the Inbox icon now (its badge + fill),
          so the old "letter arrives at 8 PM" banner is gone — it duplicated
          what the inbox already says. */}

      {/* Hero — orb, cue, write toggle, then the ring legend just beneath.
          The whole cluster sits a touch above centre so the rings read right
          after "Prefer to write it down" rather than at the screen's edge.
          (No "How was today?" heading — the orb and cue carry the invite.)
          When the user lingers, .is-idle makes the orb and write pill sparkle. */}
      <div className="v2-orbring">
        <button
          type="button"
          data-tour="voice"
          className={`v2-orb${orbSmall ? ' reflect' : ''}${idle ? ' is-idle' : ''}`}
          onClick={handleOrb}
          aria-label={t('Tap to speak about today', 'আজকের কথা বলতে চাপো')}
        >
          <span className="v2-orb-aura" aria-hidden="true" />
          <span className="v2-orb-ring" aria-hidden="true" />
          <span className="v2-orb-core">
            <IconMic size={orbSmall ? 28 : 42} />
          </span>
        </button>

        {!isBengali && (
          <button
            type="button"
            data-tour="write"
            className={`v2-hero-write${idle ? ' is-idle' : ''}`}
            onClick={handleWrite}
          >
            <IconPen />
            Prefer to write it down
          </button>
        )}

        {/* Ring legend — one line, dot + name only. No numbers here: tapping a
            ring opens its detail, which is where the readings live. */}
        <div className="v2-legend">
          {buckets.map(({ bucket }) => {
            const meta = BUCKET_META[bucket];
            return (
              <div key={bucket} className="v2-lg-pair">
                <button
                  type="button"
                  className="v2-lg-row"
                  onClick={handleRingTap(bucket)}
                  aria-label={`${meta.label} — open detail`}
                >
                  <span className={`v2-lg-dot ${meta.dot}`} />
                  <span className="v2-lg-label">{meta.label}</span>
                </button>
                <ProvenanceChip metric={bucket} className="v2-lg-prov" />
              </div>
            );
          })}
        </div>

        {/* When every ring is dark, say why — and where to fix it. */}
        {!isReflect && buckets.every((b) => b.score == null) && (
          <button type="button" className="v2-legend-hint" onClick={() => onOpenSources?.()}>
            {(() => {
              try {
                const hasOura = Boolean(localStorage.getItem('cpi_oura_access_token'));
                const hasApple = localStorage.getItem('apple_health_granted') === 'true';
                const hasNights = Object.keys(JSON.parse(localStorage.getItem('cpi_oura_history') || '{}')).length > 0;
                if (!hasOura && !hasApple) return 'The rings light as data arrives — connect Oura or Apple Health in Sources →';
                if (!hasNights) return 'Connected — open Sources and tap Sync now to pull your sleep →';
                return 'A few more days and these come alive — about ten nights and they find your pattern';
              } catch {
                return 'The rings light as data arrives — connect Oura or Apple Health in Sources →';
              }
            })()}
          </button>
        )}
      </div>
      <CrisisHelpFooter />
    </>
  );
}
