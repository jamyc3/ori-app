// Ori v2 — Pattern tiles.
//
// Each temporal lens is a self-contained widget that draws its own data: a
// streak contribution-map, a weekday bar chart, a mood-energy scatter, the
// recurring parts, the slow drift, the brightest/heaviest day, and — when a
// real one exists — a cross-day thread. The findings come from the same v1
// aggregators (patterns-aggregators.js / threads.js) the classic app uses — so
// these are real readings of the user's own history, not decoration. A lens
// with too little data renders a quiet "calibrating" tile; Threads and
// Highlights instead hide entirely rather than show a forced or empty insight.
//
// Tiles are presentational: hand them a finding object and (optionally) an
// onOpen handler. Styling lives in styles/pattern-tiles.css; the glass
// surface comes from styles/glass.css via the .v2-tile class.

import { ymd } from '../date-util.js';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Shared shell. `span` makes a wide (2-col) tile. Two tap targets:
//   · the tile BODY → onOpen, the lens's full detail (PatternDetail.jsx)
//   · the small "how?" chip → onExplain, how the lens is formed (PatternInfo.jsx)
// When BOTH exist they must be SIBLINGS, never a <button> inside a <button>
// (invalid HTML — screen readers fold the inner control away and pointer
// activation is unreliable). So: a transparent full-tile hit layer for onOpen,
// plus a real corner button for onExplain, over visual-only content.
function Tile({ tag, span, onOpen, onExplain, children }) {
  const tap = onOpen || onExplain;
  const cls = `v2-tile${span ? ' span2' : ''}${tap ? ' tap' : ''}`;

  if (onOpen && onExplain) {
    return (
      <div className={cls} role="group" aria-label={tag}>
        <button
          type="button"
          className="v2-tile-hit"
          onClick={onOpen}
          aria-label={`${tag} — open detail`}
        />
        <div className="v2-tile-tag"><span>{tag}</span></div>
        {children}
        <button
          type="button"
          className="v2-tile-how v2-tile-how-btn"
          onClick={(e) => { e.stopPropagation(); onExplain(); }}
          aria-label={`How ${tag} is read`}
        >how?</button>
      </div>
    );
  }

  // Single (or no) action — one real control, no nesting, so the chip stays a
  // non-interactive visual.
  const head = (
    <div className="v2-tile-tag">
      <span>{tag}</span>
      {onExplain ? <span className="v2-tile-how" aria-hidden="true">how?</span> : null}
    </div>
  );
  if (tap) {
    return (
      <button type="button" className={cls} onClick={tap} aria-label={onOpen ? `${tag} — open detail` : `${tag} — how this is read`}>
        {head}
        {children}
      </button>
    );
  }
  return <div className={cls}>{head}{children}</div>;
}

function Calibrating({ tag, span, headline, meta, onOpen, onExplain }) {
  return (
    <Tile tag={tag} span={span} onOpen={onOpen} onExplain={onExplain}>
      <span className="v2-tile-cal">Calibrating</span>
      <div className="v2-tile-head soft">{headline}</div>
      {meta && <div className="v2-tile-meta">{meta}</div>}
    </Tile>
  );
}

// ── Streaks — a 4-week contribution map + the live streak count ──────────
export function StreakTile({ finding, onOpen, onExplain }) {
  if (!finding) return null;
  const written = new Set(finding.writingDays || []);
  const today = new Date();
  const cells = [];
  for (let k = 27; k >= 0; k--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - k);
    const key = ymd(d);
    cells.push({ key, on: written.has(key), today: k === 0 });
  }
  const current = finding.current ?? 0;
  return (
    <Tile tag="Streaks" span onOpen={onOpen} onExplain={onExplain}>
      <div className="v2-streak-row">
        <div className="v2-streak-fig">
          <span className="v2-streak-num">{current}</span>
          <span className="v2-streak-unit">{current === 1 ? 'day' : 'days'} in a row</span>
        </div>
        <div className="v2-streak-grid" aria-hidden="true">
          {cells.map((c) => (
            <span key={c.key} className={`v2-streak-cell${c.on ? ' on' : ''}${c.today ? ' today' : ''}`} />
          ))}
        </div>
      </div>
      <div className="v2-tile-head">{finding.headline}</div>
      {finding.meta && <div className="v2-tile-meta">{finding.meta}</div>}
    </Tile>
  );
}

