// CognitiveProfile — the You tab.
//
// Oura-style 3-bucket entry view:
//   · Reserves — what you started with
//   · Demands  — what pressed on you
//   · Form     — how you came through
//
// Tap any score circle → opens a detail modal scrolled to that bucket.
// Each detail shows real contributors as score cards (band + one
// teaching sentence) and not-yet-measured contributors as info cards
// (dashed, no number, plain-English description of what unlocks).
//
// Below the circles: a small "Your writing" strip (days-based) and
// two drawers — "Your patterns" (was AI lens) and "How this works"
// (was "How Ori reads you"). No AI-centric language anywhere visible.
//
// All visible numbers come from real engine signals via props. The
// hardcoded baselines and the two not-yet-measured demands are
// rendered as info cards instead of fake numbers — honest by default.

import React, { useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ymdISO } from "./dates.js";
import { OURA_HISTORY_KEY, loadRepo } from "./engine.js";
import { PARTS_LIB } from "./LetterReading.jsx";
import {
  signalsForToday as calendarSignalsForToday,
  signalsForLast14Days as calendarSignalsForWindow,
  hasAnyFeed,
} from "./calendar.js";
import {
  interruptionCost,
  beingSeenWeight,
  statsForMetric,
} from "./calendar-signals.js";
import ChartCard from "./ChartCard.jsx";
import Who5Intake from "./Who5Intake.jsx";
import {
  todayWho5, bandFor as who5BandFor,
  recentWho5, who5Series, firstNAnchorWho5,
} from "./who5.js";

// ─── Series helpers (per-metric 14-day chronological windows) ────────
// Each returns [{ date: Date, value: number | null }] in chronological
// order (oldest → today). The ChartCard skips null entries.

const SERIES_DAYS = 14;

function ouraSeries(field, days = SERIES_DAYS, transform = (v) => v) {
  try {
    const raw = localStorage.getItem(OURA_HISTORY_KEY);
    if (!raw) return [];
    const map = JSON.parse(raw);
    const out = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const k = ymdISO(d);
      const v = map[k]?.[field];
      out.push({ date: d, value: typeof v === "number" && !isNaN(v) ? transform(v) : null });
    }
    return out;
  } catch { return []; }
}

// History-derived series (e.g. params.mu, decisionCount). Pass a getter
// that pulls the right field from a history entry and a transform.
function historySeries(history, getter, days = SERIES_DAYS) {
  if (!Array.isArray(history)) return [];
  // Map entries by YYYY-MM-DD (newest first → map will keep the last
  // write per date, which is fine since we want the most recent value
  // for that day).
  const byDate = {};
  for (const h of history) {
    const dRaw = h?.date;
    if (!dRaw) continue;
    const k = typeof dRaw === "string" ? dRaw.slice(0, 10) : ymdISO(new Date(dRaw));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
    const v = getter(h);
    if (v != null && !isNaN(v) && byDate[k] == null) byDate[k] = v;
  }
  const out = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const k = ymdISO(d);
    out.push({ date: d, value: byDate[k] != null ? byDate[k] : null });
  }
  return out;
}

// Drift anchors — the user's first-30-days baseline, computed once they
// have ≥30 days of measurable data and treated as a FROZEN reference
// against the rolling baseline. Lets a user (and us) see longitudinal
// drift that the rolling math silently follows. Median over the 30
// earliest chronological observations.
const ANCHOR_N = 30;
function firstNAnchorFromHistory(history, getter, n = ANCHOR_N) {
  if (!Array.isArray(history)) return null;
  const dated = [];
  for (const h of history) {
    const v = getter(h);
    if (v == null || isNaN(v)) continue;
    const t = h?.date ? new Date(h.date).getTime() : NaN;
    if (!Number.isFinite(t)) continue;
    dated.push({ t, v });
  }
  if (dated.length < n) return null;
  dated.sort((a, b) => a.t - b.t);
  const firstN = dated.slice(0, n).map((x) => x.v).sort((a, b) => a - b);
  return firstN[Math.floor(firstN.length / 2)];
}
function firstNAnchorFromOura(field, transform = (v) => v, n = ANCHOR_N) {
  try {
    const raw = localStorage.getItem(OURA_HISTORY_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    const dated = [];
    for (const k of Object.keys(map || {})) {
      const v = map[k]?.[field];
      if (typeof v !== "number" || isNaN(v)) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
      dated.push({ k, v: transform(v) });
    }
    if (dated.length < n) return null;
    dated.sort((a, b) => a.k.localeCompare(b.k));
    const firstN = dated.slice(0, n).map((x) => x.v).sort((a, b) => a - b);
    return firstN[Math.floor(firstN.length / 2)];
  } catch { return null; }
}

// Calendar signals → series. The window helper from calendar.js returns
// 14 daily signal objects newest-first; we reverse for chronological.
function calendarSeriesFromWindow(window, metricFn) {
  if (!Array.isArray(window) || window.length === 0) return [];
  const reversed = [...window].reverse();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return reversed.map((s, i) => {
    const d = new Date(today); d.setDate(today.getDate() - (reversed.length - 1 - i));
    return {
      date: d,
      value: s && s.meetings > 0 ? metricFn(s) : null,
    };
  });
}

// ─── Tokens ──────────────────────────────────────────────────────────
const T = {
  bg:     "#F7F3EC",
  paper:  "#FBF7EE",
  card:   "#FFFCF6",
  ink:    "#1a1a1a",
  soft:   "#2B2824",
  muted:  "#6F695E",
  faint:  "#B8B09D",
  hair:   "rgba(26,26,26,0.07)",
  line:   "rgba(26,26,26,0.12)",
  leaf:   "#3F5B39",
  moss:   "#4F8A5F",
  sage:   "#A3B88A",
  bloom:  "#C98660",
  sepia:  "#705B3C",
  indigo: "#475A78",
  warn:   "#C4902A",
  alert:  "#B0553A",
};
const fd = "'Playfair Display', Georgia, serif";
const fb = "'Source Serif 4', Georgia, serif";
const fm = "'DM Mono', ui-monospace, monospace";

// ─── v2 theme bridge ─────────────────────────────────────────────────
// BucketDetailModal (with its TrendChart/contributor-row subtree) also
// renders inside the v2 shell — "The full breakdown" on Ring detail.
// v1's tokens are baked hex values, so under v2's Nightfall themes the
// panel used to open as the cream v1 page: the one place the new skin
// leaked the old one. When <html data-skin="v2"> is up, re-read the
// active v2 custom properties — resolved to concrete values, because
// SVG fill/stroke attributes can't take var() — and hand back a
// T-shaped object. Classic keeps module T untouched.
function activeT() {
  const v1 = { ...T, fd, fb, fm, track: "rgba(26,26,26,0.06)", map: (c) => c };
  if (typeof document === "undefined") return v1;
  const root = document.documentElement;
  if (root.getAttribute("data-skin") !== "v2") return v1;
  const cs = getComputedStyle(root);
  const read = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  const themed = {
    bg:     read("--screen", T.bg),
    paper:  read("--card", T.paper),
    card:   read("--card", T.card),
    ink:    read("--ink", T.ink),
    soft:   read("--soft", T.soft),
    muted:  read("--muted", T.muted),
    faint:  read("--faint", T.faint),
    hair:   read("--hair", T.hair),
    line:   read("--line", T.line),
    leaf:   read("--forest", T.leaf),
    moss:   read("--sage", T.moss),
    sage:   read("--sage", T.sage),
    bloom:  read("--clay", T.bloom),
    sepia:  T.sepia,
    indigo: T.indigo,
    warn:   read("--amber", T.warn),
    alert:  read("--clay", T.alert),
    fd:     read("--fd", fd),
    fb:     read("--fb", fb),
    fm:     read("--fm", fm),
    track:  read("--hair", "rgba(255,255,255,0.08)"),
  };
  // Contributor data carries colors computed against module T
  // (computeStats runs skin-agnostic); translate the ones that appear
  // as fills so state still reads correctly on the dark themes.
  const swap = {
    [T.leaf]: themed.leaf, [T.moss]: themed.moss,
    [T.warn]: themed.warn, [T.alert]: themed.alert,
  };
  themed.map = (c) => swap[c] || c;
  return themed;
}

// ─── Helpers ─────────────────────────────────────────────────────────

export function uniqueCheckinDays(history = []) {
  const set = new Set();
  for (const h of history) {
    const d = h?.date;
    if (!d) continue;
    const ymd = typeof d === "string" ? d.slice(0, 10) : ymdISO(new Date(d));
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) set.add(ymd);
  }
  return set;
}

function computeFirstDay(history = []) {
  let earliestMs = null;
  for (const h of history || []) {
    if (!h?.date) continue;
    const d = new Date(h.date);
    if (!isNaN(d.getTime()) && (earliestMs == null || d.getTime() < earliestMs)) {
      earliestMs = d.getTime();
    }
  }
  try {
    const raw = localStorage.getItem(OURA_HISTORY_KEY);
    if (raw) {
      const map = JSON.parse(raw);
      for (const k of Object.keys(map || {})) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k)) {
          const d = new Date(k + "T00:00:00");
          if (!isNaN(d.getTime()) && (earliestMs == null || d.getTime() < earliestMs)) {
            earliestMs = d.getTime();
          }
        }
      }
    }
  } catch { /* ignore */ }
  const out = earliestMs != null ? new Date(earliestMs) : new Date();
  out.setHours(0, 0, 0, 0);
  return out;
}

const MS_PER_DAY = 86400000;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

function formatDateRelative(target, today) {
  const t = startOfDay(target);
  const n = startOfDay(today);
  const days = Math.round((t.getTime() - n.getTime()) / MS_PER_DAY);
  const weekday = t.toLocaleDateString(undefined, { weekday: "long" });
  const monthDay = t.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days >= 2 && days <= 6) return weekday;
  if (days >= 7 && days <= 13) return `Next ${weekday}`;
  if (days <= -2 && days >= -6) return `Last ${weekday}`;
  return monthDay;
}

export function ouraNightCount(daysWindow = 28) {
  try {
    const raw = localStorage.getItem(OURA_HISTORY_KEY);
    if (!raw) return 0;
    const map = JSON.parse(raw);
    const today = new Date();
    let n = 0;
    for (let i = 0; i < daysWindow; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const k = ymdISO(d);
      if (map?.[k]?.totalSleepMin > 0) n++;
    }
    return n;
  } catch { return 0; }
}

function readingsWritten(history = []) {
  const set = new Set();
  for (const h of history) {
    if (!Array.isArray(h?.letterParts) || h.letterParts.length === 0) continue;
    const d = h?.date;
    if (!d) continue;
    const ymd = typeof d === "string" ? d.slice(0, 10) : ymdISO(new Date(d));
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) set.add(ymd);
  }
  return set.size;
}

export function computePhase(daysWritten, nightsRecorded) {
  const days = Math.max(daysWritten, nightsRecorded);
  if (days < 3)  return { key: "listening",   days, target: 3,  next: "first reading" };
  if (days < 7)  return { key: "snapshot",    days, target: 7,  next: "reserves become legible" };
  if (days < 14) return { key: "capacity",    days, target: 14, next: "full reading becomes available" };
  if (days < 21) return { key: "full",        days, target: 21, next: "your typical settles" };
  if (days < 28) return { key: "consistency", days, target: 28, next: "deeper currents settle" };
  return { key: "stable", days, target: null, next: null };
}

function fmtDelta(d, dir) {
  if (d == null || isNaN(d)) return null;
  if (Math.abs(d) < 2) return { text: "on par", tone: "flat" };
  const sign = d > 0 ? "+" : "";
  const tone = (dir === "up" ? d > 0 : d < 0) ? "up" : "down";
  return { text: `${sign}${Math.round(d)} vs typical`, tone };
}

// Median + spread from a window of real values. Returns null when there's
// nothing to derive from. Used to compute the user's own baseline + CI
// instead of relying on hardcoded reference numbers.
function statsOf(arr) {
  const xs = (arr || []).filter(v => typeof v === "number" && !isNaN(v));
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.length > 1
    ? xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1)
    : 0;
  return { median, mean, std: Math.sqrt(variance), n: xs.length };
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Minimum sample thresholds — baseline marker and ±CI only render when
// the user has at least this much real history. No fake "vs typical" lines.
const MIN_N_BASELINE = 7;
const MIN_N_CI = 5;

// ─── Shared atoms ────────────────────────────────────────────────────

function Eyebrow({ children, style }) {
  return (
    <div style={{
      fontFamily: fm, fontSize: 10, letterSpacing: "0.20em",
      textTransform: "uppercase", color: T.muted, ...style,
    }}>{children}</div>
  );
}

// Small "i" dot + reveal panel. Used wherever a claim on the You tab
// needs a one-tap path to its rule/threshold. Parent owns open state.

function ClaimDot({ open, onToggle, ariaLabel = "What this means", style }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      aria-label={ariaLabel}
      style={{
        width: 18, height: 18, borderRadius: "50%",
        border: `1px solid ${T.line}`,
        background: open ? T.ink : "transparent",
        color: open ? T.paper : T.muted,
        fontFamily: fb, fontWeight: 500, fontSize: 10, lineHeight: 1,
        display: "inline-grid", placeItems: "center",
        cursor: "pointer", padding: 0, marginLeft: 8,
        verticalAlign: "middle", flexShrink: 0,
        transition: "background 140ms ease, color 140ms ease",
        ...style,
      }}
    >i</button>
  );
}

function ClaimPanel({ children, style }) {
  return (
    <div style={{
      marginTop: 10, padding: "12px 14px",
      background: T.paper, border: `1px solid ${T.hair}`,
      borderRadius: 10,
      fontFamily: fb, fontSize: 12.5, lineHeight: 1.6, color: T.muted,
      maxWidth: "38em",
      ...style,
    }}>{children}</div>
  );
}

// Extended-wake card — surfaces only when the user has been awake
// long enough that the validated cognitive-performance literature
// has something to say. This is the one part of the old HCPI that
// has external science behind it: Dawson & Reid 1997 (Nature)
// showed ≈17 hours of sustained wakefulness produces a cognitive
// impairment equivalent to a 0.05% BAC, replicated widely.
//
// Two tiers, both gated on real hours-awake from the latest entry's
// wakeTime (or a 07:00 default):
//   · Ha > 14h — gentle heads-up; the curve starts to bite
//   · Ha > 16h — real flag; sleep is the lever
//
// The card hides itself when Ha ≤ 14 so it only takes space when it
// actually has something to say.

