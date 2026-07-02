// Ori v2 — Patterns (4th tab · the temporal lens).
//
// The temporal lens reads rhythms, returns, drifts, highlights and threads
// across the user's own history. Up top: the fortnight HCPI trend + how this
// week sits against the last. Below: a dashboard of lens tiles, each drawing
// its own data from the v1 aggregators (patterns-aggregators.js / threads.js) —
// real readings, "calibrating" until there's enough history. Threads (and
// Highlights, below its threshold) hide entirely rather than show filler.

import { useMemo, useState } from 'react';
import './styles/patterns.css';
import './styles/pattern-tiles.css';
import { TrendChartFullV5 } from '../Analyze.jsx';
import { loadHistory, computeFindings, ymd, entryDate } from './patternsData.js';
import { ProvenanceChip } from './Provenance.jsx';
import {
  StreakTile, RhythmTile, WeatherTile, ReturnsTile, DriftTile, ThreadTile, HighlightTile,
} from './PatternTiles.jsx';
import { LensExplainer } from './PatternInfo.jsx';
import { CrisisHelpFooter } from './CrisisSupport.jsx';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function IconMicSmall() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function medianOf(arr) {
  const ys = arr.filter((v) => typeof v === 'number' && !isNaN(v)).slice().sort((a, b) => a - b);
  if (ys.length === 0) return null;
  const mid = Math.floor(ys.length / 2);
  return ys.length % 2 === 0 ? (ys[mid - 1] + ys[mid]) / 2 : ys[mid];
}

