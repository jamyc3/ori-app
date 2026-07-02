// ChartCard — Direction A redesign (Oura discipline, cream paper).
//
// Visual contract:
//   · One typeface (Inter) at three sizes — Medium 16 name, Semibold 30 value,
//     Regular 12.5 subline/anchors. No italic, no monospace, no serif on the card.
//   · Right-side y-axis with 4 anchor labels (passed via `anchors` prop).
//     The label closest to today's value renders in ink/Medium; others muted.
//   · A small dark scrub pill rides above the dot, showing the anchor word for
//     whatever point you're hovering — qualitative read of where you are.
//   · One "i" dot in the top-right hides methodology. No eyebrow taxonomy,
//     no status pills, no three-stat-tile triplet.
//   · The data summary collapses to a single Inter line under the value:
//     "13-night average 7.3 h · usually 6.5 – 8.5 h"
//   · Smooth monotone-cubic curve (Apple Health style), gradient fill,
//     reference band stays for sleep only — but no inline band label.

import { useMemo, useRef, useState } from "react";

// ─── Tokens ───────────────────────────────────────────────────────────
const T = {
  bg:        "#F7F3EC",
  paper:     "#FBF7EE",
  card:      "#FFFCF6",
  ink:       "#1a1a1a",
  soft:      "#2B2824",
  muted:     "#6F695E",
  faint:     "#B8B09D",
  hair:      "rgba(26,26,26,0.07)",
  line:      "rgba(26,26,26,0.12)",
  moss:      "#4F8A5F",
  moss_deep: "#3F5B39",
  moss_soft: "#EEF2E6",
  indigo:    "#475A78",
  clay:      "#BA5F41",
  alert:     "#B0553A",
  sage:      "#A3B88A",
};
const fn = "'Inter', system-ui, -apple-system, sans-serif";

// ─── Pure helpers ─────────────────────────────────────────────────────

// Monotone cubic interpolation (Fritsch-Carlson). Same algorithm Apple
// Health uses — smooth, non-overshooting.
function monotoneCubicPath(points) {
  const n = points.length;
  if (n < 2) return "";
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const dx = []; const dy = []; const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i]);
    dy.push(ys[i + 1] - ys[i]);
    m.push(dy[i] / (dx[i] || 1));
  }
  const t = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0;
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
    }
  }
  let path = `M ${xs[0]} ${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = xs[i] + dx[i] / 3;
    const c1y = ys[i] + (t[i] * dx[i]) / 3;
    const c2x = xs[i + 1] - dx[i] / 3;
    const c2y = ys[i + 1] - (t[i + 1] * dx[i]) / 3;
    path += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${xs[i + 1]} ${ys[i + 1]}`;
  }
  return path;
}

function relativeDay(d) {
  if (!d) return "";
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const cmp = new Date(d); cmp.setHours(0, 0, 0, 0);
  const days = Math.round((now - cmp) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 0) return `in ${-days} days`;
  return `${days} days ago`;
}

function curveColorForBucket(bucket) {
  if (bucket === "reserves") return T.moss_deep;
  if (bucket === "demands") return T.clay;
  if (bucket === "form")    return T.indigo;
  return T.soft;
}

// Map y position → anchor index (0..3, top→bottom).
function anchorIdxForY(y, top, height) {
  const ratio = Math.max(0, Math.min(1, (y - top) / Math.max(1, height)));
  if (ratio < 0.25) return 0;
  if (ratio < 0.50) return 1;
  if (ratio < 0.75) return 2;
  return 3;
}