function ExtendedWakeCard({ history }) {
  const [now, setNow] = useState(() => new Date());
  const [infoOpen, setInfoOpen] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const wakeStr = history?.[0]?.wakeTime || "07:00";
  const [hh, mm] = String(wakeStr).split(":").map((s) => Number(s));
  const wakeHour = (Number.isFinite(hh) ? hh : 7) + (Number.isFinite(mm) ? mm : 0) / 60;
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const Ha = Math.max(0, nowHour - wakeHour + (nowHour < wakeHour ? 24 : 0));

  if (Ha <= 14) return null;

  const isAlert = Ha > 16;
  const hours = Math.floor(Ha);
  const headline = isAlert
    ? `You've been awake ${hours} hours.`
    : `You've been awake about ${hours} hours.`;
  const body = isAlert
    ? "Past sixteen hours, the brain's recovery curve gets steep. Sustained wakefulness this long performs roughly like a small-glass-of-wine baseline on attention and reaction time. Sleep is the lever — most other levers stopped working a while ago."
    : "You're entering the part of the day where decisions and reaction speed start to dull. If something important is left on today's list, doing it before bed beats doing it after.";

  const tone = isAlert
    ? { bg: "rgba(176,85,58,0.06)", border: "rgba(176,85,58,0.32)", ink: T.alert }
    : { bg: "rgba(196,144,42,0.06)", border: "rgba(196,144,42,0.32)", ink: T.warn };

  return (
    <div style={{
      background: tone.bg,
      border: `1px solid ${tone.border}`,
      borderRadius: 12,
      padding: "14px 16px",
      marginBottom: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{
          fontFamily: fm, fontSize: 9.5, letterSpacing: "0.16em",
          textTransform: "uppercase", color: tone.ink,
        }}>{isAlert ? "Sleep is the lever now" : "Late-day heads-up"}</div>
        <ClaimDot
          open={infoOpen}
          onToggle={() => setInfoOpen((v) => !v)}
          ariaLabel="What this rule is based on"
          style={{ marginLeft: 0 }}
        />
      </div>
      <p style={{
        fontFamily: fd, fontStyle: "italic", fontWeight: 300,
        fontSize: 18, lineHeight: 1.35, color: T.ink,
        margin: "8px 0 6px",
      }}>{headline}</p>
      <p style={{
        fontFamily: fb, fontSize: 13, lineHeight: 1.55, color: T.soft,
        margin: 0, maxWidth: "36em",
      }}>{body}</p>
      {infoOpen && (
        <ClaimPanel style={{ background: T.bg, marginTop: 12 }}>
          The threshold comes from <b>Dawson &amp; Reid 1997</b> (Nature), which
          showed roughly 17 hours of sustained wakefulness produces a cognitive-
          performance decrement comparable to a 0.05% blood-alcohol level on
          attention, reaction time, and decision tasks. We surface a gentle
          heads-up at 14h and a real flag at 16h — well-replicated, single
          input (your wake time), no composite math.
        </ClaimPanel>
      )}
    </div>
  );
}

// Daily check-in tile — sits at the top of the You tab. Shows
// today's WHO-5 score with its published Topp band if logged, or a
// soft prompt to log if not. Opens the WHO-5 intake sheet on tap.
//
// WHO-5 is decoupled from journal entries by design — it stores its
// own history under cpi_who5_history so a user can answer the five
// items without writing, and write without answering them. Future
// notification (PR #2) opens the same sheet.

// Compressed daily strip — fuses the WHO-5 check-in prompt with the
// writing-days / nights / readings counts into a single inline row.
// Apple-grade restraint: one row, one tap target, no full-width hero
// card hogging the top of the page.
// Compose the strip's one-line "noticing" from the stats we already have.
// Full mode talks in body language; reflect mode names the words as the source.
// No raw counts — those live in Settings · Cold-start audit, where they belong.
function composeStripLine(stats, hasWearable) {
  const d = stats.daysWritten || 0;
  const n = stats.nightsRecorded || 0;
  if (hasWearable) {
    if (n < 3) return "Tonight teaches the ring how to read you.";
    if (n < 7) return `${n} nights tracked — the body is starting to settle.`;
    if (d < 14) return `${n} nights settled. Body is reading.`;
    return "Body, demands, and form are reading from your week.";
  }
  // Reflect mode — name the words as the source.
  if (d < 3) return "Tonight is just a beginning.";
  if (d < 7) return `${d} mornings written — a rhythm is forming.`;
  if (d < 14) return `${d} writing days settled — reserves and form are reading from your words.`;
  return "Reading clearly from what you've written this week.";
}

function DailyStrip({ stats }) {
  const [today, setToday] = useState(() => todayWho5());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const refresh = () => setToday(todayWho5());
    window.addEventListener("cpi:who5-updated", refresh);
    return () => window.removeEventListener("cpi:who5-updated", refresh);
  }, []);
  const band = today ? who5BandFor(today.score) : null;
  const filled = !!today;
  // Source mode — filled pip = full (wearable), outlined pip = reflect.
  // Same flags we already check on the rest of the page.
  const hasWearable = (() => {
    try {
      return !!localStorage.getItem("cpi_oura_access_token") ||
        localStorage.getItem("apple_health_granted") === "true";
    } catch { return false; }
  })();
  const line = composeStripLine(stats, hasWearable);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={filled ? "Edit today's check-in" : "Open today's check-in"}
        style={{
          width: "100%", textAlign: "left", marginTop: 18, marginBottom: 4,
          cursor: "pointer",
          background: T.card, border: `1px solid ${T.hair}`,
          borderRadius: 12, padding: "12px 14px",
          fontFamily: "inherit", color: T.ink,
          display: "flex", alignItems: "center",
          gap: 12, minHeight: 52,
        }}
      >
        {/* Source pip — filled forest = full mode, outlined ring = reflect mode */}
        <span style={{
          width: 9, height: 9, borderRadius: "50%",
          background: hasWearable ? T.leaf : "transparent",
          border: hasWearable ? "none" : `1.5px solid ${T.leaf}`,
          flexShrink: 0,
        }} />
        <span style={{
          flex: 1,
          fontFamily: fd, fontStyle: "italic", fontWeight: 300,
          fontSize: 15, lineHeight: 1.34,
          color: T.ink,
        }}>{line}</span>
        {filled ? (
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1, flexShrink: 0 }}>
            <span style={{
              fontFamily: fd, fontStyle: "italic", fontWeight: 300,
              fontSize: 18, color: T.ink, lineHeight: 1,
            }}>{today.score}</span>
            <span style={{
              fontFamily: fm, fontSize: 9, letterSpacing: "0.12em",
              textTransform: "uppercase", color: T.muted,
            }}>{band?.label || ""}</span>
          </span>
        ) : (
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
            <span style={{
              fontFamily: fm, fontSize: 10, letterSpacing: "0.14em",
              textTransform: "uppercase", color: T.leaf, fontWeight: 500,
              whiteSpace: "nowrap",
            }}>How you feel&nbsp;→</span>
            <span style={{
              fontFamily: fm, fontSize: 8.5, letterSpacing: "0.10em",
              textTransform: "uppercase", color: T.muted,
              whiteSpace: "nowrap",
            }}>5 questions · 1 min</span>
          </span>
        )}
      </button>
      {open && (
        <Who5Intake
          onClose={() => setOpen(false)}
          onSubmit={(s) => setToday(s)}
        />
      )}
    </>
  );
}

// ─── Reflect-mode quick details ──────────────────────────────────────
// Only shown when no wearable is connected. Three calm states:
//   1. Collapsed — a quiet single-row invitation to add a few details
//   2. Expanded  — Apple Health-style settings list (Woke at, Energy, Sleep)
//   3. Filled    — small summary row, tap "Edit" to reopen
// Day-scoped: storage key includes today's YMD so the card resets at
// midnight without any global state.

const REFLECT_DETAILS_KEY = (ymd) => `ori_reflect_details_${ymd}`;

function getReflectDetails() {
  const k = REFLECT_DETAILS_KEY(ymdISO(new Date()));
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j && (j.wokeAt || j.energy || j.sleep) ? j : null;
  } catch { return null; }
}

function ReflectModeDetails() {
  const [details, setDetails] = useState(() => getReflectDetails());
  const [expanded, setExpanded] = useState(false);
  const filled = details && (details.wokeAt || details.energy != null || details.sleep != null);

  // Each row is a tap-to-prompt. A prompt() keeps the UI minimal — Apple
  // Health uses sheets, but for three small approximations a prompt is
  // honest about what we're capturing without dragging in a sheet stack.
  const ask = (field) => {
    const labels = {
      wokeAt: "When did you wake up? (e.g., 7:14 AM)",
      energy: "Morning energy, 1–10",
      sleep:  "Hours of sleep last night",
    };
    const cur = details?.[field] ?? "";
    const next = window.prompt(labels[field], cur);
    if (next == null) return;
    const trimmed = String(next).trim();
    const merged = { ...(details || {}), [field]: trimmed || null };
    const k = REFLECT_DETAILS_KEY(ymdISO(new Date()));
    try { localStorage.setItem(k, JSON.stringify(merged)); } catch {}
    setDetails(merged);
  };

  const rowStyle = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "13px 16px",
    borderBottom: `1px solid ${T.hair}`,
    cursor: "pointer", gap: 12,
    background: "transparent", border: "none", borderTop: "none",
    borderLeft: "none", borderRight: "none",
    width: "100%", textAlign: "left", fontFamily: "inherit",
  };

  const fieldLabels = [
    { key: "wokeAt", label: "Woke at",        format: (v) => v || "Set" },
    { key: "energy", label: "Morning energy", format: (v) => v ? `${v} / 10` : "Set" },
    { key: "sleep",  label: "Hours of sleep", format: (v) => v ? `${v} h` : "Set" },
  ];

  // Filled-state summary row — quiet, just informative.
  if (filled && !expanded) {
    return (
      <div style={{
        marginTop: 4,
        padding: "12px 2px 4px",
        borderTop: `1px solid ${T.hair}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {fieldLabels.filter((f) => details?.[f.key]).map((f) => (
            <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontFamily: fb, fontSize: 10.5, color: T.muted }}>{f.label}</span>
              <span style={{ fontFamily: fb, fontSize: 14, fontWeight: 500, color: T.ink }}>{f.format(details[f.key])}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            fontFamily: fb, fontSize: 13, fontWeight: 500,
            color: T.leaf, cursor: "pointer",
            background: "transparent", border: "none", padding: 0,
          }}
        >Edit</button>
      </div>
    );
  }

  // Expanded — Apple Health-style settings list.
  if (expanded || filled) {
    return (
      <div style={{
        marginTop: 6,
        background: T.card,
        border: `1px solid ${T.hair}`,
        borderRadius: 12,
        overflow: "hidden",
      }}>
        <div style={{
          padding: "13px 16px 11px",
          borderBottom: `1px solid ${T.hair}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontFamily: fb, fontSize: 14, fontWeight: 500, color: T.ink }}>Today's details</span>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            style={{
              fontFamily: fb, fontSize: 13, fontWeight: 500,
              color: T.leaf, background: "transparent", border: "none",
              padding: 0, cursor: "pointer",
            }}
          >Done</button>
        </div>
        {fieldLabels.map((f, i) => {
          const v = details?.[f.key];
          const isLast = i === fieldLabels.length - 1;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => ask(f.key)}
              style={{ ...rowStyle, borderBottom: isLast ? "none" : `1px solid ${T.hair}` }}
            >
              <span style={{ fontFamily: fb, fontSize: 14, color: T.ink }}>{f.label}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  fontFamily: fb, fontSize: 14,
                  fontWeight: v ? 500 : 400,
                  color: v ? T.ink : T.muted,
                }}>{f.format(v)}</span>
                <span style={{ fontFamily: fb, fontSize: 14, color: T.faint }}>›</span>
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  // Default — quiet invitation.
  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      style={{
        marginTop: 8,
        padding: "10px 2px 2px",
        width: "100%",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 10, cursor: "pointer",
        background: "transparent", border: "none",
        textAlign: "left",
      }}
    >
      <span style={{ fontFamily: fb, fontSize: 13.5, color: T.soft }}>
        Add a few details for a clearer reading
      </span>
      <span style={{ fontFamily: fb, fontSize: 14, fontWeight: 500, color: T.leaf, flexShrink: 0 }}>›</span>
    </button>
  );
}

// Legacy hero-card tile — preserved for the calibrating view (which
// still has its own onboarding rhythm). The calibrated view now uses
// the compressed DailyStrip above.
function Who5Tile() {
  const [today, setToday] = useState(() => todayWho5());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const refresh = () => setToday(todayWho5());
    window.addEventListener("cpi:who5-updated", refresh);
    return () => window.removeEventListener("cpi:who5-updated", refresh);
  }, []);
  const band = today ? who5BandFor(today.score) : null;
  const filled = !!today;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          width: "100%", textAlign: "left", marginBottom: 16, cursor: "pointer",
          background: filled ? T.card : "rgba(63,91,57,0.05)",
          border: `1px solid ${filled ? T.hair : "rgba(63,91,57,0.22)"}`,
          borderRadius: 12, padding: "12px 14px",
          fontFamily: "inherit", color: T.ink,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12,
        }}
        aria-label={filled ? "Edit today's check-in" : "Log today's check-in"}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{
            fontFamily: fm, fontSize: 9.5, letterSpacing: "0.16em",
            textTransform: "uppercase", color: filled ? T.muted : T.leaf,
          }}>Daily check-in</span>
          {!filled && (
            <span style={{
              fontFamily: fb, fontStyle: "italic", fontSize: 12.5, color: T.muted,
            }}>five quick ones · 30 sec</span>
          )}
        </div>
        {filled ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{
              fontFamily: fd, fontStyle: "italic", fontWeight: 300,
              fontSize: 22, lineHeight: 1, color: T.ink,
            }}>{today.score}</span>
            <span style={{
              fontFamily: fm, fontSize: 9.5, letterSpacing: "0.14em",
              textTransform: "uppercase", color: T.muted,
            }}>{band?.label || ""}</span>
          </div>
        ) : (
          <span style={{
            fontFamily: fm, fontSize: 10, letterSpacing: "0.14em",
            textTransform: "uppercase", color: T.leaf, fontWeight: 500,
          }}>Log →</span>
        )}
      </button>
      {open && (
        <Who5Intake
          onClose={() => setOpen(false)}
          onSubmit={(s) => setToday(s)}
        />
      )}
    </>
  );
}

function PhasePill({ phase }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "6px 12px", borderRadius: 999,
      background: "rgba(79,138,95,0.10)",
      border: "1px solid rgba(79,138,95,0.22)",
      fontFamily: fm, fontSize: 10, letterSpacing: "0.12em",
      textTransform: "uppercase", color: T.leaf,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.moss }} />
      <span>Day {phase.days} · {phase.key === "stable" ? "fully calibrated" : `still ${phase.next || "growing"}`}</span>
    </div>
  );
}

// ─── Score circle (tappable) ─────────────────────────────────────────

function ScoreCircle({ score, ringColor, label, sublabel, delta, onTap }) {
  const dasharray = 213.6;
  const hasScore = score != null && !isNaN(score);
  const progress = hasScore ? Math.max(0, Math.min(1, score / 100)) : 0;
  const dashoffset = dasharray * (1 - progress);
  return (
    <button
      type="button"
      onClick={onTap}
      style={{
        background: T.card, border: `1px solid ${T.hair}`, borderRadius: 18,
        padding: "18px 8px 16px", textAlign: "center", cursor: "pointer",
        position: "relative", width: "100%", fontFamily: "inherit",
      }}
    >
      <div style={{
        width: 92, height: 92, margin: "0 auto", display: "grid",
        placeItems: "center", position: "relative",
      }}>
        <svg viewBox="0 0 80 80" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <circle cx="40" cy="40" r="34" stroke="rgba(26,26,26,0.06)" strokeWidth="6" fill="none" />
          <circle cx="40" cy="40" r="34" stroke={ringColor} strokeWidth="6" fill="none"
            strokeDasharray={dasharray} strokeDashoffset={dashoffset}
            transform="rotate(-90 40 40)" strokeLinecap="round" />
        </svg>
        <div style={{
          fontFamily: fd, fontStyle: "italic", fontWeight: 300,
          fontSize: hasScore ? 30 : 26, lineHeight: 1,
          color: hasScore ? T.ink : T.faint,
          position: "relative", zIndex: 2,
        }}>{hasScore ? Math.round(score) : "—"}</div>
      </div>
      <div style={{
        marginTop: 12, fontFamily: fd, fontStyle: "italic", fontWeight: 400,
        fontSize: 17, lineHeight: 1.1, color: T.ink,
      }}>{label}</div>
      <div style={{
        marginTop: 4, fontFamily: fb, fontStyle: "italic",
        fontSize: 11.5, lineHeight: 1.35, color: T.muted, padding: "0 4px",
      }}>{sublabel}</div>
      {delta && (
        <div style={{
          marginTop: 6, fontFamily: fm, fontSize: 9, letterSpacing: "0.04em",
          color: delta.tone === "up" ? T.alert : delta.tone === "down" ? T.moss : T.muted,
        }}>{delta.text}</div>
      )}
    </button>
  );
}

// ─── Contributor row + info card ─────────────────────────────────────

function ContributorRow({ name, value, ci, teach, fillColor, fillPct, baselinePct, source, status, drivenBy }) {
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.hair}`, borderRadius: 12,
      padding: "14px 16px",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10,
      }}>
        <div style={{ fontFamily: fb, fontSize: 14, color: T.soft }}>{name}</div>
        <div style={{ fontFamily: fm, fontSize: 13, color: T.ink, whiteSpace: "nowrap" }}>
          {value.toFixed(2)}
          {ci != null && (
            <span style={{ color: T.faint, marginLeft: 4, fontSize: 10.5 }}>
              ±{ci.toFixed(2)}
            </span>
          )}
        </div>
      </div>
      <p style={{
        margin: "6px 0 0", fontFamily: fb, fontStyle: "italic",
        fontSize: 12.5, lineHeight: 1.55, color: T.muted, maxWidth: "36em",
      }}>{teach}</p>
      <div style={{
        position: "relative", height: 6, background: "rgba(26,26,26,0.05)",
        borderRadius: 999, margin: "10px 0 6px",
      }}>
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${Math.min(100, fillPct)}%`, background: fillColor, borderRadius: 999,
        }} />
        {baselinePct != null && (
          <div style={{
            position: "absolute", top: -2, bottom: -2, width: 1.5,
            background: T.soft, left: `${Math.min(100, baselinePct)}%`,
          }} />
        )}
      </div>
      <div style={{
        display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
        fontFamily: fm, fontSize: 9.5, letterSpacing: "0.04em", color: T.muted,
      }}>
        <span>{source}</span>
        {drivenBy ? (
          <span style={{ color: T.soft, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{
              display: "inline-block", width: 7, height: 7, borderRadius: 2,
              background: drivenBy.color,
            }} />
            driven by {drivenBy.label}
          </span>
        ) : status ? (
          <span style={{
            color: status.tone === "good" ? T.moss :
                   status.tone === "attn" ? T.warn :
                   status.tone === "high" ? T.alert : T.soft,
          }}>{status.text}</span>
        ) : null}
      </div>
    </div>
  );
}

