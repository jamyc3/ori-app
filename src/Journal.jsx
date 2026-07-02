import { Component, Fragment, useState, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import { buildPages } from "./journal-pagination.js";
import {
  JOURNAL_REPO_KEY, loadRepo,
  REFLECT_TIME_KEY,
  repoRemove, timeAgo,
} from "./engine.js";

// ────────────────────────────────────────────────────────────────────────
// Format "HH:MM" (24-hour) into a friendly "9:00 PM" for the brewing copy.
function gpFormatReflectTime(raw) {
  if (!raw || typeof raw !== "string") return null;
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  let h = Number(m[1]);
  const mm = m[2];
  if (Number.isNaN(h) || h < 0 || h > 23) return null;
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${mm} ${suffix}`;
}

// Garden-plot palette (cream paper, ink, moss, bloom). Local to this surface.
const GP = {
  bg: "#F7F3EC", soil: "#E8DFC5", paper: "#FFFCF6", card: "#FFFCF6",
  ink: "#2B2824", leaf: "#3F5B39", moss: "#6A8A5C", sage: "#A3B88A",
  bloom: "#C98660", sepia: "#705B3C", muted: "#958E84", faint: "#B8B09D",
  line: "rgba(45,42,36,0.12)", hair: "rgba(45,42,36,0.07)",
};
const GP_SRC = { image: "Photo", pdf: "PDF", docx: "Word", text: "Text", audio: "Voice" };
const GP_DOW = ["S", "M", "T", "W", "T", "F", "S"];
const GP_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Today's local-date ISO string. Used to keep future months dormant.
function gpTodayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function gpIsFuture(iso) { return !!(iso && iso > gpTodayISO()); }

function gpIsRanged(e) { return !!(e.date && e.dateEnd && e.dateEnd !== e.date); }
function gpFmtRange(startISO, endISO) {
  const s = new Date(startISO + "T12:00:00");
  const e = new Date(endISO + "T12:00:00");
  const sM = s.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const eM = e.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const sD = s.getDate(), eD = e.getDate();
  const sameYear = s.getFullYear() === e.getFullYear();
  const yr = sameYear ? s.getFullYear() : `${s.getFullYear()}–${e.getFullYear()}`;
  if (sM === eM && sameYear) return `${sM} ${sD}–${eD}, ${yr}`;
  return `${sM} ${sD} – ${eM} ${eD}, ${yr}`;
}

// Uppercase meta eyebrow shared by entry rows and day cards.
function gpMetaLabel(entry) {
  const d = entry.date ? new Date(entry.date + "T12:00:00") : null;
  const ranged = gpIsRanged(entry);
  const isCheckin = entry.source === "checkin";
  const src = isCheckin ? "Check-in" : (GP_SRC[entry.source] || "Text");
  if (!d) return `${entry.dateText?.toUpperCase() || "UNDATED"} · ${src.toUpperCase()}`;
  if (isCheckin) {
    const dateStr = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
    const bits = [dateStr];
    if (entry._checkinTime) bits.push(entry._checkinTime);
    if (entry.notes) bits.push(entry.notes.toUpperCase());
    return bits.join(" · ");
  }
  if (ranged) return `${gpFmtRange(entry.date, entry.dateEnd)} · ${src.toUpperCase()}`;
  return `${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase()} · ${src.toUpperCase()}`;
}

function gpFooterLeft(entry) {
  const isCheckin = entry.source === "checkin";
  if (isCheckin) return entry.uploadedAt ? timeAgo(entry.uploadedAt) : "";
  if (entry.notes && entry.uploadedAt) return `${entry.notes} · ${timeAgo(entry.uploadedAt)}`;
  if (entry.notes) return entry.notes;
  if (entry.uploadedAt) return timeAgo(entry.uploadedAt);
  return "";
}

// Defensive body-field resolution. Covers legacy seeds and check-ins.
function gpExtractBody(entry) {
  if (!entry) return "";
  const rc = entry._rawCheckin;
  const candidates = [
    entry.transcription, entry.rawText, entry.text,
    rc && (rc.dayDesc || rc.text || rc.note || rc.body || rc.content || rc.message || rc.entry || rc.description || rc.desc || rc.journal),
  ];
  for (const v of candidates) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "";
}

function gpFmtShortDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

// SF-symbols-style line glyphs for the source-type chip on entry cards
// and the day-card eyebrow. Single colour, hairline stroke; sit alongside
// uppercase mono labels in a 16px line-box.
function SourceIcon({ source, size = 11, color }) {
  const stroke = color || GP.sepia;
  const common = { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke, strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" };
  switch (source) {
    case "checkin":
      return (<svg {...common}><circle cx="8" cy="8" r="5.5" /><path d="M5.3 8.4l1.9 1.9 3.6-3.7" /></svg>);
    case "audio":
      return (<svg {...common}><rect x="6.25" y="2.25" width="3.5" height="7.5" rx="1.75" /><path d="M4 8a4 4 0 0 0 8 0" /><path d="M8 12v2" /></svg>);
    case "image":
      return (<svg {...common}><rect x="2" y="3" width="12" height="10" rx="1.5" /><circle cx="5.75" cy="6.75" r="1" /><path d="M2.5 11l3-3 3 3 2-2 4 4" /></svg>);
    case "pdf":
    case "docx":
      return (<svg {...common}><path d="M4 1.5h6l3 3v9.75a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z" /><path d="M10 1.5v3h3M5.5 8.5h5M5.5 11h5" /></svg>);
    default:
      return (<svg {...common}><path d="M2.5 3.75h11M2.5 7.5h11M2.5 11.25h7" /></svg>);
  }
}

// ─── View switcher — persistent at top of every screen ─────────────────
function ViewSwitcher({ view, onChange }) {
  const seg = (key, label) => {
    const active = view === key;
    return (
      <button
        type="button"
        key={key}
        onClick={() => onChange(key)}
        aria-pressed={active}
        style={{
          padding: "7px 16px",
          borderRadius: 999,
          border: "none",
          background: active ? GP.paper : "transparent",
          color: active ? GP.ink : GP.muted,
          fontFamily: "var(--fm)",
          fontSize: 10.5,
          fontWeight: active ? 700 : 600,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          cursor: "pointer",
          boxShadow: active
            ? "0 1px 2px rgba(45,42,36,0.08), 0 0 0 0.5px rgba(45,42,36,0.06), inset 0 0.5px 0 rgba(255,255,255,0.7)"
            : "none",
          transition: "background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease",
        }}
      >{label}</button>
    );
  };
  return (
    <div role="tablist" aria-label="Journal view" style={{
      display: "inline-flex",
      background: "rgba(45,42,36,0.06)",
      borderRadius: 999,
      padding: 3,
      boxShadow: "inset 0 0.5px 1px rgba(45,42,36,0.04)",
    }}>
      {seg("day", "Day")}
      {seg("month", "Month")}
      {seg("year", "Year")}
    </div>
  );
}

// ─── Date bucket — one card per date in Month view's list ─────────────
// Header column = date hero (MAY · 22 · TUE). Right column = count +
// source-type glyphs + preview line + "Read day →" CTA. Tapping anywhere
// on the bucket routes to Day view of that date, where the entries flow
// as one continuous letter.
function DateBucket({ dateGroup, onOpen }) {
  const [pressed, setPressed] = useState(false);
  const { date, entries } = dateGroup;
  const d = new Date(date + "T12:00:00");
  const moStr = d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const dayStr = d.getDate();
  const wkStr = d.toLocaleDateString("en-US", { weekday: "short" });
  const count = entries.length;

  // Distinct source types in this date group, up to 3 icons. Multi-icon
  // implies "this day had voice + text + check-in" at a glance.
  const seen = new Set();
  const iconSources = [];
  for (const e of entries) {
    const s = e?.source || "text";
    if (!seen.has(s)) {
      seen.add(s);
      iconSources.push(s);
      if (iconSources.length >= 3) break;
    }
  }

  // Preview from the newest entry on this date.
  const previewBody = gpExtractBody(entries[0] || {});
  const preview = previewBody.length > 180 ? previewBody.slice(0, 180).trimEnd() + "…" : previewBody;
  const fullDayLabel = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      aria-label={`Read day · ${fullDayLabel} · ${count} reading${count === 1 ? "" : "s"}`}
      style={{
        display: "grid", gridTemplateColumns: "72px 1fr", gap: 10,
        padding: "14px 16px",
        marginBottom: 10,
        width: "100%", textAlign: "left",
        background: GP.paper, border: `0.5px solid ${GP.hair}`, borderRadius: 14,
        boxShadow: pressed
          ? "0 1px 2px rgba(45,42,36,0.05)"
          : "0 1px 2px rgba(45,42,36,0.04), 0 4px 12px -4px rgba(45,42,36,0.08)",
        transform: pressed ? "scale(0.985)" : "scale(1)",
        transition: "transform 0.14s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.14s ease",
        cursor: "pointer", color: "inherit", fontFamily: "inherit",
      }}
    >
      <div style={{
        paddingRight: 10,
        borderRight: `0.5px solid ${GP.hair}`,
        display: "flex", flexDirection: "column", alignItems: "flex-start",
        paddingTop: 2,
      }}>
        <div style={{ fontFamily: "var(--fm)", fontSize: 9.5, letterSpacing: 1.4, color: GP.moss, fontWeight: 700 }}>{moStr}</div>
        <div style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 32, color: GP.ink, lineHeight: 0.95, letterSpacing: -0.5, marginTop: 1 }}>{dayStr}</div>
        <div style={{ fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.4, color: GP.faint, marginTop: 4, textTransform: "uppercase" }}>{wkStr}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{
            fontFamily: "var(--fm)", fontSize: 9.5, letterSpacing: 1.4, color: GP.sepia,
            textTransform: "uppercase", fontWeight: 700,
          }}>{count} reading{count === 1 ? "" : "s"}</span>
          <span style={{ display: "inline-flex", gap: 5, color: GP.sepia, alignItems: "center" }}>
            {iconSources.map((src, i) => <SourceIcon key={i} source={src} size={11} />)}
          </span>
        </div>
        {preview ? (
          <div style={{
            fontFamily: "var(--fb)", fontSize: 13.5, lineHeight: 1.5, color: GP.ink,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            marginBottom: 8,
          }}>{preview}</div>
        ) : (
          <div style={{
            fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 13, color: GP.muted,
            marginBottom: 8,
          }}>(no body saved)</div>
        )}
        <span style={{
          fontFamily: "var(--fm)", fontSize: 9.5, letterSpacing: 1.4, color: GP.moss, fontWeight: 700,
          textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 4,
          alignSelf: "flex-end",
        }}>Read day <span style={{ fontFamily: "var(--fb)", fontSize: 14 }}>→</span></span>
      </div>
    </button>
  );
}

// ─── Volunteer entry — undated row in Volunteer Plants pages ──────────
// No date column, no "Read day" CTA (the entry has no date). Inline ⋯
// menu for Uproot. Body shown up to ~3 lines (volunteer plants are rare;
// keeping them visible avoids forcing a tap to read).
function VolunteerEntry({ entry, onRemove }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef(null);
  const srcLabel = GP_SRC[entry.source] || "Text";
  const body = gpExtractBody(entry);
  const shown = body.length > 320 ? body.slice(0, 320).trimEnd() + "…" : body;

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false);
    };
    const keyer = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyer);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyer);
    };
  }, [menuOpen]);

  return (
    <div ref={wrapRef} style={{
      position: "relative",
      padding: "14px 16px",
      marginBottom: 10,
      background: GP.paper, border: `0.5px solid ${GP.hair}`, borderRadius: 14,
      boxShadow: "0 1px 2px rgba(45,42,36,0.04), 0 4px 12px -4px rgba(45,42,36,0.08)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: GP.sepia, minWidth: 0, flex: 1 }}>
          <SourceIcon source={entry.source} size={11} />
          <span style={{
            fontFamily: "var(--fm)", fontSize: 9.5, letterSpacing: 1.4, fontWeight: 700,
            textTransform: "uppercase",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>Volunteer · {srcLabel}</span>
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={() => setMenuOpen(v => !v)}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            style={{
              width: 30, height: 30, borderRadius: 15, background: "transparent",
              border: "none", padding: 0, cursor: "pointer",
              display: "grid", placeItems: "center", color: GP.bloom, fontSize: 18, lineHeight: 1,
              flexShrink: 0,
            }}
          >⋯</button>
        )}
        {menuOpen && onRemove && (
          <div role="menu" style={{
            position: "absolute", right: 12, top: 40,
            background: GP.paper, border: `0.5px solid ${GP.line}`,
            borderRadius: 10, boxShadow: "0 12px 28px rgba(28,24,20,0.2)",
            minWidth: 180, padding: 6, zIndex: 5,
          }}>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                if (window.confirm("Uproot this? It can't come back.")) {
                  onRemove(entry.id);
                }
              }}
              style={{
                width: "100%", textAlign: "left",
                padding: "12px 14px", minHeight: 44,
                background: "transparent", border: "none", borderRadius: 6,
                fontFamily: "var(--fb)", fontSize: 14, color: "#B0553A",
                cursor: "pointer", letterSpacing: 0, textTransform: "none",
              }}
            >Uproot</button>
          </div>
        )}
      </div>
      {shown ? (
        <div style={{
          fontFamily: "var(--fb)", fontSize: 14, lineHeight: 1.6, color: GP.ink,
          whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>{shown}</div>
      ) : (
        <div style={{ fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 14, color: GP.muted }}>
          (no body saved)
        </div>
      )}
    </div>
  );
}

// ─── Page end line — closes each Month/Volunteer page with a static
// footer instead of dead paper. Three label shapes:
//   { lbl: "Continued · page 2 of 3", nxt: null, onTap: fn }
//   { lbl: "End of May",              nxt: "Older · April", onTap: fn }
//   { lbl: "End of journal",          nxt: null, onTap: null }
function PageEndLine({ pageEnd }) {
  if (!pageEnd) return null;
  const interactive = !!pageEnd.onTap;
  return (
    <button
      type="button"
      onClick={pageEnd.onTap || undefined}
      disabled={!interactive}
      style={{
        margin: "6px 22px 22px",
        display: "flex", alignItems: "center", gap: 10,
        padding: "14px 0 6px",
        width: "calc(100% - 44px)",
        borderTop: `0.5px dashed ${GP.line}`,
        background: "transparent", border: "none", borderTopStyle: "dashed",
        borderTopWidth: "0.5px", borderTopColor: GP.line,
        cursor: interactive ? "pointer" : "default",
        fontFamily: "inherit", textAlign: "left",
      }}
    >
      <span aria-hidden="true" style={{
        fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 13, color: GP.bloom,
      }}>❦</span>
      <span style={{
        flex: 1, fontFamily: "var(--fm)", fontSize: 9.5, letterSpacing: 1.6, color: GP.sepia,
        textTransform: "uppercase", fontWeight: 600,
      }}>{pageEnd.lbl}</span>
      {pageEnd.nxt && (
        <span style={{
          fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 13.5, color: GP.ink,
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          {pageEnd.nxt}
          <span aria-hidden="true" style={{ color: GP.bloom, fontFamily: "var(--fb)", fontSize: 14 }}>→</span>
        </span>
      )}
    </button>
  );
}

// ─── Entry section — one entry inside Day view's flowing letter ───────
// Time + source eyebrow on the left, ⋯ menu on the right, full body
// below. The first entry in the day's flow gets an italic drop-cap on
// the body's first character.
function EntrySection({ entry, isFirst, onRemove }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef(null);
  const body = gpExtractBody(entry);
  const isCheckin = entry.source === "checkin";
  const srcLabel = isCheckin ? "Check-in" : (GP_SRC[entry.source] || "Text");
  const timeStr = entry._checkinTime || "";
  const ebrowText = timeStr ? `${timeStr} · ${srcLabel}` : srcLabel;

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false);
    };
    const keyer = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyer);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyer);
    };
  }, [menuOpen]);

  const showDropCap = isFirst && !!body;
  const firstChar = showDropCap ? body.charAt(0) : "";
  const restBody = showDropCap ? body.slice(1) : body;

  return (
    <div ref={wrapRef} style={{ position: "relative", padding: "6px 0 4px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: GP.sepia, minWidth: 0, flex: 1 }}>
          <SourceIcon source={entry.source} size={11} />
          <span style={{
            fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 1.5, fontWeight: 700,
            textTransform: "uppercase",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{ebrowText}</span>
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={() => setMenuOpen(v => !v)}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            style={{
              width: 30, height: 30, borderRadius: 15, background: "transparent",
              border: "none", padding: 0, cursor: "pointer",
              display: "grid", placeItems: "center", color: GP.bloom, fontSize: 18, lineHeight: 1,
              flexShrink: 0,
            }}
          >⋯</button>
        )}
        {menuOpen && onRemove && (
          <div role="menu" style={{
            position: "absolute", right: 0, top: 36,
            background: GP.paper, border: `0.5px solid ${GP.line}`,
            borderRadius: 10, boxShadow: "0 12px 28px rgba(28,24,20,0.2)",
            minWidth: 180, padding: 6, zIndex: 5,
          }}>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                if (window.confirm("Uproot this? It can't come back.")) {
                  onRemove(entry.id);
                }
              }}
              style={{
                width: "100%", textAlign: "left",
                padding: "12px 14px", minHeight: 44,
                background: "transparent", border: "none", borderRadius: 6,
                fontFamily: "var(--fb)", fontSize: 14, color: "#B0553A",
                cursor: "pointer", letterSpacing: 0, textTransform: "none",
              }}
            >Uproot</button>
          </div>
        )}
      </div>
      {body ? (
        <div style={{
          fontFamily: "var(--fb)", fontSize: 16, lineHeight: 1.7, color: GP.ink,
          whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>
          {showDropCap && (
            <span style={{
              float: "left",
              fontFamily: "var(--fd)", fontStyle: "italic",
              fontSize: 52, lineHeight: 0.88,
              marginRight: 9, marginTop: 3,
              color: GP.bloom,
            }}>{firstChar}</span>
          )}
          {restBody}
        </div>
      ) : (
        <div style={{
          fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 14, color: GP.muted, lineHeight: 1.55,
        }}>(no body text saved)</div>
      )}
    </div>
  );
}

// ─── Entry separator — the ❦ that sits between entries in Day view ────
function EntrySep() {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      gap: 10, padding: "20px 0 16px",
    }}>
      <span style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${GP.line} 30%, ${GP.line} 70%, transparent)` }} />
      <span aria-hidden="true" style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 14, color: GP.bloom }}>❦</span>
      <span style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${GP.line} 30%, ${GP.line} 70%, transparent)` }} />
    </div>
  );
}

// ─── Day view — the day as one continuous letter ─────────────────────
// All entries for the focused date flow together with ❦ separators;
// drop-cap on the first entry. Optional "Read this day" CTA at the top
// (delegates to onAnalyze, which sends the day's combined text to the
// daily-reading pipeline in CPI).
function DayView({
  date, entries, isToday, todayLetter, reflectPretty, todaysSeedsCount,
  onJumpToMonth, onRemove, onAnalyze,
  prevDate, nextDate, onPrevDay, onNextDay,
}) {
  const dateObj = new Date(date + "T12:00:00");
  const weekday = dateObj.toLocaleDateString("en-US", { weekday: "long" });
  const dateLabel = dateObj.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const monthName = GP_MONTH_NAMES[dateObj.getMonth()];
  const showTending = isToday && !todayLetter;
  const canAnalyze = !!onAnalyze && entries.length > 0;

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      background: GP.bg,
    }}>
      <div style={{ padding: "12px 22px 0" }}>
        <button
          type="button"
          onClick={onJumpToMonth}
          aria-label={`Back to ${monthName}`}
          style={{
            background: "transparent", border: "none", padding: 0, cursor: "pointer",
            fontFamily: "var(--fm)", fontSize: 10.5, letterSpacing: 1.8, textTransform: "uppercase",
            color: GP.moss, fontWeight: 700,
          }}>
          <span style={{ color: GP.sepia, marginRight: 6 }}>{monthName} ›</span>{weekday}
        </button>
      </div>
      <div style={{ padding: "10px 22px 6px", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10 }}>
        <div style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 44, color: GP.ink, lineHeight: 0.95, letterSpacing: -1.1, flex: 1, minWidth: 0 }}>{dateLabel}</div>
        <div style={{ fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.4, color: GP.moss, textAlign: "right", fontWeight: 700, textTransform: "uppercase", flexShrink: 0 }}>
          <div>Planted</div>
          <div style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 20, color: GP.ink, letterSpacing: 0, fontWeight: 400 }}>{entries.length}</div>
        </div>
      </div>

      {canAnalyze && (
        <div style={{ padding: "10px 22px 0" }}>
          <button
            type="button"
            onClick={() => {
              const combined = entries.map(gpExtractBody).filter(Boolean).join("\n\n");
              onAnalyze(combined);
            }}
            style={{
              padding: "9px 16px", minHeight: 36, borderRadius: 18,
              background: GP.moss, color: "#fff", border: "none",
              fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 1.4,
              textTransform: "uppercase", fontWeight: 700, cursor: "pointer",
            }}
          >Read this day</button>
        </div>
      )}

      <div style={{ padding: "18px 22px 28px", flex: 1 }}>
        {showTending && <TendingCard reflectPretty={reflectPretty} todaysSeedsCount={todaysSeedsCount} />}

        {entries.length === 0 && !showTending && (
          <div style={{
            padding: "60px 0 40px", textAlign: "center",
            fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 14.5, color: GP.muted,
          }}>
            <div style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 22, color: GP.faint, marginBottom: 6 }}>—</div>
            No readings on this day.
          </div>
        )}

        {entries.map((e, idx) => (
          <Fragment key={e.id}>
            <EntrySection entry={e} isFirst={idx === 0} onRemove={onRemove} />
            {idx < entries.length - 1 && <EntrySep />}
          </Fragment>
        ))}
      </div>

      <div style={{
        position: "sticky", bottom: 0,
        padding: "8px 14px calc(8px + env(safe-area-inset-bottom, 0px))",
        background: GP.bg, borderTop: `0.5px solid ${GP.hair}`,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <button
          type="button"
          onClick={prevDate ? onPrevDay : undefined}
          disabled={!prevDate}
          aria-label={prevDate ? `Go to ${prevDate}` : "No earlier reading"}
          style={{
            background: "transparent", border: "none", padding: "12px 10px",
            cursor: prevDate ? "pointer" : "default",
            color: prevDate ? GP.sepia : GP.faint,
            fontFamily: "var(--fm)", fontSize: 10.5, letterSpacing: 1.4, fontWeight: 600,
            minHeight: 44, borderRadius: 8,
          }}
        >← {gpFmtShortDate(prevDate)}</button>
        <button
          type="button"
          onClick={nextDate ? onNextDay : undefined}
          disabled={!nextDate}
          aria-label={nextDate ? `Go to ${nextDate}` : "No later reading"}
          style={{
            background: "transparent", border: "none", padding: "12px 10px",
            cursor: nextDate ? "pointer" : "default",
            color: nextDate ? GP.sepia : GP.faint,
            fontFamily: "var(--fm)", fontSize: 10.5, letterSpacing: 1.4, fontWeight: 600,
            minHeight: 44, borderRadius: 8,
          }}
        >{gpFmtShortDate(nextDate)} →</button>
      </div>
    </div>
  );
}

// ─── Tending card — moss-tinted gradient with glowing pulse ───────────
// Shown in Day view (today + no letter yet) and as a card in Month
// view's current-month-first entries list.
function TendingCard({ reflectPretty, todaysSeedsCount }) {
  return (
    <div style={{
      padding: "16px 18px",
      background: "linear-gradient(135deg, rgba(106,138,92,0.10), rgba(106,138,92,0.04))",
      border: "0.5px solid rgba(106,138,92,0.22)",
      borderRadius: 14,
      marginBottom: 14,
      display: "flex", alignItems: "center", gap: 14,
      boxShadow: "0 1px 2px rgba(106,138,92,0.04), 0 4px 12px -4px rgba(106,138,92,0.10)",
    }}>
      <span aria-hidden="true" style={{
        width: 10, height: 10, borderRadius: "50%", background: GP.moss,
        boxShadow: "0 0 0 4px rgba(106,138,92,0.18), 0 0 12px rgba(106,138,92,0.50)",
        animation: "tending-pulse 2.2s ease-in-out infinite",
        flex: "0 0 10px",
      }} />
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: "var(--fm)", fontSize: 9.5, letterSpacing: 1.5, color: GP.moss,
          textTransform: "uppercase", fontWeight: 700, marginBottom: 3,
        }}>Today's letter</div>
        <div style={{
          fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 13.5, color: GP.muted,
          lineHeight: 1.5,
        }}>
          A reading is being tended. Arrives at {reflectPretty}.
          {todaysSeedsCount > 0 ? ` ${todaysSeedsCount} seed${todaysSeedsCount === 1 ? "" : "s"} so far.` : ""}
        </div>
      </div>
    </div>
  );
}

// ─── Month calendar — hairline-grid cells, today as filled moss circle,
// up to three leaf-coloured event dots per content day. Empty past
// days are non-interactive; future days are dim and disabled.
function MonthCalendar({ year, month, monthEntries, onTapDay }) {
  const todayIso = gpTodayISO();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const dayCounts = new Map();
  for (const e of monthEntries) {
    if (e?.date) dayCounts.set(e.date, (dayCounts.get(e.date) || 0) + 1);
  }

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push({ blank: true, key: `b${i}` });
  for (let d = 1; d <= daysInMonth; d++) {
    const ymd = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({
      key: ymd, day: d, ymd,
      count: dayCounts.get(ymd) || 0,
      isToday: ymd === todayIso,
      isFuture: ymd > todayIso,
    });
  }
  // Pad trailing blanks so the last row completes its bottom border.
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let i = 0; i < trailing; i++) cells.push({ blank: true, key: `t${i}` });

  const cellBorder = `0.5px solid ${GP.hair}`;
  const headBorder = `0.5px solid ${GP.line}`;

  return (
    <div style={{ padding: "18px 22px 10px" }}>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
        borderTop: headBorder, borderLeft: cellBorder,
        borderRadius: 8, overflow: "hidden",
        background: "rgba(45,42,36,0.015)",
      }}>
        {GP_DOW.map((l, i) => (
          <div key={`h${i}`} style={{
            fontFamily: "var(--fm)", fontSize: 9.5, color: GP.muted,
            textAlign: "center", letterSpacing: 1.6, fontWeight: 700,
            padding: "8px 0 7px",
            borderRight: cellBorder, borderBottom: headBorder,
            textTransform: "uppercase",
          }}>{l}</div>
        ))}
        {cells.map(c => {
          const base = {
            aspectRatio: "1 / 1",
            borderRight: cellBorder, borderBottom: cellBorder,
            padding: 0,
          };
          if (c.blank) return <div key={c.key} style={base} />;
          const tappable = !c.isFuture && (c.count > 0 || c.isToday);
          const numColor = c.isToday ? "#fff"
            : c.isFuture ? GP.faint
            : c.count > 0 ? GP.ink
            : GP.muted;
          const dots = Math.min(c.count, 3);
          return (
            <button
              key={c.key}
              type="button"
              onClick={tappable ? () => onTapDay(c.ymd) : undefined}
              disabled={!tappable}
              aria-label={`${GP_MONTH_NAMES[month]} ${c.day}${c.isToday ? ", today" : ""}${c.count > 0 ? `, ${c.count} reading${c.count === 1 ? "" : "s"}` : c.isFuture ? ", upcoming" : ""}`}
              style={{
                ...base,
                background: "transparent",
                border: 0,
                borderRight: cellBorder, borderBottom: cellBorder,
                cursor: tappable ? "pointer" : "default",
                opacity: c.isFuture ? 0.45 : 1,
                position: "relative",
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "flex-start",
                paddingTop: 6, gap: 0,
                transition: "background 0.12s ease",
              }}
              onMouseEnter={(e) => { if (tappable) e.currentTarget.style.background = "rgba(106,138,92,0.05)"; }}
              onMouseLeave={(e) => { if (tappable) e.currentTarget.style.background = "transparent"; }}
            >
              {c.isToday ? (
                <span style={{
                  width: 26, height: 26, borderRadius: "50%",
                  background: GP.moss, color: numColor,
                  display: "grid", placeItems: "center",
                  fontFamily: "var(--fm)", fontSize: 12, fontWeight: 700,
                  boxShadow: "0 1px 3px rgba(106,138,92,0.30)",
                }}>{c.day}</span>
              ) : (
                <span style={{
                  fontFamily: "var(--fm)", fontSize: 12, color: numColor,
                  fontWeight: c.count > 0 ? 600 : 400,
                  padding: "4px 0 0",
                }}>{c.day}</span>
              )}
              {dots > 0 && (
                <span aria-hidden="true" style={{
                  position: "absolute", bottom: 5, left: 0, right: 0,
                  display: "flex", justifyContent: "center", gap: 2.5,
                }}>
                  {Array.from({ length: dots }).map((_, i) => (
                    <span key={i} style={{
                      width: 4, height: 4, borderRadius: "50%",
                      background: c.isToday ? "rgba(255,255,255,0.85)" : GP.leaf,
                    }} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// One page of the book. Month-first carries the calendar; continuations
// and volunteer pages skip it. Brewing-letter card is injected only on
// the current-month-first page when today's letter hasn't generated yet.
// No min-height — each page ends with a PageEndLine right under the
// last bucket (Continued · Older · or End of journal).
function MonthPage({
  page, isCurrentMonth, todayLetter, reflectPretty, todaysSeedsCount,
  onTapDay, onOlderMonth, onNewerMonth, pageEnd,
}) {
  const isMonth = page.kind === "month-first" || page.kind === "month-continue";
  const isVolunteer = page.kind === "volunteer-first" || page.kind === "volunteer-continue";
  const showCalendar = page.kind === "month-first";
  const showTending = page.kind === "month-first" && isCurrentMonth && !todayLetter;
  const dateGroups = page.dateGroupsOnThisPage || [];

  // Shared style for the inline ‹ / › month-step chevrons.
  const chevStyle = (enabled) => ({
    width: 30, height: 30, borderRadius: 15,
    background: "transparent", border: "none", padding: 0,
    cursor: enabled ? "pointer" : "default",
    color: enabled ? GP.sepia : GP.faint,
    opacity: enabled ? 1 : 0.35,
    display: "grid", placeItems: "center",
    fontFamily: "var(--fb)", fontSize: 22, lineHeight: 1,
    flexShrink: 0,
    transition: "background 0.15s ease",
  });

  let header = null;
  if (isMonth) {
    const monthName = GP_MONTH_NAMES[page.month];
    header = (
      <div style={{ padding: "18px 22px 4px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
            <button
              type="button"
              onClick={onOlderMonth || undefined}
              disabled={!onOlderMonth}
              aria-label="Previous month"
              style={chevStyle(!!onOlderMonth)}
              onMouseEnter={(e) => { if (onOlderMonth) e.currentTarget.style.background = "rgba(45,42,36,0.05)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >‹</button>
            <div style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 48, color: GP.ink, lineHeight: 0.95, letterSpacing: -1.2, padding: "0 4px" }}>{monthName}</div>
            <button
              type="button"
              onClick={onNewerMonth || undefined}
              disabled={!onNewerMonth}
              aria-label="Next month"
              style={chevStyle(!!onNewerMonth)}
              onMouseEnter={(e) => { if (onNewerMonth) e.currentTarget.style.background = "rgba(45,42,36,0.05)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >›</button>
          </div>
          <div style={{ fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.4, color: GP.moss, textAlign: "right", fontWeight: 700, textTransform: "uppercase", flexShrink: 0 }}>
            <div>Planted</div>
            <div style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 20, color: GP.ink, letterSpacing: 0, fontWeight: 400 }}>{page.monthTotalEntries}</div>
          </div>
        </div>
        {page.kind === "month-continue" && (
          <div style={{ marginTop: 8, fontFamily: "var(--fm)", fontSize: 9.5, letterSpacing: 1.5, color: GP.sepia, fontWeight: 600 }}>
            Continued · page {page.pageOfMonth} of {page.totalPagesOfMonth}
          </div>
        )}
      </div>
    );
  } else if (isVolunteer) {
    header = (
      <div style={{ padding: "18px 22px 4px" }}>
        <div style={{ padding: "14px 16px", background: `repeating-linear-gradient(45deg, ${GP.paper}, ${GP.paper} 10px, ${GP.soil}80 10px, ${GP.soil}80 11px)`, border: `0.5px solid ${GP.line}`, borderRadius: 10 }}>
          <div style={{ fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 1.8, color: GP.bloom, fontWeight: 700 }}>VOLUNTEER PLANTS</div>
          <div style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 26, color: GP.ink, marginTop: 3, letterSpacing: -0.4 }}>Self-seeded</div>
          {page.totalPagesOfVolunteer > 1 && (
            <div style={{ fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.4, color: GP.muted, marginTop: 4, fontWeight: 600 }}>
              Page {page.pageOfVolunteer} of {page.totalPagesOfVolunteer}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      flex: "0 0 100%",
      scrollSnapAlign: "start",
      display: "flex", flexDirection: "column",
      background: GP.bg,
    }}>
      {header}

      {showCalendar && (
        <MonthCalendar
          year={page.year}
          month={page.month}
          monthEntries={page.monthAllEntries}
          onTapDay={onTapDay}
        />
      )}

      <div style={{ position: "relative", height: 22, margin: "14px 22px 8px", display: "flex", alignItems: "center" }}>
        <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${GP.line} 20%, ${GP.line} 80%, transparent)` }} />
        <span style={{ margin: "0 12px", fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 16, color: GP.bloom }}>❦</span>
        <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${GP.line} 20%, ${GP.line} 80%, transparent)` }} />
      </div>

      <div style={{ padding: "0 22px 4px" }}>
        <div style={{ fontFamily: "var(--fm)", fontSize: 9.5, letterSpacing: 1.6, color: GP.sepia, textTransform: "uppercase", marginBottom: 10, display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
          <span>Readings{isMonth ? ` · ${GP_MONTH_NAMES[page.month]}` : ""}</span>
          <span>
            {isMonth
              ? `${dateGroups.length} day${dateGroups.length === 1 ? "" : "s"}`
              : `${page.entriesOnThisPage.length}`}
          </span>
        </div>

        {showTending && <TendingCard reflectPretty={reflectPretty} todaysSeedsCount={todaysSeedsCount} />}

        {isVolunteer ? (
          page.entriesOnThisPage.length === 0 ? (
            <div style={{ fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 14, color: GP.muted, padding: "20px 0" }}>
              No undated entries.
            </div>
          ) : (
            page.entriesOnThisPage.map(e => (
              <VolunteerEntry key={e.id} entry={e} />
            ))
          )
        ) : (
          dateGroups.length === 0 && !showTending ? (
            <div style={{ fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 14, color: GP.muted, padding: "20px 0" }}>
              No readings yet this month.
            </div>
          ) : (
            dateGroups.map(g => (
              <DateBucket key={g.date} dateGroup={g} onOpen={() => onTapDay(g.date)} />
            ))
          )
        )}
      </div>

      <PageEndLine pageEnd={pageEnd} />
    </div>
  );
}

const MonthPager = forwardRef(function MonthPager({
  pages, indexOfTargetMonth, todayLetter, reflectPretty, todaysSeedsCount,
  currentMonth, currentYear, onTapDay,
}, ref) {
  const scrollerRef = useRef(null);
  // The page currently snapped under the viewport. Seeded from the parent's
  // target so the dot strip is correct on first paint, then updated by the
  // scroll listener as the user swipes between months.
  const [visiblePageIdx, setVisiblePageIdx] = useState(indexOfTargetMonth);

  useImperativeHandle(ref, () => ({
    goToPage: (idx) => {
      const el = scrollerRef.current;
      if (!el) return;
      el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
    },
  }), []);

  // Land on the target month whenever it changes (mount or parent-driven
  // context shift). The scroll listener below will then mirror the new
  // position back into visiblePageIdx.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollLeft = indexOfTargetMonth * el.clientWidth;
    setVisiblePageIdx(indexOfTargetMonth);
  }, [indexOfTargetMonth]);

  // Mirror swipe-driven scroll into state so the month strip's active dot
  // tracks the page the user is actually looking at. rAF-throttled to keep
  // the work cheap during inertial scrolls.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    let raf = null;
    const onScroll = () => {
      if (raf != null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const w = el.clientWidth;
        if (w > 0) setVisiblePageIdx(Math.round(el.scrollLeft / w));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, []);

  const monthMarks = [];
  pages.forEach((p, i) => {
    if (p.kind === "month-first") monthMarks.push({ idx: i, year: p.year, month: p.month });
  });

  // Continuation pages share a dot with their month-first parent — walk
  // back from the visible page to the nearest month-first index.
  let activeMonthIdx = monthMarks[0]?.idx ?? 0;
  for (const m of monthMarks) {
    if (m.idx <= visiblePageIdx) activeMonthIdx = m.idx;
    else break;
  }

  // Helper: smooth-scroll the pager to a specific page index. Shared by
  // the inline ‹ / › chevrons, the bottom dot strip, and the page-end
  // footer's "Older · ${month} →" / "Continued · page X →" links.
  const scrollToPage = (idx) => {
    const el = scrollerRef.current;
    if (el) el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
  };

  // Compute the page-end footer payload for every page. Three shapes:
  //   - Continued · page X+1 of N   (more pages within this month)
  //   - End of {Month} · Older · {prev-month}   (last page of month, older exists)
  //   - End of journal              (last page, nothing older)
  // Volunteer pages get their own continuation chain ending in "End of journal".
  const pageEndFor = (page, i) => {
    if (page.kind === "month-first" || page.kind === "month-continue") {
      if (page.pageOfMonth < page.totalPagesOfMonth) {
        return {
          lbl: `Continued · page ${page.pageOfMonth + 1} of ${page.totalPagesOfMonth}`,
          nxt: null,
          onTap: () => scrollToPage(i + 1),
        };
      }
      const monthName = GP_MONTH_NAMES[page.month];
      const next = pages[i + 1];
      if (next && next.kind === "month-first") {
        return {
          lbl: `End of ${monthName}`,
          nxt: `Older · ${GP_MONTH_NAMES[next.month]}`,
          onTap: () => scrollToPage(i + 1),
        };
      }
      if (next && next.kind === "volunteer-first") {
        return {
          lbl: `End of ${monthName}`,
          nxt: "Volunteer plants",
          onTap: () => scrollToPage(i + 1),
        };
      }
      return { lbl: `End of ${monthName} · end of journal`, nxt: null, onTap: null };
    }
    if (page.kind === "volunteer-first" || page.kind === "volunteer-continue") {
      if (page.pageOfVolunteer < page.totalPagesOfVolunteer) {
        return {
          lbl: `Continued · page ${page.pageOfVolunteer + 1} of ${page.totalPagesOfVolunteer}`,
          nxt: null,
          onTap: () => scrollToPage(i + 1),
        };
      }
      return { lbl: "End of journal", nxt: null, onTap: null };
    }
    return null;
  };

  return (
    <div style={{ position: "relative", background: GP.bg, display: "flex", flexDirection: "column" }}>
      <div
        ref={scrollerRef}
        style={{
          display: "flex",
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          width: "100%",
          WebkitOverflowScrolling: "touch",
          flex: 1,
        }}
      >
        {pages.map((p, i) => {
          const isCurrent = p.kind === "month-first" && p.month === currentMonth && p.year === currentYear;
          // Position of this page's month-first in monthMarks. Pages are
          // ordered current→oldest, so monthMarks[k+1] is OLDER than
          // monthMarks[k] (the "‹ Previous month" target), and [k-1] is
          // NEWER (the "Next month ›" target).
          let myMonthPos = -1;
          for (let k = 0; k < monthMarks.length; k++) {
            if (monthMarks[k].idx <= i) myMonthPos = k;
            else break;
          }
          const olderIdx = myMonthPos >= 0 && myMonthPos < monthMarks.length - 1
            ? monthMarks[myMonthPos + 1].idx : null;
          const newerIdx = myMonthPos > 0 ? monthMarks[myMonthPos - 1].idx : null;
          return (
            <MonthPage
              key={i}
              page={p}
              isCurrentMonth={isCurrent}
              todayLetter={todayLetter}
              reflectPretty={reflectPretty}
              todaysSeedsCount={todaysSeedsCount}
              onTapDay={onTapDay}
              onOlderMonth={olderIdx != null ? () => scrollToPage(olderIdx) : null}
              onNewerMonth={newerIdx != null ? () => scrollToPage(newerIdx) : null}
              pageEnd={pageEndFor(p, i)}
            />
          );
        })}
      </div>
      {monthMarks.length > 0 && (
        <div style={{ position: "sticky", bottom: 0, padding: "4px 14px 10px", background: GP.bg, borderTop: `1px solid ${GP.hair}`, display: "flex", justifyContent: "center", gap: 0 }}>
          {monthMarks.map((m, i) => (
            <button
              key={i}
              type="button"
              onClick={() => scrollToPage(m.idx)}
              style={{
                width: 28, height: 44, minHeight: 44,
                display: "grid", placeItems: "center",
                background: "transparent", border: "none", cursor: "pointer", padding: 0,
              }}
              aria-label={`Go to ${GP_MONTH_NAMES[m.month]} ${m.year}`}
            >
              <span style={{
                display: "block",
                width: 18, height: 3,
                background: m.idx === activeMonthIdx ? GP.leaf : GP.hair,
                borderRadius: 1,
              }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

// ─── Year view — 12-tile bed grid, density-shaded ────────────────────
function YearView({ entries, year, onSelectMonth }) {
  const counts = Array(12).fill(0);
  let total = 0;
  let monthsWithContent = 0;
  for (const e of entries) {
    if (!e?.date) continue;
    const [y, m] = e.date.split("-").map(Number);
    if (y !== year) continue;
    counts[m - 1]++;
    total++;
  }
  counts.forEach(c => { if (c > 0) monthsWithContent++; });
  const max = Math.max(1, ...counts);
  const now = new Date();
  const isCurrentYear = year === now.getFullYear();
  const currentM = now.getMonth();
  const stillOpen = isCurrentYear ? (currentM + 1) - monthsWithContent : 12 - monthsWithContent;

  return (
    <div style={{
      background: GP.bg,
      padding: "16px 22px 30px",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6 }}>
        <div style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 30, color: GP.ink, letterSpacing: -0.5 }}>{year}</div>
        <div style={{ fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.4, color: GP.moss, textAlign: "right" }}>
          <div>PLANTED</div>
          <div style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 17, color: GP.ink, letterSpacing: 0 }}>{total}</div>
        </div>
      </div>
      <div style={{ fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.4, color: GP.sepia, marginBottom: 18, textTransform: "uppercase" }}>
        {monthsWithContent} month{monthsWithContent === 1 ? "" : "s"} tended
        {stillOpen > 0 ? ` · ${stillOpen} still open` : ""}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {Array.from({ length: 12 }).map((_, i) => {
          const c = counts[i];
          const isCurrent = isCurrentYear && i === currentM;
          const isFuture = isCurrentYear && i > currentM;
          const intensity = c > 0 ? 0.10 + Math.min(0.34, (c / max) * 0.34) : 0;
          if (isFuture) {
            return (
              <div key={i} aria-hidden="true" style={{
                aspectRatio: "1 / 1", border: `1px dashed ${GP.hair}`, borderRadius: 6,
                padding: 10, display: "flex", flexDirection: "column", justifyContent: "space-between", opacity: 0.6,
              }}>
                <div style={{ fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.4, color: GP.faint }}>
                  {GP_MONTH_NAMES[i].slice(0,3).toUpperCase()}
                </div>
                <div style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 14, color: GP.faint }}>—</div>
              </div>
            );
          }
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelectMonth(i)}
              aria-label={`${GP_MONTH_NAMES[i]} — ${c} reading${c === 1 ? "" : "s"}`}
              style={{
                aspectRatio: "1 / 1",
                background: c > 0 ? `rgba(106,138,92,${intensity})` : GP.card,
                border: isCurrent ? `1.5px solid ${GP.moss}` : `1px solid ${GP.hair}`,
                borderRadius: 6,
                padding: 10,
                cursor: "pointer",
                display: "flex", flexDirection: "column", justifyContent: "space-between",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              <div style={{ fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.4, color: isCurrent ? GP.moss : GP.sepia }}>
                {GP_MONTH_NAMES[i].slice(0,3).toUpperCase()}
              </div>
              <div style={{ fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 22, color: isCurrent ? GP.moss : (c > 0 ? GP.ink : GP.faint) }}>
                {c > 0 ? c : "—"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Error boundary — if anything inside throws (a malformed entry, a bad
// date), show a recoverable UI instead of blanking the tab.
export class JournalErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    // eslint-disable-next-line no-console
    console.error("Journal render error:", err, info);
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: "32px 22px", border: "1px solid var(--ln)", borderRadius: 12, background: "var(--cd)", textAlign: "center", fontFamily: "var(--fb)" }}>
          <div style={{ fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 1.8, textTransform: "uppercase", color: "var(--mt)", marginBottom: 14 }}>
            Couldn't open this seed
          </div>
          <div style={{ fontSize: 14, color: "var(--fg)", lineHeight: 1.55, marginBottom: 20 }}>
            Something went wrong reading the journal. Your seeds are still saved — close this and try again.
          </div>
          <button
            type="button"
            onClick={() => this.setState({ err: null })}
            style={{ padding: "8px 18px", background: "var(--fg)", color: "var(--bg)", border: "none", borderRadius: 999, fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}
          >Try again</button>
          {this.state.err?.message && (
            <details style={{ marginTop: 18, fontFamily: "var(--fm)", fontSize: 10, color: "var(--mt)", textAlign: "left" }}>
              <summary style={{ cursor: "pointer" }}>Technical detail</summary>
              <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, fontSize: 10 }}>{String(this.state.err?.message || this.state.err)}</pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Top-level — Day / Month / Year switcher + the three views ────────
export function JournalRepo({ checkins = [], onRemoveCheckin, onAnalyzeDay }) {
  const [repo, setRepo] = useState(() => loadRepo());
  const [view, setView] = useState("month");
  const [contextDate, setContextDate] = useState(() => gpTodayISO());
  const pagerRef = useRef(null);

  // Inject the brewing-pulse keyframes once (inline styles can't define
  // them). The old Reader-sheet keyframes are gone — Day view replaced
  // the modal entirely, so the slide-up / backdrop-fade are no longer
  // referenced anywhere.
  useEffect(() => {
    const id = "ori-journal-keyframes";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @keyframes tending-pulse { 0%, 100% { opacity: 0.55 } 50% { opacity: 1 } }
    `;
    document.head.appendChild(style);
  }, []);

  // letterRevision bumps whenever today's letter is (over)written. Bumping
  // it is what tells the todayLetter memo to re-read localStorage so the
  // "brewing" placeholder stops pulsing once the reading exists.
  const [letterRevision, setLetterRevision] = useState(0);

  // Refresh repo (and re-check today's letter) when another tab writes to
  // localStorage — e.g. Settings import, or a daily reading composed in a
  // second window.
  useEffect(() => {
    const todayLetterKey = `cpi_letter_${gpTodayISO()}`;
    const handler = (e) => {
      if (e.key === JOURNAL_REPO_KEY) setRepo(loadRepo());
      else if (e.key === todayLetterKey) setLetterRevision(r => r + 1);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // Same-tab signal — `storage` events only fire across tabs, so the
  // current-window letter write reaches us via this custom event. Dispatched
  // from CPI.jsx wherever `cpi_letter_*` is written.
  useEffect(() => {
    const handler = () => setLetterRevision(r => r + 1);
    window.addEventListener("cpi:letter-written", handler);
    return () => window.removeEventListener("cpi:letter-written", handler);
  }, []);

  // Today's letter — drives whether the "brewing" placeholder appears.
  const todayLetter = useMemo(() => {
    try {
      const raw = localStorage.getItem(`cpi_letter_${gpTodayISO()}`);
      if (!raw) return null;
      return JSON.parse(raw)?.result?.a?.letter || null;
    } catch { return null; }
  }, [letterRevision]);
  const reflectPretty = useMemo(() => {
    try { return gpFormatReflectTime(localStorage.getItem(REFLECT_TIME_KEY)) || "9:00 PM"; }
    catch { return "9:00 PM"; }
  }, []);

  // Check-ins → unified entry shape so they intermix with imported journals.
  const checkinEntries = useMemo(() => (
    (checkins || []).map((c, idx) => {
      if (!c?.date) return null;
      const dt = new Date(c.date);
      if (isNaN(dt.getTime())) return null;
      const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      const timeStr = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const periodBits = [c.period, c.checkInNum ? `#${c.checkInNum}` : null].filter(Boolean).join(" ");
      const stableId = `ck_${c.date}`.replace(/[^a-zA-Z0-9_-]/g, "_");
      const candidates = [
        c.dayDesc, c.text, c.transcription, c.rawText,
        c.note, c.body, c.content, c.message,
        c.entry, c.description, c.desc, c.journal,
      ];
      let bodyText = "";
      for (const v of candidates) {
        if (typeof v === "string" && v.trim().length > 0) { bodyText = v.trim(); break; }
      }
      return {
        id: stableId, source: "checkin",
        date: iso, dateEnd: null,
        transcription: bodyText,
        notes: periodBits,
        _checkinTime: timeStr, _checkinIndex: idx,
        _rawCheckin: c,
        uploadedAt: c.date,
      };
    }).filter(Boolean)
  ), [checkins]);

  const removeEntry = (id) => {
    if (typeof id === "string" && id.startsWith("ck_")) {
      const ck = checkinEntries.find(e => e.id === id);
      if (ck && onRemoveCheckin) onRemoveCheckin(ck._checkinIndex);
    } else {
      repoRemove(id);
      setRepo(loadRepo());
    }
  };

  const mergedEntries = useMemo(
    () => [...repo.entries, ...checkinEntries],
    [repo.entries, checkinEntries]
  );
  const todayIso = useMemo(() => gpTodayISO(), []);
  const pagesResult = useMemo(
    () => buildPages(mergedEntries, todayIso),
    [mergedEntries, todayIso]
  );

  // Where the Month pager should land. Defaults to the current month;
  // shifts to whichever month the user has navigated to (via Year tile,
  // Day eyebrow, or month-strip dot).
  const indexOfTargetMonth = useMemo(() => {
    const [y, m] = contextDate.split("-").map(Number);
    const idx = pagesResult.pages.findIndex(p =>
      p.kind === "month-first" && p.month === (m - 1) && p.year === y
    );
    return idx >= 0 ? idx : pagesResult.indexOfCurrentMonth;
  }, [contextDate, pagesResult]);

  // All entries on the currently focused day (Day view), sorted by time.
  const dayEntries = useMemo(() => {
    return mergedEntries
      .filter(e => e?.date === contextDate)
      .sort((a, b) => (a.uploadedAt || "").localeCompare(b.uploadedAt || ""));
  }, [mergedEntries, contextDate]);

  // Sorted set of dates with content (past + today) — drives prev/next
  // arrows on Day view.
  const datedDescending = useMemo(() => {
    const set = new Set();
    for (const e of mergedEntries) {
      if (e?.date && e.date <= todayIso) set.add(e.date);
    }
    return Array.from(set).sort();
  }, [mergedEntries, todayIso]);
  const prevDate = useMemo(() => {
    for (let i = datedDescending.length - 1; i >= 0; i--) {
      if (datedDescending[i] < contextDate) return datedDescending[i];
    }
    return null;
  }, [datedDescending, contextDate]);
  const nextDate = useMemo(() => {
    for (const d of datedDescending) {
      if (d > contextDate && d <= todayIso) return d;
    }
    return null;
  }, [datedDescending, contextDate, todayIso]);

  const todaysSeedsCount = useMemo(
    () => mergedEntries.filter(e => e?.date === todayIso).length,
    [mergedEntries, todayIso]
  );

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const isContextToday = contextDate === todayIso;

  const handleSwitch = (next) => {
    if (next === "day" && !contextDate) setContextDate(todayIso);
    setView(next);
  };

  return (
    <div role="region" aria-label="Journal" style={{
      background: GP.bg,
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        padding: "12px 22px",
        background: GP.bg,
        borderBottom: `1px solid ${GP.hair}`,
        display: "flex", justifyContent: "center",
      }}>
        <ViewSwitcher view={view} onChange={handleSwitch} />
      </div>

      {view === "day" && (
        <DayView
          date={contextDate}
          entries={dayEntries}
          isToday={isContextToday}
          todayLetter={todayLetter}
          reflectPretty={reflectPretty}
          todaysSeedsCount={todaysSeedsCount}
          onJumpToMonth={() => setView("month")}
          onRemove={removeEntry}
          onAnalyze={onAnalyzeDay || null}
          prevDate={prevDate}
          nextDate={nextDate}
          onPrevDay={() => prevDate && setContextDate(prevDate)}
          onNextDay={() => nextDate && setContextDate(nextDate)}
        />
      )}

      {view === "month" && (
        <MonthPager
          ref={pagerRef}
          pages={pagesResult.pages}
          indexOfTargetMonth={indexOfTargetMonth}
          todayLetter={todayLetter}
          reflectPretty={reflectPretty}
          todaysSeedsCount={todaysSeedsCount}
          currentMonth={currentMonth}
          currentYear={currentYear}
          onTapDay={(date) => { setContextDate(date); setView("day"); }}
        />
      )}

      {view === "year" && (
        <YearView
          entries={mergedEntries}
          year={currentYear}
          onSelectMonth={(monthIdx) => {
            setContextDate(`${currentYear}-${String(monthIdx + 1).padStart(2, "0")}-01`);
            setView("month");
          }}
        />
      )}
    </div>
  );
}