// ── Rhythms — per-weekday HCPI bars, peak day lit ───────────────────────
export function RhythmTile({ finding, onOpen, onExplain }) {
  if (!finding) return null;
  if (finding.calibrating) return <Calibrating tag="Rhythms" headline={finding.headline} meta={finding.meta} onOpen={onOpen} onExplain={onExplain} />;
  const bars = finding.weekdayBars || [];
  const max = Math.max(...bars.filter((x) => x != null), 0.01);
  const peakVal = bars[finding.peakDow] || 0.01;
  return (
    <Tile tag="Rhythms" onOpen={onOpen} onExplain={onExplain}>
      <div className="v2-rbars">
        {bars.map((v, i) => {
          const isPeak = i === finding.peakDow;
          const high = !isPeak && v != null && v / peakVal >= 0.78;
          const h = v == null ? 10 : Math.max(14, (v / max) * 100);
          return (
            <span key={i} className="v2-rbar-col">
              <span
                className={`v2-rbar${isPeak ? ' peak' : high ? ' high' : ''}${v == null ? ' null' : ''}`}
                style={{ height: `${h}%` }}
              />
            </span>
          );
        })}
      </div>
      <div className="v2-rdays" aria-hidden="true">
        {DOW.map((d, i) => (
          <span key={i} className={i === finding.peakDow ? 'on' : ''}>{d}</span>
        ))}
      </div>
      <div className="v2-tile-head">{finding.headline}</div>
    </Tile>
  );
}

// ── Weather — a mood (x) × energy (y) scatter of recent days ─────────────
export function WeatherTile({ finding, onOpen, onExplain }) {
  if (!finding) return null;
  if (finding.calibrating) return <Calibrating tag="Weather" headline={finding.headline} meta={finding.meta} onOpen={onOpen} onExplain={onExplain} />;
  const days = finding.days || [];
  return (
    <Tile tag="Weather" onOpen={onOpen} onExplain={onExplain}>
      <div className="v2-wx-plot">
        <span className="v2-wx-axis v" aria-hidden="true" />
        <span className="v2-wx-axis h" aria-hidden="true" />
        {days.map((d, i) => {
          const isToday = i === days.length - 1;
          return (
            <span
              key={i}
              className={`v2-wx-dot${isToday ? ' today' : ''}`}
              style={{ left: `${d.x * 100}%`, top: `${(1 - d.y) * 100}%` }}
            />
          );
        })}
      </div>
      <div className="v2-tile-head">{finding.headline}</div>
    </Tile>
  );
}

// ── Returns — who keeps coming forward (taps through to the part;
//    the footer opens the whole garden) ───────────────────────────────────
export function ReturnsTile({ finding, onOpenParts, onOpen, onExplain }) {
  if (!finding) return null;
  if (finding.calibrating) return <Calibrating tag="Returns" headline={finding.headline} meta={finding.meta} onOpen={onOpen} onExplain={onExplain} />;
  const { topVisitor, friction } = finding;
  return (
    <Tile tag="Returns" onOpen={onOpen} onExplain={onExplain}>
      {topVisitor && (
        <div className="v2-ret-lead">
          <span className="v2-ret-glyph" style={{ color: topVisitor.color, borderColor: topVisitor.color }}>
            {topVisitor.glyph}
          </span>
          <span className="v2-ret-name">
            <b>{topVisitor.name.replace(/^the\s+/i, '')}</b>
            <span>{topVisitor.visits} day{topVisitor.visits === 1 ? '' : 's'} this month</span>
          </span>
        </div>
      )}
      {friction && (
        <div className="v2-ret-fric">
          <span className="v2-ret-fric-bar"><span style={{ width: `${Math.round(friction.share * 100)}%` }} /></span>
          <span className="v2-ret-fric-lbl">{friction.dominant}</span>
        </div>
      )}
      <div className="v2-tile-head">{finding.headline}</div>
      {onOpenParts && (
        <button
          type="button"
          className="v2-ret-all"
          onClick={(e) => { e.stopPropagation(); onOpenParts(); }}
        >
          The garden — all your parts →
        </button>
      )}
    </Tile>
  );
}

