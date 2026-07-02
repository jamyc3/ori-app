/* ─────────────────────────────────────────────────────────────────
   LetterReading — Day's Reading rewritten as a calm letter, not a dashboard.

   Phase 1.0 of the "Garden as model" re-imagine. Replaces the post–
   "Read My Mind" result view (Signal/Drivers/Insights/Ultradian/Chronotype
   bar-and-card stack) with:
     · a soft eyebrow + date
     · an italic headline naming today's loud parts
     · 1-2 paragraphs of body prose (drawn from the existing engine insights,
       which Claude already wrote in narrative form)
     · a "plants that visited today" chip row at the bottom
     · a "show the math ↓" toggle that reveals the original cards intact

   Engine output is unchanged. We re-present it. If the toggle is open the
   user sees the same cards as today; if closed they see prose. Numbers are
   never deleted — they just live one tap away.

   Driver → part mapping:
     identity   → the planner       (manager, organizes, "should be")
     social     → the watcher       (manager, scans rooms, status)
     survival   → the tender one    (body signaling needs)
     reward     → the seeker        (firefighter, dopamine chase)
     discomfort → the hesitant one  (firefighter, friction avoidance)
     [low overall driver tax + positive tone] → the gentle one (Self-energy)

   Volume is bucketed off the driver score relative to the day's max:
     ≥ 0.66 of max → "loud"
     ≥ 0.33 of max → "present"
     >  0           → "brief"

   This is a self-contained module. Wire into CPI.jsx by importing
   PARTS_LIB and LetterReading and rendering it where the existing
   result block sits today. ──────────────────────────────────────── */

import React, { useState } from "react";
// The parts library + pure derivation helpers now live in a React-free module
// (parts-lib.js) so they're importable without JSX. Re-exported here unchanged
// so every existing `from "./LetterReading.jsx"` import keeps working.
import {
  GP,
  DRIVER_TO_PART,
  SELF_PARTS,
  PARTS_LIB,
  visitedPartsFromResult,
  visitedPartsFromLetter,
  visitedPartsFromAnalysis,
  headlineFor,
  partLabel,
  partDescOf,
} from "./parts-lib.js";

export {
  DRIVER_TO_PART,
  SELF_PARTS,
  PARTS_LIB,
  visitedPartsFromResult,
  visitedPartsFromLetter,
  visitedPartsFromAnalysis,
  headlineFor,
  partLabel,
  partDescOf,
};

/* ─────────────────────────── presentational ─────────────────────────── */

