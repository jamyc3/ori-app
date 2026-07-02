// Ori v2 — Decisions: park a consequential decision for a sharper hour.
//
// The companion to retiring the "decisions are a finite pool" frame. Instead of
// counting decisions as cost, this helps the user make the ones that matter at a
// better time: park it, and Ori brings it back inside the next sharp window the
// engine computes from your own wake time and chronotype. Nothing here grades
// you — it's timing support, not a scoreboard. Records are append-only.

import { useState, useEffect, useCallback, useRef } from 'react';
import './styles/decisions.css';
import { getLarge } from '../storage.js';
import { CHRONO_KEY } from '../engine.js';
import {
  parkDecision, markRevisited, recordClarity, recordOutcome, loadDecisions, readyDecisions, upcomingDecisions, lookBackDecisions, similarPastDecisions,
} from './decisions.js';
import { syncDecisionReminder } from './decisionNotify.js';

function chronotype() {
  try { return localStorage.getItem(CHRONO_KEY) || 'flexible'; } catch { return 'flexible'; }
}

// Honest, plain-language read of when a parked decision comes back.
function windowLabel(d) {
  if (d.windowStatus === 'now') return 'Ready now';
  if (d.windowStatus === 'unknown') return "We'll bring it back next time you're here";
  if (!d.resurfaceAt) return 'Parked';
  const t = new Date(d.resurfaceAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.windowStatus === 'tomorrow' ? `Tomorrow, around ${t}` : `Opens around ${t}`;
}

// A non-judgmental read of a clarity (KSS) reading — gives permission to wait
// when foggy, never an instruction.
function clarityRead(kss) {
  if (kss <= 3) return { tone: 'clear', text: 'Clear-headed — a good moment to decide.' };
  if (kss <= 6) return { tone: 'mid', text: 'Middle ground — trust your own read here.' };
  return { tone: 'foggy', text: 'Running foggy — no rush. This can keep until a clearer hour.' };
}

// Pre-decision clarity check on a Ready card: a quick KSS alertness probe before
// you commit. Stored on the decision (additive) so the calibration loop can
// later learn how your alertness tracks with the calls you make.
function ClarityCheck({ d }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(d.clarityKss ?? 4);

  if (d.clarityKss != null && !open) {
    const read = clarityRead(d.clarityKss);
    return (
      <div className={`v2-dec-clarity is-${read.tone}`}>
        <span className="v2-dec-clarity-read">{read.text}</span>
        <button type="button" className="v2-dec-clarity-redo" onClick={() => { setV(d.clarityKss); setOpen(true); }}>recheck</button>
      </div>
    );
  }
  if (!open) {
    return (
      <button type="button" className="v2-dec-clarity-start" onClick={() => { setV(4); setOpen(true); }}>
        Quick clarity check before you decide →
      </button>
    );
  }
  const read = clarityRead(v);
  return (
    <div className="v2-dec-clarity-edit">
      <div className="v2-dec-clarity-q">How clear-headed do you feel right now?</div>
      <input
        type="range" min="1" max="9" value={v} className="v2-dec-clarity-range"
        onChange={(e) => setV(parseInt(e.target.value, 10))}
      />
      <div className="v2-dec-clarity-scale"><span>Clear</span><span>Foggy</span></div>
      <div className={`v2-dec-clarity-read is-${read.tone}`}>{read.text}</div>
      <button type="button" className="v2-dec-clarity-save" onClick={() => { recordClarity(d.id, v); setOpen(false); }}>Note it</button>
    </div>
  );
}

// Plain past-tense labels for a recorded look-back outcome.
const OUTCOME_PAST = { glad: 'Glad you did', mixed: 'Landed mixed', regret: 'Wish you’d waited' };
// Lower-case tail for the "you've faced this before" echo, plus a short snippet.
const OUTCOME_PAST_LC = { glad: 'glad you did', mixed: 'left a bit mixed', regret: 'wishing you’d waited' };
const snippet = (s, n = 52) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export default function Decisions({ onClose }) {
  const [text, setText] = useState('');
  const [weight, setWeight] = useState('consequential');
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // The writing box grows with what you type (up to a cap, then scrolls inside
  // itself) instead of staying a cramped 2-line box where the text scrolls up
  // out of view. Recomputed whenever the text changes.
  const inputRef = useRef(null);
  const autosize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, []);
  useEffect(() => { autosize(); }, [text, autosize]);

  useEffect(() => {
    window.addEventListener('cpi:parked-updated', refresh);
    return () => window.removeEventListener('cpi:parked-updated', refresh);
  }, [refresh]);

  const park = () => {
    const t = text.trim();
    if (!t) return;
    const history = getLarge('cpi_oura_history') || {};
    parkDecision({ text: t, weight }, history, chronotype());
    setText('');
    syncDecisionReminder();
  };

  const ready = readyDecisions();
  const upcoming = upcomingDecisions();
  const lookBack = lookBackDecisions();
  // A decision awaiting its look-back lives in "Worth a look back", not here —
  // so it never shows in both groups at once.
  const lookBackIds = new Set(lookBack.map((d) => d.id));
  const revisited = loadDecisions().filter((d) => d.status === 'revisited' && !lookBackIds.has(d.id)).slice(0, 8);
  // Phase 4: a past decision (with a recorded outcome) that rhymes with what's
  // being typed — retrieval over your own history, computed on-device.
  const echo = text.trim().length > 3 ? (similarPastDecisions(text)[0] || null) : null;

  return (
    <section className="v2-decisions">
      <div className="v2-dec-spacer s1" aria-hidden="true" />
      <div className="v2-dec-eyebrow">Decisions · made at a better hour</div>

      <div className="v2-dec-intro">
        Got a call that matters? Park it. Ori brings it back inside your next sharp
        window — when a decision counts, <em>when</em> you make it tends to count more
        than how many you made.
      </div>

      <div className="v2-dec-park">
        <textarea
          ref={inputRef}
          className="v2-dec-input"
          placeholder="The decision you want to make well…"
          value={text}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => { try { e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebKit */ } }}
        />
        <div className="v2-dec-weightrow" role="radiogroup" aria-label="How much does it matter">
          {['consequential', 'smaller'].map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={weight === w}
              className={`v2-dec-chip${weight === w ? ' is-on' : ''}`}
              onClick={() => setWeight(w)}
            >
              {w === 'consequential' ? 'Consequential' : 'Smaller call'}
            </button>
          ))}
          <button type="button" className="v2-dec-park-btn" disabled={!text.trim()} onClick={park}>
            Park it
          </button>
        </div>
      </div>

      {echo && (
        <div className="v2-dec-echo">
          Sounds like a call you’ve made before — <span>“{snippet(echo.text)}”</span>, and you were {OUTCOME_PAST_LC[echo.outcome]}.
        </div>
      )}

      {ready.length > 0 && (
        <div className="v2-dec-group">
          <div className="v2-dec-grouphead">Ready now</div>
          {ready.map((d) => (
            <div key={d.id} className="v2-dec-card is-ready">
              <div className="v2-dec-text">{d.text}</div>
              <ClarityCheck d={d} />
              <div className="v2-dec-row">
                <span className="v2-dec-when">This is a sharper hour for you.</span>
                <button type="button" className="v2-dec-revisit" onClick={() => markRevisited(d.id)}>
                  Revisited
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="v2-dec-group">
          <div className="v2-dec-grouphead">Waiting for a better hour</div>
          {upcoming.map((d) => (
            <div key={d.id} className="v2-dec-card">
              <div className="v2-dec-text">{d.text}</div>
              <div className="v2-dec-row">
                <span className="v2-dec-when">{windowLabel(d)}</span>
                <button type="button" className="v2-dec-revisit ghost" onClick={() => markRevisited(d.id)}>
                  Decide now anyway
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {lookBack.length > 0 && (
        <div className="v2-dec-group">
          <div className="v2-dec-grouphead">Worth a look back</div>
          {lookBack.map((d) => (
            <div key={d.id} className="v2-dec-card is-lookback">
              <div className="v2-dec-text">{d.text}</div>
              <div className="v2-dec-lookback-q">You made this a few days ago — how did it land?</div>
              <div className="v2-dec-outcome-row">
                {[['glad', 'Glad I did'], ['mixed', 'Mixed'], ['regret', 'Wish I’d waited']].map(([v, label]) => (
                  <button key={v} type="button" className="v2-dec-outcome-btn" onClick={() => recordOutcome(d.id, v)}>{label}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {revisited.length > 0 && (
        <div className="v2-dec-group">
          <div className="v2-dec-grouphead muted">Revisited</div>
          {revisited.map((d) => (
            <div key={d.id} className="v2-dec-card is-done">
              <div className="v2-dec-text">{d.text}</div>
              {d.outcome && <div className="v2-dec-outcome-tag">{OUTCOME_PAST[d.outcome]}</div>}
            </div>
          ))}
        </div>
      )}

      {ready.length === 0 && upcoming.length === 0 && revisited.length === 0 && lookBack.length === 0 && (
        <div className="v2-dec-empty">Nothing parked. When a decision can wait for a clearer head, this is where it rests.</div>
      )}

      <div className="v2-dec-spacer s2" aria-hidden="true" />
      <button type="button" className="v2-dec-close" onClick={onClose}>Close</button>
    </section>
  );
}
