// Ori v2 — Pattern lens detail.
//
// Tapping a Patterns tile's BODY opens this full-screen drill-down (the small
// "how?" chip still opens the methodology sheet). Each lens re-renders the
// SAME graph the tile shows — the contribution grid, the weekday bars, the
// mood×energy scatter, the drift figure, the thread evidence — just larger,
// then wraps it in the expanded data and taps through to the underlying day
// or part. It reads the same findings the tab does (patternsData.js), so a
// tile and its detail can never disagree. No new measured numbers are
// introduced: every figure here is one the tile already surfaces (its honesty
// layer is carried by the existing provenance chips).

import { useMemo, useState } from 'react';
import './styles/pattern-detail.css';
import { ymdISO } from '../dates.js';
import { ProvenanceChip } from './Provenance.jsx';
import { LensExplainer } from './PatternInfo.jsx';
import { computeFindings, loadHistory, historyByDay, ymd } from './patternsData.js';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const LENS_TAG = {
  streaks: 'Streaks',
  rhythms: 'Rhythms',
  weather: 'Weather',
  returns: 'Returns',
  drifts: 'Drifts',
  threads: 'Threads',
};
// Reuse the seven existing provenance keys — no lens introduces a number the
// tiles don't already show, so no new disclosure is needed.
const LENS_METRIC = {
  streaks: 'streak',
  rhythms: 'patterns',
  weather: 'patterns',
  returns: 'patterns',
  drifts: 'patterns',
  threads: 'patterns',
};

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

// ── Streaks — full season contribution calendar + the three counts ───────
function StreaksBody({ finding, byDay, onOpenDay }) {
  const today = new Date();
  // 13 weeks = the 90-day "season" the season-best is measured over.
  const cells = useMemo(() => {
    const out = [];
    const written = new Set(finding.writingDays || []);
    for (let k = 90; k >= 0; k--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - k);
      const key = ymd(d);
      out.push({ key, on: written.has(key), today: k === 0 });
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finding]);

  return (
    <>
      <div className="v2-pdt-stats">
        <Stat n={finding.current ?? 0} label="in a row now" />
        <Stat n={finding.longest90 ?? 0} label="season best" />
        <Stat n={finding.longest ?? 0} label="all-time best" />
      </div>
      <div className="v2-pdt-card">
        <div className="v2-pdt-card-label">Your last 13 weeks · tap a lit day</div>
        <div className="v2-pdt-streak-grid">
          {cells.map((c) => (c.on && byDay[c.key]
            ? (
              <button
                key={c.key}
                type="button"
                className={`v2-streak-cell on${c.today ? ' today' : ''}`}
                aria-label={`Open ${c.key}`}
                onClick={() => onOpenDay?.(c.key)}
              />
            )
            : (
              <span key={c.key} className={`v2-streak-cell${c.on ? ' on' : ''}${c.today ? ' today' : ''}`} />
            )
          ))}
        </div>
      </div>
    </>
  );
}

