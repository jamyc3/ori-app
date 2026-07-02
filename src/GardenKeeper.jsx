/* ─────────────────────────────────────────────────────────────────
   GardenKeeper — full-bleed overlay listing the parts in your garden.

   Phase 2 of the "Garden as model" re-imagine. Reachable from any chip
   in the Day's Reading letter ("plants that visited today" → tap one).

   Layout:
     · Top: ← close pill, title, subtitle ("Parts of you Ori has noticed
       across N days. Each is welcome. None is a verdict.")
     · "Met today" set-aside (small, faint moss tint) — compact pills of
       parts that visited in tonight's letter, since the user just heard
       from them.
     · "The rest of your garden" — larger cards for parts NOT visited
       today. Each shows a state label: "resting today" (seen ≤ 7 days
       ago) or "dormant" (seen > 7 days ago) or "not yet seen".

   Sources of truth:
     · `result` — today's analysis (used to compute visited parts)
     · `history` — array of past check-ins, each with `drivers` dict
                   (driver→score). Walks backward to find each part's
                   last-seen date.

   Imports PARTS_LIB / DRIVER_TO_PART / SELF_PARTS / visitedPartsFromResult
   from LetterReading.jsx so plant names, glyphs, colors, descriptions
   stay coherent across surfaces.

   Self-energy parts (gentle/witness/maker) currently have no driver
   mapping — they show "not yet seen" until Phase 1.1 surfaces them
   from linguistic signals. This is honest. ───────────────────────── */

import React, { useEffect } from "react";
import { PARTS_LIB, visitedPartsFromAnalysis } from "./LetterReading.jsx";
import { ymdISO } from "./dates.js";
import {
  entryHasPart,
  entryHasAnyPart,
  daysSinceISO,
  lastSeenForPart,
  firstSeenForPart,
  daysWithPartsCount,
  partAppearanceDays,
  totalLetterDays,
  companionQualifies,
  companionInKeeper,
  companionConfirmationStatus,
  partRenderClass,
  COMPANION_MIN_APPEARANCES,
  COMPANION_WINDOW_DAYS,
} from "./parts-stats.js";

const GP = {
  bg: "#F7F3EC",
  paper: "#FFFCF6",
  ink: "#2B2824",
  muted: "#958E84",
  faint: "#B8B09D",
  line: "rgba(45,42,36,0.12)",
  hair: "rgba(45,42,36,0.07)",
  leaf: "#3F5B39",
  moss: "#6A8A5C",
  sage: "#A3B88A",
  bloom: "#C98660",
  sepia: "#705B3C",
};

// All cross-day part-attendance helpers live in src/parts-stats.js.
// This component imports them and stays focused on render logic.

// Tone bucket → state label. "today" never appears in rest-of-garden
// (visited parts are filtered out), but kept for completeness.
function stateFor(lastSeen) {
  if (!lastSeen) return { label: "not yet seen", tone: "dormant" };
  if (lastSeen.daysAgo === 0) return { label: "earlier today", tone: "today" };
  if (lastSeen.daysAgo === 1) return { label: "yesterday", tone: "resting" };
  if (lastSeen.daysAgo <= 7) return { label: `${lastSeen.daysAgo} days ago`, tone: "resting" };
  return { label: `${lastSeen.daysAgo} days ago`, tone: "dormant" };
}