function InfoCardRow({ name, pill, desc }) {
  return (
    <div style={{
      background: "transparent", border: `1px dashed ${T.line}`, borderRadius: 12,
      padding: "14px 16px",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10,
      }}>
        <div style={{ fontFamily: fb, fontSize: 14, color: T.muted }}>{name}</div>
        <span style={{
          fontFamily: fm, fontSize: 9, letterSpacing: "0.14em",
          textTransform: "uppercase", color: T.muted,
          padding: "3px 9px", border: `1px solid ${T.line}`, borderRadius: 999,
          background: "rgba(26,26,26,0.02)", whiteSpace: "nowrap",
        }}>{pill}</span>
      </div>
      <p style={{
        margin: "8px 0 0", fontFamily: fb, fontStyle: "italic",
        fontSize: 13, lineHeight: 1.55, color: T.soft, maxWidth: "36em",
      }}>{desc}</p>
    </div>
  );
}


// ─── Detail modal — three bucket sections stacked ────────────────────

const BUCKET_CONFIGS = {
  reserves: {
    eyebrow: "What you started with",
    headline: "Reserves",
    sub: "The fuel in your tank when the day began. Drawn from how well you slept, how calm your body is at rest, and the patience you haven't spent yet.",
    ring: T.leaf,
    bandLabels: ["below usual", "your typical", "optimal"],
    readyAt: 7,
    waitingNote: "Reserves read from your sleep and heart-rate variability. Become legible after a week of nights — long enough for the rhythm to stabilize.",
    footNote: null,
  },
  demands: {
    eyebrow: "What pressed on you",
    headline: "Demands",
    sub: "The specific pressures your day put on you. Not who you are — what today asked of you.",
    ring: T.leaf,
    bandLabels: ["light", "your typical", "heavy"],
    readyAt: 14,
    waitingNote: "The day's pressures need 14 days of writing to become legible — patterns have to repeat enough to call something usual.",
    footNote: null,
  },
  form: {
    eyebrow: "How you came through",
    headline: "Form",
    sub: "How you carried yourself today, given the demands you faced. Each row points back to which demand drove it most.",
    ring: T.leaf,
    bandLabels: ["quiet", "your typical", "strong"],
    readyAt: 14,
    waitingNote: "Form needs 14 days to bootstrap usable confidence intervals. Until then, anything we showed would overstate.",
    footNote: "Decision stamina from the old view was the same signal as Patience & willpower under Reserves. One canonical home now — where it belongs.",
  },
};

// Monotone cubic spline (Fritsch–Carlson) — same algorithm Apple
// Health uses for its smooth, non-overshooting trend lines.
function monotoneCubicD(pts) {
  if (pts.length < 2) return "";
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const n = pts.length;
  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i]);
    dy.push(ys[i + 1] - ys[i]);
    m.push(dy[i] / (dx[i] || 1));
  }
  const t = new Array(n);
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0;
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
    }
  }
  let d = `M ${xs[0].toFixed(1)} ${ys[0].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = xs[i] + dx[i] / 3;
    const c1y = ys[i] + (t[i] * dx[i]) / 3;
    const c2x = xs[i + 1] - dx[i] / 3;
    const c2y = ys[i + 1] - (t[i + 1] * dx[i]) / 3;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${xs[i + 1].toFixed(1)} ${ys[i + 1].toFixed(1)}`;
  }
  return d;
}

// Pick a stable bucket-family color for chart curves. The dot on the
// row stays status-driven (moss/amber), but the curve uses the bucket's
// identity color so all charts in one bucket read as a visual family.
// Demands uses a muted bronze-terracotta (matching the score ring)
// rather than a saturated clay — the chart is closer to skin tone,
// less "warning-light" on the eye.
function chartColorFor(bucket) {
  // One identity color across all buckets — forest. The bucket label tells
  // you which one you're in; the color tells you only the state. Sage /
  // amber / clay appear when news; otherwise everything rests in forest.
  return "#3F5B39";
}

