// Analyze.jsx — components + helpers used exclusively by the Analyze tab.
//
// Extracted from CPI.jsx on 2026-05-06 so the Analyze panel is fully
// self-contained: changes here don't bleed into the You / Patterns /
// Journal tabs, and changes to those tabs don't risk this file.
//
// Stage 2A of the panel-separation refactor. The inline input/result
// view JSX still lives in CPI.jsx for now (Stage 2B) — but every
// component, helper, and constant the Analyze panel uses is here.
//
// Nothing in this file should be imported by Patterns.jsx / Journal.jsx /
// CognitiveProfile.jsx. CPI.jsx imports the named exports at the bottom.

import { useState, useEffect, useMemo, useRef } from "react";
import { KB, HEALTH_INDEX, CHRONOTYPES, uniqueDayCount } from "./knowledge-base.js";
import {
  OURA_HISTORY_KEY, BIOMETRICS_KEY, BASELINE_MIN_DAYS,
  manualSleepToScore, normalizeSleepEntry, computeBiometricTrends,
  computeBaselineStatus,
  e0Label, formatBodyContext, computeDailyRings, sleepMinFor, sleepSourceFor,
  needsSleepReview, loadRepo,
  loadCoachCache, ringSignature, generateCoachLine,
  getUltradianPhase,
  generateReadingInsight, readingInsightSignature, loadReadingInsightCache,
  loadCheckin,
} from "./engine.js";
import { ymdISO, daysBetween, stampMatchesDay, journalEntryCoversDay } from "./dates.js";
import { PARTS_LIB } from "./LetterReading.jsx";
import { todayWho5, recentWho5, bandFor as who5BandFor } from "./who5.js";
import Who5Intake from "./Who5Intake.jsx";

// Garden Plot palette tokens (kept in sync with CPI.jsx; if these
// diverge, fix CPI.jsx too).
const g = "#4F8A5F", y = "#C4902A", r = "#B0553A";

// ── Constants ───────────────────────────────────────────────
const GP_EMPTY = {
  bg: "#F7F3EC", paper: "#FFFCF6", ink: "#2B2824",
  muted: "#958E84", faint: "#B8B09D",
  hair: "rgba(45,42,36,0.07)", line: "rgba(45,42,36,0.12)",
  leaf: "#3F5B39", moss: "#6A8A5C", bloom: "#C98660",
};

const ES = {
  frame: { padding: "8px 0 28px", maxWidth: "32em" },
  dateline: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontStyle: "italic", fontSize: 13, color: GP_EMPTY.muted,
    marginBottom: 6, letterSpacing: 0.2,
  },
  greeting: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontStyle: "italic", fontWeight: 400, fontSize: 32,
    lineHeight: 1.15, letterSpacing: -0.4,
    margin: "0 0 10px", color: GP_EMPTY.ink,
  },
  subline: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontSize: 15, lineHeight: 1.7,
    color: GP_EMPTY.muted, margin: "0 0 18px", maxWidth: "26em",
  },
  echo: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontStyle: "italic", fontSize: 13, color: GP_EMPTY.muted,
    paddingTop: 14, borderTop: `1px solid ${GP_EMPTY.hair}`,
    lineHeight: 1.7, marginTop: 6,
  },
  echoCap: { color: GP_EMPTY.faint, letterSpacing: 0.3 },
  echoGlyph: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontStyle: "italic", fontSize: 16,
  },
  echoName: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontStyle: "italic", color: GP_EMPTY.ink,
  },
  echoSep: { color: GP_EMPTY.faint },
  firstHint: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontSize: 13.5, lineHeight: 1.7,
    color: GP_EMPTY.muted, marginTop: 14, paddingTop: 14,
    borderTop: `1px solid ${GP_EMPTY.hair}`,
    maxWidth: "30em",
  },
};

const QUIET_REFLECTIONS = [
  // Neuroscience / research
  "Naming a feeling lowers amygdala activity. The MRI saw it before therapists did.",  // Lieberman 2007
  "Most strong feelings pass within ninety seconds when not fed.",                     // Jill Bolte Taylor
  "Cortisol does not distinguish between a tiger and a Tuesday.",                      // Sapolsky
  "When you write what you cannot say, your immune cells listen.",                    // Pennebaker 1986
  "A muscle relaxes faster than a thought.",
  "Crying produces the same neurochemicals as laughing.",
  "Heart rate variability rises when we look at trees. It does not know why.",
  "The vagus nerve carries more signals from gut to brain than the other way.",
  "Humming activates the vagus nerve. So does singing in the shower.",
  "Sleep deprivation and depression look identical in fMRI.",
  "A hard decision tends to land better earlier in the day than at the tail of a long one.",
  "The default mode network lights up when nothing is asked of it. That is where rumination lives.",
  "A six-second hug crosses some threshold. Below that, the nervous system isn't sure.",
  "We forget forty percent of today by tomorrow. The journal is the rest.",
  "Safety is not the absence of threat. It is the presence of connection.",            // Porges

  // Psychology giants
  "Until you make the unconscious conscious, it will direct your life and you will call it fate.",  // Jung
  "What you resist not only persists, but grows in size.",                             // Jung
  "There is no coming to consciousness without pain.",                                 // Jung
  "Between stimulus and response there is a space. In that space is our power to choose.",  // Frankl
  "What I am is enough, if I would only be it openly.",                                // Carl Rogers
  "Even the part of you that hurts you is trying to keep you safe.",                  // IFS
  "All parts are welcome. The exiled ones knock the loudest.",                         // IFS
  "The Self has no memory of ever being broken.",                                       // IFS / Schwartz
  "The soul speaks in symptoms when it is not heard.",                                 // Hillman
  "Symptoms are the body's poetry.",                                                    // Hillman

  // Poets, writers, philosophers
  "Attention is the rarest and purest form of generosity.",                            // Simone Weil
  "Tell all the truth but tell it slant.",                                             // Dickinson
  "The cure for anything is salt water — sweat, tears, or the sea.",                  // Dinesen
  "Pay attention. Be astonished. Tell about it.",                                       // Mary Oliver
  "We do not see things as they are; we see them as we are.",                          // Talmud / Nin
  "The trouble is, you think you have time.",                                           // attributed to Buddha
  "Tend to the wound where you bleed; it is also where the light enters.",            // after Rumi

  // Contemplative / ACT / observational
  "An emotion is a guest, not a tenant.",
  "Curiosity is what pain looks like when it is not afraid.",
  "The opposite of anxious is not calm — it is curious.",
  "You can hold a thought without becoming it.",
  "Pain times resistance equals suffering.",
  "If you would heal it, you must feel it.",
  "Suffering is pain plus the story we tell about it.",
  "Self-compassion is not soft. It is structural.",
  "Slowness is information.",
  "Soft attention notices what loud attention misses.",

  // Garden / cycle-aware
  "Some seeds need a winter.",
  "Roots first. Bloom later.",
  "What looks like dying is sometimes wintering.",
  "Every garden has dormant beds. They are not failing; they are waiting.",
  "Some flowers only open after dark.",
  "The gardener cannot rush the rose.",
  "Roots grow most in the dark.",
  "The seed knows what the gardener is still figuring out.",
];

const QUIET_GLYPHS = ["✿", "❀", "❁", "❃", "❉", "❋", "✾"];

const PILLAR_COLOR = { body: "#94B79A", mind: "#9DB2C9", mood: "#E8A898" };
const PILLAR_TINT  = { body: "rgba(148,183,154,0.12)", mind: "rgba(157,178,201,0.12)", mood: "rgba(232,168,152,0.12)" };

const WAKE_OVERRIDE_PREFIX = "cpi_wake_override_";
const WAKE_LAST_KEY = "cpi_wake_last";

// ── Helpers ─────────────────────────────────────────────────
function pickQuietReflection() {
  return QUIET_REFLECTIONS[Math.floor(Math.random() * QUIET_REFLECTIONS.length)];
}

function pickQuietGlyph() {
  return QUIET_GLYPHS[Math.floor(Math.random() * QUIET_GLYPHS.length)];
}

function explainHCPI(h, a, biometrics) {
  const factors = [];
  // Each factor has a severity score (higher = contributed MORE to the drop)
  // and a plain-language detail. We pick the top 1-2 to show.

  // Sleep / energy baseline
  if (h.E0 != null) {
    const sleepH = biometrics?.totalSleepMin ? biometrics.totalSleepMin / 60 : null;
    if (h.E0 < 0.6) {
      factors.push({
        key: "e0",
        label: "Low energy baseline",
        detail: sleepH != null ? `Sleep ${sleepH.toFixed(1)}h — below the 7h restorative floor` : "Sleep/readiness inputs are low",
        severity: (0.75 - h.E0) * 2,
      });
    } else if (h.E0 < 0.8) {
      factors.push({
        key: "e0",
        label: "Energy below peak",
        detail: sleepH != null ? `Sleep ${sleepH.toFixed(1)}h — adequate but not restorative` : "Sleep/readiness slightly below baseline",
        severity: (0.85 - h.E0) * 1.2,
      });
    }
  }

  // Wake decay (Ha > 16 is the "awake wall")
  if (h.Ha > 16) {
    factors.push({
      key: "decay",
      label: "Extended wakefulness",
      detail: `Awake ${Math.round(h.Ha)}h — past the 16h cognitive decay threshold`,
      severity: (h.Ha - 16) * 0.35,
    });
  }

  // Text-derived: flow (S), emotion (psi), drivers (mu), concurrency (C)
  if (a?.S != null && a.S < 1.3) {
    factors.push({
      key: "flow",
      label: "Fragmented focus",
      detail: "Today's entry shows low flow signals — scattered attention, task-switching",
      severity: (1.5 - a.S) * 0.7,
    });
  }
  if (a?.psi != null && a.psi < 0.75) {
    factors.push({
      key: "psi",
      label: "Elevated emotional load",
      detail: "Today's entry carries strong negative affect",
      severity: (0.9 - a.psi) * 1.5,
    });
  }
  if (a?.mu != null && a.mu > 0.25) {
    factors.push({
      key: "mu",
      label: "Drivers active",
      detail: "Ego / control / avoidance signals are pulling resources from goal work",
      severity: a.mu * 1.2,
    });
  }
  if (a?.C != null && a.C > 2.5) {
    factors.push({
      key: "c",
      label: "High concurrency",
      detail: "Juggling multiple threads at once — context-switch cost is eating throughput",
      severity: (a.C - 2) * 0.4,
    });
  }

  // Accumulated multi-day stress
  if (h.recentStrain > 1.3) {
    factors.push({
      key: "allo",
      label: "Accumulated stress",
      detail: "Recent days carry sustained emotional load (allostatic load)",
      severity: (h.recentStrain - 1) * 1.2,
    });
  }

  // Circadian + ultradian dips
  if (h.chronoMod < 0.92) {
    factors.push({
      key: "chrono",
      label: "Off-peak for your chronotype",
      detail: "This hour sits against your natural rhythm",
      severity: (1 - h.chronoMod) * 2,
    });
  }

  factors.sort((a, b) => b.severity - a.severity);
  return factors.slice(0, 2);
}

function summarizeHCPI(h, a, biometrics, tier) {
  const top = explainHCPI(h, a, biometrics);
  if (top.length === 0) {
    // Generic severity without cause attribution
    if (tier.label === "Low tide" || tier.label === "Heavy hour") {
      return "The signal's low, but the specific driver isn't clear from the data on hand. Keep checking in — a pattern will emerge.";
    }
    return tier.summary;
  }
  if (top.length === 1) {
    return `${top[0].label} — ${top[0].detail.toLowerCase()}.`;
  }
  return `${top[0].label} + ${top[1].label.toLowerCase()} — ${top[0].detail.toLowerCase()}; ${top[1].detail.toLowerCase()}.`;
}

function sourceTag(s) {
  if (s === "oura") return { text: "Oura", color: "var(--ac)" };
  if (s === "manual") return { text: "You", color: y };
  if (s === "self") return { text: "Check-in", color: g };
  if (s === "llm") return { text: "Ori", color: "var(--ac)" };
  return { text: s, color: "var(--mt)" };
}

function sevenDayPillarTrend(pillar, historyMap, history, checkin) {
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const ds = d.toISOString().split("T")[0];
    const entry = historyMap?.[ds] || {};
    const label = d.toLocaleDateString("en", { weekday: "narrow" });

    let val = null;
    if (pillar === "body") {
      const sleep = entry.sleepScore ?? (entry.manualSleepMin ? Math.min(100, Math.max(0, (entry.manualSleepMin / 60 - 4) * 25 + 40)) : null);
      const ready = entry.readinessScore ?? null;
      const vals = [sleep, ready].filter(v => v != null);
      val = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    } else if (pillar === "mind") {
      // HRV delta vs 30d baseline when available
      const hrv = entry.avgHRV;
      if (hrv != null) val = Math.max(0, Math.min(100, 50 + ((hrv - 45) * 2)));
    } else if (pillar === "mood") {
      // invert stress minutes, blend with journal hcpi that day
      if (entry.stressHighSec != null) {
        const mins = entry.stressHighSec / 60;
        val = Math.max(0, Math.min(100, 100 - (mins / 180) * 90));
      }
      const dayJournals = (history || []).filter(h => (h.date || "").slice(0, 10) === ds);
      if (dayJournals.length) {
        const avg = dayJournals.reduce((s, h) => s + (h.hcpi || 0), 0) / dayJournals.length;
        const jVal = Math.max(0, Math.min(100, avg * 300));
        val = val == null ? jVal : (val + jVal) / 2;
      }
    }
    days.push({ date: ds, label, value: val });
  }
  return days;
}