// ── Rhythms — the weekday bars at scale + the rest of the signals ────────
function RhythmsBody({ finding }) {
  const bars = finding.weekdayBars || [];
  const max = Math.max(...bars.filter((x) => x != null), 0.01);
  const peakVal = bars[finding.peakDow] || 0.01;
  const signals = [];
  if (finding.peakBand?.label) signals.push(['Clearest two hours', finding.peakBand.label]);
  if (finding.chronotype) signals.push(['Your clock', `${finding.chronotype} part of the dial`]);
  if (finding.sleepRegularity?.descriptor) signals.push(['Sleep clock', finding.sleepRegularity.descriptor]);
  return (
    <>
      <div className="v2-pdt-card">
        <div className="v2-pdt-card-label">Your week, by weekday</div>
        <div className="v2-pdt-rbars">
          {bars.map((v, i) => {
            const isPeak = i === finding.peakDow;
            const high = !isPeak && v != null && v / peakVal >= 0.78;
            const h = v == null ? 8 : Math.max(12, (v / max) * 100);
            return (
              <span key={i} className="v2-rbar-col">
                <span className={`v2-rbar${isPeak ? ' peak' : high ? ' high' : ''}${v == null ? ' null' : ''}`} style={{ height: `${h}%` }} />
              </span>
            );
          })}
        </div>
        <div className="v2-rdays" aria-hidden="true">
          {DOW.map((d, i) => (<span key={i} className={i === finding.peakDow ? 'on' : ''}>{d}</span>))}
        </div>
      </div>
      {signals.length > 0 && (
        <div className="v2-pdt-rows">
          {signals.map(([k, val]) => (
            <div key={k} className="v2-pdt-row">
              <span className="v2-pdt-row-k">{k}</span>
              <span className="v2-pdt-row-v">{val}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Weather — the full mood×energy scatter, every dot taps to its day ────
const QUAD_LABELS = [
  { cls: 'tl', text: 'sharp · pressed' },
  { cls: 'tr', text: 'excited · sharp' },
  { cls: 'bl', text: 'heavy · tired' },
  { cls: 'br', text: 'calm · curious' },
];
function WeatherBody({ finding, onOpenDay }) {
  const days = finding.days || [];
  return (
    <div className="v2-pdt-card">
      <div className="v2-pdt-card-label">{days.length} days · tap a dot to open it</div>
      <div className="v2-pdt-wx-plot">
        <span className="v2-wx-axis v" aria-hidden="true" />
        <span className="v2-wx-axis h" aria-hidden="true" />
        {QUAD_LABELS.map((q) => (<span key={q.cls} className={`v2-pdt-wx-q ${q.cls}`}>{q.text}</span>))}
        {days.map((d, i) => {
          const isToday = i === days.length - 1;
          const iso = ymdISO(d.date);
          return (
            <button
              key={iso + i}
              type="button"
              className={`v2-pdt-wx-dot${isToday ? ' today' : ''}`}
              style={{ left: `${d.x * 100}%`, top: `${(1 - d.y) * 100}%` }}
              aria-label={`Open ${iso}`}
              onClick={() => onOpenDay?.(iso)}
            />
          );
        })}
      </div>
      <div className="v2-pdt-wx-axes" aria-hidden="true">
        <span>← heavier</span><span>lighter →</span>
      </div>
    </div>
  );
}

// ── Returns — the whole ranked roster, each part taps through ─────────────
function ReturnsBody({ finding, onOpenPart }) {
  // Only parts actually seen this month belong under the "this month" roster
  // (a keeper can qualify on older history yet be absent lately). topVisitor
  // guarantees at least one row survives the filter.
  const roster = (finding.roster || []).filter((p) => p.visits >= 1);
  const friction = finding.friction;
  return (
    <>
      {friction && (
        <div className="v2-pdt-card">
          <div className="v2-pdt-card-label">What recurs alongside them</div>
          <div className="v2-ret-fric">
            <span className="v2-ret-fric-bar"><span style={{ width: `${Math.round(friction.share * 100)}%` }} /></span>
            <span className="v2-ret-fric-lbl">{friction.dominant}</span>
          </div>
        </div>
      )}
      <div className="v2-pdt-card-label v2-pdt-roster-label">The garden this month · tap a part</div>
      <div className="v2-pdt-roster">
        {roster.map((p) => (
          <button key={p.id} type="button" className="v2-pdt-roster-row" onClick={() => onOpenPart?.(p.id)}>
            <span className="v2-pdt-roster-glyph" style={{ color: p.color, borderColor: p.color }}>{p.glyph}</span>
            <span className="v2-pdt-roster-name">{p.name.replace(/^the\s+/i, '')}</span>
            <span className="v2-pdt-roster-visits">{p.visits} day{p.visits === 1 ? '' : 's'}</span>
          </button>
        ))}
      </div>
    </>
  );
}

// ── Drifts — the signed figure + recovery, at scale ───────────────────────
function DriftsBody({ finding }) {
  const deltaH = finding.primary?.deltaHours ?? 0;
  const sign = deltaH < 0 ? '−' : '+';
  const down = deltaH < 0;
  const steady = Boolean(finding.steady);
  return (
    <div className="v2-pdt-card">
      <div className="v2-pdt-card-label">Sleep vs your own usual, last three weeks</div>
      <div className="v2-pdt-drift-fig">
        <span className={`v2-drift-num${steady ? '' : down ? ' down' : ' up'}`}>{steady ? 'steady' : `${sign}${Math.abs(deltaH).toFixed(1)}h`}</span>
        <span className="v2-drift-arrow" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {steady ? <path d="M4 10h12" /> : down ? <path d="M10 4v12M5 11l5 5 5-5" /> : <path d="M10 16V4M5 9l5-5 5 5" />}
          </svg>
        </span>
        <span className="v2-pdt-drift-cap">{steady ? 'in your usual range' : `${down ? 'short of usual' : 'more than usual'}, per night`}</span>
      </div>
      {finding.recovery && (
        <div className="v2-drift-rec">
          <svg width="56" height="22" viewBox="0 0 44 20" aria-hidden="true">
            <path d="M2 18 Q22 2 42 18" fill="none" stroke="var(--sage)" strokeWidth="1.5" />
            <circle cx="42" cy="18" r="2.3" fill="var(--sage)" />
          </svg>
          <span>back to your usual in ~{finding.recovery.daysToBaseline} day{finding.recovery.daysToBaseline === 1 ? '' : 's'} after a heavy day</span>
        </div>
      )}
    </div>
  );
}

// ── Threads — all the evidence the thread rests on ───────────────────────
function ThreadsBody({ finding }) {
  const examples = finding.examples || [];
  return (
    <div className="v2-pdt-card">
      <div className="v2-pdt-card-label">The days this thread rests on</div>
      <div className="v2-thread-ev">
        {examples.map((ex, i) => (
          <div key={i} className="v2-thread-row">
            <span className="v2-thread-date">{ex.date}</span>
            <span className="v2-thread-sum">{ex.summary}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ n, label }) {
  return (
    <div className="v2-pdt-stat">
      <span className="v2-pdt-stat-n">{n}</span>
      <span className="v2-pdt-stat-l">{label}</span>
    </div>
  );
}

export default function PatternDetail({ patternId, onBack, onOpenDay, onOpenPart }) {
  const [showHow, setShowHow] = useState(false);
  const history = useMemo(() => loadHistory(), []);
  const findings = useMemo(() => computeFindings(history), [history]);
  const byDay = useMemo(() => historyByDay(history), [history]);

  const finding = findings[patternId];
  const tag = LENS_TAG[patternId] || 'Pattern';
  const metric = LENS_METRIC[patternId] || 'patterns';

  // Calibrating / empty: the lens hasn't gathered enough history. Show the
  // same calm message the tile would, plus the way in to the explainer.
  const calibrating = !finding || finding.calibrating
    || (patternId === 'threads' && (!finding.examples || finding.examples.length === 0));

  let body = null;
  if (!calibrating) {
    if (patternId === 'streaks') body = <StreaksBody finding={finding} byDay={byDay} onOpenDay={onOpenDay} />;
    else if (patternId === 'rhythms') body = <RhythmsBody finding={finding} />;
    else if (patternId === 'weather') body = <WeatherBody finding={finding} onOpenDay={onOpenDay} />;
    else if (patternId === 'returns') body = <ReturnsBody finding={finding} onOpenPart={onOpenPart} />;
    else if (patternId === 'drifts') body = <DriftsBody finding={finding} />;
    else if (patternId === 'threads') body = <ThreadsBody finding={finding} />;
  }

  return (
    <section className="v2-pattern">
      <button type="button" className="v2-backrow" onClick={onBack} aria-label="Back to Patterns">
        <IconChevronLeft />
        <span>Patterns</span>
      </button>

      <div className="v2-pdt-eyebrow">
        {tag} · the temporal lens{' '}<ProvenanceChip metric={metric} />
      </div>
      <h1 className="v2-pdt-title">{finding?.headline || 'Still gathering.'}</h1>
      {(finding?.meta || finding?.prose) && (
        <p className="v2-pdt-lead">{finding.meta || finding.prose}</p>
      )}

      {calibrating ? (
        <div className="v2-pdt-card v2-pdt-cal">
          <span className="v2-tile-cal">Calibrating</span>
          <p className="v2-pdt-lead">This lens needs a little more of your own history before it can read. It fills in on its own as you keep writing.</p>
        </div>
      ) : body}

      <button type="button" className="v2-pdt-how" onClick={() => setShowHow(true)}>
        How this lens is read →
      </button>

      <p className="v2-pdt-foot">
        This lens reads only your own history — and says “calibrating” until it has enough of it.
      </p>

      {showHow && <LensExplainer lens={patternId} onClose={() => setShowHow(false)} />}
    </section>
  );
}