// ─── Component ────────────────────────────────────────────────────────
//
// Props:
//   name           Metric name (e.g. "Sleep restoration")
//   bucket         "reserves" | "demands" | "form"
//   today          Today's numeric value
//   unit           Short unit text (e.g. "h", "ms")
//   series         [{ date, value }] in chronological order
//   reference      { lo, hi } when a scientifically valid band exists.
//                  No label text — band visibility is the signal.
//   anchors        [topLabel, midHi, midLo, bottomLabel] — 4 strings
//                  describing the y-axis qualitatively.
//   decimals       Decimals on the big number. Default 1.
//   formatValue    Optional value→string override.
//   methodology    Plain-language explanation revealed by the "i" dot.
//
export default function ChartCard({
  name,
  bucket = "reserves",
  today,
  unit = "",
  series = [],
  reference = null,
  anchors = ["High", "Usual", "Light", "Low"],
  // Drift anchor — the user's first-30-days median for this metric,
  // frozen against the rolling baseline. Rendered as a thin dashed
  // horizontal line so longitudinal drift becomes visible at a glance.
  // Null until the user has 30 measurable days.
  anchor = null,
  decimals = 1,
  formatValue = null,
  methodology = "",
}) {
  const [scrubIdx, setScrubIdx] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const svgRef = useRef(null);

  // ── Data ──
  const valid = useMemo(
    () => series.filter((p) => p?.value != null && !isNaN(p.value)),
    [series]
  );
  const hasEnough = valid.length >= 2;

  // ── Geometry ──
  const VB_W = 320;
  const VB_H = 160;
  const PAD_X = 6;
  const PAD_TOP = 14;
  const PAD_BOT = 14;
  const innerW = VB_W - PAD_X * 2;
  const innerH = VB_H - PAD_TOP - PAD_BOT;

  const { yMin, yMax } = useMemo(() => {
    if (!hasEnough) return { yMin: 0, yMax: 1 };
    const vals = valid.map((p) => p.value);
    let mn = Math.min(...vals);
    let mx = Math.max(...vals);
    if (reference) {
      mn = Math.min(mn, reference.lo);
      mx = Math.max(mx, reference.hi);
    }
    if (typeof anchor === "number" && !isNaN(anchor)) {
      // Keep the anchor line in view even if today's series has drifted
      // far from it — otherwise the user can't see the drift they care about.
      mn = Math.min(mn, anchor);
      mx = Math.max(mx, anchor);
    }
    const pad = (mx - mn) * 0.18 || 0.5;
    return { yMin: mn - pad, yMax: mx + pad };
  }, [valid, reference, hasEnough, anchor]);

  const xOf = (i) =>
    PAD_X + (valid.length === 1 ? innerW / 2 : (i / (valid.length - 1)) * innerW);
  const yOf = (v) => PAD_TOP + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const points = useMemo(
    () => valid.map((p, i) => ({
      x: xOf(i), y: yOf(p.value), value: p.value, date: p.date, idx: i,
    })),
    [valid, yMin, yMax]
  );

  const curveD = useMemo(() => monotoneCubicPath(points), [points]);
  const fillD = useMemo(() => {
    if (!curveD || points.length < 2) return "";
    const last = points[points.length - 1];
    const first = points[0];
    return `${curveD} L ${last.x} ${PAD_TOP + innerH} L ${first.x} ${PAD_TOP + innerH} Z`;
  }, [curveD, points]);

  // Stats — "13-night average X · usually low – high"
  const stats = useMemo(() => {
    if (!hasEnough) return null;
    const vals = valid.map((p) => p.value).sort((a, b) => a - b);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    // "Usually" range = 15th–85th percentile, hides outlier days.
    const q = (p) => {
      const idx = (vals.length - 1) * p;
      const lo = Math.floor(idx); const hi = Math.ceil(idx);
      if (lo === hi) return vals[lo];
      return vals[lo] + (vals[hi] - vals[lo]) * (idx - lo);
    };
    return { avg, usualLo: q(0.15), usualHi: q(0.85) };
  }, [valid, hasEnough]);

  // ── Scrub ──
  const onMove = (e) => {
    if (!svgRef.current || points.length < 1) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const ratio = VB_W / rect.width;
    const x = (clientX - rect.left) * ratio;
    let best = 0; let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i].x - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    setScrubIdx(best);
  };
  const onLeave = () => setScrubIdx(null);

  // ── Display values ──
  const displayIdx = scrubIdx != null ? scrubIdx : points.length - 1;
  const displayPoint = points[displayIdx];
  const displayValue =
    scrubIdx != null && displayPoint
      ? displayPoint.value
      : (today != null ? today : (displayPoint?.value ?? null));
  const displayDate = displayPoint?.date;

  const fmt = (v) =>
    formatValue ? formatValue(v) : (typeof v === "number" ? v.toFixed(decimals) : "—");

  const curveColor = curveColorForBucket(bucket);
  const gradId = `chart-grad-${name.replace(/\W/g, "")}-${bucket}`;

  // Active anchor for current display value
  const activeAnchorIdx = displayPoint
    ? anchorIdxForY(displayPoint.y, PAD_TOP, innerH)
    : 1;
  const activeAnchorWord = anchors[activeAnchorIdx] || "";

  // Where (as % of chart width) the scrub pill sits
  const pillLeftPct = displayPoint
    ? ((displayPoint.x - PAD_X) / innerW) * 100
    : null;

  // ── Render ──
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.hair}`,
        borderRadius: 14,
        padding: "18px 18px 16px",
        userSelect: "none",
        fontFamily: fn,
      }}
    >
      {/* Row 1: metric name + info dot */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <h4
          style={{
            margin: 0,
            fontFamily: fn,
            fontWeight: 500,
            fontSize: 16,
            letterSpacing: "-0.005em",
            color: T.ink,
            lineHeight: 1.2,
          }}
        >
          {name}
        </h4>
        {methodology && (
          <button
            type="button"
            onClick={() => setShowInfo((s) => !s)}
            aria-label="How this is measured"
            style={{
              width: 22, height: 22, borderRadius: "50%",
              border: `1px solid ${T.line}`,
              background: showInfo ? T.ink : "transparent",
              color: showInfo ? T.card : T.muted,
              fontFamily: fn, fontWeight: 500, fontSize: 11,
              lineHeight: 1, display: "grid", placeItems: "center",
              cursor: "pointer", padding: 0, flexShrink: 0,
              transition: "background 140ms ease, color 140ms ease",
            }}
          >
            i
          </button>
        )}
      </div>

      {/* Row 2: hero value + tiny unit */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span
          style={{
            fontFamily: fn,
            fontWeight: 600,
            fontSize: 30,
            letterSpacing: "-0.02em",
            color: T.ink,
            fontVariantNumeric: "tabular-nums lining-nums",
            fontFeatureSettings: `"tnum","lnum"`,
            lineHeight: 1.0,
          }}
        >
          {displayValue != null ? fmt(displayValue) : "—"}
        </span>
        {unit && (
          <span
            style={{
              fontFamily: fn, fontWeight: 400, fontSize: 13,
              color: T.muted, letterSpacing: 0,
            }}
          >
            {unit}
          </span>
        )}
      </div>

      {/* Row 3: data summary line */}
      <div
        style={{
          fontFamily: fn, fontWeight: 400, fontSize: 12.5,
          color: T.muted, lineHeight: 1.5, marginBottom: 14,
          fontVariantNumeric: "tabular-nums lining-nums",
        }}
      >
        {scrubIdx != null && displayDate
          ? <>{relativeDay(displayDate)} · scrub a different day to compare</>
          : stats
            ? <>
                {valid.length}-day average {fmt(stats.avg)}
                {unit ? ` ${unit}` : ""} · usually {fmt(stats.usualLo)} – {fmt(stats.usualHi)}
              </>
            : <>Trend will appear once two or more days are in.</>}
      </div>

      {/* Chart wrap: SVG + right-axis anchors + scrub pill */}
      {hasEnough ? (
        <div style={{ position: "relative", marginBottom: 4 }}>
          {/* Floating scrub pill */}
          {displayPoint && activeAnchorWord && (
            <div
              style={{
                position: "absolute",
                top: -2,
                left: `calc(${pillLeftPct}% - ${(60 / 100) * pillLeftPct}px)`,
                transform: "translateX(-50%)",
                background: T.ink,
                color: T.card,
                fontFamily: fn, fontWeight: 500, fontSize: 11,
                padding: "3px 9px",
                borderRadius: 999,
                whiteSpace: "nowrap",
                pointerEvents: "none",
                zIndex: 2,
                transition: "left 90ms cubic-bezier(0.4,0,0.2,1)",
              }}
            >
              {activeAnchorWord}
            </div>
          )}

          {/* SVG chart */}
          <div
            onMouseMove={onMove}
            onMouseLeave={onLeave}
            onTouchStart={(e) => { onMove(e); e.preventDefault(); }}
            onTouchMove={(e) => { onMove(e); e.preventDefault(); }}
            onTouchEnd={onLeave}
            style={{
              position: "relative",
              width: "calc(100% - 60px)",
              touchAction: "pan-y",
            }}
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              preserveAspectRatio="none"
              style={{
                width: "100%", height: 140, display: "block", overflow: "visible",
              }}
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={curveColor} stopOpacity={0.18} />
                  <stop offset="1" stopColor={curveColor} stopOpacity={0} />
                </linearGradient>
              </defs>

              {/* Anchor guide rules — 4 evenly spaced horizontals */}
              {[0.0, 0.333, 0.667, 1.0].map((r, i) => (
                <line
                  key={i}
                  x1={PAD_X}
                  x2={PAD_X + innerW}
                  y1={PAD_TOP + innerH * r}
                  y2={PAD_TOP + innerH * r}
                  stroke={T.hair}
                  strokeWidth={0.6}
                />
              ))}

              {/* Reference band — scientifically valid range for the metric
                  (e.g. sleep 7–9 h, NIH). Filled with the curve color, low
                  opacity. Says "this is what healthy looks like in general." */}
              {reference && (() => {
                const y1 = yOf(reference.hi);
                const y2 = yOf(reference.lo);
                return (
                  <rect
                    x={PAD_X}
                    y={y1}
                    width={innerW}
                    height={y2 - y1}
                    fill={curveColor}
                    opacity={0.06}
                  />
                );
              })()}

              {/* "Usually" band — user's own 15th–85th percentile range
                  across the displayed series. Neutral gray fill so it
                  visually doesn't conflict with the curve-colored reference
                  band when both are present. Wider band = more variance in
                  the user's data → the implicit confidence interval is wide
                  → today's number should be read with less certainty. */}
              {stats && typeof stats.usualLo === "number" && typeof stats.usualHi === "number" && stats.usualHi > stats.usualLo && (() => {
                const yHi = yOf(stats.usualHi);
                const yLo = yOf(stats.usualLo);
                return (
                  <rect
                    x={PAD_X}
                    y={yHi}
                    width={innerW}
                    height={Math.max(1, yLo - yHi)}
                    fill={T.muted}
                    opacity={0.05}
                  >
                    <title>You usually sit between these lines — wider band = more day-to-day variance.</title>
                  </rect>
                );
              })()}

              {/* Drift anchor — user's first-30-days median, frozen */}
              {typeof anchor === "number" && !isNaN(anchor) && (() => {
                const ay = yOf(anchor);
                return (
                  <g>
                    <line
                      x1={PAD_X}
                      x2={PAD_X + innerW}
                      y1={ay}
                      y2={ay}
                      stroke={T.muted}
                      strokeWidth={0.8}
                      strokeDasharray="4 4"
                      opacity={0.7}
                    >
                      <title>Your first 30 days · {typeof formatValue === "function" ? formatValue(anchor) : anchor.toFixed(1)}{unit ? ` ${unit.split(" ")[0]}` : ""}</title>
                    </line>
                    <text
                      x={PAD_X + innerW - 2}
                      y={ay - 3}
                      textAnchor="end"
                      fontFamily={fn}
                      fontWeight={400}
                      fontSize={8}
                      fill={T.muted}
                      opacity={0.85}
                      letterSpacing="0.05em"
                    >
                      FIRST 30
                    </text>
                  </g>
                );
              })()}

              {/* Filled curve */}
              <path d={fillD} fill={`url(#${gradId})`}
                    style={{ transition: "d 240ms ease" }} />
              <path
                d={curveD}
                fill="none"
                stroke={curveColor}
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transition: "d 240ms ease" }}
              />

              {/* Crosshair + dot */}
              {displayPoint && (
                <g>
                  {scrubIdx != null && (
                    <line
                      x1={displayPoint.x}
                      x2={displayPoint.x}
                      y1={PAD_TOP}
                      y2={PAD_TOP + innerH}
                      stroke={T.ink}
                      strokeWidth={0.7}
                      opacity={0.35}
                      style={{ transition: "x1 90ms cubic-bezier(0.4,0,0.2,1), x2 90ms cubic-bezier(0.4,0,0.2,1)" }}
                    />
                  )}
                  <circle
                    cx={displayPoint.x}
                    cy={displayPoint.y}
                    r={scrubIdx != null ? 4 : 3.5}
                    fill={curveColor}
                    stroke={T.card}
                    strokeWidth={2}
                    style={{ transition: "cx 90ms cubic-bezier(0.4,0,0.2,1), cy 90ms cubic-bezier(0.4,0,0.2,1)" }}
                  />
                </g>
              )}
            </svg>
          </div>

          {/* Right-side axis labels (4 anchors, evenly spaced) */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 0, right: 0,
              width: 56,
              height: 140,
              display: "flex", flexDirection: "column",
              justifyContent: "space-between",
              padding: `${(PAD_TOP / VB_H) * 140}px 0 ${(PAD_BOT / VB_H) * 140}px`,
              boxSizing: "border-box",
              pointerEvents: "none",
            }}
          >
            {anchors.map((label, i) => (
              <div
                key={i}
                style={{
                  fontFamily: fn,
                  fontWeight: i === activeAnchorIdx ? 500 : 400,
                  fontSize: 11,
                  color: i === activeAnchorIdx ? T.ink : T.faint,
                  lineHeight: 1,
                  textAlign: "left",
                  paddingLeft: 4,
                  transition: "color 140ms ease, font-weight 140ms ease",
                }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Day-of-week scrub — first letter under each data point */}
          <div
            aria-hidden
            style={{
              position: "relative",
              width: "calc(100% - 60px)",
              height: 14,
              marginTop: 4,
              pointerEvents: "none",
            }}
          >
            {points.map((p, i) => {
              let dow = "";
              try { dow = new Date(p.date).toLocaleDateString("en-US", { weekday: "narrow" }); } catch { /* ignore */ }
              const leftPct = ((p.x - PAD_X) / innerW) * 100;
              return (
                <span
                  key={i}
                  style={{
                    position: "absolute",
                    left: `${leftPct}%`,
                    top: 0,
                    transform: "translateX(-50%)",
                    fontFamily: fn,
                    fontWeight: 400,
                    fontSize: 10,
                    lineHeight: 1,
                    color: T.faint,
                    whiteSpace: "nowrap",
                  }}
                >
                  {dow}
                </span>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: "32px 14px",
            background: T.paper,
            border: `1px dashed ${T.line}`,
            borderRadius: 10,
            fontFamily: fn,
            fontWeight: 400,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: T.muted,
            textAlign: "center",
          }}
        >
          Trend will appear once two or more days are in.
        </div>
      )}

      {/* Drift delta — closes the loop on the FIRST 30 anchor line. Tells
          the user where today actually sits relative to where they started,
          in plain language. ±5% rounds to "on par" so we don't manufacture
          drama out of measurement noise. */}
      {hasEnough && typeof anchor === "number" && !isNaN(anchor)
        && typeof today === "number" && !isNaN(today)
        && (() => {
          const delta = today - anchor;
          const pct = Math.abs(anchor) > 0.001 ? (delta / anchor) * 100 : null;
          if (pct == null) return null;
          const absPct = Math.abs(pct);
          const onPar = absPct < 5;
          return (
            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: `1px solid ${T.hair}`,
                fontFamily: fn,
                fontWeight: 400,
                fontSize: 12,
                lineHeight: 1.5,
                color: T.muted,
                fontVariantNumeric: "tabular-nums lining-nums",
              }}
            >
              {onPar
                ? "On par with where you started."
                : `Currently ${Math.round(absPct)}% ${pct > 0 ? "above" : "below"} your first 30 days.`}
            </div>
          );
        })()}

      {/* Methodology — only visible when "i" is toggled. Auto-includes
          rule explanations for any chart-level features actually
          rendered: FIRST 30 anchor line, "usually" band, ±5% drift
          on-par threshold. */}
      {showInfo && (methodology
        || (typeof anchor === "number" && !isNaN(anchor))
        || (stats && typeof stats.usualLo === "number" && typeof stats.usualHi === "number" && stats.usualHi > stats.usualLo)
      ) && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: `1px solid ${T.hair}`,
            fontFamily: fn,
            fontWeight: 400,
            fontSize: 12.5,
            lineHeight: 1.6,
            color: T.muted,
          }}
        >
          {methodology && <div style={{ marginBottom: 10 }}>{methodology}</div>}
          {stats && typeof stats.usualLo === "number" && typeof stats.usualHi === "number" && stats.usualHi > stats.usualLo && (
            <div style={{ marginBottom: 8 }}>
              <b style={{ color: T.soft, fontWeight: 500 }}>The gray band</b> covers your 15th–85th percentile across the days shown — the middle 70% of your readings. Wider band means more day-to-day variance, so today's number should be read with less certainty.
            </div>
          )}
          {typeof anchor === "number" && !isNaN(anchor) && (
            <div style={{ marginBottom: 8 }}>
              <b style={{ color: T.soft, fontWeight: 500 }}>The dashed "FIRST 30" line</b> is the median of your earliest 30 days, frozen. It stays put so longitudinal drift stays visible — the rolling baseline above quietly follows you, this one doesn't.
            </div>
          )}
          {typeof anchor === "number" && !isNaN(anchor) && (
            <div>
              <b style={{ color: T.soft, fontWeight: 500 }}>"On par with where you started"</b> means today is within ±5% of that anchor. We round that range to flat so noise doesn't read as a trend.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