function pillarActions(pillar) {
  if (pillar === "body") return [
    { label: "Log sleep manually", target: "body-detail", open: "manualSleep", hint: "If Oura missed a night" },
    { label: "Sync Oura now", target: "body-detail", open: "oura", hint: "Pull the latest readings" },
  ];
  if (pillar === "mind") return [
    { label: "Run 60-sec reaction test", target: "body-detail", open: "pvt", hint: "PVT-B" },
    { label: "Rate your alertness", target: "body-detail", open: "kss", hint: "KSS — one tap" },
  ];
  return [
    { label: "Take 4-question stress check", target: "body-detail", open: "pss4", hint: "PSS-4" },
    { label: "Journal the last hour", target: "body-detail", open: "journal", hint: "Voice or text" },
  ];
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadWakeOverride(dateKey) {
  try {
    const v = localStorage.getItem(WAKE_OVERRIDE_PREFIX + (dateKey || todayKey()));
    return v || null;
  } catch { return null; }
}

function saveWakeOverride(value) {
  try {
    localStorage.setItem(WAKE_OVERRIDE_PREFIX + todayKey(), value);
    // Also write to the rolling "most recent" key so tomorrow's init has
    // a realistic fallback when the wearable hasn't published bedtime_end yet.
    localStorage.setItem(WAKE_LAST_KEY, value);
  } catch { /* ignore */ }
}

function loadLastWake() {
  try { return localStorage.getItem(WAKE_LAST_KEY) || null; } catch { return null; }
}

function saveLastWake(value) {
  try { if (value) localStorage.setItem(WAKE_LAST_KEY, value); } catch { /* ignore */ }
}

function getAutoWakeTime() {
  try {
    const raw = localStorage.getItem(OURA_HISTORY_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    const now = Date.now();
    const dates = Object.keys(map).sort().reverse().slice(0, 3);
    for (const d of dates) {
      const be = map[d]?.bedtimeEnd;
      if (!be) continue;
      const t = new Date(be).getTime();
      const delta = now - t;
      // Only trust a bedtimeEnd within the last ~28 hours — avoids
      // inheriting yesterday's wake time after a skipped sync.
      if (delta < 0 || delta > 28 * 60 * 60 * 1000) continue;
      const dt = new Date(be);
      const hh = String(dt.getHours()).padStart(2, "0");
      const mm = String(dt.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    }
    return null;
  } catch { return null; }
}

function getAutoWakeSource() {
  try {
    const raw = localStorage.getItem(BIOMETRICS_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw);
    const s = (b?.source || "").toLowerCase();
    if (s.startsWith("apple")) return "apple";
    if (s.startsWith("oura")) return "oura";
    return null;
  } catch { return null; }
}

// ── Components ──────────────────────────────────────────────
function MicButton({ listening, onClick, supported, interim, confidence, error }) {
  const disabled = !supported && !error;
  if (disabled) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
      <button onClick={onClick} type="button" disabled={!supported} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", background: listening ? r : "transparent", color: listening ? "#fff" : "var(--mt)", border: `1px solid ${listening ? r : "var(--ln)"}`, borderRadius: 20, fontSize: 11, fontFamily: "var(--fm)", letterSpacing: 1, transition: "all .3s", cursor: supported ? "pointer" : "not-allowed", opacity: supported ? 1 : 0.5 }}>
        <span style={{ fontSize: 14, lineHeight: 1 }}>{listening ? "◉" : "◎"}</span>{listening ? "Stop" : "Speak"}
      </button>
      {listening && interim && <span style={{ fontSize: 12, color: "var(--mt)", fontStyle: "italic", opacity: 0.6, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{interim}</span>}
      {!listening && confidence !== null && !error && <span style={{ fontSize: 10, fontFamily: "var(--fm)", color: confidence > 0.85 ? g : confidence > 0.7 ? y : r, opacity: 0.7 }}>{(confidence * 100).toFixed(0)}% · Nova 3</span>}
      {error && <span style={{ fontSize: 10, fontFamily: "var(--fm)", color: r, opacity: 0.8 }}>{error}</span>}
    </div>
  );
}

function SystemCriticalAlert({ Ha }) {
  return (
    <div className="ca" style={{ padding: 16, background: "rgba(166,61,64,0.08)", border: "1px solid rgba(166,61,64,0.25)", borderRadius: 10, marginBottom: 20, textAlign: "center" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: r, letterSpacing: 2, textTransform: "uppercase", fontFamily: "var(--fm)", marginBottom: 6 }}>System Critical</div>
      <div style={{ fontSize: 13, lineHeight: 1.7, color: r, opacity: 0.85 }}>You've been awake for {Math.round(Ha)} hours — past the 16-hour decay wall. Stop. Sleep.</div>
    </div>
  );
}

function Sparkline({ days, color }) {
  const W = 260, H = 56, pad = 6;
  const valid = days.map(d => d.value);
  const hasAny = valid.some(v => v != null);
  if (!hasAny) return <div style={{ height: H, display: "flex", alignItems: "center", fontSize: 11, color: "var(--mt)", fontFamily: "var(--fm)" }}>No data across this week yet.</div>;
  const xs = days.map((_, i) => pad + (i * (W - 2 * pad)) / (days.length - 1));
  const ys = days.map(d => d.value == null ? null : H - pad - (d.value / 100) * (H - 2 * pad));
  const path = days.map((_, i) => ys[i] == null ? null : `${xs[i]},${ys[i]}`).filter(Boolean).join(" L ");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <path d={`M ${path}`} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {days.map((d, i) => ys[i] != null && (
        <circle key={i} cx={xs[i]} cy={ys[i]} r={i === days.length - 1 ? 3 : 2} fill={color} stroke="var(--sf)" strokeWidth={i === days.length - 1 ? 1.5 : 0} />
      ))}
      {days.map((d, i) => (
        <text key={`l-${i}`} x={xs[i]} y={H - 0.5} textAnchor="middle" fontSize="7" fontFamily="var(--fm)" fill="var(--mt)">{d.label}</text>
      ))}
    </svg>
  );
}

function SkyArc({ hour }) {
  const t = Math.max(5, Math.min(21, hour));
  const frac = (t - 5) / (21 - 5);
  // Path is M 6 30 Q 50 -6 94 30 — a symmetric quadratic.
  // For this curve x is linear in frac and y simplifies cleanly:
  //   x(frac) = 6 + 88·frac
  //   y(frac) = 30 − 72·frac·(1 − frac)
  // The sun is rendered as an HTML span outside the SVG so it stays
  // round when preserveAspectRatio="none" stretches the arc across
  // wide containers; strokes use non-scaling-stroke for the same reason.
  const sunX = 6 + 88 * frac;
  const sunY = 30 - 72 * frac * (1 - frac);
  const trailLen = (frac * 100).toFixed(2);
  return (
    <div style={{ position: "relative", width: "100%", height: 42 }}>
      <svg viewBox="0 0 100 36" preserveAspectRatio="none"
           style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id="ori-skyarc-trail" gradientUnits="userSpaceOnUse"
                          x1="6" y1="0" x2={Math.max(sunX, 6.5)} y2="0">
            <stop offset="0"   stopColor="#C4902A" stopOpacity="0" />
            <stop offset="0.7" stopColor="#C4902A" stopOpacity="0.5" />
            <stop offset="1"   stopColor="#C4902A" stopOpacity="0.95" />
          </linearGradient>
        </defs>
        <path d="M 6 30 Q 50 -6 94 30"
              stroke="rgba(45,42,36,0.22)" strokeWidth="0.9" fill="none"
              strokeDasharray="1 2" vectorEffect="non-scaling-stroke" />
        <path d="M 6 30 Q 50 -6 94 30"
              stroke="url(#ori-skyarc-trail)" strokeWidth="1.8" fill="none"
              strokeLinecap="round" pathLength="100"
              strokeDasharray={`${trailLen} 100`}
              vectorEffect="non-scaling-stroke" />
      </svg>
      <span style={{
        position: "absolute",
        left: `${sunX}%`,
        top: `${(sunY / 36) * 100}%`,
        width: 11, height: 11,
        marginLeft: -5.5, marginTop: -5.5,
        borderRadius: "50%",
        background: "#C4902A",
        boxShadow: "0 0 6px rgba(240,185,90,0.95), 0 0 14px rgba(240,185,90,0.55), 0 0 22px rgba(240,185,90,0.3)",
        pointerEvents: "none",
      }} />
    </div>
  );
}

function GardenPlant({ kind, health, size = 104 }) {
  const h = health == null ? 0 : Math.max(0, Math.min(1, health));
  const fade = health == null ? 0.25 : 0.55 + h * 0.45;
  const color = PILLAR_COLOR[kind];
  const leafScale = 0.55 + h * 0.55;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" style={{ display: "block" }}>
      {/* Terracotta pot */}
      <path d="M 40 92 L 80 92 L 76 112 L 44 112 Z" fill="#8a7a5e" opacity="0.88" />
      <rect x="38" y="88" width="44" height="6" fill="#8a7a5e" opacity="0.95" />
      <ellipse cx="60" cy="91" rx="20" ry="2.4" fill="#4a3d28" opacity="0.5" />

      {kind === "body" && (
        <g transform="translate(60 88)" opacity={fade}>
          <path d="M 0 0 Q -1 -18 -2 -40" stroke={color} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <g transform={`scale(${leafScale})`}>
            <ellipse cx="-14" cy="-24" rx="10" ry="5" fill={color} transform="rotate(-30 -14 -24)" />
            <ellipse cx="12" cy="-32" rx="10" ry="5" fill={color} transform="rotate(30 12 -32)" />
            <ellipse cx="-10" cy="-42" rx="8" ry="4" fill={color} transform="rotate(-20 -10 -42)" />
            <ellipse cx="8" cy="-50" rx="7" ry="3.5" fill={color} transform="rotate(25 8 -50)" opacity="0.9" />
          </g>
        </g>
      )}

      {kind === "mind" && (
        <g transform="translate(60 88)" opacity={fade}>
          <path d="M -10 0 Q -12 -20 -14 -44" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M 0 0 Q -1 -22 -2 -52" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M 10 0 Q 11 -20 12 -40" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
          <g transform={`scale(${leafScale})`}>
            <ellipse cx="-14" cy="-46" rx="2.5" ry="8" fill={color} />
            <ellipse cx="-2" cy="-54" rx="2.5" ry="10" fill={color} />
            <ellipse cx="12" cy="-42" rx="2.5" ry="8" fill={color} />
          </g>
        </g>
      )}

      {kind === "mood" && (
        <g transform="translate(60 88)" opacity={fade}>
          <path d="M 0 0 Q 2 -16 3 -34" stroke={color} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <g transform={`scale(${leafScale})`}>
            <circle cx="3" cy="-38" r="6" fill={color} />
            <circle cx="-4" cy="-34" r="5" fill={color} opacity="0.9" />
            <circle cx="10" cy="-33" r="5" fill={color} opacity="0.9" />
            <circle cx="3" cy="-30" r="4.5" fill={color} opacity="0.8" />
            <circle cx="3" cy="-38" r="2" fill="var(--sf)" />
          </g>
        </g>
      )}

      {health == null && (
        <text x="60" y="108" textAnchor="middle" fontFamily="var(--fm)" fontSize="8" fill="#c79a3a" letterSpacing="1">needs you</text>
      )}
    </svg>
  );
}

function GardenPot({ pillar, label, data, active, onTap }) {
  const { value, signals } = data;
  const has = value != null;
  const color = PILLAR_COLOR[pillar];
  const h = has ? Math.max(0, Math.min(1, value / 100)) : null;
  return (
    <button
      type="button"
      onClick={onTap}
      style={{
        flex: 1, minWidth: 0,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        padding: "10px 4px",
        background: active ? PILLAR_TINT[pillar] : "transparent",
        border: "none", borderRadius: 14,
        cursor: "pointer", transition: "background 300ms ease",
      }}
    >
      <GardenPlant kind={pillar} health={h} size={104} />
      <div style={{
        fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 2,
        textTransform: "uppercase",
        color: has ? (active ? color : "var(--mt)") : "#c79a3a",
        fontWeight: 500,
      }}>{label}</div>
      <div style={{
        fontFamily: "var(--fd)", fontSize: 24, fontWeight: 400,
        color: has ? "var(--fg)" : "var(--mt)",
        letterSpacing: -0.3, lineHeight: 1,
      }}>
        {has ? Math.round(value) : "—"}
      </div>
      <div style={{
        fontFamily: "var(--fb)", fontSize: 11, fontStyle: "italic",
        color: "var(--mt)", textAlign: "center",
        minHeight: 28, lineHeight: 1.4, padding: "0 6px",
      }}>
        {has ? `${signals.length} signal${signals.length === 1 ? "" : "s"}` : "the ring slipped off"}
      </div>
    </button>
  );
}

function UltradianCard({ ultradian, Ha }) {
  // 90-minute cycle split into 4 equal phases. Position marker lives on a
  // single horizontal rail — no noisy sine wave.
  const phases = [
    { key: "ascending", label: "Rising", col: y },
    { key: "peak",      label: "Peak",   col: g },
    { key: "descending",label: "Cooling", col: y },
    { key: "dip",       label: "Dip",    col: r },
  ];
  const cur = phases.find(p => p.key === ultradian.status) || phases[0];
  const pos = Math.max(0, Math.min(1, ultradian.phase)); // 0-1 across cycle
  const whenLabel = ultradian.status === "dip" ? `Next peak in ${ultradian.minutesToPeak} min` : `Dip in ~${ultradian.minutesToDip} min`;
  const tip = ultradian.status === "peak" ? "Good window for your hardest focused work."
    : ultradian.status === "dip" ? "Natural recovery phase. Brief break beats pushing through."
    : ultradian.status === "ascending" ? "Focus is building. Protect the next 20 minutes."
    : "Winding down. Wrap the current task before the dip.";

  return (
    <div className="ca d3" style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--mt)", fontFamily: "var(--fm)", marginBottom: 10 }}>Energy cycle — right now</div>
      <div style={{ background: "var(--cd)", border: "1px solid var(--ln)", borderRadius: 10, padding: 16 }}>
        {/* status pill */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 300, fontFamily: "var(--fd)", color: cur.col }}>{cur.label}</div>
          <div style={{ fontSize: 11, color: "var(--mt)", fontFamily: "var(--fm)" }}>{whenLabel}</div>
        </div>

        {/* phase rail — 4 equal blocks with marker */}
        <div style={{ position: "relative", height: 34, marginBottom: 12 }}>
          <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden" }}>
            {phases.map(p => (
              <div key={p.key} style={{ flex: 1, background: p.col, opacity: p.key === cur.key ? 0.55 : 0.18, borderRight: "1px solid var(--bg)" }} />
            ))}
          </div>
          <div style={{ position: "absolute", left: `calc(${pos * 100}% - 5px)`, top: 0, width: 10, height: 10, borderRadius: "50%", background: "var(--bg)", border: `2px solid ${cur.col}`, boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }} />
          <div style={{ display: "flex", marginTop: 8 }}>
            {phases.map(p => (
              <div key={p.key} style={{ flex: 1, textAlign: "center", fontSize: 9, letterSpacing: 1.2, textTransform: "uppercase", fontFamily: "var(--fm)", color: p.key === cur.key ? p.col : "var(--mt)", fontWeight: p.key === cur.key ? 600 : 400 }}>{p.label}</div>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 12, color: "var(--fg)", lineHeight: 1.6 }}>{tip}</div>
        <div style={{ fontSize: 9, color: "var(--mt)", fontFamily: "var(--fm)", marginTop: 10, opacity: 0.6 }}>
          The brain runs on ~90-minute focus-rest cycles (BRAC · Kleitman 1963). This shows where you are in the current one.
        </div>
      </div>
    </div>
  );
}

function ChronotypeCard({ ctAlign, chronotype }) {
  const ct = CHRONOTYPES[chronotype] || CHRONOTYPES.flexible;
  const phaseColors = { peak: g, shoulder: y, off: "var(--mt)", trough: r };
  return (
    <div className="ca d4" style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--mt)", fontFamily: "var(--fm)", marginBottom: 10 }}>Chronotype Alignment</div>
      <div style={{ background: "var(--cd)", border: "1px solid var(--ln)", borderRadius: 10, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{ct.label}: <span style={{ color: phaseColors[ctAlign.phase] }}>{ctAlign.label}</span></div>
          <div style={{ fontSize: 11, color: "var(--mt)", marginTop: 4 }}>Peak window: {ct.peakStart}:00–{ct.peakEnd}:00</div>
          <div style={{ fontSize: 10, color: "var(--mt)", marginTop: 4, lineHeight: 1.5 }}>
            {ctAlign.phase === "peak" ? "You're in your biological prime — complex work now yields 20–30% more than off-peak (Chronobiology, 2025)." :
             ctAlign.phase === "shoulder" ? "Close to your peak. Good for demanding tasks, but not your absolute best window." :
             "Working against your chronotype. Routine tasks are fine; save complex decisions for your peak."}
          </div>
        </div>
        <div style={{ fontSize: 28, fontWeight: 200, fontFamily: "var(--fd)", color: phaseColors[ctAlign.phase], minWidth: 60, textAlign: "right" }}>{(ctAlign.score * 100).toFixed(0)}%</div>
      </div>
    </div>
  );
}

function SleepPipelineTrace({ biometrics, result, analysis }) {
  const [open, setOpen] = useState(false);

  // 1) Raw localStorage state for the last 7 days
  const days = useMemo(() => {
    let map = {};
    try { const raw = localStorage.getItem(OURA_HISTORY_KEY); if (raw) map = JSON.parse(raw); } catch { /* ignore */ }
    const today = new Date().toISOString().split("T")[0];
    const rows = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(new Date(today).getTime() - i * 86400000).toISOString().split("T")[0];
      const raw = map[d];
      const norm = normalizeSleepEntry(raw);
      rows.push({ date: d, raw, norm });
    }
    return rows;
  }, []);

  const todayKey = new Date().toISOString().split("T")[0];
  const localDate = new Date().toLocaleDateString("en-US");

  // 2) Trace E0's actual computation path
  const e0Trace = (() => {
    const bio = biometrics || {};
    if (typeof bio.sleepScore === "number") return { path: "biometrics.sleepScore", value: bio.sleepScore, unit: "/100" };
    if (typeof bio.manualSleepMin === "number") {
      const s = manualSleepToScore(bio.manualSleepMin, bio.manualSleepQual);
      return { path: "biometrics.manualSleepMin (promoted via manualSleepToScore)", value: s, unit: `/100 (from ${(bio.manualSleepMin/60).toFixed(1)}h)` };
    }
    return { path: "biometrics.manualSleep (1-10 slider FALLBACK — no wearable or manual hours for today)", value: (bio.manualSleep || 7) * 10, unit: "/100 (DEFAULT — sleep data is NOT flowing into E0)" };
  })();

  // 3) HCPI term breakdown — which factor is smallest (biggest drag)?
  const termBreakdown = result ? (() => {
    // Normalize each term to "healthy" baseline for comparison
    const S = analysis?.S ?? 1.5;
    const terms = [
      { key: "S",   label: "Flow (text)",           value: S,                          baseline: 1.5, note: `S=${S.toFixed(2)}`,                                                                        isDivisor: false },
      { key: "E",   label: "Energy E(t)",           value: result.Et,                  baseline: 0.8, note: `E₀=${result.E0.toFixed(2)}, decay=${Math.exp(-result.lambda * result.Ha).toFixed(2)}`,       isDivisor: false },
      { key: "M",   label: "Motivation M(t)",       value: result.M,                   baseline: 0.8, note: `Ψ=${(analysis?.psi ?? 1).toFixed(2)}, μ=${(analysis?.mu ?? 0).toFixed(2)}`,                                  isDivisor: false },
      { key: "R",   label: "Output R(t)",           value: result.R,                   baseline: 0.5, note: `C=${(analysis?.C ?? 1).toFixed(2)} → Ceff=C=${Math.max(1, analysis?.C ?? 1).toFixed(2)} (linear)`, isDivisor: false },
      { key: "CT",  label: "Time of day",           value: result.chronoMod,           baseline: 1.0, note: result.ctAlign.label,                                                                        isDivisor: false },
      // Ultradian removed from the math panel: it no longer multiplies HCPI
      // (see engine.js comment). The phase label still feeds the UltradianCard
      // as a UI hint when shown.
      { key: "A",   label: "Recent strain (÷)",     value: result.recentStrain,        baseline: 1.0, note: "higher = more stress",                                                                      isDivisor: true  },
      { key: "D",   label: "Decay wall (÷)",        value: result.decayWall,           baseline: 1.0, note: result.Ha > 16 ? `awake ${Math.round(result.Ha)}h — past the 16h wall` : `awake ${Math.round(result.Ha)}h — within wall`, isDivisor: true  },
    ];
    // "Drag" = how much this term reduces HCPI vs its baseline.
    // Multiplicands: drag = baseline / value (higher when value is smaller)
    // Divisors:     drag = value / baseline (higher when value is larger)
    terms.forEach(t => {
      t.drag = t.isDivisor ? (t.value / t.baseline) : (t.baseline / Math.max(0.01, t.value));
    });
    terms.sort((a, b) => b.drag - a.drag);
    return terms;
  })() : null;

  return (
    <div className="ca d3" style={{ marginBottom: 20 }}>
      <button type="button" onClick={() => setOpen(v => !v)} style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", padding: 0, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--mt)", fontFamily: "var(--fm)" }}>Sleep Pipeline · Raw Trace</span>
        <span style={{ fontSize: 9, fontFamily: "var(--fm)", color: "var(--ac)", letterSpacing: 1.5 }}>{open ? "HIDE ▴" : "INSPECT ▾"}</span>
      </button>

      {open && (
        <div style={{ marginTop: 10, background: "var(--cd)", border: "1px solid var(--ln)", borderRadius: 10, padding: 14, fontFamily: "var(--fm)", fontSize: 10.5, lineHeight: 1.7, color: "var(--fg)" }}>

          {/* 0) Timezone sanity check */}
          <div style={{ marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid var(--ln)" }}>
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "var(--mt)", marginBottom: 6 }}>0. Date keys</div>
            <div>today (UTC-ISO, used as map key): <strong>{todayKey}</strong></div>
            <div>your local calendar date: <strong>{localDate}</strong></div>
            {todayKey !== new Date().toISOString().split("T")[0] && (
              <div style={{ color: r, marginTop: 4 }}>⚠ timezone drift possible — keys may not match local days</div>
            )}
          </div>

          {/* 1) Last 7 days in localStorage */}
          <div style={{ marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid var(--ln)" }}>
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "var(--mt)", marginBottom: 6 }}>1. Last 7 days in localStorage (OURA_HISTORY_KEY)</div>
            {days.map(row => {
              const hasOura = row.raw?.totalSleepMin != null || row.raw?.sleepScore != null;
              const hasManual = row.raw?.manualSleepMin != null;
              const empty = !hasOura && !hasManual;
              return (
                <div key={row.date} style={{ display: "flex", gap: 8, padding: "3px 0", borderBottom: "1px dashed var(--ln)" }}>
                  <span style={{ width: 82, color: "var(--mt)" }}>{row.date}</span>
                  <span style={{ width: 140 }}>
                    {empty ? <span style={{ color: "var(--mt)", opacity: 0.6 }}>—</span> : (
                      <>
                        {hasOura && <span style={{ color: g }}>Oura</span>}
                        {hasOura && hasManual && <span> + </span>}
                        {hasManual && <span style={{ color: y }}>Manual({(row.raw.manualSleepMin / 60).toFixed(1)}h{row.raw.manualSleepQual != null ? `, q${row.raw.manualSleepQual}` : ""})</span>}
                      </>
                    )}
                  </span>
                  <span style={{ flex: 1, opacity: 0.75 }}>
                    {row.norm?.totalSleepMin != null ? `normalized: total=${(row.norm.totalSleepMin/60).toFixed(1)}h · score=${row.norm.sleepScore ?? "—"}` : <span style={{ opacity: 0.5 }}>no sleep data on record</span>}
                  </span>
                </div>
              );
            })}
          </div>

          {/* 2) Biometrics state (what computeE0 actually sees) */}
          <div style={{ marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid var(--ln)" }}>
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "var(--mt)", marginBottom: 6 }}>2. biometrics state (what computeE0 reads for TODAY)</div>
            <div>sleepScore: <strong>{biometrics?.sleepScore ?? <span style={{ color: y }}>null</span>}</strong></div>
            <div>totalSleepMin: <strong>{biometrics?.totalSleepMin != null ? `${(biometrics.totalSleepMin/60).toFixed(1)}h` : <span style={{ color: y }}>null</span>}</strong></div>
            <div>manualSleepMin: <strong>{biometrics?.manualSleepMin != null ? `${(biometrics.manualSleepMin/60).toFixed(1)}h` : <span style={{ color: "var(--mt)" }}>null</span>}</strong></div>
            <div>manualSleep (1-10 slider): <strong>{biometrics?.manualSleep ?? <span style={{ color: "var(--mt)" }}>null (default 7)</span>}</strong></div>
          </div>

          {/* 3) E0 trace */}
          <div style={{ marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid var(--ln)" }}>
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "var(--mt)", marginBottom: 6 }}>3. E₀ source of truth</div>
            <div>path used: <span style={{ color: e0Trace.path.includes("FALLBACK") ? y : g }}>{e0Trace.path}</span></div>
            <div>sleep input: <strong>{e0Trace.value}{e0Trace.unit}</strong></div>
            {result?.E0 != null && <div>→ final E₀ after HRV/RHR/lifestyle multipliers: <strong>{result.E0.toFixed(3)}</strong></div>}
          </div>

          {/* 4) Which HCPI term is the actual bottleneck? */}
          {termBreakdown && (
            <div>
              <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "var(--mt)", marginBottom: 6 }}>4. Reading term bottleneck — ranked by drag</div>
              {termBreakdown.map((t, i) => (
                <div key={t.key} style={{ display: "flex", gap: 8, padding: "3px 0", color: i === 0 ? r : i === 1 ? y : "var(--fg)" }}>
                  <span style={{ width: 24, opacity: 0.6 }}>#{i + 1}</span>
                  <span style={{ width: 130 }}>{t.label}</span>
                  <span style={{ width: 70 }}>{t.value.toFixed(3)}</span>
                  <span style={{ width: 70, opacity: 0.7 }}>drag ×{t.drag.toFixed(2)}</span>
                  <span style={{ flex: 1, opacity: 0.75 }}>{t.note}</span>
                </div>
              ))}
              <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--bg)", borderRadius: 6, fontFamily: "var(--fb)", fontSize: 12, lineHeight: 1.6 }}>
                Top drag: <strong>{termBreakdown[0].label}</strong>
                {termBreakdown[0].key === "S" || termBreakdown[0].key === "M" || termBreakdown[0].key === "R"
                  ? " — driven by today's journal text, NOT sleep."
                  : termBreakdown[0].key === "E"
                    ? (e0Trace.path.includes("FALLBACK")
                        ? " — because sleep data is NOT in biometrics. Enter sleep for today, or let Oura sync."
                        : " — E₀ is computing from real sleep; the wake-hour decay is the driver.")
                    : termBreakdown[0].key === "A" ? " — allostatic load from multi-day stress in check-ins."
                    : termBreakdown[0].key === "D" ? " — extended wakefulness (>16h awake)."
                    : ""}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LetterEmptyState({ history = [], journalEntries = null }) {
  // Always read journal repo fresh from storage. The parent's repoSnapshot
  // only refreshes on a Patterns-tab visit; without this, a user who writes
  // in the Journal tab and comes back to Analyze would see stale state.
  // Caller can override via prop (used in tests).
  const journal = (() => {
    if (Array.isArray(journalEntries)) return journalEntries;
    try { return loadRepo()?.entries || []; } catch { return []; }
  })();

  // gardenName is set at welcome and stored in localStorage. Personalize the
  // greeting if it's there; gracefully omit if not.
  const gardenName = (() => {
    try {
      const v = localStorage.getItem("cpi_garden_name");
      return v && v.trim() ? v.trim() : null;
    } catch { return null; }
  })();

  const now = new Date();
  const hour = now.getHours();
  const todayKey = ymdISO(now);

  // Time-aware greeting word. "Late" both before 5am and after 9pm.
  const tword =
    hour < 5  ? "Late" :
    hour < 12 ? "Morning" :
    hour < 17 ? "Afternoon" :
    hour < 21 ? "Evening" :
    "Late";

  // Check-ins today (these have full-ISO `date` from new Date().toISOString()).
  const checkinsToday = history.filter(e => stampMatchesDay(e?.date, todayKey));
  // Most recent check-in BEFORE today, used for the echo line.
  const lastCheckinBefore = history.find(e => e?.date && !stampMatchesDay(e.date, todayKey));

  // Journal seeds today — uses both uploadedAt AND date/dateEnd. See helper.
  const journalToday = journal.filter(e => journalEntryCoversDay(e, todayKey));

  const hasCheckinToday = checkinsToday.length > 0;
  const hasJournalToday = journalToday.length > 0;
  const totalEverywhere = (history?.length || 0) + journal.length;
  const isFirst = totalEverywhere === 0;

  // Compose the greeting. Welcome on first run; otherwise time-aware + name.
  const greeting = isFirst ? "Welcome." : `${tword}${gardenName ? `, ${gardenName}` : ""}.`;

  // Subline by state. Pluralization handled per branch.
  const seedWord = (n) => `${n} seed${n === 1 ? "" : "s"}`;
  let subline;
  if (isFirst) {
    subline = "This is your garden. It fills in as you write.";
  } else if (hasCheckinToday && hasJournalToday) {
    subline = `${seedWord(journalToday.length)} planted today, and a reading is in. Tap below to revisit it.`;
  } else if (hasCheckinToday) {
    subline = `Today's reading is in. Plant another seed, or come back tonight.`;
  } else if (hasJournalToday) {
    subline = `${seedWord(journalToday.length)} planted today. Read your day below when you're ready.`;
  } else {
    subline = "Today's bed is fresh.";
  }

  // Echo of last analysis — ONLY shown in the noToday state. We don't echo
  // when the user already wrote today (in either stream) because it would
  // misrepresent their activity (the bug they reported).
  const showEcho = !isFirst && !hasCheckinToday && !hasJournalToday;
  const lastParts = (showEcho && Array.isArray(lastCheckinBefore?.letterParts))
    ? lastCheckinBefore.letterParts.map(p => PARTS_LIB[p?.id]).filter(Boolean).slice(0, 4)
    : [];

  const daysAgo = (showEcho && lastCheckinBefore?.date) ? daysBetween(now, new Date(lastCheckinBefore.date)) : null;
  const lastVisitWhen =
    daysAgo == null ? null :
    daysAgo === 0 ? "earlier today" :
    daysAgo === 1 ? "yesterday" :
    daysAgo === 2 ? "two days ago" :
    daysAgo <= 6 ? `${daysAgo} days ago` :
    "the last time you visited";

  return (
    <div style={ES.frame}>
      <div style={ES.dateline}>
        {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      </div>
      <h2 style={ES.greeting}>{greeting}</h2>
      <div style={ES.subline}>{subline}</div>

      {lastParts.length > 0 && (
        <div style={ES.echo}>
          <span style={ES.echoCap}>{lastVisitWhen} in your garden — </span>
          {lastParts.map((part, i) => (
            <span key={part.id}>
              {i > 0 && <span style={ES.echoSep}> · </span>}
              <span style={{ ...ES.echoGlyph, color: part.color }}>{part.glyph}</span>{" "}
              <span style={ES.echoName}>{part.name}</span>
            </span>
          ))}
        </div>
      )}

      {isFirst && (
        <div style={ES.firstHint}>
          Plant a seed below — a sentence, a voice note, a photo of your handwriting. I read quietly through the day. A letter arrives at your reflect time, or whenever you ask.
        </div>
      )}
    </div>
  );
}

function LlmActivity({ stage }) {
  // Pick once on mount so the glyph stays still during the load.
  const [glyph] = useState(() => pickQuietGlyph());
  // Reflection rotates every 8s in case the analysis takes a while; the
  // initial pick is random so back-to-back loads see different lines.
  const [reflection, setReflection] = useState(() => pickQuietReflection());
  useEffect(() => {
    const id = setInterval(() => setReflection(pickQuietReflection()), 8000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 320, gap: 28, padding: "96px 16px 24px" }}>
      <div
        aria-hidden="true"
        style={{
          // lineHeight 1.3 instead of 1 keeps the top of large italic
          // characters from clipping against the floating status pill
          // above. fontSize stays at 64 so the visual weight is preserved.
          fontFamily: "var(--fd)", fontStyle: "italic",
          fontSize: 64, lineHeight: 1.3, color: "var(--ac)",
          animation: "ori-breathe 4.5s ease-in-out infinite",
          padding: "8px 0",
        }}
      >
        {glyph}
      </div>

      <div
        key={reflection}
        style={{
          fontFamily: "var(--fd)", fontStyle: "italic",
          fontSize: 17, lineHeight: 1.6, color: "var(--fg)",
          textAlign: "center", maxWidth: "26em",
          animation: "ori-fade 700ms ease-out",
        }}
      >
        {reflection}
      </div>

      <style>{`
        @keyframes ori-breathe {
          0%   { opacity: 0.55; transform: scale(1); }
          50%  { opacity: 1;    transform: scale(1.04); }
          100% { opacity: 0.55; transform: scale(1); }
        }
        @keyframes ori-fade {
          0% { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function LlmFloatingPill({ stage, visible }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!visible || !stage?.startedAt) return;
    setElapsed(Math.floor((Date.now() - stage.startedAt) / 1000));
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - stage.startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [visible, stage?.startedAt]);
  if (!visible) return null;
  return (
    <div style={{
      position: "fixed", top: "calc(12px + env(safe-area-inset-top, 0px))", left: "50%", transform: "translateX(-50%)", zIndex: 9999,
      display: "flex", alignItems: "center", gap: 8,
      padding: "6px 14px", background: "var(--fg)", color: "var(--bg)",
      borderRadius: 999, boxShadow: "0 4px 18px rgba(0,0,0,0.18)",
      fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 1.2,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ac)", animation: "cbr 1.2s ease-in-out infinite" }} />
      <span>{stage?.label || "Analyzing"} · {elapsed}s</span>
    </div>
  );
}

// SignalCard — the Letter view BaroMeter.
//
// Shows today's WHO-5 wellbeing score on the published Topp 2015
// 0–100 scale (≤28 Low · 29–50 Below · 51–72 Typical · ≥73 Optimal).
//
// HCPI retired from this surface in PR #3 of the layered-honesty
// plan: the engine still computes it (engine.js) and feeds the LLM
// prompt that generates the Letter narrative, but it no longer
// renders as a user-visible number with cognitive-performance
// framing. The h/a/biometrics/history props are still threaded so
// PR #8 can re-introduce a WHO-5-anchored "Why this reading" block
// without another rewrite of the wrapper.
function SignalCard({ h, a /*, biometrics, history */ }) {
  const decisionCount = a?.decisionCount || 0;
  const [who5State, setWho5State] = useState(() => ({
    today: todayWho5(),
    recent: recentWho5(14),
  }));
  const [showIntake, setShowIntake] = useState(false);
  useEffect(() => {
    const refresh = () => setWho5State({ today: todayWho5(), recent: recentWho5(14) });
    window.addEventListener("cpi:who5-updated", refresh);
    return () => window.removeEventListener("cpi:who5-updated", refresh);
  }, []);

  const { today, recent } = who5State;
  const score = today?.score ?? null;
  const band = score != null ? who5BandFor(score) : null;
  const calibrated = score != null;

  // Topp 2015 published bands across 0–100. Color escalates warm→cool
  // so the meter reads at a glance: red for low, green for optimal.
  const TOPP_BANDS = [
    { key: "low",     label: "Low",     from: 0,  to: 28,  color: "#a63d40" },
    { key: "below",   label: "Below",   from: 29, to: 50,  color: "#c0612b" },
    { key: "typical", label: "Typical", from: 51, to: 72,  color: "#4a7c59" },
    { key: "optimal", label: "Optimal", from: 73, to: 100, color: "#2d6a4f" },
  ];
  const markerBand = band ? TOPP_BANDS.find((b) => b.key === band.key) : null;
  const markerColor = markerBand?.color || "var(--mt)";

  // Weekly summary — mean, stability, trend across last 14 days of
  // WHO-5 entries (skips days without data). Needs ≥3 entries.
  let weekly = null;
  if (recent.length >= 3) {
    const vals = recent.map((e) => e.score);
    const n = vals.length;
    const mean = vals.reduce((s, v) => s + v, 0) / n;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    // Linear-fit slope = cov / var(x). Points per day.
    const xmean = (n - 1) / 2;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xmean) * (vals[i] - mean);
      den += (i - xmean) ** 2;
    }
    const slope = den > 0 ? num / den : 0;
    // Stability: 1 − SD/25. SD of 25 ≈ flat 0 stability.
    const stability = Math.max(0, Math.min(1, 1 - std / 25));
    weekly = {
      avg: Math.round(mean),
      stability,
      trend: Math.round(slope),
      dayCount: n,
    };
  }

  return (
    <div className="ca d1" style={{ padding: "28px 22px 22px", textAlign: "left" }}>
      <div style={{ fontSize: 10, letterSpacing: 6, textTransform: "uppercase", color: "var(--mt)", fontFamily: "var(--fm)", marginBottom: 14, textAlign: "center" }}>
        Today's wellbeing
      </div>

      {calibrated ? (
        <>
          {/* Hero row: big number left, band label + context right */}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, marginBottom: 16 }}>
            <div style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontWeight: 300, fontSize: 64, color: markerColor, lineHeight: 1, letterSpacing: -2 }}>
              {score}
              <span style={{ fontFamily: "var(--fm)", fontStyle: "normal", fontSize: 14, letterSpacing: 2, color: "var(--mt)", marginLeft: 6 }}>/ 100</span>
            </div>
            <div style={{ textAlign: "right", flex: 1, minWidth: 0 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: markerColor, boxShadow: `0 0 0 3px ${markerColor}20` }} />
                <span style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontWeight: 400, fontSize: 18, color: markerColor, letterSpacing: 0.1, whiteSpace: "nowrap" }}>
                  {band?.label}
                </span>
              </div>
              <div style={{ fontSize: 10, color: "var(--mt)", fontFamily: "var(--fm)", marginTop: 4, letterSpacing: 0.5, opacity: 0.75 }}>
                Hour {Math.round(h.Ha)}{decisionCount > 0 ? ` · ${decisionCount} decisions` : ""}
              </div>
            </div>
          </div>

          {/* BaroMeter — 4 Topp bands, marker at WHO-5 score */}
          <div style={{ position: "relative", height: 10, display: "flex", border: `1px solid var(--ln)`, borderRadius: 2, overflow: "hidden", marginBottom: 6 }}>
            {TOPP_BANDS.map((b) => {
              const widthPct = ((b.to - b.from + 1) / 101) * 100;
              return (
                <div key={b.key} style={{ flex: `0 0 ${widthPct}%`, background: b.color, opacity: 0.2 }} />
              );
            })}
            <div style={{ position: "absolute", left: `${score}%`, top: -4, bottom: -4, width: 2, background: markerColor, transform: "translateX(-1px)" }} />
            <div style={{ position: "absolute", left: `${score}%`, top: -6, transform: "translate(-50%, -100%)", width: 10, height: 10, borderRadius: "50%", background: markerColor, boxShadow: `0 0 0 3px var(--bg)` }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--fm)", fontSize: 8, letterSpacing: 1.5, color: "var(--mt)", opacity: 0.7, marginBottom: 16 }}>
            {TOPP_BANDS.map((b) => <span key={b.key}>{b.label}</span>)}
          </div>

          {/* Weekly summary across recent WHO-5 entries */}
          {weekly && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, paddingTop: 14, borderTop: `1px solid var(--ln)` }}>
              {[
                {
                  v: String(weekly.avg),
                  l: `${weekly.dayCount}-day avg`,
                  c: weekly.avg >= 73 ? g : weekly.avg >= 51 ? "var(--fg)" : weekly.avg >= 29 ? y : r,
                },
                {
                  v: `${Math.round(weekly.stability * 100)}%`,
                  l: "Stability",
                  c: weekly.stability > 0.7 ? g : weekly.stability > 0.5 ? y : r,
                },
                {
                  v: weekly.trend > 1 ? `+${weekly.trend}`
                    : weekly.trend < -1 ? `${weekly.trend}`
                    : "=",
                  l: "Trend",
                  c: weekly.trend > 1 ? g : weekly.trend < -1 ? r : "var(--mt)",
                },
              ].map((s, i) => (
                <div key={i} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 20, color: s.c, lineHeight: 1 }}>{s.v}</div>
                  <div style={{ fontFamily: "var(--fm)", fontSize: 8, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--mt)", marginTop: 4 }}>{s.l}</div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
          <div style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontWeight: 300, fontSize: 36, color: "var(--mt)", lineHeight: 1, marginBottom: 14, letterSpacing: -1 }}>—</div>
          <div style={{ fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 14, color: "var(--mt)", lineHeight: 1.6, maxWidth: "26em", margin: "0 auto 14px" }}>
            Five quick ones from your day, and Ori can read where you sit. Takes about thirty seconds.
          </div>
          <button
            type="button"
            onClick={() => setShowIntake(true)}
            style={{
              background: "var(--fg)", color: "var(--bg)",
              border: "none", borderRadius: 999,
              padding: "9px 20px",
              fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 2, textTransform: "uppercase",
              cursor: "pointer",
            }}
          >Log check-in</button>
        </div>
      )}

      {showIntake && (
        <Who5Intake
          onClose={() => setShowIntake(false)}
          onSubmit={() => setShowIntake(false)}
        />
      )}
    </div>
  );
}

function PillarDetail({ pillar, rings, trends, history, checkin, onClose, onGoPlumbing }) {
  const color = PILLAR_COLOR[pillar];
  const labels = { body: "Body", mind: "Mind", mood: "Mood" };
  const subtitles = {
    body: "Sleep · Readiness · Activity",
    mind: "Alertness · Reaction · Nervous system",
    mood: "Body stress vs felt stress · Journal tone",
  };
  const cur = rings[pillar];
  const [historyMap, setHistoryMap] = useState({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(OURA_HISTORY_KEY);
      if (raw) setHistoryMap(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);
  const week = sevenDayPillarTrend(pillar, historyMap, history, checkin);
  const weekValid = week.filter(d => d.value != null);
  const weekAvg = weekValid.length ? weekValid.reduce((s, d) => s + d.value, 0) / weekValid.length : null;
  const delta = (weekAvg != null && cur.value != null) ? cur.value - weekAvg : null;

  const actions = pillarActions(pillar);

  return (
    <div style={{ background: "var(--sf)", border: `1px solid var(--ln)`, borderTop: `3px solid ${color}`, borderRadius: 14, padding: 20, marginBottom: 24, boxShadow: "0 2px 18px rgba(45,42,36,0.04)" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color, fontFamily: "var(--fm)", fontWeight: 600 }}>{labels[pillar]}</div>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 10, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer" }}>Close</button>
      </div>
      <div style={{ fontSize: 11, color: "var(--mt)", fontFamily: "var(--fm)", marginBottom: 14 }}>{subtitles[pillar]}</div>

      {/* Score row */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 44, fontWeight: 200, fontFamily: "var(--fd)", color: "var(--fg)", letterSpacing: -1.5, lineHeight: 1 }}>
          {cur.value != null ? Math.round(cur.value) : "—"}
        </div>
        <div style={{ fontSize: 11, color: "var(--mt)", fontFamily: "var(--fm)" }}>of 100</div>
        {delta != null && (
          <div style={{ marginLeft: "auto", fontSize: 11, color: Math.abs(delta) < 3 ? "var(--mt)" : delta > 0 ? g : r, fontFamily: "var(--fm)" }}>
            {delta > 0 ? "+" : ""}{delta.toFixed(1)} vs 7-day
          </div>
        )}
      </div>

      {/* Mood-only: Body vs Felt stress divergence callout */}
      {pillar === "mood" && (() => {
        const bodySig = cur.signals.find(s => s.key === "stress");
        const feltSig = cur.signals.find(s => s.key === "pss4");
        if (!bodySig || !feltSig) return null;
        const body = bodySig.value;  // higher = calmer body
        const felt = feltSig.value;  // higher = calmer self-report
        const gap = body - felt;     // positive = body calmer than person feels
        const absGap = Math.abs(gap);
        let callout = null;
        if (absGap < 20) {
          callout = { tone: "aligned", title: "Body and feelings agree", line: "What you feel matches what your nervous system is showing." };
        } else if (gap < 0) {
          // body > felt as stress? wait — values are inverted so lower body = more stress
          // If body value < felt value: body is MORE stressed than person reports
          callout = { tone: "bodyHigh", title: "Your body is grinding more than you feel it", line: "Chronic load can normalise — easy to miss. Consider a slower evening." };
        } else {
          // gap > 0: body calmer than felt → something specific is on your mind
          callout = { tone: "feltHigh", title: "You feel more stressed than your body is carrying", line: "Usually means something specific is looping — not ambient load. Naming it often helps." };
        }
        const bg = callout.tone === "aligned" ? "var(--bg)" : PILLAR_TINT.mood;
        const accent = callout.tone === "aligned" ? g : color;
        return (
          <div style={{ padding: "12px 14px", background: bg, border: `1px solid var(--ln)`, borderLeft: `3px solid ${accent}`, borderRadius: 8, marginBottom: 16 }}>
            <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: accent, fontFamily: "var(--fm)", fontWeight: 600, marginBottom: 6 }}>{callout.title}</div>
            <div style={{ fontSize: 12, color: "var(--fg)", lineHeight: 1.55, marginBottom: 8 }}>{callout.line}</div>
            <div style={{ display: "flex", gap: 14, fontSize: 10, fontFamily: "var(--fm)", color: "var(--mt)" }}>
              <span><span style={{ color: "var(--fg)", fontWeight: 500 }}>Body {Math.round(body)}</span> <span style={{ opacity: 0.6 }}>(Oura)</span></span>
              <span><span style={{ color: "var(--fg)", fontWeight: 500 }}>Felt {Math.round(felt)}</span> <span style={{ opacity: 0.6 }}>(you)</span></span>
              <span style={{ marginLeft: "auto" }}>gap {Math.round(absGap)}</span>
            </div>
          </div>
        );
      })()}

      {/* Sparkline */}
      <div style={{ marginBottom: 20, padding: "10px 6px", background: PILLAR_TINT[pillar], borderRadius: 10 }}>
        <Sparkline days={week} color={color} />
      </div>

      {/* Signals */}
      <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "var(--mt)", fontFamily: "var(--fm)", marginBottom: 10 }}>Today's signals</div>
      {cur.signals.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--mt)", lineHeight: 1.7, padding: "4px 0 16px" }}>
          No signals for {labels[pillar].toLowerCase()} yet. Use an action below to start measuring.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          {cur.signals.map((s) => {
            const tag = sourceTag(s.source);
            const valCol = s.value >= 75 ? g : s.value >= 50 ? "var(--fg)" : s.value >= 30 ? y : r;
            return (
              <div key={s.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--bg)", border: "1px solid var(--ln)", borderRadius: 8 }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--fg)", fontFamily: "var(--fb)" }}>{s.label}</div>
                  <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: tag.color, fontFamily: "var(--fm)", marginTop: 2 }}>{tag.text}</div>
                </div>
                <div style={{ fontFamily: "var(--fm)", color: valCol, fontSize: 15, fontWeight: 500 }}>{Math.round(s.value)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "var(--mt)", fontFamily: "var(--fm)", marginBottom: 10 }}>What you can do now</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {actions.map((a, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onGoPlumbing && onGoPlumbing(a.target, a.open)}
            style={{ textAlign: "left", padding: "12px 14px", background: "var(--bg)", border: "1px solid var(--ln)", borderRadius: 8, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "var(--fb)", transition: "background 200ms" }}
            onMouseOver={(e) => e.currentTarget.style.background = PILLAR_TINT[pillar]}
            onMouseOut={(e) => e.currentTarget.style.background = "var(--bg)"}
          >
            <div>
              <div style={{ fontSize: 13, color: "var(--fg)" }}>{a.label}</div>
              <div style={{ fontSize: 10, color: "var(--mt)", fontFamily: "var(--fm)", marginTop: 2 }}>{a.hint}</div>
            </div>
            <span style={{ fontSize: 12, color }}>→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TodayGlance({ biometrics, lifestyle, trends, checkin, history, onGoPlumbing, mode = "full" }) {
  const [active, setActive] = useState(null);
  const [coach, setCoach] = useState(() => loadCoachCache()?.text || null);

  const rings = computeDailyRings(biometrics, lifestyle, trends, checkin, history, { mode });
  const bodyContext = formatBodyContext(trends, biometrics, lifestyle, { mode });

  // When biometric history is cleared elsewhere, drop cached coach line.
  useEffect(() => {
    const onCleared = () => {
      const cached = loadCoachCache();
      setCoach(cached?.text || null);
    };
    window.addEventListener("cpi:wearable-synced", onCleared);
    return () => window.removeEventListener("cpi:wearable-synced", onCleared);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sig = ringSignature(rings);
    const cached = loadCoachCache();
    if (cached?.signature === sig && cached.text) { setCoach(cached.text); return; }
    (async () => {
      const text = await generateCoachLine(rings, bodyContext);
      if (!cancelled && text) setCoach(text);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rings.body.value, rings.mind.value, rings.mood.value]);

  const toggle = (k) => setActive(active === k ? null : k);
  const total = rings.body.signals.length + rings.mind.signals.length + rings.mood.signals.length;

  return (
    <div className="ca" style={{ marginBottom: 28 }}>
      {coach && !active && (
        <div style={{ padding: "0 4px 18px", display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ fontFamily: "var(--fm)", fontSize: 8, letterSpacing: 2, textTransform: "uppercase", color: "var(--ac)", paddingTop: 5, flexShrink: 0 }}>Ori</div>
          <div style={{ fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 14, lineHeight: 1.6, color: "var(--fg)", textWrap: "pretty" }}>{coach}</div>
        </div>
      )}

      {!coach && !active && total === 0 && (
        <div style={{ padding: "0 4px 18px", textAlign: "center" }}>
          <div style={{ fontFamily: "var(--fd)", fontSize: 18, fontStyle: "italic", color: "var(--fg)", lineHeight: 1.4, letterSpacing: -0.2 }}>A quiet garden.</div>
          <div style={{ fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.8, textTransform: "uppercase", color: "var(--mt)", marginTop: 6 }}>Water a plant to begin</div>
        </div>
      )}

      <div style={{ background: "var(--sf)", border: "1px solid var(--ln)", borderRadius: 18, padding: "22px 12px 14px" }}>
        <div style={{ display: "flex", gap: 4, alignItems: "flex-end" }}>
          <GardenPot pillar="body" label="Body" data={rings.body} active={active === "body"} onTap={() => toggle("body")} />
          <GardenPot pillar="mind" label="Mind" data={rings.mind} active={active === "mind"} onTap={() => toggle("mind")} />
          <GardenPot pillar="mood" label="Mood" data={rings.mood} active={active === "mood"} onTap={() => toggle("mood")} />
        </div>
        <div style={{ height: 1, background: "var(--ln)", margin: "8px 8px 0", opacity: 0.5 }} />
        <div style={{ textAlign: "center", fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.5, color: "var(--mt)", marginTop: 10, opacity: 0.8 }}>
          ~ your garden today ~
        </div>
      </div>

      {active && (
        <div style={{ marginTop: 18 }}>
          <PillarDetail
            pillar={active}
            rings={rings}
            trends={trends}
            history={history}
            checkin={checkin}
            onClose={() => setActive(null)}
            onGoPlumbing={onGoPlumbing}
          />
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  V5 SIMPLIFIED ANALYZE COMPONENTS  (added 2026-05-11)
//
//  These render the journaling-first version of the Analyze tab.
//  CPI.jsx switches between the legacy components above and these
//  based on the `cpi:analyze-v5` localStorage flag (default ON).
//
//  Voice rules: consumer-friendly, never clinical. No abbreviations
//  (HRV / NLP / BRAC / chronotype). Numbers always paired with meaning.
//  One educative beat per block, never a paragraph.
// ════════════════════════════════════════════════════════════════════

const V5_PAL = {
  leaf:   "#3F5B39",
  moss:   "#4F8A5F",
  sage:   "#A3B88A",
  bloom:  "#C98660",
  sepia:  "#705B3C",
  warn:   "#C4902A",
  alert:  "#B0553A",
  ink:    "var(--fg)",
  soft:   "var(--fg)",
  // muted + faint are text colors. Earlier they reused border tokens
  // (var(--mt) and var(--ln)) — `faint` resolved to a 9% opacity grey
  // which is unreadable, and `muted` was borderline at ~3:1 contrast.
  // Darkened to readable warm-grey values so small labels stay legible.
  muted:  "#5F5A52",   // ~6.5:1 contrast on cream — primary muted text
  faint:  "#7D7670",   // ~4:1 contrast on cream — tiny labels / day strips
  card:   "var(--sf)",
  // `hair` is a border/separator only — kept light by design.
  hair:   "var(--ln)",
};

// ── Helper: format sleep duration into "6h 12m" string ───────────────
function formatSleepMin(min) {
  if (!min || min < 30) return null;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${m}m`;
}

// ── Helper: a typical-sleep target (uses 7h as a safe default) ───────
function typicalSleepHours() { return 7; }

// ─────────────────────────────────────────────────────────────────────
//  GreetingHeaderV5 — dateline + greeting + "Begin when ready"
//  Replaces LetterEmptyState in the v5 layout. Smaller, calmer.
// ─────────────────────────────────────────────────────────────────────
function GreetingHeaderV5({ history }) {
  const name = (() => {
    try { return localStorage.getItem("cpi_garden_name") || ""; } catch { return ""; }
  })();
  const now = new Date();
  const h = now.getHours();
  const greeting = h < 5 ? "Late night" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : h < 22 ? "Evening" : "Late night";
  const dateline = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const timestr  = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 2.4,
        textTransform: "uppercase", color: V5_PAL.faint,
      }}>{dateline} · {timestr}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, marginTop: 6 }}>
        <h2 style={{
          fontFamily: "var(--fd)", fontStyle: "italic", fontWeight: 300,
          fontSize: 30, lineHeight: 1.15, letterSpacing: -0.4,
          color: V5_PAL.ink, margin: 0,
        }}>
          {greeting}{name ? `, ${name}.` : "."}
        </h2>
        <div style={{
          fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 13,
          color: V5_PAL.moss, lineHeight: 1.4, textAlign: "right", flexShrink: 0,
        }}>
          Begin when ready.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  BodyContextLineV5 — green-bordered card with sleep + recovery + window
//  Pulls from biometrics, history, chronotype. Hides if there's nothing
//  honest to say.
// ─────────────────────────────────────────────────────────────────────
function BodyContextLineV5({ biometrics, lifestyle, history, chronotype }) {
  const sleepMin = biometrics?.totalSleepMin || biometrics?.manualSleepMin || 0;
  const sleepStr = formatSleepMin(sleepMin);
  const sleepH   = sleepMin / 60;
  const typical  = typicalSleepHours();
  const sleepDelta = sleepStr ? (
    Math.abs(sleepH - typical) < 0.4 ? "right at your usual" :
    sleepH < typical ? `about ${Math.round(typical - sleepH)}h short of your usual` :
    `more than your usual ${typical}h`
  ) : null;

  const hrv = biometrics?.hrv;
  const recoveryState = hrv == null ? null :
    hrv >= 50 ? "looks steady" :
    hrv >= 35 ? "is a bit below your usual" :
    "is running low today";

  const ct = CHRONOTYPES[chronotype] || CHRONOTYPES.flexible;
  const nowH = new Date().getHours() + new Date().getMinutes() / 60;
  const peakStart = ct.peakStart;
  const peakEnd   = ct.peakEnd;
  const peakLabel = peakStart < 12 ? `around ${peakStart}am` : `around ${peakStart - 12}pm`;
  const chronoFraming =
    nowH < peakStart - 0.5 ? `you're ${Math.round(peakStart - nowH)}h before your sharpest window`
    : nowH < peakEnd ? `you're in your sharpest window`
    : `you're past your sharpest window`;

  if (!sleepStr && hrv == null) return null;

  return (
    <div style={{
      margin: "0 0 18px",
      padding: "14px 16px",
      background: "linear-gradient(180deg, rgba(79,138,95,0.06), rgba(79,138,95,0))",
      borderLeft: `2px solid rgba(79,138,95,0.4)`,
      borderRadius: "0 12px 12px 0",
      fontFamily: "var(--fb)", fontSize: 13.5, lineHeight: 1.65,
      color: V5_PAL.ink, fontStyle: "italic",
    }}>
      {sleepStr && (
        <>You slept <b style={{ color: V5_PAL.leaf, fontStyle: "normal", fontWeight: 500 }}>{sleepStr}</b> last night — {sleepDelta}. </>
      )}
      {recoveryState && (
        <>Your body's recovery {recoveryState}. </>
      )}
      And <b style={{ color: V5_PAL.leaf, fontStyle: "normal", fontWeight: 500 }}>{chronoFraming}</b> — yours opens {peakLabel}.
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  ReadingCardV5 — small pinned card showing reading status
//  Replaces the legacy TodaysReadingCard with a calmer 2-state design.
// ─────────────────────────────────────────────────────────────────────
function ReadingCardV5({ seedsToday, reflectTime, hasReadingToday, ready, onOpenLetter, onReadNow }) {
  const fmtTime = (raw) => {
    if (!raw) return "9:00pm";
    const m = String(raw).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return "9:00pm";
    let hh = Number(m[1]); const mm = m[2];
    const sfx = hh >= 12 ? "pm" : "am";
    hh = hh % 12; if (hh === 0) hh = 12;
    return `${hh}:${mm}${sfx}`;
  };
  const pretty = fmtTime(reflectTime);

  const isReady   = ready === true;
  const isDone    = hasReadingToday === true;
  const tap = isReady ? onReadNow : (isDone ? onOpenLetter : null);

  return (
    <div
      role={tap ? "button" : undefined}
      tabIndex={tap ? 0 : undefined}
      onClick={tap || undefined}
      onKeyDown={tap ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(); } } : undefined}
      style={{
        margin: "0 0 18px",
        padding: "14px 16px",
        background: isReady ? "linear-gradient(180deg, rgba(79,138,95,0.08), rgba(79,138,95,0))" : V5_PAL.card,
        border: `1px solid ${isReady ? "rgba(79,138,95,0.30)" : V5_PAL.hair}`,
        borderRadius: 14,
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
        cursor: tap ? "pointer" : "default",
        transition: "background .2s, border-color .2s",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.8,
          textTransform: "uppercase", color: V5_PAL.muted, marginBottom: 4,
        }}>
          {isDone ? "Today's reading" : "Tonight's reading"}
        </div>
        <div style={{
          fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 17,
          color: isReady ? V5_PAL.leaf : V5_PAL.ink,
        }}>
          {isDone ? "Read it again ›" : isReady ? "Ready now — tap to read" : `Ready at ${pretty}`}
        </div>
        {!isDone && (
          <div style={{
            marginTop: 2,
            fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 12,
            color: V5_PAL.muted, lineHeight: 1.4,
          }}>
            {seedsToday > 0
              ? `${seedsToday} line${seedsToday === 1 ? "" : "s"} saved so far · Ori reads them all back to you`
              : "Plant a line below and Ori reads them all back to you tonight"}
          </div>
        )}
      </div>
      <div style={{
        width: 38, height: 38, borderRadius: "50%",
        background: isReady ? V5_PAL.leaf : "rgba(79,138,95,0.10)",
        border: `1px solid ${isReady ? V5_PAL.leaf : "rgba(79,138,95,0.22)"}`,
        color: isReady ? "var(--bg)" : V5_PAL.leaf,
        display: "grid", placeItems: "center",
        fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 15,
        flexShrink: 0,
      }}>✱</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  ReservesTileV5 — single-band gradient (replaces SignalCard barometer)
//  Shows tier label + a comparison-to-usual + a soft 1-band gradient
//  with a position marker. No EMRG/IMP/MOD/OK/PEAK labels.
// ─────────────────────────────────────────────────────────────────────
function ReservesTileV5(/* h, history are no longer used; kept callable
  with the legacy signature so we don't have to touch every callsite */) {
  // PR #8: ReservesTileV5 reads today's WHO-5 score (Topp 2015 bands)
  // instead of h.HCPI. The four tile labels (Low tide / Drifting /
  // Steady / Peak) stay — they're interpretive metaphor on top of a
  // validated wellbeing reading, not a measurement claim themselves.
  const [who5State, setWho5State] = useState(() => ({
    today: todayWho5(),
    recent: recentWho5(14),
  }));
  useEffect(() => {
    const refresh = () => setWho5State({ today: todayWho5(), recent: recentWho5(14) });
    window.addEventListener("cpi:who5-updated", refresh);
    return () => window.removeEventListener("cpi:who5-updated", refresh);
  }, []);
  const score = who5State.today?.score ?? null;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const tier = score == null
    ? { label: "Pending",  color: V5_PAL.muted, blurb: "Log today's daily check-in to fill in this read." }
    : score <= 28 ? { label: "Low tide", color: V5_PAL.alert, blurb: "Reserves are thin — they'll come back." }
    : score <= 50 ? { label: "Drifting", color: V5_PAL.warn,  blurb: "Reserves are below your usual." }
    : score <= 72 ? { label: "Steady",   color: V5_PAL.sage,  blurb: "Reserves are right around your usual." }
                  : { label: "Peak",     color: V5_PAL.leaf,  blurb: "Reserves are full — a strong window." };

  // Comparison to "your usual" — median WHO-5 from last 14 days if
  // we have at least 3 logged days.
  const avg = (() => {
    if (who5State.recent.length < 3) return null;
    const sorted = who5State.recent.map((e) => e.score).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  })();
  const usualLabel = avg == null ? null :
    avg <= 28 ? "Low tide" : avg <= 50 ? "Drifting" : avg <= 72 ? "Steady" : "Peak";

  return (
    <div style={{
      margin: "0 0 22px",
      padding: "18px 20px 16px",
      background: V5_PAL.card,
      border: `1px solid ${V5_PAL.hair}`,
      borderRadius: 18,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14 }}>
        <span style={{
          fontFamily: "var(--fm)", fontSize: 9.5, letterSpacing: 2,
          textTransform: "uppercase", color: V5_PAL.muted,
        }}>Reserves today</span>
        <span style={{
          fontFamily: "var(--fd)", fontStyle: "italic", fontWeight: 300,
          fontSize: 22, color: tier.color, lineHeight: 1,
        }}>
          <span style={{
            display: "inline-block", width: 7, height: 7, borderRadius: "50%",
            background: tier.color, marginRight: 6, verticalAlign: "middle",
          }}/>
          {tier.label}
        </span>
      </div>
      <div style={{
        marginTop: 8,
        fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 13.5,
        color: V5_PAL.muted, lineHeight: 1.55,
      }}>
        {tier.blurb}
        {usualLabel && usualLabel !== tier.label && (
          <> Your usual is closer to <b style={{ color: V5_PAL.ink, fontStyle: "normal", fontWeight: 500 }}>{usualLabel}</b>.</>
        )}
      </div>
      <div style={{
        marginTop: 14, position: "relative",
        height: 8, borderRadius: 999,
        background: "linear-gradient(90deg, rgba(176,85,58,0.35) 0%, rgba(196,144,42,0.30) 35%, rgba(163,184,138,0.30) 65%, rgba(79,138,95,0.45) 100%)",
      }}>
        <div style={{
          position: "absolute", top: -4, bottom: -4,
          left: `${Math.max(2, Math.min(98, pct))}%`,
          width: 3, borderRadius: 2,
          background: "var(--fg)",
          boxShadow: `0 0 0 3px ${V5_PAL.card}`,
        }}/>
      </div>
      <div style={{
        marginTop: 8, display: "flex", justifyContent: "space-between",
        fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.4,
        textTransform: "uppercase", color: V5_PAL.faint,
      }}>
        <span>Thin</span><span>Full</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  MiniPotsRowV5 — Body / Mind / Mood data tiles, Apple Health discipline.
//
//  Design notes (v5.1 — 2026-05-12):
//   · Data-confident composition: big numeric hero, no decorative ring.
//   · Comparison-to-your-usual on the face — "Your usual is 84".
//   · Trend curve with subtle gradient fill (Apple Health Summary tile
//     pattern). Faint horizontal baseline shows "your usual" line.
//   · Tap a tile → drawer slides open below the row with a fuller
//     chart, a one-sentence insight, and contributor rows with sources.
//   · No italic feeling words. The data carries the meaning.
// ─────────────────────────────────────────────────────────────────────
//
// Compute the median of valid values across the last N days for one
// pillar — used as the "your usual" anchor.
function pillarUsual(trend) {
  const vals = trend.map(d => d.value).filter(v => v != null).sort((a, b) => a - b);
  if (vals.length === 0) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
}

function MiniPotsRowV5({ biometrics, lifestyle, trends, checkin, history, setBiometrics, onSyncOura, ouraToken, mode = "full" }) {
  const [active, setActive] = useState(null);
  const rings = computeDailyRings(biometrics, lifestyle, trends, checkin, history, { mode });

  // Pull the raw Oura history map for sparklines (date-keyed).
  const historyMap = (() => {
    try { return JSON.parse(localStorage.getItem(OURA_HISTORY_KEY) || "{}"); } catch { return {}; }
  })();

  const items = [
    { key: "body", label: "Body", data: rings.body, color: V5_PAL.warn },
    { key: "mind", label: "Mind", data: rings.mind, color: V5_PAL.leaf },
    { key: "mood", label: "Mood", data: rings.mood, color: V5_PAL.bloom },
  ];

  const toggle = (k) => setActive(active === k ? null : k);

  return (
    <div style={{ margin: "0 0 22px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {items.map(item => {
          const isActive = active === item.key;
          const trend = sevenDayPillarTrend(item.key, historyMap, history, checkin);
          const usual = pillarUsual(trend);
          const has = item.data.value != null;
          const today = has ? Math.round(item.data.value) : null;
          const delta = (today != null && usual != null) ? today - Math.round(usual) : null;

          return (
            <button
              key={item.key} type="button"
              onClick={() => toggle(item.key)}
              style={{
                background: isActive ? hexToRgba(item.color, 0.05) : "#FFFCF6",
                border: `1px solid ${isActive ? item.color : "rgba(45,42,36,0.18)"}`,
                boxShadow: isActive ? `0 0 0 3px ${hexToRgba(item.color, 0.10)}` : "none",
                borderRadius: 18, padding: "14px 14px 12px",
                textAlign: "left", cursor: "pointer",
                display: "flex", flexDirection: "column",
                transition: "border-color .18s ease, box-shadow .18s ease, background .18s ease",
              }}
            >
              {/* Title row — dark ink + colored dot for pot identity */}
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: item.color, flexShrink: 0,
                }}/>
                <span style={{
                  fontFamily: "var(--fm)", fontSize: 10.5, letterSpacing: 1.6,
                  textTransform: "uppercase", color: "#2B2824", fontWeight: 600,
                }}>{item.label}</span>
              </div>

              {/* Hero stat — number OR empty CTA */}
              {has ? (
                <>
                  <div style={{
                    fontFamily: "var(--fd)", fontStyle: "italic", fontWeight: 300,
                    fontSize: 38, lineHeight: 1, letterSpacing: -1,
                    color: "#1a1a1a", marginTop: 10,
                  }}>{today}</div>
                  <div style={{
                    fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 0.2,
                    color: "#6F695E", marginTop: 4, lineHeight: 1.3,
                    minHeight: 13,
                  }}>
                    {usual == null ? "first reading" :
                     delta === 0 ? "right at your usual" :
                     delta > 0 ? `+${delta} from your usual` :
                     `${delta} from your usual`}
                  </div>
                </>
              ) : (
                <>
                  <div style={{
                    fontFamily: "var(--fd)", fontStyle: "italic", fontWeight: 300,
                    fontSize: 22, lineHeight: 1.1, letterSpacing: -0.4,
                    color: "#958E84", marginTop: 14,
                  }}>No data</div>
                  <div style={{
                    fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 0.4,
                    color: item.color, marginTop: 4, lineHeight: 1.3,
                    minHeight: 13, fontWeight: 600,
                  }}>Tap to log →</div>
                </>
              )}

              {/* Trend curve — gradient fill, Apple Health style */}
              <div style={{ marginTop: 10, height: 30 }}>
                <TrendCurveV5 trend={trend} color={item.color} usual={usual} active={isActive} />
              </div>
            </button>
          );
        })}
      </div>

      {/* Expanded drawer for the active pot */}
      {active && (
        <PotDetailV5
          pillar={active}
          ring={rings[active]}
          color={items.find(i => i.key === active).color}
          trend={sevenDayPillarTrend(active, historyMap, history, checkin)}
          usual={pillarUsual(sevenDayPillarTrend(active, historyMap, history, checkin))}
          biometrics={biometrics}
          setBiometrics={setBiometrics}
          trends={trends}
          checkin={checkin}
          onSyncOura={onSyncOura}
          ouraToken={ouraToken}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

// Convert hex (#RRGGBB) + alpha to rgba string. Used for soft tints.
function hexToRgba(hex, alpha) {
  const m = String(hex).match(/^#?([a-f0-9]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Trend curve used inside each pot at rest. Apple Health Summary tile
// pattern: a soft curve with gradient fill underneath, a faint horizontal
// baseline ("your usual"), and an emphasized end-dot for today's value.
function TrendCurveV5({ trend, color, usual, active }) {
  const W = 200, H = 30, padX = 2, padY = 2;
  const values = trend.map(d => d.value);
  const hasAny = values.some(v => v != null);
  if (!hasAny) {
    return (
      <div style={{
        height: H, fontFamily: "var(--fm)", fontSize: 8, letterSpacing: 1.4,
        color: V5_PAL.faint, textAlign: "left", paddingTop: 8,
        textTransform: "uppercase",
      }}>not enough data</div>
    );
  }
  const xs = trend.map((_, i) => padX + (i * (W - 2 * padX)) / (trend.length - 1));
  const yFor = (v) => v == null ? null : H - padY - (v / 100) * (H - 2 * padY);
  const ys = values.map(yFor);
  const linePts = trend.map((_, i) => ys[i] == null ? null : `${xs[i]},${ys[i]}`).filter(Boolean);
  const linePath = `M ${linePts.join(" L ")}`;
  // Closed area path for the gradient fill — drop down to the bottom and back.
  const firstX = xs[ys.findIndex(y => y != null)];
  const lastX = xs[ys.length - 1 - [...ys].reverse().findIndex(y => y != null)];
  const areaPath = `${linePath} L ${lastX},${H} L ${firstX},${H} Z`;
  const lastY = ys[ys.length - 1];
  const lastValidIdx = ys.length - 1 - [...ys].reverse().findIndex(y => y != null);
  const lastXForDot = xs[lastValidIdx];
  const lastYForDot = ys[lastValidIdx];

  const gradId = `tc-grad-${color.replace("#", "")}`;
  const usualY = usual != null ? yFor(usual) : null;

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Faint horizontal baseline at "your usual" */}
      {usualY != null && (
        <line x1={padX} x2={W - padX} y1={usualY} y2={usualY}
          stroke={V5_PAL.faint} strokeWidth="0.6" strokeDasharray="2 3" opacity="0.7"/>
      )}
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={color}
        strokeWidth={active ? 1.8 : 1.5}
        strokeLinecap="round" strokeLinejoin="round" />
      {lastYForDot != null && (
        <>
          <circle cx={lastXForDot} cy={lastYForDot} r={active ? 2.6 : 2.2}
            fill={color} />
          <circle cx={lastXForDot} cy={lastYForDot} r={active ? 4.2 : 3.6}
            fill="none" stroke={color} strokeWidth="0.8" opacity="0.35" />
        </>
      )}
    </svg>
  );
}

// Compute a one-line trend insight from the sparkline data. No API call.
function computeTrendInsight(trend, pillar) {
  const valid = trend.filter(d => d.value != null);
  if (valid.length === 0) return "First few days — patterns take a week or so to show.";
  if (valid.length === 1) return "Just one day of data so far — a week makes the trend clear.";

  const recent = valid.slice(-3);
  const earlier = valid.slice(0, -3);
  const recentAvg = recent.reduce((s, d) => s + d.value, 0) / recent.length;
  const earlierAvg = earlier.length ? earlier.reduce((s, d) => s + d.value, 0) / earlier.length : recentAvg;
  const delta = recentAvg - earlierAvg;

  const last = valid[valid.length - 1].value;
  const prev = valid[valid.length - 2]?.value;
  const variance = (() => {
    const mean = valid.reduce((s, d) => s + d.value, 0) / valid.length;
    return Math.sqrt(valid.reduce((s, d) => s + Math.pow(d.value - mean, 2), 0) / valid.length);
  })();

  const noun = pillar === "body" ? "body score" : pillar === "mind" ? "mind score" : "mood";

  if (Math.abs(delta) < 4 && variance < 6) return `Steady ${noun} across the week — your usual.`;
  if (delta > 8)  return `Trending up — recent days are clearly above the start of the week.`;
  if (delta < -8) return `Trending down — last few days are lower than the start of the week.`;
  if (prev != null && last - prev > 12) return `Bounced back from yesterday — today is the strongest in days.`;
  if (prev != null && prev - last > 12) return `Took a dip today after a steadier stretch.`;
  return `Light week-on-week movement — ${noun} is finding its level.`;
}

// Expanded detail drawer — Apple Health detail-sheet composition.
// Sections (top to bottom): header / hero stat / chart / insight /
// contributors / quick-entry (if data missing) / sync button.
function PotDetailV5({ pillar, ring, color, trend, usual, biometrics, setBiometrics, trends, checkin, onSyncOura, ouraToken, onClose }) {
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [manualOpen, setManualOpen] = useState(false);
  const insight = computeTrendInsight(trend, pillar);
  const sourceWord = (s) => s === "oura" ? "ring" : s === "apple" ? "iphone" : s === "manual" ? "you typed" : s === "self" ? "you rated" : s === "llm" ? "from your words" : "—";

  const rows = (() => {
    const out = [];
    const b = biometrics || {};
    const t = trends?.today || {};
    // Device for the fields Apple Health can supply (sleep, HRV, active minutes).
    // An Apple-only user's day carries source "apple-health"; without this their
    // iPhone-sourced numbers were hardcoded "oura" → shown as "ring". Readiness
    // and body stress have no Apple equivalent, so they stay "oura" when present.
    const dev = (b.source || "").startsWith("apple") ? "apple" : "oura";
    if (pillar === "body") {
      const sleepMin = b.totalSleepMin || b.manualSleepMin || t.totalSleepMin;
      if (sleepMin > 30) out.push({ label: "Sleep", value: `${Math.floor(sleepMin / 60)}h ${Math.round(sleepMin % 60)}m`, source: dev });
      if (b.readinessScore != null || t.readinessScore != null) out.push({ label: "Readiness", value: String(Math.round(b.readinessScore ?? t.readinessScore)), source: "oura" });
      if (b.avgHRV != null) out.push({ label: "HRV", value: `${Math.round(b.avgHRV)} ms`, source: dev });
      if (t.activeMinutes != null) out.push({ label: "Active minutes", value: `${Math.round(t.activeMinutes)} min`, source: dev });
    } else if (pillar === "mind") {
      if (trends?.hrvDelta != null) out.push({ label: "HRV vs your usual", value: `${trends.hrvDelta >= 0 ? "+" : ""}${Math.round(trends.hrvDelta)}%`, source: dev });
      if (checkin?.kss?.value != null) out.push({ label: "Alertness (1=alert, 9=sleepy)", value: `${checkin.kss.value}/9`, source: "self" });
      if (checkin?.pvtb?.latest?.meanRT != null) out.push({ label: "Reaction time", value: `${Math.round(checkin.pvtb.latest.meanRT)} ms`, source: "self" });
    } else if (pillar === "mood") {
      if (checkin?.pss4?.score != null) out.push({ label: "Felt stress", value: `${checkin.pss4.score}/16`, source: "self" });
      if (t.stressHighSec != null) out.push({ label: "Body stress", value: `${Math.round(t.stressHighSec / 60)} min`, source: "oura" });
    }
    return out;
  })();

  const titleName = pillar === "body" ? "Body" : pillar === "mind" ? "Mind" : "Mood";
  const today = ring?.value != null ? Math.round(ring.value) : null;
  const usualRounded = usual != null ? Math.round(usual) : null;
  const delta = (today != null && usualRounded != null) ? today - usualRounded : null;

  // Band half-width (matches chart) determines the "above / at / below" call.
  // Same derivation as TrendChartFullV5 — std of valid 7-day values, clamped 4–15,
  // fallback 6 when we only have one valid sample.
  const _trendVals = trend.map(d => d.value).filter(v => v != null);
  let bandHalf = 6;
  if (_trendVals.length >= 2) {
    const m = _trendVals.reduce((a, b) => a + b, 0) / _trendVals.length;
    const s = Math.sqrt(_trendVals.reduce((acc, v) => acc + (v - m) ** 2, 0) / (_trendVals.length - 1));
    bandHalf = Math.max(4, Math.min(15, s));
  }
  const status = delta == null ? null : delta > bandHalf ? "above" : delta < -bandHalf ? "below" : "at";
  const pillFg = status === "below" ? V5_PAL.alert : color;
  const pillBg = status === "below" ? "rgba(176, 85, 58, 0.10)" : hexToRgba(color, 0.10);
  const pillGlyph = status === "above" ? "↑" : status === "below" ? "↓" : "−";
  const pillText = status === "above" ? "Above your usual" : status === "below" ? "Below your usual" : "Right at your usual";

  const compareArrow = delta == null || delta === 0 ? null : delta > 0 ? "▲" : "▼";
  const compareColor = delta == null || delta === 0 ? V5_PAL.faint : (delta > 0 ? color : V5_PAL.alert);
  const compareAbs = delta == null ? null : Math.abs(delta);
  const compareDir = delta == null ? null : delta === 0 ? "right at your usual" : delta > 0 ? "above your usual" : "below your usual";

  return (
    <div style={{
      marginTop: 8,
      background: V5_PAL.card,
      border: `1px solid ${V5_PAL.hair}`,
      borderRadius: 22,
      overflow: "hidden",
      boxShadow: "0 1px 0 rgba(45,42,36,0.02), 0 18px 40px -28px rgba(45,42,36,0.20)",
    }}>
      {/* HEADER — swatch dot + pillar name, real outlined close */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "16px 20px",
        borderBottom: `1px solid ${V5_PAL.hair}`,
        background: hexToRgba(color, 0.04),
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }}/>
          <span style={{
            fontFamily: "var(--fm)", fontSize: 10.5, letterSpacing: 2,
            textTransform: "uppercase", color: color, fontWeight: 500,
          }}>{titleName}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" style={{
          background: V5_PAL.card, color: V5_PAL.muted,
          fontFamily: "var(--fm)", fontSize: 16, lineHeight: 1,
          cursor: "pointer", padding: "4px 9px",
          border: "1px solid rgba(45, 42, 36, 0.18)", borderRadius: 999,
        }}>×</button>
      </div>

      {/* HERO STAT — big italic value + Source-Serif compare line with ▲/▼ */}
      <div style={{ padding: "24px 22px 6px" }}>
        <div style={{
          fontFamily: "var(--fm)", fontSize: 9.5, letterSpacing: 1.8,
          textTransform: "uppercase", color: V5_PAL.faint,
        }}>Today</div>
        {today != null ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
            <span style={{
              fontFamily: "var(--fd)", fontStyle: "italic", fontWeight: 300,
              fontSize: 60, lineHeight: 0.95, letterSpacing: -1.8, color: V5_PAL.ink,
            }}>{today}</span>
            {compareDir && (
              <span style={{
                fontFamily: "var(--fb)", fontSize: 13.5, color: V5_PAL.muted,
                paddingBottom: 8, lineHeight: 1.35,
                display: "inline-flex", alignItems: "baseline", gap: 6, flexWrap: "wrap",
              }}>
                {compareArrow && (
                  <span style={{
                    fontFamily: "var(--fm)", fontSize: 10, color: compareColor,
                    transform: "translateY(-1px)",
                  }}>{compareArrow}</span>
                )}
                {compareAbs != null && compareAbs > 0 && (
                  <span style={{
                    fontFamily: "var(--fd)", fontStyle: "italic", fontWeight: 400,
                    fontSize: 16, color: V5_PAL.ink,
                  }}>{compareAbs}</span>
                )}
                <span>{compareDir}</span>
                {usualRounded != null && (
                  <span style={{
                    fontFamily: "var(--fd)", fontStyle: "italic", fontWeight: 400,
                    fontSize: 13.5, color: V5_PAL.ink, fontVariantNumeric: "tabular-nums",
                  }}>&nbsp;{usualRounded}</span>
                )}
              </span>
            )}
          </div>
        ) : (
          <div style={{
            fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 16,
            color: V5_PAL.muted, marginTop: 12, lineHeight: 1.45, maxWidth: "38ch",
          }}>No reading yet today — your last week is in the trend below.</div>
        )}
      </div>

      {/* STATUS PILL — only when today has a value */}
      {status && (
        <div style={{ padding: "14px 22px 0" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "4px 13px 4px 6px", borderRadius: 999,
            fontFamily: "var(--fm)", fontSize: 9.5, letterSpacing: 1.4,
            textTransform: "uppercase", fontWeight: 600,
            background: pillBg, color: pillFg,
          }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 16, height: 16, borderRadius: "50%",
              background: pillFg, color: V5_PAL.card,
              fontSize: 9, letterSpacing: 0, fontWeight: 700,
            }}>{pillGlyph}</span>
            {pillText}
          </span>
        </div>
      )}

      {/* CHART — SVG + day strip + band caption, all inside TrendChartFullV5 */}
      <div style={{ padding: "16px 22px 6px" }}>
        <TrendChartFullV5 trend={trend} color={color} usual={usual} todayVal={today} />
      </div>

      {/* INSIGHT */}
      <div style={{ padding: "12px 18px", borderTop: `1px solid ${V5_PAL.hair}` }}>
        <div style={{
          fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.8,
          textTransform: "uppercase", color: V5_PAL.faint, marginBottom: 6,
        }}>Insight</div>
        <div style={{
          fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 14,
          color: V5_PAL.ink, lineHeight: 1.55,
        }}>{insight}</div>
      </div>

      {/* CONTRIBUTORS */}
      {rows.length > 0 && (
        <div style={{ padding: "12px 18px 16px", borderTop: `1px solid ${V5_PAL.hair}` }}>
          <div style={{
            fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.8,
            textTransform: "uppercase", color: V5_PAL.faint, marginBottom: 8,
          }}>Contributors</div>
          {rows.map((r, i) => (
            <div key={r.label} style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              padding: "7px 0",
              borderTop: i === 0 ? "none" : `1px dashed ${V5_PAL.hair}`,
            }}>
              <span style={{
                fontFamily: "var(--fb)", fontSize: 13, color: V5_PAL.ink,
              }}>{r.label}</span>
              <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{
                  fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 16,
                  color: V5_PAL.ink, lineHeight: 1,
                }}>{r.value}</span>
                <span style={{
                  fontFamily: "var(--fm)", fontSize: 8.5, color: V5_PAL.faint,
                  letterSpacing: 0.8, textTransform: "uppercase",
                  minWidth: 60, textAlign: "right",
                }}>{sourceWord(r.source)}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* DATA ENTRY — Oura sync + manual fallback */}
      <div style={{ padding: "12px 18px 16px", borderTop: `1px solid ${V5_PAL.hair}`, background: "rgba(26,26,26,0.02)" }}>
        <div style={{
          fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.8,
          textTransform: "uppercase", color: V5_PAL.faint, marginBottom: 10,
        }}>{rows.length === 0 ? "Add data" : "Update data"}</div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Sync Oura */}
          <button
            type="button"
            disabled={syncing || !onSyncOura}
            onClick={async () => {
              if (!onSyncOura) return;
              setSyncing(true); setSyncMsg(null);
              try {
                if (!ouraToken) {
                  setSyncMsg("Add your Oura key in Settings to sync.");
                } else {
                  await onSyncOura();
                  setSyncMsg("Synced — close and reopen to see fresh numbers.");
                }
              } catch (e) {
                setSyncMsg(`Couldn't sync — ${(e?.message || "").slice(0, 80)}`);
              } finally {
                setSyncing(false);
              }
            }}
            style={{
              flex: "0 1 auto", padding: "10px 14px",
              background: syncing ? "rgba(79,138,95,0.2)" : color,
              color: "#FBF7EE",
              border: `1px solid ${color}`, borderRadius: 10,
              fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 1.4,
              textTransform: "uppercase", fontWeight: 500,
              cursor: syncing ? "wait" : "pointer", opacity: !onSyncOura ? 0.4 : 1,
            }}
          >{syncing ? "Syncing…" : "Sync ring"}</button>

          {/* Manual entry toggle */}
          <button
            type="button"
            onClick={() => setManualOpen(o => !o)}
            style={{
              flex: "0 1 auto", padding: "10px 14px",
              background: "transparent", color: V5_PAL.ink,
              border: `1px solid rgba(45,42,36,0.18)`, borderRadius: 10,
              fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 1.4,
              textTransform: "uppercase", fontWeight: 500, cursor: "pointer",
            }}
          >{manualOpen ? "Hide manual" : "Enter manually"}</button>
        </div>

        {syncMsg && (
          <div style={{
            marginTop: 10,
            fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 12,
            color: V5_PAL.muted, lineHeight: 1.5,
          }}>{syncMsg}</div>
        )}

        {manualOpen && (
          <ManualEntryV5
            pillar={pillar}
            biometrics={biometrics}
            setBiometrics={setBiometrics}
            onSaved={() => { setManualOpen(false); setSyncMsg("Saved — close and reopen to see the update."); }}
          />
        )}
      </div>
    </div>
  );
}

// Quick-entry form for each pillar. Saves directly to localStorage state
// (biometrics for sleep, checkin for surveys) and dispatches a refresh
// event so the rest of the app picks up the change.
function ManualEntryV5({ pillar, biometrics, setBiometrics, onSaved }) {
  const [sleepH, setSleepH] = useState(() => {
    const m = biometrics?.manualSleepMin || biometrics?.totalSleepMin || 0;
    return m ? Math.round((m / 60) * 10) / 10 : 7;
  });
  const [readiness, setReadiness] = useState(() => biometrics?.readinessScore || 70);
  const [kssVal, setKssVal] = useState(() => {
    try { return loadCheckin()?.kss?.value || 3; } catch { return 3; }
  });
  const [pssVal, setPssVal] = useState(() => {
    try { return loadCheckin()?.pss4?.score || 4; } catch { return 4; }
  });

  const saveBody = () => {
    const next = {
      ...(biometrics || {}),
      manualSleepMin: Math.round(sleepH * 60),
      readinessScore: readiness,
      source: "manual",
    };
    setBiometrics && setBiometrics(next);
    try { localStorage.setItem(BIOMETRICS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent("cpi:wearable-synced"));
    onSaved && onSaved();
  };
  const saveKss = () => {
    const cur = loadCheckin() || {};
    const next = { ...cur, kss: { value: kssVal, timestamp: new Date().toISOString() } };
    try { localStorage.setItem("cpi_checkin", JSON.stringify(next)); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent("cpi:wearable-synced"));
    onSaved && onSaved();
  };
  const savePss = () => {
    const cur = loadCheckin() || {};
    const next = { ...cur, pss4: { score: pssVal, timestamp: new Date().toISOString() } };
    try { localStorage.setItem("cpi_checkin", JSON.stringify(next)); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent("cpi:wearable-synced"));
    onSaved && onSaved();
  };

  const labelStyle = { fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: V5_PAL.muted, marginBottom: 6 };
  const inputBox = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 12 };
  const sliderStyle = { flex: 1, accentColor: "#3F5B39" };
  const saveBtn = {
    padding: "9px 14px", background: "#3F5B39", color: "#FBF7EE",
    border: "1px solid #3F5B39", borderRadius: 8,
    fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 1.2,
    textTransform: "uppercase", fontWeight: 500, cursor: "pointer",
    marginTop: 14,
  };

  if (pillar === "body") {
    return (
      <div style={{ marginTop: 14, padding: 12, background: "#FFFCF6", border: "1px solid rgba(45,42,36,0.10)", borderRadius: 10 }}>
        <div style={labelStyle}>Hours slept last night</div>
        <div style={inputBox}>
          <input type="range" min="3" max="12" step="0.25" value={sleepH}
            onChange={e => setSleepH(Number(e.target.value))} style={sliderStyle}/>
          <span style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 18, color: V5_PAL.ink, minWidth: 64, textAlign: "right" }}>
            {Math.floor(sleepH)}h {Math.round((sleepH - Math.floor(sleepH)) * 60)}m
          </span>
        </div>
        <div style={{ ...labelStyle, marginTop: 14 }}>How ready do you feel? (0–100)</div>
        <div style={inputBox}>
          <input type="range" min="0" max="100" step="1" value={readiness}
            onChange={e => setReadiness(Number(e.target.value))} style={sliderStyle}/>
          <span style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 18, color: V5_PAL.ink, minWidth: 40, textAlign: "right" }}>
            {readiness}
          </span>
        </div>
        <button type="button" onClick={saveBody} style={saveBtn}>Save</button>
      </div>
    );
  }

  if (pillar === "mind") {
    const desc = ["", "extremely alert", "very alert", "alert", "rather alert", "neither alert nor sleepy", "some signs of sleepiness", "sleepy, but no effort to stay awake", "sleepy, some effort to stay awake", "very sleepy, fighting sleep"][kssVal] || "";
    return (
      <div style={{ marginTop: 14, padding: 12, background: "#FFFCF6", border: "1px solid rgba(45,42,36,0.10)", borderRadius: 10 }}>
        <div style={labelStyle}>How alert are you right now? (1 = wide awake, 9 = fighting sleep)</div>
        <div style={inputBox}>
          <input type="range" min="1" max="9" step="1" value={kssVal}
            onChange={e => setKssVal(Number(e.target.value))} style={sliderStyle}/>
          <span style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 18, color: V5_PAL.ink, minWidth: 30, textAlign: "right" }}>
            {kssVal}
          </span>
        </div>
        <div style={{ fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 12, color: V5_PAL.muted, marginTop: 6 }}>
          {desc}
        </div>
        <button type="button" onClick={saveKss} style={saveBtn}>Save</button>
      </div>
    );
  }

  // mood
  return (
    <div style={{ marginTop: 14, padding: 12, background: "#FFFCF6", border: "1px solid rgba(45,42,36,0.10)", borderRadius: 10 }}>
      <div style={labelStyle}>How overwhelmed has the last week felt? (0 = none, 16 = very high)</div>
      <div style={inputBox}>
        <input type="range" min="0" max="16" step="1" value={pssVal}
          onChange={e => setPssVal(Number(e.target.value))} style={sliderStyle}/>
        <span style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 18, color: V5_PAL.ink, minWidth: 30, textAlign: "right" }}>
          {pssVal}
        </span>
      </div>
      <div style={{ fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 12, color: V5_PAL.muted, marginTop: 6 }}>
        {pssVal <= 4 ? "Low felt stress." : pssVal <= 8 ? "Moderate stress." : pssVal <= 12 ? "High stress." : "Very high stress."}
      </div>
      <button type="button" onClick={savePss} style={saveBtn}>Save</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  TrendChartFullV5 — composite chart panel for PotDetailV5.
