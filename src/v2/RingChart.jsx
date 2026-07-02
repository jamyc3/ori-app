// Ori v2 — interactive ring chart (the scrubbable 7-day trend).
//
// The static read in RingDetail used v1's TrendChartFullV5. This is a v2-native
// replacement that keeps the same picture — smooth line, soft "usual" band,
// day strip — but lets you drag a finger across the days to read each one in
// place. It's controlled: the parent owns the selected index and renders the
// big readout; this component draws the line, highlights the selected day
// (guide + halo dot + floating value), and reports the index back as you scrub.
//
// Geometry mirrors v1 (360×140 viewBox, points at chartLeft + i·chartW/(n-1))
// so it reads identically to the chart users already know.

import { useEffect, useRef } from 'react';

const W = 360, H = 140;
const CHART_TOP = 22, CHART_BOTTOM = 128, CHART_LEFT = 10, CHART_RIGHT = 350;
const CHART_H = CHART_BOTTOM - CHART_TOP;
const CHART_W = CHART_RIGHT - CHART_LEFT;

function hexToRgba(hex, a) {
  const h = String(hex || '').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16) || 0;
  const g = parseInt(n.slice(2, 4), 16) || 0;
  const b = parseInt(n.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${a})`;
}

// Catmull–Rom → cubic bezier, over the non-null points only.
function smoothPath(pts) {
  if (pts.length < 2) return null;
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export default function RingChart({ trend, usual, color, selIdx, onSelect }) {
  const svgRef = useRef(null);
  const draggingRef = useRef(false);
  const lastIdxRef = useRef(selIdx);

  const values = trend.map((d) => d.value);
  const valid = values.filter((v) => v != null);

  // Band half-width from the spread of valid values (same clamp as v1).
  let bandHalf = 6;
  if (valid.length >= 2) {
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    const std = Math.sqrt(valid.reduce((s, v) => s + (v - mean) ** 2, 0) / (valid.length - 1));
    bandHalf = Math.max(4, Math.min(15, std));
  }
  const bandLow = usual != null ? Math.max(0, usual - bandHalf) : null;
  const bandHigh = usual != null ? Math.min(100, usual + bandHalf) : null;

  const minBound = Math.min(...(valid.length ? valid : [0]), bandLow ?? 100);
  const maxBound = Math.max(...(valid.length ? valid : [100]), bandHigh ?? 0);
  const span = Math.max(12, maxBound - minBound);
  const pad = span * 0.30;
  const yMin = Math.max(0, Math.floor(minBound - pad));
  const yMax = Math.min(100, Math.ceil(maxBound + pad));
  const yRange = Math.max(1, yMax - yMin);

  const yFor = (v) => (v == null ? null : CHART_BOTTOM - ((v - yMin) / yRange) * CHART_H);
  const xs = trend.map((_, i) => CHART_LEFT + (i * CHART_W) / (trend.length - 1));
  const ys = values.map(yFor);

  const pts = [];
  trend.forEach((_, i) => { if (ys[i] != null) pts.push([xs[i], ys[i], i]); });
  const lineD = smoothPath(pts);
  const firstPx = pts[0]?.[0];
  const lastPx = pts[pts.length - 1]?.[0];
  const areaD = lineD ? `${lineD} L ${lastPx},${CHART_BOTTOM} L ${firstPx},${CHART_BOTTOM} Z` : null;

  const bandYTop = bandHigh != null ? yFor(bandHigh) : null;
  const bandYBot = bandLow != null ? yFor(bandLow) : null;
  const bandMidY = usual != null ? yFor(usual) : null;
  const bandHeight = bandYTop != null && bandYBot != null ? Math.max(2, bandYBot - bandYTop) : null;

  const todayIdx = trend.length - 1;
  const sel = Math.max(0, Math.min(trend.length - 1, selIdx));
  const selHasVal = ys[sel] != null;
  const selX = xs[sel];
  const selY = selHasVal ? ys[sel] : (CHART_TOP + CHART_BOTTOM) / 2;

  const gradId = `ring-grad-${String(color).replace('#', '')}`;
  const showCaption = bandLow != null && bandHigh != null;

  // Map a clientX to the nearest day index.
  const pickIndex = (clientX) => {
    const el = svgRef.current;
    if (!el) return sel;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return sel;
    const xView = ((clientX - r.left) / r.width) * W;
    let best = 0, bd = Infinity;
    xs.forEach((x, i) => { const d = Math.abs(x - xView); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  // Only fire when the snapped day actually changes — the readout moves crisply
  // from day to day instead of re-rendering on every pixel of travel.
  const selectAt = (clientX) => {
    const idx = pickIndex(clientX);
    if (idx !== lastIdxRef.current) { lastIdxRef.current = idx; onSelect(idx); }
  };
  // Pointer drag selects the day under the finger — fires for touch and mouse
  // alike. With touch-action: none on the svg these run continuously without the
  // page scrolling; setPointerCapture keeps the drag if the finger drifts off.
  const onPointerDown = (e) => {
    draggingRef.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    selectAt(e.clientX);
  };
  const onPointerMove = (e) => { if (draggingRef.current) selectAt(e.clientX); };
  const endDrag = () => { draggingRef.current = false; };

  // Keep the dedupe ref in step when the parent resets selection (bucket switch).
  useEffect(() => { lastIdxRef.current = selIdx; }, [selIdx]);

  // Stable ground: stop touch events from bubbling out of the chart so the app's
  // pull-to-refresh (which listens on the content slot) never engages mid-scrub.
  // touch-action: none on the svg blocks native scroll; selection is the pointer
  // events above. Passive listeners — stopPropagation is allowed in them.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const stop = (e) => e.stopPropagation();
    el.addEventListener('touchstart', stop, { passive: true });
    el.addEventListener('touchmove', stop, { passive: true });
    el.addEventListener('touchend', stop, { passive: true });
    return () => {
      el.removeEventListener('touchstart', stop);
      el.removeEventListener('touchmove', stop);
      el.removeEventListener('touchend', stop);
    };
  }, []);

  return (
    <div>
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', overflow: 'visible', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', cursor: 'pointer' }}
        role="slider"
        aria-label="Scrub across the last 7 days"
        aria-valuemin={0}
        aria-valuemax={trend.length - 1}
        aria-valuenow={sel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Usual band */}
        {bandYTop != null && bandHeight != null && (
          <rect x="0" y={bandYTop} width={W} height={bandHeight} fill={color} opacity="0.07" rx="2" />
        )}
        {bandMidY != null && (
          <line x1="0" x2={W} y1={bandMidY} y2={bandMidY} stroke={color} strokeWidth="0.5" opacity="0.18" />
        )}

        {/* Area + smooth line */}
        {areaD && <path d={areaD} fill={`url(#${gradId})`} />}
        {lineD && <path d={lineD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}

        {/* Past-day outlined dots — every day; the selected marker glides over
            them, so the dots underneath stay put and nothing pops. */}
        {trend.map((d, i) => (
          ys[i] == null ? null : (
            <circle key={`pd-${i}`} cx={xs[i]} cy={ys[i]} r="2.8" fill="var(--card)" stroke={color} strokeWidth="1.4" />
          )
        ))}

        {/* Selection guide — glides between days instead of teleporting. */}
        <g style={{ transform: `translateX(${selX}px)`, transition: 'transform .15s cubic-bezier(.22,1,.36,1)' }}>
          <line x1="0" x2="0" y1={CHART_TOP - 4} y2={CHART_BOTTOM} stroke={color} strokeWidth="1" opacity="0.28" />
        </g>

        {/* Selected day — halo + filled dot + floating value (or an open dashed
            ring when that day has no reading). One group, translated, so it
            glides smoothly as you move across the days. */}
        <g style={{ transform: `translate(${selX}px, ${selY}px)`, transition: 'transform .15s cubic-bezier(.22,1,.36,1)' }}>
          {selHasVal ? (
            <>
              <circle cx="0" cy="0" r="11" fill={color} opacity="0.10" />
              <circle cx="0" cy="0" r="4.6" fill={color} />
              <line x1="0" x2="0" y1="-14" y2="-7" stroke={color} strokeWidth="0.8" opacity="0.55" />
              <text x="0" y="-16" textAnchor="middle" fontFamily="var(--fd)" fontStyle="italic" fontSize="14" fill={color} fontWeight="400">
                {Math.round(values[sel])}
              </text>
            </>
          ) : (
            <circle cx="0" cy="0" r="4.4" fill="var(--card)" stroke="var(--faint)" strokeWidth="1" strokeDasharray="2 2" />
          )}
        </g>
      </svg>

      {/* Day strip — real HTML so the labels don't stretch with the viewBox.
          Today keeps a filled chip; the selected day gets an outlined ring. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginTop: 12, padding: '0 4px' }}>
        {trend.map((d, i) => {
          const isToday = i === todayIdx;
          const isSel = i === sel;
          const base = { fontFamily: 'var(--fm)', fontSize: 10.5, letterSpacing: '0.4px', textAlign: 'center' };
          if (!isToday && !isSel) {
            return <div key={`day-${i}`} style={{ ...base, color: 'var(--faint)' }}>{d.label}</div>;
          }
          return (
            <div key={`day-${i}`} style={{ display: 'inline-flex', justifyContent: 'center' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
                fontWeight: 700, fontFamily: 'var(--fm)', fontSize: 10.5, letterSpacing: '0.4px',
                background: isToday ? color : 'transparent',
                color: isToday ? 'var(--card)' : color,
                border: isSel && !isToday ? `1.4px solid ${color}` : '1.4px solid transparent',
              }}>{d.label}</span>
            </div>
          );
        })}
      </div>

      {/* Band caption */}
      {showCaption && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          margin: '12px 4px 0', padding: '0 2px',
          fontFamily: 'var(--fm)', fontSize: 9, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--faint)',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 18, height: 6, borderRadius: 2, background: hexToRgba(color, 0.22) }} />
            your usual range · past month
          </span>
          <span style={{
            fontFamily: 'var(--fd)', fontStyle: 'italic', fontSize: 11, color: 'var(--ink)',
            letterSpacing: 0, textTransform: 'none', fontVariantNumeric: 'tabular-nums',
          }}>{Math.round(bandLow)} – {Math.round(bandHigh)}</span>
        </div>
      )}
    </div>
  );
}
