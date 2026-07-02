import { useMemo, useState } from "react";
import {
  rhythmsFinding, returnsFinding, driftsFinding, streakStats, weatherFinding,
} from "./patterns-aggregators.js";
import { pickActiveThread } from "./threads.js";
import { computeBiometricTrends, OURA_HISTORY_KEY, loadRepo } from "./engine.js";
import { loadSelfReportedSleepWindow, shouldShowSleepNudge, dismissSleepNudge } from "./sleep-window.js";
import { PARTS_LIB } from "./LetterReading.jsx";

const T = {
  bg:    "#F7F3EC",
  paper: "#FBF7EE",
  card:  "#FFFCF3",
  fg:    "#1a1a1a",
  muted: "rgba(26,26,26,0.48)",
  body:  "rgba(26,26,26,0.65)",
  faint: "rgba(26,26,26,0.32)",
  hair:  "rgba(26,26,26,0.06)",
  line:  "rgba(26,26,26,0.10)",
  accent:"#B8860B",
  moss:  "#4F8A5F",
};
const fd = "'Playfair Display', Georgia, serif";
const fb = "'Source Serif 4', Georgia, serif";
const fm = "'DM Mono', ui-monospace, monospace";

// ────────────────────────────────────────────────────────────────────────
// Shared card chrome

