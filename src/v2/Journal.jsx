// Ori v2 — Journal (Month default).
//
// Month calendar + chronological entries list for the visible month. Reads
// the existing journal repo (`cpi_journal_repo`) for individual checkins and
// the analyzed history (`cpi-v2-data`) for per-day state dots. Both keys are
// shared engine storage — same data v1 reads.
//
// Phase 4 scope: month grid with dot density per day + entries list ("this
// month, day by day") + pinned Today-is-still-listening row when today has
// any activity. Tapping an entry stubs Day view (Phase 4.5).
//
// Year view is intentionally CUT per the gap doc — design has no surface for
// it. Garden visuals, swipe-to-delete, multi-select-to-read, and full-text
// search are deferred.

import { useMemo, useState, useEffect } from 'react';
import './styles/journal.css';
import { ymd } from '../date-util.js';
import { backfillReflectionsToJournal } from './reflectionJournal.js';
import { CrisisHelpFooter } from './CrisisSupport.jsx';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}
function monthLabel(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function loadJournalRepo() {
  try {
    const raw = localStorage.getItem('cpi_journal_repo');
    if (!raw) return { entries: [] };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.entries)) return parsed;
    if (Array.isArray(parsed)) return { entries: parsed };
    return { entries: [] };
  } catch {
    return { entries: [] };
  }
}

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

function entryDateYmd(entry) {
  if (typeof entry?.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(entry.date)) {
    return entry.date.slice(0, 10);
  }
  if (entry?.createdAt) {
    const d = new Date(entry.createdAt);
    if (!isNaN(d.getTime())) return ymd(d);
  }
  if (entry?.date) {
    const d = new Date(entry.date);
    if (!isNaN(d.getTime())) return ymd(d);
  }
  return null;
}

function entrySnippet(entry) {
  const text = entry?.transcription || entry?.rawText || entry?.text || entry?.dayDesc || '';
  const t = String(text).trim();
  return t.length > 90 ? `${t.slice(0, 90).trimEnd()}…` : t;
}

// The letter time the user picked in onboarding ("9 PM", "Sunrise", …).
function letterTimePref() {
  try {
    return localStorage.getItem('cpi_reflect_time') || '9 PM';
  } catch {
    return '9 PM';
  }
}

function letterStateForDay(dayKey, historyByDay) {
  const h = historyByDay[dayKey];
  if (!h) return 'neutral';
  const hcpi = typeof h.hcpi === 'number' ? h.hcpi : null;
  if (hcpi == null) return 'neutral';
  // Simple bucketing — same direction as v1's tone colors, without
  // claiming a specific clinical threshold. Green = lifting, amber =
  // neutral, clay = drift.
  if (hcpi >= 0.62) return 'lift';
  if (hcpi <= 0.42) return 'drift';
  return 'neutral';
}

