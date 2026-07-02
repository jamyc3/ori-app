import { useState, useEffect } from "react";
import { CHRONOTYPES } from "./knowledge-base.js";
import {
  BASELINE_MIN_DAYS, BIOMETRICS_KEY, CHRONO_KEY, LIFESTYLE_KEY,
  OURA_ACCESS_KEY, OURA_ENDPOINTS, OURA_HISTORY_KEY, OURA_LAST_SYNC_KEY,
  computeBiometricTrends, computeE0, e0Label,
  fetchOuraRange, formatOptimalBedtime, isSuspectSleep, loadCheckin,
  restDaysInWindow,
  mergeOuraHistory, minutesSinceLastWake, needsSleepReview, normalizeSleepEntry,
  ouraSyncWindow, recordOuraHwm, saveCheckin,
  sleepSourceFor, timeAgo, upsertManualDay,
} from "./engine.js";
import { KssEditor, Pss4Survey, PvtModal, ManualDayEditor } from "./components/Surveys.jsx";
import { SleepReviewBanner } from "./components/Banners.jsx";
import { Pill } from "./components/Pill.jsx";

// Traffic-light colors used for tile tints / source dots.
const g = "#4F8A5F", y = "#C4902A", r = "#B0553A";

export function BiometricsPanel({ biometrics, setBiometrics, ouraToken, setOuraToken, lifestyle, setLifestyle, chronotype, setChronotype, mode = "full" }) {
  const [expanded, setExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editingDate, setEditingDate] = useState(null);
  const [patInput, setPatInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [ouraStatus, setOuraStatus] = useState(null);
  const [syncProgress, setSyncProgress] = useState(null);
  const [checkin, setCheckin] = useState(() => loadCheckin());
  const [checkinOpen, setCheckinOpen] = useState(null); // null | 'kss' | 'pss4'
  const [pvtOpen, setPvtOpen] = useState(false);
  // null | 'sleep' | 'energy' | 'readiness' — which self-rated card is being
  // edited inline. The slider strip below the 3-card row only renders for
  // the focused card. Nothing else is visible when this is null — keeping
  // the panel quiet until the user actually asks to rate.
  const [ratingFocus, setRatingFocus] = useState(null);
  // Cognitive check-in opens progressively: one summary row by default,
  // full 3-tile grid when the user taps into it. Auto-expands if any editor
  // is already open, so deep-linking into a specific test still works.
  const [mindExpanded, setMindExpanded] = useState(false);

  // Auto-expand sections when a ring "Go deeper" dispatches a gotoSection event.
  useEffect(() => {
    const handler = (e) => {
      if (e.detail === "body-detail") { setExpanded(true); setDetailsOpen(true); }
    };
    const opener = (e) => {
      // Specific sub-UI openers from PillarDetail action buttons.
      setExpanded(true);
      const what = e.detail;
      // Always close every other modal/form first so we never stack UIs.
      if (what !== "pvt") setPvtOpen(false);
      if (what !== "kss" && what !== "pss4") setCheckinOpen(null);
      if (what === "pvt") { setCheckinOpen(null); setPvtOpen(true); setMindExpanded(true); }
      else if (what === "kss") { setPvtOpen(false); setCheckinOpen("kss"); setMindExpanded(true); }
      else if (what === "pss4") { setPvtOpen(false); setCheckinOpen("pss4"); setMindExpanded(true); }
      else if (what === "manualSleep") setDetailsOpen(true);
      else if (what === "journal") window.scrollTo({ top: 0, behavior: "smooth" });
      // Scroll the check-in row into view for kss/pss4 so the form is visible.
      if (what === "kss" || what === "pss4") {
        setTimeout(() => {
          const el = document.getElementById("mind-detail");
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 120);
      }
    };
    window.addEventListener("cpi:gotoSection", handler);
    window.addEventListener("cpi:open", opener);
    // Re-read history trends whenever a background sync lands new data.
    // Without this the panel shows the map as-of-mount even after
    // auto-sync has written fresher days to storage.
    const onSynced = () => {
      // CRITICAL: always call setHistoryTrends, even when storage is
      // empty/missing. The old early-return on `!raw` meant that after
      // a full clear, the panel retained its pre-clear trends and the
      // cards kept showing data that no longer existed.
      try {
        const raw = localStorage.getItem(OURA_HISTORY_KEY);
        const map = raw ? JSON.parse(raw) : {};
        const today = new Date().toISOString().split("T")[0];
        setHistoryTrends(computeBiometricTrends(map, today));
      } catch {
        setHistoryTrends(null);
      }
    };
    window.addEventListener("cpi:wearable-synced", onSynced);
    return () => {
      window.removeEventListener("cpi:gotoSection", handler);
      window.removeEventListener("cpi:open", opener);
      window.removeEventListener("cpi:wearable-synced", onSynced);
    };
  }, []);

  const persistCheckin = (next) => { setCheckin(next); saveCheckin(next); };
  const [historyTrends, setHistoryTrends] = useState(() => {
    try { const raw = localStorage.getItem(OURA_HISTORY_KEY); if (!raw) return null; const map = JSON.parse(raw); const today = new Date().toISOString().split("T")[0]; return computeBiometricTrends(map, today); } catch { return null; }
  });

  const syncFullHistory = async (token) => {
    const { start, end } = ouraSyncWindow();
    setSyncProgress({ step: "starting", done: 0, total: OURA_ENDPOINTS.length });
    const res = await fetchOuraRange(token, start, end, (p) => setSyncProgress(p), { mode });
    if (!res.connected) { setSyncProgress(null); return { ok: false, error: res.error }; }

    // Merge the freshly-fetched window into our stored history, preserving
    // days that were pulled in a previous larger sync.
    let existing = {};
    try { const raw = localStorage.getItem(OURA_HISTORY_KEY); if (raw) existing = JSON.parse(raw); } catch { /* ignore */ }
    const map = mergeOuraHistory(existing, res.historyMap);
    localStorage.setItem(OURA_HISTORY_KEY, JSON.stringify(map));
    localStorage.setItem(OURA_LAST_SYNC_KEY, new Date().toISOString());
    recordOuraHwm();

    const todayDate = new Date().toISOString().split("T")[0];
    const trends = computeBiometricTrends(map, todayDate);
    setHistoryTrends(trends);
    const today_d = map[todayDate] || {};
    if (today_d.sleepScore || today_d.readinessScore || today_d.avgHRV) {
      const bio = { ...biometrics, sleepScore: today_d.sleepScore ?? null, readinessScore: today_d.readinessScore ?? null, hrvBalance: today_d.hrvBalance ?? null, avgHRV: today_d.avgHRV ?? null, lowestHR: today_d.lowestHR ?? null, restingHR: today_d.restingHR ?? null, sleepEfficiency: today_d.sleepEfficiency ?? null, deepSleepMin: today_d.deepSleepMin ?? null, remSleepMin: today_d.remSleepMin ?? null, totalSleepMin: today_d.totalSleepMin ?? null, respiratoryRate: today_d.respiratoryRate ?? null, temperatureTrendDeviation: today_d.temperatureTrendDeviation ?? null, stressHighSec: today_d.stressHighSec ?? null, source: "oura" };
      setBiometrics(bio); localStorage.setItem(BIOMETRICS_KEY, JSON.stringify(bio));
    }
    setSyncProgress(null);
    return { ok: true, days: Object.keys(map).length, trends };
  };

  const connectOura = async () => {
    const token = patInput.trim();
    if (!token) return;
    setFetching(true);
    localStorage.setItem(OURA_ACCESS_KEY, token);
    setOuraToken(token);
    const res = await syncFullHistory(token);
    if (res.ok) {
      setOuraStatus({ connected: true, daysSynced: res.days, trends: res.trends });
      setPatInput("");
    } else {
      setOuraStatus({ connected: false, error: res.error });
    }
    setFetching(false);
  };

  const syncExisting = async () => {
    if (!ouraToken) return;
    setFetching(true);
    const res = await syncFullHistory(ouraToken);
    if (res.ok) setOuraStatus({ connected: true, daysSynced: res.days, trends: res.trends });
    else setOuraStatus({ connected: false, error: res.error });
    setFetching(false);
  };

  const updateManual = (key, val) => { const bio = { ...biometrics, [key]: val, source: "manual" }; setBiometrics(bio); localStorage.setItem(BIOMETRICS_KEY, JSON.stringify(bio)); };
  const updateLifestyle = (key, val) => { const ls = { ...lifestyle, [key]: val }; setLifestyle(ls); localStorage.setItem(LIFESTYLE_KEY, JSON.stringify(ls)); };
  const updateChrono = (val) => { setChronotype(val); localStorage.setItem(CHRONO_KEY, val); };

  // Merge a manual overlay for a specific date (gap-fill). Never touches Oura fields.
  const saveManualOverlay = (date, { sleepHours, sleepQuality }) => {
    let map = {};
    try { const raw = localStorage.getItem(OURA_HISTORY_KEY); if (raw) map = JSON.parse(raw); } catch { /* ignore */ }
    const overlay = {
      manualSleepMin: typeof sleepHours === "number" ? Math.round(sleepHours * 60) : null,
      manualSleepQual: typeof sleepQuality === "number" ? sleepQuality : null,
    };
    const next = upsertManualDay(map, date, overlay);
    localStorage.setItem(OURA_HISTORY_KEY, JSON.stringify(next));
    const today = new Date().toISOString().split("T")[0];
    setHistoryTrends(computeBiometricTrends(next, today));

    // If the overlay is for today, also push the derived values into the
    // biometrics state. Otherwise computeE0 (which reads `biometrics`, not
    // `trends`) would still be blind to the entry until the next sync.
    if (date === today) {
      const normalized = normalizeSleepEntry(next[today]) || {};
      const bio = {
        ...biometrics,
        manualSleepMin: overlay.manualSleepMin,
        manualSleepQual: overlay.manualSleepQual,
        totalSleepMin: normalized.totalSleepMin ?? biometrics?.totalSleepMin ?? null,
        sleepScore: normalized.sleepScore ?? biometrics?.sleepScore ?? null,
        source: biometrics?.source === "oura" ? biometrics.source : "manual",
      };
      setBiometrics(bio);
      try { localStorage.setItem(BIOMETRICS_KEY, JSON.stringify(bio)); } catch { /* ignore */ }
    }
  };

  const hasBio = biometrics && (biometrics.sleepScore || biometrics.manualSleep);
  const e0 = computeE0(biometrics, lifestyle);

  // Today's entry from storage for the parity review banner. Read fresh each
  // render so a save immediately clears the banner once the user corrects.
  const todayEntry = (() => {
    try {
      const raw = localStorage.getItem(OURA_HISTORY_KEY);
      if (!raw) return null;
      const map = JSON.parse(raw);
      const today = new Date().toISOString().split("T")[0];
      return map[today] || null;
    } catch { return null; }
  })();
  const openTodayEditor = () => {
    const today = new Date().toISOString().split("T")[0];
    setExpanded(true);
    setDetailsOpen(true);
    setEditingDate(today);
    setTimeout(() => {
      const el = document.getElementById("body-detail");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };

  return (
    <div id="body-detail" className="ca d1" style={{ marginBottom: 20, scrollMarginTop: 16 }}>
      <SleepReviewBanner entry={todayEntry} onCorrect={openTodayEditor} />
      <button onClick={() => setExpanded(!expanded)} type="button" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "1px solid var(--ln)", borderRadius: expanded ? "6px 6px 0 0" : 6, padding: "10px 14px", color: "var(--fg)", fontFamily: "var(--fm)", fontSize: 11, letterSpacing: 1, transition: "all .3s" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>◈</span>
          <span style={{ letterSpacing: 2, textTransform: "uppercase" }}>Body + Context</span>
          {hasBio && (() => { const lbl = e0Label(e0); return <span style={{ fontSize: 10, color: lbl.tone, opacity: 0.85, letterSpacing: 1 }}>{lbl.text}</span>; })()}
          {!hasBio && <span style={{ fontSize: 10, color: "var(--mt)", opacity: 0.5 }}>Optional</span>}
        </span>
        <span style={{ fontSize: 10, opacity: 0.4, transition: "transform .3s", transform: expanded ? "rotate(180deg)" : "none" }}>▼</span>
      </button>

      {expanded && (() => {
        // Merge historyTrends.today with biometrics state so the dashboard
        // reflects Apple Health or Oura data even when the trends map lags
        // by a day (the common case: export.zip doesn't include today yet).
        // Biometrics state is set on every successful sync / import.
        const t = { ...(historyTrends?.today || {}) };
        const mb = biometrics || {};
        for (const k of Object.keys(mb)) if (t[k] == null && mb[k] != null) t[k] = mb[k];

        // Source string used only by the top-of-panel status strip. The
        // per-card source chips were removed — the strip is the single
        // source-of-truth indicator for the whole panel.
        const srcStr = (t.source || mb.source || "").toLowerCase();

        const signed = (n, d = 0) => typeof n === "number" ? `${n >= 0 ? "+" : ""}${n.toFixed(d)}` : "—";
        const hrvDelta = historyTrends?.hrvDelta;
        const hrvColor = hrvDelta == null ? "var(--mt)" : hrvDelta >= -5 ? g : hrvDelta >= -15 ? y : r;
        const readyColor = t.readinessScore == null ? "var(--mt)" : t.readinessScore >= 80 ? g : t.readinessScore >= 70 ? y : r;
        const sleepScoreColor = t.sleepScore == null ? "var(--mt)" : t.sleepScore >= 80 ? g : t.sleepScore >= 70 ? y : r;
        const sleepHrs = t.totalSleepMin ? (t.totalSleepMin / 60) : null;

        // Fallback: when today's `sleep` detail hasn't been published by Oura
        // yet (common in the morning — daily scores land first, session detail
        // can lag several hours), walk back up to 5 days for the most recent
        // day that DOES carry sleep detail. Shown with a freshness label so
        // the user always has a recent signal rather than an empty card.
        // Runs every raw entry through normalizeSleepEntry so manually entered
        // sleep (manualSleepMin) is visible to this fallback — otherwise a
        // user who corrected yesterday's missing Oura night by typing hours
        // would see an empty card despite their data being on disk.
        const lastKnownSleep = (() => {
          if (t.totalSleepMin != null && t.avgHRV != null) return null;
          try {
            const h = JSON.parse(localStorage.getItem(OURA_HISTORY_KEY) || "{}");
            const todayISODate = new Date().toISOString().split("T")[0];
            for (let i = 1; i <= 5; i++) {
              const d = new Date(new Date(todayISODate).getTime() - i * 86400000).toISOString().split("T")[0];
              const e = normalizeSleepEntry(h[d]);
              if (e && (e.totalSleepMin != null || e.avgHRV != null)) {
                return { date: d, daysAgo: i, totalSleepMin: e.totalSleepMin ?? null, avgHRV: e.avgHRV ?? null, sleepEfficiency: e.sleepEfficiency ?? null, source: e.manualSleepMin != null && e.totalSleepMin === e.manualSleepMin ? "manual" : "oura" };
              }
            }
          } catch { /* ignore */ }
          return null;
        })();
        const freshnessLabel = (daysAgo) => daysAgo === 1 ? "Last night" : daysAgo === 2 ? "2 nights ago" : `${daysAgo} nights ago`;

        // Stress freshness (Oura UX rule): never substitute yesterday's stress
        // for today's. Only surface stress/restored when the day the trends
        // object resolved to IS today. If today's data hasn't published yet,
        // the sub line simply drops the stress segment — no stale fallback.
        const todayISO = new Date().toISOString().split("T")[0];
        const stressFresh = t.date === todayISO && typeof t.stressHighSec === "number";
        const restoredFresh = t.date === todayISO && typeof t.recoveryHighSec === "number";
        const err = ouraStatus?.error;
        const isNet = err && /network|CORS|Failed to fetch/i.test(err);
        const isAuth = err && /token|401|expired/i.test(err);

        // Self-rated cards are tappable — tap opens the single slider strip
        // below (for the focused metric only). Wearable-sourced cards are
        // read-only; no hover state, no cursor change. Source information
        // is NOT per-card — the status strip at the top of the panel is
        // the single source-of-truth indicator.
        const Card = ({ label, hero, heroColor, sub, ratingKey }) => {
          const isSelf = !!ratingKey;
          const isFocused = isSelf && ratingFocus === ratingKey;
          return (
            <div
              role={isSelf ? "button" : undefined}
              tabIndex={isSelf ? 0 : undefined}
              onClick={isSelf ? () => setRatingFocus(isFocused ? null : ratingKey) : undefined}
              onKeyDown={isSelf ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRatingFocus(isFocused ? null : ratingKey); } } : undefined}
              style={{
                flex: 1, minWidth: 0, padding: "12px 14px",
                background: isFocused ? "var(--fg)" : "var(--cd)",
                color: isFocused ? "var(--bg)" : "var(--fg)",
                border: `1px solid ${isFocused ? "var(--fg)" : "var(--ln)"}`,
                borderRadius: 10,
                cursor: isSelf ? "pointer" : "default",
                transition: "background .15s, border-color .15s, color .15s",
              }}
            >
              <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: isFocused ? "var(--bg)" : "var(--mt)", opacity: isFocused ? 0.75 : 1, fontFamily: "var(--fm)", marginBottom: 8 }}>
                {label}
              </div>
              <div style={{ fontSize: 26, fontWeight: 600, fontFamily: "var(--fn)", color: isFocused ? "var(--bg)" : (heroColor || "var(--fg)"), lineHeight: 1.0, marginBottom: 6, letterSpacing: -0.02, fontVariantNumeric: "tabular-nums lining-nums" }}>{hero}</div>
              <div style={{ fontSize: 10, color: isFocused ? "var(--bg)" : "var(--mt)", opacity: isFocused ? 0.75 : 1, fontFamily: "var(--fm)", lineHeight: 1.5, minHeight: 14 }}>{sub}</div>
            </div>
          );
        };

        return (
          <div style={{ border: "1px solid var(--ln)", borderTop: "none", borderRadius: "0 0 6px 6px", padding: 16 }}>

            {/* Connection status — tappable on the left group to trigger resync. Manage in the Integrations panel (gear icon, top-right). */}
            {(() => {
              const lastSyncIso = (() => { try { return localStorage.getItem(OURA_LAST_SYNC_KEY); } catch { return null; } })();
              const isSyncing = !!syncProgress;
              // "Partial" = today fetched a readiness/stress summary but the
              // heavier `sleep` detail endpoint hasn't published yet. Tap-to-
              // retry is the right affordance here: Oura often finalizes the
              // sleep session hours after the daily summary.
              const hasReadiness = t.readinessScore != null;
              const hasSleepDetail = t.totalSleepMin != null;
              const partial = ouraToken && hasReadiness && !hasSleepDetail;
              const canTap = !!ouraToken && !isSyncing;
              const statusText = !ouraToken
                ? (srcStr.includes("apple") ? "Apple Health imported" : "No wearable connected")
                : isSyncing
                  ? "Syncing…"
                  : lastSyncIso
                    ? `Oura · synced ${timeAgo(lastSyncIso)}`
                    : "Oura connected";
              const handleTap = () => { if (canTap) syncExisting(); };
              return (
                <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 12px", background: "var(--cd)", border: "1px solid var(--ln)", borderRadius: 6 }}>
                  <div
                    role={canTap ? "button" : undefined}
                    tabIndex={canTap ? 0 : undefined}
                    aria-label={canTap ? "Refresh Oura data" : undefined}
                    onClick={handleTap}
                    onKeyDown={(e) => { if (canTap && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); handleTap(); } }}
                    onMouseEnter={(e) => { if (canTap) e.currentTarget.style.background = "rgba(0,0,0,0.04)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      cursor: canTap ? "pointer" : "default",
                      opacity: isSyncing ? 0.55 : 1,
                      padding: "2px 6px", margin: "-2px -6px",
                      borderRadius: 4,
                      transition: "background .15s, opacity .15s",
                      outline: "none",
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: ouraToken ? (partial ? y : g) : "var(--mt)", display: "inline-block" }} />
                    <span style={{ fontSize: 10, color: ouraToken ? "var(--fg)" : "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1 }}>
                      {statusText}
                    </span>
                    {canTap && (
                      <span style={{ fontSize: 10, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1, opacity: 0.7 }}>
                        · {partial ? "tap to retry" : "tap to refresh"}
                      </span>
                    )}
                  </div>
                  {mode === "reflect" && (
                    <span style={{ fontSize: 9, color: "#b9a36a", fontFamily: "var(--fm)", letterSpacing: 1.5, textTransform: "uppercase", opacity: 0.9 }}>· Reflect</span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1, opacity: 0.7 }}>Manage in settings ⚙</span>
                </div>
              );
            })()}

            {syncProgress && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 9, color: "var(--mt)", fontFamily: "var(--fm)", marginBottom: 3, letterSpacing: 1 }}>Syncing {syncProgress.step}… {syncProgress.done}/{syncProgress.total}</div>
                <div style={{ height: 2, background: "var(--ln)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(syncProgress.done / syncProgress.total) * 100}%`, background: g, transition: "width .3s" }} />
                </div>
              </div>
            )}

            {err && (
              <div style={{ fontSize: 10, color: y, fontFamily: "var(--fm)", marginBottom: 14, lineHeight: 1.5, padding: "8px 10px", background: "rgba(184,134,11,0.06)", border: `1px solid ${y}`, borderRadius: 6 }}>
                <span style={{ fontWeight: 600 }}>{isAuth ? "Token expired" : isNet ? "Couldn't reach Oura" : "Partial data"}</span>
                <span style={{ opacity: 0.75 }}> — {isAuth ? "reconnect with a fresh token." : isNet ? "we'll use your sliders instead." : "we'll use what came through."}</span>
              </div>
            )}

            {/* Body-cards row.
                · Full mode: always shows 3 cards (Sleep / Recovery /
                  Readiness) with self-rate fallback when no wearable.
                · Reflect mode: shows ONLY cards that carry real data.
                  An empty "Activity 0 · No data yet" card is visual
                  debt, not a signal. If nothing has data we show one
                  compact placeholder row instead of two ghost cards. */}
            {mode === "reflect" && (() => {
              // Any meaningful body signal — sleep (wearable) or movement
              // (iPhone motion coprocessor). If neither exists, we show
              // the placeholder instead of two ghost cards.
              const hasSleep = t.totalSleepMin != null;
              const hasActivity = typeof t.steps === "number" || typeof t.activeMinutes === "number";
              if (!hasSleep && !hasActivity) {
                return (
                  <div style={{ marginBottom: 14, padding: "14px 16px", background: "var(--cd)", border: "1px dashed var(--ln)", borderRadius: 10, fontSize: 11, color: "var(--mt)", lineHeight: 1.6, fontFamily: "var(--fm)" }}>
                    No passive biometrics yet. Import Apple Health or connect Oura from Settings to add body context — otherwise your journal and cognitive check-in below are where Ori does its work.
                  </div>
                );
              }
              return null;
            })()}
            <div style={{ display: (mode === "reflect" && !(t.totalSleepMin != null || typeof t.steps === "number" || typeof t.activeMinutes === "number")) ? "none" : "flex", gap: 8, marginBottom: 14 }}>
              {/* Reflect mode: only render Sleep when data exists. Full
                  mode: always render (with self-rate or waiting states). */}
              {(mode !== "reflect" || t.totalSleepMin != null || lastKnownSleep?.totalSleepMin != null) && (() => {
                const sleepMin = t.totalSleepMin ?? lastKnownSleep?.totalSleepMin ?? null;
                const sleepMinHrs = sleepMin != null ? sleepMin / 60 : null;
                const isStale = t.totalSleepMin == null && lastKnownSleep?.totalSleepMin != null;
                const effVal = t.totalSleepMin != null ? t.sleepEfficiency : lastKnownSleep?.sleepEfficiency;
                return (
                  <Card
                    label="Sleep"
                    ratingKey={sleepMin == null && !ouraToken ? "sleep" : null}
                    hero={sleepMin != null
                      ? `${Math.floor(sleepMinHrs)}h ${Math.round((sleepMinHrs - Math.floor(sleepMinHrs)) * 60)}m`
                      : (ouraToken ? "—" : `${biometrics?.manualSleep || 7}/10`)}
                    heroColor={isStale
                      ? "var(--mt)"
                      : (t.sleepScore != null
                          ? sleepScoreColor
                          : (ouraToken && sleepMin == null
                              ? "var(--mt)"
                              : ((biometrics?.manualSleep || 7) >= 7 ? g : y)))}
                    sub={t.totalSleepMin != null
                      ? (historyTrends?.sri != null
                          ? `Reg ${historyTrends.sri}${effVal ? ` · ${effVal}% eff` : ""}`
                          : (effVal ? `${effVal}% eff` : ""))
                      : (isStale
                          ? `${freshnessLabel(lastKnownSleep.daysAgo)}${effVal ? ` · ${effVal}% eff` : ""}`
                          : (ouraToken
                              ? "Waiting for Oura"
                              : (ratingFocus === "sleep" ? "Drag to rate" : "Tap to rate")))}
                  />
                );
              })()}
              {mode === "reflect" ? (() => {
                // Activity card — only rendered when we actually have
                // steps or active-minutes data. An empty placeholder
                // ("No activity data yet") is visual noise in Reflect.
                const steps = t.steps;
                const mins = t.activeMinutes;
                const hasAny = typeof steps === "number" || typeof mins === "number";
                if (!hasAny) return null;
                const stepLabel = typeof steps === "number" ? steps.toLocaleString() : "—";
                const stepColor = typeof steps === "number"
                  ? (steps >= 8000 ? g : steps >= 5000 ? y : r)
                  : "var(--mt)";
                const chips = [];
                if (typeof mins === "number" && mins > 0) chips.push(`${Math.round(mins)} min active`);
                return (
                  <Card
                    label="Activity"
                    hero={stepLabel}
                    heroColor={stepColor}
                    sub={chips.length ? chips.join(" · ") : "steps today"}
                  />
                );
              })() : (() => {
                const hrvVal = t.avgHRV ?? lastKnownSleep?.avgHRV ?? null;
                const isStale = t.avgHRV == null && lastKnownSleep?.avgHRV != null;
                return (
                  <Card
                    label="Recovery"
                    ratingKey={hrvVal == null && !ouraToken ? "energy" : null}
                    hero={hrvVal != null
                      ? `${Math.round(hrvVal)}ms`
                      : (ouraToken ? "—" : `${biometrics?.manualEnergy || 7}/10`)}
                    heroColor={isStale
                      ? "var(--mt)"
                      : (t.avgHRV != null
                          ? (historyTrends?.baselineStatus?.recoveryCalibrated ? hrvColor : "var(--mt)")
                          : (ouraToken ? "var(--mt)" : ((biometrics?.manualEnergy || 7) >= 7 ? g : y)))}
                    sub={t.avgHRV != null
                      ? (historyTrends?.baselineStatus?.recoveryCalibrated
                          ? (hrvDelta != null ? `${signed(hrvDelta, 0)}% vs baseline` : "HRV")
                          : `Calibrating · ${historyTrends?.baselineStatus?.hrvDays ?? 0}/${BASELINE_MIN_DAYS}`)
                      : (isStale
                          ? freshnessLabel(lastKnownSleep.daysAgo)
                          : (ouraToken
                              ? "Waiting for Oura"
                              : (ratingFocus === "energy" ? "Drag to rate" : "Tap to rate")))}
                  />
                );
              })()}
              {mode !== "reflect" && (() => {
                // Readiness is a derived score. Display is gated on both (a)
                // whether a score was computed, and (b) whether our personal
                // baseline has enough depth to trust day-to-day comparisons.
                // Even if Oura pre-calibrated a score upstream, we surface
                // "Calibrating" when OUR history is thin — we can't place
                // that score against a personal baseline we don't have yet.
                const bs = historyTrends?.baselineStatus;
                // "Has a wearable contributed anything to the last 14 days?"
                // Using history (not today's row) so gap days don't collapse
                // the user back into self-rate mode when they genuinely have
                // a wearable attached.
                const hasWearableHistory = ((bs?.hrvDays ?? 0) + (bs?.rhrDays ?? 0) + (bs?.sleepDays ?? 0)) > 0;
                const calibrating = hasWearableHistory && !bs?.readinessCalibrated;
                const calibN = Math.max(bs?.hrvDays ?? 0, bs?.rhrDays ?? 0);
                if (calibrating) {
                  return (
                    <Card
                      label="Readiness"
                      hero={"—"}
                      heroColor={"var(--mt)"}
                      sub={`Calibrating · ${calibN}/${BASELINE_MIN_DAYS} days`}
                    />
                  );
                }
                return (
              <Card
                label="Readiness"
                ratingKey={t.readinessScore == null ? "readiness" : null}
                hero={t.readinessScore != null ? `${t.readinessScore}` : biometrics?.manualReadiness != null ? `${biometrics.manualReadiness}/10` : "—"}
                heroColor={t.readinessScore != null ? readyColor : biometrics?.manualReadiness != null ? (biometrics.manualReadiness >= 7 ? g : biometrics.manualReadiness >= 4 ? y : r) : "var(--mt)"}
                // ONE meaningful driver when today's data is fresh. Prefer
                // stress (today-specific, acute signal); fall back to the
                // temperature-trend chip if stress isn't published; otherwise
                // empty. No "Wearable composite score" filler — the number
                // already carries that meaning.
                sub={t.readinessScore != null
                  ? (stressFresh
                      ? `Stress ${Math.round(t.stressHighSec / 60)}m`
                      : (t.temperatureTrendDeviation != null
                          ? `Temp ${signed(t.temperatureTrendDeviation, 2)}°`
                          : ""))
                  : biometrics?.manualReadiness != null
                  ? (ratingFocus === "readiness" ? "Drag to rate" : "Self-rated")
                  : (ratingFocus === "readiness" ? "Drag to rate" : "Tap to rate")}
              />
                );
              })()}
            </div>

            {/* Focused slider strip — renders only for the card being edited. */}
            {ratingFocus && (() => {
              const spec = ratingFocus === "sleep"
                ? { label: "Sleep", key: "manualSleep", val: biometrics?.manualSleep || 7 }
                : ratingFocus === "energy"
                ? { label: "Energy", key: "manualEnergy", val: biometrics?.manualEnergy || 7 }
                : { label: "Readiness", key: "manualReadiness", val: biometrics?.manualReadiness || 7 };
              // Live contextual anchor so "7" means something consistent over
              // time. Anchors are deliberately personal ("Usual" = usual for
              // you), not absolute — matching how validated sleep-quality
              // VAS scales reach better PSG agreement than unlabelled ones.
              const anchor = selfRateAnchor(ratingFocus, spec.val);
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, padding: "10px 14px", background: "var(--cd)", border: "1px solid var(--ln)", borderRadius: 8 }}>
                  <span style={{ fontSize: 9, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1.5, textTransform: "uppercase", minWidth: 96, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span>{spec.label}</span>
                    <span style={{ fontSize: 9, letterSpacing: 0.5, textTransform: "none", color: "var(--fg)", opacity: 0.85 }}>{anchor}</span>
                  </span>
                  <input
                    type="range" min="1" max="10" value={spec.val}
                    onChange={(e) => updateManual(spec.key, parseInt(e.target.value))}
                    onMouseUp={() => setRatingFocus(null)}
                    onTouchEnd={() => setRatingFocus(null)}
                    style={{ flex: 1, accentColor: "var(--ac)" }}
                    autoFocus
                  />
                  <span style={{ fontSize: 16, fontFamily: "var(--fn)", fontWeight: 600, color: "var(--fg)", minWidth: 28, textAlign: "right", letterSpacing: -0.02, fontVariantNumeric: "tabular-nums lining-nums" }}>{spec.val}</span>
                  <button type="button" onClick={() => setRatingFocus(null)} style={{ background: "transparent", border: "none", color: "var(--mt)", cursor: "pointer", fontSize: 12, padding: "2px 6px", fontFamily: "var(--fm)" }} aria-label="Done rating">Done</button>
                </div>
              );
            })()}

            {/* Cognitive Check-in — progressive disclosure.
                Default: a single summary row showing the most recent result
                + a chevron. Tap opens the full 3-tile grid (KSS / PSS / PVT)
                and keeps the inline editors for each test unchanged. */}
            <div id="mind-detail" style={{ marginBottom: 14, scrollMarginTop: 16 }}>
              <div id="mood-detail" style={{ fontSize: 10, letterSpacing: 1.8, textTransform: "uppercase", marginBottom: 10, color: "var(--mt)", fontFamily: "var(--fm)", scrollMarginTop: 16 }}>A small check-in</div>
              {!mindExpanded && (() => {
                // Three plain-language rows, one per test. Each tappable —
                // opens the expanded tile grid and (for KSS/PSS-4) scrolls
                // the editor into view. PVT opens its own modal. Labels are
                // written so they ask a question rather than announce a
                // diagnostic instrument.
                const rows = [
                  {
                    key: "kss",
                    question: "How awake do you feel",
                    value: checkin.kss ? `${checkin.kss.value}/9` : null,
                    ts: checkin.kss?.timestamp,
                    sub: "one tap",
                  },
                  {
                    key: "pss4",
                    question: "How held-together, lately",
                    value: checkin.pss4 ? `${checkin.pss4.score}/16` : null,
                    ts: checkin.pss4?.timestamp,
                    sub: "4 questions",
                  },
                  {
                    key: "pvt",
                    question: "How quick, right now",
                    value: checkin.pvtb?.latest ? `${checkin.pvtb.latest.meanRT} ms` : null,
                    ts: checkin.pvtb?.latest?.timestamp,
                    sub: "60-sec test",
                  },
                ];
                const openRow = (key) => {
                  setMindExpanded(true);
                  if (key === "pvt") setPvtOpen(true);
                  else setCheckinOpen(key);
                };
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {rows.map((it) => (
                      <button
                        key={it.key}
                        type="button"
                        onClick={() => openRow(it.key)}
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "var(--sf)", border: "1px solid var(--ln)", borderRadius: 12, cursor: "pointer", textAlign: "left", fontFamily: "var(--fm)" }}
                      >
                        <div>
                          <div style={{ fontSize: 15, fontFamily: "var(--fn)", fontWeight: 500, color: "var(--fg)", letterSpacing: -0.005 }}>{it.question}</div>
                          <div style={{ fontSize: 11, fontFamily: "var(--fn)", fontWeight: 400, color: "var(--mt)", marginTop: 4 }}>
                            {it.ts ? timeAgo(it.ts) : it.sub}
                          </div>
                        </div>
                        <div style={{ fontSize: 16, fontFamily: "var(--fn)", fontWeight: 600, color: it.value ? "var(--fg)" : "var(--mt)", letterSpacing: -0.02, fontVariantNumeric: "tabular-nums lining-nums" }}>
                          {it.value || "skip"}
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })()}
              {mindExpanded && (<>
              <div style={{ display: "flex", gap: 8 }}>
                {(() => {
                  const kss = checkin.kss;
                  const kssCol = !kss ? "var(--mt)" : kss.value <= 3 ? g : kss.value <= 6 ? y : r;
                  const active = checkinOpen === "kss";
                  return (
                    <button type="button" onClick={() => setCheckinOpen(active ? null : "kss")}
                      style={{ flex: 1, minWidth: 0, padding: "10px 12px", background: active ? "var(--fg)" : "var(--cd)", color: active ? "var(--bg)" : "var(--fg)", border: `1px solid ${active ? "var(--fg)" : "var(--ln)"}`, borderRadius: 10, textAlign: "left", fontFamily: "var(--fm)", cursor: "pointer" }}>
                      <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", opacity: active ? 0.7 : 0.55, marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                        <span>Alert</span><span style={{ fontSize: 8, opacity: 0.8 }}>KSS</span>
                      </div>
                      <div style={{ fontSize: 24, fontFamily: "var(--fn)", fontWeight: 600, color: active ? "var(--bg)" : kssCol, lineHeight: 1.0, marginBottom: 4, letterSpacing: -0.02, fontVariantNumeric: "tabular-nums lining-nums" }}>{kss ? `${kss.value}` : "—"}<span style={{ fontSize: 12, opacity: 0.5, fontWeight: 400, marginLeft: 1 }}>{kss ? "/9" : ""}</span></div>
                      <div style={{ fontSize: 9, opacity: active ? 0.7 : 0.55 }}>{kss ? timeAgo(kss.timestamp) : "Tap to rate"}</div>
                    </button>
                  );
                })()}
                {(() => {
                  const pss = checkin.pss4;
                  const pssCol = !pss ? "var(--mt)" : pss.score <= 5 ? g : pss.score <= 9 ? y : r;
                  const active = checkinOpen === "pss4";
                  return (
                    <button type="button" onClick={() => setCheckinOpen(active ? null : "pss4")}
                      style={{ flex: 1, minWidth: 0, padding: "10px 12px", background: active ? "var(--fg)" : "var(--cd)", color: active ? "var(--bg)" : "var(--fg)", border: `1px solid ${active ? "var(--fg)" : "var(--ln)"}`, borderRadius: 10, textAlign: "left", fontFamily: "var(--fm)", cursor: "pointer" }}>
                      <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", opacity: active ? 0.7 : 0.55, marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                        <span>Stress</span><span style={{ fontSize: 8, opacity: 0.8 }}>PSS-4</span>
                      </div>
                      <div style={{ fontSize: 24, fontFamily: "var(--fn)", fontWeight: 600, color: active ? "var(--bg)" : pssCol, lineHeight: 1.0, marginBottom: 4, letterSpacing: -0.02, fontVariantNumeric: "tabular-nums lining-nums" }}>{pss ? `${pss.score}` : "—"}<span style={{ fontSize: 12, opacity: 0.5, fontWeight: 400, marginLeft: 1 }}>{pss ? "/16" : ""}</span></div>
                      <div style={{ fontSize: 9, opacity: active ? 0.7 : 0.55 }}>{pss ? timeAgo(pss.timestamp) : "4 quick questions"}</div>
                    </button>
                  );
                })()}
                {(() => {
                  const pvt = checkin.pvtb?.latest;
                  const pvtCol = !pvt ? "var(--mt)" : pvt.meanRT < 280 ? g : pvt.meanRT < 330 ? g : pvt.meanRT < 400 ? y : r;
                  return (
                    <button type="button" onClick={() => setPvtOpen(true)}
                      style={{ flex: 1, minWidth: 0, padding: "10px 12px", background: "var(--cd)", color: "var(--fg)", border: "1px solid var(--ln)", borderRadius: 10, textAlign: "left", fontFamily: "var(--fm)", cursor: "pointer" }}>
                      <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", opacity: 0.55, marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                        <span>Reaction</span><span style={{ fontSize: 8, opacity: 0.8 }}>PVT-B</span>
                      </div>
                      <div style={{ fontSize: 24, fontFamily: "var(--fn)", fontWeight: 600, color: pvtCol, lineHeight: 1.0, marginBottom: 4, letterSpacing: -0.02, fontVariantNumeric: "tabular-nums lining-nums" }}>{pvt ? pvt.meanRT : "—"}<span style={{ fontSize: 12, opacity: 0.5, fontWeight: 400, marginLeft: 2 }}>{pvt ? "ms" : ""}</span></div>
                      <div style={{ fontSize: 9, opacity: 0.55 }}>{pvt ? `${timeAgo(pvt.timestamp)} · ${pvt.lapses} lapse${pvt.lapses === 1 ? "" : "s"}` : "Tap to run · 60s"}</div>
                    </button>
                  );
                })()}
              </div>

              {checkinOpen === "kss" && (
                <div style={{ marginTop: 10, padding: "12px 14px", background: "var(--cd)", border: "1px solid var(--ln)", borderRadius: 8 }}>
                  <KssEditor
                    initial={checkin.kss?.value}
                    onSave={(v) => {
                      // Stamp minutes-since-wake so circadian variation is
                      // recoverable from the data later (morning KSS vs
                      // afternoon KSS are different measurements).
                      const map = (() => { try { return JSON.parse(localStorage.getItem(OURA_HISTORY_KEY) || "{}"); } catch { return {}; } })();
                      const msw = minutesSinceLastWake(map);
                      persistCheckin({ ...checkin, kss: { value: v, timestamp: new Date().toISOString(), minutesSinceWake: msw } });
                      setCheckinOpen(null);
                    }}
                    onCancel={() => setCheckinOpen(null)}
                  />
                </div>
              )}
              {checkinOpen === "pss4" && (
                <div style={{ marginTop: 10, padding: "12px 14px", background: "var(--cd)", border: "1px solid var(--ln)", borderRadius: 8 }}>
                  <Pss4Survey
                    initial={checkin.pss4?.items}
                    onSave={(items, score) => {
                      const map = (() => { try { return JSON.parse(localStorage.getItem(OURA_HISTORY_KEY) || "{}"); } catch { return {}; } })();
                      const msw = minutesSinceLastWake(map);
                      persistCheckin({ ...checkin, pss4: { items, score, timestamp: new Date().toISOString(), minutesSinceWake: msw } });
                      setCheckinOpen(null);
                    }}
                    onCancel={() => setCheckinOpen(null)}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => { setCheckinOpen(null); setMindExpanded(false); }}
                style={{ marginTop: 8, width: "100%", background: "transparent", border: "none", color: "var(--mt)", fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer", padding: "6px 0", opacity: 0.7 }}
              >Collapse ▴</button>
              </>)}
            </div>

            {/* Progressive disclosure: More details */}
            <button onClick={() => setDetailsOpen(!detailsOpen)} type="button" style={{ width: "100%", padding: "6px 10px", background: "transparent", border: "1px solid var(--ln)", borderRadius: 6, fontSize: 9, fontFamily: "var(--fm)", letterSpacing: 1.5, textTransform: "uppercase", color: "var(--mt)", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>More detail</span>
              <span style={{ fontSize: 9, transition: "transform .2s", transform: detailsOpen ? "rotate(180deg)" : "none" }}>▼</span>
            </button>

            {detailsOpen && (() => {
              // Build last 7 days
              const last7Dates = Array.from({ length: 7 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() - (6 - i));
                return d.toISOString().split("T")[0];
              });
              let map = {};
              try { const raw = localStorage.getItem(OURA_HISTORY_KEY); if (raw) map = JSON.parse(raw); } catch { /* ignore */ }
              const dayLabel = (iso) => {
                const d = new Date(iso);
                return d.toLocaleDateString("en-US", { weekday: "narrow" });
              };
              const prettyDate = (iso) => {
                const d = new Date(iso);
                return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
              };
              const editingEntry = editingDate ? (map[editingDate] || {}) : null;
              const editingHasOura = editingEntry && editingEntry.totalSleepMin != null;
              const editingIsSuspect = isSuspectSleep(editingEntry);
              const editingHasManual = editingEntry?.manualSleepMin != null;
              const [initH, initQ] = (() => {
                if (!editingEntry) return [7, 7];
                const h = editingEntry.manualSleepMin != null ? editingEntry.manualSleepMin / 60 : (editingEntry.totalSleepMin != null ? editingEntry.totalSleepMin / 60 : 7);
                const q = editingEntry.manualSleepQual != null ? editingEntry.manualSleepQual : 7;
                return [Number(h.toFixed(2)), q];
              })();

            return (
              <div style={{ padding: "12px 14px", background: "var(--cd)", borderRadius: 8, marginBottom: 10 }}>
                {/* Rhythm — set-once chronotype. Lives under More detail
                    because it rarely changes and doesn't belong next to the
                    daily-shifting numbers above. */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap", paddingBottom: 12, borderBottom: "1px solid var(--ln)" }}>
                  <span style={{ fontSize: 9, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1.5, textTransform: "uppercase", marginRight: 4 }}>Rhythm</span>
                  {Object.entries(CHRONOTYPES).map(([key, ct]) => (
                    <Pill key={key} active={chronotype === key} onClick={() => updateChrono(key)}>{ct.label}</Pill>
                  ))}
                </div>

                {/* 7-day gap-fill strip */}
                <div style={{ marginBottom: 12 }}>
                  {(() => {
                    // Count only days that still need review — a day the user
                    // has already corrected stops showing the warning.
                    const suspectCount = last7Dates.filter((iso) => needsSleepReview(map[iso])).length;
                    return suspectCount > 0 ? (
                      <div style={{ marginBottom: 8, padding: "8px 10px", background: "rgba(184,134,11,0.08)", border: `1px solid ${y}`, borderRadius: 6, fontSize: 10, color: y, fontFamily: "var(--fm)", lineHeight: 1.5 }}>
                        <strong>{suspectCount} {suspectCount === 1 ? "day looks" : "days look"} off</strong> — Oura logged less than 3h of sleep. Tap the ⚠ below to enter the real hours.
                      </div>
                    ) : null;
                  })()}
                  <div style={{ fontSize: 9, color: "var(--mt)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Last 7 days</span>
                    <span style={{ opacity: 0.5, fontSize: 8 }}>● Oura  ✦ Self  ⚠ Check  ○ Empty</span>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {last7Dates.map((iso) => {
                      const entry = map[iso] || {};
                      const src = sleepSourceFor(entry);
                      // Strip shows ⚠ only when review is still pending. Once
                      // the user corrects a suspect day, it flips to ✦ (self).
                      const suspect = needsSleepReview(entry);
                      const dot = suspect ? "⚠" : src === "oura" ? "●" : src === "manual" ? "✦" : "○";
                      const dotColor = suspect ? y : src === "oura" ? g : src === "manual" ? y : "var(--mt)";
                      const isToday = iso === new Date().toISOString().split("T")[0];
                      const isEditing = iso === editingDate;
                      return (
                        <button key={iso} type="button" onClick={() => setEditingDate(isEditing ? null : iso)}
                          style={{ flex: 1, padding: "6px 0", background: isEditing ? "var(--fg)" : suspect ? "rgba(184,134,11,0.06)" : "transparent", color: isEditing ? "var(--bg)" : "var(--fg)", border: `1px solid ${isEditing ? "var(--fg)" : suspect ? y : "var(--ln)"}`, borderRadius: 6, fontFamily: "var(--fm)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                          <span style={{ fontSize: 10, letterSpacing: 0.5, opacity: isToday && !isEditing ? 1 : 0.7 }}>{dayLabel(iso)}</span>
                          <span style={{ fontSize: 11, color: isEditing ? "var(--bg)" : dotColor }}>{dot}</span>
                        </button>
                      );
                    })}
                  </div>
                  {editingDate && (
                    <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--bg)", border: "1px solid var(--ln)", borderRadius: 8 }}>
                      <div style={{ fontSize: 10, fontFamily: "var(--fm)", color: "var(--fg)", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 500 }}>{prettyDate(editingDate)}</span>
                        {editingIsSuspect && <span style={{ fontSize: 9, color: y, opacity: 0.9 }}>⚠ Oura reading looks off</span>}
                        {editingHasManual && !editingIsSuspect && <span style={{ fontSize: 9, color: y, opacity: 0.8 }}>Self-reported</span>}
                        {editingHasOura && !editingIsSuspect && !editingHasManual && <span style={{ fontSize: 9, color: g, opacity: 0.8 }}>Oura recorded</span>}
                      </div>
                      {editingIsSuspect ? (
                        <>
                          <div style={{ fontSize: 10, color: "var(--mt)", fontFamily: "var(--fm)", lineHeight: 1.6, marginBottom: 10 }}>
                            Oura logged only {editingEntry.totalSleepMin}m — likely the ring missed your main sleep. Override with what you actually slept:
                          </div>
                          <ManualDayEditor
                            initialHours={7}
                            initialQuality={7}
                            hasExisting={editingHasManual}
                            onSave={(h, q) => { saveManualOverlay(editingDate, { sleepHours: h, sleepQuality: q }); setEditingDate(null); }}
                            onClear={() => { saveManualOverlay(editingDate, { sleepHours: null, sleepQuality: null }); setEditingDate(null); }}
                            onCancel={() => setEditingDate(null)}
                          />
                        </>
                      ) : editingHasOura && !editingHasManual ? (
                        <div style={{ fontSize: 10, color: "var(--mt)", fontFamily: "var(--fm)", lineHeight: 1.6 }}>
                          Sleep {Math.floor(editingEntry.totalSleepMin / 60)}h {editingEntry.totalSleepMin % 60}m · HRV {editingEntry.avgHRV || "—"}ms. Oura's record is used for this day.
                        </div>
                      ) : (
                        <ManualDayEditor
                          initialHours={initH}
                          initialQuality={initQ}
                          hasExisting={editingHasManual}
                          onSave={(h, q) => { saveManualOverlay(editingDate, { sleepHours: h, sleepQuality: q }); setEditingDate(null); }}
                          onClear={() => { saveManualOverlay(editingDate, { sleepHours: null, sleepQuality: null }); setEditingDate(null); }}
                          onCancel={() => setEditingDate(null)}
                        />
                      )}
                    </div>
                  )}
                </div>

                {/* Trend row */}
                {historyTrends && (
                  <div style={{ fontSize: 10, color: "var(--fg)", fontFamily: "var(--fm)", lineHeight: 1.9, marginBottom: 12 }}>
                    <div style={{ fontSize: 9, color: "var(--mt)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>7–30 Day Trends</div>
                    {historyTrends.sleepDebtH != null && <div>Sleep debt: <strong>{historyTrends.sleepDebtH >= 0 ? `${historyTrends.sleepDebtH.toFixed(1)}h behind` : `${Math.abs(historyTrends.sleepDebtH).toFixed(1)}h surplus`}</strong>{historyTrends.selfReportedDays7 > 0 && <span style={{ color: "var(--mt)", opacity: 0.7 }}> ({historyTrends.selfReportedDays7} self-reported)</span>}</div>}
                    {historyTrends.tempDev7 != null && <div>Temp trend (7d): <strong>{signed(historyTrends.tempDev7, 2)}°C</strong></div>}
                    {historyTrends.stress7 != null && <div>Stress avg (7d): <strong>{Math.round(historyTrends.stress7 / 60)}min/day</strong></div>}
                    {historyTrends.readiness30 != null && <div>Readiness (30d): <strong>{historyTrends.readiness30.toFixed(0)}</strong></div>}
                  </div>
                )}

                {/* Lifestyle */}
                <div style={{ display: "flex", gap: 16, marginBottom: 4 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Hydration</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {[["low", "Low"], ["average", "Avg"], ["good", "Good"]].map(([k, l]) => {
                        const current = lifestyle?.hydrationLevel ?? (typeof lifestyle?.hydration === "number" ? (lifestyle.hydration < 4 ? "low" : lifestyle.hydration > 8 ? "good" : "average") : "average");
                        return <Pill key={k} active={current === k} onClick={() => updateLifestyle("hydrationLevel", k)}>{l}</Pill>;
                      })}
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Exercise</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {[["none", "None"], ["light", "Light"], ["moderate", "Mod"], ["intense", "Hard"]].map(([k, l]) => (
                        <Pill key={k} active={(lifestyle?.exercise || "none") === k} onClick={() => updateLifestyle("exercise", k)}>{l}</Pill>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 9, color: "var(--mt)", fontFamily: "var(--fm)", opacity: 0.55, marginBottom: 10, lineHeight: 1.5 }}>
                  ~2L/day is average adult baseline (WHO). Qualitative on purpose — we don't ask you to count glasses.
                </div>

                {/* Self-report sliders — all 3 when Oura has full data */}
                {t.totalSleepMin && t.avgHRV != null && t.readinessScore != null && (
                  <div style={{ display: "flex", gap: 14 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Self sleep · {biometrics?.manualSleep || 7}</div>
                      <input type="range" min="1" max="10" value={biometrics?.manualSleep || 7} onChange={e => updateManual("manualSleep", parseInt(e.target.value))} style={{ width: "100%", accentColor: "var(--ac)" }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Self energy · {biometrics?.manualEnergy || 7}</div>
                      <input type="range" min="1" max="10" value={biometrics?.manualEnergy || 7} onChange={e => updateManual("manualEnergy", parseInt(e.target.value))} style={{ width: "100%", accentColor: "var(--ac)" }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Self ready · {biometrics?.manualReadiness || 7}</div>
                      <input type="range" min="1" max="10" value={biometrics?.manualReadiness || 7} onChange={e => updateManual("manualReadiness", parseInt(e.target.value))} style={{ width: "100%", accentColor: "var(--ac)" }} />
                    </div>
                  </div>
                )}
              </div>
            );
            })()}

            <div style={{ padding: "8px 12px", background: "var(--cd)", borderRadius: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 9, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1.5, textTransform: "uppercase" }}>Baseline</span>
              {(() => { const lbl = e0Label(e0); return <span style={{ fontSize: 15, fontWeight: 300, fontFamily: "var(--fd)", color: lbl.tone, letterSpacing: 1 }}>{lbl.text}</span>; })()}
            </div>

            {/* "What landed from your last sync" — temporary diagnostic. Closed
                by default. When tapped, prints the fields on the most recent
                day so the user can confirm the new metrics are flowing through.
                Pure read of localStorage; no side effects. */}
            <details style={{ marginTop: 12, background: "var(--cd)", border: "1px solid var(--ln)", borderRadius: 6 }}>
              <summary style={{ listStyle: "none", cursor: "pointer", padding: "10px 12px", fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--mt)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>What landed from your last sync</span>
                <span style={{ fontSize: 11, opacity: 0.5 }}>＋</span>
              </summary>
              <div style={{ padding: "8px 14px 14px", borderTop: "1px solid var(--ln)" }}>
                {(() => {
                  let map = {};
                  try { const raw = localStorage.getItem(OURA_HISTORY_KEY); if (raw) map = JSON.parse(raw); } catch { /* ignore */ }
                  const dayKeys = Object.keys(map).sort().reverse();
                  if (dayKeys.length === 0) {
                    return <div style={{ fontFamily: "var(--fm)", fontSize: 10.5, color: "var(--mt)", lineHeight: 1.6 }}>Nothing synced yet. Open the Oura connector above and tap to sync.</div>;
                  }
                  const latestKey = dayKeys[0];
                  const latest = map[latestKey] || {};
                  const has = (v) => v != null && v !== "" && (typeof v !== "object" || Object.keys(v).length > 0);
                  const lines = [
                    ["Latest day",        latestKey],
                    ["Sleep score",       has(latest.sleepScore) ? `${latest.sleepScore}/100` : "—"],
                    ["Total sleep",       has(latest.totalSleepMin) ? `${(latest.totalSleepMin / 60).toFixed(1)}h` : "—"],
                    ["Avg HRV",           has(latest.avgHRV) ? `${latest.avgHRV}ms` : "—"],
                    ["Readiness score",   has(latest.readinessScore) ? `${latest.readinessScore}/100` : "—"],
                    ["Resting HR",        has(latest.restingHR) ? `${latest.restingHR} bpm` : "—"],
                    ["SpO₂ avg",          has(latest.spo2Avg) ? `${latest.spo2Avg.toFixed?.(1) ?? latest.spo2Avg}%` : "—"],
                    ["Stress (high sec)", has(latest.stressHighSec) ? `${latest.stressHighSec}` : "—"],
                    ["Resilience",        has(latest.resilienceLevel) ? latest.resilienceLevel : "—"],
                  ];
                  // The two new metrics — what this disclosure is really for.
                  const bedtime = formatOptimalBedtime(latest.optimalBedtime);
                  const newLines = [
                    ["Optimal bedtime",   bedtime ? bedtime : "—  (Oura didn't publish one for this day)"],
                    ["Bedtime status",    has(latest.bedtimeStatus) ? latest.bedtimeStatus : "—"],
                    ["Rest mode (today)", latest.restMode ? "yes" : "no"],
                  ];
                  const restCount = restDaysInWindow(map, 7).length;
                  return (
                    <div style={{ fontFamily: "var(--fm)", fontSize: 10.5, color: "var(--fg)", lineHeight: 1.7 }}>
                      <div style={{ marginBottom: 8 }}>
                        {lines.map(([k, v]) => (
                          <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                            <span style={{ color: "var(--mt)", letterSpacing: 0.5 }}>{k}</span>
                            <span>{v}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--ln)" }}>
                        <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--ac)", marginBottom: 6 }}>New metrics</div>
                        {newLines.map(([k, v]) => (
                          <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                            <span style={{ color: "var(--mt)", letterSpacing: 0.5 }}>{k}</span>
                            <span>{v}</span>
                          </div>
                        ))}
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 4 }}>
                          <span style={{ color: "var(--mt)", letterSpacing: 0.5 }}>Rest days · last 7</span>
                          <span>{restCount}</span>
                        </div>
                      </div>
                      <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--ln)", fontSize: 9.5, color: "var(--mt)", lineHeight: 1.55, fontStyle: "italic" }}>
                        If the new metrics show "—", your Oura plan probably doesn't expose those endpoints, or you haven't synced since the new endpoints were added. Re-sync above to retry.
                      </div>
                    </div>
                  );
                })()}
              </div>
            </details>
          </div>
        );
      })()}
      {pvtOpen && (
        <PvtModal
          onClose={() => setPvtOpen(false)}
          onSave={(stats) => {
            const ts = new Date().toISOString();
            const map = (() => { try { return JSON.parse(localStorage.getItem(OURA_HISTORY_KEY) || "{}"); } catch { return {}; } })();
            const msw = minutesSinceLastWake(map);
            const stamped = { ...stats, timestamp: ts, minutesSinceWake: msw };
            const prev = checkin.pvtb || { sessions: [] };
            const sessions = (prev.sessions || []).concat([stamped]).slice(-20);
            persistCheckin({ ...checkin, pvtb: { latest: stamped, sessions } });
            setPvtOpen(false);
          }}
        />
      )}
    </div>
  );
}

