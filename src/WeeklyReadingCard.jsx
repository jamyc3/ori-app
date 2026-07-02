import { ymdISO } from "./dates.js";
import { PARTS_LIB } from "./LetterReading.jsx";
import { isoWeekKey, pastReflectTime, pickWeeklyState } from "./cardStates.js";

// Weekly reading card. Sunday-only sibling of TodaysReadingCard. Same
// five-state machine, weekly cadence. Sits beneath the daily card on
// the Analyze input view, but only on Sundays.

const T = {
  bg:    "#F7F3EC",
  paper: "#FBF7EE",
  card:  "#FFFCF3",
  fg:    "#1a1a1a",
  muted: "rgba(26,26,26,0.48)",
  faint: "rgba(26,26,26,0.32)",
  hair:  "rgba(26,26,26,0.08)",
  line:  "rgba(26,26,26,0.12)",
  accent:"#B8860B",
};
const fd = "'Playfair Display', Georgia, serif";
const fb = "'Source Serif 4', Georgia, serif";
const fm = "'DM Mono', ui-monospace, monospace";

function fmtPretty(t) {
  if (!t) return "9:00 PM";
  const [h, m] = String(t).split(":").map(Number);
  if (!Number.isFinite(h)) return "9:00 PM";
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

function loadWeekly() {
  try {
    const key = `cpi_week_letter_${isoWeekKey(new Date())}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

const Chevron = ({ tone = T.faint }) => (
  <svg width="9" height="14" viewBox="0 0 9 14" style={{ display: "block" }}>
    <path d="M1 1 L7 7 L1 13" stroke={tone} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function WeeklyReadingCard({
  reflectTime,
  seedsThisWeek = 0,
  loading = false,
  onOpenLetter,
  onReadNow,
}) {
  const isSunday = new Date().getDay() === 0;
  const weekly = loadWeekly();
  const pastWinding = pastReflectTime(reflectTime);
  const reflectPretty = fmtPretty(reflectTime);

  const state = pickWeeklyState({
    isSunday,
    hasWeekly: !!weekly,
    seedsThisWeek,
    pastWinding,
    generating: loading,
  });
  if (state === null) return null;

  const styles = {
    quiet:        { glyph: "✺", color: T.faint,  ring: T.hair, tap: false, tint: "transparent" },
    anticipating: { glyph: "✺", color: T.accent, ring: T.hair, tap: false, tint: "transparent" },
    imminent:     { glyph: "✺", color: T.accent, ring: "rgba(184,134,11,0.30)", tap: !!onReadNow, tint: "rgba(184,134,11,0.06)" },
    generating:   { glyph: "✺", color: T.accent, ring: T.hair, tap: false, tint: "transparent" },
    ready:        { glyph: "✺", color: T.accent, ring: "rgba(184,134,11,0.30)", tap: true, tint: "rgba(184,134,11,0.05)" },
  };
  const s = styles[state];
  const isTappable = !!s.tap;

  const headline = weekly?.result?.a?.letter?.headline || null;
  const range = weekly?.range || "this week";
  const seedCount = weekly?.seedCount || seedsThisWeek;
  const partsFelt = (() => {
    const parts = weekly?.result?.a?.letter?.parts;
    if (!Array.isArray(parts)) return [];
    return parts.map(p => p?.id).filter(Boolean).slice(0, 4);
  })();

  const lines = (() => {
    switch (state) {
      case "quiet":
        return { eyebrow: "This week", title: "The garden was quiet this week", sub: `Plant a few seeds; your week's letter lands at ${reflectPretty}.` };
      case "anticipating":
        return { eyebrow: "This week", title: `${seedsThisWeek} ${seedsThisWeek === 1 ? "seed" : "seeds"} this week`, sub: `Your week's letter lands at ${reflectPretty}.` };
      case "imminent":
        return { eyebrow: "This week", title: "Your week's reading is ready to land", sub: `Tap to read ${seedsThisWeek} ${seedsThisWeek === 1 ? "seed" : "seeds"} across 7 days.` };
      case "generating":
        return { eyebrow: "This week", title: "Writing your week…", sub: "Ori is reading the past 7 days." };
      case "ready":
      default:
        return { eyebrow: "This week", title: headline || "This week's letter", sub: `${range} · ${seedCount} ${seedCount === 1 ? "seed" : "seeds"}` };
    }
  })();

  const handleTap = () => {
    if (state === "ready") onOpenLetter?.();
    else if (state === "imminent") onReadNow?.();
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <button
        type="button"
        onClick={isTappable ? handleTap : undefined}
        disabled={!isTappable}
        style={{
          width: "100%", textAlign: "left",
          background: state === "ready" || state === "imminent" ? s.tint : T.paper,
          border: `1px solid ${s.ring}`,
          borderRadius: 14, padding: "16px 18px",
          display: "flex", alignItems: "flex-start", gap: 14,
          cursor: isTappable ? "pointer" : "default",
          transition: "transform 0.15s ease",
        }}
        onMouseDown={(e) => { if (isTappable) e.currentTarget.style.transform = "scale(0.995)"; }}
        onMouseUp={(e)   => { e.currentTarget.style.transform = "scale(1)"; }}
        onMouseLeave={(e)=> { e.currentTarget.style.transform = "scale(1)"; }}
      >
        <span style={{
          fontSize: 22, color: s.color, lineHeight: 1, width: 28, textAlign: "center", flexShrink: 0,
          marginTop: 2,
          opacity: state === "generating" ? 0.7 : 1,
          animation: state === "generating" ? "wr-pulse 2.4s ease-in-out infinite" : undefined,
        }}>{s.glyph}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: fm, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted, marginBottom: 4 }}>
            {lines.eyebrow}
          </div>
          <div style={{
            fontFamily: state === "ready" ? fd : fb,
            fontStyle: state === "ready" ? "italic" : "normal",
            fontWeight: state === "ready" ? 400 : 500,
            fontSize: state === "ready" ? 16 : 15,
            color: T.fg, lineHeight: 1.25,
          }}>{lines.title}</div>
          {lines.sub && (
            <div style={{ fontFamily: fb, fontSize: 13, color: T.muted, lineHeight: 1.45, marginTop: 3 }}>{lines.sub}</div>
          )}
          {state === "ready" && partsFelt.length > 0 && (
            <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
              {partsFelt.map((id) => {
                const part = PARTS_LIB[id];
                if (!part) return null;
                return (
                  <span key={id} style={{
                    width: 20, height: 20, borderRadius: 999,
                    border: `1px solid ${T.hair}`, background: T.card,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <span style={{ fontSize: 11, color: part.color, lineHeight: 1 }}>{part.glyph}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
        {isTappable && <Chevron tone={T.accent} />}
      </button>
      <style>{`
        @keyframes wr-pulse {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50%      { opacity: 1;    transform: scale(1.06); }
        }
      `}</style>
    </div>
  );
}