export default function LetterReading({
  result,                 // engine output: { h, a }  — same shape as today
  insights,               // result.a.insights array (already narrative)
  tone = "neutral",       // sentiment hint (positive | negative | neutral)
  seedCount = null,       // optional: how many seeds today
  onShowMath,             // optional: callback when "show the math" toggled
  onChipClick,            // optional: clicking a chip → opens Keeper (Phase 2)
  onClose,                // optional: ← close handler
  onReset,                // optional: "new entry" handler (Phase 1 keeps it)
  hideMathToggle = false, // v5: hide the "show the math" + "new entry" buttons (caller renders its own action row)
  hideCrisisFoot = false, // v5: hide the inline 988 strip so the caller can render it once at the bottom of the page
  children,               // children = the existing dashboard cards (revealed by show-math toggle)
}) {
  const [mathOpen, setMathOpen] = useState(false);

  // Phase 1.1: prefer Claude's curated letter.parts; fall back to drivers.
  const llmLetter = result?.a?.letter;
  const visited = visitedPartsFromAnalysis(result?.a, tone);
  const headline = (typeof llmLetter?.headline === "string" && llmLetter.headline.trim())
    ? llmLetter.headline.trim()
    : headlineFor(visited);
  const today = new Date();
  const dateLabel = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const seedLabel = seedCount != null ? ` · ${seedCount} seed${seedCount === 1 ? "" : "s"}` : "";

  // Body paragraphs. Phase 1.1: prefer Claude's `letter.paragraphs` because
  // they're written in the IFS-soft parts vocabulary natively. Fall back to
  // the existing insight bodies (Phase 1.0 behavior — works but uses the
  // older clinical voice).
  const llmParas = Array.isArray(llmLetter?.paragraphs)
    ? llmLetter.paragraphs.map(p => String(p || "").trim()).filter(Boolean)
    : [];
  const bodyParas = llmParas.length > 0
    ? llmParas
    : (insights || []).slice(0, 2).map(ins => ins.body).filter(Boolean);

  const toggleMath = () => {
    setMathOpen(o => !o);
    onShowMath?.(!mathOpen);
  };

  return (
    <div style={S.frame}>
      {onClose && (
        <button type="button" onClick={onClose} style={S.backLink}>
          ← back
        </button>
      )}

      <div style={S.dateline}>{dateLabel}{seedLabel}</div>
      {/* Tier replaces the eyebrow when Claude earned it (≥7 days of data
          AND a clear pattern). Otherwise default eyebrow renders. */}
      {llmLetter?.tier ? (
        <div style={S.eyebrowTier}>
          <span style={S.tierLabel}>{llmLetter.tier.toLowerCase()}</span>
          <span style={S.eyebrowDot}>·</span>
          <span>a letter from Ori</span>
        </div>
      ) : (
        <div style={S.eyebrow}>a letter from Ori</div>
      )}

      <h2 style={S.headline}>{headline}</h2>

      <div style={S.body}>
        {bodyParas.length > 0 ? (
          bodyParas.map((p, i) => {
            const rendered = renderWithParts(p, visited);
            // Drop cap on the first paragraph only — gives the letter
            // a piece-of-correspondence opening rather than a card top.
            if (i === 0 && typeof p === "string" && p.length > 0) {
              const first = p[0];
              const restText = p.slice(1);
              const restRendered = renderWithParts(restText, visited);
              return (
                <p key={i} style={S.firstPara}>
                  <span style={S.dropCap}>{first}</span>
                  {restRendered}
                </p>
              );
            }
            return <p key={i} style={S.para}>{rendered}</p>;
          })
        ) : (
          <p style={S.para}>The garden was steady today. Nothing in the writing asked for a closer look.</p>
        )}
      </div>

      <div style={S.signature}>— Ori</div>

      {visited.length > 0 && (
        <div style={S.postscript}>
          <div style={S.psCap}>today's company</div>
          {visited.map(({ part, note }) => (
            <button
              key={part.id}
              type="button"
              onClick={() => onChipClick?.(part)}
              style={S.psRow}
              title="open garden keeper"
            >
              <span style={{ ...S.psGlyph, color: part.color }}>{part.glyph}</span>
              <span style={S.psName}>{part.name}</span>
              {note && <>
                <span style={S.psSep}>—</span>
                <span style={S.psNote}>{note}</span>
              </>}
            </button>
          ))}
        </div>
      )}

      {!hideMathToggle && (
        <div style={S.footer}>
          <button type="button" onClick={toggleMath} style={S.showMath}>
            {mathOpen ? "hide the math" : "show the math"}
          </button>

          {onReset && (
            <button type="button" onClick={onReset} style={S.newEntry}>
              new entry
            </button>
          )}
        </div>
      )}

      {mathOpen && (
        <div style={S.mathBox}>
          {children}
        </div>
      )}

      {!hideCrisisFoot && (
        <div style={S.crisisFoot}>
          <span style={S.crisisLabel}>if tonight is heavy</span>
          <span style={S.crisisDot}>·</span>
          <a href="tel:988" style={S.crisisLink}>call or text 988 (US)</a>
          <span style={S.crisisDot}>·</span>
          <a href="https://findahelpline.com" target="_blank" rel="noopener noreferrer" style={S.crisisLink}>find a helpline</a>
        </div>
      )}
    </div>
  );
}

// Standalone crisis strip — exported so V5 callers can render it ONCE at
// the very bottom of the result page instead of getting it for free in
// the middle of LetterReading (which used to land it awkwardly between
// the letter and the body-mind-mood numbers). Pass hideCrisisFoot to
// LetterReading and drop this at the foot of your page.
export function CrisisFootStrip() {
  return (
    <div style={{ ...S.crisisFoot, marginTop: 32, justifyContent: "center" }}>
      <span style={S.crisisLabel}>if tonight is heavy</span>
      <span style={S.crisisDot}>·</span>
      <a href="tel:988" style={S.crisisLink}>call or text 988 (US)</a>
      <span style={S.crisisDot}>·</span>
      <a href="https://findahelpline.com" target="_blank" rel="noopener noreferrer" style={S.crisisLink}>find a helpline</a>
    </div>
  );
}

