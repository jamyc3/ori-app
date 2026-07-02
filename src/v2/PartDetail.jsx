// Ori v2 — Per-Part detail screen.
//
// Hero (glyph + name + plain role label) → three stat cards (Familiarity, When
// it visits, Peaks on day-of-week) → "What it's holding" prose → Thank zone.
// Mirrors v1 commit 3911cc6 PartDetail.jsx semantics with v2 styling.
//
// USER-FACING COPY RULE: every string in these constants renders on screen, so
// it must stay in plain human language. The therapy model behind the parts
// (IFS / Schema-mode roles) lives only in the system prompt + knowledge-base,
// never here — no "Manager / Firefighter / Exile / Self-energy", no framework
// names, no methodology. Facts in everyday words, nothing the user must decode.

import { useCallback, useMemo, useRef, useState } from 'react';
import './styles/parts.css';
import './styles/reflect.css';
import {
  statsFor, appendThank, loadThanks, thankModeFor,
  STAGE_NEWCOMER, STAGE_REGULAR, STAGE_FREQUENT, STAGE_CONSTANT,
  THANK_MODE_THANK, THANK_MODE_TEND, THANK_MODE_RECEIVE,
} from '../part-history.js';
import { PARTS_LIB, partLabel, partDescOf } from '../LetterReading.jsx';
import { reflectSttLanguage } from '../integrations/deepgram.js';
import { IconReflectSpiral } from './ReflectPage.jsx';
import { reflectEnabled } from './AckReflect.jsx';
import { untendedPartIds } from './inboxAlerts.js';
import { ProvenanceChip } from './Provenance.jsx';

const STAGE_LABEL = {
  [STAGE_NEWCOMER]: 'Newcomer',
  [STAGE_REGULAR]:  'Regular',
  [STAGE_FREQUENT]: 'Frequent',
  [STAGE_CONSTANT]: 'Constant',
  stranger:         'Not yet seen',
};
const STAGE_NEXT = {
  stranger:         { next: 'Newcomer', at: 1  },
  [STAGE_NEWCOMER]: { next: 'Regular',  at: 3  },
  [STAGE_REGULAR]:  { next: 'Frequent', at: 8  },
  [STAGE_FREQUENT]: { next: 'Constant', at: 15 },
  [STAGE_CONSTANT]: { next: null,       at: null },
};


const HOLDING = {
  planner: {
    phrase: 'A quiet fear of things falling apart.',
    prose: "The planner isn't trying to control you — it's trying to keep the day legible so the parts underneath it (often the tender one) don't have to face chaos. Most weeks, it's the only reason a hard stretch didn't unravel.",
  },
  watcher: {
    phrase: 'A wish to belong.',
    prose: "The watcher is scanning so the part underneath doesn't get caught off-guard by rejection. It carries the social-safety load so the rest of you doesn't have to feel exposed.",
  },
  hesitant: {
    phrase: 'Energy preservation.',
    prose: "The hesitant one isn't running from challenge — it's protecting a part that knows it doesn't have the fuel right now. It buys time so the body can recover before facing the friction.",
  },
  seeker: {
    phrase: 'A request for relief.',
    prose: 'The seeker shows up when something underneath is asking for comfort and the gentle paths feel too slow. It picks the fastest soothe it can find — even when it knows the cost.',
  },
  tender: {
    phrase: 'Direct, unfiltered need.',
    prose: "Unlike the protectors, the tender one doesn't strategize — it just says what the body needs. When it shows up in a letter, something basic has been unmet long enough to break through.",
  },
  gentle: {
    phrase: 'Compassion for the other parts.',
    prose: "The gentle one isn't doing a job — it's the soft attention that holds the rest of you. It tends to arrive late in the day, once you've stopped pushing, and simply being with it is the point.",
  },
  witness: {
    phrase: 'Curious presence.',
    prose: "The witness watches without grading. It's the part that can sit with the planner's anxiety, the seeker's grabbing, the tender one's need — and not try to fix any of it.",
  },
  maker: {
    phrase: 'Creative spark.',
    prose: 'The maker arrives when the body is rested and the protectors have something quieter to do. It often shows up as a single sentence in your journal that says: I want to try…',
  },
};

