import { useEffect, useMemo, useRef, useState } from "react";
import {
  GARDEN_NAME_KEY, REFLECT_TIME_KEY, OURA_ACCESS_KEY,
  USER_AGE_KEY, getOrCreateAnonId,
  loadReliabilityStats,
  AH_HWM_KEY, ahSyncWindow, recordAhHwm, mergeAppleHealthIntoHistory,
  pickLatestMeaningfulDay, biometricsFromDayEntry, BIOMETRICS_KEY,
} from "./engine.js";
import ImportJournalSheet from "./ImportJournalSheet.jsx";
import {
  SLEEP_WINDOW_KEY, parseTimeToMinutes, minutesToTime,
} from "./sleep-window.js";
import {
  loadFeeds, addFeed, removeFeed, syncFeed, syncAllFeeds,
  signalsForToday, getFeedEvents,
} from "./calendar.js";
import { LARGE_KEYS, flushStorage } from "./storage.js";
import {
  HONESTY_CLAIMS, HONESTY_GATES, COLD_START_MILESTONES,
  computeCoverage, coldStartStatus,
} from "./honesty-audit.js";
import {
  loadReminder, saveReminder,
  notificationPermission, requestNotificationPermission,
  WHO5_DEFAULT_REMINDER_HOUR,
} from "./who5-reminder.js";
import * as AppleCalendar from "./integrations/apple-calendar.js";
import * as AppleHealth from "./integrations/apple-health.js";

// Phase 3 Settings — quiet index + three floating sheets.
// Visual language matches WelcomeGarden (the app's starting page) so
// Settings feels like a quiet 4th step, not a different app.

const AVATAR_KEY = "cpi_avatar";
const SIGNATURE_KEY = "cpi_signature";
const OURA_HISTORY_KEY = "oura_history_v1";
const LANGUAGE_KEY = "ori_language";

// Languages the picker advertises. Only "en" is wired today; "bn" and
// "hi" appear as in-development placeholders. The picker locks them
// behind a soft state ("in development") rather than hiding them — so
// users see the roadmap commitment without being given a half-built
// option. See ROADMAP.md → Phase 2 for the validation gate that
// unlocks them.
const LANGUAGE_NAMES = {
  en: "English",
  bn: "Bengali",
  hi: "Hindi",
};
const LANGUAGE_STATUS = {
  en: "available",
  bn: "in-development",
  hi: "in-development",
};

// Garden tokens — aligned with WelcomeGarden ink/muted/line.
const T = {
  bg:    "#F7F3EC",
  paper: "#FBF7EE",
  card:  "#FFFCF3",
  fg:    "#1a1a1a",
  muted: "rgba(26,26,26,0.48)",
  faint: "rgba(26,26,26,0.32)",
  hair:  "rgba(26,26,26,0.06)",
  line:  "rgba(26,26,26,0.10)",
  accent:"#B8860B",
  leaf:  "#7B9472",
  moss:  "#4F8A5F",
  sage:  "#A8B89C",
  bloom: "#D5A38B",
  sepia: "#9C8267",
  warn:  "#C4902A",
};
const fd = "'Playfair Display', Georgia, serif";
const fb = "'Source Serif 4', Georgia, serif";
const fm = "'DM Mono', ui-monospace, monospace";

const Sw = {
  eyebrow: { fontFamily: fm, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: T.muted },
  prompt:  { fontFamily: fd, fontWeight: 300, fontSize: 30, lineHeight: 1.15, letterSpacing: "-0.01em", margin: 0, color: T.fg },
  sub:     { fontFamily: fb, fontSize: 14, color: T.muted, lineHeight: 1.55, margin: 0, fontWeight: 400 },
};

// Avatar options — self-energy parts only + decide-for-me.
// Drivers (planner, watcher, seeker, etc) aren't avatar choices because
// they represent activated states, not the You under the noise.
const AVATAR_OPTIONS = [
  { id: "auto",    glyph: "✺", color: T.accent, name: "decide for me", desc: "Ori chooses based on which self-energy showed up most this week." },
  { id: "gentle",  glyph: "❀", color: T.bloom,  name: "the gentle one", desc: "Self-energy. Speaks softly to the other parts. Underneath the noise." },
  { id: "witness", glyph: "❃", color: T.sage,   name: "the witness",    desc: "Self-energy. Watches without judging. Stands behind the day's events." },
  { id: "maker",   glyph: "✾", color: T.moss,   name: "the maker",      desc: "Self-energy. The hand that shapes things. Quiet competence." },
];

// Glossary used by the Help → "What are the eight parts?" expand.
const PARTS_GLOSSARY = [
  { id: "planner",  name: "the planner",     glyph: "✿", color: T.leaf,  desc: "Organizes, lists, anticipates. The voice that sequences the day." },
  { id: "watcher",  name: "the watcher",     glyph: "❉", color: T.leaf,  desc: "Reads the room. Notices how others land. Quiet but always on." },
  { id: "tender",   name: "the tender one",  glyph: "❋", color: T.bloom, desc: "The body's gentle voice. Hunger, soreness, a need for warmth." },
  { id: "seeker",   name: "the seeker",      glyph: "❁", color: T.moss,  desc: "Chases small bright things. The reach for stimulation, novelty, reward." },
  { id: "hesitant", name: "the hesitant one",glyph: "❦", color: T.sepia, desc: "Steps aside from friction. Sometimes useful, sometimes a wall." },
  { id: "gentle",   name: "the gentle one",  glyph: "❀", color: T.bloom, desc: "Self-energy. Speaks softly to the other parts. Underneath the noise." },
  { id: "witness",  name: "the witness",     glyph: "❃", color: T.sage,  desc: "Self-energy. Watches without judging." },
  { id: "maker",    name: "the maker",       glyph: "✾", color: T.moss,  desc: "Self-energy. The hand that shapes things. Quiet competence." },
];

// "Decide for me" resolver. Scans the last 7 days of letter history for
// self-energy parts and picks the most-surfaced. Falls back to gentle.
function resolveAutoAvatar(history = []) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const counts = { gentle: 0, witness: 0, maker: 0 };
  for (const h of history) {
    if (!h || !Array.isArray(h.letterParts)) continue;
    const t = new Date(h.date).getTime();
    if (Number.isFinite(t) && t < cutoff) continue;
    for (const p of h.letterParts) {
      if (counts[p?.id] != null) counts[p.id] += 1;
    }
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] === 0) return AVATAR_OPTIONS[1]; // gentle
  return AVATAR_OPTIONS.find(a => a.id === best[0]) || AVATAR_OPTIONS[1];
}

// Display avatar = stored choice, or the auto-resolved one.
function effectiveAvatar(stored, history) {
  if (!stored || stored === "auto") return resolveAutoAvatar(history);
  return AVATAR_OPTIONS.find(a => a.id === stored) || AVATAR_OPTIONS[0];
}

// ============================================================
// Shared bits
// ============================================================
const Eyebrow = ({ children, style }) => (
  <div style={{ ...Sw.eyebrow, ...style }}>{children}</div>
);
const Hairline = ({ inset = 0 }) => (
  <div style={{ height: 1, background: T.hair, marginLeft: inset }} />
);
const Chevron = () => (
  <svg width="8" height="13" viewBox="0 0 8 13" style={{ display: "block" }}>
    <path d="M1 1 L7 6.5 L1 12" stroke={T.faint} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const StatusDot = ({ tone = "moss" }) => {
  const c = tone === "moss" ? T.moss : tone === "warn" ? T.warn : tone === "alert" ? "#B0553A" : T.faint;
  return <span style={{ width: 6, height: 6, borderRadius: 999, background: c, display: "inline-block", marginRight: 6 }} />;
};

function fmtTime(t) {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  if (!Number.isFinite(h)) return null;
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

// ============================================================
// Sheet shell — floating modal scaffolding
// ============================================================
function SheetShell({ onClose, title, children }) {
  return (
    <div
      data-modal-open="true"
      data-no-swipe="true"
      style={{
      position: "fixed", inset: 0,
      background: "rgba(26,26,26,0.32)",
      backdropFilter: "blur(6px)",
      WebkitBackdropFilter: "blur(6px)",
      zIndex: 220,
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: "calc(36px + env(safe-area-inset-top, 0px))",
          left: 12, right: 12,
          bottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
          maxWidth: 520, margin: "0 auto",
          background: T.bg, borderRadius: 24,
          boxShadow: "0 30px 60px rgba(0,0,0,0.18)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 20px", borderBottom: `1px solid ${T.hair}`,
          background: T.bg,
        }}>
          <h2 style={{ fontFamily: fd, fontStyle: "italic", fontWeight: 300, fontSize: 22, margin: 0, color: T.fg }}>{title}</h2>
          <button
            onClick={onClose}
            style={{
              border: 0, background: "transparent", cursor: "pointer",
              fontFamily: fm, fontSize: 13, letterSpacing: "0.08em", color: T.muted,
              padding: "10px 12px", minWidth: 60, minHeight: 44,
            }}
          >Done</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: "env(safe-area-inset-bottom, 0px)", WebkitOverflowScrolling: "touch" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Index screen
// ============================================================
function IndexScreen({ onClose, goTo, profile }) {
  const reflectPretty = fmtTime(profile.reflectTime) || "9:00 PM";
  // Current language label for the Settings row subtitle. Read fresh
  // each render so the row reflects an in-session change without needing
  // a global event. Only "en" is wired today; future codes show their
  // English name from LANGUAGE_NAMES.
  const langCode = (() => {
    try { return localStorage.getItem("ori_language") || "en"; } catch { return "en"; }
  })();
  const langName = LANGUAGE_NAMES[langCode] || "English";

  const rows = [
    { id: "profile",       glyph: profile.avatar.glyph, glyphColor: profile.avatar.color, label: "Profile",        sub: `${profile.name || "Unnamed garden"} · winding at ${reflectPretty}` },
    { id: "language",      glyph: "❀",                  glyphColor: T.leaf,               label: "Language",       sub: langName },
    { id: "importJournal", glyph: "✍",                  glyphColor: T.sepia,              label: "Import journal", sub: "Paste · upload · import .json · till under" },
    { id: "connections",   glyph: "⚯",                  glyphColor: T.muted,              label: "Connections",    sub: "Wearables — Oura · Apple Health" },
    { id: "help",          glyph: "❦",                  glyphColor: T.sepia,              label: "Help",           sub: "How Ori works · what to tap where" },
    { id: "about",         glyph: "✦",                  glyphColor: T.leaf,               label: "About Ori",      sub: "What this is, in one page · easy to share",  href: "/about.html" },
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: T.bg,
      paddingTop: "env(safe-area-inset-top, 0px)",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
      overflowY: "auto",
    }}>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "8px 24px 60px", position: "relative" }}>
        {/* Done button — top-right, matches sheet shell language */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 22 }}>
          <button
            onClick={onClose}
            style={{
              border: 0, background: "transparent", cursor: "pointer",
              fontFamily: fm, fontSize: 13, letterSpacing: "0.08em", color: T.muted,
              padding: "10px 12px", minWidth: 60, minHeight: 44,
            }}
          >Done</button>
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{ ...Sw.eyebrow, marginBottom: 22 }}>Settings</div>
          <h1 style={Sw.prompt}>A few small things to tend.</h1>
          <p style={{ ...Sw.sub, marginTop: 12, maxWidth: 320, marginLeft: "auto", marginRight: "auto" }}>
            Most days you won't need to come here.
          </p>
        </div>

        <div style={{
          marginTop: 48, textAlign: "left",
          background: T.paper, borderRadius: 16, border: `1px solid ${T.hair}`, overflow: "hidden",
        }}>
          {rows.map((r, i) => (
            <div key={r.id}>
              <button
                onClick={() => {
                  if (r.href) window.open(r.href, "_blank", "noopener,noreferrer");
                  else goTo(r.id);
                }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 14,
                  padding: "18px 18px", border: 0, background: "transparent", cursor: "pointer", textAlign: "left",
                }}
              >
                <span style={{ fontSize: 22, color: r.glyphColor, lineHeight: 1, width: 28, textAlign: "center" }}>{r.glyph}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: fb, fontSize: 16, color: T.fg, lineHeight: 1.2 }}>{r.label}</div>
                  <div style={{ fontFamily: fb, fontSize: 13, color: T.muted, lineHeight: 1.4, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.sub}</div>
                </div>
                <Chevron />
              </button>
              {i < rows.length - 1 && <Hairline inset={60} />}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 56, textAlign: "center" }}>
          <Eyebrow style={{ fontSize: 9 }}>ori · v0.4</Eyebrow>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Profile sheet