// Highlight any visited part name found in the prose. Quiet substring match;
// case-insensitive. Splits the paragraph on the first occurrence per part.
function renderWithParts(text, visited) {
  if (!visited.length) return text;
  // Build a single regex of all part names; preserve color via a dictionary.
  const names = visited.map(v => v.part.name);
  const re = new RegExp(`(${names.map(escapeRe).join("|")})`, "gi");
  const tokens = String(text).split(re);
  return tokens.map((tok, i) => {
    const match = visited.find(v => v.part.name.toLowerCase() === tok.toLowerCase());
    if (!match) return <React.Fragment key={i}>{tok}</React.Fragment>;
    return (
      <span key={i} style={{ ...S.partInline, color: match.part.color }}>
        {tok}
      </span>
    );
  });
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/* ───────────────────────────── styles ───────────────────────────── */

const S = {
  // Letter container — generous top breathing, narrow column for serif body.
  // The parent (CPI.jsx) already constrains overall width; here we add the
  // letter's own vertical rhythm.
  frame: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    color: GP.ink,
    background: GP.bg,
    padding: "16px 0 32px",
    maxWidth: "36em",
  },
  // Letter-style layout: generous side margin, narrow measure, paper feel.
  // Wrapping the inner letter in its own column keeps line length at the
  // print-design sweet spot (~58–66 chars) for serif body type.
  // The frame itself is widened by the parent; we compress here.
  backLink: {
    background: "none", border: "none",
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
    color: GP.moss, cursor: "pointer",
    padding: "0 0 28px 0", marginLeft: -4,
    minHeight: 36, minWidth: 44, textAlign: "left",
    display: "block",
  },
  dateline: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontStyle: "italic", fontSize: 13, color: GP.muted,
    marginBottom: 4, letterSpacing: 0.2,
  },
  eyebrow: {
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 10, letterSpacing: 1.8, textTransform: "uppercase",
    color: GP.faint, marginBottom: 32,
  },
  // Tier-style eyebrow: tier word in moss accent, divider, "a letter from Ori"
  // in the regular faint mono. Single line, calm. Tier is one word.
  eyebrowTier: {
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 10, letterSpacing: 1.8, textTransform: "uppercase",
    color: GP.faint, marginBottom: 32,
    display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap",
  },
  tierLabel: {
    color: GP.moss, fontWeight: 500,
  },
  eyebrowDot: { color: GP.faint, opacity: 0.6 },
  headline: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontStyle: "italic", fontWeight: 400, fontSize: 30,
    lineHeight: 1.18, letterSpacing: -0.4,
    margin: "0 0 36px", maxWidth: "20em", color: GP.ink,
  },
  body: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontSize: 16, lineHeight: 1.85, color: GP.ink,
    maxWidth: "32em",
  },
  firstPara: { margin: "0 0 18px", overflow: "hidden" },
  para: { margin: "0 0 18px" },
  dropCap: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontStyle: "italic", fontWeight: 400,
    // clamp scales the drop cap from 48px on phones to 64px on tablets+
    fontSize: "clamp(48px, 10vw, 64px)",
    lineHeight: 0.85,
    float: "left", marginRight: 10, marginTop: 6, marginBottom: -4,
    color: GP.leaf,
  },
  partInline: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontStyle: "italic", color: GP.leaf, whiteSpace: "nowrap",
  },
  signature: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontStyle: "italic", fontSize: 17, color: GP.muted,
    marginTop: 20, marginBottom: 40, letterSpacing: 0,
  },
  // Postscript — vertical list that reads like cast credits, not chips.
  postscript: {
    paddingTop: 24, marginBottom: 32,
    borderTop: `1px solid ${GP.hair}`,
  },
  psCap: {
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 10, letterSpacing: 1.8, textTransform: "uppercase",
    color: GP.faint, marginBottom: 14,
  },
  psRow: {
    background: "none", border: "none",
    display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap",
    padding: "8px 0", margin: 0,
    cursor: "pointer", textAlign: "left",
    fontFamily: "inherit", color: "inherit",
    width: "100%",
  },
  psGlyph: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontStyle: "italic", fontSize: 22, lineHeight: 1,
    color: GP.leaf, minWidth: 24, textAlign: "left",
  },
  psName: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontStyle: "italic", fontSize: 17, color: GP.ink,
  },
  psSep: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontStyle: "italic", color: GP.faint,
  },
  psNote: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontStyle: "italic", fontSize: 14, color: GP.muted,
    flex: 1,
  },
  // Footer — quiet row of two text-only links. No solid CTAs in the letter.
  footer: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    paddingTop: 18, marginTop: 8,
    borderTop: `1px solid ${GP.hair}`,
  },
  showMath: {
    background: "none", border: "none",
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
    color: GP.moss, cursor: "pointer", padding: "8px 0",
    minHeight: 36,
  },
  newEntry: {
    background: "none", border: `1px solid ${GP.line}`, borderRadius: 18,
    padding: "8px 16px", minHeight: 36,
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
    color: GP.ink, cursor: "pointer",
  },
  mathBox: { marginTop: 24, paddingTop: 16 },
  // Crisis footer — quiet single-line tail. Always visible. Easy to miss
  // until the night you need it. Plain mono, faint color, hairline rule.
  crisisFoot: {
    marginTop: 36,
    paddingTop: 14,
    borderTop: `1px solid ${GP.hair}`,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 6,
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 10,
    letterSpacing: 1.5,
    color: GP.faint,
  },
  crisisLabel: { textTransform: "uppercase", color: GP.faint },
  crisisDot: { color: GP.faint, opacity: 0.5 },
  crisisLink: {
    color: GP.muted,
    textDecoration: "none",
    borderBottom: `1px solid ${GP.line}`,
    paddingBottom: 1,
  },
};