// "What is this part?" — the plain-language grounding for someone exploring
// deeper. Every entry answers the same three questions in everyday words:
// what this part IS, when it tends to show up in YOUR words, and why Ori
// names it. Same copy rule as everything here: no framework names, no
// methodology, nothing to decode.
const WHAT_IS = {
  planner: 'The planner is the part of you that makes lists, checks the clock, and thinks three steps ahead. It shows up in your words on days full of scheduling, preparing, and "I have to." Ori names it so you can see how much of your day it quietly carried — and thank it, instead of only feeling managed by it.',
  watcher: 'The watcher is the part that reads the room — noticing tones, replaying conversations, wondering how you came across. It shows up in your words after meetings, messages, and time with people. Ori names it so the social work it does all day becomes visible, not just tiring.',
  hesitant: 'The hesitant one is the part that taps the brakes — putting off the hard email, circling a decision. It tends to appear in your words when your energy is low, because its real job is protecting the fuel you have left. Ori names it so a slow day can read as protection, not failure.',
  seeker: 'The seeker is the part that reaches for the quickest comfort — the scroll, the snack, one more episode. It shows up in your words when something underneath needs relief. Ori names it not to scold it, but so you can ask what it was trying to soothe.',
  tender: "The tender one is the part that simply needs — rest, food, warmth, company. It doesn't strategize; it says so plainly, and it appears in your words when a basic need has waited too long. Ori names it because it's the easiest part to miss on a busy day, and the most important one to answer.",
  gentle: "The gentle one is the part of you that isn't working at anything. It shows up in your words once you've stopped pushing — a slow walk, tea, the minute before sleep. Ori names it because this is the time the busier parts of you are usually protecting. There's nothing to fix here; noticing it is the whole practice.",
  witness: 'The witness is the part that can watch your day without grading it. It shows up in your words as plain noticing — "I saw that I was rushing" — with no verdict attached. Ori names it because time spent there tends to make room for every other part.',
  maker: 'The maker is the part that wants to build, write, cook, begin. It tends to appear in your words when you’re rested and the day has a little slack — often as one sentence that starts "I want to try…". Ori names it so you can spot the conditions that invite it back.',
};

const RITUAL = {
  planner:  'Acknowledge the structure it built today. The planner usually loosens its grip when it knows you saw the work.',
  watcher:  "Thank it for doing the watching so you don't have to. That alone often gives it permission to soften.",
  hesitant: "Instead of pushing through, ask what it's protecting. Thank it for noticing first.",
  seeker:   "Don't argue with it. Thank it for trying to help, then ask what it's helping with.",
  tender:   "Don't thank and move on. Give the body what it asked for first — water, food, a sweater, a nap — then thank it for saying so.",
  gentle:   "Welcome it, don't direct it. The presence is the gift; the thank is the receipt.",
  witness:  'Thank the witness by staying with it a beat longer. It rewards stillness more than activity.',
  maker:    'Protect the conditions that bring it back — sleep, an unscheduled hour, a notebook nearby.',
};

// Per-mode presentation of the gesture — just the words; thankModeFor() in
// part-history.js owns which part gets which mode. The heading renders as
// "<heading> <part.name>", e.g. "Tend to the tender one". The confirmation
// word is deliberately honest about what the tap did: you can "thank" a
// protector in one tap, but you only "notice" the tender one's need here — the
// tending itself happens off-screen (see the tender one's ritual copy).
const THANK_MODE_UI = {
  [THANK_MODE_THANK]:   { heading: 'Thank',   cta: 'Thank',        done: '✓ Thanked' },
  [THANK_MODE_TEND]:    { heading: 'Tend to', cta: 'Tend to it',   done: '✓ Noticed' },
  [THANK_MODE_RECEIVE]: { heading: 'Be with', cta: 'Stay with it', done: '✓ Here'    },
};

const DOW_LABEL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

function loadHistory() {
  try {
    const raw = localStorage.getItem('cpi-v2-data');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (parsed?.history || []);
  } catch {
    return [];
  }
}

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4l-6 6 6 6" />
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4l6 6-6 6" />
    </svg>
  );
}