// ============================================================
function ModeSegmented({ value, onChange }) {
  const opts = [
    { id: "full",    label: "Full",    desc: "Biometric-led" },
    { id: "reflect", label: "Reflect", desc: "Journal-led"   },
  ];
  return (
    <div style={{
      display: "flex", gap: 4, padding: 3,
      background: T.card, border: `1px solid ${T.hair}`, borderRadius: 8,
    }}>
      {opts.map(o => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange?.(o.id)}
            style={{
              flex: 1, padding: "8px 10px", borderRadius: 6,
              background: active ? T.fg : "transparent",
              color: active ? T.bg : T.fg,
              border: "none", cursor: "pointer",
              fontFamily: fm, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
              display: "flex", flexDirection: "column", gap: 2, alignItems: "center",
              minHeight: 40,
            }}
          >
            <span style={{ fontWeight: 600 }}>{o.label}</span>
            <span style={{ fontSize: 9, opacity: 0.75, letterSpacing: "0.04em", textTransform: "none" }}>{o.desc}</span>
          </button>
        );
      })}
    </div>
  );
}

function ProfileSheet({ onClose, profile, setProfile, history, mode, onModeChange }) {
  const [picking, setPicking] = useState(false);
  // Stored value is the id ("auto" | "gentle" | ...). The displayed avatar
  // comes from effectiveAvatar() which resolves "auto" to the most-surfaced
  // self-energy from history.
  const displayed = profile.avatar;

  const update = (next) => setProfile(next);

  return (
    <SheetShell onClose={onClose} title="Profile">
      <div style={{ padding: "8px 24px 32px" }}>
        {/* Avatar */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: 4, marginBottom: 8 }}>
          <button
            onClick={() => setPicking(p => !p)}
            style={{
              width: 110, height: 110, borderRadius: 999,
              border: `1px solid ${T.hair}`,
              background: T.paper,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
              boxShadow: "inset 0 0 30px rgba(45,42,36,0.03)",
            }}
            aria-label="Change avatar"
          >
            <span style={{ fontSize: 56, color: displayed.color, lineHeight: 1 }}>{displayed.glyph}</span>
          </button>
        </div>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <Eyebrow>{profile.avatarId === "auto" ? "ori is choosing for you" : "tap to choose"}</Eyebrow>
          <div style={{ fontFamily: fb, fontSize: 13, color: T.muted, marginTop: 6, fontStyle: "italic" }}>
            {displayed.name}
          </div>
        </div>

        {picking && (
          <div style={{
            marginTop: 18, padding: "14px 12px",
            background: T.card, borderRadius: 14, border: `1px solid ${T.hair}`,
          }}>
            <Eyebrow style={{ padding: "0 4px 8px" }}>self-energy</Eyebrow>
            {AVATAR_OPTIONS.map((a, i) => {
              const active = profile.avatarId === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => { update({ ...profile, avatarId: a.id }); setPicking(false); }}
                  style={{
                    padding: "12px 8px", border: 0, cursor: "pointer",
                    background: active ? "rgba(125,146,114,0.10)" : "transparent",
                    borderRadius: 10,
                    display: "flex", alignItems: "flex-start", gap: 12, textAlign: "left",
                    width: "100%",
                    marginBottom: i < AVATAR_OPTIONS.length - 1 ? 2 : 0,
                  }}
                >
                  <span style={{ fontSize: 22, color: a.color, lineHeight: 1, width: 24, textAlign: "center", marginTop: 1 }}>{a.glyph}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: fd, fontStyle: "italic", fontSize: 14.5, color: T.fg }}>{a.name}</div>
                    <div style={{ fontFamily: fb, fontSize: 12.5, color: T.muted, lineHeight: 1.45, marginTop: 2 }}>{a.desc}</div>
                  </div>
                  {active && <span style={{ fontFamily: fm, fontSize: 10, color: T.moss, marginTop: 2 }}>✓</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Fields */}
        <div style={{ marginTop: 32 }}>
          <FieldRow label="Name">
            <input
              value={profile.name}
              onChange={(e) => update({ ...profile, name: e.target.value })}
              placeholder="your garden"
              style={{
                border: 0, outline: 0, background: "transparent",
                fontFamily: fb, fontSize: 16, color: T.fg, textAlign: "right",
                width: 200,
              }}
            />
          </FieldRow>
          <Hairline />
          <FieldRow label="Reflect time" sub="When the day winds down. Ori writes once, then.">
            <input
              type="time"
              value={profile.reflectTime}
              onChange={(e) => update({ ...profile, reflectTime: e.target.value })}
              style={{
                border: 0, outline: 0, background: "transparent",
                fontFamily: fb, fontSize: 16, color: T.fg, textAlign: "right",
              }}
            />
          </FieldRow>
          <Hairline />
          <Who5ReminderRow />
          <Hairline />
          {/* Sleep window — a two-input row. Sub line shifts when device
              data is already covering it, so the user understands they're
              setting a fallback, not the primary source. */}
          <div style={{ padding: "16px 0" }}>
            <div style={{ fontFamily: fb, fontSize: 15, color: T.fg }}>Sleep window</div>
            <div style={{ fontFamily: fb, fontSize: 12, color: T.muted, marginTop: 2, marginBottom: 10 }}>
              {profile.sleepBedTime && profile.sleepWakeTime
                ? "Helps Ori notice your peak hours when Oura or Apple Health isn't filling it in."
                : "Tell Ori roughly when you sleep — used to estimate your sharpest hours and chronotype."}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
              <label style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start" }}>
                <span style={{ fontFamily: "var(--fm)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted, marginBottom: 2 }}>Bed</span>
                <input
                  type="time"
                  value={profile.sleepBedTime}
                  onChange={(e) => update({ ...profile, sleepBedTime: e.target.value })}
                  style={{
                    border: 0, outline: 0, background: "transparent",
                    fontFamily: fb, fontSize: 16, color: T.fg, textAlign: "right",
                  }}
                />
              </label>
              <span style={{ color: T.muted, fontFamily: fb, fontSize: 14 }}>→</span>
              <label style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start" }}>
                <span style={{ fontFamily: "var(--fm)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted, marginBottom: 2 }}>Up</span>
                <input
                  type="time"
                  value={profile.sleepWakeTime}
                  onChange={(e) => update({ ...profile, sleepWakeTime: e.target.value })}
                  style={{
                    border: 0, outline: 0, background: "transparent",
                    fontFamily: fb, fontSize: 16, color: T.fg, textAlign: "right",
                  }}
                />
              </label>
              {(profile.sleepBedTime || profile.sleepWakeTime) && (
                <button
                  type="button"
                  onClick={() => update({ ...profile, sleepBedTime: "", sleepWakeTime: "" })}
                  style={{
                    background: "none", border: 0, cursor: "pointer", padding: 8,
                    fontFamily: "var(--fm)", fontSize: 10, letterSpacing: "0.14em",
                    textTransform: "uppercase", color: T.muted,
                  }}
                >Clear</button>
              )}
            </div>
          </div>
          <Hairline />
          {/* Age — optional, plain number. Used later as an input to
              age-bucketed reference distributions once anonymous data has
              accumulated; not read by HCPI math today. */}
          <FieldRow label="Age" sub="Optional. Lets Ori compare you to people in your age range later.">
            <input
              type="number"
              inputMode="numeric"
              min={5}
              max={120}
              value={profile.userAge || ""}
              onChange={(e) => update({ ...profile, userAge: e.target.value.replace(/[^0-9]/g, "") })}
              placeholder="—"
              style={{
                border: 0, outline: 0, background: "transparent",
                fontFamily: fb, fontSize: 16, color: T.fg, textAlign: "right",
                width: 80,
              }}
            />
          </FieldRow>
          <Hairline />
          {/* Mode — stacked row (label + sub above, segmented control below)
              because the control needs its own visual breathing room. */}
          <div style={{ padding: "16px 0" }}>
            <div style={{ fontFamily: fb, fontSize: 15, color: T.fg }}>Mode</div>
            <div style={{ fontFamily: fb, fontSize: 12, color: T.muted, marginTop: 2, marginBottom: 12 }}>
              How Ori reads you. Full leans on biometrics; Reflect grounds in words alone.
            </div>
            <ModeSegmented value={mode} onChange={onModeChange} />
          </div>
          <Hairline />
          <FieldRow label="Signature" sub="A short line, if you'd like one.">
            <input
              value={profile.signature || ""}
              onChange={(e) => update({ ...profile, signature: e.target.value })}
              placeholder="optional"
              style={{
                border: 0, outline: 0, background: "transparent",
                fontFamily: fb, fontSize: 16, color: T.fg, fontStyle: "italic",
                textAlign: "right", width: 200,
              }}
            />
          </FieldRow>
        </div>

        <div style={{ marginTop: 28 }}>
          <Eyebrow>your garden today</Eyebrow>
          <p style={{ fontFamily: fb, fontSize: 13.5, lineHeight: 1.5, color: T.muted, marginTop: 6 }}>
            Met {profile.metToday} {profile.metToday === 1 ? "part" : "parts"} · {profile.seedsToday} {profile.seedsToday === 1 ? "seed" : "seeds"} since morning.
          </p>
        </div>
      </div>
    </SheetShell>
  );
}

// Daily check-in reminder — opt-in local notification at a chosen
// hour. Decoupled from journal/reflect time on purpose: WHO-5 works
// without a journal, so a user can have one without the other.
//
// PWA constraint: we cannot wake a closed app from the server with-
// out backend infra. What this gets you: a one-shot OS notification
// when you open or focus the app past your chosen hour while WHO-5
// is still empty for the day.
function Who5ReminderRow() {
  const [reminder, setReminder] = useState(() => loadReminder());
  const [perm, setPerm] = useState(() => notificationPermission());
  const hh = String(reminder.hour).padStart(2, "0");
  const timeStr = `${hh}:00`;

  const onHourChange = (e) => {
    const v = e.target.value || "20:00";
    const hour = parseInt(v.split(":")[0], 10);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return;
    setReminder(saveReminder({ hour }));
  };

  const toggleEnabled = async () => {
    if (!reminder.enabled) {
      // Enabling: request permission if not already granted.
      let p = notificationPermission();
      if (p === "default") p = await requestNotificationPermission();
      setPerm(p);
      if (p !== "granted") {
        // Permission denied or unsupported — still let user track preference
        // so they can re-enable from OS settings later, but the helper
        // checks permission at fire time so nothing will actually fire.
        setReminder(saveReminder({ enabled: true }));
        return;
      }
    }
    setReminder(saveReminder({ enabled: !reminder.enabled }));
  };

  const permLine =
    perm === "granted"   ? "Notifications on for this browser."
    : perm === "denied"  ? "Notifications blocked — re-enable from browser settings."
    : perm === "unsupported" ? "This browser doesn't support notifications."
    : "We'll ask for notification permission when you turn this on.";

  return (
    <div style={{ padding: "16px 0" }}>
      <div style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: fb, fontSize: 15, color: T.fg }}>Daily check-in reminder</div>
          <div style={{ fontFamily: fb, fontSize: 12, color: T.muted, marginTop: 2 }}>
            Five quick ones — sent if you haven't logged by your chosen hour.
          </div>
        </div>
        <input
          type="time"
          step="3600"
          value={timeStr}
          onChange={onHourChange}
          aria-label="Reminder hour"
          style={{
            border: 0, outline: 0, background: "transparent",
            fontFamily: fb, fontSize: 16, color: T.fg, textAlign: "right",
          }}
        />
      </div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginTop: 10, gap: 10,
      }}>
        <span style={{ fontFamily: fb, fontSize: 12, color: T.muted, fontStyle: "italic", flex: 1 }}>
          {permLine}
        </span>
        <button
          type="button"
          onClick={toggleEnabled}
          style={{
            background: reminder.enabled ? T.moss : "transparent",
            border: `1px solid ${reminder.enabled ? T.moss : T.line}`,
            borderRadius: 999, padding: "5px 14px",
            fontFamily: fm, fontSize: 10, letterSpacing: "0.10em",
            textTransform: "uppercase", color: reminder.enabled ? T.paper : T.fg,
            cursor: "pointer",
            transition: "background 140ms ease, color 140ms ease",
          }}
        >
          {reminder.enabled ? "On" : "Off"}
        </button>
      </div>
    </div>
  );
}

function FieldRow({ label, sub, children }) {
  return (
    <div style={{ padding: "16px 0", display: "flex", alignItems: "flex-start", gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: fb, fontSize: 15, color: T.fg }}>{label}</div>
        {sub && <div style={{ fontFamily: fb, fontSize: 12, color: T.muted, marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center" }}>{children}</div>
    </div>
  );
}

// ============================================================
// Language sheet
// ============================================================
// Read-only at v1. Shows English as the current language (and only one
// that's wired end-to-end). Bengali + Hindi appear as "in development"
// rows — visible commitment, not a half-built toggle. Phase 2 of the
// roadmap wires Bengali; Hindi follows. See ROADMAP.md.
function LanguageSheet({ onClose }) {
  const current = (() => {
    try { return localStorage.getItem(LANGUAGE_KEY) || "en"; } catch { return "en"; }
  })();

  const options = [
    { code: "en", name: "English" },
    { code: "bn", name: "Bengali" },
    { code: "hi", name: "Hindi"   },
  ];

  return (
    <SheetShell onClose={onClose} title="Language">
      <div style={{
        background: T.paper, border: `1px solid ${T.hair}`, borderRadius: 16, overflow: "hidden",
      }}>
        {options.map((opt, i) => {
          const isCurrent = opt.code === current;
          const isDev = LANGUAGE_STATUS[opt.code] === "in-development";
          return (
            <div key={opt.code}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14,
                padding: "16px 18px",
              }}>
                <span style={{
                  fontFamily: fb, fontSize: 16, lineHeight: 1.25,
                  color: isDev ? T.muted : T.fg,
                  fontWeight: isCurrent ? 500 : 400,
                }}>{opt.name}</span>
                {isCurrent && (
                  <span style={{
                    fontFamily: fb, fontSize: 18, color: T.leaf,
                    lineHeight: 1,
                  }} aria-label="Current language">✓</span>
                )}
              </div>
              {i < options.length - 1 && <Hairline inset={18} />}
            </div>
          );
        })}
      </div>
    </SheetShell>
  );
}

// ============================================================
// Connections sheet
// ============================================================
function ConnectionsSheet({ onClose, onManage }) {
  // Read live status from localStorage so the sheet always shows truth.
  const ouraConnected = typeof window !== "undefined" && !!localStorage.getItem(OURA_ACCESS_KEY);
  const ouraDays = (() => {
    try {
      const raw = localStorage.getItem(OURA_HISTORY_KEY);
      return raw ? Object.keys(JSON.parse(raw)).length : 0;
    } catch { return 0; }
  })();
  const appleHasAny = (() => {
    try {
      const raw = localStorage.getItem(OURA_HISTORY_KEY);
      if (!raw) return false;
      const map = JSON.parse(raw);
      return Object.values(map).some(d => (d?.source || "").toLowerCase() === "apple-health");
    } catch { return false; }
  })();

  const calendarFeeds = (() => {
    try { return loadFeeds(); } catch { return []; }
  })();
  const calendarCount = calendarFeeds.length;

  const isIOS = AppleCalendar.isAvailable();
  const [appleCalendarStatus, setAppleCalendarStatus] = useState(
    typeof localStorage !== "undefined" && localStorage.getItem("apple_calendar_granted") === "true"
      ? "connected"
      : "not connected"
  );

  const onConnectAppleCalendar = async () => {
    setAppleCalendarStatus("requesting…");
    const { granted, reason } = await AppleCalendar.requestPermission();
    if (!granted) {
      setAppleCalendarStatus(`denied (${reason})`);
      return;
    }
    localStorage.setItem("apple_calendar_granted", "true");
    // Fetch last 7 days of events as a smoke test
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const events = await AppleCalendar.getEvents({
      startISO: sevenDaysAgo.toISOString(),
      endISO: now.toISOString(),
    });
    console.log("[apple-calendar] fetched", events.length, "events", events.slice(0, 3));
    // Persist fetched events so engine integration in phase 1 can read them
    try {
      localStorage.setItem(
        "apple_calendar_events",
        JSON.stringify(events.slice(0, 200))
      );
    } catch (e) {
      console.warn("[apple-calendar] could not persist events:", e);
    }
    setAppleCalendarStatus(`connected · ${events.length} events`);
  };

  const [appleHealthStatus, setAppleHealthStatus] = useState(
    typeof localStorage !== "undefined" && localStorage.getItem("apple_health_granted") === "true"
      ? "connected"
      : "not connected"
  );

  const onConnectAppleHealth = async () => {
    const alreadyGranted = typeof localStorage !== "undefined"
      && localStorage.getItem("apple_health_granted") === "true";
    setAppleHealthStatus(alreadyGranted ? "re-syncing…" : "requesting…");
    const { granted, reason } = await AppleHealth.requestPermission();
    if (!granted) {
      setAppleHealthStatus(`denied (${reason})`);
      return;
    }
    localStorage.setItem("apple_health_granted", "true");
    setAppleHealthStatus(alreadyGranted ? "re-syncing…" : "syncing…");
    try {
      // Clear the high-water mark so this tap always pulls the full
      // window, not a 2-day delta. Users who only got a sliver of history
      // on first connect (e.g., the Health app hadn't finalized older
      // sessions yet) can re-tap the row to backfill everything that's
      // since become available.
      try { localStorage.removeItem(AH_HWM_KEY); } catch { /* ignore */ }
      const { start, end } = ahSyncWindow();
      const result = await AppleHealth.appleHealthAggregateRange({ start, end });
      const merged = mergeAppleHealthIntoHistory(result.entries);
      recordAhHwm();
      if (merged.latestDay) {
        const bio = biometricsFromDayEntry(merged.latestDay);
        if (bio) {
          try { localStorage.setItem(BIOMETRICS_KEY, JSON.stringify(bio)); } catch { /* ignore */ }
        }
      }
      // Notify the rest of the app the way the Oura sync does, so the
      // dashboard rings and Signal text re-read from storage without a
      // full page reload.
      window.dispatchEvent(new CustomEvent("cpi:wearable-synced"));
      const dayCount = result.entries.length;
      setAppleHealthStatus(`connected · ${dayCount} day${dayCount === 1 ? "" : "s"}`);
    } catch (err) {
      console.warn("[apple-health] backfill failed:", err);
      setAppleHealthStatus("connected · sync failed");
    }
  };

  const handleItemTap = (id) => {
    if (id === "apple-calendar") {
      onConnectAppleCalendar();
      return;
    }
    if (id === "apple-health" && typeof onConnectAppleHealth === "function") {
      onConnectAppleHealth();
      return;
    }
    onManage?.(id);
  };

  const rows = [
    {
      id: "oura",
      label: "Oura Ring",
      hint: "sleep · HRV · readiness",
      status: ouraConnected ? "connected" : "not connected",
      tone: ouraConnected ? "moss" : "faint",
      sub: ouraConnected && ouraDays > 0 ? `${ouraDays} days of data` : null,
    },
    // ZIP import row — web only. On iOS the native Apple Health row
    // below replaces this; the user shouldn't see two "Apple Health"
    // entries with one of them silently routing them back to the ZIP
    // flow we're trying to retire.
    ...(isIOS ? [] : [{
      id: "apple",
      label: "Apple Health",
      hint: "steps · workouts · sleep",
      status: appleHasAny ? "imported" : "not imported",
      tone: appleHasAny ? "moss" : "faint",
      sub: appleHasAny ? "ZIP imported" : null,
    }]),
    {
      id: "calendar",
      label: "Calendars",
      hint: "meetings · interruption · being-seen",
      status: calendarCount > 0 ? "connected" : "not connected",
      tone: calendarCount > 0 ? "moss" : "faint",
      sub: calendarCount > 0
        ? `${calendarCount} feed${calendarCount === 1 ? "" : "s"}`
        : null,
    },
    ...(isIOS ? [{
      id: "apple-calendar",
      label: "Apple Calendar",
      status: appleCalendarStatus,
      tone: appleCalendarStatus.startsWith("connected") ? "moss" : "faint",
      sub: "Native iOS — replaces ICS upload",
    }] : []),
    ...(isIOS ? [{
      id: "apple-health",
      label: "Apple Health",
      hint: "steps · sleep · HRV · activity",
      status: appleHealthStatus,
      tone: appleHealthStatus.startsWith("connected") ? "moss" : "faint",
      sub: "Native iOS",
    }] : []),
  ];

  return (
    <SheetShell onClose={onClose} title="Connections">
      <div style={{ padding: "16px 24px 32px" }}>
        <Eyebrow style={{ marginBottom: 10 }}>Wearables</Eyebrow>
        <p style={{ ...Sw.sub, margin: "0 0 16px" }}>
          Optional. Ori works on words alone — wearables only deepen the day's reading.
        </p>
        <div style={{ background: T.paper, borderRadius: 12, border: `1px solid ${T.hair}`, overflow: "hidden" }}>
          {rows.map((r, i) => (
            <div key={r.id}>
              <button
                onClick={() => handleItemTap(r.id)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 12,
                  padding: "14px 16px", border: 0, background: "transparent", cursor: "pointer", textAlign: "left",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: fb, fontSize: 15, color: T.fg }}>{r.label}</div>
                  <div style={{ fontFamily: fb, fontSize: 12, color: T.muted, marginTop: 2 }}>
                    {r.sub ? r.sub + " · " : ""}{r.hint}
                  </div>
                </div>
                <span style={{ fontFamily: fm, fontSize: 10, letterSpacing: "0.06em", color: T.muted, textTransform: "uppercase" }}>
                  <StatusDot tone={r.tone} />{r.status}
                </span>
                <Chevron />
              </button>
              {i < rows.length - 1 && <Hairline inset={16} />}
            </div>
          ))}
        </div>
        <p style={{ fontFamily: fb, fontSize: 12, lineHeight: 1.5, color: T.faint, margin: "20px 0 0" }}>
          Connections live on this device only. Ori never uploads your raw biometrics — only a daily summary travels with the day's reading.
        </p>
      </div>
    </SheetShell>
  );
}

// ============================================================
// Calendar sheet — manage feed URLs (Option 1) + future OAuth
// ============================================================
function CalendarSheet({ onClose }) {
  const [feeds, setFeeds] = useState(() => loadFeeds());
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("work");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(null); // "icloud" | "google" | "outlook"
  const [todaySignals, setTodaySignals] = useState(null);

  // Refresh signals whenever feeds change.
  useEffect(() => {
    try { setTodaySignals(signalsForToday()); } catch { setTodaySignals(null); }
  }, [feeds]);

  // Sync all feeds on sheet open. Aggressive on purpose — the user opened
  // the sheet because they want to see fresh state, and parser changes on
  // the server are only visible after a re-fetch. Cheap network call;
  // cheap parse on the server. If the feeds are already fresh, the cost
  // is one round-trip per feed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = loadFeeds();
      for (const f of all) {
        await syncFeed(f.id);
        if (cancelled) return;
      }
      if (!cancelled) setFeeds(loadFeeds());
    })();
    return () => { cancelled = true; };
  }, []);

  const onConnect = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const guessedProvider = trimmed.includes("icloud") ? "icloud"
                             : trimmed.includes("google") ? "google"
                             : trimmed.includes("outlook") || trimmed.includes("office365") ? "microsoft"
                             : "unknown";
      const f = addFeed({
        label: label.trim() || (category === "personal" ? "Personal" : "Work"),
        category, url: trimmed, method: "ics", provider: guessedProvider,
      });
      const r = await syncFeed(f.id);
      setFeeds(loadFeeds());
      setLabel(""); setUrl(""); setCategory("work");
      if (!r.ok) {
        // Sync failed but the feed is saved — the row will show the error.
      }
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = (id) => {
    removeFeed(id);
    setFeeds(loadFeeds());
  };
  const onSyncNow = async (id) => {
    setBusy(true);
    await syncFeed(id);
    setFeeds(loadFeeds());
    setBusy(false);
  };
  const onSyncAll = async () => {
    setBusy(true);
    await syncAllFeeds();
    setFeeds(loadFeeds());
    setBusy(false);
  };

  const grouped = {
    work: feeds.filter((f) => f.category === "work"),
    personal: feeds.filter((f) => f.category === "personal"),
  };

  return (
    <SheetShell onClose={onClose} title="Calendars">
      <div style={{ padding: "16px 24px 36px" }}>
        <Eyebrow style={{ marginBottom: 10 }}>How this listens</Eyebrow>
        <p style={{ ...Sw.sub, margin: "0 0 18px" }}>
          Ori reads only the shape of your day — how many meetings, how long, how many
          people. Never the titles, descriptions, locations, or who&apos;s invited.
          This activates the Interruption cost and Being-seen weight measures in You.
        </p>

        {/* Connected feeds (or empty state) */}
        {feeds.length === 0 ? (
          <div style={{
            background: T.paper, borderRadius: 12, border: `1px solid ${T.hair}`,
            padding: "16px 18px", marginBottom: 18,
          }}>
            <div style={{ fontFamily: fb, fontSize: 14, color: T.muted, fontStyle: "italic", lineHeight: 1.6 }}>
              No calendars yet. Paste a feed URL below — works for iCloud, Google,
              Outlook, or any .ics. You can add up to eight, grouped by Work and Personal.
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 18 }}>
            {["work", "personal"].map((cat) => (
              grouped[cat].length === 0 ? null : (
                <div key={cat} style={{ marginBottom: 14 }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "baseline",
                    marginBottom: 8, padding: "0 2px",
                  }}>
                    <span style={{ fontFamily: fm, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted }}>
                      {cat === "work" ? "Work" : "Personal"}
                    </span>
                    <span style={{ fontFamily: fb, fontSize: 12, color: T.faint, fontStyle: "italic" }}>
                      {grouped[cat].length} calendar{grouped[cat].length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div style={{ background: T.paper, borderRadius: 12, border: `1px solid ${T.hair}`, overflow: "hidden" }}>
                    {grouped[cat].map((f, i) => (
                      <div key={f.id}>
                        <FeedRow feed={f} onSync={() => onSyncNow(f.id)} onDisconnect={() => onDisconnect(f.id)} />
                        {i < grouped[cat].length - 1 && <Hairline inset={16} />}
                      </div>
                    ))}
                  </div>
                </div>
              )
            ))}
            <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
              <button
                onClick={onSyncAll}
                disabled={busy}
                style={{
                  border: `1px solid ${T.line}`, borderRadius: 999,
                  background: "transparent", color: T.fg, cursor: busy ? "default" : "pointer",
                  fontFamily: fm, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
                  padding: "8px 16px", opacity: busy ? 0.5 : 1,
                }}
              >{busy ? "syncing…" : "sync all"}</button>
            </div>
          </div>
        )}

        {/* Connect form */}
        <Eyebrow style={{ marginBottom: 10 }}>Connect a feed URL</Eyebrow>
        <div style={{
          background: T.paper, borderRadius: 12, border: `1px solid ${T.hair}`,
          padding: "16px 18px",
        }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Name (e.g. Family, Side project)"
              style={{
                flex: 1, minWidth: 180,
                border: `1px solid ${T.hair}`, borderRadius: 999,
                padding: "8px 14px",
                fontFamily: fb, fontSize: 14, color: T.fg, background: T.card,
                outline: "none",
              }}
            />
            <div style={{
              display: "inline-flex", gap: 0,
              border: `1px solid ${T.hair}`, borderRadius: 999, padding: 3,
              background: T.card,
            }}>
              {["work", "personal"].map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  style={{
                    border: 0, borderRadius: 999, cursor: "pointer",
                    padding: "6px 14px",
                    fontFamily: fm, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
                    background: category === c ? T.fg : "transparent",
                    color: category === c ? T.bg : T.muted,
                  }}
                >{c}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="webcal:// or https:// calendar URL"
              style={{
                flex: 1, minWidth: 220,
                border: `1px solid ${T.hair}`, borderRadius: 999,
                padding: "8px 14px",
                fontFamily: fm, fontSize: 11, color: T.fg, background: T.card,
                outline: "none",
              }}
            />
            <button
              onClick={onConnect}
              disabled={busy || !url.trim()}
              style={{
                border: 0, borderRadius: 999, cursor: (busy || !url.trim()) ? "default" : "pointer",
                background: T.fg, color: T.bg,
                fontFamily: fm, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
                padding: "8px 18px",
                opacity: (busy || !url.trim()) ? 0.4 : 1,
              }}
            >{busy ? "connecting…" : "connect"}</button>
          </div>
        </div>

        {/* Provider help — collapsible */}
        <Eyebrow style={{ margin: "22px 0 10px" }}>Where to find the URL</Eyebrow>
        <div style={{ background: T.paper, borderRadius: 12, border: `1px solid ${T.hair}`, overflow: "hidden" }}>
          <HelpRow name="iCloud" open={helpOpen === "icloud"} onToggle={() => setHelpOpen(helpOpen === "icloud" ? null : "icloud")}>
            <HelpStep n={1}>Open Calendar on Mac. Right-click the calendar → <em>Share Calendar…</em></HelpStep>
            <HelpStep n={2}>Tick <em>Public Calendar</em>. A long webcal:// URL appears.</HelpStep>
            <HelpStep n={3}>Click the share icon → <em>Copy Link</em>. Paste above.</HelpStep>
          </HelpRow>
          <Hairline inset={16} />
          <HelpRow name="Google Calendar" open={helpOpen === "google"} onToggle={() => setHelpOpen(helpOpen === "google" ? null : "google")}>
            <HelpStep n={1}>Open Google Calendar in a browser. In the left sidebar, hover the calendar you want → click the <em>three dots</em> → <em>Settings and sharing</em>.</HelpStep>
            <HelpStep n={2}>Scroll all the way down to the <em>Integrate calendar</em> section.</HelpStep>
            <HelpStep n={3}>Copy <strong>Secret address in iCal format</strong> — the URL ending in <em>/basic.ics</em>. Paste it above.</HelpStep>
            <div style={{
              marginTop: 10, padding: "8px 10px",
              background: "rgba(196,144,42,0.10)",
              border: "1px solid rgba(196,144,42,0.25)",
              borderRadius: 6,
              fontFamily: fb, fontSize: 12, fontStyle: "italic", color: T.fg, lineHeight: 1.55,
            }}>
              Don&apos;t paste <em>calendar.google.com/...</em> from your browser&apos;s address bar — that&apos;s the Google Calendar app, not a feed. It must end in <em>/basic.ics</em>.
            </div>
          </HelpRow>
          <Hairline inset={16} />
          <HelpRow name="Outlook · Microsoft 365" open={helpOpen === "outlook"} onToggle={() => setHelpOpen(helpOpen === "outlook" ? null : "outlook")}>
            <HelpStep n={1}>In Outlook web, gear → <em>Calendar</em> → <em>Shared calendars</em>.</HelpStep>
            <HelpStep n={2}>Under <em>Publish a calendar</em>, pick yours, set <em>Can view all details</em>, click <em>Publish</em>.</HelpStep>
            <HelpStep n={3}>Copy the ICS link. If your admin disabled this, the URL won&apos;t exist — Sign-in support is coming.</HelpStep>
          </HelpRow>
        </div>

        {/* State panel — ALWAYS shown when there's at least one feed.
            Honest UI: tells the user exactly what was synced and what
            today looks like, even if today is quiet (0 meetings). */}
        {feeds.length > 0 && (
          <>
            <Eyebrow style={{ margin: "22px 0 10px" }}>Today · what was synced</Eyebrow>
            <div style={{
              background: T.paper, borderRadius: 12, border: `1px solid ${T.hair}`,
              padding: "14px 16px",
            }}>
              <SignalLine
                label="Feeds connected"
                value={`${feeds.length}`}
              />
              <SignalLine
                label="Events across all feeds (28-day window)"
                value={`${feeds.reduce((acc, f) => acc + getFeedEvents(f.id).length, 0)}`}
              />
              <SignalLine
                label={`Today's meetings (${new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })})`}
                value={todaySignals ? `${todaySignals.meetings}` : "—"}
              />
              {todaySignals && todaySignals.meetings > 0 ? (
                <>
                  <SignalLine label="Total minutes" value={`${todaySignals.total_minutes}`} />
                  <SignalLine label="Back-to-back"  value={`${todaySignals.back_to_back_count}`} />
                  <SignalLine label="Wide-open"     value={`${todaySignals.wide_open_minutes} min`} />
                  <SignalLine label="Onstage (≥3 ppl)" value={`${todaySignals.onstage_minutes} min`} />
                </>
              ) : (
                <p style={{
                  margin: "12px 0 0", padding: "10px 12px",
                  background: "rgba(196,144,42,0.08)",
                  border: "1px solid rgba(196,144,42,0.18)",
                  borderRadius: 8,
                  fontFamily: fb, fontSize: 13, fontStyle: "italic", lineHeight: 1.5, color: T.fg,
                }}>
                  No meetings on your calendar today. The two cards in You → Demands stay quiet until your feed shows a meeting. If you expected meetings today, check that the feed URL is right and that the events aren&apos;t all all-day blocks (those are filtered out — they aren&apos;t real meetings).
                </p>
              )}
            </div>
          </>
        )}

        <p style={{ fontFamily: fb, fontSize: 12, lineHeight: 1.5, color: T.faint, margin: "20px 0 0" }}>
          Calendar URLs are stored on this device only. Ori&apos;s server fetches each feed,
          drops titles and identities at parse time, and returns only the structural shape.
          Sign-in with Google &amp; Microsoft coming next.
        </p>
      </div>
    </SheetShell>
  );
}