function avgOf(arr) {
  const xs = arr.filter((v) => typeof v === 'number' && !isNaN(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Resolve a theme token to a concrete color so the v1 chart follows the skin.
function themeColor(varName, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

export default function Patterns({ onOpenDay, onOpenPart, onOpenParts, onListen, onCapture, onOpenLens }) {
  const history = useMemo(() => loadHistory(), []);
  const findings = useMemo(() => computeFindings(history), [history]);
  // Which lens's "how it's read" sheet is open (null = none).
  const [explainLens, setExplainLens] = useState(null);
  const trendColor = useMemo(() => themeColor('--forest', '#4F8A5F'), []);
  const today = new Date();
  const todayKey = ymd(today);

  const historyByDay = useMemo(() => {
    const map = {};
    for (const h of history) {
      const d = entryDate(h);
      if (!d) continue;
      const key = ymd(d);
      if (!map[key]) map[key] = h;
    }
    return map;
  }, [history]);

  const series = useMemo(() => {
    const out = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const key = ymd(d);
      const h = historyByDay[key] || null;
      out.push({ date: d, key, hcpi: h?.hcpi ?? null, isToday: key === todayKey });
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyByDay]);

  const trend7 = useMemo(() => series.slice(7).map((s) => ({
    value: typeof s.hcpi === 'number' ? Math.round(s.hcpi * 100) : null,
    label: DAY_LETTERS[s.date.getDay()],
  })), [series]);

  const trend7Values = trend7.map((p) => p.value).filter((v) => typeof v === 'number');
  const trend7Usual = medianOf(trend7Values);
  const trend7Today = trend7[trend7.length - 1]?.value ?? null;

  const totalDaysTracked = Object.keys(historyByDay).length;

  const recent7 = series.slice(7).map((s) => s.hcpi);
  const prior7 = series.slice(0, 7).map((s) => s.hcpi);
  const avgRecent = avgOf(recent7);
  const avgPrior = avgOf(prior7);
  // Day-to-day spread across the whole fortnight. A run of wildly swinging days
  // can have two near-equal weekly MEANS — which read as "steady" — yet feel
  // anything but. SD over the user's own 0–1 read separates the two: calm
  // fortnights sit ~0.03, a genuinely choppy one runs ~0.16 (measured against
  // the sim personas). 0.08 cleanly splits them. Needs ≥6 days to mean anything.
  const fortnightVals = series.map((s) => s.hcpi).filter((v) => typeof v === 'number');
  const fortnightSd = (() => {
    if (fortnightVals.length < 6) return null;
    const m = fortnightVals.reduce((a, b) => a + b, 0) / fortnightVals.length;
    return Math.sqrt(fortnightVals.reduce((s, v) => s + (v - m) ** 2, 0) / fortnightVals.length);
  })();
  const isChoppy = fortnightSd != null && fortnightSd >= 0.08;
  const direction = (() => {
    if (avgRecent == null || avgPrior == null) return null;
    const diff = avgRecent - avgPrior;
    // Choppy only overrides the "no mean change" case — a real lift or dip is
    // still the truer story when the average genuinely moved.
    if (Math.abs(diff) < 0.03) return isChoppy ? 'choppy' : 'steady';
    return diff > 0 ? 'lifting' : 'softening';
  })();
  // A plain-words standing vs last week — never the raw HCPI delta (that score
  // is engine-internal; the chart already shows the honest "above/below usual").
  const deltaPhrase = direction === 'lifting' ? 'lifting vs last week'
    : direction === 'softening' ? 'softening vs last week'
      : direction === 'choppy' ? 'swinging more than usual'
        : direction === 'steady' ? 'about the same as last week'
          : null;

  const title = totalDaysTracked === 0
    ? 'Nothing has happened yet.'
    : direction === 'lifting' ? 'Lifting through the last fortnight.'
      : direction === 'softening' ? 'Softening through the last fortnight.'
        : direction === 'choppy' ? 'Up and down through the last fortnight.'
          : direction === 'steady' ? 'Steady through the last fortnight.'
            : 'Still gathering shape.';

  const isEmpty = totalDaysTracked === 0;

  return (
    <section className={`v2-patterns${isEmpty ? ' is-empty' : ''}`}>
      <div className="v2-pat-eyebrow">
        Patterns · the temporal lens
        {' '}<ProvenanceChip metric="patterns" />
      </div>

      {isEmpty ? (
        /* Empty state — centred as a calm cluster instead of stacking at the
           top and leaving a void above the tab bar. */
        <div className="v2-pat-empty">
          <h1 className="v2-pat-title">{title}</h1>
          <p className="v2-pat-lead">A pattern needs a few days of writing to begin.</p>
          {(onListen || onCapture) && (
            <button type="button" className="v2-pat-cta" onClick={() => (onListen || onCapture)()}>
              <IconMicSmall />
              Start today’s first words
            </button>
          )}
        </div>
      ) : (
        <>
          <h1 className="v2-pat-title">{title}</h1>
          <p className="v2-pat-lead">
            A fortnight at a glance, then six lenses on what keeps coming back.
          </p>

          {/* Fortnight overview — the daily read, indexed to the user's own
              usual band (not a raw score), + this-week-vs-last delta. */}
          <div className="v2-pat-card">
            <div className="v2-pat-card-subject">
              <span>How your days are reading</span>
              {' '}<ProvenanceChip metric="hcpi" />
            </div>
            <div className="v2-pat-card-label">
              <span>Last 7 days</span>
              {deltaPhrase != null && (
                <span className="v2-pat-card-meta">
                  {deltaPhrase}
                </span>
              )}
            </div>
            <TrendChartFullV5
              trend={trend7}
              color={trendColor}
              usual={trend7Usual}
              todayVal={trend7Today}
              relative
            />
          </div>

          {/* The six lenses. Tapping a tile BODY opens its full detail
              (PatternDetail, via onOpenLens); the small "how?" chip opens the
              methodology sheet (PatternInfo.jsx). */}
          <div className="v2-tiles">
            <StreakTile finding={findings.streaks} onOpen={() => onOpenLens?.('streaks')} onExplain={() => setExplainLens('streaks')} />
            <RhythmTile finding={findings.rhythms} onOpen={() => onOpenLens?.('rhythms')} onExplain={() => setExplainLens('rhythms')} />
            <WeatherTile finding={findings.weather} onOpen={() => onOpenLens?.('weather')} onExplain={() => setExplainLens('weather')} />
            <ReturnsTile finding={findings.returns} onOpenParts={onOpenParts} onOpen={() => onOpenLens?.('returns')} onExplain={() => setExplainLens('returns')} />
            <DriftTile finding={findings.drifts} onOpen={() => onOpenLens?.('drifts')} onExplain={() => setExplainLens('drifts')} />
            <ThreadTile thread={findings.threads} onOpen={() => onOpenLens?.('threads')} onExplain={() => setExplainLens('threads')} />
            <HighlightTile finding={findings.highlights} onOpenDay={onOpenDay} onExplain={() => setExplainLens('highlights')} />
          </div>
        </>
      )}

      <p className="v2-pat-foot">
        Each lens reads only your own history — and says “calibrating” until it has enough of it.
      </p>

      {explainLens && <LensExplainer lens={explainLens} onClose={() => setExplainLens(null)} />}
      <CrisisHelpFooter />
    </section>
  );
}