//
//  Three stacked pieces:
//   1. SVG plot — soft "usual" band (no labels inside), smooth curve,
//      outlined past-day dots, halo + filled today dot with floating value.
//   2. Day strip (HTML) — W..T letters, today wrapped in a pillar-colored
//      pill. No SVG text getting horizontally stretched by viewBox scaling.
//   3. Band caption (HTML) — small color swatch + "your usual range" on
//      the left, italic low–high on the right. Replaces the old in-chart
//      "Your usual · NN" text that collided with the trend line.
// ─────────────────────────────────────────────────────────────────────
// In "relative" mode (v2 Patterns) today's standing is described against the
// user's OWN usual band in plain words — never a raw score. HCPI is an
// unvalidated internal composite (engine.js / docs/HCPI_VALIDATION_AUDIT), so
// the v2 chart indexes to "your usual", not an absolute 0–100 number.
function usualStanding(v, low, high, half) {
  if (v == null || low == null || high == null) return null;
  if (v >= low && v <= high) return 'right around your usual';
  const far = typeof half === 'number' ? half : 6;
  if (v > high) return v - high > far ? 'well above your usual' : 'a little above your usual';
  return low - v > far ? 'well below your usual' : 'a little below your usual';
}

function TrendChartFullV5({ trend, color, usual, todayVal, relative }) {
  const W = 360;
  const H = 140;
  const chartTop = 22;
  const chartBottom = 128;
  const chartLeft = 10;
  const chartRight = 350;
  const chartH = chartBottom - chartTop;
  const chartW = chartRight - chartLeft;

  const values = trend.map(d => d.value);
  const validVals = values.filter(v => v != null);

  if (validVals.length === 0) {
    return (
      <div style={{
        height: H, display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--fm)", fontSize: 11, letterSpacing: 1, color: V5_PAL.faint,
      }}>Not enough data yet — a full week makes the trend clear.</div>
    );
  }

  // Band half-width derived from the std deviation of valid values,
  // clamped to a sensible visual range. Falls back to ±6 with only one sample.
  let bandHalf = 6;
  if (validVals.length >= 2) {
    const mean = validVals.reduce((a, b) => a + b, 0) / validVals.length;
    const std = Math.sqrt(validVals.reduce((s, v) => s + (v - mean) ** 2, 0) / (validVals.length - 1));
    bandHalf = Math.max(4, Math.min(15, std));
  }
  const bandLow = usual != null ? Math.max(0, usual - bandHalf) : null;
  const bandHigh = usual != null ? Math.min(100, usual + bandHalf) : null;

  // Y axis: fit data + band, with breathing room at top for floating today value.
  const minBound = Math.min(...validVals, bandLow ?? 100);
  const maxBound = Math.max(...validVals, bandHigh ?? 0);
  const span = Math.max(12, maxBound - minBound);
  const pad = span * 0.30;
  const yMin = Math.max(0, Math.floor(minBound - pad));
  const yMax = Math.min(100, Math.ceil(maxBound + pad));
  const yRange = Math.max(1, yMax - yMin);

  const yFor = (v) => v == null ? null : chartBottom - ((v - yMin) / yRange) * chartH;
  const xs = trend.map((_, i) => chartLeft + (i * chartW) / (trend.length - 1));
  const ys = values.map(yFor);

  // Smooth path (Catmull–Rom converted to cubic Bezier).
  const pts = [];
  trend.forEach((_, i) => { if (ys[i] != null) pts.push([xs[i], ys[i], i]); });
  const smoothD = (() => {
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
  })();
  const firstPx = pts[0]?.[0];
  const lastPx = pts[pts.length - 1]?.[0];
  const areaD = smoothD ? `${smoothD} L ${lastPx},${chartBottom} L ${firstPx},${chartBottom} Z` : null;

  const todayIdx = trend.length - 1;
  const todayY = ys[todayIdx];
  const todayX = xs[todayIdx];
  const hasToday = values[todayIdx] != null && todayY != null;
  const lastBeforeIdx = !hasToday && pts.length > 0 ? pts[pts.length - 1][2] : null;

  const bandYTop = bandHigh != null ? yFor(bandHigh) : null;
  const bandYBot = bandLow != null ? yFor(bandLow) : null;
  const bandMidY = usual != null ? yFor(usual) : null;
  const bandHeight = bandYTop != null && bandYBot != null ? Math.max(2, bandYBot - bandYTop) : null;

  const gradId = `tc-full-grad-${color.replace("#", "")}`;
  const todayChipBg = hasToday ? color : V5_PAL.faint;
  const showCaption = bandLow != null && bandHigh != null;
  const todayStanding = relative ? usualStanding(values[todayIdx], bandLow, bandHigh, bandHalf) : null;

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
           style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Usual band — soft tint + hairline at exact median. No text inside. */}
        {bandYTop != null && bandHeight != null && (
          <rect x="0" y={bandYTop} width={W} height={bandHeight}
                fill={color} opacity="0.07" rx="2"/>
        )}
        {bandMidY != null && (
          <line x1="0" x2={W} y1={bandMidY} y2={bandMidY}
                stroke={color} strokeWidth="0.5" opacity="0.18"/>
        )}

        {/* Relative axis anchors (v2): name the vertical zones against the
            user's own usual band. Pinned to the chart's top/bottom padding —
            always data-free (the line and band live in the middle ~60%), so a
            label never collides with the trend line whatever its shape. */}
        {relative && showCaption && (
          <text x="3" y={chartTop + 9}
                fontFamily="var(--fm)" fontSize="7.5" letterSpacing="0.7"
                fill={color} opacity="0.6">above usual</text>
        )}
        {relative && showCaption && (
          <text x="3" y={chartBottom - 3}
                fontFamily="var(--fm)" fontSize="7.5" letterSpacing="0.7"
                fill={color} opacity="0.6">below usual</text>
        )}

        {/* Area + smooth trend line */}
        {areaD && <path d={areaD} fill={`url(#${gradId})`} />}
        {smoothD && (
          <path d={smoothD} fill="none" stroke={color}
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* Soft dashed continuation into empty today slot */}
        {!hasToday && lastBeforeIdx != null && (
          <line x1={xs[lastBeforeIdx]} y1={ys[lastBeforeIdx]}
                x2={todayX} y2={ys[lastBeforeIdx]}
                stroke={color} strokeWidth="1.2"
                strokeDasharray="2 4" opacity="0.35"/>
        )}

        {/* Past-day outlined dots (every day except today) */}
        {trend.map((d, i) => {
          if (i === todayIdx) return null;
          if (ys[i] == null) return null;
          return (
            <circle key={`pd-${i}`} cx={xs[i]} cy={ys[i]} r="2.8"
                    fill={V5_PAL.card} stroke={color} strokeWidth="1.4"/>
          );
        })}

        {/* Today: halo + filled dot + hairline leader + italic value,
            or open dashed ring when no reading today. */}
        {hasToday ? (
          <>
            <circle cx={todayX} cy={todayY} r="11"  fill={color} opacity="0.10"/>
            <circle cx={todayX} cy={todayY} r="4.6" fill={color}/>
            {!relative && (
              <>
                <line x1={todayX} x2={todayX} y1={todayY - 14} y2={todayY - 7}
                      stroke={color} strokeWidth="0.8" opacity="0.55"/>
                <text x={todayX} y={todayY - 16} textAnchor="middle"
                      fontFamily="var(--fd)" fontStyle="italic"
                      fontSize="14" fill={color} fontWeight="400">
                  {Math.round(values[todayIdx])}
                </text>
              </>
            )}
          </>
        ) : (
          <circle cx={todayX}
                  cy={lastBeforeIdx != null ? ys[lastBeforeIdx] : (chartTop + chartBottom) / 2}
                  r="4.4" fill={V5_PAL.card}
                  stroke={V5_PAL.faint} strokeWidth="1"
                  strokeDasharray="2 2"/>
        )}
      </svg>

      {/* Day strip — real HTML so text doesn't get stretched by the viewBox. */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
        marginTop: 12, padding: "0 4px",
      }}>
        {trend.map((d, i) => {
          if (i !== todayIdx) {
            return (
              <div key={`day-${i}`} style={{
                fontFamily: "var(--fm)", fontSize: 10.5, letterSpacing: 0.4,
                color: V5_PAL.faint, textAlign: "center",
              }}>{d.label}</div>
            );
          }
          return (
            <div key={`day-${i}`} style={{ display: "inline-flex", justifyContent: "center" }}>
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                minWidth: 18, height: 18, padding: "0 5px",
                borderRadius: 999, fontWeight: 700,
                fontFamily: "var(--fm)", fontSize: 10.5, letterSpacing: 0.4,
                background: todayChipBg, color: V5_PAL.card,
              }}>{d.label}</span>
            </div>
          );
        })}
      </div>

      {/* Band caption — explains the soft band underneath the plot. */}
      {showCaption && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          margin: "12px 4px 0", padding: "0 2px",
          fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.4,
          textTransform: "uppercase", color: V5_PAL.faint,
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{
              display: "inline-block", width: 18, height: 6, borderRadius: 2,
              background: hexToRgba(color, 0.22),
            }}/>
            your usual range
          </span>
          {relative ? (
            <span style={{
              fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 11,
              color: V5_PAL.ink, letterSpacing: 0, textTransform: "none",
            }}>{todayStanding || 'today’s not in yet'}</span>
          ) : (
            <span style={{
              fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 11,
              color: V5_PAL.ink, letterSpacing: 0, textTransform: "none",
              fontVariantNumeric: "tabular-nums",
            }}>{Math.round(bandLow)} – {Math.round(bandHigh)}</span>
          )}
        </div>
      )}
    </div>
  );
}