function IconChevronRight() {
  return (
    <svg width="8" height="13" viewBox="0 0 8 13" aria-hidden="true">
      <path d="M1 1 L7 6.5 L1 12" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Remembers the month the user was last browsing (a "YYYY-MM" key) so that
// opening a day — which unmounts this tab while the Shell shows the Day
// overlay — and coming back lands on the SAME month instead of snapping to
// today. Module scope means it survives the remount within an app session but
// resets on a fresh launch (bundle re-eval), which is the intended
// "stick until a fresh launch" behaviour.
let sessionCursorMonthKey = null;

export default function Journal({ onOpenDay, onListen, onCapture }) {
  const today = new Date();
  const todayYmd = ymd(today);

  // Bridge any past part-reflections into the journal first, so they appear here
  // alongside written/spoken entries (idempotent — see reflectionJournal.js).
  const repo = useMemo(() => {
    try { backfillReflectionsToJournal(); } catch { /* best-effort */ }
    return loadJournalRepo();
  }, []);
  const history = useMemo(() => loadHistory(), []);

  // Open on the current month — unless it's empty and older months have
  // entries (a restored backup, an imported archive). Then open on the
  // most recent month that has something to show: a freshly-restored
  // journal that lands on a blank June reads as "the restore failed".
  const [cursor, setCursor] = useState(() => {
    const thisMonth = startOfMonth(today);
    // Restore the month the user was browsing before this remount, if any.
    if (sessionCursorMonthKey) {
      const [y, m] = sessionCursorMonthKey.split('-').map((p) => parseInt(p, 10));
      if (y && m) return new Date(y, m - 1, 1);
    }
    try {
      const dates = [];
      for (const e of loadJournalRepo().entries || []) {
        const k = entryDateYmd(e);
        if (k) dates.push(k);
      }
      for (const h of loadHistory()) {
        const d = h?.date ? new Date(h.date) : null;
        if (d && !isNaN(d.getTime())) dates.push(ymd(d));
      }
      if (dates.length === 0) return thisMonth;
      const latest = dates.sort().reverse()[0];
      const curKey = ymd(today).slice(0, 7);
      if (dates.some((d) => d.startsWith(curKey))) return thisMonth;
      const [y, m] = latest.split('-').map((p) => parseInt(p, 10));
      return new Date(y, m - 1, 1);
    } catch {
      return thisMonth;
    }
  });

  // Mirror the browsed month into module scope so a remount (e.g. after the
  // Day overlay closes) restores it instead of snapping back to today.
  useEffect(() => {
    sessionCursorMonthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
  }, [cursor]);

  // Index entries by day for fast lookup.
  const entriesByDay = useMemo(() => {
    const map = {};
    for (const entry of repo.entries || []) {
      const key = entryDateYmd(entry);
      if (!key) continue;
      if (!map[key]) map[key] = [];
      map[key].push(entry);
    }
    return map;
  }, [repo]);

  const historyByDay = useMemo(() => {
    const map = {};
    for (const h of history) {
      const d = h?.date ? new Date(h.date) : null;
      if (!d || isNaN(d.getTime())) continue;
      const key = ymd(d);
      if (!map[key]) map[key] = h;
    }
    return map;
  }, [history]);

  // Build calendar grid for the cursor month.
  const grid = useMemo(() => {
    const monthStart = startOfMonth(cursor);
    const monthEnd = endOfMonth(cursor);
    const startWeekday = monthStart.getDay();
    const totalCells = Math.ceil((startWeekday + monthEnd.getDate()) / 7) * 7;
    const cells = [];
    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - startWeekday + 1;
      if (dayNum < 1 || dayNum > monthEnd.getDate()) {
        cells.push({ kind: 'pad' });
      } else {
        const date = new Date(cursor.getFullYear(), cursor.getMonth(), dayNum);
        const key = ymd(date);
        // A day counts as tended if the repo has entries OR the analyzed
        // history has a check-in. v1's daily check-ins live ONLY in
        // cpi-v2-data (dayDesc) — counting repo alone made every v1 user's
        // journal look empty.
        const entryCount = (entriesByDay[key]?.length || 0)
          + (historyByDay[key] && !(entriesByDay[key]?.length) ? 1 : 0);
        cells.push({
          kind: 'day',
          date,
          key,
          dayNum,
          entryCount,
          isToday: key === todayYmd,
          state: letterStateForDay(key, historyByDay),
        });
      }
    }
    return cells;
  }, [cursor, entriesByDay, historyByDay, todayYmd]);

  // List of days in this month that HAVE entries, newest first. Days whose
  // only record is a v1 check-in (cpi-v2-data) use its dayDesc as snippet.
  const dayRows = useMemo(() => {
    return grid
      .filter((c) => c.kind === 'day' && c.entryCount > 0)
      .sort((a, b) => b.dayNum - a.dayNum)
      .map((c) => {
        const entries = entriesByDay[c.key] || [];
        const first = entries[0];
        const snippet = first
          ? entrySnippet(first)
          : String(historyByDay[c.key]?.dayDesc || '').trim();
        return {
          ...c,
          entries,
          snippet,
          weekday: c.date.toLocaleDateString('en-US', { weekday: 'short' }),
        };
      });
  }, [grid, entriesByDay, historyByDay]);

  const todayHasActivity = (entriesByDay[todayYmd]?.length || 0) > 0;

  const goPrev = () => {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
  };
  const goNext = () => {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    if (next > startOfMonth(today)) return; // no future months
    setCursor(next);
  };
  const canGoNext = startOfMonth(cursor) < startOfMonth(today);

  const handleDayTap = (cell) => {
    // Today always opens (it has at least the pending-letter card, and may have
    // a check-in that doesn't count toward entryCount) — otherwise the cell is
    // tappable (not disabled) but the handler dead-ends. Past days need an entry.
    if (cell.kind !== 'day') return;
    if (cell.entryCount === 0 && !cell.isToday) return;
    onOpenDay?.(cell.key);
  };

  return (
    <section className="v2-journal">
      <div className="v2-monthrow">
        <button
          type="button"
          className="v2-monthrow-arrow"
          onClick={goPrev}
          aria-label="Previous month"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M10 3 5 8l5 5" /></svg>
        </button>
        <span className="v2-monthrow-m">{cursor.toLocaleDateString('en-US', { month: 'long' })}</span>
        <button
          type="button"
          className="v2-monthrow-arrow"
          onClick={goNext}
          disabled={!canGoNext}
          aria-label="Next month"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>
        <span className="v2-monthrow-y">{cursor.getFullYear()}</span>
      </div>

      <div className="v2-cal">
        <div className="v2-cal-wk">
          {WEEKDAYS.map((w, i) => <div key={i}>{w}</div>)}
        </div>
        <div className="v2-cal-row" style={{ gridAutoRows: '40px' }}>
          {grid.map((c, i) => {
            if (c.kind === 'pad') {
              return <span key={i} className="v2-cal-cell empty" />;
            }
            const cls = [
              'v2-cal-cell',
              c.entryCount > 0 ? 'clickable' : 'empty',
              c.isToday ? 'today' : '',
            ].filter(Boolean).join(' ');
            return (
              <button
                key={i}
                type="button"
                className={cls}
                onClick={() => handleDayTap(c)}
                disabled={c.entryCount === 0 && !c.isToday}
              >
                <span className="v2-cal-d">{c.dayNum}</span>
                <span className="v2-cal-dots">
                  {Array.from({ length: Math.min(3, c.entryCount) }).map((_, j) => <i key={j} />)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="v2-daylog-head">
        <span className="v2-daylog-h">This month, day by day</span>
        <span className="v2-daylog-count">
          {dayRows.length} day{dayRows.length === 1 ? '' : 's'} tended
        </span>
      </div>

      {/* Pinned "today is still listening" row when today has activity. Opens
          today's day view (the raw entries you wrote + a pending-letter card),
          NOT the letter directly — the letter may not be written yet, and the
          point of tapping here is to SEE what you've journaled today. */}
      {todayHasActivity ? (
        <button type="button" className="v2-log-today" onClick={() => onOpenDay?.(todayYmd)}>
          <span className="v2-lt-ic"><span className="v2-lt-pulse" /></span>
          <span className="v2-lt-tx">
            <b>Today · still listening</b>
            <span>
              {(entriesByDay[todayYmd]?.length || 0)} entr{(entriesByDay[todayYmd]?.length || 0) === 1 ? 'y' : 'ies'} so far · your letter arrives ~{letterTimePref()}
            </span>
          </span>
          <svg className="v2-le-ch" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>
      ) : null}

      {dayRows.length === 0 ? (
        <div className="v2-journal-empty">
          <p>No entries this month yet.</p>
          {(onListen || onCapture) && (
            <button type="button" className="v2-journal-empty-cta" onClick={() => (onListen || onCapture)()}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
              </svg>
              Start today’s first words
            </button>
          )}
        </div>
      ) : (
        dayRows
          .filter((row) => row.key !== todayYmd)
          .map((row) => (
            <button
              key={row.key}
              type="button"
              className="v2-log-entry"
              onClick={() => handleDayTap(row)}
            >
              <div className="v2-le-date">
                <span className="v2-le-d">{row.dayNum}</span>
                <span className="v2-le-wd">{row.weekday}</span>
              </div>
              <div className="v2-le-body">
                <div className="v2-le-meta">
                  <span>
                    {row.entries.length > 0
                      ? `${row.entries.length} entr${row.entries.length === 1 ? 'y' : 'ies'}`
                      : '1 check-in'}
                    {row.state === 'lift' ? ' · lifting' : row.state === 'drift' ? ' · drifting' : ' · steady'}
                  </span>
                </div>
                <p>{row.snippet ? `“${row.snippet}”` : '…'}</p>
              </div>
              <span className="v2-le-ch"><IconChevronRight /></span>
            </button>
          ))
      )}
      <CrisisHelpFooter />
    </section>
  );
}