// `backLabel` overrides the back-row word (e.g. "Letter" when this part was
// opened from a letter rather than the all-parts list). `pager`, when present,
// turns the screen into one page of an ordered set — { index, total, onPrev,
// onNext } — so the reader can move through every part a letter named without
// popping back out. onPrev/onNext are null at the ends.
export default function PartDetail({ partId, onBack, onListen, onReflect, backLabel = 'Parts', pager = null }) {
  const part = PARTS_LIB[partId];
  const lang = reflectSttLanguage();
  const [thanks, setThanksLocal] = useState(() => loadThanks());
  const [justThanked, setJustThanked] = useState(false);
  const [whatIsOpen, setWhatIsOpen] = useState(false);

  const history = useMemo(() => loadHistory(), []);
  const stats = useMemo(
    () => (part ? statsFor(history, part, thanks) : null),
    [history, part, thanks],
  );
  // True when this part clears the recurrence gate (keeps showing up across the
  // user's days) but has never been reflected on — same set the Inbox tending
  // nudge uses. An invitation to sit with it, never a read on the person.
  const reflectOn = reflectEnabled();
  const needsTending = useMemo(
    () => (part && reflectOn ? untendedPartIds().includes(part.id) : false),
    [part, reflectOn],
  );

  // Horizontal swipe pages between a letter's parts (alongside the Prev/Next
  // buttons). Swipe left → next, swipe right → prev. A right-swipe that begins
  // at the very left edge is left to the shell's "back to the letter" gesture,
  // so paging-prev only listens past that edge. No-op at the ends (onPrev/onNext
  // are null there), matching the disabled buttons.
  const swipeRef = useRef(null);
  const onTouchStart = useCallback((e) => {
    if (!pager) return;
    const t = e.touches && e.touches[0];
    swipeRef.current = t ? { x: t.clientX, y: t.clientY } : null;
  }, [pager]);
  const onTouchEnd = useCallback((e) => {
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!pager || !s) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    // Must be a deliberate, mostly-horizontal swipe — not a vertical scroll.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (dx < 0) pager.onNext?.();            // swipe left → next part
    else if (s.x > 36) pager.onPrev?.();     // swipe right (past the edge) → prev part
  }, [pager]);

  const handleThank = useCallback(() => {
    if (!part) return;
    const today = history[0]?.date || null;
    appendThank(part.id, today);
    setThanksLocal(loadThanks());
    setJustThanked(true);
    setTimeout(() => setJustThanked(false), 1800);
  }, [part, history]);

  if (!part) {
    return (
      <section className="v2-pd">
        <button type="button" className="v2-backrow" onClick={onBack}>
          <IconChevronLeft />
          <span>{backLabel}</span>
        </button>
        <p className="v2-letter-pending">Unknown part.</p>
      </section>
    );
  }

  const holding = HOLDING[part.id] || { phrase: '—', prose: '—' };
  const ritualCopy = RITUAL[part.id] || 'Acknowledge the work.';
  const thankMode = thankModeFor(part.id);
  const modeUI = THANK_MODE_UI[thankMode] || THANK_MODE_UI[THANK_MODE_THANK];
  const stageLabel = STAGE_LABEL[stats?.stage] || 'Not yet seen';
  const stageNext = STAGE_NEXT[stats?.stage] || STAGE_NEXT.stranger;
  const visits = stats?.visits || 0;
  const fillPct = Math.max(2, Math.min(100, (stats?.familiarityFraction || 0) * 100));
  const peakLabel = stats?.dayOfWeekPeak != null ? DOW_LABEL[stats.dayOfWeekPeak] : 'Not enough visits yet';
  const sub = stageNext.next
    ? `${visits} visit${visits === 1 ? '' : 's'} · ${Math.max(0, stageNext.at - visits)} more to ${stageNext.next}`
    : `${visits} visits · a core figure`;

  return (
    <section className="v2-pd" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="v2-pd-top">
        <button type="button" className="v2-backrow" onClick={onBack} aria-label={`Back to ${backLabel.toLowerCase()}`}>
          <IconChevronLeft />
          <span>{backLabel}</span>
        </button>
        {pager && pager.total > 1 && (
          <span className="v2-pd-count">{pager.index + 1} of {pager.total}</span>
        )}
      </div>

      <div className="v2-pd-hero">
        <div
          className="v2-pd-glyph"
          style={{ color: part.color || 'var(--forest)' }}
          aria-hidden="true"
        >
          {part.glyph || '◯'}
        </div>
        <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
          {/* The "A protector · …" eyebrow was removed — it restated the
              description below it (and was identical across several parts). */}
          <h1 className="v2-pd-name">{partLabel(part, lang)}</h1>
          {partDescOf(part, lang) ? <p className="v2-pd-desc">{partDescOf(part, lang)}</p> : null}
        </div>
      </div>

      <div className="v2-pd-stats">
        <div className="v2-pd-stat">
          <div className="v2-pd-stat-label">Familiarity</div>
          <div className="v2-pd-stage">{stageLabel}</div>
          <div className="v2-pd-stage-sub">{sub}</div>
          <div className="v2-pd-stat-bar">
            <i style={{ width: `${fillPct}%`, background: part.color || 'var(--forest)' }} />
          </div>
        </div>
        <div className="v2-pd-stat">
          <div className="v2-pd-stat-label">When it visits</div>
          <div className="v2-pd-stat-line">
            {visits >= 3 && stats?.dayOfWeekPeak != null
              ? `Most often on ${peakLabel.toLowerCase()}.`
              : 'A pattern will emerge once Ori has named it a few more times.'}
          </div>
        </div>
        <div className="v2-pd-stat">
          <div className="v2-pd-stat-label">Peaks on</div>
          <div className="v2-pd-stat-line">{peakLabel}</div>
          <div className="v2-pd-stage-sub">Day-of-week from your letters.</div>
        </div>
      </div>

      {WHAT_IS[part.id] && (
        <div className="v2-pd-whatis">
          <button
            type="button"
            className="v2-pd-whatis-btn"
            onClick={() => setWhatIsOpen((v) => !v)}
            aria-expanded={whatIsOpen}
          >
            What is this part?
            <svg className={`v2-pd-whatis-caret${whatIsOpen ? ' open' : ''}`} viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {whatIsOpen && (
            <p className="v2-pd-whatis-body">{WHAT_IS[part.id]}</p>
          )}
        </div>
      )}

      <div className="v2-pd-holding">
        <div className="v2-pd-holding-label">What it's holding</div>
        <div className="v2-pd-holding-text">
          <em>{holding.phrase}</em>{' '}
          {holding.prose}
        </div>
      </div>

      <div className="v2-pd-thank">
        <div className="v2-pd-thank-tx">
          <h4 className="v2-pd-thank-h">{modeUI.heading} {partLabel(part, lang)}</h4>
          <p className="v2-pd-thank-p">{ritualCopy}</p>
        </div>
        <div className="v2-pd-actions">
          <button
            type="button"
            className={`v2-pd-thank-btn${justThanked ? ' thanked' : ''}`}
            onClick={handleThank}
          >
            {justThanked ? modeUI.done : modeUI.cta}
          </button>
          {onListen && (
            <button
              type="button"
              className="v2-pd-voice"
              onClick={() => onListen()}
              aria-label={`Speak about ${partLabel(part, lang)}`}
              title={`Speak about ${partLabel(part, lang)}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {needsTending && (
        <p className="v2-pd-tending">
          This one’s been showing up a lot lately.
          {' '}<ProvenanceChip metric="patterns" />
        </p>
      )}

      {onReflect && reflectOn && (
        <button
          type="button"
          className={`v2-pd-reflect-doorway${needsTending ? ' tending' : ''}`}
          onClick={() => onReflect(part.id)}
        >
          <span className="v2-reflect-ico" aria-hidden="true"><IconReflectSpiral size={18} /></span>
          Say a little about {partLabel(part, lang)}
        </button>
      )}

      {pager && pager.total > 1 && (
        <nav className="v2-pd-pager" aria-label="Parts in this letter">
          <button
            type="button"
            className="v2-pd-pg-btn"
            onClick={() => pager.onPrev?.()}
            disabled={!pager.onPrev}
            aria-label="Previous part"
          >
            <IconChevronLeft />
            <span>Prev</span>
          </button>
          <span className="v2-pd-pg-dots" aria-hidden="true">
            {Array.from({ length: pager.total }, (_, i) => (
              <i key={i} className={i === pager.index ? 'on' : ''} />
            ))}
          </span>
          <button
            type="button"
            className="v2-pd-pg-btn"
            onClick={() => pager.onNext?.()}
            disabled={!pager.onNext}
            aria-label="Next part"
          >
            <span>Next</span>
            <IconChevronRight />
          </button>
        </nav>
      )}
    </section>
  );
}