// Pick the most useful specific signal to show under each pot. Falls
// through gracefully when data is missing — returns null for that pot.
function pickPotSpecifics(biometrics, trends, checkin) {
  const out = { body: null, mind: null, mood: null };
  const b = biometrics || {};
  const t = trends?.today || {};

  // ── BODY: prefer sleep duration; fall back to readiness, then HRV
  const sleepMin = b.totalSleepMin || b.manualSleepMin || t.totalSleepMin;
  if (sleepMin && sleepMin > 30) {
    const h = Math.floor(sleepMin / 60);
    const m = Math.round(sleepMin % 60);
    out.body = { label: "sleep", value: `${h}h ${m}m` };
  } else if (b.readinessScore != null || t.readinessScore != null) {
    out.body = { label: "readiness", value: String(Math.round(b.readinessScore ?? t.readinessScore)) };
  } else if (b.avgHRV != null) {
    out.body = { label: "hrv", value: `${Math.round(b.avgHRV)} ms` };
  }

  // ── MIND: prefer HRV vs baseline, then KSS, then reaction time
  if (trends?.hrvDelta != null) {
    const sign = trends.hrvDelta >= 0 ? "+" : "";
    out.mind = { label: "hrv vs usual", value: `${sign}${Math.round(trends.hrvDelta)}%` };
  } else if (checkin?.kss?.value != null) {
    // KSS 1 = wide awake, 9 = fighting sleep. Show as "alert N/9" with lower being better.
    out.mind = { label: "alertness", value: `${checkin.kss.value}/9` };
  } else if (checkin?.pvtb?.latest?.meanRT != null) {
    out.mind = { label: "reaction", value: `${Math.round(checkin.pvtb.latest.meanRT)} ms` };
  }

  // ── MOOD: prefer felt-stress survey, then body stress minutes
  if (checkin?.pss4?.score != null) {
    out.mood = { label: "felt stress", value: `${checkin.pss4.score}/16` };
  } else if (t.stressHighSec != null) {
    const mins = Math.round(t.stressHighSec / 60);
    out.mood = { label: "body stress", value: `${mins} min` };
  }

  return out;
}