function FeedRow({ feed, onSync, onDisconnect }) {
  const statusOk = feed.lastSyncStatus === "ok";
  const statusErr = feed.lastSyncStatus === "error";
  const lastAt = feed.lastSyncAt ? new Date(feed.lastSyncAt) : null;
  const ago = lastAt ? humanAgo(lastAt) : "never";
  const eventCount = getFeedEvents(feed.id).length;
  const diag = feed.lastSyncDiagnostic;
  const urlHost = (() => {
    try {
      const u = feed.url || "";
      const cleaned = u.startsWith("webcal://") ? "https://" + u.slice(9) : u;
      return new URL(cleaned).hostname;
    } catch { return "invalid url"; }
  })();
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 12,
      padding: "12px 14px",
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: 4,
        background: statusOk ? T.moss : (statusErr ? T.warn : T.faint),
        flexShrink: 0, marginTop: 7,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: fb, fontSize: 15, color: T.fg, fontStyle: "italic" }}>{feed.label}</div>
        <div style={{ fontFamily: fm, fontSize: 10, letterSpacing: "0.06em", color: T.muted, marginTop: 3, wordBreak: "break-all" }}>
          {urlHost} · last sync {ago}
        </div>
        {statusErr && (
          <div style={{
            marginTop: 6, padding: "6px 8px",
            background: "rgba(196,144,42,0.10)",
            border: "1px solid rgba(196,144,42,0.25)",
            borderRadius: 6,
            fontFamily: fm, fontSize: 10, letterSpacing: "0.04em", color: T.warn, lineHeight: 1.5,
          }}>
            error: {feed.lastSyncError || "unknown"}
            {diag?.upstreamStatus ? ` · upstream ${diag.upstreamStatus}` : ""}
            {diag?.bodySnippet ? ` · body: "${diag.bodySnippet.slice(0, 50)}…"` : ""}
          </div>
        )}
        {statusOk && (
          <div style={{
            marginTop: 6, fontFamily: fm, fontSize: 10, letterSpacing: "0.04em", color: T.faint,
          }}>
            {eventCount} event{eventCount === 1 ? "" : "s"} in window
            {diag?.bodyBytes ? ` · ${(diag.bodyBytes / 1024).toFixed(0)} KB fetched` : ""}
            {diag?.parsedEventCount != null ? ` · ${diag.parsedEventCount} parsed total` : ""}
          </div>
        )}
      </div>
      <button
        onClick={onSync}
        style={{
          border: `1px solid ${T.line}`, borderRadius: 999,
          background: "transparent", color: T.muted, cursor: "pointer",
          fontFamily: fm, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase",
          padding: "5px 10px",
        }}
      >sync</button>
      <button
        onClick={onDisconnect}
        style={{
          border: `1px solid ${T.line}`, borderRadius: 999,
          background: "transparent", color: T.muted, cursor: "pointer",
          fontFamily: fm, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase",
          padding: "5px 10px",
        }}
      >remove</button>
    </div>
  );
}