function Card({ tag, children }) {
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.hair}`, borderRadius: 14,
      padding: "20px 20px 18px", margin: "0 16px 12px",
    }}>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        fontFamily: fm, fontSize: 10, letterSpacing: "0.22em",
        textTransform: "uppercase", color: T.accent, marginBottom: 12,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.accent }} />
        {tag}
      </div>
      {children}
    </div>
  );
}

function Headline({ children }) {
  return (
    <h4 style={{
      fontFamily: fd, fontStyle: "italic", fontWeight: 300, fontSize: 20,
      lineHeight: 1.35, color: T.fg, margin: "0 0 12px", letterSpacing: "-0.01em",
    }}>{children}</h4>
  );
}

function Meta({ children }) {
  return (
    <p style={{
      fontFamily: fb, fontSize: 14, lineHeight: 1.65, color: T.body, margin: 0,
    }}>{children}</p>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Card: Rhythms

function RhythmsCard({ finding }) {
  if (!finding) return null;
  if (finding.calibrating) {
    return (
      <Card tag="Rhythms">
        <Headline>{finding.headline}</Headline>
        <Meta>{finding.meta}</Meta>
      </Card>
    );
  }
  const maxBar = Math.max(...(finding.weekdayBars || []).filter(x => x != null), 0.01);
  return (
    <Card tag="Rhythms">
      <Headline>{finding.headline}</Headline>
      <Meta>{finding.meta}</Meta>
      {finding.weekdayBars && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", gap: 3, height: 26, alignItems: "flex-end" }}>
            {finding.weekdayBars.map((v, i) => {
              const isPeak = i === finding.peakDow;
              const peakVal = finding.weekdayBars[finding.peakDow] || 0.01;
              const high = !isPeak && v != null && (v / peakVal) >= 0.75;
              return (
                <div key={i} style={{
                  flex: 1,
                  height: v == null ? "12%" : `${Math.max(12, (v / maxBar) * 100)}%`,
                  background: isPeak ? T.accent : high ? "rgba(184,134,11,0.55)" : "rgba(184,134,11,0.18)",
                  borderRadius: 2,
                }} />
              );
            })}
          </div>
          <div style={{ display: "flex", marginTop: 8, fontSize: 11, fontFamily: fm, letterSpacing: "0.18em", textTransform: "uppercase", color: T.muted }}>
            <span style={{ flex: 1, textAlign: "center" }}>S</span>
            <span style={{ flex: 1, textAlign: "center" }}>M</span>
            <span style={{ flex: 1, textAlign: "center" }}>T</span>
            <span style={{ flex: 1, textAlign: "center" }}>W</span>
            <span style={{ flex: 1, textAlign: "center" }}>T</span>
            <span style={{ flex: 1, textAlign: "center" }}>F</span>
            <span style={{ flex: 1, textAlign: "center" }}>S</span>
          </div>
        </div>
      )}
      {finding.peakBand && (
        <>
          <div style={{
            position: "relative", height: 22, marginTop: 14,
            background: "linear-gradient(90deg, rgba(26,26,26,0.05) 0%, rgba(184,134,11,0.12) 35%, rgba(184,134,11,0.4) 45%, rgba(184,134,11,0.4) 55%, rgba(184,134,11,0.12) 65%, rgba(26,26,26,0.05) 100%)",
            borderRadius: 4,
          }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, fontFamily: fm, letterSpacing: "0.1em", color: T.faint, textTransform: "uppercase" }}>
            <span>6a</span><span>10a</span><span>2p</span><span>6p</span><span>10p</span>
          </div>
        </>
      )}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Card: Returns (with inline Keeper doorway)

function ReturnsCard({ finding, onOpenKeeper }) {
  if (!finding) return null;
  if (finding.calibrating) {
    return (
      <Card tag="Returns">
        <Headline>{finding.headline}</Headline>
        <Meta>{finding.meta}</Meta>
      </Card>
    );
  }
  const { topVisitor, lapsed, friction, keeperCount } = finding;
  return (
    <Card tag="Returns">
      <Headline>{finding.headline}</Headline>
      <Meta>{finding.meta}</Meta>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 14, alignItems: "center", fontFamily: fb, fontSize: 13, fontStyle: "italic", color: T.body }}>
        {topVisitor && (
          <span><span style={{ fontSize: 16, color: topVisitor.color, lineHeight: 1 }}>{topVisitor.glyph}</span> {topVisitor.name.replace(/^the\s+/i, "")} · {topVisitor.visits} days</span>
        )}
        {lapsed && lapsed.id !== topVisitor?.id && lapsed.daysAway >= 5 && (
          <>
            <span style={{ color: T.faint }}>·</span>
            <span><span style={{ fontSize: 16, color: lapsed.color, lineHeight: 1 }}>{lapsed.glyph}</span> {lapsed.name.replace(/^the\s+/i, "")} · away {lapsed.daysAway}d</span>
          </>
        )}
      </div>
      {friction && (
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, fontFamily: fm, fontSize: 10, color: T.muted }}>
          <span>Where your mind goes</span>
          <span style={{ flex: 1, height: 6, background: "rgba(26,26,26,0.06)", borderRadius: 3, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${Math.round(friction.share * 100)}%`, background: "linear-gradient(90deg, #B8860B 0%, rgba(184,134,11,0.4) 100%)", borderRadius: 3 }} />
          </span>
          <span style={{ color: "#6b4f08" }}>{friction.dominant}</span>
        </div>
      )}
      {typeof onOpenKeeper === "function" && (
        <button
          type="button"
          onClick={onOpenKeeper}
          style={{
            marginTop: 14, paddingTop: 12,
            display: "flex", justifyContent: "space-between", alignItems: "center",
            width: "100%", background: "transparent", border: "none",
            borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: T.hair,
            fontFamily: fm, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase",
            color: T.muted, cursor: "pointer", textAlign: "left",
          }}
        >
          <span>See all your plants</span>
          <span>
            <span style={{ fontFamily: fb, fontStyle: "italic", textTransform: "none", letterSpacing: 0, color: T.muted, fontSize: 12 }}>{keeperCount} met</span>
            <span style={{ color: T.faint, fontSize: 14, marginLeft: 10 }}>›</span>
          </span>
        </button>
      )}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Card: Drifts

