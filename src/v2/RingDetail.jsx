// Ori v2 — Ring detail (drill-down).
//
// Opens when a ring on Today is tapped. Big number + 14-day bars + a brief
// "what's underneath" explainer + source line per the honesty contract.
//
// Phase 9 scope: first cut. Defers the deep contributor-row breakdown that
// v1's BucketDetailModal renders (those rows depend on engine internals we
// haven't surfaced in v2 yet — coming as Phase 9.5). What ships now is the
// honest visible score, the 14-day series, the bucket's plain-language
// description, and the source-of-truth line.

import { useEffect, useMemo, useState } from 'react';
import './styles/ring.css';
import { classifyBucket } from '../bucket-state.js';
import { recentWho5, loadWho5History } from '../who5.js';
import { buildDemandsLookup } from './demandsData.js';
import { ProvenanceChip, wearableSource } from './Provenance.jsx';
import RingChart from './RingChart.jsx';
import { ymd } from '../date-util.js';
import {
  BucketDetailModal,
  computeStats,
  computePhase,
  uniqueCheckinDays,
  ouraNightCount,
} from '../CognitiveProfile.jsx';
import { BIOMETRICS_KEY } from '../engine.js';

const BUCKET = {
  reserves: {
    title: 'Reserves',
    description: "How rested you are for the day ahead. Reads from your last sleep score when a wearable is connected.",
    source: 'from your Oura ring · your own trend only',
    color: '#C4902A',
    dot: 'amber',
  },
  demands: {
    title: 'Demands',
    description: "The pressure side of the day — decisions named in your writing, how much your day jumped between threads, and meeting load when a calendar is connected. Read against your own trend only.",
    source: 'counted from your writing · from your calendar when connected · your own trend only',
    color: '#7D92AE',
    dot: 'ink',
  },
  form: {
    title: 'Form',
    description: "How you've felt over the past couple of weeks, from your own daily check-ins.",
    source: 'from your daily check-ins',
    color: '#4F8A5F',
    dot: 'sage',
  },
};

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// The chart stroke per ring, resolved from the same theme tokens the Today
// legend dots use (amber / ink / sage) so the line follows the active skin
// instead of a baked-in hex — and matches its own legend dot.
const CHART_VAR = { reserves: '--amber', demands: '--ink', form: '--sage' };

function themeColor(varName, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

function median(xs) {
  const ys = xs.filter((v) => typeof v === 'number' && !isNaN(v)).slice().sort((a, b) => a - b);
  if (ys.length === 0) return null;
  const mid = Math.floor(ys.length / 2);
  return ys.length % 2 === 0 ? (ys[mid - 1] + ys[mid]) / 2 : ys[mid];
}

const WORD_LINE = {
  Spent:        'running low',
  Light:        'thinner than your usual',
  Steady:       'on par',
  Restored:     'topped up',
  Quiet:        'an unusually light load',
  Crowded:      'a heavier slice than usual',
  Heavy:        'a heavy slice — pace it',
  Off:          'tilting off',
  Mixed:        'uneven, not lifting',
  Even:         'lifting',
  'Warming up': 'a few days in — no read yet',
};

const WORD_TONE = {
  Restored: 'sage',
  Even:     'sage',
  Spent:    'amber',
  Heavy:    'amber',
  Crowded:  'amber',
  Off:      'amber',
};

function loadOuraHistoryMap() {
  try {
    const raw = localStorage.getItem('cpi_oura_history');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Build a 7-day series ending today for the chart strip, but classify
// over the last 30 days — classifyBucket needs ≥10 days for a baseline,
// and judging it from the 7 visible points kept the state on "Warming
// up" forever, even with months of data behind the chart.
function build7DaySeries(getValueFor) {
  const todayDate = new Date();
  const trend = [];
  const recent = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - i);
    const key = ymd(d);
    const value = getValueFor(key);
    if (typeof value === 'number') recent.push(value);
    if (i <= 6) {
      trend.push({
        value: typeof value === 'number' ? value : null,
        label: DAY_LETTERS[d.getDay()],
        key, // the day behind this point — lets the chart jump to that Day
      });
    }
  }
  const today = trend[trend.length - 1]?.value
    ?? (recent.length > 0 ? recent[recent.length - 1] : null);
  return { trend, today, recent };
}

function deriveSeriesAndCurrent(bucketId) {
  if (bucketId === 'reserves') {
    const map = loadOuraHistoryMap();
    return build7DaySeries((k) => map[k]?.sleepScore);
  }
  if (bucketId === 'form') {
    const entries = recentWho5(30) || [];
    const byDay = {};
    for (const e of entries) {
      // recentWho5 returns { date: 'YYYY-MM-DD', score, items } — the local day
      // key the chart indexes by. (It does NOT carry a `when`; reading e.when
      // here silently skipped every check-in, leaving the Form detail chart
      // permanently empty even when the user had readings.)
      if (!e?.date || typeof e.score !== 'number') continue;
      byDay[e.date] = e.score;
    }
    return build7DaySeries((k) => byDay[k]);
  }
  // Demands — the shared per-day lookup (decisions + context shifts from
  // the analyzed writing, meeting load from a connected calendar). Same
  // values the Today legend classifies, so the two never disagree.
  const lookup = buildDemandsLookup();
  return build7DaySeries((k) => lookup(k));
}

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4l-6 6 6 6" />
    </svg>
  );
}