export default function GardenKeeper({ open, result, history = [], confirmations = null, onConfirm, onClose }) {
  // Esc key + body scroll lock — same pattern as GpReader.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  // Phase 1.1: visitedPartsFromAnalysis prefers Claude's letter.parts when
  // present (so Self-energy parts surfaced by linguistic signals are honored
  // in the "met today" set-aside) and falls back to driver-derived list.
  const visited = visitedPartsFromAnalysis(result?.a, "neutral");
  const visitedIds = new Set(visited.map(v => v.part.id));

  // Total days of history (rough — number of entries). Used in the subtitle.
  const dayCount = countUniqueDays(history);

  // 7-day bootstrap gate. Below threshold, we hide state labels (resting /
  // dormant / not yet seen) — those judgments need a week of baseline before
  // they're honest. Parts that HAVE visited still appear; we just don't tell
  // the user something is "dormant" on day 2.
  const partsDayCount = daysWithPartsCount(history);
  const isCalibrating = partsDayCount < 7;

  // Total letter-days — denominator for the frequency display.
  const totalLetters = totalLetterDays(history);

  // Rest of garden: every part in PARTS_LIB not visited today.
  //
  // Layered gates (Phase #3 + #6):
  //   1. companionInKeeper — single-event companions are excluded (gate),
  //      AND user-dismissed companions are hidden during their cooldown.
  //      Confirmed companions stay regardless of appearance count.
  //   2. The card itself carries the user-in-the-loop state so the render
  //      can show the ask-question or the "you confirmed this" tag.
  const restEntries = Object.values(PARTS_LIB)
    .filter(p => !visitedIds.has(p.id))
    .filter(p => companionInKeeper(history, p, confirmations?.[p.id]))
    .map(p => {
      const last = lastSeenForPart(history, p);
      const first = firstSeenForPart(history, p);
      const appearances = partAppearanceDays(history, p);
      const confirmStatus = companionConfirmationStatus(history, p, confirmations?.[p.id]);
      return { part: p, last, first, appearances, state: stateFor(last), confirmStatus };
    })
    // Sort by recency: most-recently-seen first, never-seen last.
    .sort((a, b) => {
      const da = a.last?.daysAgo ?? 9999;
      const db = b.last?.daysAgo ?? 9999;
      return da - db;
    });

  // Pre-bootstrap: just the parts that have actually visited (any day),
  // shown without state labels. Companion gate already applied via
  // restEntries upstream. Sorted by most-recently-seen first.
  const calibrationVisitors = isCalibrating
    ? restEntries.filter(r => r.last).sort((a, b) => (a.last?.daysAgo ?? 9999) - (b.last?.daysAgo ?? 9999))
    : [];

  return (
    <div style={S.overlay}>
      <div style={S.inner}>
        <button type="button" onClick={onClose} style={S.closeBtn}>← close</button>

        <h2 style={S.title}>The plants in your garden</h2>
        <p style={S.subtitle}>
          {dayCount > 0
            ? `What Ori has been hearing across the last ${dayCount === 1 ? "day" : `${dayCount} days`}. None of this is a verdict — it's a mirror you can look into when you want.`
            : "The garden is just starting. As you write, Ori will name what it notices."}
        </p>
        <p style={S.softNote}>
          Some of these come forward when things get loud. Others arrive in the quiet.
        </p>

        {visited.length > 0 && (
          <div style={S.metToday}>
            <div style={S.metCap}>
              <span>noticed today</span>
              <span style={S.metMeta}>in tonight's letter</span>
            </div>
            <div style={S.metLine}>
              Ori noticed {visited.length === 1 ? "this part" : `these ${visited.length}`}. Set aside for now.
            </div>
            <div style={S.metRow}>
              {visited.map(({ part }) => {
                const cls = partRenderClass(part);
                const isCompanion = cls === "companion";
                return (
                  <div
                    key={part.id}
                    style={{
                      ...S.metPill,
                      ...(isCompanion ? S.metPillCompanion : null),
                    }}
                  >
                    <span style={{ ...S.metGlyph, color: part.color }}>{part.glyph}</span>
                    <span style={S.metName}>{part.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Calibration branch — pre-7-days. Shows what's been met without
            the "resting / dormant / not yet seen" judgments, since those
            need a week of baseline to be honest. */}
        {isCalibrating ? (
          <>
            <div style={S.calibCard}>
              <div style={S.calibCap}>STILL LISTENING</div>
              <div style={S.calibLine}>
                {partsDayCount > 0
                  ? `${partsDayCount === 1 ? "One day" : `${partsDayCount} days`} in. The clearest shapes come into focus after a week or so.`
                  : "Just starting. The clearest shapes come into focus after a week or so."}
              </div>
            </div>

            {calibrationVisitors.length > 0 && (
              <>
                <div style={S.restCap}>met so far</div>
                {calibrationVisitors.map(({ part, last }) => {
                  const cls = partRenderClass(part);
                  return (
                    <div key={part.id} style={S.partCard}>
                      <div style={{
                        ...S.partGlyph,
                        ...glyphStyleFor(part, cls),
                        color: part.color,
                      }}>
                        {part.glyph}
                      </div>
                      <div style={S.partBody}>
                        <div style={S.partName}>{part.name}</div>
                        <div style={S.partDesc}>{part.desc}</div>
                      </div>
                      <div style={S.partState}>
                        <span>{last ? metaPhrase(last.daysAgo) : "—"}</span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </>
        ) : (
          <>
            <div style={S.restCap}>the rest of your garden</div>
            {restEntries.length === 0 ? (
              <div style={S.emptyRest}>
                All your plants visited today. Quiet days will look different.
              </div>
            ) : (
              restEntries.map(({ part, last, first, appearances, confirmStatus }) => {
                // Frequency-first claim (Phase #2): "5 of 12 letters" replaces
                // verdict labels (resting/dormant). The fraction is the
                // empirical claim; recency is supplementary context.
                const hasFirst = first && (first.daysAgo !== last?.daysAgo);
                const rate = totalLetters > 0 ? appearances / totalLetters : 0;
                const fractionTone = rate >= 0.5 ? GP.ink : rate >= 0.1 ? GP.muted : GP.faint;
                const cls = partRenderClass(part);
                // Ask-question: only for companions that passed the gate but
                // we don't have a yes/no from the user yet. Confirmed shows a
                // quiet tag; dismissed-active companions are filtered upstream
                // by `companionInKeeper`, so they don't reach this render.
                const showAsk = cls === "companion" && confirmStatus === "qualified";
                const isConfirmed = confirmStatus === "confirmed";
                return (
                  <div key={part.id} style={S.partCard}>
                    <div style={{
                      ...S.partGlyph,
                      ...glyphStyleFor(part, cls),
                      color: part.color,
                    }}>
                      {part.glyph}
                    </div>
                    <div style={S.partBody}>
                      <div style={S.partName}>{part.name}</div>
                      <div style={S.partDesc}>{part.desc}</div>
                      {showAsk && (
                        <ConfirmAsk
                          partId={part.id}
                          onConfirm={onConfirm}
                        />
                      )}
                      {isConfirmed && (
                        <div style={S.confirmedTag}>you confirmed this</div>
                      )}
                    </div>
                    <div style={S.partState}>
                      <span style={{ color: fractionTone, fontWeight: 500 }}>
                        {appearances} of {totalLetters} letters
                      </span>
                      <span style={S.partStateMeta}>
                        · {last ? `last ${compressDays(last.daysAgo)}` : "not yet noticed"}
                        {hasFirst && (
                          <span style={S.partStateFirst}> · first met {compressDays(first.daysAgo)}</span>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}

// "yesterday" / "12d ago" compressed. Used in the calibration list and as the
// suffix for first-met framing — keeps card meta lines tight.
function metaPhrase(daysAgo) {
  if (daysAgo === 0) return "earlier today";
  if (daysAgo === 1) return "yesterday";
  return `${daysAgo} days ago`;
}

function compressDays(daysAgo) {
  if (daysAgo === 0) return "today";
  if (daysAgo === 1) return "yesterday";
  return `${daysAgo}d ago`;
}

// Count distinct YYYY-MM-DD entries in history. Uses the shared ymdISO
// helper so the day-keys here match every other Set keyed by day across
// the codebase (parts-stats.js, Patterns.jsx, etc).
function countUniqueDays(history) {
  if (!Array.isArray(history)) return 0;
  const days = new Set();
  for (const e of history) {
    const d = new Date(e?.date);
    if (!isNaN(d.getTime())) days.add(ymdISO(d));
  }
  return days.size;
}

function glyphBgFor(part) {
  // Soft circle behind each glyph, tinted to its accent color.
  const map = {
    [GP.leaf]:  "rgba(63,91,57,0.10)",
    [GP.moss]:  "rgba(106,138,92,0.10)",
    [GP.sage]:  "rgba(163,184,138,0.18)",
    [GP.bloom]: "rgba(201,134,96,0.10)",
    [GP.sepia]: "rgba(112,91,60,0.10)",
  };
  return { background: map[part.color] || "rgba(149,142,132,0.12)" };
}

// Visual contract for the glyph circle. Protectors stay filled (their
// driver-grounded status is the "always counts" claim). Companions get an
// outlined circle with a transparent fill — same hue, lighter weight, signals
// that they earn their place by appearing.
function glyphStyleFor(part, cls) {
  if (cls === "companion") {
    return {
      background: "transparent",
      border: `1px solid ${part.color}55`,
    };
  }
  return glyphBgFor(part);
}

// User-in-the-loop ask: "does this part visit you?" with two quiet buttons.
// Only rendered for companions that passed the algorithmic gate but don't
// yet have a yes/no answer from the user. Renders nothing if there's no
// `onConfirm` handler — defensive against parents that haven't wired it.
function ConfirmAsk({ partId, onConfirm }) {
  if (typeof onConfirm !== "function") return null;
  return (
    <div style={S.confirmAsk}>
      <span style={S.confirmAskQuestion}>Does this part visit you?</span>
      <div style={S.confirmAskBtns}>
        <button
          type="button"
          onClick={() => onConfirm(partId, "confirmed")}
          style={S.confirmYes}
        >
          yes, often
        </button>
        <button
          type="button"
          onClick={() => onConfirm(partId, "dismissed")}
          style={S.confirmNo}
        >
          not yet
        </button>
      </div>
    </div>
  );
}

// Tiny mono caption that sits between the part name and its description.
// Two pieces of information: which kind, and how Ori knows about it.
function KindTag({ cls }) {
  if (cls === "protector") {
    return (
      <div style={S.kindTagProtector}>
        PROTECTOR <span style={S.kindTagSep}>·</span> DRIVER-GROUNDED
      </div>
    );
  }
  if (cls === "companion") {
    return (
      <div style={S.kindTagCompanion}>
        COMPANION <span style={S.kindTagSep}>·</span> LINGUISTIC
      </div>
    );
  }
  return null;
}

function stateColor(tone) {
  if (tone === "resting") return { color: GP.moss };
  if (tone === "dormant") return { color: GP.faint };
  return { color: GP.faint };
}

/* ───────────────────────── styles ───────────────────────── */

const S = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 220,
    background: GP.bg, overflowY: "auto",
    paddingTop: "env(safe-area-inset-top, 0px)",
  },
  inner: {
    maxWidth: 620, margin: "0 auto",
    padding: "28px 24px 80px",
    fontFamily: "'Source Serif 4', Georgia, serif",
    color: GP.ink,
  },
  closeBtn: {
    background: "none", border: "none",
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
    color: GP.moss, cursor: "pointer", padding: "6px 8px 16px 0",
    minHeight: 44, minWidth: 44, textAlign: "left",
  },
  title: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontStyle: "italic", fontWeight: 400, fontSize: 26,
    letterSpacing: -0.3, margin: "0 0 6px",
  },
  subtitle: {
    fontSize: 13, color: GP.muted, margin: "0 0 10px", lineHeight: 1.65,
  },
  softNote: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontStyle: "italic", fontWeight: 300,
    fontSize: 14, color: "rgba(45,42,36,0.5)", lineHeight: 1.55,
    margin: "0 0 24px", maxWidth: 480,
  },

  // Met today (set aside)
  metToday: {
    background: "rgba(106,138,92,0.05)",
    border: "1px solid rgba(106,138,92,0.18)",
    borderRadius: 12, padding: "14px 16px 16px", marginBottom: 28,
  },
  metCap: {
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
    color: GP.moss, marginBottom: 4,
    display: "flex", justifyContent: "space-between", alignItems: "baseline",
  },
  metMeta: { color: GP.muted, fontWeight: 400 },
  metLine: { fontSize: 12.5, color: GP.muted, marginBottom: 12, fontStyle: "italic" },
  metRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  metPill: {
    background: GP.paper, border: `1px solid ${GP.line}`,
    borderRadius: 18, padding: "6px 12px",
    display: "inline-flex", alignItems: "baseline", gap: 6,
  },
  // Companion variant of the "noticed today" pill — outlined, no paper fill.
  metPillCompanion: {
    background: "transparent",
    borderStyle: "dashed",
    borderColor: GP.bloom + "55",
  },
  metGlyph: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontStyle: "italic", fontSize: 14, lineHeight: 1, color: GP.leaf,
  },
  metName: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontStyle: "italic", fontSize: 12.5, color: GP.ink,
  },

  // Rest of garden
  restCap: {
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
    color: GP.bloom, margin: "0 0 14px",
  },
  emptyRest: {
    fontSize: 13, color: GP.muted, lineHeight: 1.7,
    padding: "16px 14px", border: `1px dashed ${GP.line}`,
    borderRadius: 10, fontStyle: "italic",
  },
  partCard: {
    display: "grid",
    gridTemplateColumns: "44px minmax(0, 1fr)",
    gridTemplateAreas: '"glyph body" "glyph meta"',
    columnGap: 16, rowGap: 6, alignItems: "start",
    padding: "18px 0", borderBottom: `1px solid ${GP.hair}`,
  },
  partGlyph: {
    gridArea: "glyph",
    width: 44, height: 44, borderRadius: "50%",
    display: "grid", placeItems: "center",
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    fontWeight: 400, fontSize: 22,
  },
  partBody: { gridArea: "body", minWidth: 0 },
  partName: {
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    fontWeight: 500, fontSize: 16,
    letterSpacing: "-0.005em",
    color: GP.ink,
    lineHeight: 1.25, marginBottom: 4,
  },
  // Tiny mono kind label (sits between name and desc). Protectors get
  // moss; companions get bloom — semantic color coding so the difference
  // is legible at a glance, not just from reading the words.
  kindTagProtector: {
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 8.5, letterSpacing: 1.6, textTransform: "uppercase",
    color: GP.moss, marginBottom: 6,
  },
  kindTagCompanion: {
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 8.5, letterSpacing: 1.6, textTransform: "uppercase",
    color: GP.bloom, marginBottom: 6,
  },
  kindTagSep: { color: GP.faint, margin: "0 2px" },
  partDesc: {
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    fontWeight: 400, fontSize: 13.5, lineHeight: 1.65, color: GP.muted,
  },

  // User-in-the-loop ask block (Phase #6). Sits below the part description,
  // quiet enough to read past if the user isn't ready to answer. Two
  // outlined buttons — yes is moss (affirming, "carries weight"); no is
  // bloom (warm, "we'll come back to it").
  confirmAsk: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: `1px dashed ${GP.line}`,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  confirmAskQuestion: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontStyle: "italic",
    fontSize: 13,
    color: GP.muted,
    lineHeight: 1.5,
  },
  confirmAskBtns: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  confirmYes: {
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    background: "transparent",
    color: GP.moss,
    border: `1px solid ${GP.moss}55`,
    borderRadius: 999,
    padding: "8px 14px",
    cursor: "pointer",
    minHeight: 36,
  },
  confirmNo: {
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    background: "transparent",
    color: GP.bloom,
    border: `1px solid ${GP.bloom}55`,
    borderRadius: 999,
    padding: "8px 14px",
    cursor: "pointer",
    minHeight: 36,
  },
  confirmedTag: {
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: GP.moss,
    marginTop: 8,
    opacity: 0.85,
  },
  // The "5 of 8 letters · last yesterday · first met 20d ago" line.
  // Lives in the second grid row under body so name + desc get full width
  // on narrow viewports instead of being squeezed by an auto-sized column.
  partState: {
    gridArea: "meta",
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    fontWeight: 400,
    fontSize: 11.5,
    color: GP.muted,
    minWidth: 0,
    textAlign: "left",
    marginTop: 2,
  },
  partStateMeta: {
    display: "inline",
    color: GP.faint,
    marginLeft: 6,
  },
  partStateFirst: {
    color: GP.faint, opacity: 0.85,
  },

  // Hybrid-model disclosure. Sits below subtitle, above any cards.
  // Quiet but explicit — owns the model rather than hiding behind IFS labels.
  hybridNote: {
    border: `1px dashed ${GP.line}`,
    borderRadius: 10,
    padding: "10px 14px",
    margin: "0 0 22px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  hybridCap: {
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 8.5, letterSpacing: 1.8, textTransform: "uppercase",
    color: GP.faint,
  },
  hybridLine: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontSize: 12, lineHeight: 1.65, color: GP.muted,
  },
  // Tiny inline swatches that mirror the actual glyph treatment, so the
  // model-note shows the rule visually rather than describing it abstractly.
  hybridSwatchFilled: {
    display: "inline-block", width: 10, height: 10, borderRadius: "50%",
    background: "rgba(63,91,57,0.18)", verticalAlign: "middle",
    margin: "0 4px", border: "1px solid transparent",
  },
  hybridSwatchOutlined: {
    display: "inline-block", width: 10, height: 10, borderRadius: "50%",
    background: "transparent", verticalAlign: "middle",
    margin: "0 4px", border: `1px solid ${GP.bloom}88`,
  },

  // Calibration card — pre-7-days placeholder. Soft moss tint, italic prose.
  // Same visual language as the "met today" set-aside but quieter.
  calibCard: {
    background: "rgba(106,138,92,0.05)",
    border: "1px solid rgba(106,138,92,0.18)",
    borderRadius: 12, padding: "16px 18px",
    marginBottom: 28,
  },
  calibCap: {
    fontFamily: "'DM Mono', ui-monospace, monospace",
    fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
    color: GP.moss, marginBottom: 6,
  },
  calibLine: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontStyle: "italic", fontSize: 16, lineHeight: 1.5, color: GP.ink,
  },
};