function DriftsCard({ finding }) {
  if (!finding) return null;
  if (finding.calibrating) {
    return (
      <Card tag="Drifts">
        <Headline>{finding.headline}</Headline>
        <Meta>{finding.meta}</Meta>
      </Card>
    );
  }
  const deltaH = finding.primary?.deltaHours ?? 0;
  const sign = deltaH < 0 ? "−" : "+";
  return (
    <Card tag="Drifts">
      <Headline>{finding.headline}</Headline>
      <Meta>{finding.meta}</Meta>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 14 }}>
        <span style={{ fontFamily: fd, fontStyle: "italic", fontSize: 30, fontWeight: 300, color: T.accent, letterSpacing: "-0.02em" }}>
          {sign}{Math.abs(deltaH).toFixed(1)}h
        </span>
        <span style={{ flex: 1, height: 18, background: "linear-gradient(90deg, rgba(184,134,11,0.1) 0%, rgba(184,134,11,0.5) 100%)", borderRadius: 4 }} />
      </div>
      {finding.recovery && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.hair}` }}>
          <svg width="50" height="28" viewBox="0 0 50 28">
            <path d="M2,26 Q25,2 48,26" fill="none" stroke={T.moss} strokeWidth="1.5" />
            <circle cx="48" cy="26" r="2.5" fill={T.moss} />
          </svg>
          <span style={{ fontFamily: fb, fontSize: 12, color: T.muted, fontStyle: "italic" }}>
            Bounces back in ~{finding.recovery.daysToBaseline} day{finding.recovery.daysToBaseline === 1 ? '' : 's'}
          </span>
        </div>
      )}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Card: Streaks

function StreaksCard({ finding }) {
  if (!finding) return null;
  // Pip row = last 7 calendar days, oldest on the left, today on the right.
  // Each pip carries the real day-of-week letter (Mon/Tue/…); filled if
  // the user wrote anything that day. The old hardcoded ["M","T","W","T",
  // "F","S","S"] row labeled the first pip "M" no matter what day it was —
  // confusing on Tuesday when the streak was just today.
  const DOW = ["S", "M", "T", "W", "T", "F", "S"]; // Sun..Sat
  const writingDays = new Set(finding.writingDays || []);
  const today = new Date();
  const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const pips = [];
  for (let k = 6; k >= 0; k--) {
    const d = new Date(today); d.setDate(today.getDate() - k);
    pips.push({
      key: ymdOf(d),
      label: DOW[d.getDay()],
      filled: writingDays.has(ymdOf(d)),
      isToday: k === 0,
    });
  }
  return (
    <Card tag="Streaks">
      <Headline>{finding.headline}</Headline>
      <Meta>{finding.meta}</Meta>
      <div style={{ display: "flex", gap: 4, marginTop: 14 }}>
        {pips.map((p) => (
          <div key={p.key} style={{
            width: 24, height: 24, borderRadius: "50%",
            background: p.filled ? "rgba(79,138,95,0.65)" : "rgba(26,26,26,0.06)",
            outline: p.isToday ? "1.5px solid rgba(79,138,95,0.55)" : "none",
            outlineOffset: 2,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: p.filled ? "#FBF7EE" : "rgba(26,26,26,0.38)",
            fontFamily: fm, fontSize: 9, letterSpacing: "0.05em",
          }}>{p.label}</div>
        ))}
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Card: Threads

function ThreadsCard({ thread }) {
  if (!thread) return null;
  if (thread.calibrating) {
    return (
      <Card tag="Threads">
        <Headline>{thread.headline}</Headline>
        <Meta>{thread.prose}</Meta>
      </Card>
    );
  }
  return (
    <Card tag="Threads">
      <Headline>{thread.headline}</Headline>
      <Meta>{thread.prose}</Meta>
      <div style={{ fontFamily: fb, fontSize: 12, color: "rgba(26,26,26,0.5)", marginTop: 14, lineHeight: 1.8, fontStyle: "italic" }}>
        {thread.examples.map((ex, i) => (
          <div key={i}>
            <span style={{ color: T.moss, fontStyle: "normal", fontFamily: fm, fontSize: 10, letterSpacing: "0.08em", marginRight: 6 }}>{ex.date}</span>
            {ex.summary}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Card: Weather

function WeatherCard({ finding }) {
  if (!finding) return null;
  if (finding.calibrating) {
    return (
      <Card tag="Weather">
        <Headline>{finding.headline}</Headline>
        <Meta>{finding.meta}</Meta>
      </Card>
    );
  }
  return (
    <Card tag="Weather">
      <Headline>{finding.headline}</Headline>
      <Meta>{finding.meta}</Meta>
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "50px 1fr", gap: 0, height: 140 }}>
        <div style={{
          display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "flex-end",
          paddingRight: 8, fontFamily: fm, fontSize: 9, letterSpacing: "0.06em", color: T.faint, textTransform: "uppercase",
        }}>
          <span>more<br/>energy</span><span>less<br/>energy</span>
        </div>
        <div style={{ position: "relative", background: T.paper, borderRadius: 6, border: `1px solid ${T.hair}` }}>
          <span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(26,26,26,0.08)" }} />
          <span style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgba(26,26,26,0.08)" }} />
          <span style={{ position: "absolute", top: 6, left: 8, fontFamily: fb, fontSize: 11, color: T.faint, fontStyle: "italic" }}>sharp · pressed</span>
          <span style={{ position: "absolute", top: 6, right: 8, fontFamily: fb, fontSize: 11, color: T.faint, fontStyle: "italic" }}>excited</span>
          <span style={{ position: "absolute", bottom: 6, left: 8, fontFamily: fb, fontSize: 11, color: T.faint, fontStyle: "italic" }}>tired · heavy</span>
          <span style={{ position: "absolute", bottom: 6, right: 8, fontFamily: fb, fontSize: 11, color: T.faint, fontStyle: "italic" }}>calm · curious</span>
          {finding.days.map((d, i) => {
            const isToday = i === finding.days.length - 1;
            const xPct = d.x * 100;
            const yPct = (1 - d.y) * 100;
            return (
              <span key={i} style={{
                position: "absolute", top: `${yPct}%`, left: `${xPct}%`,
                width: isToday ? 14 : 8, height: isToday ? 14 : 8,
                borderRadius: "50%",
                background: isToday ? T.accent : "rgba(184,134,11,0.35)",
                boxShadow: isToday ? "0 0 0 4px rgba(184,134,11,0.18)" : "none",
                transform: "translate(-50%, -50%)",
              }} />
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Empty state

function FirstRunEmpty() {
  return (
    <div style={{ textAlign: "center", padding: "60px 32px", color: T.muted, fontFamily: fb, fontStyle: "italic", fontSize: 14, lineHeight: 1.6 }}>
      Seven days from now, the temporal lens turns on.
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sleep-window nudge — a quiet inline banner shown to users who have been
// writing for ≥14 days but never told Ori when they sleep AND don't have
// Oura data filling that in. Tapping the body opens Settings (when the
// parent wires it); a tiny "not now" dismisses for 30 days.

function SleepWindowNudge({ onOpenSettings, onDismiss }) {
  const bodyStyle = {
    background: "rgba(79,138,95,0.06)",
    border: "1px solid rgba(79,138,95,0.22)",
    borderRadius: 12,
    margin: "0 16px 14px",
    padding: "14px 16px",
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
  };
  const hasOpen = typeof onOpenSettings === "function";
  const Tag = hasOpen ? "button" : "div";
  const tagProps = hasOpen
    ? { type: "button", onClick: onOpenSettings, style: { ...bodyStyle, cursor: "pointer", textAlign: "left", width: "100%" } }
    : { style: bodyStyle };
  return (
    <div style={{ position: "relative", margin: "0 0 14px" }}>
      <Tag {...tagProps}>
        <span style={{ fontSize: 16, lineHeight: 1.2, color: "#4F8A5F", flexShrink: 0, marginTop: 1 }}>✿</span>
        <span style={{ flex: 1, fontFamily: fb, fontSize: 13, lineHeight: 1.55, color: T.body }}>
          <span style={{ display: "block", fontFamily: fm, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "#4F8A5F", marginBottom: 4 }}>
            Sharpen your reading
          </span>
          Tell Ori roughly when you sleep
          {hasOpen ? " " : " in "}
          <span style={{ textDecoration: hasOpen ? "underline" : "none", fontWeight: 500, color: T.fg }}>
            {hasOpen ? "in Settings" : "Settings → Profile"}
          </span>
          {" "}— it'll help name your peak hours and chronotype.
        </span>
      </Tag>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={(e) => { e.stopPropagation(); onDismiss?.(); }}
        style={{
          position: "absolute", top: 6, right: 22,
          background: "transparent", border: 0, cursor: "pointer",
          padding: "6px 8px",
          fontFamily: fm, fontSize: 9, letterSpacing: "0.14em",
          textTransform: "uppercase", color: T.muted,
        }}
      >Not now</button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Main component

export default function Patterns({ history = [], onOpenKeeper, onOpenSettings, confirmations = null }) {
  // Oura history map — keyed by YYYY-MM-DD. Chronotype, peak window, and
  // HRV-based recovery all read from this directly (their inputs don't
  // live on history entries).
  const ouraMap = useMemo(() => {
    try {
      const raw = localStorage.getItem(OURA_HISTORY_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }, [history]);

  // Aggregate biometric trends (sleep debt, HRV baseline, SRI, etc.) —
  // a single computed snapshot built from the Oura map for "today".
  const biometricTrends = useMemo(() => {
    if (!ouraMap) return null;
    try {
      const today = new Date().toISOString().split("T")[0];
      return computeBiometricTrends(ouraMap, today);
    } catch { return null; }
  }, [ouraMap]);

  // Self-reported sleep window — the fallback for chronotype/peak-window
  // when Oura data is sparse or missing. Set during onboarding (soft skip)
  // and editable in Settings. The aggregator prefers device data when ≥7
  // nights are present; this only kicks in below that threshold.
  const selfReportedSleepWindow = useMemo(() => loadSelfReportedSleepWindow(), [history]);

  // Day-14 sleep-window nudge — surfaces once the user has been writing
  // long enough that the missing chronotype data is actually costing them
  // (Rhythms can't lead with morning/evening, peak-window stays null).
  // `dismissedThisSession` is local React state so dismiss feels instant;
  // the persistent cooldown lives in localStorage via dismissSleepNudge().
  const [dismissedThisSession, setDismissedThisSession] = useState(false);
  // Which Patterns section is in view. Defaults to "streaks" because
  // it's the densest card and the first one with content for new users
  // (single writing day = single-day streak). Persists for the life of
  // the component so navigating away and back keeps the user's choice.
  const [section, setSection] = useState("streaks");
  const showSleepNudge = useMemo(
    () => !dismissedThisSession && shouldShowSleepNudge(history, ouraMap),
    [dismissedThisSession, history, ouraMap],
  );

  // Writing days from the journal repo (raw paste / photo / upload / audio
  // — anything the user typed but might not have hit "Read" on). Streaks
  // and the dynamic pip row both treat any of these as a writing day.
  const repoWritingDates = useMemo(() => {
    try {
      const repo = loadRepo();
      const out = new Set();
      for (const e of (repo?.entries || [])) {
        const txt = String(e?.rawText || e?.transcription || "").trim();
        if (!txt) continue;
        if (typeof e?.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(e.date)) {
          out.add(e.date.slice(0, 10));
        } else if (typeof e?.uploadedAt === "string") {
          const d = new Date(e.uploadedAt);
          if (!isNaN(d.getTime())) {
            out.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
          }
        }
      }
      return [...out];
    } catch { return []; }
  }, [history]); // history changes are a cheap proxy for repo changes

  const rhythms = useMemo(
    () => rhythmsFinding(history, biometricTrends, ouraMap, { selfReportedSleepWindow }),
    [history, biometricTrends, ouraMap, selfReportedSleepWindow],
  );
  const returns = useMemo(() => returnsFinding(history, confirmations, PARTS_LIB), [history, confirmations]);
  const drifts  = useMemo(() => driftsFinding(history, biometricTrends, ouraMap), [history, biometricTrends, ouraMap]);
  const streak  = useMemo(() => streakStats(history, repoWritingDates), [history, repoWritingDates]);
  const thread  = useMemo(() => pickActiveThread(history, biometricTrends, ouraMap), [history, biometricTrends, ouraMap]);
  const weather = useMemo(() => weatherFinding(history, biometricTrends), [history, biometricTrends]);

  // Today's stand-out — rotates through every card that's actually firing
  // a non-calibrating finding, indexed by day-of-year so a user with the
  // same data sees a different lead each day. Falls back to the quiet
  // static line when nothing has earned a headline yet. Replaces the
  // previously-static "Things that take time to notice." subtitle.
  const standoutLine = useMemo(() => {
    const candidates = [];
    if (thread && !thread.calibrating && thread.headline) candidates.push(thread.headline);
    if (drifts && !drifts.calibrating && drifts.headline) candidates.push(drifts.headline);
    if (weather && weather.drift && weather.headline) candidates.push(weather.headline);
    if (rhythms && !rhythms.calibrating && rhythms.peakStrong && rhythms.headline) candidates.push(rhythms.headline);
    if (candidates.length === 0) return null;
    const today = new Date();
    const startOfYear = new Date(today.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((today - startOfYear) / 86400000);
    return candidates[dayOfYear % candidates.length];
  }, [thread, drifts, weather, rhythms]);

  const totalDays = useMemo(() => {
    const all = new Set();
    for (const e of (history || [])) {
      const d = new Date(e?.date);
      if (!isNaN(d.getTime())) all.add(d.toISOString().slice(0, 10));
    }
    for (const ymd of repoWritingDates) all.add(ymd);
    return all.size;
  }, [history, repoWritingDates]);

  if (totalDays < 1) {
    return (
      <div>
        <div style={{ textAlign: "center", marginBottom: 32, paddingTop: 8 }}>
          <div style={{ fontFamily: fm, fontSize: 10, letterSpacing: "0.24em", textTransform: "uppercase", color: T.muted, marginBottom: 16 }}>
            Patterns · over time
          </div>
          <h1 style={{ fontFamily: fd, fontWeight: 300, fontSize: 30, lineHeight: 1.15, letterSpacing: "-0.01em", margin: 0, color: T.fg }}>
            What's been quietly true.
          </h1>
        </div>
        <FirstRunEmpty />
      </div>
    );
  }

  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 32, paddingTop: 8 }}>
        <div style={{ fontFamily: fm, fontSize: 10, letterSpacing: "0.24em", textTransform: "uppercase", color: T.muted, marginBottom: 16 }}>
          Patterns · over time
        </div>
        <h1 style={{ fontFamily: fd, fontWeight: 300, fontSize: 30, lineHeight: 1.18, letterSpacing: "-0.01em", margin: 0, color: T.fg }}>
          What&apos;s been<br />quietly true.
        </h1>
        {standoutLine ? (
          <p
            key={standoutLine}
            style={{
              fontFamily: fb, fontSize: 15, color: T.body, lineHeight: 1.5,
              margin: "14px auto 32px", maxWidth: 360, fontStyle: "italic",
              letterSpacing: "-0.005em",
            }}
          >
            {standoutLine}
          </p>
        ) : (
          <p style={{ fontFamily: fb, fontSize: 14, color: T.muted, lineHeight: 1.55, margin: "12px auto 32px", maxWidth: 320, fontStyle: "italic" }}>
            Things that take time to notice.
          </p>
        )}
      </div>

      {showSleepNudge && (
        <SleepWindowNudge
          onOpenSettings={onOpenSettings}
          onDismiss={() => { dismissSleepNudge(); setDismissedThisSession(true); }}
        />
      )}
      <PatternsSectionPicker section={section} setSection={setSection} />
      <div style={{ marginTop: 16 }}>
        {section === "rhythms" && <RhythmsCard finding={rhythms} />}
        {section === "returns" && <ReturnsCard finding={returns} onOpenKeeper={onOpenKeeper} />}
        {section === "drifts"  && <DriftsCard finding={drifts} />}
        {section === "streaks" && <StreaksCard finding={streak} />}
        {section === "threads" && <ThreadsCard thread={thread} />}
        {section === "weather" && <WeatherCard finding={weather} />}
      </div>
    </div>
  );
}

// Horizontal pill bar that picks which Patterns section the user is
// looking at. Replaces the previous always-stacked rendering of all
// six cards — that was the worst offender on "feels like a website,
// I have to scroll forever" because the cards are tall and there
// are six of them. With a picker each section sized to the viewport
// reads as one page.
function PatternsSectionPicker({ section, setSection }) {
  const sections = [
    { id: "streaks", label: "Streaks" },
    { id: "rhythms", label: "Rhythms" },
    { id: "returns", label: "Returns" },
    { id: "drifts",  label: "Drifts" },
    { id: "threads", label: "Threads" },
    { id: "weather", label: "Weather" },
  ];
  return (
    <div
      data-no-swipe="true"
      style={{
        marginLeft: -22, marginRight: -22,
        paddingLeft: 22, paddingRight: 22,
        display: "flex", gap: 8,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
      }}
    >
      {sections.map(s => {
        const active = section === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            style={{
              flex: "0 0 auto",
              padding: "8px 14px", minHeight: 36, borderRadius: 999,
              border: active ? "none" : `1px solid ${T.line || "rgba(26,26,26,0.10)"}`,
              background: active ? T.fg : "transparent",
              color: active ? T.bg : T.muted,
              fontFamily: "var(--fm)", fontSize: 11, letterSpacing: 1.2,
              fontWeight: active ? 600 : 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
