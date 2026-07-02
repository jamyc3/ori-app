// Ori v2 — "Read your last 30 days" (the post-import backfill screen).
//
// Delivers what the import promo promises: after you upload a journal, Ori reads
// your most recent 30 unread days and writes a letter for each. It drives the
// shared runner (src/backfillRunner.js) — the SAME per-day reading the live
// letter writes — so the results land in the Inbox, Journal and Day views with
// no extra plumbing (verified). Reflect (words-only) mode: imported days have no
// body data, and the runner/analyzer already branch to a words-only reading.
//
// Cost/honesty: capped at the most-recent 30 days (BATCH_FREE_LIMIT); older
// entries stay in the journal as writing. The read is user-initiated (a tap),
// never a silent spend.

import { useMemo, useState } from 'react';
import './styles/backfill.css';
import { loadRepo } from '../engine.js';
import { findUnanalyzedDays, selectFreeWindow } from '../batch-analyze.js';
import { runBackfill } from '../backfillRunner.js';
import { flushStorage } from '../storage.js';

const HISTORY_KEY = 'cpi-v2-data';
const PENDING_KEY = 'cpi_v2_backfill_pending';
const SEEN_COUNT_KEY = 'cpi_v2_backfill_seen_count';

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || 'null');
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.history)) return parsed.history;
    return [];
  } catch { return []; }
}

// True when the user has any wearable history — picks full vs reflect (words-only).
function hasWearable() {
  try {
    const m = JSON.parse(localStorage.getItem('cpi_oura_history') || '{}');
    return m && typeof m === 'object' && Object.keys(m).length > 0;
  } catch { return false; }
}

// The pending free-read days, computed once.
export function pendingBackfillDays() {
  try { return selectFreeWindow(findUnanalyzedDays(loadRepo())); }
  catch { return []; }
}

export default function Backfill({ onClose, onOpenInbox }) {
  const days = useMemo(() => pendingBackfillDays(), []);
  const total = days.length;
  const [phase, setPhase] = useState('offer'); // offer | running | done
  const [done, setDone] = useState(0);
  const [errorCount, setErrorCount] = useState(0);

  const markSettled = () => {
    try {
      localStorage.removeItem(PENDING_KEY);
      // Record the count we just handled so we don't re-offer this same set.
      localStorage.setItem(SEEN_COUNT_KEY, String(findUnanalyzedDays(loadRepo()).length));
    } catch { /* fine */ }
  };

  const run = async () => {
    if (!total) { markSettled(); onClose?.(); return; }
    setPhase('running');
    const history = loadHistory();
    const ctx = { mode: hasWearable() ? 'full' : 'reflect', biometrics: null, lifestyle: null, wakeTime: '07:00', chronotype: null };
    const { entries, errors } = await runBackfill({
      days,
      historySnapshot: history,
      ctx,
      onProgress: (p) => setDone(p.completed),
    });
    // Merge new rows into the analyzed history (newest-first, capped) — same
    // shape letterEngine writes, so Journal/Patterns light up too.
    try {
      const merged = [...entries, ...history]
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 200);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
      await flushStorage();
    } catch { /* best-effort — the per-day letters are already written */ }
    setErrorCount(errors.length);
    markSettled();
    setPhase('done');
  };

  const skip = () => { markSettled(); onClose?.(); };

  if (phase === 'offer') {
    return (
      <section className="v2-bf">
        <div className="v2-bf-eyebrow">From your import</div>
        <h1 className="v2-bf-title">
          Ori can read your last {total} day{total === 1 ? '' : 's'}.
        </h1>
        <p className="v2-bf-lede">
          A letter for each — grounded in your own words. It takes about a minute a
          day, so roughly {Math.max(1, Math.ceil(total * 1))}–{Math.ceil(total * 1.5)} minutes
          in all. You can keep using Ori while it reads.
        </p>
        <div className="v2-bf-actions">
          <button type="button" className="v2-pill-btn" onClick={run} disabled={!total}>
            Read my last {total} day{total === 1 ? '' : 's'}
          </button>
          <button type="button" className="v2-bf-later" onClick={skip}>Not now</button>
        </div>
      </section>
    );
  }

  if (phase === 'running') {
    const pct = total ? Math.round((done / total) * 100) : 0;
    return (
      <section className="v2-bf">
        <div className="v2-bf-eyebrow">Reading your month</div>
        <h1 className="v2-bf-title">Ori is reading…</h1>
        <div className="v2-bf-bar"><span style={{ width: `${pct}%` }} /></div>
        <p className="v2-bf-count">{done} of {total} days</p>
        <p className="v2-bf-lede">Each letter lands in your Inbox as it’s written. This can keep going in the background.</p>
        <div className="v2-bf-actions">
          <button type="button" className="v2-bf-later" onClick={() => onClose?.()}>Hide</button>
        </div>
      </section>
    );
  }

  // done
  const read = total - errorCount;
  return (
    <section className="v2-bf">
      <div className="v2-bf-eyebrow">Your month, read</div>
      <h1 className="v2-bf-title">{read} letter{read === 1 ? '' : 's'} are waiting.</h1>
      <p className="v2-bf-lede">
        {errorCount > 0
          ? `${read} of your last ${total} days are read — ${errorCount} ${errorCount === 1 ? 'day' : 'days'} didn’t go through this time. `
          : 'Each of your last days now has a letter. '}
        They’re in your Inbox, and on each day in your Journal.
      </p>
      <div className="v2-bf-actions">
        <button type="button" className="v2-pill-btn" onClick={() => onOpenInbox?.()}>Open the Inbox</button>
        <button type="button" className="v2-bf-later" onClick={() => onClose?.()}>Done</button>
      </div>
    </section>
  );
}