// The full contributor breakdown is v1's BucketDetailModal, rendered
// verbatim — same charts, same bands, same teaching lines the user
// configured there. v2 only computes the same inputs v1 passes it.
function loadAnalyzedHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem('cpi-v2-data') || 'null');
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.history)) return parsed.history;
    return [];
  } catch {
    return [];
  }
}

function loadBiometrics() {
  try {
    const raw = localStorage.getItem(BIOMETRICS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// "2026-06-09" → "Mon, Jun 9" for the scrub readout.
function formatShort(iso) {
  if (!iso) return '';
  const p = iso.split('-').map((n) => parseInt(n, 10));
  if (p.length !== 3 || p.some(isNaN)) return '';
  return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Most recent local-date (YYYY-MM-DD) with a journal entry, or null. Mirrors
// the parse Today.jsx uses for the day counter — `date` when present, else the
// createdAt timestamp folded to the local day.
function latestJournalIso() {
  try {
    const parsed = JSON.parse(localStorage.getItem('cpi_journal_repo') || 'null');
    const entries = Array.isArray(parsed?.entries) ? parsed.entries
      : (Array.isArray(parsed) ? parsed : []);
    let latest = null;
    for (const e of entries) {
      let iso = null;
      if (typeof e?.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(e.date)) iso = e.date.slice(0, 10);
      else if (e?.createdAt) { const d = new Date(e.createdAt); if (!isNaN(d.getTime())) iso = ymd(d); }
      if (iso && (!latest || iso > latest)) latest = iso;
    }
    return latest;
  } catch {
    return null;
  }
}

// Most recent local-date with a completed WHO-5 check-in, or null.
function latestCheckInIso() {
  try {
    const map = loadWho5History();
    let latest = null;
    for (const k of Object.keys(map)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof map[k]?.score === 'number' && (!latest || k > latest)) latest = k;
    }
    return latest;
  } catch {
    return null;
  }
}

export default function RingDetail({ bucketId, onBack, onCheckIn }) {
  const meta = BUCKET[bucketId] || BUCKET.reserves;
  // Reserves names the device that actually fed it (Oura / Apple Health / both),
  // never a hardcoded "Oura ring" — same honesty as the provenance chip.
  const sourceLine = bucketId === 'reserves'
    ? (() => {
        const w = wearableSource();
        return w.kind === 'apple' ? 'from Apple Health · your own trend only'
          : w.kind === 'both' ? 'from Apple Health + your Oura ring · your own trend only'
          : w.kind === 'oura' ? 'from your Oura ring · your own trend only'
          : 'from your wearable · your own trend only';
      })()
    : meta.source;
  const [showFull, setShowFull] = useState(false);

  const { trend, today, recent } = useMemo(
    () => deriveSeriesAndCurrent(bucketId),
    [bucketId],
  );

  // The day the user is reading on the chart. Defaults to the most recent day
  // that has a reading (today when today has one), and follows the finger as
  // they scrub. Resets when the bucket changes.
  const lastValidIdx = useMemo(() => {
    for (let i = trend.length - 1; i >= 0; i--) if (trend[i]?.value != null) return i;
    return trend.length - 1;
  }, [trend]);
  const [selIdx, setSelIdx] = useState(lastValidIdx);
  useEffect(() => { setSelIdx(lastValidIdx); }, [lastValidIdx, bucketId]);

  const sel = trend[selIdx] || null;
  const selValue = sel && typeof sel.value === 'number' ? Math.round(sel.value) : null;
  const selIsToday = selIdx === trend.length - 1;
  const selDateLabel = selIsToday ? 'Today' : formatShort(sel?.key);

  const fullDetail = useMemo(() => {
    if (!showFull) return null;
    const history = loadAnalyzedHistory();
    const biometrics = loadBiometrics();
    const phase = computePhase(uniqueCheckinDays(history).size, ouraNightCount(28));
    const stats = computeStats({ history, biometrics, phase });
    return { stats, phase };
  }, [showFull]);

  const classification = useMemo(
    () => classifyBucket({ bucket: bucketId, today, recent }),
    [bucketId, today, recent],
  );

  const state = classification?.state || 'Warming up';
  const wordLine = WORD_LINE[state] || '';
  const wordTone = WORD_TONE[state] || '';
  const usual = useMemo(() => median(recent), [recent]);
  const chartColor = useMemo(
    () => themeColor(CHART_VAR[bucketId] || '--forest', meta.color),
    [bucketId, meta.color],
  );

  // Form moves only on check-ins, not journaling. When the most recent journal
  // entry is newer than the most recent check-in (or there's never been one),
  // the chart looks "stuck" even though the person showed up — so offer a quick
  // check-in right here instead of leaving them puzzled. Recomputes on mount,
  // which is when we return from a completed check-in (Shell remounts this).
  const checkInGap = useMemo(() => {
    if (bucketId !== 'form') return null;
    const lastJournal = latestJournalIso();
    if (!lastJournal) return null;
    const lastCheckIn = latestCheckInIso();
    if (lastCheckIn && lastCheckIn >= lastJournal) return null;
    return { lastCheckIn, lastJournal };
  }, [bucketId]);

  // Where the selected day sat against the user's own usual (the median of the
  // last 30 days). Spelled out as "your recent average" so the comparison reads
  // concretely instead of leaning on the vague "your usual".
  const selRelWord = (selValue == null || usual == null)
    ? null
    : Math.abs(selValue - usual) <= 2 ? 'about your recent average'
      : selValue > usual ? 'higher than your recent average'
        : 'lower than your recent average';

  return (
    <section className="v2-ring">
      <button type="button" className="v2-backrow" onClick={onBack} aria-label="Back to Today">
        <IconChevronLeft />
        <span>Today</span>
      </button>

      <div className="v2-ring-title-row">
        <h1 className="v2-ring-title">{meta.title}</h1>
        <ProvenanceChip metric={bucketId} />
      </div>
      <p className={`v2-ring-word ${wordTone}`}>{state} — {wordLine}</p>

      {/* Big readout — follows the day you're reading on the chart. At rest it's
          today (or the most recent reading); as you scrub it becomes that day. */}
      <div className="v2-ring-big-row">
        {selValue != null ? (
          <>
            <span className="v2-ring-big">{selValue}</span>{' '}
            <span className="v2-ring-big-suffix">out of 100</span>
          </>
        ) : (
          <span className="v2-ring-big dash">—</span>
        )}
        <span className="v2-ring-big-rel">
          {selValue != null
            ? <>{selDateLabel}{selRelWord ? ` · ${selRelWord}` : ''}</>
            : `${selDateLabel || 'This day'} · no reading`}
        </span>
      </div>

      <div className="v2-ring-chart">
        <div className="v2-ring-chart-head">
          <span>Last 7 days</span>
          <span>{recent.length} reading{recent.length === 1 ? '' : 's'}</span>
        </div>
        <RingChart
          trend={trend}
          usual={usual}
          color={chartColor}
          selIdx={selIdx}
          onSelect={setSelIdx}
        />
      </div>

      {checkInGap && onCheckIn && (
        <button type="button" className="v2-ring-checkin" onClick={() => onCheckIn()}>
          <span className="v2-ring-checkin-txt">
            {checkInGap.lastCheckIn
              ? `You've written since your last check-in on ${formatShort(checkInGap.lastCheckIn)} — Form only moves when you check in.`
              : "You've been writing, but haven't done a check-in yet — Form moves when you check in."}
          </span>
          <span className="v2-ring-checkin-cta">Check in · about 30 seconds</span>
        </button>
      )}

      <div className="v2-ring-section-label">What's underneath</div>
      <div className="v2-ring-anchor">
        <div className="v2-ring-anchor-name">{meta.title}</div>
        <div className="v2-ring-anchor-line">{meta.description}</div>
      </div>

      <button type="button" className="v2-ring-full" onClick={() => setShowFull(true)}>
        The full breakdown
        <span>every contributor, with its own trend line and usual range</span>
      </button>

      <div className="v2-ring-src">{sourceLine}</div>

      {showFull && fullDetail && (
        <BucketDetailModal
          bucket={bucketId}
          stats={fullDetail.stats}
          phase={fullDetail.phase}
          onClose={() => setShowFull(false)}
        />
      )}

    </section>
  );
}