function HelpRow({ name, open, onToggle, children }) {
  return (
    <div>
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", border: 0, background: "transparent", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontFamily: fm, fontSize: 11, letterSpacing: "0.10em", textTransform: "uppercase", color: T.fg }}>{name}</span>
        <span style={{ fontFamily: fm, fontSize: 12, color: T.muted }}>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 16px 14px" }}>
          {children}
        </div>
      )}
    </div>
  );
}

function HelpStep({ n, children }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "5px 0" }}>
      <div style={{
        width: 20, height: 20, borderRadius: 10, flexShrink: 0,
        background: T.fg, color: T.bg, display: "grid", placeItems: "center",
        fontFamily: fm, fontSize: 10, transform: "translateY(-1px)",
      }}>{n}</div>
      <div style={{ fontFamily: fb, fontSize: 13.5, color: T.fg, lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

function SignalLine({ label, value }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      padding: "6px 0", borderTop: `1px solid ${T.hair}`,
      fontFamily: fb, fontSize: 13, color: T.fg,
    }}>
      <span>{label}</span>
      <span style={{ fontFamily: fm, fontSize: 12, color: T.moss }}>{value}</span>
    </div>
  );
}

function humanAgo(date) {
  const ms = Date.now() - date.getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

// ============================================================
// Help sheet — Apple-style interactive (expand + jump)
// ============================================================
function HelpSheet({ onClose, onJump }) {
  const showMeHowTo = [
    { q: "Plant a seed",            a: "From any tab, tap Reflect, then Plant. Type one short line — what's here right now. Ori saves it untouched until winding time.", jump: { label: "Open Reflect", to: "reflect" } },
    { q: "Read today's reading",    a: "Letters arrive on their own at your winding hour. To peek early, tap ‘Read today · N seeds’ in Reflect.", jump: { label: "Open Reflect", to: "reflect" } },
    { q: "See my garden",           a: "The Garden Keeper shows every part you've met, who showed up today, and who's been resting. Tap any chip in the day's letter, or open it from your latest letter.", jump: { label: "Open Garden Keeper", to: "keeper" } },
    { q: "Change my reflect time",  a: "Profile → Reflect time. Pick the hour your day winds down. Ori writes once, at that hour.", jump: { label: "Open Profile", to: "profile" } },
    { q: "Connect my Oura ring",    a: "Connections → Oura Ring. Sign in, and Ori starts reading your sleep, HRV, and readiness alongside your writing.", jump: { label: "Open Connections", to: "connections" } },
    { q: "Edit a seed",             a: "Open Journal, tap any seed. Editing nudges the original — Ori always remembers what you first wrote.", jump: { label: "Open Journal", to: "journal" } },
  ];

  const aboutRows = [
    { q: "What is Ori?",
      a: "Ori is a journal that reads you back. You write small things during the day. At your winding hour, Ori writes you a letter — in plain language, naming the parts of you that showed up." },
    { q: "What are the eight parts?",
      a: "Five everyday parts and three quiet self-energy parts. The vocabulary is inspired by Internal Family Systems therapy (Schwartz) and Schema Therapy mode work (Young) — kept gentle. Each part below maps to a published clinical mode; the surface stays soft.",
      richBelow: "parts" },
    { q: "Why one reading per day, not per seed?",
      a: "Per-seed analysis turns a day into noise. A single, holistic reading at winding time lets the small things sit alongside each other — the way you'd actually remember the day." },
    { q: "Why no ego or dopamine bars?",
      a: "Single-axis labels distort. The dimensional approach here borrows from HiTOP, RDoC, IFS, and Schema Therapy mode work — multiple soft parts, none of which is a verdict on you. Bars feel scientific but they invite you to score yourself, which is the opposite of what a journal is for." },
    { q: "Where does my data live?",
      a: "Locally on this device. Wearable connections happen from your browser. The day's reading is generated by a single call to Anthropic, with the day's seeds and any wearable summaries — never identifying details. Nothing else is sent anywhere." },
    { q: "What if I miss a day?",
      a: "Nothing happens. The garden rests. Parts return when you do." },
  ];

  return (
    <SheetShell onClose={onClose} title="Help">
      <div style={{ padding: "12px 24px 40px" }}>
        <p style={{ ...Sw.sub, margin: "0 0 28px" }}>
          Tap any question to read more — or jump straight where you need to go.
        </p>

        <Section eyebrow="show me how to">
          <HelpList items={showMeHowTo} onJump={onJump} />
        </Section>

        <Section eyebrow="about this garden">
          <HelpList items={aboutRows} onJump={onJump} />
        </Section>

        <Section eyebrow="stability check">
          <ReliabilityPanel />
        </Section>

        <Section eyebrow="honesty audit">
          <HonestyAuditPanel />
        </Section>

        <Section eyebrow="your data">
          <YourDataPanel />
        </Section>

        <Section eyebrow="preview">
          <ConfirmationPreview />
        </Section>

        <Section eyebrow="about">
          <div style={{ fontFamily: fb, fontSize: 13.5, color: T.muted, lineHeight: 1.7 }}>
            Ori · v0.4<br />
            Vocabulary informed by IFS (Schwartz), Schema Therapy modes (Young), HiTOP, and ACT.<br />
            <span style={{ color: T.faint }}>—</span>
          </div>
        </Section>
      </div>
    </SheetShell>
  );
}

// Honesty audit panel — the in-app OKR dashboard. Reports the live
// numbers behind the app's "every claim is auditable" promise:
//
//   - Audit Coverage: % of on-screen claims that have a ≤1-tap path
//     to source data + math + uncertainty + threshold. Inventory
//     lives in honesty-audit.js; the panel just renders it.
//   - Cold-start status: where the current user is on the unlock
//     ladder. Computed from this browser's history + Oura nights.
//   - Honesty gates: the actual constants the math runs on (sample
//     sizes, recurrence thresholds, Wilson z). Hardcoded mirror of
//     the source constants so nothing is invented at render time.
//
// Everything here is measured against real state. No estimates.
function HonestyAuditPanel() {
  const wrap = {
    background: T.paper, border: `1px solid ${T.hair}`, borderRadius: 12,
    padding: "16px 18px",
  };
  const lead = {
    fontFamily: fb, fontSize: 13, color: T.muted, lineHeight: 1.7,
    margin: "0 0 12px",
  };
  const sectionHead = {
    fontFamily: fm, fontSize: 10, letterSpacing: "0.16em",
    textTransform: "uppercase", color: T.muted,
    marginTop: 14, marginBottom: 8,
  };
  const row = {
    display: "flex", justifyContent: "space-between", alignItems: "baseline",
    padding: "6px 0", borderTop: `1px solid ${T.hair}`,
    fontFamily: fb, fontSize: 13, color: T.fg, gap: 12,
  };
  const rowFirst = { ...row, borderTop: "none" };
  const numCell = {
    fontFamily: fm, fontSize: 12, color: T.moss, letterSpacing: 0.4,
    whiteSpace: "nowrap",
  };
  const dim = {
    fontFamily: fb, fontSize: 11.5, color: T.muted, lineHeight: 1.5,
  };
  const tagFor = (auditable) => ({
    fontFamily: fm, fontSize: 9.5, letterSpacing: "0.10em",
    textTransform: "uppercase", padding: "2px 6px", borderRadius: 3,
    lineHeight: 1.2, whiteSpace: "nowrap",
    color:  auditable === "yes" ? T.moss : auditable === "partial" ? "#9c7a26" : "#9c3a26",
    border: `1px solid ${auditable === "yes" ? T.moss : auditable === "partial" ? "#9c7a26" : "#9c3a26"}`,
    opacity: 0.85,
  });
  const tagText = (auditable) =>
    auditable === "yes" ? "Auditable" : auditable === "partial" ? "Partial" : "Missing";

  // Read live state from BOTH journal stores — Analyze-flow entries live
  // in `cpi-v2-data`, imported entries (Mira 30-day, .json paste, etc.)
  // live in `cpi_journal_repo`. The audit previously only saw the first,
  // so a user who imported 30 days saw "7/14" instead of "30/14".
  let analyzeHistory = [];
  try {
    const raw = localStorage.getItem("cpi-v2-data");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) analyzeHistory = parsed;
    }
  } catch { /* ignore */ }
  let repoHistory = [];
  try {
    const raw = localStorage.getItem("cpi_journal_repo");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.entries)) repoHistory = parsed.entries;
    }
  } catch { /* ignore */ }
  const history = [...analyzeHistory, ...repoHistory];

  let ouraNightCount = 0;
  try {
    const raw = localStorage.getItem("cpi_oura_history");
    if (raw) {
      const map = JSON.parse(raw);
      const today = new Date();
      for (let i = 1; i <= 28; i++) {
        const d = new Date(today); d.setDate(today.getDate() - i);
        const k = d.toISOString().slice(0, 10);
        if (map?.[k]?.totalSleepMin > 0) ouraNightCount++;
      }
    }
  } catch { /* ignore */ }

  // Writing days inside the last 28 calendar days (same window the
  // patterns drawer uses). Counts unique dates across BOTH stores.
  const writingDaysIn28 = (() => {
    const windowStart = Date.now() - 28 * 86400000;
    const days = new Set();
    for (const h of history) {
      const dRaw = h?.date;
      if (!dRaw) continue;
      const t = new Date(dRaw).getTime();
      if (!Number.isFinite(t) || t < windowStart) continue;
      const k = typeof dRaw === "string" ? dRaw.slice(0, 10) : new Date(t).toISOString().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(k)) days.add(k);
    }
    return days.size;
  })();

  const cov = computeCoverage();
  const cold = coldStartStatus({ history, ouraNightCount, writingDaysIn28 });

  return (
    <div style={wrap}>
      <p style={lead}>
        Our promise: every number on screen is auditable in one tap. This
        panel reports how close we actually are — and exactly where the
        gaps live. Generated from the current code, not estimates.
      </p>

      {/* ── 1. Audit Coverage ─────────────────────────────────────── */}
      <div style={sectionHead}>Audit coverage</div>
      <div style={wrap}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
          <span style={{ fontFamily: fd, fontStyle: "italic", fontWeight: 300, fontSize: 28, color: T.fg, letterSpacing: "-0.01em" }}>
            {cov.fullPct}%
          </span>
          <span style={dim}>
            fully auditable · {cov.creditPct}% with partial credit · target 90%
          </span>
        </div>
        <div style={{ ...dim, marginBottom: 12 }}>
          {cov.full} of {cov.total} claims have a ≤1-tap audit path.
          {" "}{cov.partial} partial · {cov.missing} missing.
        </div>
        {HONESTY_CLAIMS.map((c, i) => (
          <div key={c.id} style={i === 0 ? rowFirst : row}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, color: T.fg, marginBottom: 2 }}>{c.claim}</div>
              <div style={dim}>{c.surface} · {c.why}</div>
            </div>
            <span style={tagFor(c.auditable)}>{tagText(c.auditable)}</span>
          </div>
        ))}
      </div>

      {/* ── 2. Cold-start status ──────────────────────────────────── */}
      <div style={sectionHead}>Cold-start status (this browser)</div>
      <div style={wrap}>
        <div style={{ ...dim, marginBottom: 10 }}>
          Where you are on the unlock ladder, measured against your local history.
          Different browsers = different state — these are the numbers for the
          origin you're on right now.
        </div>
        <div style={{
          ...dim, marginBottom: 12,
          padding: "8px 10px",
          background: T.bg, border: `1px solid ${T.hair}`, borderRadius: 8,
          fontFamily: fm, fontSize: 11, color: T.fg,
        }}>
          <b style={{ color: T.fg }}>{history.length}</b> total entries
          {" · "}
          <b style={{ color: T.fg }}>{(() => {
            const s = new Set();
            for (const h of history) {
              const dRaw = h?.date;
              if (!dRaw) continue;
              const k = typeof dRaw === "string" ? dRaw.slice(0, 10)
                : (() => { try { return new Date(dRaw).toISOString().slice(0, 10); } catch { return null; } })();
              if (k && /^\d{4}-\d{2}-\d{2}$/.test(k)) s.add(k);
            }
            return s.size;
          })()}</b> unique writing days
          {" · "}
          <b style={{ color: T.fg }}>{ouraNightCount}</b> Oura nights (last 28)
        </div>
        {cold.map((m, i) => {
          const unit = m.need === "biometric" ? "Oura nights" : "writing days";
          return (
            <div key={m.id} style={i === 0 ? rowFirst : row}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, color: m.unlocked ? T.fg : T.muted }}>{m.label}</div>
                <div style={dim}>{m.desc}</div>
              </div>
              <span style={{ ...numCell, color: m.unlocked ? T.moss : T.muted }}>
                {m.unlocked
                  ? `unlocked · ${m.current} ${unit}`
                  : `${m.current} of ${m.days} ${unit} · ${m.remaining} to go`}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── 3. Honesty gates ──────────────────────────────────────── */}
      <div style={sectionHead}>Honesty gates active in the code</div>
      <div style={wrap}>
        <div style={{ ...dim, marginBottom: 10 }}>
          The actual constants the math uses today. Change one of these
          in the code, change it here — keep them in sync.
        </div>
        {HONESTY_GATES.map((g, i) => (
          <div key={g.key} style={i === 0 ? rowFirst : row}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: fm, fontSize: 12, color: T.fg, marginBottom: 2 }}>{g.key}</div>
              <div style={dim}>{g.purpose}</div>
            </div>
            <span style={numCell}>{g.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Your data panel — manual backup + restore for the user's entire local
// state (every `cpi*` key in localStorage plus the IDB-backed wearable
// history and journal repo). Two purposes:
//
//   1. User value: the user's writing and biometric history is theirs.
//      They should be able to leave the browser with it — switch devices,
//      keep a local archive, recover from accidental wipes.
//   2. Engineering safety: before any future migration changes the data
//      model, the user can snapshot a known-good state. The restore path
//      is the rollback button if a migration ever damages anything.
//
// The export bundles small localStorage values and the IDB-backed blobs
// into one JSON file. Restore wipes current state and rewrites it from
// the bundle, then reloads — destructive, gated behind explicit confirm.
//
// Security note: exported file includes Oura access tokens. We warn the
// user not to share the file. Hiding tokens would make the export
// incomplete and a restore would silently break Oura sync.
function YourDataPanel() {
  const [status, setStatus] = useState(null);   // { kind, msg }
  const [confirming, setConfirming] = useState(false);
  const [pendingBundle, setPendingBundle] = useState(null);
  const fileInputRef = useRef(null);

  const wrap = {
    background: T.paper, border: `1px solid ${T.hair}`, borderRadius: 12,
    padding: "16px 18px",
  };
  const lead = {
    fontFamily: fb, fontSize: 13, color: T.muted, lineHeight: 1.7,
    margin: "0 0 14px",
  };
  const row = {
    display: "flex", gap: 10, flexWrap: "wrap",
  };
  const button = {
    fontFamily: fm, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
    background: "transparent", color: T.fg,
    border: `1px solid ${T.line}`, borderRadius: 999,
    padding: "10px 18px", cursor: "pointer", minHeight: 40,
  };
  const dangerBtn = {
    ...button, color: "#9c3a26", borderColor: "#9c3a26",
  };
  const fineprint = {
    fontFamily: fb, fontSize: 11, color: T.faint, lineHeight: 1.6,
    margin: "14px 0 0", fontStyle: "italic",
  };
  const statusLine = (kind) => ({
    fontFamily: fm, fontSize: 11, marginTop: 12,
    color: kind === "err" ? "#9c3a26" : kind === "ok" ? T.moss : T.muted,
  });

  function collectSnapshot() {
    const entries = [];
    // Small keys live directly in localStorage. Iterate the shimmed
    // localStorage — for the two LARGE_KEYS that may not appear in
    // length-iteration, we add them explicitly below.
    const seen = new Set();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (!(k.startsWith("cpi") || k === "cpi-v2-data")) continue;
      seen.add(k);
      let value = null;
      try { value = localStorage.getItem(k); } catch { /* skip */ }
      if (value != null) entries.push({ key: k, value });
    }
    // Large IDB-backed keys — the storage shim routes getItem through
    // the in-memory cache, so reading via localStorage.getItem returns
    // them correctly once hydrateStorage() has run (called at app boot).
    for (const k of Object.values(LARGE_KEYS)) {
      if (seen.has(k)) continue;
      let value = null;
      try { value = localStorage.getItem(k); } catch { /* skip */ }
      if (value != null) entries.push({ key: k, value });
    }
    return entries;
  }

  function handleExport() {
    setStatus(null);
    try {
      const entries = collectSnapshot();
      const bundle = {
        schema: "ori-backup/1",
        createdAt: new Date().toISOString(),
        host: typeof window !== "undefined" ? window.location.host : null,
        entryCount: entries.length,
        entries,
      };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ori-backup-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      const kb = Math.max(1, Math.round(blob.size / 1024));
      setStatus({ kind: "ok", msg: `Exported ${entries.length} keys · ${kb} KB.` });
    } catch (e) {
      setStatus({ kind: "err", msg: `Export failed: ${String(e?.message || e)}` });
    }
  }

  function handlePickFile() {
    setStatus(null);
    fileInputRef.current?.click();
  }

  async function handleFileChosen(ev) {
    const f = ev.target.files?.[0];
    ev.target.value = ""; // reset so re-picking same file re-fires
    if (!f) return;
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      if (!parsed || parsed.schema !== "ori-backup/1") {
        throw new Error("Unrecognised backup file (expected schema ori-backup/1).");
      }
      if (!Array.isArray(parsed.entries)) {
        throw new Error("Backup file is missing entries.");
      }
      setPendingBundle(parsed);
      setConfirming(true);
    } catch (e) {
      setStatus({ kind: "err", msg: `Could not read file: ${String(e?.message || e)}` });
    }
  }

  async function handleConfirmRestore() {
    if (!pendingBundle) return;
    try {
      // Wipe every existing cpi* key first so restore is a clean swap,
      // not a merge — otherwise stale keys that didn't exist in the
      // backup would survive and create silent inconsistencies.
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("cpi") || k === "cpi-v2-data")) toRemove.push(k);
      }
      for (const k of toRemove) {
        try { localStorage.removeItem(k); } catch { /* ignore */ }
      }
      // Also explicitly clear LARGE_KEYS via the shim (covers the case
      // where they live in IDB but not localStorage).
      for (const k of Object.values(LARGE_KEYS)) {
        try { localStorage.removeItem(k); } catch { /* ignore */ }
      }
      // Write the bundle back. Shim routes large keys to IDB.
      let written = 0;
      for (const e of pendingBundle.entries) {
        if (!e?.key || typeof e.value !== "string") continue;
        try { localStorage.setItem(e.key, e.value); written++; } catch { /* skip */ }
      }
      setConfirming(false);
      setPendingBundle(null);
      setStatus({ kind: "ok", msg: `Restored ${written} keys. Saving to disk…` });
      // CRITICAL: wait for the IDB writes (cpi_journal_repo,
      // cpi_oura_history) to actually commit before reloading. The
      // earlier version used a fixed 900 ms setTimeout which raced the
      // IDB transactions on iOS WebView — the reload could land before
      // a 38 KB journal repo finished writing, silently losing the
      // user's journal entries on restore.
      await flushStorage();
      setStatus({ kind: "ok", msg: `Restored ${written} keys. Reloading…` });
      // Tiny pause just so the status line is visible; reload is
      // already safe by this point.
      setTimeout(() => { try { window.location.reload(); } catch { /* ignore */ } }, 300);
    } catch (e) {
      setStatus({ kind: "err", msg: `Restore failed: ${String(e?.message || e)}` });
      setConfirming(false);
    }
  }

  function handleCancelRestore() {
    setConfirming(false);
    setPendingBundle(null);
    setStatus({ kind: "muted", msg: "Restore cancelled. Nothing changed." });
  }

  // ── Confirm sheet ──
  if (confirming && pendingBundle) {
    const bundleDate = pendingBundle.createdAt
      ? new Date(pendingBundle.createdAt).toLocaleString()
      : "—";
    return (
      <div style={wrap}>
        <p style={lead}>
          About to replace everything in this browser with the contents of
          your backup file. Your current state will be lost unless you've
          exported it already.
        </p>
        <div style={{
          background: T.card, border: `1px solid ${T.hair}`, borderRadius: 10,
          padding: "12px 14px", marginBottom: 14,
          fontFamily: fm, fontSize: 12, color: T.fg,
        }}>
          <div>Backup created: <span style={{ color: T.muted }}>{bundleDate}</span></div>
          <div>Entries to restore: <span style={{ color: T.muted }}>{pendingBundle.entries.length}</span></div>
        </div>
        <div style={row}>
          <button type="button" style={dangerBtn} onClick={handleConfirmRestore}>
            Replace everything
          </button>
          <button type="button" style={button} onClick={handleCancelRestore}>
            Cancel
          </button>
        </div>
        <div style={fineprint}>
          The page will reload as soon as the restore finishes. If anything
          goes wrong mid-restore, your current state may end up partially
          overwritten — keep an export of today before restoring an older one.
        </div>
        {status && <div style={statusLine(status.kind)}>{status.msg}</div>}
      </div>
    );
  }

  // ── Normal view ──
  return (
    <div style={wrap}>
      <p style={lead}>
        Your writing, your readings, your biometric history — all of it lives
        in this browser. Export a backup any time. Restore one to bring it
        back, or move it to another browser.
      </p>
      <div style={row}>
        <button type="button" style={button} onClick={handleExport}>
          Export backup
        </button>
        <button type="button" style={button} onClick={handlePickFile}>
          Restore from backup
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={handleFileChosen}
        />
      </div>
      <div style={fineprint}>
        The exported file is a plain JSON snapshot — readable by you, by us
        if you send it, and by anyone you share it with. It contains your
        Oura access token (so a restore on another browser keeps syncing).
        Keep the file private.
      </div>
      {status && <div style={statusLine(status.kind)}>{status.msg}</div>}
    </div>
  );
}