function ringFeel(value, kind) {
  if (value == null) return "";
  if (kind === "body") return value >= 75 ? "well rested" : value >= 55 ? "rested but light" : value >= 35 ? "running low" : "depleted";
  if (kind === "mind") return value >= 75 ? "clear, steady" : value >= 55 ? "mostly clear" : value >= 35 ? "scattered" : "foggy";
  if (kind === "mood") return value >= 75 ? "buoyant" : value >= 55 ? "even" : value >= 35 ? "tender today" : "heavy";
  return "";
}

// ─────────────────────────────────────────────────────────────────────
//  ReadingBlockV5 — "The reading" block (insight + source + chips)
//  Top half: consumer-friendly summary tied to today's actual factors.
//  Bottom half: what data Ori looked at, in plain English.
//
//  When `insight` (from Claude) is passed in as a prop, it overrides the
//  templated version below. Otherwise we build a factor-aware template
//  that never contradicts itself (e.g. won't say "you slept well" and
//  "short sleep pulls from reserves" in the same paragraph).
// ─────────────────────────────────────────────────────────────────────
function ReadingBlockV5({ h, a, biometrics, chronotype, history, mode = "full" }) {
  // Reflect mode is the words-only contract: no body-data factors drive
  // the templated reading, no body-data chips appear, and the source
  // line credits only the journal.
  const isReflect = mode === "reflect";

  // Today's writing — the freshest entry sits at history[0] (CPI sorts
  // newest-first). dayDesc was saved as the un-prefixed plain text of the
  // user's seeds for today; we hand it to the LLM verbatim so the reading
  // can quote specific phrases instead of generic philosophy.
  const todayText = (history?.[0]?.dayDesc || "").trim();

  // ── Claude-generated insight (cached). Falls back to template below. ──
  const [llmInsight, setLlmInsight] = useState(() => loadReadingInsightCache()?.text || null);
  useEffect(() => {
    if (!h || !a) return;
    const sig = readingInsightSignature(h, a, biometrics, { mode, todayText });
    const cached = loadReadingInsightCache();
    if (cached?.signature === sig && cached.text) { setLlmInsight(cached.text); return; }
    let cancelled = false;
    (async () => {
      const text = await generateReadingInsight(h, a, biometrics, chronotype, { mode, todayText });
      if (!cancelled && text) setLlmInsight(text);
    })();
    return () => { cancelled = true; };
  }, [h?.HCPI, h?.chronoMod, h?.recentStrain, a?.psi, a?.decisionCount, biometrics?.totalSleepMin, biometrics?.manualSleepMin, chronotype, mode, todayText]);

  const ct = CHRONOTYPES[chronotype] || CHRONOTYPES.flexible;
  const sleepMin = biometrics?.totalSleepMin || biometrics?.manualSleepMin || 0;
  const sleepH   = sleepMin / 60;
  const sleepStr = formatSleepMin(sleepMin);

  // ── Identify the factors actually contributing to today's reading ──
  // Tracked so the closer + educative beat match what's true. In Reflect
  // every body-derived factor is forced false so the template only cites
  // journal-grounded signals (heavy emotional text).
  const factors = {
    lowSleep:      !isReflect && !!sleepStr && sleepH < 6.8,
    goodSleep:     !isReflect && !!sleepStr && sleepH >= 7.5,
    offPeak:       !isReflect && h?.chronoMod != null && h.chronoMod < 0.92,
    inPeak:        !isReflect && h?.chronoMod != null && h.chronoMod >= 0.96,
    heavyText:     a?.psi != null && a.psi < 0.75,
    loadCarryover: !isReflect && h?.recentStrain != null && h.recentStrain > 1.3,
    extendedWake:  !isReflect && h?.Ha != null && h.Ha > 16,
  };
  // PR #8: HCPI no longer drives the closer or educative branches.
  // The reserves-tier framing now reads from today's WHO-5 wellbeing
  // (Topp 2015 bands: ≥73 optimal · 51–72 typical · 29–50 below ·
  // ≤28 low). HCPI still feeds the LLM prompt as engine context
  // (see useEffect deps below), so the generated insight remains
  // rich — only the templated-fallback thresholds switched source.
  const todayWho5Entry = todayWho5();
  const who5Score = todayWho5Entry?.score ?? null;
  const wellbeingHigh    = who5Score != null && who5Score >= 73;
  const wellbeingTypical = who5Score != null && who5Score >= 51 && who5Score < 73;
  const wellbeingLow     = who5Score != null && who5Score < 51;
  const wellbeingUnknown = who5Score == null;

  // ── Build phrases that match factors actually present ──
  const ctWindow = `${ct.peakStart > 12 ? ct.peakStart - 12 : ct.peakStart}${ct.peakStart >= 12 ? "pm" : "am"} to ${ct.peakEnd > 12 ? ct.peakEnd - 12 : ct.peakEnd}${ct.peakEnd >= 12 ? "pm" : "am"}`;
  const bits = [];
  if (factors.offPeak)       bits.push(`you're writing <b>before your sharpest hours</b> — yours usually run ${ctWindow}`);
  if (factors.lowSleep)      bits.push(`last night's rest came up <b>a bit short</b> (${sleepStr}, against your ${typicalSleepHours()}h average)`);
  if (factors.goodSleep)     bits.push(`you slept <b>well</b> (${sleepStr}, on or above your ${typicalSleepHours()}h average)`);
  if (factors.heavyText)     bits.push(`what you wrote carried a <b>heavier emotional weight</b> than usual`);
  if (factors.loadCarryover) bits.push(`stress has been <b>quietly building</b> over the last few days`);
  if (factors.extendedWake)  bits.push(`you've been <b>awake more than 16 hours</b> — the brain's recovery curve gets steep past this point`);
  if (factors.inPeak && bits.length === 0) bits.push(`you're writing <b>inside your sharpest window</b> (${ctWindow})`);

  // ── Closer: cite ONLY the contributing factors, not a static lookup ──
  let closer;
  if (wellbeingHigh) closer = "so your reserves are full today.";
  else if (wellbeingTypical) closer = "so your reserves are right around where they usually sit.";
  else if (wellbeingLow) {
    const pulled = [
      factors.lowSleep && "short sleep",
      factors.offPeak && "an off-peak hour",
      factors.heavyText && "emotional weight",
      factors.loadCarryover && "stress carrying over",
      factors.extendedWake && "extended wakefulness",
    ].filter(Boolean);
    closer = pulled.length === 0
      ? "so your reserves are softer than usual — the cause isn't loud, just diffuse."
      : `so your reserves are thinner today — ${joinList(pulled)} all pull from the same pool.`;
  } else {
    // No WHO-5 today — name what we can see without guessing the rest.
    closer = "and the rest of how today reads is yours to name when you check in.";
  }

  // ── Educative beat: pick the lesson tied to the actual factors ──
  let educative;
  if (factors.extendedWake) {
    educative = "After 16 hours awake, the cost of every additional decision roughly doubles. Sleep is the single biggest lever you have left tonight.";
  } else if (factors.heavyText && factors.loadCarryover) {
    educative = "Emotional weight and accumulated stress share the same pool — recovery isn't one good night, it's a few in a row.";
  } else if (factors.heavyText) {
    educative = "Emotional load uses the same fuel as hard thinking. A heavy day costs your focus too, even if it doesn't feel like it.";
  } else if (factors.lowSleep && factors.offPeak) {
    educative = "Short sleep and an early hour both draw from reserves — your body works in rhythms, and you're against two of them right now.";
  } else if (factors.lowSleep) {
    educative = "Sleep is the biggest single lever for tomorrow's reserves — a single restorative night moves the score more than anything else.";
  } else if (factors.offPeak) {
    educative = "Match the task to the hour. Routine work fits before your peak; save complex thinking for inside the window.";
  } else if (factors.loadCarryover) {
    educative = "Stress accumulates across days, not just today. Reserves come back when the inputs ease, not when you push through.";
  } else if (factors.goodSleep && factors.inPeak) {
    educative = "This is a strong window — sleep and timing both lined up. Protect the next hour for what matters most.";
  } else if (wellbeingHigh) {
    educative = "Reserves are full today — hard thinking and emotional weight cost you less. A good window for what matters.";
  } else if (wellbeingUnknown) {
    educative = "A daily check-in fills in the part the body data and writing can't see on their own.";
  } else {
    educative = "Reserves are the energy you have for hard thinking and steady mood — sleep, timing, and emotional weight all feed the same pool.";
  }

  const templatedInsight = bits.length === 0
    ? `Today sits close to your usual — nothing in the data is pulling especially loudly, ${closer}`
    : `${capitalize(bits.join("; "))} — ${closer}`;

  // Parse Claude output: body paragraph + (optional) italic educative beat on a second line.
  const parsedLlm = (() => {
    if (!llmInsight) return null;
    const parts = String(llmInsight).split(/\n\n+/);
    const body = parts[0]?.trim() || "";
    const italic = parts.slice(1).join(" ").trim();
    // Convert *asterisks* in the body to bold for emphasis on key facts.
    const bodyHtml = body.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    const italicHtml = italic.replace(/^\*+|\*+$/g, "").replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return { bodyHtml, italicHtml };
  })();

  const insight = parsedLlm?.bodyHtml || templatedInsight;
  const educativeBeat = parsedLlm?.italicHtml || educative;

  // Build the source line — what data Ori looked at, plain English.
  // In Reflect mode, the only legitimate sources are the journal and the
  // 28-day pattern store; any body-data credit would contradict the
  // words-only contract even when the data exists locally.
  //
  // `decisionCount` is the engine's per-day count of *decision-named*
  // phrases in TODAY's writing (a.decisionCount from analyzeWithClaude).
  // The previous version summed ALL driver keyword hits (survival +
  // social + reward + identity + …) and called the total "decisions" —
  // that overstated the number by 3–5× because keywords like "tired",
  // "judged", "scrolled" got tallied as choices.
  const decisionCount = Math.max(0, Math.round(a?.decisionCount || 0));
  const topPart = (a?.letterParts && a.letterParts.length > 0) ? a.letterParts[0] : null;
  const partStreak = countPartStreak(history, topPart);

  // Source attribution for the sleep chip: ring only if the day's source
  // actually was a wrist sensor (Oura). Apple Health phone-detected sleep
  // gets credited to the phone. Fixes the "ring" misattribution that
  // appeared even when there was no ring in the loop.
  const sleepSource = (biometrics?.source || "").toLowerCase();
  const sleepChipLabel = sleepSource.includes("oura") ? "Sleep · ring"
    : sleepSource.includes("apple") ? "Sleep · phone"
    : "Sleep";

  const sourceBits = [];
  if (sleepStr && !isReflect) sourceBits.push(`<b>last night's sleep</b>`);
  if (decisionCount > 0) sourceBits.push(`the <b>${decisionCount} decision${decisionCount === 1 ? "" : "s"}</b> you named today`);
  if (topPart && partStreak >= 2) sourceBits.push(`<b>${topPart.toLowerCase()}</b>, a part of you that's shown up ${partStreak} days in a row`);
  else if (topPart) sourceBits.push(`<b>${topPart.toLowerCase()}</b>, a part of you that visited today`);
  const source = sourceBits.length === 0
    ? (isReflect
        ? "To write you this, Ori looked at what you wrote today."
        : "To write you this, Ori looked at the body data you have synced and what you wrote today.")
    : `To write you this, Ori looked at ${joinList(sourceBits)}.`;

  const chips = [];
  if (sleepStr && !isReflect) chips.push(sleepChipLabel);
  if (decisionCount > 0) chips.push("Your words today");

  return (
    <div style={{
      margin: "22px 0 0",
      padding: "18px 20px",
      background: "rgba(112,91,60,0.05)",
      borderRadius: 14,
    }}>
      <div style={{
        fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 2,
        textTransform: "uppercase", color: V5_PAL.sepia, marginBottom: 12,
      }}>The reading</div>
      <div style={{
        fontFamily: "var(--fb)", fontSize: 14, lineHeight: 1.7,
        color: V5_PAL.ink,
      }} dangerouslySetInnerHTML={{ __html: insight }} />
      <div
        style={{ marginTop: 12, fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 12.5, color: V5_PAL.muted, lineHeight: 1.55 }}
        dangerouslySetInnerHTML={{ __html: educativeBeat }}
      />
      <div style={{ marginTop: 14, borderTop: `1px dashed ${V5_PAL.hair}` }} />
      <div style={{
        marginTop: 14,
        fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 13,
        color: V5_PAL.muted, lineHeight: 1.65,
      }} dangerouslySetInnerHTML={{ __html: source }} />
      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {chips.map(c => (
          <span key={c} style={{
            fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 0.6,
            color: V5_PAL.muted,
            padding: "3px 8px", background: "rgba(26,26,26,0.04)",
            borderRadius: 999,
          }}>{c}</span>
        ))}
      </div>
    </div>
  );
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function joinList(arr) {
  if (arr.length === 0) return "";
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
}
function countPartStreak(history, partName) {
  if (!partName || !Array.isArray(history)) return 0;
  const target = String(partName).toLowerCase();
  let streak = 0;
  const seenDays = new Set();
  for (const e of history) {
    if (!e?.date) continue;
    const day = String(e.date).slice(0, 10);
    if (seenDays.has(day)) continue;
    seenDays.add(day);
    const parts = (e.letterParts || []).map(p => String(p).toLowerCase());
    if (parts.includes(target)) streak += 1;
    else if (seenDays.size > streak) break;
  }
  return streak;
}

// ─────────────────────────────────────────────────────────────────────
//  FriendlyApiErrorV5 — turns raw "Claude API 400: {...}" strings into
//  human-readable messages with an actionable next step. Recognizes the
//  most common failure modes (credit balance, auth, rate limit, network)
//  and falls back to a calm generic message for anything else.
// ─────────────────────────────────────────────────────────────────────
function parseApiError(raw) {
  const str = String(raw || "");
  // Try to pull out a status code and a parsed JSON body.
  const statusMatch = str.match(/Claude API\s*(\d+)/i);
  const status = statusMatch ? Number(statusMatch[1]) : null;
  let inner = null;
  const jsonStart = str.indexOf("{");
  if (jsonStart >= 0) {
    const tail = str.slice(jsonStart);
    // The error may be truncated — try to parse as much as we can by
    // walking back from the end until JSON.parse succeeds.
    for (let end = tail.length; end > 10; end -= 8) {
      try {
        const candidate = tail.slice(0, end).replace(/[,]\s*$/, "") + (tail[end - 1] === "}" ? "" : "}");
        const parsed = JSON.parse(candidate);
        inner = parsed?.error?.message || parsed?.message || null;
        if (inner) break;
      } catch { /* keep trying */ }
    }
  }
  const lower = (inner || str).toLowerCase();

  // Credit balance — by far the most common one for prototype dev.
  if (lower.includes("credit balance") || lower.includes("upgrade or purchase credits")) {
    return {
      kind: "credits",
      title: "Ori needs more credits to read today",
      detail: "The prototype's API account has run out of credits. (This is separate from your Claude.ai subscription.)",
      action: { label: "Open Anthropic console", href: "https://console.anthropic.com/settings/billing" },
    };
  }
  if (status === 401 || lower.includes("invalid_api_key") || lower.includes("unauthorized")) {
    return {
      kind: "auth",
      title: "Ori couldn't sign in to read",
      detail: "The API key in prototype/.env.local isn't being accepted. Check it's pasted correctly and the server has restarted.",
    };
  }
  if (status === 429 || lower.includes("rate_limit") || lower.includes("too many requests")) {
    return {
      kind: "rate",
      title: "Ori is being asked too quickly",
      detail: "Hold on a moment, then try Read today again.",
    };
  }
  if (status === 529 || lower.includes("overloaded")) {
    return {
      kind: "overloaded",
      title: "Ori is busy with too many requests right now",
      detail: "Anthropic's service is under heavy load. Give it a few seconds, then tap Retry.",
    };
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("network request failed")) {
    return {
      kind: "network",
      title: "Couldn't reach Ori",
      detail: "Looks like the network dropped. Check your connection and try again.",
    };
  }
  if (lower.includes("claude api timeout") || lower.includes("timeout")) {
    return {
      kind: "timeout",
      title: "Reading is taking unusually long",
      detail: "Ori didn't hear back within 2 minutes. Tap Retry to try again — or trim today's writing if it's very long.",
    };
  }
  if (status && status >= 500) {
    return {
      kind: "server",
      title: "Anthropic is having a moment",
      detail: "The service returned an error. Wait a few seconds and tap Retry.",
    };
  }
  // Surface the raw error when we can't classify it — without this, every
  // unknown failure shows "Something went wrong" and there's no way to
  // tell whether the problem is the network, the plugin bridge, the
  // server, or the response shape. The raw message is almost always
  // human-readable enough to act on.
  const fallbackDetail = inner
    ? capitalize(String(inner))
    : (str ? str.slice(0, 240) : "Something went wrong. Tap Retry below to try again.");
  return {
    kind: "generic",
    title: "Ori couldn't finish today's reading",
    detail: fallbackDetail,
  };
}

function FriendlyApiErrorV5({ message, onDismiss }) {
  if (!message) return null;
  const parsed = parseApiError(message);
  return (
    <div style={{
      margin: "0 0 16px",
      padding: "14px 16px",
      background: "rgba(176,85,58,0.05)",
      border: `1px solid rgba(176,85,58,0.25)`,
      borderRadius: 12,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div style={{
          fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 15,
          color: V5_PAL.alert, lineHeight: 1.3,
        }}>
          {parsed.title}
        </div>
        {onDismiss && (
          <button type="button" onClick={onDismiss} style={{
            background: "transparent", border: "none",
            color: V5_PAL.muted, fontFamily: "var(--fm)", fontSize: 10,
            letterSpacing: 1.4, cursor: "pointer", padding: 2,
          }}>×</button>
        )}
      </div>
      <div style={{
        marginTop: 6,
        fontFamily: "var(--fb)", fontSize: 13, lineHeight: 1.6,
        color: V5_PAL.soft,
      }}>{parsed.detail}</div>
      {parsed.action && (
        <a
          href={parsed.action.href}
          target="_blank" rel="noopener noreferrer"
          style={{
            display: "inline-block", marginTop: 10,
            fontFamily: "var(--fm)", fontSize: 10.5, letterSpacing: 1.4,
            textTransform: "uppercase", color: V5_PAL.alert,
            textDecoration: "none",
            paddingBottom: 1, borderBottom: `1px solid ${V5_PAL.alert}`,
          }}
        >
          {parsed.action.label} →
        </a>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  LetterActionsV5 — "Add a line" (primary) + "Numbers →" (secondary)
//  Replaces the legacy "Back to input" button + the absent math link.
// ─────────────────────────────────────────────────────────────────────
function LetterActionsV5({ onAddLine, onSeeNumbers }) {
  return (
    <div style={{
      marginTop: 24, display: "flex", gap: 10, alignItems: "stretch",
    }}>
      <button type="button" onClick={onAddLine} style={{
        flex: 1, padding: "15px 18px",
        background: V5_PAL.leaf, color: "var(--bg)",
        border: `1px solid ${V5_PAL.leaf}`, borderRadius: 14,
        fontFamily: "var(--fm)", fontSize: 11, letterSpacing: 1.6,
        textTransform: "uppercase", textAlign: "center", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      }}>
        Add a line
      </button>
      <button type="button" onClick={onSeeNumbers} style={{
        padding: "15px 18px",
        background: "transparent", color: V5_PAL.muted,
        border: `1px solid ${V5_PAL.hair}`, borderRadius: 14,
        fontFamily: "var(--fm)", fontSize: 10.5, letterSpacing: 1.6,
        textTransform: "uppercase", textAlign: "center", cursor: "pointer",
        display: "flex", alignItems: "center", gap: 6,
      }}>
        Your numbers <span style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 14 }}>→</span>
      </button>
    </div>
  );
}

// ── Public surface ──────────────────────────────────────────────────
export {
  // Constants
  WAKE_OVERRIDE_PREFIX, WAKE_LAST_KEY,
  // Helpers
  todayKey, loadWakeOverride, saveWakeOverride,
  loadLastWake, saveLastWake, getAutoWakeTime, getAutoWakeSource,
  pickQuietReflection, pickQuietGlyph,
  explainHCPI, summarizeHCPI,
  // Legacy components
  MicButton, SystemCriticalAlert, UltradianCard, ChronotypeCard,
  SleepPipelineTrace, LetterEmptyState, LlmActivity, LlmFloatingPill,
  SignalCard, Sparkline, PillarDetail, SkyArc, GardenPlant, GardenPot,
  TodayGlance,
  // v5 components (2026-05-11 redesign)
  GreetingHeaderV5, BodyContextLineV5, ReadingCardV5,
  ReservesTileV5, MiniPotsRowV5, ReadingBlockV5, LetterActionsV5,
  FriendlyApiErrorV5,
  // Shared chart pieces consumed by v2 (anchor chart format)
  TrendChartFullV5, V5_PAL, hexToRgba,
};