// ── Drifts — the slow signed movement (sleep debt / surplus) ────────────
export function DriftTile({ finding, onOpen, onExplain }) {
  if (!finding) return null;
  if (finding.calibrating) return <Calibrating tag="Drifts" headline={finding.headline} meta={finding.meta} onOpen={onOpen} onExplain={onExplain} />;
  // Steady is a real reading (data exists, drift is small). There's nothing to
  // chart, so this is a calm, SELF-EXPLANATORY callout that does NOT open a
  // detail — onOpen/onExplain are intentionally dropped so the tile isn't
  // tappable into an empty graph. Flat figure, not a misleading "+0.0h ↑".
  if (finding.steady) {
    return (
      <Tile tag="Drifts">
        <div className="v2-drift-fig">
          <span className="v2-drift-num">steady</span>
        </div>
        <div className="v2-tile-head">{finding.headline}</div>
        <div className="v2-tile-meta">Close to your usual these past three weeks — nothing to flag.</div>
      </Tile>
    );
  }
  const deltaH = finding.primary?.deltaHours ?? 0;
  const sign = deltaH < 0 ? '−' : '+';
  const down = deltaH < 0;
  return (
    <Tile tag="Drifts" onOpen={onOpen} onExplain={onExplain}>
      <div className="v2-drift-fig">
        <span className={`v2-drift-num${down ? ' down' : ' up'}`}>{sign}{Math.abs(deltaH).toFixed(1)}h</span>
        <span className="v2-drift-arrow" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {down ? <path d="M10 4v12M5 11l5 5 5-5" /> : <path d="M10 16V4M5 9l5-5 5 5" />}
          </svg>
        </span>
      </div>
      {finding.recovery && (
        <div className="v2-drift-rec">
          <svg width="44" height="20" viewBox="0 0 44 20" aria-hidden="true">
            <path d="M2 18 Q22 2 42 18" fill="none" stroke="var(--sage)" strokeWidth="1.5" />
            <circle cx="42" cy="18" r="2.3" fill="var(--sage)" />
          </svg>
          <span>back to your usual in ~{finding.recovery.daysToBaseline} day{finding.recovery.daysToBaseline === 1 ? '' : 's'}</span>
        </div>
      )}
      <div className="v2-tile-head">{finding.headline}</div>
    </Tile>
  );
}

// ── Threads — a cross-day storyline with its evidence ───────────────────
export function ThreadTile({ thread, onOpen, onExplain }) {
  if (!thread) return null;
  // No real cross-day pattern → hide the tile entirely. We deliberately do NOT
  // show a "Nothing crossing days yet" filler card: a forced or empty insight
  // is worse than its absence. The Patterns tab just shows its other lenses,
  // and Threads reappears only when a genuine thread earns its place.
  if (thread.calibrating) return null;
  return (
    <Tile tag="Threads" span onOpen={onOpen} onExplain={onExplain}>
      <div className="v2-tile-head">{thread.headline}</div>
      {thread.prose && <div className="v2-tile-meta">{thread.prose}</div>}
      <div className="v2-thread-ev">
        {(thread.examples || []).slice(0, 3).map((ex, i) => (
          <div key={i} className="v2-thread-row">
            <span className="v2-thread-date">{ex.date}</span>
            <span className="v2-thread-sum">{ex.summary}</span>
          </div>
        ))}
      </div>
    </Tile>
  );
}

// ── Highlights — the brightest & heaviest day of the month, each named by date
//    and tappable straight to that day. Self-contained (no detail / no "how?",
//    like the Drifts "steady" callout): there's nothing to drill into beyond the
//    day itself. The aggregator returns null — so this whole tile is absent —
//    until there's a real spread of days behind it; no forced "highlight".
function SunGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2 12h2M20 12h2M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" />
    </svg>
  );
}
function CloudGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7.5 18a4 4 0 0 1-.3-8 5 5 0 0 1 9.7-1.2A3.6 3.6 0 0 1 17 18H7.5z" />
    </svg>
  );
}

function HighlightCell({ kind, glyph, label, day, onOpenDay }) {
  const open = onOpenDay && day?.key ? () => onOpenDay(day.key) : null;
  return (
    <span
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : undefined}
      className={`v2-hl-cell ${kind}`}
      onClick={open ? (e) => { e.stopPropagation(); open(); } : undefined}
      onKeyDown={open ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); open(); } } : undefined}
      aria-label={open ? `${label} day, ${day.label} — open it` : undefined}
    >
      <span className="v2-hl-glyph" aria-hidden="true">{glyph}</span>
      <span className="v2-hl-txt">
        <span className="v2-hl-kind">{label}</span>
        <span className="v2-hl-date">{day?.label}</span>
      </span>
    </span>
  );
}

export function HighlightTile({ finding, onOpenDay, onExplain }) {
  if (!finding || !finding.brightest || !finding.heaviest) return null;
  return (
    <Tile tag="Highlights" span onExplain={onExplain}>
      <div className="v2-hl-cells">
        <HighlightCell kind="bright" glyph={<SunGlyph />} label="Brightest" day={finding.brightest} onOpenDay={onOpenDay} />
        <HighlightCell kind="heavy" glyph={<CloudGlyph />} label="Heaviest" day={finding.heaviest} onOpenDay={onOpenDay} />
      </div>
      <div className="v2-tile-head">{finding.headline}</div>
    </Tile>
  );
}