// Reliability panel — surfaces the test-retest stability of the parts
// classification. Reads cpi_reliability_log written by runReliabilityProbe
// after each Read Today (24h debounced). Shows: probe count, mean Jaccard
// agreement, mean volume agreement, latest probe. Honest about what these
// numbers mean — they measure Claude's output variance on the same input,
// NOT how truthful the parts are about the user's inner state.
function ReliabilityPanel() {
  const stats = loadReliabilityStats();

  const wrap = {
    background: T.paper, border: `1px solid ${T.hair}`, borderRadius: 12,
    padding: "16px 18px",
  };
  const lead = {
    fontFamily: fb, fontSize: 13, color: T.muted, lineHeight: 1.7,
    margin: "0 0 12px",
  };
  const row = {
    display: "flex", justifyContent: "space-between", alignItems: "baseline",
    padding: "8px 0", borderTop: `1px solid ${T.hair}`,
    fontFamily: fb, fontSize: 13.5, color: T.fg,
  };
  const rowFirst = { ...row, borderTop: "none" };
  const num = {
    fontFamily: fm, fontSize: 13, color: T.moss, letterSpacing: 0.5,
  };
  const fineprint = {
    fontFamily: fb, fontSize: 11, color: T.faint, lineHeight: 1.6,
    margin: "12px 0 0", fontStyle: "italic",
  };

  if (!stats) {
    return (
      <div style={wrap}>
        <p style={lead}>
          Ori re-runs the day's reading once a day on the same seeds and compares
          the two parts lists. Stability data appears here after the first probe.
        </p>
        <div style={fineprint}>
          What this measures: Claude's output variance on identical input. What it
          doesn't measure: whether the parts named are true about you.
        </div>
      </div>
    );
  }

  const interpretJ = (j) => {
    if (j >= 0.85) return "high";
    if (j >= 0.65) return "moderate";
    if (j >= 0.40) return "low";
    return "unstable";
  };
  const latestDate = stats.latest?.ts ? new Date(stats.latest.ts).toLocaleString() : "—";

  return (
    <div style={wrap}>
      <p style={lead}>
        Identical seeds, run twice, compared. Higher numbers mean Claude returns
        the same parts list more often. This is a precision metric, not a truth metric.
      </p>
      <div style={rowFirst}>
        <span>Probes recorded</span>
        <span style={num}>{stats.probeCount}</span>
      </div>
      <div style={row}>
        <span>Mean parts agreement (Jaccard)</span>
        <span style={num}>{stats.meanJaccard} · {interpretJ(stats.meanJaccard)}</span>
      </div>
      {stats.meanVolumeAgreement != null && (
        <div style={row}>
          <span>Mean volume agreement</span>
          <span style={num}>{stats.meanVolumeAgreement}</span>
        </div>
      )}
      <div style={row}>
        <span>Latest probe</span>
        <span style={{ ...num, color: T.muted, fontSize: 11 }}>{latestDate}</span>
      </div>
      <div style={fineprint}>
        Below 0.65 means Ori names different parts on the same input — the Keeper's
        verdicts should be read with that uncertainty. Above 0.85 means the
        classification is consistent (still says nothing about whether it's correct).
      </div>
    </div>
  );
}

// Preview tool — lets the user see what a companion confirmation card looks
// like even when their real history hasn't qualified one yet. Pure preview;
// nothing it does writes to confirmations storage. State lives entirely in
// this component: a sample card flips between question / confirmed / dismissed
// based on what the user taps.
function ConfirmationPreview() {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState("question"); // "question" | "confirmed" | "dismissed"

  const wrap = {
    background: T.paper, border: `1px solid ${T.hair}`, borderRadius: 12,
    padding: "16px 18px",
  };
  const lead = {
    fontFamily: fb, fontSize: 13, color: T.muted, lineHeight: 1.7,
    margin: "0 0 12px",
  };
  const button = {
    fontFamily: fm, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
    background: "transparent", color: T.fg,
    border: `1px solid ${T.line}`, borderRadius: 999,
    padding: "10px 18px", cursor: "pointer", minHeight: 40,
  };

  return (
    <div style={wrap}>
      <p style={lead}>
        Companions (gentle, witness, maker) ask if they really visit you once
        they qualify. If your own history hasn't surfaced one yet, see what the
        prompt looks like:
      </p>
      <button type="button" onClick={() => { setOpen(true); setStage("question"); }} style={button}>
        Show me the prompt
      </button>

      {open && (
        <PreviewCard stage={stage} onYes={() => setStage("confirmed")}
          onNo={() => setStage("dismissed")} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

// Standalone floating card that mirrors the GardenKeeper companion render.
// Visual treatment is intentionally hand-rolled here so the Settings page
// doesn't need to import GardenKeeper — and to keep the preview decoupled
// from any future render changes there.
function PreviewCard({ stage, onYes, onNo, onClose }) {
  const overlay = {
    position: "fixed", inset: 0, zIndex: 320,
    background: "rgba(26,26,26,0.32)",
    backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "24px",
  };
  const card = {
    background: T.bg, borderRadius: 18, padding: "24px 22px 20px",
    maxWidth: 460, width: "100%",
    boxShadow: "0 30px 60px rgba(0,0,0,0.18)",
    fontFamily: fb,
  };
  const eyebrow = {
    fontFamily: fm, fontSize: 9, letterSpacing: 1.8, textTransform: "uppercase",
    color: T.faint, marginBottom: 14,
  };
  const partRow = {
    display: "grid", gridTemplateColumns: "44px 1fr",
    gap: 16, alignItems: "start",
  };
  const glyph = {
    width: 44, height: 44, borderRadius: "50%",
    display: "grid", placeItems: "center",
    fontFamily: "'Playfair Display', Georgia, serif",
    fontStyle: "italic", fontSize: 22, color: T.bloom,
    background: "transparent", border: `1px solid ${T.bloom}55`,
  };
  const name = {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontStyle: "italic", fontSize: 19, color: T.fg,
    lineHeight: 1.1, marginBottom: 4,
  };
  const kindTag = {
    fontFamily: fm, fontSize: 8.5, letterSpacing: 1.6, textTransform: "uppercase",
    color: T.bloom, marginBottom: 6,
  };
  const desc = { fontSize: 13.5, lineHeight: 1.65, color: T.muted };
  const ask = {
    marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${T.line}`,
    display: "flex", flexDirection: "column", gap: 8,
  };
  const askQ = {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontStyle: "italic", fontSize: 13, color: T.muted, lineHeight: 1.5,
  };
  const askBtns = { display: "flex", gap: 8, flexWrap: "wrap" };
  const yesBtn = {
    fontFamily: fm, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase",
    background: "transparent", color: T.moss,
    border: `1px solid ${T.moss}55`, borderRadius: 999,
    padding: "8px 14px", cursor: "pointer", minHeight: 36,
  };
  const noBtn = { ...yesBtn, color: T.bloom, border: `1px solid ${T.bloom}55` };
  const stateTag = {
    fontFamily: fm, fontSize: 9, letterSpacing: 1.4, textTransform: "uppercase",
    color: stage === "confirmed" ? T.moss : T.bloom,
    marginTop: 8, opacity: 0.85,
  };
  const closeBtn = {
    marginTop: 18, width: "100%", minHeight: 40,
    fontFamily: fm, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase",
    background: "transparent", color: T.fg,
    border: `1px solid ${T.line}`, borderRadius: 10, cursor: "pointer",
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={eyebrow}>preview · this won't change anything</div>
        <div style={partRow}>
          <div style={glyph}>❀</div>
          <div>
            <div style={name}>the gentle one</div>
            <div style={kindTag}>COMPANION <span style={{ color: T.faint, margin: "0 2px" }}>·</span> LINGUISTIC</div>
            <div style={desc}>Care that lands as quietness. Showing up without making a case.</div>
            {stage === "question" && (
              <div style={ask}>
                <span style={askQ}>Does this part visit you?</span>
                <div style={askBtns}>
                  <button type="button" onClick={onYes} style={yesBtn}>yes, often</button>
                  <button type="button" onClick={onNo} style={noBtn}>not yet</button>
                </div>
              </div>
            )}
            {stage === "confirmed" && (
              <div style={stateTag}>you confirmed this</div>
            )}
            {stage === "dismissed" && (
              <div style={stateTag}>not yet — we'll check back in 30 days</div>
            )}
          </div>
        </div>
        <button type="button" onClick={onClose} style={closeBtn}>close preview</button>
      </div>
    </div>
  );
}

function Section({ eyebrow, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <Eyebrow style={{ marginBottom: 10 }}>{eyebrow}</Eyebrow>
      {children}
    </div>
  );
}

function HelpList({ items, onJump }) {
  const [open, setOpen] = useState(null);
  return (
    <div style={{ background: T.paper, borderRadius: 12, border: `1px solid ${T.hair}`, overflow: "hidden" }}>
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <div key={i}>
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 12,
                padding: "14px 16px", border: 0, background: "transparent", cursor: "pointer", textAlign: "left",
              }}
            >
              <span style={{ flex: 1, fontFamily: fb, fontSize: 14.5, color: T.fg }}>{it.q}</span>
              <span style={{
                fontFamily: fm, fontSize: 16, color: T.faint,
                transform: isOpen ? "rotate(45deg)" : "rotate(0)",
                transition: "transform 0.2s",
              }}>+</span>
            </button>
            {isOpen && (
              <div style={{ padding: "0 16px 16px" }}>
                <p style={{ fontFamily: fb, fontSize: 13.5, lineHeight: 1.6, color: T.muted, margin: "0 0 12px" }}>{it.a}</p>
                {it.richBelow === "parts" && (
                  <div style={{ marginTop: 8, marginBottom: 12, background: T.card, borderRadius: 10, border: `1px solid ${T.hair}`, overflow: "hidden" }}>
                    {PARTS_GLOSSARY.map((p, j) => (
                      <div key={p.id}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px" }}>
                          <span style={{ fontSize: 17, color: p.color, lineHeight: 1, width: 20, textAlign: "center", marginTop: 1 }}>{p.glyph}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontFamily: fd, fontStyle: "italic", fontSize: 13.5, color: T.fg }}>{p.name}</div>
                            <div style={{ fontFamily: fb, fontSize: 12, color: T.muted, lineHeight: 1.45, marginTop: 1 }}>{p.desc}</div>
                          </div>
                        </div>
                        {j < PARTS_GLOSSARY.length - 1 && <Hairline inset={42} />}
                      </div>
                    ))}
                    <div style={{ borderTop: `1px solid ${T.hair}`, padding: "10px 14px", fontFamily: fb, fontSize: 11, color: T.faint, lineHeight: 1.6, fontStyle: "italic" }}>
                      Each part above maps to a mode in Schema Therapy (Young, 1990+): planner ≈ demanding parent, watcher ≈ compliant surrenderer, tender one ≈ vulnerable child, seeker ≈ impulsive child, hesitant one ≈ avoidant protector. The three companions (gentle, witness, maker) all map to the healthy adult mode. Interpretive frame, not a clinical assessment.
                    </div>
                  </div>
                )}
                {it.jump && (
                  <button
                    onClick={() => onJump?.(it.jump.to)}
                    style={{
                      fontFamily: fm, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
                      color: T.accent, background: "transparent", border: `1px solid rgba(184,134,11,0.30)`,
                      padding: "7px 12px", borderRadius: 999, cursor: "pointer",
                    }}
                  >{it.jump.label} →</button>
                )}
              </div>
            )}
            {i < items.length - 1 && <Hairline inset={16} />}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Settings root — manages internal screen, owns profile state
// ============================================================
export default function Settings({
  open,
  onClose,
  history = [],
  metToday = 0,
  seedsToday = 0,
  mode = "full",
  onModeChange,
  onJumpReflect,
  onJumpKeeper,
  onJumpJournal,
  onManageWearable,
}) {
  const [screen, setScreen] = useState("index");

  // Profile state — read from localStorage, write back on change.
  const [name, setName] = useState(() => {
    try { return localStorage.getItem(GARDEN_NAME_KEY) || ""; } catch { return ""; }
  });
  const [reflectTime, setReflectTime] = useState(() => {
    try { return localStorage.getItem(REFLECT_TIME_KEY) || "21:00"; } catch { return "21:00"; }
  });
  // Self-reported sleep window — fallback for chronotype when device data
  // (Oura, Apple Health) isn't available. Stored as minutes since 00:00.
  // Empty strings here mean "not set" — the user hasn't told us a window
  // and we'll show a soft hint to set it.
  const loadInitialSleep = () => {
    try {
      const raw = localStorage.getItem(SLEEP_WINDOW_KEY);
      if (!raw) return { bedTime: "", wakeTime: "" };
      const parsed = JSON.parse(raw);
      const bed = typeof parsed?.bedtimeMin === "number" ? parsed.bedtimeMin : null;
      const wake = typeof parsed?.wakeMin === "number" ? parsed.wakeMin : null;
      return {
        bedTime: bed != null ? minutesToTime(bed) : "",
        wakeTime: wake != null ? minutesToTime(wake) : "",
      };
    } catch { return { bedTime: "", wakeTime: "" }; }
  };
  const [sleepBedTime, setSleepBedTime] = useState(() => loadInitialSleep().bedTime);
  const [sleepWakeTime, setSleepWakeTime] = useState(() => loadInitialSleep().wakeTime);
  const [signature, setSignature] = useState(() => {
    try { return localStorage.getItem(SIGNATURE_KEY) || ""; } catch { return ""; }
  });
  const [avatarId, setAvatarId] = useState(() => {
    try { return localStorage.getItem(AVATAR_KEY) || "auto"; } catch { return "auto"; }
  });
  // Optional. Stored as a string so an empty field clears cleanly. The
  // engine reads it through getUserAge() which range-checks 5–120 and
  // returns null on anything malformed. Not used in HCPI math today —
  // captured so future age-bucketed calibration has the input.
  const [userAge, setUserAge] = useState(() => {
    try { return localStorage.getItem(USER_AGE_KEY) || ""; } catch { return ""; }
  });

  // Ensure the anonymous device ID exists once Settings mounts. The ID is
  // a v4 UUID stored locally, never linked to name/email. Generated here
  // because Settings is reliably the earliest user-touched surface on a
  // fresh install; entries written before this runs still get covered by
  // the same helper invoked at save time.
  useEffect(() => { getOrCreateAnonId(); }, []);

  // Reset to index whenever Settings is closed/reopened.
  useEffect(() => { if (open) setScreen("index"); }, [open]);

  // Persist on change.
  useEffect(() => { try { localStorage.setItem(GARDEN_NAME_KEY, name); } catch { /* ignore */ } }, [name]);
  useEffect(() => { try { localStorage.setItem(REFLECT_TIME_KEY, reflectTime); } catch { /* ignore */ } }, [reflectTime]);
  // Persist sleep window when both values are set; clear when both are empty.
  // Mixed (one set, one not) is treated as not-set since the math needs both.
  useEffect(() => {
    try {
      const bed = parseTimeToMinutes(sleepBedTime);
      const wake = parseTimeToMinutes(sleepWakeTime);
      if (bed != null && wake != null) {
        localStorage.setItem(SLEEP_WINDOW_KEY, JSON.stringify({
          bedtimeMin: bed, wakeMin: wake, updatedAt: new Date().toISOString(),
        }));
      } else if (sleepBedTime === "" && sleepWakeTime === "") {
        localStorage.removeItem(SLEEP_WINDOW_KEY);
      }
    } catch { /* ignore */ }
  }, [sleepBedTime, sleepWakeTime]);
  useEffect(() => { try { localStorage.setItem(SIGNATURE_KEY, signature); } catch { /* ignore */ } }, [signature]);
  useEffect(() => { try { localStorage.setItem(AVATAR_KEY, avatarId); } catch { /* ignore */ } }, [avatarId]);
  useEffect(() => {
    try {
      if (userAge === "") localStorage.removeItem(USER_AGE_KEY);
      else localStorage.setItem(USER_AGE_KEY, userAge);
    } catch { /* ignore */ }
  }, [userAge]);

  // Resolve "decide for me" from history. Memoized so we don't re-scan
  // unless the avatar choice or history changes.
  const avatar = useMemo(() => effectiveAvatar(avatarId, history), [avatarId, history]);

  if (!open) return null;

  const profile = {
    name,
    reflectTime,
    sleepBedTime,
    sleepWakeTime,
    signature,
    avatarId,
    avatar,
    userAge,
    metToday,
    seedsToday,
  };
  const setProfile = (next) => {
    if (next.name !== name) setName(next.name);
    if (next.reflectTime !== reflectTime) setReflectTime(next.reflectTime);
    if (next.sleepBedTime !== sleepBedTime) setSleepBedTime(next.sleepBedTime ?? "");
    if (next.sleepWakeTime !== sleepWakeTime) setSleepWakeTime(next.sleepWakeTime ?? "");
    if ((next.signature || "") !== signature) setSignature(next.signature || "");
    if (next.avatarId !== avatarId) setAvatarId(next.avatarId);
    if ((next.userAge ?? "") !== userAge) setUserAge(next.userAge ?? "");
  };

  // Help → Take me there. Internal navigation switches sheets;
  // external destinations close Settings and tell the app where to go.
  const onJump = (to) => {
    if (to === "profile" || to === "connections" || to === "help") {
      setScreen(to);
      return;
    }
    onClose?.();
    if (to === "reflect") onJumpReflect?.();
    else if (to === "keeper") onJumpKeeper?.();
    else if (to === "journal") onJumpJournal?.();
  };

  return (
    <>
      <IndexScreen onClose={onClose} goTo={setScreen} profile={profile} />
      {screen === "profile"       && <ProfileSheet       onClose={() => setScreen("index")} profile={profile} setProfile={setProfile} history={history} mode={mode} onModeChange={onModeChange} />}
      {screen === "language"      && <LanguageSheet      onClose={() => setScreen("index")} />}
      {screen === "importJournal" && <SheetShell         onClose={() => setScreen("index")} title="Import journal"><ImportJournalSheet onChange={() => { /* repo reads come from localStorage; no parent state to bump */ }} /></SheetShell>}
      {screen === "connections"   && <ConnectionsSheet   onClose={() => setScreen("index")} onManage={(id) => {
        if (id === "calendar") setScreen("calendar");
        else onManageWearable?.(id);
      }} />}
      {screen === "calendar"      && <CalendarSheet      onClose={() => setScreen("connections")} />}
      {screen === "help"          && <HelpSheet          onClose={() => setScreen("index")} onJump={onJump} />}
    </>
  );
}

// Re-export so CPI.jsx can read the resolved avatar elsewhere if needed
// (e.g., header glyph).
export { AVATAR_OPTIONS, effectiveAvatar };