// TrendChart — Apple-Health-grade chart matching the previous ChartCard
// pattern: valid points distributed evenly across the chart width
// (so a sparse 14-day series still fills the chart, not crams to the
// right), HTML anchor labels beside the SVG (not inside it), day-of-
// week strip below, scrubber that follows pointer / touch.
function TrendChart({ series, bucket, formatValue, anchors }) {
  const TT = activeT();
  const color = TT.map(chartColorFor(bucket));
  const valid = series.filter((p) => p.value != null);
  const [scrubIdx, setScrubIdx] = useState(null);
  const svgRef = useRef(null);

  if (valid.length < 2) return null;

  // Geometry — match ChartCard so the chart reads as a coherent family.
  const VB_W = 320, VB_H = 130;
  const PAD_X = 6, PAD_T = 12, PAD_B = 22;
  const innerW = VB_W - PAD_X * 2;
  const innerH = VB_H - PAD_T - PAD_B;

  const vmin = Math.min(...valid.map((p) => p.value));
  const vmax = Math.max(...valid.map((p) => p.value));
  const pad = (vmax - vmin) * 0.18 || 0.05;
  const ymin = vmin - pad, ymax = vmax + pad;
  const yrange = Math.max(0.001, ymax - ymin);

  // x-axis maps over VALID points only — sparse data fills the chart
  // instead of cramming itself to the right side.
  const xOf = (i) => valid.length === 1
    ? PAD_X + innerW / 2
    : PAD_X + (i / (valid.length - 1)) * innerW;
  const yOf = (v) => PAD_T + innerH - ((v - ymin) / yrange) * innerH;

  const pts = valid.map((p, i) => ({
    x: xOf(i), y: yOf(p.value), value: p.value, date: p.date, idx: i,
  }));

  const dPath = monotoneCubicD(pts);
  const dFill = dPath
    + ` L ${pts[pts.length - 1].x.toFixed(1)} ${(PAD_T + innerH).toFixed(1)}`
    + ` L ${pts[0].x.toFixed(1)} ${(PAD_T + innerH).toFixed(1)} Z`;

  const handleMove = (clientX) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const xVB = ((clientX - rect.left) / rect.width) * VB_W;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.abs(pts[i].x - xVB);
      if (d < bestD) { bestD = d; best = i; }
    }
    setScrubIdx(best);
  };

  const fmt = formatValue || ((v) => v.toFixed(2));
  const scrubPt = scrubIdx != null ? pts[scrubIdx] : null;
  const displayPt = scrubPt || pts[pts.length - 1];
  const scrubLabel = scrubPt
    ? `${fmt(scrubPt.value)} · ${scrubPt.date ? new Date(scrubPt.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : ""}`
    : null;

  // Day-of-week strip — driven by valid points' actual dates so the
  // letters always match the curve underneath, even with gaps.
  const DOW = ["S", "M", "T", "W", "T", "F", "S"];
  const dowLabels = pts.map((p, i) => ({
    x: p.x,
    letter: p.date ? DOW[new Date(p.date).getDay()] : "",
    isToday: i === pts.length - 1,
  }));

  // Anchor highlight — based on current display value's y position.
  const activeAnchorIdx = (() => {
    if (!anchors || anchors.length !== 4) return -1;
    const ratio = (displayPt.y - PAD_T) / innerH; // 0 top → 1 bottom
    if (ratio < 0.25) return 0;
    if (ratio < 0.50) return 1;
    if (ratio < 0.75) return 2;
    return 3;
  })();

  const gradId = `g-${bucket}-${valid.length}`;
  const hasAnchors = anchors && anchors.length === 4;

  return (
    <div style={{ width: "100%", margin: "10px 0 4px" }}>
      {/* Scrub readout */}
      <div style={{
        height: 18, display: "flex", alignItems: "center",
        fontFamily: TT.fm, fontSize: 10.5, letterSpacing: "0.04em",
        color: scrubPt ? TT.ink : TT.faint, marginBottom: 4,
      }}>
        {scrubLabel || `${valid.length}-day trend · drag across to inspect`}
      </div>

      {/* Chart + right-side anchor column. SVG sits on the left,
          anchor labels in a fixed 56px column on the right — same
          discipline as the previous ChartCard. */}
      <div style={{ position: "relative", display: "flex", alignItems: "stretch" }}>
        <div
          onMouseMove={(e) => handleMove(e.clientX)}
          onMouseLeave={() => setScrubIdx(null)}
          onTouchStart={(e) => { if (e.touches[0]) handleMove(e.touches[0].clientX); }}
          onTouchMove={(e) => { if (e.touches[0]) handleMove(e.touches[0].clientX); }}
          onTouchEnd={() => setScrubIdx(null)}
          style={{
            flex: 1,
            width: hasAnchors ? "calc(100% - 56px)" : "100%",
            touchAction: "pan-y",
          }}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="none"
            style={{ width: "100%", height: 130, display: "block", cursor: "pointer" }}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.34" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Faint horizontal guide rules at 4 anchor positions */}
            {hasAnchors && [0.0, 0.333, 0.667, 1.0].map((r, i) => (
              <line key={i}
                x1={PAD_X} x2={PAD_X + innerW}
                y1={PAD_T + innerH * r} y2={PAD_T + innerH * r}
                stroke={TT.hair} strokeWidth="0.6" />
            ))}

            {/* fill under curve — v1 Build "shimmer" opacity */}
            <path d={dFill} fill={`url(#${gradId})`} />
            {/* the curve */}
            <path d={dPath} fill="none" stroke={color}
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

            {/* scrubber line */}
            {scrubPt && (
              <line x1={scrubPt.x} x2={scrubPt.x}
                y1={PAD_T} y2={PAD_T + innerH}
                stroke={TT.ink} strokeWidth="0.7" opacity="0.35" />
            )}

            {/* v1 Build endpoint marker — a vertical line drops from the top
                of the chart to the endpoint dot, and the dot itself sits
                with a thick light-cream stroke so it reads as "today's value
                landed here". Only on the last point, never the scrub. */}
            {!scrubPt && (
              <line x1={displayPt.x} x2={displayPt.x}
                y1={PAD_T} y2={displayPt.y}
                stroke={color} strokeWidth="0.9" opacity="0.42" />
            )}
            <circle cx={displayPt.x} cy={displayPt.y}
              r={scrubPt ? 4 : 4.2} fill={color}
              stroke={TT.bg} strokeWidth="2" />

            {/* day-of-week strip */}
            {dowLabels.map((lbl, i) => {
              if (valid.length > 10 && i % 2 !== 0 && !lbl.isToday) return null;
              return (
                <text key={i} x={lbl.x} y={VB_H - 5}
                  textAnchor="middle" fontFamily={TT.fm} fontSize="9"
                  fontWeight={lbl.isToday ? "500" : "400"}
                  fill={lbl.isToday ? TT.ink : TT.faint}
                  style={{ letterSpacing: "0.06em" }}>
                  {lbl.letter}
                </text>
              );
            })}
          </svg>
        </div>

        {hasAnchors && (
          <div aria-hidden style={{
            width: 56, height: 130, flexShrink: 0,
            display: "flex", flexDirection: "column",
            justifyContent: "space-between",
            padding: `${(PAD_T / VB_H) * 130}px 0 ${(PAD_B / VB_H) * 130}px 10px`,
            boxSizing: "border-box",
            pointerEvents: "none",
          }}>
            {anchors.map((label, i) => (
              <div key={i} style={{
                fontFamily: TT.fm, fontSize: 10,
                letterSpacing: "0.05em",
                color: i === activeAnchorIdx ? TT.ink : TT.faint,
                fontWeight: i === activeAnchorIdx ? 500 : 400,
                lineHeight: 1, whiteSpace: "nowrap",
                transition: "color 140ms ease",
              }}>{label}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// One contributor as a single-line row, tap-to-expand. Five rows take
// roughly the vertical space of one Oura contributor card. The dot
// inherits the bar color so direction reads at a glance.
function CollapsedContributorRow({ contributor }) {
  const [expanded, setExpanded] = useState(false);
  const c = contributor;
  const TT = activeT();

  if (c.kind === "info") {
    return (
      <div style={{
        padding: "14px 0", borderBottom: `1px solid ${TT.hair}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%",
            border: `1.5px dashed ${TT.line}`, background: "transparent",
            flexShrink: 0,
          }} />
          <span style={{ fontFamily: TT.fb, fontSize: 14, color: TT.muted }}>{c.name}</span>
        </div>
        <span style={{
          fontFamily: TT.fm, fontSize: 9.5, letterSpacing: "0.10em",
          textTransform: "uppercase", color: TT.faint, textAlign: "right",
        }}>{c.pill}</span>
      </div>
    );
  }

  // Arrow logic: compare value (0–1) against baseline (0–100 pct → /100).
  let arrow = "—", arrowColor = TT.muted;
  if (c.baselinePct != null) {
    const base01 = c.baselinePct / 100;
    const delta = c.value - base01;
    if (Math.abs(delta) >= 0.04) {
      arrow = delta > 0 ? "↑" : "↓";
      arrowColor = c.fillColor === T.warn || c.fillColor === T.alert ? TT.warn : TT.moss;
    }
  }
  const dotColor = c.fillColor || T.moss;

  return (
    <div style={{ borderBottom: `1px solid ${TT.hair}` }}>
      <button
        type="button"
        onClick={() => setExpanded((s) => !s)}
        aria-expanded={expanded}
        style={{
          width: "100%", border: "none", background: "transparent",
          padding: "14px 0", display: "flex", alignItems: "center", gap: 12,
          cursor: "pointer", fontFamily: "inherit", textAlign: "left",
        }}
      >
        {dotColor === T.moss ? (
          // On-par / tracked. A four-petal flower instead of a plain dot —
          // the calm state of the page still feels alive, not absent.
          <svg width="13" height="13" viewBox="0 0 10 10" style={{ flexShrink: 0, display: "block" }} aria-hidden="true">
            <circle cx="5" cy="2.0" r="1.5" fill={TT.leaf} />
            <circle cx="2.0" cy="5" r="1.5" fill={TT.leaf} />
            <circle cx="8.0" cy="5" r="1.5" fill={TT.leaf} />
            <circle cx="5" cy="8.0" r="1.5" fill={TT.leaf} />
            <circle cx="5" cy="5" r="1.0" fill={TT.paper} />
          </svg>
        ) : (
          <span style={{
            width: 10, height: 10, borderRadius: "50%",
            background: TT.map(dotColor), flexShrink: 0,
          }} />
        )}
        <span style={{ flex: 1, fontFamily: TT.fb, fontSize: 14, color: TT.soft }}>{c.name}</span>
        <span style={{ fontFamily: TT.fm, fontSize: 13, color: TT.ink }}>
          {c.value.toFixed(2)}
        </span>
        <span style={{
          fontFamily: TT.fm, fontSize: 12, color: arrowColor,
          width: 14, textAlign: "right",
        }}>{arrow}</span>
      </button>
      {expanded && (
        <div style={{ padding: "0 0 14px" }}>
          <div style={{
            background: TT.card, border: `1px solid ${TT.hair}`, borderRadius: 12,
            padding: "12px 14px",
          }}>
            <p style={{
              margin: 0, fontFamily: TT.fb, fontStyle: "italic",
              fontSize: 12.5, lineHeight: 1.55, color: TT.muted,
              maxWidth: "36em",
            }}>{c.teach}</p>
            <div style={{
              position: "relative", height: 6, background: TT.track,
              borderRadius: 999, margin: "10px 0 4px",
            }}>
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                width: `${Math.min(100, c.fillPct)}%`,
                background: TT.map(c.fillColor || T.moss), borderRadius: 999,
              }} />
              {c.baselinePct != null && (
                <div style={{
                  position: "absolute", top: -2, bottom: -2, width: 1.5,
                  background: TT.soft, left: `${Math.min(100, c.baselinePct)}%`,
                }} />
              )}
            </div>
            {c.series && c.series.length >= 2 && (
              <TrendChart
                series={c.series}
                bucket={c.bucket || "reserves"}
                formatValue={c.formatValue}
                anchors={c.anchors}
              />
            )}
            <div style={{
              display: "flex", justifyContent: "space-between", gap: 10,
              fontFamily: TT.fm, fontSize: 9.5, letterSpacing: "0.04em",
              color: TT.muted, marginTop: 6,
            }}>
              <span>{c.source}</span>
              {c.status && (
                <span style={{
                  color: c.status.tone === "good" ? TT.moss :
                         c.status.tone === "attn" ? TT.warn : TT.soft,
                }}>{c.status.text}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function BucketDetailModal({ onClose, stats, phase, bucket }) {
  const TT = activeT();
  // Animation-state machine so the page can slide IN on mount and slide OUT
  // on close. Without `closing`, clicking back would yank the page off the
  // viewport instantly — what makes the gesture feel native is the matching
  // exit transition. `mounted` flips to true on the next tick so the initial
  // translateX(100%) state is committed to the DOM before we animate to 0.
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  // dragX is the live finger position during an edge-back swipe. Set
  // on touchmove (positive = finger moved right of start), released to
  // 0 if the user lifts without crossing the dismiss threshold.
  const [dragX, setDragX] = useState(0);
  const dragRef = useRef({ startX: null, active: false });
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    // Match the slide-out transition (320ms). When it ends, the parent
    // unmounts this component — by then the panel is offscreen.
    setTimeout(() => onClose(), 320);
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Edge-back swipe — only triggers when the gesture starts within 28px
  // of the left edge so it doesn't fight horizontal carousels or text
  // selection further into the page. While the finger is down the panel
  // follows the drag (translateX = dragX). Releasing past 35% of viewport
  // width completes the close; otherwise it snaps back to zero.
  useEffect(() => {
    const onTouchStart = (e) => {
      const t = e.touches?.[0]; if (!t) return;
      if (t.clientX > 28) return;
      dragRef.current = { startX: t.clientX, active: true };
    };
    const onTouchMove = (e) => {
      if (!dragRef.current.active) return;
      const t = e.touches?.[0]; if (!t) return;
      const dx = t.clientX - dragRef.current.startX;
      if (dx > 0) setDragX(dx);
    };
    const onTouchEnd = () => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      const w = window.innerWidth || 320;
      // Use a functional set so we read the latest dragX, then decide.
      setDragX(prev => {
        if (prev > w * 0.35) {
          // Complete the dismissal — keep the offset, then close.
          setClosing(true);
          setTimeout(() => onClose(), 320);
          return prev;
        }
        return 0;
      });
    };
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cfg = BUCKET_CONFIGS[bucket];
  if (!cfg) return null;
  const bucketStats = stats[bucket];
  const ready = phase.days >= cfg.readyAt;

  const remaining = Math.max(0, cfg.readyAt - phase.days);

  // Full-page push, the pattern Oura and Apple Health use for metric detail
  // screens: opaque background covering the entire viewport (no dim, no
  // peek of the You tab behind), single scrollable surface running the
  // whole height, top nav bar with a back chevron and centered title.
  // Renders via Portal so the panel anchors to the viewport regardless of
  // the You-tab wrapper's transforms or overflow. No body scroll lock —
  // the page itself owns the only scroll context, and overscroll-behavior
  // on the inner scroller keeps any rubber-band contained.
  // Three transform states are layered: (1) initial off-screen-right,
  // (2) the live finger drag, (3) the closing slide-back-to-the-right.
  // Closing wins, then dragging, else open.
  let slideTransform;
  if (!mounted || closing) slideTransform = "translateX(100%)";
  else if (dragX > 0) slideTransform = `translateX(${dragX}px)`;
  else slideTransform = "translateX(0)";

  // Only animate when the finger is NOT touching — during a live drag
  // we want the panel to track the gesture frame-for-frame.
  const slideTransition = dragX > 0 && !closing
    ? "none"
    : "transform 320ms cubic-bezier(0.32, 0.72, 0, 1)";

  return createPortal(
    <div
      data-modal-open="true"
      data-no-swipe="true"
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: TT.bg,
        transform: slideTransform,
        transition: slideTransition,
        display: "flex", flexDirection: "column",
      }}
    >
      {/* Top nav bar — back chevron left, title centered. Sticks above the
          scroll. Honours the iOS safe-area inset so it sits below the
          status bar / Dynamic Island on real hardware. */}
      <div style={{
        flex: "0 0 auto",
        padding: "calc(env(safe-area-inset-top, 0px) + 6px) 8px 6px",
        background: TT.bg,
        borderBottom: `0.5px solid ${TT.hair}`,
        position: "relative",
        display: "flex", alignItems: "center", minHeight: 52,
      }}>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Back"
          style={{
            display: "inline-flex", alignItems: "center", gap: 2,
            padding: "8px 12px", minHeight: 44, minWidth: 64,
            border: "none", background: "transparent", cursor: "pointer",
            color: TT.ink, fontFamily: TT.fb, fontSize: 17,
          }}
        >
          {/* Back chevron — sized to match Apple's nav-bar chevron weight. */}
          <span style={{ fontSize: 22, lineHeight: 1, marginTop: -2 }}>‹</span>
          <span>Back</span>
        </button>
        <div style={{
          position: "absolute", left: 0, right: 0, textAlign: "center",
          pointerEvents: "none",
          fontFamily: TT.fb, fontSize: 16, fontWeight: 600, color: TT.ink,
          letterSpacing: "-0.005em",
        }}>{cfg.eyebrow}</div>
      </div>

      {/* The single scrollable surface — Oura/Apple Health "one canvas"
          rule. No nested scroll regions. Everything below the nav bar
          flows as one column with native momentum and rubber-band. */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        overflowX: "hidden",
        overscrollBehavior: "contain",
        padding: "14px 20px calc(env(safe-area-inset-bottom, 0px) + 20px)",
      }}>
        <h2 style={{
          fontFamily: TT.fd, fontStyle: "italic", fontWeight: 400,
          fontSize: 20, lineHeight: 1.2, letterSpacing: "-0.005em",
          color: TT.ink, margin: "4px 0 6px",
        }}>{cfg.headline}</h2>
        <p style={{
          fontFamily: TT.fb, fontSize: 13, lineHeight: 1.5, color: TT.muted,
          margin: "0 0 16px", maxWidth: "38em",
        }}>{cfg.sub}</p>

        {!ready ? (
          <div style={{
            background: TT.card, border: `1px dashed ${TT.line}`, borderRadius: 14,
            padding: "18px 18px",
          }}>
            <div style={{
              fontFamily: TT.fm, fontSize: 10, letterSpacing: "0.16em",
              textTransform: "uppercase", color: TT.muted, marginBottom: 8,
            }}>Becomes legible in {remaining} {remaining === 1 ? "day" : "days"}</div>
            <p style={{
              fontFamily: TT.fb, fontSize: 14, lineHeight: 1.6, color: TT.soft, margin: 0,
            }}>{cfg.waitingNote}</p>
          </div>
        ) : (
          <>
            {bucketStats.score != null && !isNaN(bucketStats.score) && (
              <div style={{
                background: TT.card, border: `1px solid ${TT.hair}`, borderRadius: 16,
                padding: "16px 18px 14px", marginBottom: 12,
              }}>
                <div style={{
                  fontFamily: TT.fd, fontStyle: "italic", fontWeight: 300,
                  fontSize: 28, lineHeight: 1, color: TT.ink,
                }}>{Math.round(bucketStats.score)}
                  <span style={{
                    fontFamily: TT.fm, fontStyle: "normal", fontSize: 10,
                    color: TT.faint, marginLeft: 5, letterSpacing: "0.06em",
                  }}>/ 100</span>
                </div>
                <div style={{
                  marginTop: 14, position: "relative", height: 8, borderRadius: 999,
                  background: TT.track, overflow: "hidden",
                }}>
                  <div style={{
                    position: "absolute", left: 0, top: 0, bottom: 0,
                    width: `${Math.min(100, bucketStats.score)}%`,
                    background: TT.map(cfg.ring), borderRadius: 999,
                  }} />
                  {bucketStats.baselinePct != null && (
                    <div style={{
                      position: "absolute", top: -3, bottom: -3, width: 1.5,
                      background: TT.soft, left: `${Math.min(100, bucketStats.baselinePct)}%`,
                    }} />
                  )}
                </div>
                <div style={{
                  display: "flex", justifyContent: "space-between", marginTop: 6,
                  fontFamily: TT.fm, fontSize: 9, letterSpacing: "0.06em", color: TT.faint,
                }}>
                  {cfg.bandLabels.map((l, i) => <span key={i}>{l}</span>)}
                </div>
                {bucketStats.baselinePct == null ? (
                  <p style={{
                    margin: "10px 0 0", fontFamily: TT.fb, fontStyle: "italic",
                    fontSize: 11.5, lineHeight: 1.5, color: TT.muted,
                  }}>"Your typical" line appears once we have 7+ days of your own data behind it.</p>
                ) : (
                  <p style={{
                    margin: "10px 0 0", fontFamily: TT.fb, fontStyle: "italic",
                    fontSize: 11.5, lineHeight: 1.5, color: TT.muted,
                  }}>The vertical mark is your typical — within <b>±4 points</b> is called <b>on par</b>.</p>
                )}
              </div>
            )}

            <div style={{ borderTop: `1px solid ${TT.hair}` }}>
              {bucketStats.contributors.map((c) => (
                <CollapsedContributorRow key={c.name} contributor={c} />
              ))}
            </div>

            {cfg.footNote && (
              <p style={{
                marginTop: 18, paddingTop: 14, borderTop: `1px solid ${TT.hair}`,
                fontFamily: TT.fb, fontStyle: "italic", fontSize: 11.5, lineHeight: 1.6,
                color: TT.muted,
              }}>{cfg.footNote}</p>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── Bottom-of-You-tab swipe carousel ───────────────────────────────
// Horizontal-scroll, snap-aligned row of always-open summary cards.
// Replaces the previous stack of collapsible <details> drawers so the
// bottom of the You tab fits in a single viewport instead of pushing
// content far below the fold. Browser's native scroll-snap handles the
// gesture — momentum, rubber-band, and snap-on-release all come free.
// data-no-swipe so the global tab-swipe handler in CPI.jsx doesn't
// intercept the horizontal motion.
function SwipeCarousel({ children }) {
  const cards = React.Children.toArray(children);
  return (
    <div
      data-no-swipe="true"
      style={{
        marginTop: 18,
        marginLeft: -22, marginRight: -22, // bleed to viewport edge so the snap edges feel intentional
        paddingLeft: 18, paddingRight: 18,
        display: "flex", gap: 12,
        overflowX: "auto",
        overflowY: "hidden",
        scrollSnapType: "x mandatory",
        scrollPaddingLeft: 18, scrollPaddingRight: 18,
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
      }}
    >
      <style>{`
        [data-carousel-track]::-webkit-scrollbar { display: none; }
      `}</style>
      {cards.map((card, i) => (
        <div
          key={i}
          style={{
            flex: "0 0 calc(100vw - 56px)",
            maxWidth: "calc(100vw - 56px)",
            scrollSnapAlign: "start",
          }}
        >
          {card}
        </div>
      ))}
    </div>
  );
}

// Always-open card body for the "Your patterns" panel, used inside the
// SwipeCarousel. Same content as YourPatternsDrawer but without the
// <details> wrapper that toggled it open/closed.
function YourPatternsCard({ stats }) {
  const ready = stats.patternsReady;
  // Each row shows the names of patterns that fall in that category — no
  // count, no "score." If a category is empty (no patterns sit there), the
  // row hides entirely. The card stays calm on a sparse day.
  const rows = [
    {
      heading: "Come back most days you write",
      names: stats.patternsStableNames || [],
      icon: (
        <svg width="20" height="20" viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="2.0" r="1.5" fill={T.leaf} />
          <circle cx="2.0" cy="5" r="1.5" fill={T.leaf} />
          <circle cx="8.0" cy="5" r="1.5" fill={T.leaf} />
          <circle cx="5" cy="8.0" r="1.5" fill={T.leaf} />
          <circle cx="5" cy="5" r="1.0" fill={T.paper} />
        </svg>
      ),
    },
    {
      heading: "Almost regular",
      names: stats.patternsBorderlineNames || [],
      icon: (
        <svg width="18" height="18" viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="5" r="3.6" fill="none" stroke={T.leaf} strokeWidth="1.2" />
          <path d="M 5 1.4 A 3.6 3.6 0 0 1 5 8.6 Z" fill={T.leaf} />
        </svg>
      ),
    },
    {
      heading: "Come and go",
      names: stats.patternsNoisyNames || [],
      icon: (
        <svg width="18" height="18" viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="3" cy="5" r="1.5" fill={T.leaf} />
          <circle cx="7" cy="5" r="1.5" fill="none" stroke={T.leaf} strokeWidth="1.2" />
        </svg>
      ),
    },
    {
      heading: "Just starting to repeat",
      names: stats.patternsCalibratingNames || [],
      icon: (
        <svg width="18" height="18" viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="6" r="1.4" fill={T.leaf} />
          <path d="M 5 4.5 Q 5 2.5 6.5 1.5" fill="none" stroke={T.leaf} strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ),
    },
  ];
  const visibleRows = rows.filter((r) => r.names && r.names.length > 0);
  // Render up to 4 names with serial commas — "the planner", "the planner
  // and the watcher", "the planner, the watcher and the seeker". Names
  // already include "the" prefix from PARTS_LIB.
  const joinNamesNicely = (names) => {
    if (!names || names.length === 0) return "";
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  };
  return (
    <div style={{
      background: "rgba(26,26,26,0.025)",
      border: `1px solid ${T.hair}`, borderRadius: 14,
      padding: "16px 18px",
    }}>
      <div style={{
        fontFamily: fm, fontSize: 10, letterSpacing: "0.16em",
        textTransform: "uppercase", color: T.muted, marginBottom: 12,
      }}>Your patterns</div>
      {ready ? (
        <>
          <p style={{
            margin: "0 0 12px", fontFamily: fd, fontStyle: "italic",
            fontSize: 16, lineHeight: 1.5, color: T.ink,
          }}>{stats.patternsClaim}</p>
          {visibleRows.length > 0 ? (
            <div style={{ borderTop: `1px solid ${T.hair}` }}>
              {visibleRows.map((r, i) => (
                <div key={r.heading} style={{
                  display: "grid",
                  gridTemplateColumns: "26px 1fr",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "12px 0",
                  borderBottom: i === visibleRows.length - 1 ? "none" : `1px solid ${T.hair}`,
                }}>
                  <div style={{ display: "grid", placeItems: "center", paddingTop: 2 }}>{r.icon}</div>
                  <div style={{ fontFamily: fb, fontSize: 13.5, lineHeight: 1.4, color: T.soft }}>
                    <span style={{
                      display: "block",
                      fontFamily: fm, fontSize: 9.5, letterSpacing: "0.14em",
                      textTransform: "uppercase", color: T.muted, marginBottom: 4,
                    }}>{r.heading}</span>
                    <span style={{ color: T.ink, fontWeight: 400 }}>
                      {(() => {
                        const s = joinNamesNicely(r.names);
                        return s ? s.charAt(0).toUpperCase() + s.slice(1) + "." : "";
                      })()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p style={{
          fontFamily: fb, fontStyle: "italic", fontSize: 13, lineHeight: 1.6,
          color: T.muted, margin: 0,
        }}>
          What's stable vs. coming-and-going needs about two weeks of writing in your journal. Until then, what looks repeated may not return.
        </p>
      )}
    </div>
  );
}

// Same pattern for "How this works" — the unlock-timeline drawer body
// rendered as an always-open card.
function HowThisWorksCard({ phase }) {
  const days = phase?.days ?? 0;
  const milestones = [
    { label: "Sleep rhythms",        unlockAt: 7,  desc: "what your bedtimes settle into" },
    { label: "The day's pressures",  unlockAt: 14, desc: "what tires you, what restores you" },
    { label: "What's typical for you", unlockAt: 21, desc: "the baseline the rest gets compared against" },
    { label: "Deeper currents",      unlockAt: 28, desc: "what stays vs. what passes" },
    { label: "Your first chapter",   unlockAt: 30, desc: "earliest 30 days frozen as an anchor on every chart" },
  ];
  return (
    <div style={{
      background: "rgba(26,26,26,0.025)",
      border: `1px solid ${T.hair}`, borderRadius: 14,
      padding: "16px 18px",
    }}>
      <div style={{
        fontFamily: fm, fontSize: 10, letterSpacing: "0.16em",
        textTransform: "uppercase", color: T.muted, marginBottom: 12,
      }}>How this works</div>
      <p style={{
        margin: "0 0 12px", fontFamily: fb, fontSize: 13, lineHeight: 1.6, color: T.soft,
      }}>
        Different parts of your reading unlock as the writing gathers.
      </p>
      <ul style={{ paddingLeft: 0, listStyle: "none", margin: 0 }}>
        {milestones.map((m) => {
          const unlocked = days >= m.unlockAt;
          const remaining = Math.max(0, m.unlockAt - days);
          return (
            <li key={m.label} style={{
              display: "flex", alignItems: "baseline", gap: 8,
              padding: "8px 0", borderBottom: `1px solid ${T.hair}`,
              fontFamily: fb, fontSize: 12.5,
            }}>
              <span style={{
                fontFamily: fm, fontSize: 11,
                color: unlocked ? "#4F8A5F" : T.faint,
                minWidth: 14, textAlign: "center",
              }}>{unlocked ? "✓" : "·"}</span>
              <span style={{ flex: 1 }}>
                <b style={{ fontWeight: 500, color: unlocked ? T.ink : T.muted }}>{m.label}</b>
                <span style={{ color: T.muted }}> — {m.desc}</span>
              </span>
              <span style={{
                fontFamily: fm, fontSize: 9.5, letterSpacing: "0.10em",
                textTransform: "uppercase", color: unlocked ? "#4F8A5F" : T.muted,
                whiteSpace: "nowrap",
              }}>
                {unlocked ? `day ${m.unlockAt}` : `${remaining}d`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Drawers (entry view) ────────────────────────────────────────────

function YourPatternsDrawer({ stats, phase }) {
  // Unlock is gated on real recurrence-window density (≥14 writing
  // days inside the last 28), not on the outer day counter — phase.days
  // can be inflated by Oura-only days the user didn't actually write on.
  const ready = stats.patternsReady;
  return (
    <details style={{
      marginTop: 10, background: "rgba(26,26,26,0.025)",
      border: `1px solid ${T.hair}`, borderRadius: 10,
    }}>
      <summary style={{
        listStyle: "none", cursor: "pointer", padding: "14px 16px",
        fontFamily: fm, fontSize: 10, letterSpacing: "0.16em",
        textTransform: "uppercase", color: T.muted,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span>Your patterns</span>
        <span style={{ fontSize: 16, color: T.faint }}>＋</span>
      </summary>
      <div style={{ padding: "4px 16px 16px" }}>
        {ready ? (
          <>
            <p style={{
              margin: "0 0 12px", fontFamily: fd, fontStyle: "italic",
              fontSize: 16, lineHeight: 1.5, color: T.ink,
            }}>{stats.patternsClaim}</p>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
              paddingTop: 10, borderTop: `1px solid ${T.hair}`,
            }}>
              {[
                { cap: "Stable",          num: stats.patternsStable,      lbl: "shows up most days you write" },
                { cap: "Borderline",      num: stats.patternsBorderline,  lbl: "near the line, can't call yet" },
                { cap: "Coming & going",  num: stats.patternsNoisy,       lbl: "shows up some days, not others" },
                { cap: "Still forming",   num: stats.patternsCalibrating, lbl: "just starting to recur" },
              ].map((c) => (
                <div key={c.cap}>
                  <div style={{
                    fontFamily: fm, fontSize: 9, letterSpacing: "0.16em",
                    textTransform: "uppercase", color: T.muted, marginBottom: 6,
                  }}>{c.cap}</div>
                  <div style={{
                    fontFamily: fd, fontStyle: "italic", fontSize: 22,
                    color: T.indigo, lineHeight: 1,
                  }}>{c.num}</div>
                  <div style={{
                    fontFamily: fb, fontSize: 11, lineHeight: 1.4,
                    color: T.muted, marginTop: 4,
                  }}>{c.lbl}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p style={{
            fontFamily: fb, fontStyle: "italic", fontSize: 13, lineHeight: 1.6,
            color: T.muted, margin: 0,
          }}>
            What's stable vs. coming-and-going needs about two weeks of writing in your journal. Until then, what looks repeated may not return.
          </p>
        )}
      </div>
    </details>
  );
}

function HowThisWorksDrawer({ phase }) {
  // Per-user unlock timeline. Each row pegs a real threshold (7/14/21/28
  // days of writing) to the user's current day count, so the drawer reads
  // as a personal map rather than a generic feature list.
  const days = phase?.days ?? 0;
  const milestones = [
    { label: "Sleep rhythms",        unlockAt: 7,
      desc: "what your bedtimes settle into" },
    { label: "The day's pressures",  unlockAt: 14,
      desc: "what tires you, what restores you" },
    { label: "What's typical for you", unlockAt: 21,
      desc: "the baseline the rest gets compared against" },
    { label: "Deeper currents",      unlockAt: 28,
      desc: "what stays vs. what passes — needs about two weeks of writing in your journal for the math to call it honestly" },
    { label: "Your first chapter",   unlockAt: 30,
      desc: "we freeze your earliest 30 days as an anchor on every chart, so drift over months stays visible" },
  ];
  return (
    <details style={{
      marginTop: 10, background: "rgba(26,26,26,0.025)",
      border: `1px solid ${T.hair}`, borderRadius: 10,
    }}>
      <summary style={{
        listStyle: "none", cursor: "pointer", padding: "14px 16px",
        fontFamily: fm, fontSize: 10, letterSpacing: "0.16em",
        textTransform: "uppercase", color: T.muted,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span>How this works</span>
        <span style={{ fontSize: 16, color: T.faint }}>＋</span>
      </summary>
      <div style={{
        padding: "4px 16px 16px",
        fontFamily: fb, fontSize: 13, lineHeight: 1.65, color: T.soft,
      }}>
        <p style={{ margin: "0 0 12px" }}>
          Different parts of your reading unlock as the writing gathers — each one waiting until the signal underneath it is stable enough to share without overstating. Where you are right now:
        </p>
        <ul style={{ paddingLeft: 0, listStyle: "none", margin: "0 0 12px" }}>
          {milestones.map((m) => {
            const unlocked = days >= m.unlockAt;
            const remaining = Math.max(0, m.unlockAt - days);
            return (
              <li key={m.label} style={{
                display: "flex", alignItems: "baseline", gap: 10,
                padding: "8px 0", borderBottom: `1px solid ${T.hair}`,
              }}>
                <span style={{
                  fontFamily: fm, fontSize: 11,
                  color: unlocked ? "#4F8A5F" : T.faint,
                  minWidth: 14, textAlign: "center",
                }}>{unlocked ? "✓" : "·"}</span>
                <span style={{ flex: 1 }}>
                  <b style={{ fontWeight: 500, color: unlocked ? T.ink : T.muted }}>{m.label}</b>
                  <span style={{ color: T.muted }}> — {m.desc}</span>
                </span>
                <span style={{
                  fontFamily: fm, fontSize: 10, letterSpacing: "0.10em",
                  textTransform: "uppercase", color: unlocked ? "#4F8A5F" : T.muted,
                  whiteSpace: "nowrap",
                }}>
                  {unlocked
                    ? `unlocked · day ${m.unlockAt}`
                    : `${remaining} day${remaining === 1 ? "" : "s"} away`}
                </span>
              </li>
            );
          })}
        </ul>

        <div style={{
          marginTop: 6, marginBottom: 14, padding: "12px 14px",
          background: T.paper, border: `1px solid ${T.hair}`,
          borderRadius: 8,
        }}>
          <div style={{
            fontFamily: fm, fontSize: 9, letterSpacing: "0.16em",
            textTransform: "uppercase", color: T.muted, marginBottom: 8,
          }}>What stable / borderline / coming &amp; going actually mean</div>
          <p style={{ margin: "0 0 6px", color: T.soft }}>
            Once you have <b>14 writing days inside the last 28</b>, every recurring part is classified by how often it shows up on the days you wrote:
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, color: T.muted }}>
            <li><b>Stable</b> — recurs on <b>70%+</b> of your writing days, and the 95% Wilson confidence interval stays above that line</li>
            <li><b>Borderline</b> — observed rate is near 70% but the confidence interval still straddles it (too few data points to call yet)</li>
            <li><b>Coming &amp; going</b> — recurs on <b>30%–70%</b> of writing days</li>
            <li><b>Still forming</b> — under <b>30%</b>, but has appeared on at least 2 days</li>
          </ul>
          <p style={{ margin: "8px 0 0", fontSize: 11.5, color: T.faint }}>
            Single-day occurrences are dropped — one mention isn't a pattern. Wilson 95% is what keeps small samples from getting promoted prematurely.
          </p>
        </div>

        <p style={{ margin: 0, fontStyle: "italic", color: T.muted, fontSize: 12 }}>
          Until each threshold is reached, we tell you it's still calibrating rather than show a number we can't yet stand behind.
        </p>
      </div>
    </details>
  );
}

// ─── Calibrating view (days 0–13) ───────────────────────────────────

function PagesTimeline({ firstDay }) {
  const today = startOfDay(new Date());
  const milestones = [
    { day: 3,  what: "A soft snapshot of where you are right now — one observation, no comparisons yet." },
    { day: 7,  what: "Your sleep rhythms become readable. Reserves start to show their shape." },
    { day: 14, what: "The day's pressures show up in the writing — what tires you, what restores you." },
    { day: 21, what: "Enough repetition to call something typical for you." },
    { day: 28, what: "The deeper currents — what stays, what comes and goes — start to settle." },
  ];
  const rows = milestones.map((m) => {
    const target = new Date(firstDay);
    target.setDate(firstDay.getDate() + m.day);
    const days = Math.round((startOfDay(target).getTime() - today.getTime()) / MS_PER_DAY);
    let tone;
    if (days < 0)  tone = "passed";
    else if (days === 0) tone = "now";
    else if (days <= 7)  tone = "near";
    else                 tone = "far";
    const when = formatDateRelative(target, today);
    return { ...m, target, days, tone, when };
  });

  return (
    <div style={{ marginTop: 26 }}>
      <Eyebrow style={{ marginBottom: 6 }}>Listening</Eyebrow>
      <p style={{
        fontFamily: fb, fontStyle: "italic", fontSize: 14.5, lineHeight: 1.55,
        color: T.soft, margin: "0 0 22px", maxWidth: "36em",
      }}>
        These are the pages that come, as the writing gathers.
      </p>
      <ol style={{ listStyle: "none", padding: 0, margin: 0, position: "relative" }}>
        <span style={{
          position: "absolute", top: 6, bottom: 6, left: 5, width: 1,
          background: T.hair,
        }} aria-hidden="true" />
        {rows.map((r) => {
          const dotStyle = r.tone === "now"
            ? { background: T.leaf, borderColor: T.leaf, boxShadow: `0 0 0 4px rgba(63,91,57,0.10)` }
            : r.tone === "passed"
            ? { background: T.leaf, borderColor: T.leaf, opacity: 0.55 }
            : r.tone === "near"
            ? { background: T.paper, borderColor: T.soft }
            : { background: T.paper, borderColor: T.faint };
          const whenColor = r.tone === "now" ? T.leaf
            : r.tone === "passed" ? T.muted
            : r.tone === "far" ? T.muted
            : T.ink;
          const whatColor = r.tone === "passed" || r.tone === "far" ? T.muted : T.soft;
          return (
            <li key={r.day} style={{
              position: "relative", padding: "0 0 18px 24px",
              display: "grid", gap: 4,
            }}>
              <span style={{
                position: "absolute", top: 7, left: 0,
                width: 11, height: 11, borderRadius: "50%",
                borderWidth: 1.5, borderStyle: "solid", ...dotStyle,
              }} aria-hidden="true" />
              <span style={{
                fontFamily: fd, fontStyle: "italic", fontSize: 16,
                color: whenColor, lineHeight: 1.3,
                opacity: r.tone === "passed" ? 0.78 : 1,
              }}>{r.when}</span>
              <span style={{
                fontFamily: fb, fontSize: 14, lineHeight: 1.55, color: whatColor,
              }}>{r.what}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CalibratingView({ phase, stats, firstDay, history }) {
  return (
    <div>
      <ExtendedWakeCard history={history} />
      <Who5Tile />
      <Eyebrow>{phase.key === "listening" ? "Listening" : "A few pages in"}</Eyebrow>
      <h1 style={{
        fontFamily: fd, fontStyle: "italic", fontWeight: 300,
        fontSize: 28, lineHeight: 1.2, letterSpacing: "-0.01em",
        color: T.ink, margin: "8px 0 0",
      }}>
        {phase.days === 0 ? "First page."
         : phase.days === 1 ? "Day one of writing."
         : `Day ${phase.days} of writing.`}
      </h1>
      <p style={{
        fontFamily: fb, fontSize: 14, lineHeight: 1.6,
        color: T.muted, margin: "10px 0 0", maxWidth: "36em",
      }}>
        Patterns need time to become visible. The fuller readings come as we read more of you together.
      </p>

      <PagesTimeline firstDay={firstDay} />

      <div style={{
        marginTop: 28, display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)", gap: 8,
      }}>
        {[
          { num: stats.daysWritten,      lbl: "pages written" },
          { num: stats.nightsRecorded,   lbl: "nights recorded" },
          { num: stats.eveningReadings,  lbl: "evening readings" },
        ].map((c) => (
          <div key={c.lbl} style={{
            background: T.card, border: `1px solid ${T.hair}`, borderRadius: 10,
            padding: "12px 14px",
          }}>
            <div style={{
              fontFamily: fd, fontStyle: "italic", fontSize: 24,
              color: T.leaf, lineHeight: 1,
            }}>{c.num}</div>
            <div style={{
              fontFamily: fm, fontSize: 9, letterSpacing: "0.14em",
              textTransform: "uppercase", color: T.muted, marginTop: 6,
            }}>{c.lbl}</div>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 22, padding: "14px 16px",
        background: "rgba(63,91,57,0.06)",
        borderLeft: `2px solid ${T.leaf}`, borderRadius: "0 8px 8px 0",
        fontFamily: fb, fontStyle: "italic", fontSize: 14, lineHeight: 1.55,
        color: T.soft,
      }}>
        A heavy day right now isn't a verdict — it's one entry in a longer book.
        We're still learning what's typical for <em>you</em>.
      </div>

      <HowThisWorksDrawer phase={phase} />
    </div>
  );
}

// ─── Calibrated entry view (day 14+) — 3 score circles ──────────────

function CalibratedView({ stats, phase, onOpenBucket, history }) {
  const [headlineInfoOpen, setHeadlineInfoOpen] = useState(false);
  const [worthInfoOpen, setWorthInfoOpen] = useState(false);
  const [pillsInfoOpen, setPillsInfoOpen] = useState(false);
  const hasDemandsBaseline = stats.demands.score != null && stats.demands.baseline != null;
  const demandDelta = hasDemandsBaseline ? stats.demands.score - stats.demands.baseline : null;
  const above = demandDelta != null && demandDelta > 4;
  const below = demandDelta != null && demandDelta < -4;

  // Three-act narrative — synthesises today across Reserves / Demands /
  // Form into one sentence so the user doesn't have to read three cards
  // and stitch the meaning themselves. Only shown when all three baselines
  // exist (need history to call any of them "above" or "below" honestly).
  const reservesDelta = stats.reserves.baseline != null ? stats.reserves.score - stats.reserves.baseline : null;
  const formDelta     = stats.form.baseline     != null ? stats.form.score     - stats.form.baseline     : null;
  const haveAllThree  = reservesDelta != null && demandDelta != null && formDelta != null;
  const phraseFor = (delta, vocab) => {
    if (delta == null) return null;
    if (delta >  4) return vocab.high;
    if (delta < -4) return vocab.low;
    return vocab.mid;
  };
  const reservesPhrase = phraseFor(reservesDelta, {
    high: "Above your typical reserves",
    mid:  "With your usual reserves",
    low:  "With reserves running low",
  });
  const demandsPhrase = phraseFor(demandDelta, {
    high: "into a heavier day",
    mid:  "into a usual day",
    low:  "into a lighter day",
  });
  const formPhrase = phraseFor(formDelta, {
    high: "you came through strong",
    mid:  "you came through even",
    low:  "you came through thin",
  });

  // When all three baselines exist, the synthesized narrative becomes the
  // primary headline. Otherwise fall back to the demand-only framing.
  const headline = haveAllThree
    ? `${reservesPhrase}, ${demandsPhrase}, ${formPhrase}.`
    : above ? "A heavier day than usual."
    : below ? "A lighter day than usual."
    : hasDemandsBaseline ? "A steady day."
    : "Today's reading.";
  const sub = above
    ? `Today sits ${Math.round(demandDelta)} points above your typical. ${stats.demandsHeaviest} is the demand most above usual.`
    : below
    ? `Today sits ${Math.abs(Math.round(demandDelta))} points below your typical. The system is carrying less than usual.`
    : hasDemandsBaseline
    ? "Today sits close to your typical. Nothing is pulling unusually hard or unusually soft."
    : "Tap a score to see how it's built. The 'vs your typical' line appears once we have a week of your data behind it.";

  return (
    <div>
      <ExtendedWakeCard history={history} />
      <div style={{ marginBottom: 18 }}><PhasePill phase={phase} /></div>

      <Eyebrow>Today's reading</Eyebrow>
      <h1 style={{
        fontFamily: fd, fontStyle: "italic", fontWeight: 300,
        fontSize: 28, lineHeight: 1.2, letterSpacing: "-0.01em",
        color: T.ink, margin: "8px 0 0",
      }}>
        {headline}
        {haveAllThree && (
          <ClaimDot
            open={headlineInfoOpen}
            onToggle={() => setHeadlineInfoOpen(s => !s)}
            ariaLabel="How today's headline is built"
          />
        )}
      </h1>
      <p style={{
        fontFamily: fb, fontSize: 14, lineHeight: 1.6,
        color: T.muted, margin: "8px 0 0", maxWidth: "36em",
      }}>{sub}</p>
      {headlineInfoOpen && haveAllThree && (
        <ClaimPanel>
          Each state word maps to how far today sits from your typical baseline
          for that bucket:
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            <li><b>above / heavier / strong</b> — today is more than 4 points over your typical</li>
            <li><b>low / lighter / thin</b> — today is more than 4 points under your typical</li>
            <li><b>usual / even</b> — within ±4 points of your typical</li>
          </ul>
          <div style={{ marginTop: 8, fontSize: 11.5, color: T.faint }}>
            ±4 is the band we treat as on par. Smaller swings are usually noise, not signal.
          </div>
        </ClaimPanel>
      )}

      <div style={{
        marginTop: 22, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10,
      }}>
        <ScoreCircle
          score={stats.reserves.score}
          ringColor={T.leaf}
          label="Reserves"
          sublabel="what you started with"
          delta={stats.reserves.baseline != null ? fmtDelta(stats.reserves.score - stats.reserves.baseline, "down") : null}
          onTap={() => onOpenBucket("reserves")}
        />
        <ScoreCircle
          score={stats.demands.score}
          ringColor={T.leaf}
          label="Demands"
          sublabel="what pressed on you"
          delta={stats.demands.baseline != null ? fmtDelta(stats.demands.score - stats.demands.baseline, "up") : null}
          onTap={() => onOpenBucket("demands")}
        />
        <ScoreCircle
          score={stats.form.score}
          ringColor={T.leaf}
          label="Form"
          sublabel="how you came through"
          delta={stats.form.baseline != null ? fmtDelta(stats.form.score - stats.form.baseline, "down") : null}
          onTap={() => onOpenBucket("form")}
        />
      </div>

      {/* Pill info disclosure — Apple-style "i" affordance for the 3
          score circles. One panel, three short definitions. Keeps each
          circle visually clean while putting "what does this mean?" one
          tap away. */}
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 0 }}>
        <ClaimDot
          open={pillsInfoOpen}
          onToggle={() => setPillsInfoOpen((s) => !s)}
          ariaLabel="What do these three mean?"
          style={{ marginLeft: 0 }}
        />
        <button
          type="button"
          onClick={() => setPillsInfoOpen((s) => !s)}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            padding: "0 0 0 8px", marginLeft: 0,
            fontFamily: fm, fontSize: 10, letterSpacing: "0.14em",
            textTransform: "uppercase", color: T.muted,
          }}
        >
          What do these mean?
        </button>
      </div>
      {pillsInfoOpen && (
        <ClaimPanel style={{ marginTop: 8 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <span style={{
                display: "inline-block", width: 8, height: 8,
                borderRadius: "50%", background: T.leaf, marginRight: 8,
                verticalAlign: "middle",
              }} />
              <b style={{ color: T.ink }}>Reserves</b> — the fuel in your tank when the day began. Sleep, recovery, and the shape of your own writing read together.
            </div>
            <div>
              <span style={{
                display: "inline-block", width: 8, height: 8,
                borderRadius: "50%", background: T.bloom, marginRight: 8,
                verticalAlign: "middle",
              }} />
              <b style={{ color: T.ink }}>Demands</b> — what today asked of you. Decisions named in your writing, context shifts, and meetings.
            </div>
            <div>
              <span style={{
                display: "inline-block", width: 8, height: 8,
                borderRadius: "50%", background: T.indigo, marginRight: 8,
                verticalAlign: "middle",
              }} />
              <b style={{ color: T.ink }}>Form</b> — how you carried yourself today, given the demands you faced. Focus and steadiness in your writing, your wellbeing check-in.
            </div>
            <div style={{ marginTop: 4, fontSize: 11.5, color: T.faint }}>
              Tap any circle for the full breakdown.
            </div>
          </div>
        </ClaimPanel>
      )}

      {/* "Worth noticing" — surfaces only when biometric and writing
          signals point opposite directions today. Reflection prompt,
          not measurement claim. */}
      {stats.worthNoticing && (
        <>
          <div style={{
            marginTop: 22, padding: "14px 18px",
            background: T.paper,
            borderLeft: `3px solid ${T.bloom}`,
            borderRadius: 4,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Eyebrow style={{ fontSize: 9.5 }}>Worth noticing</Eyebrow>
              <ClaimDot
                open={worthInfoOpen}
                onToggle={() => setWorthInfoOpen(s => !s)}
                ariaLabel="Why am I seeing this?"
                style={{ marginLeft: 0 }}
              />
            </div>
            <p style={{
              fontFamily: fd, fontStyle: "italic", fontWeight: 300,
              fontSize: 15.5, lineHeight: 1.55, color: T.ink,
              margin: "6px 0 0", maxWidth: "36em",
            }}>{stats.worthNoticing}</p>
          </div>
          {worthInfoOpen && (
            <ClaimPanel>
              This card surfaces only when your <b>body</b> (sleep + HRV) and your <b>words</b> (today's writing) point in
              opposite directions — and both signals are at least <b>0.10</b> away from neutral on their own scales.
              It's a reflection prompt, not a measurement claim — sometimes the two genuinely diverge, and naming it is more useful than averaging it away.
            </ClaimPanel>
          )}
        </>
      )}

      <DailyStrip stats={stats} />
      {(() => {
        // Reflect-mode only — no wearable connected. The same flags the rest
        // of the page already uses, just checked locally so we don't depend on
        // a variable declared further down in a different scope.
        let hasWearable = false;
        try {
          hasWearable = !!localStorage.getItem("cpi_oura_access_token") ||
            localStorage.getItem("apple_health_granted") === "true";
        } catch {}
        return hasWearable ? null : <ReflectModeDetails />;
      })()}

      <SwipeCarousel>
        <YourPatternsCard stats={stats} />
        <HowThisWorksCard phase={phase} />
      </SwipeCarousel>
    </div>
  );
}

// ─── Stats computation — Reserves / Demands / Form ──────────────────

export function computeStats({ history, biometrics, phase }) {
  const dayKeys = uniqueCheckinDays(history);
  const daysWritten = dayKeys.size;
  const nightsRecorded = ouraNightCount(28);
  const eveningReadings = readingsWritten(history);

  const latest = history[0] || null;

  // ── Window: last 14 journal entries — used for every "your typical"
  //          baseline that comes from writing. Each baseline is the
  //          median over the window; CIs are the standard deviation.
  const winHistory = (history || []).slice(0, 14);
  const muBase     = statsOf(winHistory.map(h => h?.params?.mu != null ? clamp01(1 - h.params.mu) : null));
  const sBase      = statsOf(winHistory.map(h => h?.params?.S != null ? Math.min(1, h.params.S / 3.5) : null));
  const cBase      = statsOf(winHistory.map(h => h?.params?.C != null ? Math.max(0, 1 - (h.params.C - 1) / 3) : null));
  const psiBase    = statsOf(winHistory.map(h => h?.params?.psi != null ? Math.min(1, h.params.psi / 1.1) : null));
  const thinkBase  = statsOf(winHistory.map(h => typeof h?.decisionCount === "number" ? Math.max(0.1, Math.min(0.6, h.decisionCount / 30 + 0.18)) : null));
  // Backward-compat read: engine output and new entries use `recentStrain`;
  // legacy entries (pre-2026-05-14 rename) used `allostaticLoad`. Read both.
  const readStrain = (h) => h?.recentStrain ?? h?.allostaticLoad;
  const strainBase = statsOf(winHistory.map(h => { const v = readStrain(h); return typeof v === "number" ? Math.max(0.05, Math.min(0.40, (v - 1) * 0.4 + 0.12)) : null; }));
  const bounceBase = statsOf(winHistory.map(h => { const v = readStrain(h); return typeof v === "number" ? Math.max(0, Math.min(1, 1 - (v - 1) * 3)) : null; }));

  // ── Window: last 28 nights of Oura — biometric baselines.
  let sleepNormList = [], hrvNormList = [];
  try {
    const raw = localStorage.getItem(OURA_HISTORY_KEY);
    if (raw) {
      const map = JSON.parse(raw);
      const today = new Date();
      for (let i = 1; i <= 28; i++) {
        const d = new Date(today); d.setDate(today.getDate() - i);
        const k = ymdISO(d);
        const day = map[k];
        if (day?.totalSleepMin > 0) sleepNormList.push(clamp01((day.totalSleepMin / 60) / 7.5));
        if (day?.hrv > 0) hrvNormList.push(clamp01(day.hrv / 60));
      }
    }
  } catch { /* ignore */ }
  const sleepBase = statsOf(sleepNormList);
  const hrvBase   = statsOf(hrvNormList);

  // ── Small derivation helpers ────────────────────────────────────
  const baselinePctOf = (s) => s && s.n >= MIN_N_BASELINE ? Math.min(100, Math.max(0, s.median * 100)) : null;
  const ciOf = (s) => s && s.n >= MIN_N_CI ? Math.min(0.5, s.std) : null;
  const statusVs = (cur, s, goodIsHigh = true) => {
    if (cur == null || !s || s.n < MIN_N_BASELINE) return null;
    const tol = Math.max(0.02, s.std * 0.5);
    if (cur > s.median + tol) return { text: "above your usual", tone: goodIsHigh ? "good" : "attn" };
    if (cur < s.median - tol) return { text: "below your usual", tone: goodIsHigh ? "attn" : "good" };
    return { text: "on par with your usual", tone: "good" };
  };
  // Source line — appends "· n-day baseline" when we have one.
  const srcWith = (base, basePhrase) => base?.n >= MIN_N_BASELINE
    ? `${basePhrase} · ${base.n}-day baseline`
    : basePhrase;
  // Fill color: green when within ±tol of baseline (on par), green when
  // on the "good" side, amber when on the "bad" side. The tolerance
  // matches statusVs so the bar and the status line always agree —
  // before, a value rounded to display 1.00 could still be a hair under
  // the median and show amber while the status said "on par".
  const fillColorFor = (cur, base, downwardIsBad = true) => {
    if (!base || base.n < MIN_N_BASELINE) return T.moss;
    const tol = Math.max(0.02, base.std * 0.5);
    if (Math.abs(cur - base.median) <= tol) return T.moss;
    if (downwardIsBad) return cur >= base.median ? T.moss : T.warn;
    return cur <= base.median ? T.moss : T.warn;
  };

  // ── Reserves ────────────────────────────────────────────────────
  const reservesContribs = [];
  const reservesValues = [];
  const reservesBases  = [];

  // ── Oura self-heal resolver ──
  // The biometrics prop only holds the most recent "meaningful" day's
  // worth of biometrics (see pickLatestMeaningfulDay in engine.js). For
  // sleep + HRV specifically, that prop can be empty if today's entry
  // was created from non-sleep data (readiness, activity). When that
  // happens, the cards used to give up entirely. Now they scan the full
  // Oura history map and use the most recent day that actually has the
  // field — and tell the user which day they're looking at.
  const ouraConnected = (() => {
    try { return !!localStorage.getItem("cpi_oura_access_token"); } catch { return false; }
  })();
  // Apple Health is the second wearable source; without this flag we can't
  // tell the difference between "user has Apple Watch and no data yet" and
  // "user has nothing connected", which is the source of the misleading
  // "Connect Oura" pill that appears even for Apple-Health-only users.
  const appleHealthConnected = (() => {
    try { return localStorage.getItem("apple_health_granted") === "true"; } catch { return false; }
  })();
  const todayYmd = ymdISO(new Date());
  const resolveLatestOuraField = (field) => {
    // Per-field source attribution (set by the dual-wearable merge) is
    // strictly more accurate than the coarse-grained entry.source tag —
    // a day with Oura sleep + Apple steps reads "from your wearables" on
    // entry.source but the Sleep card specifically came from Oura and
    // the Steps card specifically came from Apple. Fall back to the
    // coarse tag for older entries.
    const pickSource = (e) => e?._sources?.[field] || e?.source || null;
    if (biometrics?.[field] != null) {
      return { value: biometrics[field], date: biometrics.date || todayYmd, source: pickSource(biometrics) };
    }
    try {
      const raw = localStorage.getItem(OURA_HISTORY_KEY);
      if (!raw) return null;
      const map = JSON.parse(raw);
      const keys = Object.keys(map || {}).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
      for (let i = keys.length - 1; i >= 0; i--) {
        const e = map[keys[i]];
        if (e && e[field] != null) return { value: e[field], date: keys[i], source: pickSource(e) };
      }
    } catch { /* ignore */ }
    return null;
  };
  // Translate the engine's `source` tag on a biometric entry into the
  // friendly phrase shown in the card footer. The history map is named
  // cpi_oura_history for legacy reasons but Apple Health writes into the
  // same map (see mergeAppleHealthIntoHistory) — labelling everything
  // "from your Oura ring" misleads users who only have Apple Health
  // connected.
  const sourceLabelFor = (src) => {
    if (typeof src === "string") {
      const hasOura = src.includes("oura");
      const hasApple = src.includes("apple-health");
      if (hasOura && hasApple) return "from your wearables";
      if (hasApple) return "from your phone's Health app";
      if (hasOura) return "from your Oura ring";
    }
    // No source tag on the entry (legacy data written before source tagging
    // landed). Fall back to whatever wearable is actually connected so we
    // never claim a source the user hasn't set up.
    if (appleHealthConnected && ouraConnected) return "from your wearables";
    if (appleHealthConnected) return "from your phone's Health app";
    if (ouraConnected) return "from your Oura ring";
    return "from your wearable";
  };
  const sourceFor = (reading) => {
    const label = sourceLabelFor(reading?.source);
    if (!reading) return label;
    if (reading.date === todayYmd) return label;
    const diffMs = new Date(todayYmd).getTime() - new Date(reading.date).getTime();
    const days = Math.max(1, Math.round(diffMs / 86_400_000));
    return `${label} · ${days} night${days === 1 ? "" : "s"} ago (${reading.date})`;
  };
  // The "no data anywhere" info copy. Branches on which wearables are
  // connected so a user who only set up Apple Health never sees a misleading
  // "Connect Oura" prompt — the data they need is already being collected,
  // they just need to wait for the next sync.
  const ouraEmptyInfoFor = (base) => {
    if (!ouraConnected && !appleHealthConnected) {
      return { pill: "Connect a wearable", desc: `${base} Activates once you connect Oura or your phone's Health app.` };
    }
    if (appleHealthConnected && !ouraConnected) {
      return {
        pill: "Awaiting sync",
        desc: `${base} Your phone's Health app is connected — last night's reading appears here a few minutes after you wake. If it stays blank, check that sleep tracking is on for your wearable in the Health app.`,
      };
    }
    if (ouraConnected && appleHealthConnected) {
      return {
        pill: "Awaiting sync",
        desc: `${base} Your wearables are connected, but no readings have synced yet. Oura's cloud takes ~2–3 hours after you wake to finalise last night's sleep — once it lands, this card lights up automatically.`,
      };
    }
    return {
      pill: "Oura connected · awaiting sync",
      desc: `${base} Oura is connected, but no readings have synced yet. Oura's cloud takes ~2–3 hours after you wake to finalise last night's sleep — once it lands, this card lights up automatically.`,
    };
  };

  const sleepReading = resolveLatestOuraField("totalSleepMin");
  const sleepCurrent = sleepReading ? clamp01((sleepReading.value / 60) / 7.5) : null;
  if (sleepCurrent != null) {
    reservesContribs.push({
      kind: "value", name: "Sleep restoration",
      value: sleepCurrent, ci: ciOf(sleepBase),
      teach: "How much of last night's rest your body actually banked — drawn from how long you slept and how efficient that sleep was.",
      fillColor: fillColorFor(sleepCurrent, sleepBase),
      fillPct: sleepCurrent * 100, baselinePct: baselinePctOf(sleepBase),
      source: srcWith(sleepBase, sourceFor(sleepReading)),
      status: statusVs(sleepCurrent, sleepBase, true),
      // Chart props
      bucket: "reserves",
      todayDisplay: sleepReading.value / 60,
      series: ouraSeries("totalSleepMin", SERIES_DAYS, (v) => v / 60),
      anchor: firstNAnchorFromOura("totalSleepMin", (v) => v / 60),
      unit: "hours · last night",
      decimals: 1,
      reference: { lo: 7, hi: 9 },
      anchors: ["Strong", "Usual", "Light", "Short"],
      methodology: "Drawn from Oura's sleep duration. The NIH 7–9 hour adult range shows as the soft band behind the curve.",
    });
    reservesValues.push(sleepCurrent);
    if (sleepBase?.n >= MIN_N_BASELINE) reservesBases.push(sleepBase.median);
  } else {
    const info = ouraEmptyInfoFor("How much of last night's rest your body actually banked.");
    reservesContribs.push({
      kind: "info", name: "Sleep restoration", pill: info.pill, desc: info.desc,
    });
  }

  // Bugfix: schema field is avgHRV, not hrv. Earlier code read biometrics?.hrv
  // which is always undefined, so the card always fell into the info branch
  // even when Oura was fully synced.
  const hrvReading = resolveLatestOuraField("avgHRV");
  const hrvCurrent = hrvReading ? clamp01(hrvReading.value / 60) : null;
  if (hrvCurrent != null) {
    reservesContribs.push({
      kind: "value", name: "Autonomic readiness",
      value: hrvCurrent, ci: ciOf(hrvBase),
      teach: "How calm your nervous system is at rest — read from how steadily your heart beats overnight. Steadier rhythms mean you're more ready for the day.",
      fillColor: fillColorFor(hrvCurrent, hrvBase),
      fillPct: hrvCurrent * 100, baselinePct: baselinePctOf(hrvBase),
      source: srcWith(hrvBase, `${sourceFor(hrvReading)} · heart-rate variability`),
      status: statusVs(hrvCurrent, hrvBase, true),
      // Chart props
      bucket: "reserves",
      todayDisplay: hrvReading.value,
      series: ouraSeries("avgHRV", SERIES_DAYS),
      anchor: firstNAnchorFromOura("avgHRV"),
      unit: "ms · last night",
      decimals: 0,
      anchors: ["Strong", "Usual", "Low", "Off"],
      methodology: "Average heart-rate variability across last night, in milliseconds. HRV varies enormously between people, so only your own trend is meaningful.",
    });
    reservesValues.push(hrvCurrent);
    if (hrvBase?.n >= MIN_N_BASELINE) reservesBases.push(hrvBase.median);
  } else {
    const info = ouraEmptyInfoFor("How calm your nervous system is at rest.");
    reservesContribs.push({
      kind: "info", name: "Autonomic readiness", pill: info.pill, desc: info.desc,
    });
  }

  // Journal-derived reserves contributors. These are computed from
  // the shape of your own writing — pace, recoveries, the language of
  // what's next. We surface them under "your own trend only" framing,
  // with no external-norm comparison. Honest because we don't claim
  // they map to a clinical construct — just to your own rhythm.
  const muToday01 = latest?.params?.mu != null ? clamp01(1 - latest.params.mu) : null;
  if (muToday01 != null && muBase?.n >= MIN_N_BASELINE) {
    reservesContribs.push({
      kind: "value", name: "What you have left",
      value: muToday01, ci: ciOf(muBase),
      teach: "How much you've still got in the tank, read from the shape of today's writing — pace, recoveries, the way you describe what's next. Your own trend only — not compared to anyone else.",
      fillColor: fillColorFor(muToday01, muBase),
      fillPct: muToday01 * 100, baselinePct: baselinePctOf(muBase),
      source: srcWith(muBase, "from your writing · your own trend only"),
      status: statusVs(muToday01, muBase, true),
      bucket: "reserves",
      series: historySeries(history, (h) => h?.params?.mu != null ? clamp01(1 - h.params.mu) : null),
      formatValue: (v) => v.toFixed(2),
      anchors: ["Strong", "Usual", "Low", "Spent"],
    });
    reservesValues.push(muToday01);
    reservesBases.push(muBase.median);
  }

  const strainInvBase = statsOf(winHistory.map(h => {
    const v = readStrain(h);
    return typeof v === "number" ? clamp01(1 - (v - 1) * 0.5) : null;
  }));
  const latestStrain = readStrain(latest);
  const strainInvToday01 = typeof latestStrain === "number"
    ? clamp01(1 - (latestStrain - 1) * 0.5)
    : null;
  if (strainInvToday01 != null && strainInvBase?.n >= MIN_N_BASELINE) {
    reservesContribs.push({
      kind: "value", name: "Carried-over strain",
      value: strainInvToday01, ci: ciOf(strainInvBase),
      teach: "How much pressure from the last week is still sitting in the system. The bar fills the other way — higher means less is carried over, lower means more.",
      fillColor: fillColorFor(strainInvToday01, strainInvBase),
      fillPct: strainInvToday01 * 100, baselinePct: baselinePctOf(strainInvBase),
      source: srcWith(strainInvBase, "from your writing · 7-day trail"),
      status: statusVs(strainInvToday01, strainInvBase, true),
      bucket: "reserves",
      series: historySeries(history, (h) => {
        const v = readStrain(h);
        return typeof v === "number" ? clamp01(1 - (v - 1) * 0.5) : null;
      }),
      formatValue: (v) => v.toFixed(2),
      anchors: ["Clear", "Usual", "Carried", "Heavy"],
    });
    reservesValues.push(strainInvToday01);
    reservesBases.push(strainInvBase.median);
  }

  // PR #5: Reserves headline score = today's sleep restoration alone
  // (Oura totalSleepMin, validated as a sleep duration source per
  // Altini 2021). The composite avg of sleep + HRV + μ retired
  // because three correlated proxies averaged into one number is
  // not a clean measurement claim. HRV and μ remain as contributor
  // cards inside the bucket modal — they explain context, but the
  // headline number now points to a single validated source.
  // Headline = sleep if Oura is connected (one validated source);
  // otherwise the average of journal-derived reserves contributors,
  // honestly framed as "your own trend" in the source line beneath.
  const reservesAvg01 = reservesValues.length
    ? reservesValues.reduce((a, b) => a + b, 0) / reservesValues.length : null;
  const reservesBaseAvg01 = reservesBases.length
    ? reservesBases.reduce((a, b) => a + b, 0) / reservesBases.length : null;
  const reservesScore01 = sleepCurrent != null ? sleepCurrent : reservesAvg01;
  const reservesBaseline01 = sleepBase?.n >= MIN_N_BASELINE
    ? sleepBase.median
    : reservesBaseAvg01;
  const reserves = {
    score:       reservesScore01 != null ? reservesScore01 * 100 : null,
    baseline:    reservesBaseline01 != null ? reservesBaseline01 * 100 : null,
    baselinePct: reservesBaseline01 != null ? reservesBaseline01 * 100 : null,
    contributors: reservesContribs,
  };

  // ── Demands ─────────────────────────────────────────────────────
  const demandsContribs = [];
  const demandsValues = [];
  const demandsBases  = [];

  // Journal-derived demands contributors.
  //
  // "Decisions today" is a Tier A literal count — the engine tallies
  // decision-words in today's entry. Honest at face value (no
  // composite math, no clinical label).
  //
  // "Context shifts" is Tier B — params.C as your own trend, no
  // external-norm comparison.
  const decisionsToday = typeof latest?.decisionCount === "number" ? latest.decisionCount : null;
  const decisionsBase = statsOf(winHistory.map(h =>
    typeof h?.decisionCount === "number" ? Math.min(1, h.decisionCount / 15) : null
  ));
  if (decisionsToday != null) {
    const decisionsVal01 = Math.min(1, decisionsToday / 15);
    demandsContribs.push({
      kind: "value", name: "Decisions today",
      value: decisionsVal01, ci: ciOf(decisionsBase),
      teach: `About ${decisionsToday} decision-points named in today's writing — a read on what the day asked, not a verdict on it. When a decision matters, when you make it tends to count for more than how many you made.`,
      fillColor: T.bloom,
      fillPct: decisionsVal01 * 100, baselinePct: baselinePctOf(decisionsBase),
      source: srcWith(decisionsBase, "counted from your writing · today"),
      status: statusVs(decisionsVal01, decisionsBase, false),
      bucket: "demands",
      series: historySeries(history, (h) => typeof h?.decisionCount === "number"
        ? Math.min(1, h.decisionCount / 15) : null),
      formatValue: (v) => `${Math.round(v * 15)} decisions`,
      anchors: ["Many", "Some", "Usual", "Few"],
    });
    demandsValues.push(decisionsVal01);
    if (decisionsBase?.n >= MIN_N_BASELINE) demandsBases.push(decisionsBase.median);
  }

  const cToday01 = latest?.params?.C != null ? Math.min(1, (latest.params.C - 1) / 3) : null;
  const cDemandBase = statsOf(winHistory.map(h =>
    h?.params?.C != null ? Math.min(1, (h.params.C - 1) / 3) : null
  ));
  if (cToday01 != null && cDemandBase?.n >= MIN_N_BASELINE) {
    demandsContribs.push({
      kind: "value", name: "Context shifts",
      value: cToday01, ci: ciOf(cDemandBase),
      teach: "How much your day jumped between unrelated threads. Higher means more switching, more scattered focus. Your own trend only.",
      fillColor: T.sage,
      fillPct: cToday01 * 100, baselinePct: baselinePctOf(cDemandBase),
      source: srcWith(cDemandBase, "from your writing · your own trend only"),
      status: statusVs(cToday01, cDemandBase, false),
      bucket: "demands",
      series: historySeries(history, (h) => h?.params?.C != null
        ? Math.min(1, (h.params.C - 1) / 3) : null),
      formatValue: (v) => v.toFixed(2),
      anchors: ["Heavy", "Some", "Usual", "Low"],
    });
    demandsValues.push(cToday01);
    demandsBases.push(cDemandBase.median);
  }

  // Calendar-driven contributors. Activated only if the user has connected
  // at least one feed AND today has at least one meeting. Otherwise the
  // info card stays — same "Not yet measured" copy as before.
  let calendarToday = null;
  let calendarWindow = null;
  try {
    if (hasAnyFeed()) {
      calendarToday = calendarSignalsForToday();
      calendarWindow = calendarSignalsForWindow();
    }
  } catch { /* fail silent; info cards still render */ }

  const interrupt = (calendarToday && calendarToday.meetings > 0)
    ? interruptionCost(calendarToday) : null;
  const beingSeen = (calendarToday && calendarToday.meetings > 0)
    ? beingSeenWeight(calendarToday) : null;
  // 14-day baselines computed only from days that had any meeting — empty
  // days shouldn't drag the baseline to zero.
  const interruptBase = calendarWindow
    ? statsForMetric(calendarWindow.filter((s) => s.meetings > 0), interruptionCost)
    : { median: null, std: null, n: 0 };
  const beingSeenBase = calendarWindow
    ? statsForMetric(calendarWindow.filter((s) => s.meetings > 0), beingSeenWeight)
    : { median: null, std: null, n: 0 };

  if (interrupt != null) {
    demandsContribs.push({
      kind: "value", name: "Interruption cost",
      value: interrupt, ci: ciOf(interruptBase),
      teach: "The hidden tax of switching between meetings and messages. Rises with meeting density, back-to-backs, and gaps too short to recover in.",
      fillColor: T.alert,
      fillPct: interrupt * 100, baselinePct: baselinePctOf(interruptBase),
      source: srcWith(interruptBase, "from your calendar"),
      status: statusVs(interrupt, interruptBase, false),
      // Chart props
      bucket: "demands",
      todayDisplay: interrupt,
      series: calendarSeriesFromWindow(calendarWindow, interruptionCost),
      unit: "of 10 · today",
      decimals: 0,
      formatValue: (v) => (v * 10).toFixed(1),
      anchors: ["Many", "Some", "Usual", "Few"],
      methodology: "Density-based composite from your calendar — meeting count, back-to-backs, and gaps too short to recover in.",
    });
    demandsValues.push(interrupt);
    if (interruptBase?.n >= MIN_N_BASELINE) demandsBases.push(interruptBase.median);
  }
  // No "Not yet measured" stub — hide the card entirely until calendar
  // data is connected (was rendering as visual error/placeholder noise).

  if (beingSeen != null) {
    demandsContribs.push({
      kind: "value", name: "Being-seen weight",
      value: beingSeen, ci: ciOf(beingSeenBase),
      teach: "The energy spent in moments when you're on display — meetings with three or more people, larger audiences, organising the room.",
      fillColor: T.sage,
      fillPct: beingSeen * 100, baselinePct: baselinePctOf(beingSeenBase),
      source: srcWith(beingSeenBase, "from your calendar"),
      status: statusVs(beingSeen, beingSeenBase, false),
      // Chart props
      bucket: "demands",
      todayDisplay: beingSeen,
      series: calendarSeriesFromWindow(calendarWindow, beingSeenWeight),
      unit: "of 10 · today",
      decimals: 0,
      formatValue: (v) => (v * 10).toFixed(1),
      anchors: ["High", "Some", "Usual", "Low"],
      methodology: "Attendee-hours weighted by work vs personal calendars — how much of today was spent on display.",
    });
    demandsValues.push(beingSeen);
    if (beingSeenBase?.n >= MIN_N_BASELINE) demandsBases.push(beingSeenBase.median);
  }
  // No "Not yet measured" stub — hide the card entirely until calendar
  // data is connected.

  const demandsScore01 = demandsValues.length
    ? demandsValues.reduce((a, b) => a + b, 0) / demandsValues.length : null;
  const demandsBaseline01 = demandsBases.length
    ? demandsBases.reduce((a, b) => a + b, 0) / demandsBases.length : null;
  // PR #6: demandsHeaviest now picks between the two surviving
  // demands contributors (interruption cost · being-seen weight),
  // both calendar-derived. Thinking load and Lingering strain were
  // retired in PR #6.
  const demandsHeaviest = (interrupt ?? 0) > (beingSeen ?? 0) ? "Interruption cost" : "Being-seen weight";

  const demands = {
    score:       demandsScore01 != null ? demandsScore01 * 100 : null,
    baseline:    demandsBaseline01 != null ? demandsBaseline01 * 100 : null,
    baselinePct: demandsBaseline01 != null ? demandsBaseline01 * 100 : null,
    contributors: demandsContribs,
  };

  // ── Form ────────────────────────────────────────────────────────
  const params = latest?.params || {};
  const formContribs = [];
  const formValues = [];
  const formBases  = [];

  // PR #6: Four NLP-derived Form contributor cards retired —
  // Focus (params.S), One thing at a time (params.C), Steadiness
  // under feeling (params.psi), Bounce-back (recentStrain). All
  // four were named with clinical-sounding labels but derived from
  // unvalidated NLP composites with no LIWC analogue. The Form
  // bucket modal now shows only Day-to-day steadiness (WHO-5
  // variance) — the single validated form-signal we have. The raw
  // NLP parameters still flow as engine context for the Letter
  // narrative LLM, just not rendered.

  // Day-to-day steadiness — variance of WHO-5 wellbeing scores across
  // the last 30 days (skipping days without a logged check-in). PR #4
  // of the layered-honesty plan retired the HCPI-variance version
  // because variance-of-a-correlated-composite is variance-of-the-
  // latent-factor wearing 8 hats. WHO-5 is a single validated
  // instrument (Topp 2015, α = .83–.93), so its variance is
  // interpretable on its own.
  //
  // Gate: ≥7 logged WHO-5 days within the last 30. No calendar-day
  // floor (WHO-5 is self-contained — a user who only does WHO-5
  // without journaling still earns this card after 7 days).
  //
  // Mapping: SD 5 → 1.0 (very steady), SD 25 → 0.0 (very unsteady).
  // Based on observed daily-diary WHO-5 ranges in published trials.
  const who5Recent = recentWho5(30);
  const who5Stats = (() => {
    if (who5Recent.length < 2) return { n: who5Recent.length, std: 0, median: 0 };
    const vals = who5Recent.map((e) => e.score);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1);
    const sorted = [...vals].sort((a, b) => a - b);
    return { n: vals.length, std: Math.sqrt(variance), median: sorted[Math.floor(sorted.length / 2)] / 100 };
  })();
  if (who5Stats.n >= 7) {
    const cons = clamp01(1 - (who5Stats.std - 5) / 20);
    formContribs.push({
      kind: "value", name: "Day-to-day steadiness",
      value: cons, ci: null,
      teach: "How even your days feel to each other — whether your wellbeing swings wildly or stays roughly the same shape across the week.",
      fillColor: cons >= 0.6 ? T.moss : T.warn,
      fillPct: cons * 100, baselinePct: null,
      source: `from your daily check-ins · ${who5Stats.n}-day variance`,
      status: null,
      bucket: "form",
      todayDisplay: cons,
      series: who5Series(14),
      anchor: firstNAnchorWho5(30),
      unit: "of 10 · today",
      decimals: 0,
      formatValue: (v) => (v * 10).toFixed(1),
      anchors: ["Even", "Usual", "Mixed", "Off"],
      methodology: "How even your wellbeing reads from day to day across the last 30. Standard deviation of your daily check-in scores, mapped so a very steady run reads near the top and a noisy one reads near the bottom.",
    });
    formValues.push(cons);
  } else if (psiBase?.n >= 7) {
    // Fallback: when WHO-5 isn't there yet, use the steadiness of
    // your own writing tone instead. Honest framing: "from your writing,
    // your own trend only" — not the same instrument as WHO-5, named
    // distinctly so we don't pretend the two are interchangeable.
    const psiVals = winHistory
      .map(h => h?.params?.psi != null ? Math.min(1, h.params.psi / 1.1) : null)
      .filter(v => v != null);
    const psiMean = psiVals.reduce((s, v) => s + v, 0) / psiVals.length;
    const psiVar = psiVals.reduce((s, v) => s + (v - psiMean) ** 2, 0) / (psiVals.length - 1);
    const psiStd = Math.sqrt(psiVar);
    const cons = clamp01(1 - psiStd / 0.20);
    formContribs.push({
      kind: "value", name: "Steadiness across the week",
      value: cons, ci: null,
      teach: "How even the tone of your writing has held across recent days. Calm, level entries push it up; turbulent ones push it down. Your own trend only.",
      fillColor: cons >= 0.6 ? T.moss : T.warn,
      fillPct: cons * 100, baselinePct: null,
      source: `from your writing · ${psiVals.length}-day variance`,
      status: null,
    });
    formValues.push(cons);
  } else {
    // Need 7+ daily check-ins OR 7+ journal days to surface this card.
    const checkinsNeed = Math.max(0, 7 - who5Stats.n);
    const journalNeed = Math.max(0, 7 - (psiBase?.n || 0));
    const need = Math.min(checkinsNeed, journalNeed);
    const pill = need > 0
      ? `${need} more day${need === 1 ? "" : "s"}`
      : "Not yet measured";
    const desc = "How even your days feel to each other. Lights up once we have at least seven days of writing or seven daily check-ins behind it.";
    formContribs.push({
      kind: "info", name: "Day-to-day steadiness", pill, desc,
    });
  }

  // Journal-derived Form contributors — your own NLP trend, no
  // external validity claim. Source line is the honest disclaimer.
  const sToday01 = latest?.params?.S != null ? Math.min(1, latest.params.S / 3.5) : null;
  if (sToday01 != null && sBase?.n >= MIN_N_BASELINE) {
    formContribs.push({
      kind: "value", name: "Focus in your writing",
      value: sToday01, ci: ciOf(sBase),
      teach: "How focused today's writing reads — tight on one thread vs. spread across many. Your own trend only — not a clinical focus measure.",
      fillColor: fillColorFor(sToday01, sBase),
      fillPct: sToday01 * 100, baselinePct: baselinePctOf(sBase),
      source: srcWith(sBase, "from your writing · your own trend only"),
      status: statusVs(sToday01, sBase, true),
      bucket: "form",
      series: historySeries(history, (h) => h?.params?.S != null
        ? Math.min(1, h.params.S / 3.5) : null),
      formatValue: (v) => v.toFixed(2),
      anchors: ["Tight", "Usual", "Loose", "Scattered"],
    });
    formValues.push(sToday01);
    formBases.push(sBase.median);
  }

  const psiToday01 = latest?.params?.psi != null ? Math.min(1, latest.params.psi / 1.1) : null;
  if (psiToday01 != null && psiBase?.n >= MIN_N_BASELINE) {
    formContribs.push({
      kind: "value", name: "Tone steadiness today",
      value: psiToday01, ci: ciOf(psiBase),
      teach: "How level the tone of today's writing reads compared to your own recent days. Calmer tones read higher; turbulent ones lower.",
      fillColor: fillColorFor(psiToday01, psiBase),
      fillPct: psiToday01 * 100, baselinePct: baselinePctOf(psiBase),
      source: srcWith(psiBase, "from your writing · your own trend only"),
      status: statusVs(psiToday01, psiBase, true),
      bucket: "form",
      series: historySeries(history, (h) => h?.params?.psi != null
        ? Math.min(1, h.params.psi / 1.1) : null),
      formatValue: (v) => v.toFixed(2),
      anchors: ["Level", "Usual", "Mixed", "Off"],
    });
    formValues.push(psiToday01);
    formBases.push(psiBase.median);
  }

  // PR #5: Form headline score = today's WHO-5 wellbeing alone
  // (Topp 2015 · α = .83–.93). The composite avg of focus / one-at-
  // a-time / steadiness / bounce-back / consistency retired because
  // those NLP-derived signals lack external validation. They remain
  // as contributor cards inside the bucket modal (cleaned up in
  // PR #6) but the headline number is now a single validated source.
  // Baseline: median of last 30 days of WHO-5 entries (≥ MIN_N_CI).
  const todayWho5Entry = todayWho5();
  const recentWho5For30 = recentWho5(30);
  const who5HeadlineBase = (() => {
    if (recentWho5For30.length < MIN_N_BASELINE) return null;
    const sorted = recentWho5For30.map((e) => e.score).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] / 100;
  })();
  // Headline = today's WHO-5 if logged (validated single source);
  // otherwise the average of journal-derived form contributors.
  const formAvg01 = formValues.length
    ? formValues.reduce((a, b) => a + b, 0) / formValues.length : null;
  const formBaseAvg01 = formBases.length
    ? formBases.reduce((a, b) => a + b, 0) / formBases.length : null;
  const formScore01 = todayWho5Entry ? todayWho5Entry.score / 100 : formAvg01;
  const formBaseline01 = who5HeadlineBase != null ? who5HeadlineBase : formBaseAvg01;
  const form = {
    score:       formScore01 != null ? formScore01 * 100 : null,
    baseline:    formBaseline01 != null ? formBaseline01 * 100 : null,
    baselinePct: formBaseline01 != null ? formBaseline01 * 100 : null,
    contributors: formContribs,
  };

  // ── Patterns drawer (AI lens content) ──────────────────────────
  // Recurrence-based classification of "parts of you" over a 28-day
  // calendar window. Math runs on DAY-level recurrence (not entry
  // count), so the result holds whether the user writes daily or
  // sparsely. Same-day duplicates collapse via the Set.
  //
  //   stable       ≥0.70 of writing days  ≈ trait-like / habit territory
  //   borderline   point estimate looks stable OR coming-and-going, but
  //                Wilson 95% CI straddles the 0.70 boundary — the math
  //                can't tell yet
  //   coming&going 0.30–0.70              ≈ state-dependent / situational
  //   still forming <0.30, ≥2 distinct days
  //                                        ≈ real-but-thin signal
  //   <2 days                              dropped (likely transient context)
  //
  // The drawer doesn't unlock until the window has ≥14 writing days —
  // half-density of the four-week stretch. Below that, recurrence
  // rates carry CIs wider than the thresholds.
  //
  // Wilson score interval (Brown et al. recommend for small-sample
  // binomial proportions; Clopper-Pearson is too conservative). At
  // n=14, p̂=0.70 has Wilson 95% CI ≈ [0.44, 0.87] — wide enough that
  // a single point estimate at the boundary cannot be called "stable"
  // honestly. The borderline tier surfaces exactly those cases.
  const PATTERNS_WINDOW_DAYS = 28;
  const PATTERNS_STABLE_RATE = 0.70;
  const PATTERNS_NOISY_RATE  = 0.30;
  const PATTERNS_MIN_PART_DAYS = 2;
  const PATTERNS_READY_DAYS  = 14;
  const PATTERNS_Z = 1.96;             // 95% CI z-score
  const wilsonCI = (k, n) => {
    if (n === 0) return [0, 0];
    const phat = k / n;
    const z2 = PATTERNS_Z * PATTERNS_Z;
    const denom = 1 + z2 / n;
    const center = (phat + z2 / (2 * n)) / denom;
    const halfW = (PATTERNS_Z * Math.sqrt(phat * (1 - phat) / n + z2 / (4 * n * n))) / denom;
    return [Math.max(0, center - halfW), Math.min(1, center + halfW)];
  };
  // Window = the user's MOST-RECENT 28 unique writing days, sliding
  // through their actual writing — not the calendar. The previous
  // "last 28 calendar days" gate locked out anyone who batch-imported
  // an older journal: 35 readings dated months ago counted for zero
  // because zero of them fell inside Date.now() − 28d. With a sliding
  // window the Patterns card lights up as soon as the user has enough
  // writing total, whenever it happened.
  const entriesByDay = new Map();      // dayKey -> entries[]
  for (const h of history) {
    const t = h?.date ? new Date(h.date).getTime() : NaN;
    if (!Number.isFinite(t)) continue;
    const dayKey = new Date(t).toISOString().slice(0, 10);
    if (!entriesByDay.has(dayKey)) entriesByDay.set(dayKey, []);
    entriesByDay.get(dayKey).push(h);
  }
  const sortedDayKeys = [...entriesByDay.keys()].sort().reverse();
  const windowDayKeys = sortedDayKeys.slice(0, PATTERNS_WINDOW_DAYS);
  const partDaySets = {};              // partId -> Set<dayKey>
  const writingDaySet = new Set(windowDayKeys);
  for (const dayKey of windowDayKeys) {
    for (const h of entriesByDay.get(dayKey) || []) {
      for (const p of (h?.letterParts || [])) {
        if (p?.id) (partDaySets[p.id] ??= new Set()).add(dayKey);
      }
    }
  }
  const patternsWindowWriteDays = writingDaySet.size;
  const patternsReady = patternsWindowWriteDays >= PATTERNS_READY_DAYS;
  const stableIds = [], borderlineIds = [], noisyIds = [], calibratingIds = [];
  if (patternsReady) {
    for (const [partId, days] of Object.entries(partDaySets)) {
      const c = days.size;
      if (c < PATTERNS_MIN_PART_DAYS) continue;
      const rate = c / patternsWindowWriteDays;
      const [ciLo, ciHi] = wilsonCI(c, patternsWindowWriteDays);
      // Borderline: 95% CI straddles the stable threshold. Either the
      // point estimate looks stable but the lower bound says it might
      // not be, OR it looks coming-and-going but the upper bound says
      // it might be stable. Either way, math says "can't tell yet".
      const ciStraddlesStable = ciLo < PATTERNS_STABLE_RATE && ciHi >= PATTERNS_STABLE_RATE;
      if (ciStraddlesStable) borderlineIds.push({ id: partId, rate });
      else if (rate >= PATTERNS_STABLE_RATE) stableIds.push({ id: partId, rate });
      else if (rate >= PATTERNS_NOISY_RATE) noisyIds.push({ id: partId, rate });
      else calibratingIds.push({ id: partId, rate });
    }
  }
  // Sort by rate descending so the named lead is the part most-present in
  // the user's writing — names with the strongest signal first.
  stableIds.sort((a, b) => b.rate - a.rate);
  noisyIds.sort((a, b) => b.rate - a.rate);
  const stable = stableIds.length;
  const borderline = borderlineIds.length;
  const noisy = noisyIds.length;
  const calibrating = calibratingIds.length;

  // Helper: render a list of part IDs as their human names, joined naturally.
  // ["planner"] → "the planner"; ["planner", "watcher"] → "the planner and the watcher";
  // 3+ → "the planner, the watcher and the seeker" (cap at 3 so it stays scannable).
  const namePart = (id) => PARTS_LIB?.[id]?.name || id;
  const joinNames = (ids) => {
    const names = ids.slice(0, 3).map(p => namePart(p.id));
    if (names.length === 0) return "";
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  };
  const stableNames = joinNames(stableIds);
  const noisyNames = joinNames(noisyIds);
  const stableVerb = stable === 1 ? "has" : "have";
  const noisyVerb = noisy === 1 ? "is" : "are";

  // Specific, named claim — replaces the previous generic "two parts of
  // you have settled in" template that named nothing. With actual part
  // names, the claim reads as a friend's observation about *you*, not a
  // counter that could apply to anyone.
  let patternsClaim;
  if (stable === 0 && noisy === 0) {
    patternsClaim = "No parts of you have shown up consistently yet — the shape is still forming.";
  } else if (stable === 0) {
    patternsClaim = `${capitalize(noisyNames)} ${noisyVerb} been showing up some days, not others. Early in the shape.`;
  } else if (noisy === 0) {
    patternsClaim = `${capitalize(stableNames)} ${stableVerb} settled in. The rest of your shape has been quiet.`;
  } else {
    patternsClaim = `${capitalize(stableNames)} ${stableVerb} settled in. ${capitalize(noisyNames)} ${noisyVerb} still coming and going.`;
  }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // ── Today's read line — only compares when we have a real baseline.
  let readLine;
  if (demandsScore01 == null) {
    readLine = "Still gathering your shape. Today is one entry; the rest comes with time.";
  } else if (demandsBaseline01 == null) {
    readLine = `Today's demand reads ${(demandsScore01 * 10).toFixed(1)} on a 0–10 scale. The "vs your typical" line shows up once we have a week of writing behind it.`;
  } else {
    const dPct = ((demandsScore01 - demandsBaseline01) / Math.max(0.01, demandsBaseline01)) * 100;
    readLine = dPct > 10
      ? "Decisions sat heavier today than they usually do for you. Your day asked more of that part of the system."
      : dPct < -10
      ? "A lighter day than your typical. The system carried less than usual — whatever you did today was easier on it."
      : "Decisions sat about where they usually do for you.";
  }

  // ── "Worth noticing" — body × words divergence detector ─────────
  //
  // Surfaces ONLY when biometric signals and writing signals point in
  // opposite directions on the same day. This is the buried gold in
  // any multi-modal cognitive system: the moments most other apps
  // miss are the ones where body and words disagree.
  //
  // Strict framing: this is a REFLECTION PROMPT, not a measurement.
  // We're not claiming the divergence means anything specific — just
  // that it's worth the user's attention. Until we have ≥6 weeks of
  // WHO-5 correlation per user (deferred phase), no accuracy claim
  // is defensible here.
  //
  // Decision rule:
  //   body recovered    sleep > base + 0.10 AND HRV > base + 0.10
  //   body depleted     sleep < base − 0.10 AND HRV < base − 0.10
  //   words calm        mu > base + 0.10 AND psi > base + 0.10
  //   words strained    mu < base − 0.10 OR strain > base + 0.10
  // (All values normalised to 0–1 before comparison.)
  let worthNoticing = null;
  const DIVERGE_EPSILON = 0.10;
  const haveBodyToday = sleepReading != null && hrvReading != null && sleepBase?.n >= MIN_N_BASELINE && hrvBase?.n >= MIN_N_BASELINE;
  const haveWordsToday = latest != null && muBase?.n >= MIN_N_BASELINE && psiBase?.n >= MIN_N_BASELINE;
  if (haveBodyToday && haveWordsToday) {
    const sleepToday01 = clamp01((sleepReading.value / 60) / 7.5);
    const hrvToday01   = clamp01(hrvReading.value / 60);
    const muToday01    = latest?.params?.mu != null ? clamp01(1 - latest.params.mu) : null;
    const psiToday01   = latest?.params?.psi != null ? Math.min(1, latest.params.psi / 1.1) : null;
    const latestStrain2 = readStrain(latest);
    const strainToday01 = typeof latestStrain2 === "number"
      ? Math.max(0.05, Math.min(0.40, (latestStrain2 - 1) * 0.4 + 0.12))
      : null;
    const bodyRecovered =
      sleepToday01 > sleepBase.median + DIVERGE_EPSILON &&
      hrvToday01   > hrvBase.median   + DIVERGE_EPSILON;
    const bodyDepleted =
      sleepToday01 < sleepBase.median - DIVERGE_EPSILON &&
      hrvToday01   < hrvBase.median   - DIVERGE_EPSILON;
    const wordsCalm =
      muToday01  != null && muToday01  > muBase.median  + DIVERGE_EPSILON &&
      psiToday01 != null && psiToday01 > psiBase.median + DIVERGE_EPSILON;
    const wordsStrained =
      (muToday01 != null && muToday01 < muBase.median - DIVERGE_EPSILON) ||
      (strainToday01 != null && strainBase?.median != null && strainToday01 > strainBase.median + DIVERGE_EPSILON);
    if (bodyRecovered && wordsStrained) {
      worthNoticing = "Your body reads recovered today, but your words read strained. Worth noticing — sometimes the body settles before the mind does.";
    } else if (bodyDepleted && wordsCalm) {
      worthNoticing = "Your body reads depleted today, but your words read calm. Worth noticing — that can be steadiness, or it can be that you haven't let yourself feel it yet.";
    }
  }

  // Render the four bucket lists as just names — the card shows what's
  // there instead of a count. Cap at 4 names per bucket so the card stays
  // scannable on a small phone (the patternsClaim already names the lead).
  const nameList = (ids) => ids.slice(0, 4).map((p) => namePart(p.id));
  return {
    daysWritten,
    nightsRecorded,
    eveningReadings,
    reserves,
    demands,
    demandsHeaviest,
    form,
    patternsClaim,
    patternsStable: stable,
    patternsBorderline: borderline,
    patternsNoisy: noisy,
    patternsCalibrating: calibrating,
    patternsStableNames: nameList(stableIds),
    patternsBorderlineNames: nameList(borderlineIds),
    patternsNoisyNames: nameList(noisyIds),
    patternsCalibratingNames: nameList(calibratingIds),
    patternsReady,
    patternsWindowWriteDays,
    readLine,
    worthNoticing,
  };
}

// ─── Default export ─────────────────────────────────────────────────

export default function CognitiveProfile({ history = [], biometrics = null, mode, onGoPatterns }) {
  const [openBucket, setOpenBucket] = useState(null);

  const dayKeys = uniqueCheckinDays(history);
  const daysWritten = dayKeys.size;
  const nightsRecorded = ouraNightCount(28);
  const phase = computePhase(daysWritten, nightsRecorded);
  const firstDay = useMemo(() => computeFirstDay(history), [history]);

  const stats = useMemo(() => computeStats({ history, biometrics, phase }), [history, biometrics, phase]);

  const isCalibrating = phase.days < 14;

  // mode + onGoPatterns accepted for backward compat with CPI.jsx; not currently used.
  void mode; void onGoPatterns;

  return (
    <div style={{
      background: T.bg,
      margin: "-40px -24px -60px",
      padding: "40px 22px 60px",
      minHeight: "calc(100vh - 80px)",
    }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        {isCalibrating ? (
          <CalibratingView phase={phase} stats={stats} firstDay={firstDay} history={history} />
        ) : (
          <CalibratedView stats={stats} phase={phase} onOpenBucket={setOpenBucket} history={history} />
        )}
      </div>

      {openBucket && (
        <BucketDetailModal
          onClose={() => setOpenBucket(null)}
          stats={stats}
          phase={phase}
          bucket={openBucket}
        />
      )}
    </div>
  );
}
