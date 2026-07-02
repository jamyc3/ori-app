import { ymdISO, stampMatchesDay } from "./dates.js";
import { pickDailyState, pastReflectTime } from "./cardStates.js";

// "Today's Reading" pinned card. Lives at the top of the Analyze input
// view in both Reflect and Full modes. Always visible, takes one of
// five shapes based on (seeds today, reflect time, today's reading
// status, generating-now). Tap behavior follows the state.

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
  leaf:  "#7B9472",
  moss:  "#4F8A5F",
  bloom: "#D5A38B",
  sepia: "#9C8267",
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

// Detect whether today already has a reading. Uses the history timeline
// (which always stamps entries with date) so the card picks up readings
// even on a fresh page load. Headline preview, when shown, comes from
// LAST_READING_KEY which the analyze flow writes alongside the entry.
const LAST_READING_KEY = "cpi_last_reading";

function todayLetterFrom(history) {
  const todayKey = ymdISO(new Date());
  const entry = (history || []).find(e => stampMatchesDay(e?.date, todayKey));
  if (!entry) return null;
  let letter = null;
  try {
    const raw = localStorage.getItem(LAST_READING_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      if (stored?.date === todayKey) letter = stored?.result?.a?.letter || null;
    }
  } catch { /* ignore */ }
  return { entry, letter };
}

const Chevron = () => (
  <svg width="9" height="14" viewBox="0 0 9 14" style={{ display: "block" }}>
    <path d="M1 1 L7 7 L1 13" stroke={T.faint} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function TodaysReadingCard({
  history = [],
  reflectTime,
  seedsToday = 0,
  mode = "reflect",
  loading = false,
  onOpenLetter,
  onReadNow,
}) {
  const today = todayLetterFrom(history);
  const pastWinding = pastReflectTime(reflectTime);
  const state = pickDailyState({ hasTodayReading: !!today, seedsToday, pastWinding, generating: loading });

  const reflectPretty = fmtPretty(reflectTime);

  // Per-state styling.
  const styles = {
    quiet:        { glyph: "✿", color: T.faint,  ring: T.hair,           tap: false, accentTint: "transparent" },
    anticipating: { glyph: "✿", color: T.leaf,   ring: T.hair,           tap: false, accentTint: "transparent" },
    imminent:     { glyph: "❦", color: T.sepia,  ring: "rgba(184,134,11,0.30)", tap: !!onReadNow, accentTint: "rgba(184,134,11,0.06)" },
    generating:   { glyph: "❀", color: T.bloom,  ring: T.hair,           tap: false, accentTint: "transparent" },
    ready:        { glyph: "❀", color: T.moss,   ring: "rgba(79,138,95,0.22)", tap: true, accentTint: "rgba(79,138,95,0.05)" },
  };
  const s = styles[state];

  // Headline preview for the "ready" state. The letter's headline is a
  // Playfair italic phrase from Claude (e.g., "A long, careful day").
  const headlinePreview = today?.letter?.headline || (today ? "Today's reading" : null);

  // Title and subline by state.
  const lines = (() => {
    switch (state) {
      case "quiet":
        return {
          title: "The garden is quiet today",
          sub:   `Plant a seed and Ori will write at ${reflectPretty}.`,
        };
      case "anticipating":
        return {
          title: `${seedsToday} ${seedsToday === 1 ? "seed" : "seeds"} in the garden`,
          sub:   `Your reading lands at ${reflectPretty}.`,
        };
      case "imminent":
        return {
          title: "Your reading is ready to land",
          sub:   `Tap to read your ${seedsToday} ${seedsToday === 1 ? "seed" : "seeds"}.`,
        };
      case "generating":
        return {
          title: "Writing your reading…",
          sub:   "Ori is reading your day.",
        };
      case "ready":
      default:
        return {
          title: today?.letter?.headline || "Today's reading",
          sub:   today?.letter?.headline ? "Tap to revisit your letter." : "Tap to revisit today's letter.",
        };
    }
  })();

  const handleTap = () => {
    if (state === "ready") onOpenLetter?.();
    else if (state === "imminent") onReadNow?.();
  };

  const isTappable = !!s.tap;

  // Hide the "quiet" state in both modes — the wake-time pill sits in
  // that top-notification slot now, and the bottom "TENDED IN THE QUIET"
  // card already conveys the reflect-time message. Avoids triple-stating.
  if (state === "quiet") return null;
  // Hide entirely in Full mode while there's no data to anchor it. The
  // pinned card matters most in Reflect mode (where readings are
  // auto-scheduled). In Full mode, only show once a reading exists.
  if (mode === "full" && state !== "ready" && state !== "generating") return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <button
        type="button"
        onClick={isTappable ? handleTap : undefined}
        disabled={!isTappable}
        aria-label={isTappable ? lines.title : undefined}
        style={{
          width: "100%",
          textAlign: "left",
          background: state === "ready" || state === "imminent" ? s.accentTint : T.paper,
          border: `1px solid ${s.ring}`,
          borderRadius: 14,
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          cursor: isTappable ? "pointer" : "default",
          transition: "transform 0.15s ease, box-shadow 0.15s ease",
          boxShadow: state === "ready" ? "0 1px 0 rgba(26,26,26,0.02)" : "none",
        }}
        onMouseDown={(e) => { if (isTappable) e.currentTarget.style.transform = "scale(0.995)"; }}
        onMouseUp={(e)   => { e.currentTarget.style.transform = "scale(1)"; }}
        onMouseLeave={(e)=> { e.currentTarget.style.transform = "scale(1)"; }}
      >
        <span style={{
          fontSize: 22, color: s.color, lineHeight: 1, width: 28, textAlign: "center", flexShrink: 0,
          opacity: state === "generating" ? 0.7 : 1,
          animation: state === "generating" ? "tr-pulse 2.4s ease-in-out infinite" : undefined,
        }}>{s.glyph}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: state === "ready" ? fd : fb,
            fontStyle: state === "ready" ? "italic" : "normal",
            fontWeight: state === "ready" ? 400 : 500,
            fontSize: state === "ready" ? 16 : 15,
            color: T.fg, lineHeight: 1.25,
          }}>{lines.title}</div>
          {lines.sub && (
            <div style={{
              fontFamily: fb, fontSize: 13, color: T.muted, lineHeight: 1.45,
              marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              fontStyle: state === "ready" ? "italic" : "normal",
            }}>{lines.sub}</div>
          )}
        </div>
        {isTappable && <Chevron />}
      </button>
      <style>{`
        @keyframes tr-pulse {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50%      { opacity: 1;    transform: scale(1.06); }
        }
      `}</style>
    </div>
  );
}
