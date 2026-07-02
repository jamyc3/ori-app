import { Component, useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as mammoth from "mammoth/mammoth.browser";
import JSZip from "jszip";
import { hydrateStorage } from "./storage.js";
import { ANALYSIS_VERSION } from "./flags.js";
import { analyzeBackfillDay } from "./backfillDay.js";
import {
  KB,
  CHRONOTYPES,
  HEALTH_INDEX,
  SELF_RATE_ANCHORS,
  selfRateAnchor,
  CRISIS_PATTERNS,
  LIWC,
  BECK_DISTORTIONS,
  YOUNG_SCHEMAS,
  SAMPLE_REPO_ENTRIES,
  ANTHROPIC_MODEL,
  ANALYSIS_TOOL,
  ANALYSIS_SYSTEM_PROMPT,
  dayKey,
  groupCheckinsByDay,
  uniqueDayCount,
} from "./knowledge-base.js";
import { useVoice, reflectSttLanguage, REFLECT_LANG_KEY } from "./integrations/deepgram.js";
import * as AppleHealth from "./integrations/apple-health.js";
import WelcomeGarden from "./WelcomeGarden.jsx";
import { KssEditor, Pss4Survey, PvtModal, ManualDayEditor } from "./components/Surveys.jsx";
import { ReflectTransparencyBanner, SleepReviewBanner } from "./components/Banners.jsx";
import { JournalErrorBoundary, JournalRepo } from "./Journal.jsx";
import { Pill } from "./components/Pill.jsx";
import { BiometricsPanel } from "./BiometricsPanel.jsx";
import LetterReading, { PARTS_LIB, CrisisFootStrip } from "./LetterReading.jsx";
import GardenKeeper from "./GardenKeeper.jsx";
import { loadConfirmations, saveConfirmation } from "./confirmations.js";
import Settings from "./Settings.jsx";
import TodaysReadingCard from "./TodaysReadingCard.jsx";
import WeeklyReadingCard from "./WeeklyReadingCard.jsx";
import Patterns from "./Patterns.jsx";
import CognitiveProfile from "./CognitiveProfile.jsx";
import { ymdISO, daysBetween, stampMatchesDay, journalEntryCoversDay } from "./dates.js";
import { isoWeekKey } from "./cardStates.js";
import { SLEEP_WINDOW_KEY } from "./sleep-window.js";
import {
  BASELINE_MIN_DAYS, BIOMETRICS_KEY, CHECKIN_KEY, CHRONO_KEY, CLINICAL_KEY,
  COACH_CACHE_KEY, FETCH_TIMEOUT_MS, INSIGHTS_KEY, JOURNAL_REPO_KEY, LIFESTYLE_KEY,
  GARDEN_NAME_KEY, LORE_KEY, MODE_KEY, OURA_ACCESS_KEY, OURA_REFRESH_KEY, OURA_EXPIRES_KEY, OURA_BASE, OURA_CLIENT_KEY, OURA_ENDPOINTS, REFLECT_TIME_KEY, WELCOME_DONE_KEY,
  OURA_HISTORY_KEY, OURA_HWM_KEY, OURA_HWM_OVERLAP_DAYS, OURA_LAST_SYNC_KEY,
  OURA_SYNC_DAYS, OURA_UNAVAILABLE_KEY, OURA_UNAVAILABLE_TTL_MS, REPO_MAX_AUDIO_BYTES,
  REPO_MAX_DOC_BYTES, REPO_MAX_ENTRIES, REPO_MAX_IMAGE_BYTES, REPO_MAX_TEXT_CHARS,
  RETRYABLE_STATUSES, analyzeWithClaude, biometricsFromDayEntry,
  formatOptimalBedtime, restDaysInWindow,
  buildHistoryContext, chunkDateRange, computeBaselineStatus, computeBiometricTrends,
  computeDailyRings, computeDerivedAppleScores, computeE0, computeHCPI,
  computeSRI, countDistinct, countMatches, detectCrisis,
  detectFileKind, e0Label, fetchOuraData, fetchOuraRange, fetchPaginated, fileToBase64,
  formatAwake, formatBodyContext, generateClinicalSignals,
  generateCoachLine,
  generateLore,
  getLastEntryAge, getNudgeMessage, getTimeContext, getTodayEntries, getUltradianPhase,
  getUnavailableOuraEndpoints, hkParseAttrs,
  isOuraEndpointUnavailable, isSuspectSleep, loadCheckin, loadClinical, loadCoachCache,
  loadLore, loadRepo, loreSignature, markOuraEndpointUnavailable,
  median, mergeAppleHealthIntoHistory, mergeClinicalFindings,
  mergeOuraEndpointEntries, mergeOuraHistory, minutesSinceLastWake, normalizeText,
  ouraSyncWindow, parseAppleHealthZip, pickLatestMeaningfulDay, probeOuraToken,
  ahSyncWindow, recordAhHwm,
  pss4Score, readDocxFile, readPdfFile, readTextFile, recordOuraHwm, repoAdd,
  getOrCreateAnonId, getUserAge, buildEntrySnapshot,
  repoRemove, repoUpdate, ringSignature, runAppleHealthIntelligence,
  runClaudeClinicalPass, runGpt5ClinicalPass, saveCheckin, saveClinical,
  extractSeeds, loadSeeds, MIND_SEEDS_KEY, manualSleepToScore, needsSleepReview, normalizeSleepEntry, pendingSeedEntries, saveCoachCache, saveInsights, saveLore, saveRepo, saveSeeds, sleepMinFor, sleepSourceFor, summarizeSeeds,
  runReliabilityProbe, shouldRunReliabilityProbe,
  timeAgo,
  upsertManualDay,
} from "./engine.js";
import { maybeFireReminder } from "./who5-reminder.js";
import {
  BATCH_FREE_LIMIT, BATCH_CONCURRENCY,
  findUnanalyzedDays, composeSeedsForDay, backfillEntryTimestamp, selectFreeWindow,
} from "./batch-analyze.js";
// Stage 2A — all Analyze-tab-only components, helpers, and constants
// live in Analyze.jsx now. Importing the surface keeps the analyze
// JSX views in CPI.jsx working unchanged. Stage 2B will move the
// views themselves out of CPI.jsx.
import {
  WAKE_OVERRIDE_PREFIX, WAKE_LAST_KEY,
  todayKey, loadWakeOverride, saveWakeOverride,
  loadLastWake, saveLastWake, getAutoWakeTime, getAutoWakeSource,
  pickQuietReflection, pickQuietGlyph,
  explainHCPI, summarizeHCPI,
  MicButton, SystemCriticalAlert, UltradianCard, ChronotypeCard,
  SleepPipelineTrace, LetterEmptyState, LlmActivity, LlmFloatingPill,
  SignalCard, Sparkline, PillarDetail, SkyArc, GardenPlant, GardenPot,
  TodayGlance,
  // v5 simplified Analyze (2026-05-11 redesign) — gated by `cpi:analyze-v5` flag
  GreetingHeaderV5, BodyContextLineV5, ReadingCardV5,
  ReservesTileV5, MiniPotsRowV5, ReadingBlockV5, LetterActionsV5,
  FriendlyApiErrorV5,
} from "./Analyze.jsx";

// Feature flag: when true, Analyze tab renders the v5 journaling-first
// layout. When false, the legacy dashboard renders. Read once at module
// load; flip via `localStorage.setItem("cpi:analyze-v5", "0")` + refresh.
const ANALYZE_V5 = (() => {
  try {
    const v = localStorage.getItem("cpi:analyze-v5");
    return v === null ? true : v !== "0";
  } catch { return true; }
})();


/* ═══════════════════════════════════════════
   UI COMPONENTS
   ═══════════════════════════════════════════ */

const SK = "cpi-v2-data";
const g = "#4F8A5F", y = "#C4902A", r = "#B0553A";





// ── Know your tools — plain-language glossary ────────────────────────
// One paragraph per metric. Written for anyone: no jargon, no hedges,
// no citations inline. The voice is "a thoughtful friend who knows the
// science" — same register as Apple Health's About screens. Each entry
// answers, in order: what is it, and why should I care.
const TOOL_ENTRIES = [
  {
    name: "Sleep",
    body: "Your total sleep time and how restful it was. More than any other single factor, sleep shapes how sharp, steady, and patient you'll be tomorrow — it's the closest thing to a controllable vital sign. The score leans most on duration and efficiency (what wrist sensors measure most reliably) and lightly on sleep stages — deep-sleep detection in particular is the least trustworthy part of any consumer wearable.",
  },
  {
    name: "Recovery",
    body: "How relaxed your nervous system is, read from your heart-rate variability (HRV). HRV quietly rises when you're rested and drops when stress, hard training, or illness is building up — often a day or two before you feel it. For the first week of use, the comparison-to-baseline is thin, so we show \"Calibrating\" instead of a possibly-misleading percentage.",
  },
  {
    name: "Readiness",
    body: "A single 0–100 answer to \"how ready am I today?\" We blend HRV, resting heart rate, last night's sleep, breathing, and body temperature — each compared to your own baseline, not a population average. We wait until we have at least 7 days of baseline before publishing a score: shorter than that, the number would be mostly noise. You'll see \"Calibrating · X/7\" during that window.",
  },
  {
    name: "Regularity",
    body: "How closely today's sleep timing matches the day before, over the last two weeks. Research from the last few years suggests a steady schedule predicts long-term health better than any single night's duration — a regular 6.5-hour sleeper often does better than an erratic 8-hour one.",
  },
  {
    name: "Alert · KSS",
    body: "How sleepy you feel right now, on a 9-point scale used in sleep research since 1990. It looks simple, but it's been validated against brain recordings of drowsiness — more honest than asking yourself \"do I feel tired?\" We note how many hours you've been awake when you tap — an 8am score and a 4pm score are different measurements, and the time-since-wake lets us compare them fairly.",
  },
  {
    name: "Stress · PSS-4",
    body: "Four brief questions about how overwhelmed you've been feeling. From a scale psychologists have used since 1988 — not about a single bad day, but whether stress is quietly piling up in a way you might not notice.",
  },
  {
    name: "Reaction · PVT-B",
    body: "A three-minute tap-when-you-see-yellow test. It's the gold standard for detecting sleep loss — tired brains slow down measurably on it, even when you'd swear you were perfectly sharp. Your reaction time is ~30 ms faster at midday than right after waking, so we store time-since-wake with each score — it keeps future trend charts from confusing your normal daily rhythm with a real change.",
  },
  {
    name: "Rhythm",
    body: "Your natural body-clock tendency — whether you tend to peak earlier or later in the day. Scheduling demanding work around your peak, rather than against it, tends to beat every productivity hack.",
  },
];

function ToolsGlossary() {
  return (
    <div style={{ fontFamily: "var(--fm)" }}>
      <div style={{ fontSize: 11, color: "var(--mt)", fontStyle: "italic", lineHeight: 1.6, marginBottom: 18 }}>
        Nothing here is medical advice — use the numbers as a mirror, not a verdict.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {TOOL_ENTRIES.map((entry, i) => (
          <div key={entry.name}>
            <div style={{ fontSize: 9, color: "var(--ac)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6, fontWeight: 600 }}>{entry.name}</div>
            <div style={{ fontSize: 12, color: "var(--fg)", lineHeight: 1.7 }}>{entry.body}</div>
            {i < TOOL_ENTRIES.length - 1 && <div style={{ height: 1, background: "var(--ln)", opacity: 0.4, marginTop: 16 }} />}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--ln)", fontSize: 10, color: "var(--mt)", lineHeight: 1.6, opacity: 0.85 }}>
        Your data stays on your device. Scores, entries, and test results are kept in your browser — not on a server.
      </div>
    </div>
  );
}






// ─── Sleep pipeline trace ────────────────────────────────────────────
// Transparency tool, not a UX polish. Dumps the raw state of every
// stage the sleep data passes through, so the user can VERIFY whether
// their entries are being read and what they actually contribute to
// the HCPI score. Built because the tier card was attributing
// "sleep loss" to scores that had nothing to do with sleep.

/* ─────────────────────────────────────────────────────────────────
   LetterEmptyState — quiet greeting at the top of the writing surface.

   Three states based on history:
     1. firstTime  — no history at all. One-time welcome.
     2. noToday    — history exists, nothing today. Greeting + last-visit echo.
     3. followUp   — already wrote today. Soft "still here" prompt.

   The "last visit echo" pulls letterParts from the most recent prior entry
   so returning users see the parts that visited last time — provides a sense
   of continuity without re-rendering the full letter.

   Designed to live above the existing input form. Shipped as the home/empty
   surface for now; once Phase 4 collapses tabs, this becomes the home page.
   ────────────────────────────────────────────────────────────────── */


// Date helpers live in ./dates.js — imported above.

/* ─────────────────────────────────────────────────────────────────
   LetterEmptyState — quiet greeting at the top of the writing surface.

   Five states, derived from history (check-ins) AND journal entries:
     · firstTime           — no history AND no journal entries
     · followUp_both       — check-in today AND journal seed today
     · followUp_checkin    — check-in today, no journal seed today
     · followUp_journal    — journal seed today, no check-in today
     · noToday             — neither today; echo the last analysis

   The journal-aware logic was added 2026-04-27 to fix a bug where a user
   who wrote in the journal today (but did NOT use Read My Mind) was shown
   yesterday's analysis as "yesterday in your garden" — confusing because
   they HAD written today, just not in the form that triggers analysis.
   ────────────────────────────────────────────────────────────────── */



// QUIET_REFLECTIONS — short lines shown during the analysis pause. One per
// load, rotates every 8s on slow analyses. Sources noted in trailing comments
// for research integrity; attributions are NOT shown to the user — the line
// stands on its own.
//
// Mix of:
//   · neuroscience facts (Lieberman, Sapolsky, Pennebaker, Porges, Danziger)
//   · psychology giants (Jung, Rogers, Frankl, IFS / Schwartz)
//   · poets and writers (Mary Oliver, Dickinson, Weil, Dinesen)
//   · contemplative wisdom (Hillman, Pema, Buddha)
//   · garden / season-aware lines
// Each ≤ ~18 words. No "you should." Observational, not prescriptive.





// Inspect the HCPI components + the text-derived analysis to identify which
// factor actually pulled the score down. Prevents the tier-table's hardcoded
// summaries from attributing causes the data doesn't support (e.g. claiming
// "24+ hours without sleep" when sleep is fine and the text drove the drop).

// Build a data-driven summary sentence. Falls back to a generic severity
// statement if nothing specific stands out, instead of the tier table's
// hardcoded causal claim.



/* ═══════════════════════════════════════════
   TODAY GLANCE — Body / Mind / Mood rings (Tier 1)
   ═══════════════════════════════════════════ */




// Build 7-day pillar sparkline from history map + past check-ins.

// Mini sparkline (pure SVG, no libs).



// ── Sky arc — thin dotted arc from dawn to dusk with a warm sun marker
//    at the current hour. Visual device for the morning greeting card.
//    Clamps to [05:00, 21:00] so the marker always lives on the arc.

// ── Garden plant SVG. Leaves/blades scale with health (0–1); when value
//    is null the plant is drawn dim with a small "needs you" tag. Each
//    pillar has a distinct silhouette so they read apart at a glance:
//    body = stemmed leaves, mind = narrow blades, mood = bloom of circles.



/* ═══════════════════════════════════════════
   LORE CARD — What Ori has noticed about you (Profile)
   ═══════════════════════════════════════════ */

function LoreCard({ history, biometrics, lifestyle, palette }) {
  const P = palette;
  const [lore, setLore] = useState(() => loadLore());
  const [loading, setLoading] = useState(false);
  const [refining, setRefining] = useState(null); // index being refined
  const [refineText, setRefineText] = useState("");
  const [error, setError] = useState(null);

  // Same reason as TodayGlance — when wearable data is wiped, our
  // cached bullets need to be dropped from React state, not just
  // from localStorage. Otherwise the clear appears to do nothing.
  useEffect(() => {
    const onCleared = () => setLore(loadLore());
    window.addEventListener("cpi:wearable-synced", onCleared);
    return () => window.removeEventListener("cpi:wearable-synced", onCleared);
  }, []);

  const trends = (() => {
    try {
      const raw = localStorage.getItem(OURA_HISTORY_KEY);
      if (!raw) return null;
      const map = JSON.parse(raw);
      return computeBiometricTrends(map, new Date().toISOString().split("T")[0]);
    } catch { return null; }
  })();
  const checkin = loadCheckin();

  const sig = loreSignature(history, trends, checkin);
  const needsGen = !lore.bullets.length || lore.signature !== sig;

  const regenerate = async () => {
    setLoading(true); setError(null);
    try {
      const bullets = await generateLore(history, biometrics, lifestyle, trends, checkin, lore.corrections || [], { mode: (typeof localStorage !== "undefined" && localStorage.getItem(MODE_KEY)) || "full" });
      if (!bullets) { setError("Couldn't generate — check API key or try again."); return; }
      const next = { bullets, signature: sig, generatedAt: Date.now(), corrections: lore.corrections || [] };
      setLore(next); saveLore(next);
    } catch (e) {
      setError(e.message || "Generation failed");
    } finally { setLoading(false); }
  };

  const removeBullet = (idx) => {
    const removed = lore.bullets[idx];
    const nextBullets = lore.bullets.filter((_, i) => i !== idx);
    const nextCorr = [...(lore.corrections || []), `dismissed: ${removed}`];
    const next = { ...lore, bullets: nextBullets, corrections: nextCorr };
    setLore(next); saveLore(next);
  };
  const confirmBullet = (idx) => {
    const confirmed = lore.bullets[idx];
    const nextCorr = [...(lore.corrections || []), `confirmed: ${confirmed}`];
    const next = { ...lore, corrections: nextCorr };
    setLore(next); saveLore(next);
  };
  const submitRefine = (idx) => {
    if (!refineText.trim()) { setRefining(null); return; }
    const original = lore.bullets[idx];
    const nextBullets = [...lore.bullets]; nextBullets[idx] = refineText.trim();
    const nextCorr = [...(lore.corrections || []), `refined from "${original}" to "${refineText.trim()}"`];
    const next = { ...lore, bullets: nextBullets, corrections: nextCorr };
    setLore(next); saveLore(next);
    setRefineText(""); setRefining(null);
  };

  const reset = () => {
    if (!window.confirm("Reset Ori's observations? This clears the bullets and your feedback so the next generation starts fresh. Your journals and wearable data stay.")) return;
    const next = { bullets: [], signature: null, generatedAt: null, corrections: [] };
    setLore(next); saveLore(next);
  };

  const cardStyle = {
    background: P?.cd || "var(--cd)",
    border: `1px solid ${P?.ln || "var(--ln)"}`,
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  };

  return (
    <div className="ca" style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: 2.5, textTransform: "uppercase", color: P?.ac || "var(--ac)", fontFamily: "var(--fm)", marginBottom: 4 }}>What Ori has noticed</div>
          <div style={{ fontSize: 11, color: P?.mt || "var(--mt)", fontFamily: "var(--fm)" }}>
            {lore.generatedAt ? `Updated ${timeAgo(new Date(lore.generatedAt).toISOString())}` : "Not generated yet"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(lore.bullets.length > 0 || (lore.corrections || []).length > 0) && (
            <button
              type="button"
              onClick={reset}
              disabled={loading}
              title="Clear observations and corrections"
              style={{ background: "none", border: `1px solid ${P?.ln || "var(--ln)"}`, padding: "6px 10px", borderRadius: 6, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: r, fontFamily: "var(--fm)", cursor: loading ? "wait" : "pointer" }}
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={regenerate}
            disabled={loading}
            style={{ background: "none", border: `1px solid ${P?.ln || "var(--ln)"}`, padding: "6px 12px", borderRadius: 6, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: P?.fg || "var(--fg)", fontFamily: "var(--fm)", cursor: loading ? "wait" : "pointer" }}
          >
            {loading ? "Reading…" : needsGen ? "Generate" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <div style={{ fontSize: 11, color: r, marginBottom: 10 }}>{error}</div>}

      {lore.bullets.length === 0 && !loading && (() => {
        const hasJournals = (history?.length || 0) >= 3;
        const hasWearable = trends && (trends.today?.sleepScore != null || trends.today?.avgHRV != null || trends.today?.restingHR != null || trends.today?.totalSleepMin != null);
        const canGen = hasJournals || hasWearable;
        return (
          <div style={{ fontSize: 12, color: P?.mt || "var(--mt)", lineHeight: 1.7, padding: "8px 0" }}>
            {canGen
              ? "Tap Generate to see the patterns Ori has noticed. You can refine or remove any observation — your corrections shape future readings."
              : "Import Apple Health, sync Oura, or log 3+ journal entries — Ori needs data to read your patterns."}
          </div>
        );
      })()}

      {lore.bullets.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {lore.bullets.map((b, i) => (
            <div key={i} style={{ paddingBottom: 12, borderBottom: i < lore.bullets.length - 1 ? `1px solid ${P?.ln || "var(--ln)"}` : "none" }}>
              {refining === i ? (
                <div>
                  <textarea
                    value={refineText}
                    onChange={(e) => setRefineText(e.target.value)}
                    placeholder="Rewrite this observation in your words…"
                    rows={2}
                    style={{ width: "100%", fontSize: 13, lineHeight: 1.6, padding: "8px 10px", background: "transparent", border: `1px solid ${P?.ac || "var(--ac)"}`, borderRadius: 6, color: P?.fg || "var(--fg)", fontFamily: "var(--fb)", resize: "vertical" }}
                    autoFocus
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 14, marginTop: 6 }}>
                    <button onClick={() => { setRefining(null); setRefineText(""); }} style={{ background: "none", border: "none", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: P?.mt || "var(--mt)", fontFamily: "var(--fm)", cursor: "pointer" }}>Cancel</button>
                    <button onClick={() => submitRefine(i)} style={{ background: "none", border: "none", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: P?.ac || "var(--ac)", fontFamily: "var(--fm)", fontWeight: 500, cursor: "pointer" }}>Save</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 13, lineHeight: 1.65, color: P?.fg || "var(--fg)", fontFamily: "var(--fb)", marginBottom: 8 }}>{b}</div>
                  <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
                    <button onClick={() => confirmBullet(i)} style={{ background: "none", border: "none", fontSize: 9.5, letterSpacing: 1.5, textTransform: "uppercase", color: P?.mt || "var(--mt)", fontFamily: "var(--fm)", padding: 0, cursor: "pointer" }}>Sounds right</button>
                    <button onClick={() => { setRefining(i); setRefineText(b); }} style={{ background: "none", border: "none", fontSize: 9.5, letterSpacing: 1.5, textTransform: "uppercase", color: P?.mt || "var(--mt)", fontFamily: "var(--fm)", padding: 0, cursor: "pointer" }}>Refine</button>
                    <button onClick={() => removeBullet(i)} style={{ background: "none", border: "none", fontSize: 9.5, letterSpacing: 1.5, textTransform: "uppercase", color: P?.mt || "var(--mt)", fontFamily: "var(--fm)", padding: 0, cursor: "pointer" }}>Not me</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   JOURNAL REPOSITORY — Garden Plot layout
   Data shape:
     { id, source: "text"|"image"|"pdf"|"docx"|"audio",
       date: "YYYY-MM-DD"|null,
       dateEnd: "YYYY-MM-DD"|null,     // optional; span end
       dateText, transcription, confidence, notes, uploadedAt, ... }
   ═══════════════════════════════════════════ */

// Garden palette — bg/ink/muted align with Ori's --bg/--fg/--mt tokens so
// the tab still feels like the rest of the app; accents stay garden-native.

/* ═══════════════════════════════════════════
   OBSERVATORY — You tab visual layout (from claude.ai/design handoff)
   ═══════════════════════════════════════════ */

const OBS = { paper: "#FBF7EE", faint: "#B8B1A5", hair: "rgba(45,42,36,0.06)" };
const axisTone = (v) => v >= 0.7 ? g : v >= 0.45 ? "var(--ac)" : y;








/* ═══════════════════════════════════════════
   EFFICIENCY GRADE — composite physical + mental + engagement (0–10)
   ═══════════════════════════════════════════ */

// Compute an efficiency grade from all available signals. Grounded in
// Maslach burnout research (exhaustion + disengagement) plus Ryff
// engagement markers. Returns { grade, band, tip, contributors }.


function ColorLegend({ palette }) {
  const P = palette;
  const items = [
    { color: g, label: "Healthy" },
    { color: P?.ac || "var(--ac)", label: "Neutral" },
    { color: y, label: "Watch" },
    { color: r, label: "Concerning" },
  ];
  return (
    <div style={{ padding: "10px 14px", background: P?.bg || "var(--bg)", border: `1px solid ${P?.ln || "var(--ln)"}`, borderRadius: 8, marginBottom: 14, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", fontFamily: "var(--fm)" }}>
      <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: P?.mt || "var(--mt)" }}>Key before you read</div>
      {items.map(it => (
        <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: it.color, display: "inline-block" }} />
          <span style={{ color: P?.fg || "var(--fg)", fontSize: 10.5, letterSpacing: 0.5 }}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}


/* ═══════════════════════════════════════════
   CLINICAL SIGNALS — opt-in dual-model screening
   ═══════════════════════════════════════════ */

function CrisisResourceCard({ hits, palette }) {
  const P = palette;
  return (
    <div style={{ padding: 22, background: "#2a1816", border: `2px solid ${r}`, borderRadius: 12, marginTop: 16 }}>
      <div style={{ fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: r, fontFamily: "var(--fm)", fontWeight: 700, marginBottom: 12 }}>Before anything else</div>
      <div style={{ fontSize: 15, color: "#f2e8e6", fontFamily: "var(--fb)", lineHeight: 1.7, marginBottom: 18 }}>
        A few of your entries contain language about self-harm, ending your life, or feeling unreal.
        If any of that is present for you right now, please reach out to someone trained to help.
        This app is a reflection tool — it is not enough.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
        <a href="tel:988" style={{ padding: "14px 16px", background: "rgba(255,255,255,0.06)", border: `1px solid rgba(255,255,255,0.1)`, borderRadius: 8, textDecoration: "none", color: "#f2e8e6" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>Call or text 988</div>
          <div style={{ fontSize: 11, color: "#c9bcb9", fontFamily: "var(--fm)" }}>988 Suicide & Crisis Lifeline · US · 24/7</div>
        </a>
        <a href="sms:741741&body=HOME" style={{ padding: "14px 16px", background: "rgba(255,255,255,0.06)", border: `1px solid rgba(255,255,255,0.1)`, borderRadius: 8, textDecoration: "none", color: "#f2e8e6" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>Text HOME to 741741</div>
          <div style={{ fontSize: 11, color: "#c9bcb9", fontFamily: "var(--fm)" }}>Crisis Text Line · US · free · 24/7</div>
        </a>
        <a href="https://findahelpline.com" target="_blank" rel="noreferrer" style={{ padding: "14px 16px", background: "rgba(255,255,255,0.06)", border: `1px solid rgba(255,255,255,0.1)`, borderRadius: 8, textDecoration: "none", color: "#f2e8e6" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>findahelpline.com</div>
          <div style={{ fontSize: 11, color: "#c9bcb9", fontFamily: "var(--fm)" }}>Local crisis lines anywhere in the world</div>
        </a>
      </div>

      <details style={{ fontSize: 11, color: "#c9bcb9", fontFamily: "var(--fm)", marginTop: 14 }}>
        <summary style={{ cursor: "pointer", padding: "4px 0", letterSpacing: 1.5, textTransform: "uppercase" }}>What was detected ({hits.length})</summary>
        <div style={{ marginTop: 10, fontFamily: "var(--fb)", lineHeight: 1.7 }}>
          {hits.map((h, i) => (
            <div key={i} style={{ marginBottom: 8, paddingLeft: 10, borderLeft: `2px solid ${r}` }}>
              <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: r, fontFamily: "var(--fm)", marginBottom: 3 }}>
                {h.category.replace(/_/g, " ")} · {h.date}
              </div>
              <div style={{ fontStyle: "italic", fontSize: 12 }}>…{h.quote}…</div>
            </div>
          ))}
        </div>
      </details>

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 10, color: "#9a8c89", fontFamily: "var(--fm)", lineHeight: 1.7 }}>
        Clinical screening scores have been suppressed. Scoring someone who may be in acute distress is the wrong thing for this tool to do.
      </div>
    </div>
  );
}

function ClinicalSignals({ palette }) {
  const [repo, setRepo] = useState(() => loadRepo());
  const [cached, setCached] = useState(() => loadClinical());
  const [consent, setConsent] = useState(() => !!loadClinical());
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const P = palette;

  useEffect(() => {
    const t = setInterval(() => {
      const cur = loadRepo();
      if (cur.entries.length !== repo.entries.length) setRepo(cur);
    }, 2000);
    return () => clearInterval(t);
  }, [repo.entries.length]);

  const usable = (repo.entries || []).filter(e => (e.rawText || e.transcription || "").length > 30);
  const enough = usable.length >= 5;

  const run = async () => {
    if (!enough) { setError("Needs at least 5 substantive entries."); return; }
    setLoading(true); setError(null); setProgress("Starting screening…");
    try {
      const result = await generateClinicalSignals(repo.entries, setProgress);
      setCached(result); saveClinical(result);
      setExpanded(true);
    } catch (e) {
      setError(e.message || "Screening failed");
    } finally {
      setLoading(false); setProgress(null);
    }
  };

  const clear = () => {
    if (!window.confirm("Remove clinical screening results?")) return;
    localStorage.removeItem(CLINICAL_KEY);
    setCached(null);
  };

  const cardShell = {
    background: P?.cd || "var(--cd)",
    border: `1px solid ${P?.ln || "var(--ln)"}`,
    borderLeft: `3px solid ${y}`,
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  };

  if (!consent && !cached) {
    return (
      <div className="ca" style={cardShell}>
        <div style={{ fontSize: 9, letterSpacing: 2.5, textTransform: "uppercase", color: y, fontFamily: "var(--fm)", fontWeight: 600, marginBottom: 8 }}>Clinical signals — opt-in</div>
        <div style={{ fontSize: 13, color: P?.fg || "var(--fg)", lineHeight: 1.7, marginBottom: 14, fontFamily: "var(--fb)" }}>
          This pass screens your journals for research-backed patterns linked to mental-health risk:
          rumination (Nolen-Hoeksema), 10 cognitive distortions (Beck), 18 early maladaptive schemas (Young),
          adult attachment style, and linguistic proxies for PHQ-9 & GAD-7.
        </div>
        <div style={{ fontSize: 12, color: P?.mt || "var(--mt)", lineHeight: 1.7, marginBottom: 14, padding: "12px 14px", background: P?.bg || "var(--bg)", borderRadius: 8, borderLeft: `2px solid ${y}` }}>
          <strong style={{ color: P?.fg || "var(--fg)" }}>Important:</strong> this is NOT a diagnosis or clinical assessment. It's a research lens over your own writing.
          If any pattern feels true, that's information to bring to a licensed mental-health professional — not a conclusion to act on from this app.
          Your entries first get scanned locally for crisis language; if found, scores are suppressed and you see referral resources instead.
        </div>
        <div style={{ fontSize: 11, color: P?.mt || "var(--mt)", lineHeight: 1.7, marginBottom: 14, fontFamily: "var(--fm)" }}>
          Analysis stack: Claude Sonnet 4.6 + GPT-5 in parallel. Findings shown only when both models agree. Disagreement → muted warning, not a number.
        </div>
        <button
          type="button"
          onClick={() => setConsent(true)}
          style={{ padding: "10px 16px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", fontFamily: "var(--fm)", background: "transparent", color: P?.fg || "var(--fg)", border: `1px solid ${y}`, borderRadius: 8, cursor: "pointer", minHeight: 44 }}
        >
          I understand — proceed
        </button>
      </div>
    );
  }

  // Crisis branch — show resources only
  if (cached?.crisisDetected) {
    return (
      <div className="ca" style={cardShell}>
        <div style={{ fontSize: 9, letterSpacing: 2.5, textTransform: "uppercase", color: y, fontFamily: "var(--fm)", fontWeight: 600, marginBottom: 4 }}>Clinical signals</div>
        <CrisisResourceCard hits={cached.crisisHits} palette={palette} />
        <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
          <button onClick={run} disabled={loading} style={{ padding: "8px 14px", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "var(--fm)", background: "transparent", color: P?.mt || "var(--mt)", border: `1px solid ${P?.ln || "var(--ln)"}`, borderRadius: 6, cursor: "pointer" }}>Re-run screening</button>
          <button onClick={clear} style={{ padding: "8px 14px", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "var(--fm)", background: "transparent", color: P?.mt || "var(--mt)", border: `1px solid ${P?.ln || "var(--ln)"}`, borderRadius: 6, cursor: "pointer" }}>Clear result</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ca" style={cardShell}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: 2.5, textTransform: "uppercase", color: y, fontFamily: "var(--fm)", fontWeight: 600, marginBottom: 4 }}>Clinical signals</div>
          <div style={{ fontSize: 11, color: P?.mt || "var(--mt)", fontFamily: "var(--fm)", lineHeight: 1.5 }}>
            Dual-model screening · {usable.length} substantive {usable.length === 1 ? "entry" : "entries"} · not diagnostic
            {cached?.generatedAt && ` · ${timeAgo(new Date(cached.generatedAt).toISOString())}`}
          </div>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={loading || !enough}
          style={{ padding: "8px 14px", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "var(--fm)", background: !cached && !loading ? y : "transparent", color: !cached && !loading ? "#fff" : (P?.fg || "var(--fg)"), border: `1px solid ${y}`, borderRadius: 6, cursor: loading ? "wait" : !enough ? "not-allowed" : "pointer", opacity: enough ? 1 : 0.4 }}
        >
          {loading ? "Screening…" : cached ? "Re-screen" : "Run screening"}
        </button>
      </div>

      {loading && progress && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: P?.bg || "var(--bg)", border: `1px solid ${P?.ln || "var(--ln)"}`, borderRadius: 8, marginBottom: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: y, animation: "cbr 1.2s ease-in-out infinite" }} />
          <div style={{ fontSize: 11, color: P?.fg || "var(--fg)", fontFamily: "var(--fm)" }}>{progress}</div>
        </div>
      )}

      {error && <div style={{ fontSize: 11, color: r, marginBottom: 10, padding: "8px 10px", background: "rgba(201,120,86,0.1)", borderRadius: 6 }}>{error}</div>}

      {!cached && !loading && (
        <div style={{ fontSize: 12, color: P?.mt || "var(--mt)", lineHeight: 1.7, padding: "10px 0" }}>
          Tap <strong style={{ color: P?.fg || "var(--fg)" }}>Run screening</strong> to scan your repo with Claude + GPT-5. Takes ~30 seconds.
          {!enough && <div style={{ marginTop: 8, fontSize: 11 }}>Need at least 5 substantive entries first.</div>}
        </div>
      )}

      {cached && !cached.crisisDetected && (() => {
        const dm = cached.mode === "dual-model";
        const ag = cached.agreement || {};
        const claudeOnly = cached.claude;
        const dist = dm ? ag.distortions : (claudeOnly.cognitive_distortions || []);
        const schemas = dm ? ag.schemas : (claudeOnly.schemas || []);
        const att = dm ? ag.attachment : { ...claudeOnly.attachment, agreed: null };
        const rum = dm ? ag.rumination : { claude: claudeOnly.rumination?.level ?? 0, gpt5: null, agreed: null, brooding: claudeOnly.rumination?.brooding_dominance };
        const mood = dm ? ag.mood_anxiety : null;

        return (
          <div style={{ paddingTop: 6 }}>
            {!dm && cached.gpt5Status?.status !== "done" && (
              <div style={{ fontSize: 11, color: y, padding: "8px 10px", background: "rgba(212,168,83,0.1)", borderRadius: 6, marginBottom: 14 }}>
                Single-model result only — GPT-5 cross-check {cached.gpt5Status?.status === "error" ? `errored (${cached.gpt5Status.error})` : cached.gpt5Status?.reason || "not configured"}. Treat findings as tentative.
              </div>
            )}

            {/* Rumination */}
            <div style={{ padding: "12px 14px", background: P?.bg || "var(--bg)", border: `1px solid ${P?.ln || "var(--ln)"}`, borderRadius: 8, marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: P?.fg || "var(--fg)", fontFamily: "var(--fd)" }}>Rumination</div>
                <div style={{ fontSize: 11, fontFamily: "var(--fm)", color: rum.agreed === false ? y : P?.fg }}>
                  {Math.round(rum.claude * 100)}
                  {rum.gpt5 != null && <span style={{ color: P?.mt, fontSize: 10, marginLeft: 6 }}>· GPT-5 {Math.round(rum.gpt5 * 100)}</span>}
                  {rum.agreed === false && <span style={{ marginLeft: 6, color: y }}>⚠</span>}
                </div>
              </div>
              <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: P?.mt || "var(--mt)", fontFamily: "var(--fm)", marginBottom: 6 }}>
                RRS (Nolen-Hoeksema) · brooding dominance {rum.brooding != null ? Math.round(rum.brooding * 100) + "%" : "—"}
              </div>
              <div style={{ fontSize: 11, color: P?.fg || "var(--fg)", lineHeight: 1.55 }}>{claudeOnly.rumination?.reading}</div>
              {claudeOnly.rumination?.evidence?.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 10.5, color: P?.mt || "var(--mt)", lineHeight: 1.55 }}>
                  {claudeOnly.rumination.evidence.map((e, i) => (
                    <div key={i} style={{ marginBottom: 4 }}><span style={{ fontFamily: "var(--fm)", color: P?.ac || "var(--ac)", marginRight: 6 }}>{e.date}</span><em>"{e.quote}"</em></div>
                  ))}
                </div>
              )}
            </div>

            {/* Cognitive distortions */}
            {dist.length > 0 && (
              <div style={{ padding: "12px 14px", background: P?.bg || "var(--bg)", border: `1px solid ${P?.ln || "var(--ln)"}`, borderRadius: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: P?.fg || "var(--fg)", fontFamily: "var(--fd)", marginBottom: 4 }}>Cognitive distortions detected</div>
                <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: P?.mt || "var(--mt)", fontFamily: "var(--fm)", marginBottom: 10 }}>Beck (1979) · Burns (1980)</div>
                {dist.sort((a, b) => (b.severity || 0) - (a.severity || 0)).map(d => {
                  const meta = BECK_DISTORTIONS.find(x => x.key === d.type);
                  if (!meta) return null;
                  return (
                    <div key={d.type} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: `1px dashed ${P?.ln || "var(--ln)"}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                        <div style={{ fontSize: 11.5, color: P?.fg || "var(--fg)" }}>{meta.label} <span style={{ color: P?.mt || "var(--mt)", fontSize: 10, fontFamily: "var(--fm)" }}>— {meta.short}</span></div>
                        <div style={{ fontSize: 10, fontFamily: "var(--fm)", color: P?.fg || "var(--fg)" }}>
                          {d.frequency} entries · {Math.round((d.severity || 0) * 100)}
                          {dm && !d.bothModels && <span title="GPT-5 did not flag this" style={{ marginLeft: 6, color: y }}>⚠</span>}
                          {dm && d.bothModels && <span title="Both models agree" style={{ marginLeft: 6, color: g }}>✓</span>}
                        </div>
                      </div>
                      {d.evidence?.length > 0 && (
                        <div style={{ fontSize: 10, color: P?.mt || "var(--mt)", marginTop: 6, lineHeight: 1.55 }}>
                          {d.evidence.map((ev, i) => (
                            <div key={i}><span style={{ fontFamily: "var(--fm)", color: P?.ac || "var(--ac)", marginRight: 6 }}>{ev.date}</span><em>"{ev.quote}"</em></div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Schemas */}
            {schemas.length > 0 && (
              <div style={{ padding: "12px 14px", background: P?.bg || "var(--bg)", border: `1px solid ${P?.ln || "var(--ln)"}`, borderRadius: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: P?.fg || "var(--fg)", fontFamily: "var(--fd)", marginBottom: 4 }}>Schema activations</div>
                <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: P?.mt || "var(--mt)", fontFamily: "var(--fm)", marginBottom: 10 }}>Young Schema Therapy — 18 Early Maladaptive Schemas</div>
                {schemas.sort((a, b) => (b.activation || 0) - (a.activation || 0)).map(s => {
                  const meta = YOUNG_SCHEMAS.find(x => x.key === s.schema);
                  if (!meta) return null;
                  return (
                    <div key={s.schema} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: `1px dashed ${P?.ln || "var(--ln)"}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                        <div style={{ fontSize: 11.5, color: P?.fg || "var(--fg)" }}>{meta.label} <span style={{ color: P?.mt || "var(--mt)", fontSize: 10, fontFamily: "var(--fm)" }}>— {meta.domain}</span></div>
                        <div style={{ fontSize: 10, fontFamily: "var(--fm)", color: P?.fg || "var(--fg)" }}>
                          {Math.round((s.activation || 0) * 100)}
                          {dm && !s.bothModels && <span title="GPT-5 did not flag this" style={{ marginLeft: 6, color: y }}>⚠</span>}
                          {dm && s.bothModels && <span title="Both models agree" style={{ marginLeft: 6, color: g }}>✓</span>}
                        </div>
                      </div>
                      {s.evidence?.length > 0 && (
                        <div style={{ fontSize: 10, color: P?.mt || "var(--mt)", marginTop: 6, lineHeight: 1.55 }}>
                          {s.evidence.map((ev, i) => (
                            <div key={i}><span style={{ fontFamily: "var(--fm)", color: P?.ac || "var(--ac)", marginRight: 6 }}>{ev.date}</span><em>"{ev.quote}"</em></div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Attachment */}
            {att?.claude && att.claude !== "insufficient_data" && (
              <div style={{ padding: "12px 14px", background: P?.bg || "var(--bg)", border: `1px solid ${P?.ln || "var(--ln)"}`, borderRadius: 8, marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: P?.fg || "var(--fg)", fontFamily: "var(--fd)" }}>
                    Attachment pattern — <span style={{ textTransform: "capitalize" }}>{att.claude}</span>
                    {dm && att.agreed === false && <span style={{ marginLeft: 8, fontSize: 10, color: y }}>⚠ GPT-5 reads {att.gpt5}</span>}
                    {dm && att.agreed && <span style={{ marginLeft: 8, fontSize: 10, color: g }}>✓ both models</span>}
                  </div>
                  <div style={{ fontSize: 10, fontFamily: "var(--fm)", color: P?.fg || "var(--fg)" }}>{Math.round((att.confidence || 0) * 100)}%</div>
                </div>
                <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: P?.mt || "var(--mt)", fontFamily: "var(--fm)", marginBottom: 8, marginTop: 4 }}>Bowlby · Main</div>
                {att.reading && <div style={{ fontSize: 11, color: P?.fg || "var(--fg)", lineHeight: 1.55, marginBottom: 6 }}>{att.reading}</div>}
                {att.evidence?.length > 0 && (
                  <div style={{ fontSize: 10, color: P?.mt || "var(--mt)", lineHeight: 1.55 }}>
                    {att.evidence.map((ev, i) => (
                      <div key={i} style={{ marginBottom: 3 }}><span style={{ fontFamily: "var(--fm)", color: P?.ac || "var(--ac)", marginRight: 6 }}>{ev.date}</span><em>"{ev.quote}"</em></div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* PHQ-9 / GAD-7 proxies */}
            {mood && (
              <div style={{ padding: "12px 14px", background: P?.bg || "var(--bg)", border: `1px solid ${P?.ln || "var(--ln)"}`, borderRadius: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: P?.fg || "var(--fg)", fontFamily: "var(--fd)", marginBottom: 4 }}>Mood & anxiety linguistic proxies</div>
                <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: P?.mt || "var(--mt)", fontFamily: "var(--fm)", marginBottom: 10 }}>NOT diagnostic · markers only · confirm with a clinician</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: P?.fg || "var(--fg)", marginBottom: 4 }}>PHQ-9 markers (depression)</div>
                    <div style={{ fontSize: 14, fontFamily: "var(--fm)", color: mood.phq9.agreed ? P?.fg : y }}>
                      {Math.round(mood.phq9.avg * 100)}
                      {!mood.phq9.agreed && <span style={{ fontSize: 9, marginLeft: 6, color: y }}>⚠ gap {Math.round(Math.abs(mood.phq9.claude - mood.phq9.gpt5) * 100)}</span>}
                    </div>
                    {mood.notes_phq9 && <div style={{ fontSize: 10, color: P?.mt || "var(--mt)", marginTop: 4, lineHeight: 1.5 }}>{mood.notes_phq9}</div>}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: P?.fg || "var(--fg)", marginBottom: 4 }}>GAD-7 markers (anxiety)</div>
                    <div style={{ fontSize: 14, fontFamily: "var(--fm)", color: mood.gad7.agreed ? P?.fg : y }}>
                      {Math.round(mood.gad7.avg * 100)}
                      {!mood.gad7.agreed && <span style={{ fontSize: 9, marginLeft: 6, color: y }}>⚠ gap {Math.round(Math.abs(mood.gad7.claude - mood.gad7.gpt5) * 100)}</span>}
                    </div>
                    {mood.notes_gad7 && <div style={{ fontSize: 10, color: P?.mt || "var(--mt)", marginTop: 4, lineHeight: 1.5 }}>{mood.notes_gad7}</div>}
                  </div>
                </div>
              </div>
            )}

            {/* Key findings */}
            {claudeOnly.key_findings?.length > 0 && (
              <div style={{ padding: "12px 14px", background: `rgba(212,168,83,0.08)`, border: `1px solid ${P?.ln || "var(--ln)"}`, borderLeft: `3px solid ${y}`, borderRadius: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: y, fontFamily: "var(--fm)", fontWeight: 600, marginBottom: 8 }}>Summary patterns</div>
                {claudeOnly.key_findings.map((f, i) => (
                  <div key={i} style={{ fontSize: 11.5, color: P?.fg || "var(--fg)", lineHeight: 1.55, marginBottom: 8 }}>
                    <span style={{ fontFamily: "var(--fm)", fontSize: 9, letterSpacing: 1.3, textTransform: "uppercase", color: P?.mt, marginRight: 6 }}>{f.category} · {Math.round(f.confidence * 100)}%</span><br />
                    {f.finding}
                  </div>
                ))}
              </div>
            )}

            <div style={{ fontSize: 9.5, color: P?.mt || "var(--mt)", fontFamily: "var(--fm)", lineHeight: 1.7, marginTop: 10, padding: "10px 12px", background: P?.bg || "var(--bg)", borderRadius: 6 }}>
              <strong style={{ color: P?.fg || "var(--fg)" }}>Stack:</strong> Claude Sonnet 4.6 + GPT-5 in parallel.
              ✓ = both models agree · ⚠ = one model dissents (treat as uncertain).<br />
              <strong style={{ color: P?.fg || "var(--fg)" }}>Framings:</strong> RRS (Nolen-Hoeksema) · Beck cognitive distortions · Young EMS · Bowlby/Main attachment · PHQ-9/GAD-7 linguistic proxies.<br /><br />
              <em>This is a reflection tool, not clinical assessment. If any pattern feels true, bring it to a licensed mental-health professional.</em>
              <div style={{ marginTop: 8 }}>
                <button onClick={clear} style={{ background: "none", border: "none", fontSize: 9, color: r, fontFamily: "var(--fm)", letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer", padding: 0 }}>Clear screening</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ═══════════════════════════════════════════
   INTEGRATIONS PANEL — connect wearables + import health data
   ═══════════════════════════════════════════ */

// Defined at module scope so React treats them as stable component types.
// If these lived inside IntegrationsPanel, every re-render would create a new
// function reference and React would unmount/remount their subtree — which
// kills any open file-picker dialogs (the <input> they return to no longer
// exists, so change events land on a detached DOM node).
// Collapsible Section. By default sections start collapsed to keep the
// Settings surface short — users see just the title + one-line status
// for each, and tap to expand the details. Pass `defaultOpen` to force
// a section open (e.g., the Mode picker). Pass `collapsible={false}` to
// disable the affordance entirely.
const IntegrationsSection = ({ children, title, subtitle, accent, defaultOpen = false, collapsible = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;
  return (
    <div style={{ background: "var(--sf)", border: "1px solid var(--ln)", borderLeft: `3px solid ${accent || "var(--ac)"}`, borderRadius: 12, padding: 20, marginBottom: 14 }}>
      <div
        role={collapsible ? "button" : undefined}
        tabIndex={collapsible ? 0 : undefined}
        onClick={collapsible ? () => setOpen((v) => !v) : undefined}
        onKeyDown={collapsible ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); } } : undefined}
        style={{ cursor: collapsible ? "pointer" : "default", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 9, letterSpacing: 2.5, textTransform: "uppercase", color: accent || "var(--ac)", fontFamily: "var(--fm)", fontWeight: 600, marginBottom: 4 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: "var(--mt)", fontFamily: "var(--fm)", marginBottom: isOpen ? 14 : 0 }}>{subtitle}</div>}
        </div>
        {collapsible && (
          <span style={{ fontSize: 10, color: "var(--mt)", fontFamily: "var(--fm)", opacity: 0.6, transition: "transform .2s", transform: isOpen ? "rotate(180deg)" : "none", marginTop: 2 }}>▼</span>
        )}
      </div>
      {isOpen && <div style={{ marginTop: collapsible ? 4 : 0 }}>{children}</div>}
    </div>
  );
};

const IntegrationsBtn = ({ onClick, children, primary = true, disabled = false, busy = false, tone = "accent" }) => {
  // tone: "accent" (default, brand green) or "danger" (destructive red).
  // Used for actions like "Clear Apple Health data" where the visual
  // weight should warn before confirmation is even reached.
  const border = tone === "danger" ? "#b0553a" : "var(--ac)";
  const bg = primary && !disabled ? (tone === "danger" ? "#b0553a" : "var(--ac)") : "transparent";
  const fg = primary && !disabled ? "var(--sf)" : "var(--fg)";
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{
      padding: "10px 16px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", fontFamily: "var(--fm)",
      background: bg, color: fg,
      border: `1px solid ${border}`, borderRadius: 6,
      cursor: busy ? "wait" : disabled ? "not-allowed" : "pointer",
      minHeight: 44, opacity: disabled ? 0.55 : 1,
    }}>{children}</button>
  );
};

// Group header for the three Settings zones (Integrations, Help, Your data).
// Deliberately quiet — it's a signpost for the eye, not a banner.
const IntegrationsGroupHeader = ({ children }) => (
  <div style={{
    fontSize: 10, letterSpacing: 4, textTransform: "uppercase",
    color: "var(--mt)", fontFamily: "var(--fm)", fontWeight: 600,
    opacity: 0.7, marginTop: 28, marginBottom: 10,
  }}>
    {children}
  </div>
);

function IntegrationsPanel({ onClose, onDataChanged, setBiometrics, mode = "full", onModeChange = () => {}, reflectLang = "en-US", onReflectLangChange = () => {}, onResetEverything }) {
  const [ouraToken, setOuraToken] = useState(() => localStorage.getItem(OURA_ACCESS_KEY) || null);
  const [patInput, setPatInput] = useState("");
  const [ouraBusy, setOuraBusy] = useState(false);
  const [ouraMsg, setOuraMsg] = useState(null);
  const [ouraDaysSynced, setOuraDaysSynced] = useState(() => {
    try { const raw = localStorage.getItem(OURA_HISTORY_KEY); return raw ? Object.keys(JSON.parse(raw)).length : 0; } catch { return 0; }
  });
  const lastSync = (() => { try { return localStorage.getItem(OURA_LAST_SYNC_KEY); } catch { return null; } })();

  // After any Oura sync, push the freshest day into main React state so the
  // dashboard rings / Signal / Claude body-context reflect reality without
  // the user having to close & re-open the panel or tap a tab. Symmetric
  // with what Apple Health import does on success.
  const pushLatestBiometrics = (historyMap) => {
    const latest = pickLatestMeaningfulDay(historyMap);
    if (!latest) return;
    const bio = biometricsFromDayEntry(latest);
    if (!bio) return;
    setBiometrics?.(bio);
    try { localStorage.setItem(BIOMETRICS_KEY, JSON.stringify(bio)); } catch { /* ignore */ }
  };

  // Paint-today-first progress handler: every time fetchOuraRange resolves
  // an endpoint, check if daily_sleep or daily_readiness just completed and
  // push biometrics immediately so the dashboard populates in ~500ms instead
  // of waiting for the full history fetch.
  const paintTodayFirst = ({ step, partialMap }) => {
    if (step === "daily_sleep" || step === "daily_readiness") {
      if (partialMap && Object.keys(partialMap).length) pushLatestBiometrics(partialMap);
    }
  };

  // Read the existing historyMap from storage (so we can merge, not replace).
  const readStoredOuraHistory = () => {
    try { const raw = localStorage.getItem(OURA_HISTORY_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  };

  const connectOura = async () => {
    const token = patInput.trim();
    if (!token) return;
    setOuraBusy(true); setOuraMsg(null);
    try {
      // First-time connect has no HWM yet — this resolves to the full 180-day
      // window. On reconnects (e.g., after a token rotation), it correctly
      // stays incremental if the user's local HWM is still present.
      const { start, end, incremental } = ouraSyncWindow();
      const res = await fetchOuraRange(token, start, end, paintTodayFirst, { mode });
      if (!res.connected) { setOuraMsg({ type: "error", text: res.error || "Could not connect" }); setOuraBusy(false); return; }
      const merged = mergeOuraHistory(readStoredOuraHistory(), res.historyMap);
      localStorage.setItem(OURA_ACCESS_KEY, token);
      localStorage.setItem(OURA_HISTORY_KEY, JSON.stringify(merged));
      localStorage.setItem(OURA_LAST_SYNC_KEY, new Date().toISOString());
      recordOuraHwm();
      setOuraToken(token); setPatInput("");
      setOuraDaysSynced(Object.keys(merged).length);
      setOuraMsg({ type: "ok", text: incremental ? `Synced · ${res.daysFetched} new/updated days.` : `Connected · ${res.daysFetched} days synced.` });
      pushLatestBiometrics(merged);
      onDataChanged?.();
      // First-time connect: auto-close after a beat so the user lands on
      // their freshly-populated dashboard instead of hunting for the ×.
      if (!incremental) setTimeout(() => onClose?.(), 1500);
    } catch (e) {
      setOuraMsg({ type: "error", text: e.message || "Connect failed" });
    } finally { setOuraBusy(false); }
  };

  // Oura access tokens expire (typically every 30 days). If we have a
  // refresh_token + expires_at, swap for a fresh access token before any
  // sync; otherwise every call after expiry returns HTTP 400 from the
  // gateway and the user thinks the integration is dead. Legacy PAT
  // installs (no refresh + no expires_at) return the stored token
  // unchanged and let the sync handler surface failures.
  async function ensureFreshOuraToken() {
    const access = localStorage.getItem(OURA_ACCESS_KEY);
    const refresh = localStorage.getItem(OURA_REFRESH_KEY);
    const expiresAtRaw = localStorage.getItem(OURA_EXPIRES_KEY);
    const expiresAt = expiresAtRaw ? parseInt(expiresAtRaw, 10) : null;
    if (!access) return null;
    if (!refresh || !expiresAt) return access;
    const skewMs = 60 * 1000;
    if (Date.now() < expiresAt - skewMs) return access;
    const res = await fetch('/oura/oauth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) {
      throw new Error("Oura connection expired. Tap Disconnect, then Connect with Oura again.");
    }
    const data = await res.json().catch(() => ({}));
    const newAccess = data.access_token;
    const newRefresh = data.refresh_token;
    const newExpiresIn = parseInt(data.expires_in || '3600', 10);
    if (!newAccess) throw new Error("Oura refresh response missing access_token.");
    localStorage.setItem(OURA_ACCESS_KEY, newAccess);
    if (newRefresh) localStorage.setItem(OURA_REFRESH_KEY, newRefresh);
    localStorage.setItem(OURA_EXPIRES_KEY, String(Date.now() + newExpiresIn * 1000));
    return newAccess;
  }

  // OAuth "Connect with Oura" entry. Opens the server's OAuth start route,
  // which redirects to Oura's authorize page. After the user approves,
  // Oura sends them back to /oura/oauth/callback (server) which exchanges
  // the code for tokens and 302s back to the website with the tokens in
  // the URL hash. The useEffect on the parent CPI() picks up that hash
  // and stores the tokens (see line ~1633). This button is the only way
  // to connect Oura now — PATs were retired Dec 2025.
  const connectOuraOAuth = () => {
    const returnTo = window.location.origin + window.location.pathname;
    window.location.href = `/oura/oauth/start?return_to=${encodeURIComponent(returnTo)}`;
  };

  const resyncOura = async () => {
    if (!ouraToken) return;
    setOuraBusy(true); setOuraMsg(null);
    try {
      const freshToken = await ensureFreshOuraToken();
      if (!freshToken) {
        setOuraMsg({ type: "error", text: "No Oura token found. Tap Connect with Oura." });
        setOuraBusy(false);
        return;
      }
      if (freshToken !== ouraToken) setOuraToken(freshToken);
      const { start, end } = ouraSyncWindow();
      const res = await fetchOuraRange(freshToken, start, end, paintTodayFirst, { mode });
      if (!res.connected) { setOuraMsg({ type: "error", text: res.error || "Sync failed" }); setOuraBusy(false); return; }
      const merged = mergeOuraHistory(readStoredOuraHistory(), res.historyMap);
      localStorage.setItem(OURA_HISTORY_KEY, JSON.stringify(merged));
      localStorage.setItem(OURA_LAST_SYNC_KEY, new Date().toISOString());
      recordOuraHwm();
      setOuraDaysSynced(Object.keys(merged).length);
      setOuraMsg({ type: "ok", text: `Synced · ${res.daysFetched} new/updated days.` });
      pushLatestBiometrics(merged);
      onDataChanged?.();
    } catch (e) { setOuraMsg({ type: "error", text: e.message }); }
    finally { setOuraBusy(false); }
  };
  const disconnectOura = () => {
    if (!window.confirm("Disconnect Oura? Your synced data stays on this device until you clear it separately.")) return;
    localStorage.removeItem(OURA_ACCESS_KEY);
    localStorage.removeItem(OURA_REFRESH_KEY);
    localStorage.removeItem(OURA_EXPIRES_KEY);
    setOuraToken(null); setPatInput(""); setOuraMsg(null);
  };

  // ── Clear handlers (live in the "Your data" zone) ────────────────
  // Apple Health clear removes only days whose source is purely
  // "apple-health". Days that were also synced from Oura stay intact —
  // wiping those would throw away Oura data the user didn't ask to clear.
  // Returns the count of removed days for the confirmation/toast.
  const countAppleOnlyDays = () => {
    try {
      const raw = localStorage.getItem(OURA_HISTORY_KEY); if (!raw) return 0;
      const map = JSON.parse(raw);
      return Object.values(map).filter((d) => d && (d.source || "").toLowerCase() === "apple-health").length;
    } catch { return 0; }
  };
  const countOuraOnlyDays = () => {
    try {
      const raw = localStorage.getItem(OURA_HISTORY_KEY); if (!raw) return 0;
      const map = JSON.parse(raw);
      return Object.values(map).filter((d) => {
        if (!d) return false;
        const s = (d.source || "").toLowerCase();
        // "oura" only, or unsourced (legacy Oura-only writes) counts.
        return s === "oura" || s === "";
      }).length;
    } catch { return 0; }
  };

  // Shared helper: after any history-changing clear, push the new
  // latest day (or null) into biometrics state AND localStorage so the
  // dashboard cards reflect reality immediately. Without this, the
  // cached biometrics fills gaps in historyTrends and the user sees
  // "nothing changed" even though storage was wiped.
  const applyHistoryMutation = (nextMap) => {
    localStorage.setItem(OURA_HISTORY_KEY, JSON.stringify(nextMap));
    setOuraDaysSynced(Object.keys(nextMap).length);
    const latest = pickLatestMeaningfulDay(nextMap);
    const bio = latest ? biometricsFromDayEntry(latest) : null;
    try {
      if (bio) localStorage.setItem(BIOMETRICS_KEY, JSON.stringify(bio));
      else localStorage.removeItem(BIOMETRICS_KEY);
    } catch { /* ignore */ }
    // Invalidate all biometric-derived caches. These are the Claude-
    // generated texts that read from biometrics + history — if we leave
    // them in place, the dashboard keeps showing old insights and the
    // user thinks the clear didn't work. Journal-derived caches
    // (INSIGHTS_KEY, CLINICAL_KEY, JOURNAL_REPO_KEY) stay untouched —
    // they belong to a different data surface.
    try {
      localStorage.removeItem(LORE_KEY);
      localStorage.removeItem(COACH_CACHE_KEY);
    } catch { /* ignore */ }
    setBiometrics?.(bio);
    onDataChanged?.();
    window.dispatchEvent(new CustomEvent("cpi:wearable-synced"));
  };

  const clearAppleHealth = () => {
    const n = countAppleOnlyDays();
    if (n === 0) { setHkError("No Apple Health days to clear."); return; }
    if (!window.confirm(`Remove ${n} day${n === 1 ? "" : "s"} of Apple Health data?\n\nYour Oura data, journal entries, cognitive check-ins, and settings stay. Mixed days (Apple + Oura) keep their Oura portion. You can re-import the Health ZIP any time.`)) return;
    try {
      const raw = localStorage.getItem(OURA_HISTORY_KEY);
      const map = raw ? JSON.parse(raw) : {};
      const next = {};
      for (const [date, d] of Object.entries(map)) {
        if (!d) continue;
        const s = (d.source || "").toLowerCase();
        if (s === "apple-health") continue;
        next[date] = d;
      }
      setHkResult(null); setHkFile(null); setHkError(null);
      applyHistoryMutation(next);
    } catch (e) {
      setHkError(`Couldn't clear: ${e.message || e}`);
    }
  };

  // ── Reset everything — the nuke button ────────────────────────────
  // Wipes every key that drives the dashboard: wearable history,
  // biometric scores, self-rated sliders, cognitive check-ins, cached
  // Claude/GPT outputs. Keeps journal entries and two benign
  // preferences (chronotype + mode). Bumps the main-app reset counter
  // via onResetEverything, which re-keys the dashboard components so
  // any in-memory cached state resets too.
  const resetEverything = () => {
    if (!window.confirm(
      "Reset everything?\n\n" +
      "This clears ALL dashboard data on this device:\n" +
      "• Wearable history (Oura + Apple Health)\n" +
      "• Biometric scores and sliders\n" +
      "• Cognitive check-ins (KSS, PSS-4, PVT-B)\n" +
      "• Cached observations and insights\n\n" +
      "Your journal entries stay. Continue?"
    )) return;
    try {
      localStorage.removeItem(OURA_ACCESS_KEY);
      localStorage.removeItem(OURA_HISTORY_KEY);
      localStorage.removeItem(OURA_HWM_KEY);
      localStorage.removeItem(OURA_LAST_SYNC_KEY);
      localStorage.removeItem(OURA_UNAVAILABLE_KEY);
      localStorage.removeItem(BIOMETRICS_KEY);
      localStorage.removeItem(LIFESTYLE_KEY);
      localStorage.removeItem(CHECKIN_KEY);
      localStorage.removeItem(LORE_KEY);
      localStorage.removeItem(COACH_CACHE_KEY);
      // These feed the Efficiency Grade card on the YOU tab. Without
      // wiping them, the card keeps rendering stale signals (allostatic,
      // hcpi avg, purpose/growth/self-dist) after a "Reset everything",
      // which reads as a broken reset to the user.
      localStorage.removeItem(INSIGHTS_KEY);
      localStorage.removeItem(CLINICAL_KEY);
    } catch { /* ignore */ }
    // HCPI history lives in IDB under SK, not localStorage.
    try { window.storage?.delete?.(SK); } catch { /* ignore */ }
    setOuraToken(null); setPatInput(""); setOuraMsg(null);
    setHkResult(null); setHkFile(null); setHkError(null);
    setOuraDaysSynced(0);
    onResetEverything?.();
    onDataChanged?.();
    window.dispatchEvent(new CustomEvent("cpi:wearable-synced"));
    onClose?.();
  };

  const resetOura = () => {
    const n = countOuraOnlyDays();
    const msg = ouraToken
      ? `Reset Oura?\n\nThis disconnects your ring and removes ${n} day${n === 1 ? "" : "s"} of Oura-only synced data. Days where Apple Health also contributed keep their Apple data. Your journals, check-ins, and settings stay. You can reconnect with your token any time.`
      : `Remove ${n} day${n === 1 ? "" : "s"} of Oura-only data?\n\nDays where Apple Health also contributed keep their Apple data. Your journals, check-ins, and settings stay.`;
    if (!window.confirm(msg)) return;
    try {
      localStorage.removeItem(OURA_ACCESS_KEY);
      localStorage.removeItem(OURA_HWM_KEY);
      localStorage.removeItem(OURA_LAST_SYNC_KEY);
      setOuraToken(null); setPatInput(""); setOuraMsg(null);
      const raw = localStorage.getItem(OURA_HISTORY_KEY);
      const map = raw ? JSON.parse(raw) : {};
      const next = {};
      for (const [date, d] of Object.entries(map)) {
        if (!d) continue;
        const s = (d.source || "").toLowerCase();
        if (s === "oura" || s === "") continue;
        next[date] = d;
      }
      applyHistoryMutation(next);
    } catch (e) {
      setOuraMsg({ type: "error", text: `Couldn't reset: ${e.message || e}` });
    }
  };

  // ── Apple Health state
  const hkInputRef = useRef(null);
  const [hkFile, setHkFile] = useState(null);
  const [hkDays, setHkDays] = useState(90);
  const [hkBusy, setHkBusy] = useState(false);
  const [hkProgress, setHkProgress] = useState(null);
  const [hkResult, setHkResult] = useState(null);
  const [hkError, setHkError] = useState(null);
  const [hkInsight, setHkInsight] = useState(null);
  const [hkInsightBusy, setHkInsightBusy] = useState(false);

  const runAppleImport = async () => {
    if (!hkFile) return;
    setHkBusy(true); setHkError(null); setHkResult(null); setHkInsight(null); setHkProgress({ phase: "Starting…", percent: 0 });
    try {
      const result = await parseAppleHealthZip(hkFile, { days: hkDays }, (p) => setHkProgress(p));
      const merged = mergeAppleHealthIntoHistory(result.entries);
      setHkResult({ ...result, ...merged });

      // Push the freshest day into biometrics state so the rings, Signal,
      // and Claude's body context see the data immediately.
      if (merged.latestDay && setBiometrics) {
        const bio = biometricsFromDayEntry(merged.latestDay);
        if (bio) {
          setBiometrics(bio);
          try { localStorage.setItem(BIOMETRICS_KEY, JSON.stringify(bio)); } catch { /* ignore */ }
        }
      }
      onDataChanged?.();

      // Run the Claude intelligence pass over the parsed data so the user
      // sees interpretation, not just a dump of numbers.
      setHkInsightBusy(true);
      try {
        const insight = await runAppleHealthIntelligence(merged.historyMap, merged.latestDay, { mode });
        setHkInsight(insight);
      } catch { /* ignore — result still shown */ }
      finally { setHkInsightBusy(false); }
    } catch (e) {
      setHkError(e.message || "Import failed");
    } finally {
      setHkBusy(false); setHkProgress(null);
    }
  };

  const Section = IntegrationsSection;
  const Btn = IntegrationsBtn;
  const Group = IntegrationsGroupHeader;
  const appleOnlyCount = countAppleOnlyDays();
  const ouraOnlyCount = countOuraOnlyDays();

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg)", overflowY: "auto", zIndex: 200, paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "28px 24px 60px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <div style={{ fontSize: 22, fontFamily: "var(--fd)", fontWeight: 300, color: "var(--fg)" }}>Settings</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "var(--mt)", cursor: "pointer", padding: 8, minHeight: 44, minWidth: 44 }}>×</button>
        </header>

        <Group>Mode</Group>
        <Section
          title={mode === "reflect" ? "Reflect" : "Full"}
          subtitle={mode === "reflect"
            ? "Journal + cognition first. Body surface built from iPhone-only signals — no wearable needed."
            : "Biometric-led. The default — best when you have a wearable (Oura) feeding HRV and readiness daily."}
          accent={mode === "reflect" ? "#b9a36a" : "var(--ac)"}
          collapsible={false}
        >
          <div style={{ display: "flex", gap: 8, padding: 3, background: "var(--bg)", border: "1px solid var(--ln)", borderRadius: 8, marginBottom: 14 }}>
            {[
              { key: "full", label: "Full", desc: "Biometric-led" },
              { key: "reflect", label: "Reflect", desc: "Journal-led" },
            ].map((opt) => {
              const active = mode === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onModeChange(opt.key)}
                  style={{
                    flex: 1, padding: "10px 12px", borderRadius: 6,
                    background: active ? "var(--fg)" : "transparent",
                    color: active ? "var(--bg)" : "var(--fg)",
                    border: "none", cursor: "pointer",
                    fontFamily: "var(--fm)", fontSize: 11, letterSpacing: 0.5,
                    display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start",
                  }}
                >
                  <span style={{ fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase", fontSize: 10 }}>{opt.label}</span>
                  <span style={{ fontSize: 9, opacity: 0.7 }}>{opt.desc}</span>
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: "var(--mt)", lineHeight: 1.7 }}>
            {mode === "reflect"
              ? "In Reflect mode, the Body + Context panel is built around signals your iPhone alone can measure: total sleep time (when Apple Health has it), activity (steps + active minutes from the motion coprocessor), plus daylight minutes (iOS 17+), walking pace, steadiness, and ambient audio dB. The composite Readiness and HRV-delta Recovery cards are hidden — wrist-HRV and derived scores need a Watch or Ring to be honest. Journal and cognitive check-in stay exactly the same."
              : "Full mode shows every biometric card the app computes — Sleep, Recovery, Readiness — each with personal-baseline calibration and honest \"Waiting\" / \"Calibrating\" states. Best when Oura is connected; also works with Apple Health if you're comfortable with the limitations around wrist-HRV reliability."}
          </div>
          {mode === "reflect" && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: "var(--mt)", marginBottom: 8 }}>Reflect language</div>
              <div style={{ display: "flex", gap: 8, padding: 3, background: "var(--bg)", border: "1px solid var(--ln)", borderRadius: 8 }}>
                {[
                  { key: "en-US", label: "English" },
                  { key: "bn", label: "বাংলা" },
                ].map((opt) => {
                  const active = (reflectLang === "bn" ? "bn" : "en-US") === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => onReflectLangChange(opt.key)}
                      style={{
                        flex: 1, padding: "10px 12px", borderRadius: 6,
                        background: active ? "var(--fg)" : "transparent",
                        color: active ? "var(--bg)" : "var(--fg)",
                        border: "none", cursor: "pointer",
                        fontFamily: "var(--fm)", fontSize: 12, letterSpacing: 0.5,
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: "var(--mt)", lineHeight: 1.6, marginTop: 8 }}>
                Speak your seed in Bengali, and your reflection comes back in Bengali too. The rest of the app stays in English for now.
              </div>
            </div>
          )}
        </Section>

        <Group>Integrations</Group>

        {/* ── Oura ── auto-expand when not connected so first-time users
             see the connect flow immediately rather than a collapsed row. */}
        <Section title="Oura Ring" subtitle={ouraToken ? `Connected · ${ouraDaysSynced} days of data${lastSync ? ` · last synced ${timeAgo(lastSync)}` : ""}` : "Not connected"} accent="#94B79A" defaultOpen={!ouraToken}>
          {mode === "reflect" && (
            <div style={{ marginBottom: 14, padding: "10px 12px", borderLeft: "2px solid rgba(184,134,11,0.55)", background: "rgba(184,134,11,0.05)", fontFamily: "var(--fb)", fontSize: 12, color: "var(--fg)", lineHeight: 1.55 }}>
              In <b>Reflect</b>, we only pull your activity from Oura. Sleep and recovery stay unread until you switch to Full.
            </div>
          )}
          {!ouraToken ? (
            <>
              <div style={{ fontSize: 12, color: "var(--fg)", lineHeight: 1.6, marginBottom: 12 }}>
                Connect via Oura's official sign-in. (Personal Access Tokens were retired by Oura in Dec 2025.)
              </div>
              <Btn onClick={connectOuraOAuth} disabled={ouraBusy}>Connect with Oura</Btn>
              <details style={{ marginTop: 14, fontSize: 11, color: "var(--mt)" }}>
                <summary style={{ cursor: "pointer", fontFamily: "var(--fm)", letterSpacing: 1.4, textTransform: "uppercase", fontSize: 10 }}>I have a legacy Personal Access Token</summary>
                <div style={{ marginTop: 10, fontSize: 12, color: "var(--fg)", lineHeight: 1.6, marginBottom: 10 }}>
                  Some long-time accounts still have a working PAT. Paste it here only if you know yours works — new PATs cannot be issued.
                </div>
                <input type="password" value={patInput} onChange={(e) => setPatInput(e.target.value)} placeholder="Paste token…" style={{ width: "100%", padding: "10px 12px", fontSize: 16, background: "var(--bg)", border: "1px solid var(--ln)", borderRadius: 6, color: "var(--fg)", fontFamily: "var(--fm)", marginBottom: 10 }} />
                <Btn onClick={connectOura} disabled={ouraBusy || !patInput.trim()}>{ouraBusy ? "Connecting…" : "Connect & sync"}</Btn>
              </details>
            </>
          ) : (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Btn onClick={resyncOura} disabled={ouraBusy}>{ouraBusy ? "Syncing…" : "Sync now"}</Btn>
              <Btn onClick={disconnectOura} primary={false}>Disconnect</Btn>
            </div>
          )}
          {ouraMsg && <div style={{ marginTop: 12, fontSize: 11, color: ouraMsg.type === "error" ? r : g, padding: "8px 10px", background: ouraMsg.type === "error" ? "rgba(176,85,58,0.08)" : "rgba(79,138,95,0.08)", borderRadius: 6 }}>{ouraMsg.text}</div>}
        </Section>

        {/* ── Apple Health ── */}
        <Section title="Apple Health" subtitle="One-time import from the Health app's export ZIP" accent="#9DB2C9">
          <details style={{ marginBottom: 14, fontSize: 11, color: "var(--mt)", lineHeight: 1.7 }}>
            <summary style={{ cursor: "pointer", color: "var(--fg)", fontFamily: "var(--fm)", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", paddingBottom: 8 }}>How to export</summary>
            <ol style={{ paddingLeft: 18, margin: 0, lineHeight: 1.75 }}>
              <li>On your iPhone, open the <strong style={{ color: "var(--fg)" }}>Health</strong> app.</li>
              <li>Tap your profile picture (top right).</li>
              <li>Scroll to the bottom → <strong style={{ color: "var(--fg)" }}>Export All Health Data</strong>.</li>
              <li>Wait (takes 30–60 sec), then share to yourself — AirDrop or email.</li>
              <li>You'll get an <code style={{ fontFamily: "var(--fm)", color: "var(--fg)" }}>export.zip</code>. Drop it below.</li>
            </ol>
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--ln)", fontSize: 10.5 }}>
              The parser runs entirely in your browser. The file never leaves this device. It reads sleep, HRV, resting HR, steps, exercise minutes, SpO₂, temperature, respiratory rate, and mindful sessions — and merges them day-by-day with your Oura data (Oura takes precedence where both have a reading).
            </div>
          </details>

          <input ref={hkInputRef} type="file" accept=".zip"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (!/\.zip$/i.test(f.name)) { setHkError(`Not a .zip file — got ${f.name}.`); return; }
              setHkFile(f); setHkError(null); setHkResult(null);
            }}
            style={{ display: "none" }} />
          <div
            role="button" tabIndex={0}
            onClick={() => { if (hkInputRef.current) { hkInputRef.current.value = ""; hkInputRef.current.click(); } }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); hkInputRef.current?.click(); } }}
            style={{
              padding: "22px 18px",
              background: hkFile ? "rgba(79,138,95,0.08)" : "var(--bg)",
              border: hkFile ? "1.5px solid rgba(79,138,95,0.5)" : "1.5px dashed var(--ln)",
              borderRadius: 10, textAlign: "center", cursor: "pointer", marginBottom: 12,
              transition: "background .2s, border-color .2s",
            }}>
            {hkFile ? (
              <>
                <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: g, fontFamily: "var(--fm)", fontWeight: 600, marginBottom: 6 }}>✓ File ready</div>
                <div style={{ fontSize: 13, color: "var(--fg)", wordBreak: "break-all" }}>{hkFile.name}</div>
                <div style={{ fontSize: 10, color: "var(--mt)", fontFamily: "var(--fm)", marginTop: 4 }}>{(hkFile.size / 1024 / 1024).toFixed(1)} MB · click to pick another</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 14, color: "var(--fg)", marginBottom: 4 }}>Click here to pick your Health file</div>
                <div style={{ fontSize: 10, color: "var(--mt)", fontFamily: "var(--fm)" }}>No file selected yet · looks like export.zip · up to ~200 MB</div>
              </>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <label style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--mt)", fontFamily: "var(--fm)" }}>Range</label>
            {[30, 90, 180, 365, 3650].map((n) => (
              <button key={n} type="button" onClick={() => setHkDays(n)} style={{
                padding: "6px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontFamily: "var(--fm)",
                background: hkDays === n ? "var(--ac)" : "transparent",
                color: hkDays === n ? "var(--sf)" : "var(--fg)",
                border: "1px solid var(--ln)", borderRadius: 4, cursor: "pointer",
              }}>{n === 3650 ? "All" : `${n}d`}</button>
            ))}
          </div>

          <Btn onClick={runAppleImport} disabled={!hkFile || hkBusy} busy={hkBusy}>{hkBusy ? "Importing…" : "Import into repo"}</Btn>

          {hkProgress && (
            <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--bg)", border: "1px solid var(--ln)", borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: "var(--fg)", fontFamily: "var(--fm)", marginBottom: 6 }}>{hkProgress.phase}</div>
              <div style={{ height: 4, background: "var(--ln)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${hkProgress.percent || 0}%`, background: "#9DB2C9", borderRadius: 2, transition: "width 300ms ease-out" }} />
              </div>
            </div>
          )}

          {hkError && <div style={{ marginTop: 12, fontSize: 11, color: r, padding: "8px 10px", background: "rgba(176,85,58,0.08)", borderRadius: 6 }}>{hkError}</div>}

          {hkResult && (
            <div style={{ marginTop: 14, padding: "12px 14px", background: "rgba(79,138,95,0.08)", border: "1px solid rgba(79,138,95,0.25)", borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: g, fontFamily: "var(--fm)", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Imported</div>
              <div style={{ fontSize: 12, color: "var(--fg)", lineHeight: 1.6 }}>
                {hkResult.entries.length} days · {hkResult.keptRecords.toLocaleString()} useful records out of {hkResult.totalRecords.toLocaleString()} scanned.
                <br /><span style={{ color: "var(--mt)", fontSize: 11 }}>{hkResult.added} new days · {hkResult.merged} days merged with existing Oura data.</span>
              </div>
              {hkResult.latestDay && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed rgba(79,138,95,0.25)", fontSize: 11, color: "var(--fg)", lineHeight: 1.7 }}>
                  <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--mt)", fontFamily: "var(--fm)", marginBottom: 4 }}>Most recent day · {hkResult.latestDay.date}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                    {hkResult.latestDay.sleepScore != null && <div><span style={{ color: "var(--mt)", fontSize: 10 }}>Sleep</span><br /><strong>{hkResult.latestDay.sleepScore}</strong>/100</div>}
                    {hkResult.latestDay.readinessScore != null && <div><span style={{ color: "var(--mt)", fontSize: 10 }}>Readiness</span><br /><strong>{hkResult.latestDay.readinessScore}</strong>/100</div>}
                    {hkResult.latestDay.activityScore != null && <div><span style={{ color: "var(--mt)", fontSize: 10 }}>Activity</span><br /><strong>{hkResult.latestDay.activityScore}</strong>/100</div>}
                    {hkResult.latestDay.avgHRV != null && <div><span style={{ color: "var(--mt)", fontSize: 10 }}>HRV</span><br /><strong>{hkResult.latestDay.avgHRV}</strong>ms</div>}
                    {hkResult.latestDay.restingHR != null && <div><span style={{ color: "var(--mt)", fontSize: 10 }}>Resting HR</span><br /><strong>{hkResult.latestDay.restingHR}</strong></div>}
                    {hkResult.latestDay.totalSleepMin != null && <div><span style={{ color: "var(--mt)", fontSize: 10 }}>Sleep h</span><br /><strong>{(hkResult.latestDay.totalSleepMin / 60).toFixed(1)}</strong></div>}
                  </div>
                </div>
              )}
            </div>
          )}

          {hkInsightBusy && (
            <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(157,178,201,0.08)", border: "1px solid rgba(157,178,201,0.25)", borderRadius: 8, fontSize: 11, color: "var(--mt)", fontFamily: "var(--fm)", letterSpacing: 1 }}>
              Claude Sonnet 4.6 is reading between the numbers…
            </div>
          )}

          {hkInsight && (
            <div style={{ marginTop: 12, padding: "14px 16px", background: "rgba(157,178,201,0.08)", border: "1px solid rgba(157,178,201,0.3)", borderLeft: "3px solid #9DB2C9", borderRadius: 8 }}>
              <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#9DB2C9", fontFamily: "var(--fm)", fontWeight: 600, marginBottom: 6 }}>
                Ori · biometric intelligence
                {hkInsight.confidence && <span style={{ marginLeft: 8, color: "var(--mt)", fontWeight: 400 }}>· {hkInsight.confidence} confidence</span>}
              </div>
              {hkInsight.headline && <div style={{ fontSize: 13, color: "var(--fg)", fontFamily: "var(--fd)", lineHeight: 1.5, marginBottom: 10 }}>{hkInsight.headline}</div>}
              {hkInsight.bullets?.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, color: "var(--fg)", lineHeight: 1.7 }}>
                  {hkInsight.bullets.map((b, i) => <li key={i} style={{ marginBottom: 4 }}>{b}</li>)}
                </ul>
              )}
              {hkInsight.flags?.length > 0 && (
                <div style={{ marginTop: 10, padding: "8px 10px", background: "rgba(176,85,58,0.08)", borderRadius: 6 }}>
                  <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: r, fontFamily: "var(--fm)", fontWeight: 600, marginBottom: 4 }}>Flags</div>
                  {hkInsight.flags.map((f, i) => <div key={i} style={{ fontSize: 11, color: "var(--fg)", marginBottom: 2 }}>• {f}</div>)}
                </div>
              )}
              {hkInsight.actions?.length > 0 && (
                <div style={{ marginTop: 10, padding: "8px 10px", background: "rgba(148,183,154,0.1)", borderRadius: 6 }}>
                  <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: g, fontFamily: "var(--fm)", fontWeight: 600, marginBottom: 4 }}>Try</div>
                  {hkInsight.actions.map((a, i) => <div key={i} style={{ fontSize: 11, color: "var(--fg)", marginBottom: 2 }}>→ {a}</div>)}
                </div>
              )}
            </div>
          )}
        </Section>

        {/* ── Future / placeholder ── */}
        <Section title="Coming later" subtitle="Native iOS bridge · Whoop · Garmin · Strava · Google Fit" accent="var(--mt)">
          <div style={{ fontSize: 11, color: "var(--mt)", lineHeight: 1.7 }}>
            Apple Health stays one-time-import until a native iOS companion app exists. Other wearables will route through <em>Terra</em> or their own APIs once the product has real users.
          </div>
        </Section>

        <Group>Help</Group>

        {/* ── Know your tools — plain-language glossary ── */}
        <Section title="Know your tools" subtitle="What each number on your dashboard actually means." accent="var(--mt)">
          <ToolsGlossary />
        </Section>

        <Group>Your data</Group>

        {/* ── Apple Health data clear ── */}
        <Section
          title="Apple Health data"
          subtitle={appleOnlyCount > 0 ? `${appleOnlyCount} day${appleOnlyCount === 1 ? "" : "s"} of imported data on this device` : "Nothing imported from Apple Health on this device"}
          accent="#9DB2C9"
        >
          <div style={{ fontSize: 11, color: "var(--mt)", lineHeight: 1.7, marginBottom: 14 }}>
            Removes imported Apple Health days from this browser. Days that were also synced from Oura keep their Oura portion intact. Your journal entries, cognitive check-ins, and settings stay.
          </div>
          <Btn onClick={clearAppleHealth} primary={false} tone="danger" disabled={appleOnlyCount === 0}>
            Clear imported data
          </Btn>
        </Section>

        {/* ── Oura reset ── */}
        <Section
          title="Oura data"
          subtitle={ouraToken
            ? `Connected · ${ouraOnlyCount} Oura-only day${ouraOnlyCount === 1 ? "" : "s"} on this device`
            : (ouraOnlyCount > 0
                ? `${ouraOnlyCount} Oura-only day${ouraOnlyCount === 1 ? "" : "s"} left on this device`
                : "Nothing from Oura on this device")}
          accent="#94B79A"
        >
          <div style={{ fontSize: 11, color: "var(--mt)", lineHeight: 1.7, marginBottom: 14 }}>
            Disconnects your ring and removes Oura-only days. Days that also have Apple Health data keep the Apple portion intact. Your journal entries, check-ins, and settings stay. You can reconnect with your token any time.
          </div>
          <Btn onClick={resetOura} primary={false} tone="danger" disabled={!ouraToken && ouraOnlyCount === 0}>
            {ouraToken ? "Reset & clear history" : "Clear history"}
          </Btn>
        </Section>

        {/* ── Reset everything ── */}
        <Section
          title="Reset everything"
          subtitle="Wipes every dashboard signal in one step. Your journals stay."
          accent="#b0553a"
        >
          <div style={{ fontSize: 11, color: "var(--mt)", lineHeight: 1.7, marginBottom: 14 }}>
            Removes wearable history, biometric scores, self-rated sliders, cognitive check-ins, and cached observations. Equivalent to a fresh install except your journal entries are preserved. Use this when you want a clean slate — not for day-to-day cleanup.
          </div>
          <Btn onClick={resetEverything} primary={true} tone="danger">
            Reset everything
          </Btn>
        </Section>

        <div style={{ textAlign: "center", marginTop: 20 }}>
          <Btn onClick={onClose} primary={false}>Done</Btn>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN APPLICATION
   ═══════════════════════════════════════════ */

/* ─── Wake-time helpers ─────────────────────────────────────────────
   Source priority for the "wake-up" input:
     1. User override persisted for today (never overwritten by auto-sync)
     2. Latest wearable bedtimeEnd from OURA_HISTORY_KEY (Oura or Apple Health)
     3. Default "07:00"
   Rationale: if a wearable already recorded the wake time, don't re-ask;
   if the user typed their own value today, keep it across refreshes.
   ─────────────────────────────────────────────────────────────────── */





// Rolling "most recent wake time" across all days — used as the fallback
// when neither today's override nor the wearable's bedtimeEnd is available.


// Returns "HH:MM" or null. Reads the latest bedtimeEnd from the wearable
// history map (shared by Oura and Apple Health importers).

// "oura" | "apple" | null — used to label the auto-filled value.

export default function CPI() {
  // First-run welcome gate. If the user hasn't been through Name-Your-
  // Garden yet, the rest of the app stays unmounted behind the opener.
  // Flag written on completion → persists through reloads.
  const [welcomeDone, setWelcomeDone] = useState(() => {
    try { return localStorage.getItem(WELCOME_DONE_KEY) === "1"; } catch { return false; }
  });
  const [view, setView] = useState("input");
  const [tab, setTab] = useState("analyze");

  // ── Swipe between tabs ─────────────────────────────────────────────
  // Native iOS apps switch between top-level destinations with a quick
  // horizontal swipe of the page. We support the same gesture by
  // listening for touch events at the document level and switching tabs
  // when a clear-horizontal swipe completes. Conservative thresholds
  // (8% of width AND ≥1.5× the vertical movement) keep vertical scroll
  // and tap interactions intact.
  useEffect(() => {
    const tabOrder = ["analyze", "profile", "patterns", "journal"];
    let startX = null, startY = null, startTarget = null, startedAt = 0;

    const onTouchStart = (e) => {
      const t = e.touches?.[0]; if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      startTarget = e.target;
      startedAt = Date.now();
    };
    const onTouchEnd = (e) => {
      if (startX == null) return;
      const t = e.changedTouches?.[0]; if (!t) { startX = null; return; }
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dt = Date.now() - startedAt;
      const startedFrom = startTarget;
      startX = null; startY = null; startTarget = null;

      // Bail early on long-held touches — those read as drags / scrolls,
      // not the brisk swipe gesture we're matching.
      if (dt > 600) return;

      // Skip swipes that start inside an element marked "no-swipe" —
      // the bucket detail page, modals, popovers, horizontal carousels.
      // Also skip when a fullscreen overlay is open (modal/popup gates).
      if (startedFrom?.closest?.("[data-no-swipe]")) return;
      if (document.querySelector("[data-modal-open]")) return;

      // Don't intercept gestures that start on text inputs / textareas
      // — those need their own selection behavior.
      const tag = startedFrom?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      // Require a clearly horizontal gesture: 8% of viewport width AND
      // at least 1.5× more horizontal than vertical movement.
      const viewportW = window.innerWidth || 320;
      if (Math.abs(dx) < viewportW * 0.08) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return;

      const idx = tabOrder.indexOf(tab);
      if (idx < 0) return;
      if (dx < 0 && idx < tabOrder.length - 1) setTab(tabOrder[idx + 1]);
      else if (dx > 0 && idx > 0) setTab(tabOrder[idx - 1]);
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [tab]);
  // Wake-time init — fallback chain (first hit wins):
  //   1. Today's manual override (never overwritten by auto-sync)
  //   2. Wearable bedtimeEnd from the last ~28 hours
  //   3. Most recent wake time from any prior day ("cpi_wake_last")
  //   4. "07:00" default
  // The `wakeOverride` flag tracks whether the current value came from (1) —
  // used by the render to choose between "Woke up at · from Oura" vs the
  // plain "When did you wake up?" question.
  const [wakeTime, setWakeTimeRaw] = useState(() => loadWakeOverride() || getAutoWakeTime() || loadLastWake() || "07:00");
  const [wakeOverride, setWakeOverride] = useState(() => !!loadWakeOverride());
  const [wakeEditing, setWakeEditing] = useState(false);
  const setWakeTime = (value) => {
    setWakeTimeRaw(value);
    setWakeOverride(true);
    saveWakeOverride(value);
  };
  const [dayDesc, setDayDesc] = useState("");
  const [lingering, setLingering] = useState("");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [analysisStage, setAnalysisStage] = useState(null); // { label, model, startedAt }
  const [biometrics, setBiometrics] = useState(() => { try { const s = localStorage.getItem(BIOMETRICS_KEY); return s ? JSON.parse(s) : null; } catch { return null; } });
  const [ouraToken, setOuraToken] = useState(() => localStorage.getItem(OURA_ACCESS_KEY) || null);

  // OAuth callback handler. When Oura redirects the user back to the
  // website after authorize, the server appends tokens to the URL hash:
  //   #oura_oauth=success&access_token=...&refresh_token=...&expires_in=...
  // We catch that here, persist the tokens, set the React state, and
  // clean the hash from the URL so a reload doesn't double-process it.
  // PATs (legacy) skip this — only the OAuth flow produces this hash.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || !hash.includes('oura_oauth=')) return;
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const status = params.get('oura_oauth');
    if (status === 'error') {
      const reason = params.get('reason') || 'unknown';
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      console.error('Oura OAuth error:', reason);
      return;
    }
    if (status !== 'success') return;
    const access = params.get('access_token');
    const refresh = params.get('refresh_token');
    const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
    if (!access) return;
    try {
      localStorage.setItem(OURA_ACCESS_KEY, access);
      if (refresh) localStorage.setItem(OURA_REFRESH_KEY, refresh);
      localStorage.setItem(OURA_EXPIRES_KEY, String(Date.now() + expiresIn * 1000));
    } catch { /* ignore quota */ }
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setOuraToken(access);
  }, []);

  const [lifestyle, setLifestyle] = useState(() => { try { const s = localStorage.getItem(LIFESTYLE_KEY); return s ? JSON.parse(s) : { hydration: 6, exercise: "none" }; } catch { return { hydration: 6, exercise: "none" }; } });
  const [chronotype, setChronotype] = useState(() => localStorage.getItem(CHRONO_KEY) || "flexible");
  const [mode, setMode] = useState(() => localStorage.getItem(MODE_KEY) || "full");
  // Backfill state: when the user flips Reflect → Full and an Oura token
  // is present, we silently pull the previously-skipped endpoints for the
  // last 180 days so the Full-mode dashboard isn't empty. A tiny non-
  // blocking toast at the bottom of the screen surfaces the work.
  const [backfillBusy, setBackfillBusy] = useState(false);
  const prevModeRef = useRef(mode);
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (prev !== "reflect" || mode !== "full") return;
    const token = localStorage.getItem(OURA_ACCESS_KEY);
    if (!token) return;
    setBackfillBusy(true);
    const { start, end } = ouraSyncWindow();
    fetchOuraRange(token, start, end, () => {}, { mode: "full" })
      .then((res) => {
        if (!res?.connected || !res.historyMap) return;
        let stored = {};
        try { const raw = localStorage.getItem(OURA_HISTORY_KEY); if (raw) stored = JSON.parse(raw); } catch { /* ignore */ }
        const merged = mergeOuraHistory(stored, res.historyMap);
        localStorage.setItem(OURA_HISTORY_KEY, JSON.stringify(merged));
        localStorage.setItem(OURA_LAST_SYNC_KEY, new Date().toISOString());
        recordOuraHwm();
        const latest = pickLatestMeaningfulDay(merged);
        if (latest) {
          const bio = biometricsFromDayEntry(latest);
          if (bio) setBiometrics((prevBio) => ({ ...(prevBio || {}), ...bio }));
        }
        window.dispatchEvent(new Event("cpi:wearable-synced"));
      })
      .catch(() => { /* swallow — backfill is opportunistic, not load-bearing */ })
      .finally(() => setBackfillBusy(false));
  }, [mode]);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keeperOpen, setKeeperOpen] = useState(false);
  // User-in-the-loop part confirmations. Hydrate from localStorage once at
  // mount; updates flow through `handlePartConfirmation` so both Patterns
  // (pill) and GardenKeeper (roster) re-render off the same source.
  const [confirmations, setConfirmations] = useState(() => loadConfirmations());
  const handlePartConfirmation = (partId, state) => {
    const next = saveConfirmation(partId, state);
    setConfirmations(next);
  };
  // Journal-repo snapshot for the Patterns trend chart (historical overlay).
  // Lives in its own localStorage key, refreshed when the Patterns tab is opened.
  const [repoSnapshot, setRepoSnapshot] = useState(() => { try { return loadRepo(); } catch { return { entries: [] }; } });
  // Date-range picker for the historical baseline. Empty strings = auto-default
  // (21-day window immediately before the chart's earliest visible day).
  const [baselineStart, setBaselineStart] = useState("");
  const [baselineEnd, setBaselineEnd] = useState("");
  // Bumps on "Reset everything" in Settings → Your data. Passed as a
  // `key` to dashboard components so React unmounts + remounts them —
  // which is the only reliable way to reset useState initializers that
  // read cached JSON at mount (coach line, observation bullets, etc.).
  const [resetTick, setResetTick] = useState(0);
  // Tick counter — bumps every 15 min (and on window focus) to force a
  // re-read of wearable history / check-in data so the first-page metrics
  // don't go stale. Included in `todayTrends` computation as a dep.
  const [refreshTick, setRefreshTick] = useState(0);

  // App language. Persisted so STT and the letter route to বাংলা whenever chosen
  // (any mode); English by default. Set from Settings → About → Language.
  const [reflectLang, setReflectLang] = useState(() => reflectSttLanguage());
  const onReflectLangChange = useCallback((next) => {
    const v = next === "bn" ? "bn" : "en-US";
    setReflectLang(v);
    try { localStorage.setItem(REFLECT_LANG_KEY, v === "bn" ? "bn" : "en"); } catch { /* ignore */ }
  }, []);
  const sttLang = reflectLang;
  const dayVoice = useVoice(useCallback((text) => setDayDesc(prev => prev ? prev + " " + text : text), []), { language: sttLang });
  const lingVoice = useVoice(useCallback((text) => setLingering(prev => prev ? prev + " " + text : text), []), { language: sttLang });

  // Journal textarea ref + focus-on-remount. iOS WKWebView doesn't bind
  // the software keyboard to a freshly mounted <textarea> the way a
  // desktop browser does — after `view` flips back to "input" post-Plant
  // or post-Read, the cursor blinks but keystrokes are silently dropped
  // until you explicitly call .focus() on the remounted element. The
  // useEffect below fires whenever we return to input view and gives
  // iOS the focus signal it needs. Harmless on web (focus on a textarea
  // the user already focused is a no-op).
  const dayTextareaRef = useRef(null);

  // Pull the large blobs (wearable history, journal repo) from IndexedDB
  // into the in-memory cache on first mount. Migrates from localStorage
  // automatically if IDB is empty on first boot after the upgrade.
  useEffect(() => { hydrateStorage().catch(() => { /* fall back to localStorage */ }); }, []);

  // WHO-5 daily reminder — fires a local notification if all of:
  // reminder is enabled, current hour >= configured hour, today's
  // WHO-5 hasn't been logged, user hasn't dismissed for today, and
  // we haven't already fired today. Checked on mount, every time
  // the tab becomes visible, and every 5 minutes while open.
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      // Failure here is non-fatal — silent ignore (notifications may
      // be unsupported, permission denied, sw not yet active, etc).
      maybeFireReminder().catch(() => { /* ignore */ });
    };
    run();
    const onVis = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVis);
    const id = setInterval(run, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(id);
    };
  }, []);

  // Background-sync any saved calendar feeds on app boot. Events live in
  // a session-scope cache (calendar.js) and are not persisted, so the
  // first paint after refresh has an empty events list until this runs.
  // Failures are silent — the Settings sheet will surface errors when the
  // user goes there.
  useEffect(() => {
    // calendar.js is static-imported elsewhere; use require-style dynamic
    // pull here would just defer to the same chunk. Inline async block.
    (async () => {
      try {
        const cal = await import("./calendar.js");
        const feeds = cal.loadFeeds();
        for (const f of feeds) {
          try { await cal.syncFeed(f.id); } catch { /* per-feed; keep going */ }
        }
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => { (async () => {
    try {
      const rr = await window.storage.get(SK);
      if (!rr?.value) return;
      let parsed = JSON.parse(rr.value);
      // One-time migration: older readToday saved composed text with
      // [H:MM PM] prefixes baked into dayDesc, which leaked into the
      // Journal tab as ugly bracketed timestamps inside the entry body.
      // Source is now fixed (composed.plain), but existing entries need
      // a one-pass cleanup. Idempotent — only writes back if anything
      // actually changed.
      if (Array.isArray(parsed)) {
        let changed = false;
        const stripPrefixes = (txt) => {
          if (typeof txt !== "string" || !txt) return txt;
          return txt
            .split(/\n\n+/)
            .map(p => p.replace(/^\[\d{1,2}:\d{2}\s*(?:AM|PM)(?:\s*·\s*[a-z ]+)?\]\s*/i, ""))
            .join("\n\n");
        };
        parsed = parsed.map(e => {
          if (!e || typeof e.dayDesc !== "string") return e;
          const cleaned = stripPrefixes(e.dayDesc);
          if (cleaned !== e.dayDesc) { changed = true; return { ...e, dayDesc: cleaned }; }
          return e;
        });
        setHistory(parsed);
        if (changed) {
          try { await window.storage.set(SK, JSON.stringify(parsed)); } catch { /* quota — non-fatal */ }
        }
      } else {
        setHistory(parsed);
      }
    } catch (e) { /* parse / storage failures — leave history as the initial empty array */ }
  })(); }, []);

  // Auto-refresh every 15 min + on window focus + ONCE immediately on
  // mount. The mount tick is what makes the PWA feel like the Oura app
  // itself: opening it pulls fresh data rather than showing the state
  // from whenever the user last synced manually. After any successful
  // sync we push the freshest biometrics into React state and dispatch
  // `cpi:wearable-synced` so subordinate panels can re-read from storage
  // without a full reload.
  useEffect(() => {
    const REFRESH_MS = 15 * 60 * 1000;
    const MOUNT_MIN_AGE_MS = 2 * 60 * 1000; // only fire mount-tick if >2m since last sync
    const IDLE_MIN_AGE_MS = 10 * 60 * 1000; // normal tick threshold

    const tick = async (fromMount = false) => {
      try {
        const s = localStorage.getItem(BIOMETRICS_KEY);
        if (s) setBiometrics(JSON.parse(s));
      } catch { /* ignore */ }

      const token = localStorage.getItem(OURA_ACCESS_KEY);
      const lastSync = localStorage.getItem(OURA_LAST_SYNC_KEY);
      const age = lastSync ? Date.now() - new Date(lastSync).getTime() : Infinity;
      const threshold = fromMount ? MOUNT_MIN_AGE_MS : IDLE_MIN_AGE_MS;
      if (token && age > threshold) {
        try {
          const { start, end } = ouraSyncWindow();
          // Read mode at call time: this effect is mount-scoped so the
          // closure captures the initial mode value. localStorage is the
          // source of truth for current mode.
          const currentMode = (typeof localStorage !== "undefined" && localStorage.getItem(MODE_KEY)) || "full";
          const res = await fetchOuraRange(token, start, end, () => {}, { mode: currentMode });
          if (res?.connected && res.historyMap) {
            let map = {};
            try { const raw = localStorage.getItem(OURA_HISTORY_KEY); if (raw) map = JSON.parse(raw); } catch { /* ignore */ }
            map = mergeOuraHistory(map, res.historyMap);
            localStorage.setItem(OURA_HISTORY_KEY, JSON.stringify(map));
            localStorage.setItem(OURA_LAST_SYNC_KEY, new Date().toISOString());
            recordOuraHwm();
            // Push the freshest day into React state + tell panels to re-read.
            // CRITICAL: preserve any manual override fields the user typed in
            // (manualSleepMin / manualSleepQual / manualReadiness / manualSleep).
            // biometricsFromDayEntry only knows the Oura/Apple shape — without
            // this merge, every page refresh wipes the user's manual entry.
            const latest = pickLatestMeaningfulDay(map);
            if (latest) {
              const bio = biometricsFromDayEntry(latest);
              if (bio) {
                let preserved = {};
                try {
                  const prev = JSON.parse(localStorage.getItem(BIOMETRICS_KEY) || "null");
                  if (prev) {
                    for (const k of ["manualSleepMin", "manualSleepQual", "manualReadiness", "manualSleep"]) {
                      if (prev[k] != null) preserved[k] = prev[k];
                    }
                  }
                } catch { /* ignore */ }
                const merged = { ...bio, ...preserved };
                setBiometrics(merged);
                try { localStorage.setItem(BIOMETRICS_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
              }
            }
            window.dispatchEvent(new CustomEvent("cpi:wearable-synced"));
          }
        } catch { /* silent */ }
      }

      // Apple Health native delta sync — iOS only. Mirrors the Oura flow:
      // pull the delta window, merge, push the freshest day into biometrics,
      // dispatch wearable-synced. Same age-gate threshold prevents the
      // sync from firing on every tab focus.
      if (AppleHealth.isAvailable() && localStorage.getItem("apple_health_granted") === "true") {
        const lastAhSync = localStorage.getItem("cpi_ah_last_sync");
        const ahAge = lastAhSync ? Date.now() - new Date(lastAhSync).getTime() : Infinity;
        if (ahAge > threshold) {
          try {
            const { start, end } = ahSyncWindow();
            const result = await AppleHealth.appleHealthAggregateRange({ start, end });
            if (result?.entries?.length) {
              const merged = mergeAppleHealthIntoHistory(result.entries);
              recordAhHwm();
              localStorage.setItem("cpi_ah_last_sync", new Date().toISOString());
              if (merged.latestDay) {
                const bio = biometricsFromDayEntry(merged.latestDay);
                if (bio) {
                  let preserved = {};
                  try {
                    const prev = JSON.parse(localStorage.getItem(BIOMETRICS_KEY) || "null");
                    if (prev) {
                      for (const k of ["manualSleepMin", "manualSleepQual", "manualReadiness", "manualSleep"]) {
                        if (prev[k] != null) preserved[k] = prev[k];
                      }
                    }
                  } catch { /* ignore */ }
                  const finalBio = { ...bio, ...preserved };
                  setBiometrics(finalBio);
                  try { localStorage.setItem(BIOMETRICS_KEY, JSON.stringify(finalBio)); } catch { /* ignore */ }
                }
              }
              window.dispatchEvent(new CustomEvent("cpi:wearable-synced"));
            }
          } catch { /* silent — same fail-quiet pattern as Oura */ }
        }
      }

      setRefreshTick((n) => n + 1);
    };

    tick(true); // immediate on mount

    // When history is mutated (sync OR clear), re-read biometrics from
    // storage so the rings + ORI insight text on the top of the page
    // reflect the change. This handles the clear path specifically:
    // after a clear, BIOMETRICS_KEY is gone, so we drop state to null
    // and the rings recompute empty. Without this, the main app held
    // cached biometrics in state independently of what Settings did.
    const onStorageMutation = () => {
      try {
        const s = localStorage.getItem(BIOMETRICS_KEY);
        setBiometrics(s ? JSON.parse(s) : null);
      } catch { setBiometrics(null); }
      setRefreshTick((n) => n + 1);
    };
    window.addEventListener("cpi:wearable-synced", onStorageMutation);

    const interval = setInterval(() => tick(false), REFRESH_MS);
    const onFocus = () => tick(false);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("cpi:wearable-synced", onStorageMutation);
    };
  }, []);
  const save = useCallback(async h => { try { await window.storage.set(SK, JSON.stringify(h)); } catch (e) {} }, []);

  const [analysisError, setAnalysisError] = useState(null);
  const [plantedFlash, setPlantedFlash] = useState(false);

  // Reflect-mode seed plant — saves the day's text into the journal repo
  // (the bucket) without firing any AI analysis. Combines dayDesc + lingering
  // into a single seed so the user's full thought is captured in one entry.
  const plantSeed = () => {
    const text = dayDesc.trim();
    const ling = lingering.trim();
    if (!text && !ling) return;
    const combined = ling ? (text ? `${text}\n\n${ling}` : ling) : text;
    // Save under transcription + rawText (the canonical fields the reader and
    // the AI analyzer both look for). Earlier this saved as `text:` — that
    // field is invisible to GpReader and to engine seed-aggregation, so seeds
    // looked "almost blank" on tap and were silently dropped from analysis.
    repoAdd({
      // Local-aware YMD via ymdISO (not toISOString.slice — that returns UTC,
      // which pushes evening writers' seeds into "tomorrow" once the wall
      // clock crosses 5pm PDT / 4pm PST).
      date: ymdISO(new Date()),
      source: "checkin",
      transcription: combined,
      rawText: combined,
      uploadedAt: new Date().toISOString(),
      createdAt: Date.now(),
    });
    setDayDesc("");
    setLingering("");
    setPlantedFlash(true);
    setTimeout(() => setPlantedFlash(false), 2800);
  };

  // Compose today's journal seeds into a single prose block the analyzer can
  // read. Used by Reflect mode's "Read today" button. Each seed is prefixed
  // with its local time so Claude can reason about the day's arc — when the
  // user wrote, how long between seeds, etc.
  //
  // Loaded fresh from the repo at call time so a seed added a second ago
  // (in the Journal tab) is included without requiring a parent state refresh.
  const composeTodaySeeds = () => {
    const todayKey = ymdISO(new Date());
    let entries = [];
    try { entries = (loadRepo()?.entries || []).filter(e => journalEntryCoversDay(e, todayKey)); } catch { /* ignore */ }
    // Sort oldest to newest by createdAt (or uploadedAt fallback) so the
    // narrative arc reads forward.
    entries.sort((a, b) => (a.createdAt || new Date(a.uploadedAt || 0).getTime()) - (b.createdAt || new Date(b.uploadedAt || 0).getTime()));
    // Build two parallel forms:
    //   • `prefixed` — what Claude sees, with [H:MM PM] markers so the
    //     model can reason about the day's arc.
    //   • `plain`    — what we store in the user-facing history check-in
    //     and later show in the Journal tab. No timestamps baked into
    //     the body. Keeps the journal view clean (each seed already has
    //     its own date+time in its row metadata).
    const prefixed = [];
    const plain = [];
    for (const s of entries) {
      const ts = s.createdAt
        ? new Date(s.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : null;
      const txt = String(s.text || s.transcription || s.rawText || "").trim();
      if (!txt) continue;
      prefixed.push(ts ? `[${ts}] ${txt}` : txt);
      plain.push(txt);
    }
    // Append anything the user has typed in the Analyze textarea right now —
    // they may be writing a final reflection before tapping "Read today."
    const fresh = dayDesc.trim();
    if (fresh) {
      const now = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      prefixed.push(`[${now} · just now] ${fresh}`);
      plain.push(fresh);
    }
    return {
      text: prefixed.join("\n\n"),    // for the analyzer
      plain: plain.join("\n\n"),      // for storage + journal display
      seedCount: prefixed.length,
    };
  };

  // Reflect-mode: read today's seeds together. Same analyzer, different input.
  // Mirrors `analyze()` but composes the input from journal seeds + textarea
  // rather than the textarea alone. Reuses the entire result pipeline so the
  // letter, the keeper, and the chip taps all work without new wiring.
  const readToday = async () => {
    // Fold in-flight speech in first (interim + any batch-fallback window) so
    // the composed seeds include the user's closing words. Mirrors analyze().
    const dayLate = await dayVoice.flushPending?.();
    if (dayLate || dayVoice.interim) setDayDesc((prev) => `${prev || ''} ${dayVoice.interim || ''} ${dayLate || ''}`.replace(/\s+/g, ' ').trim());
    const composed = composeTodaySeeds();
    if (!composed.text) return;
    if (dayVoice.listening) dayVoice.toggle();
    if (lingVoice.listening) lingVoice.toggle();
    setLoading(true);
    setAnalysisError(null);
    const stage = (label, model) => setAnalysisStage({ label, model, startedAt: Date.now() });
    try {
      stage("Gathering today's seeds", null);
      const todayE = getTodayEntries(history);
      const effectiveWake = todayE.length > 0 && todayE[todayE.length - 1].wakeTime ? todayE[todayE.length - 1].wakeTime : wakeTime;
      const wH = parseInt(effectiveWake.split(":")[0]) + parseInt(effectiveWake.split(":")[1]) / 60;
      const tc = getTimeContext();
      let ouraHistoryMap = null;
      try { const raw = localStorage.getItem(OURA_HISTORY_KEY); if (raw) ouraHistoryMap = JSON.parse(raw); } catch { /* ignore */ }
      const todayDate = new Date().toISOString().split("T")[0];
      const biometricTrends = ouraHistoryMap ? computeBiometricTrends(ouraHistoryMap, todayDate) : null;

      stage("Reading your day", ANTHROPIC_MODEL);
      const a = await analyzeWithClaude(composed.text, "", history, biometricTrends, biometrics, lifestyle, { mode });

      stage("Composing tonight's reading", null);
      // Inject Sleep Regularity Index (Phillips 2017) into biometrics so
      // computeE0 can apply the SRI multiplier. trends.sri is computed from
      // bedtimeStart/bedtimeEnd minute-level agreement over the rolling
      // 14-day window upstream.
      const bioWithSri = {
        ...biometrics,
        sri7d: biometricTrends?.sri ?? biometrics?.sri7d ?? null,
        sleepDebt7d: biometricTrends?.sleepDebtH ?? biometrics?.sleepDebt7d ?? null,
      };
      const h = computeHCPI(wH, a, history, bioWithSri, lifestyle, chronotype);
      // dayDesc stores the user-facing text shown in the Journal tab —
      // use the plain (un-prefixed) version. The prefixed `composed.text`
      // only existed to help Claude reason about the day's arc above;
      // baking [H:MM PM] markers into the journal display is ugly.
      const entry = { date: new Date().toISOString(), analysisVersion: ANALYSIS_VERSION, wakeTime: effectiveWake, period: tc.period, checkInNum: todayE.length + 1, dayDesc: (composed.plain || composed.text).substring(0, 600), hcpi: h.HCPI, params: { S: a.S, C: a.C, mu: a.mu, psi: a.psi, W: a.W, L: a.L }, drivers: a.driverScores, E0: h.E0, recentStrain: h.recentStrain, lambda: h.lambda, chronotype, decisionCount: a.decisionCount, lingeringDriver: a.lingeringDriver || null, sourceMode: mode, seedCount: composed.seedCount, letterParts: Array.isArray(a?.letter?.parts) ? a.letter.parts.map(p => ({ id: p?.id, volume: p?.volume })).filter(p => p.id) : null, anonId: getOrCreateAnonId(), ageAtEntry: getUserAge(), bioSnapshot: buildEntrySnapshot(bioWithSri, biometricTrends) };
      const nH = [entry, ...history].slice(0, 200);
      setHistory(nH); await save(nH);
      setResult({ a, h });
      try {
        const todayKey = ymdISO(new Date());
        const stored = JSON.stringify({ date: todayKey, result: { a, h } });
        localStorage.setItem("cpi_last_reading", stored);
        localStorage.setItem(`cpi_letter_${todayKey}`, stored);
        // Tell any open Journal tab to drop its "letter brewing" placeholder.
        // Same-tab writes don't fire the `storage` event, so this custom
        // event is the only signal Journal gets in the current window.
        window.dispatchEvent(new Event("cpi:letter-written"));
      } catch { /* ignore */ }
      setView("result");
      setDayDesc("");
      setLingering("");

      // Fire-and-forget reliability probe (24h debounced inside the helper).
      // Re-runs analyze on the same composed seeds, compares parts via Jaccard,
      // logs to localStorage. One extra Anthropic call per day max.
      if (shouldRunReliabilityProbe()) {
        const primaryLetterParts = Array.isArray(a?.letter?.parts) ? a.letter.parts : [];
        runReliabilityProbe({
          composedText: composed.text,
          lingering: "",
          history,
          biometricTrends,
          biometrics,
          lifestyle,
          primaryLetterParts,
          mode,
          seedCount: composed.seedCount,
        }).catch(() => { /* swallow — probe failures must not surface */ });
      }
    } catch (err) {
      setAnalysisError(err.message || "Couldn't compose tonight's reading — please retry");
    } finally {
      setLoading(false);
      setAnalysisStage(null);
    }
  };

  // ── Batch backfill: analyze imported journal days ─────────────
  // After an import, journal text lands on the calendar but no Claude
  // reading exists for those past days, so Patterns / You-tab stay
  // empty. The batch flow walks every imported day with writing but no
  // saved letter, calls analyzeWithClaude once per day in oldest →
  // newest order, and writes the result into history + cpi_letter_<ymd>
  // exactly the way live readToday would. Free tier processes the
  // most-recent 30 days; the rest are visible in the banner with a
  // "Coming soon · Premium" affordance.
  const [batchState, setBatchState] = useState({
    active: false, total: 0, completed: 0, currentYmd: null, errors: [],
  });
  // The full pitch lives inside a modal — the entry surface on the
  // Analyze tab is a small pill at the top. Keeps the import banner from
  // hijacking the whole screen while still giving the user a tap target
  // they can't miss.
  const [batchPopupOpen, setBatchPopupOpen] = useState(false);
  // Progress-strip presentation state. `minimized` collapses the strip
  // into a small floating badge so the user can keep reading the app
  // without the strip blocking content; tapping the badge expands it
  // again. `completedFlash` shows for ~5s after the batch finishes,
  // then the strip removes itself.
  const [batchStripMinimized, setBatchStripMinimized] = useState(false);
  const [batchCompletedFlash, setBatchCompletedFlash] = useState(false);
  // Snapshot of how many imported days still need a reading. Recomputed
  // on every refreshTick so the banner reappears after a fresh import
  // and disappears as the batch completes them.
  const unanalyzedDays = useMemo(() => {
    try { return findUnanalyzedDays(loadRepo()); } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick, history]);
  const freeWindowDays = useMemo(() => selectFreeWindow(unanalyzedDays), [unanalyzedDays]);
  const lockedRemainder = Math.max(0, unanalyzedDays.length - freeWindowDays.length);

  // Per-day backfill now lives in the shared runner (src/backfillRunner.js) so
  // the v2 free-30-day-read funnel writes the exact same letter + history shape.
  // This wrapper just binds v1's current context; behaviour is unchanged.
  const analyzeHistoricalDay = useCallback(
    (ymd, historySnapshot) => analyzeBackfillDay(
      ymd, historySnapshot, { biometrics, lifestyle, mode, wakeTime, chronotype },
    ),
    [biometrics, lifestyle, mode, wakeTime, chronotype],
  );

  const runBatch = useCallback(async () => {
    if (batchState.active) return;
    if (freeWindowDays.length === 0) return;
    const days = [...freeWindowDays];
    setBatchState({ active: true, total: days.length, completed: 0, currentYmd: null, errors: [] });
    setBatchStripMinimized(false);
    setBatchCompletedFlash(false);

    // Pre-batch history snapshot — every worker reads from this same
    // baseline so they don't see each other's outputs (which is fine
    // for backfill, see BATCH_CONCURRENCY rationale in batch-analyze.js).
    const historySnapshot = [...history];

    // Simple worker pool. We use a shared cursor `next` so each free
    // worker grabs the next pending day. completedEntries collects
    // results in completion order — the final merge re-sorts by date.
    const completedEntries = [];
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= days.length) return;
        const ymd = days[i];
        setBatchState(s => ({ ...s, currentYmd: ymd }));
        try {
          const entry = await analyzeHistoricalDay(ymd, historySnapshot);
          if (entry) {
            completedEntries.push(entry);
            window.dispatchEvent(new Event("cpi:letter-written"));
          }
        } catch (err) {
          setBatchState(s => ({
            ...s,
            errors: [...s.errors, { ymd, message: err?.message || "Unknown error" }],
          }));
        }
        setBatchState(s => ({ ...s, completed: s.completed + 1 }));
      }
    };

    const workers = Array.from({ length: Math.min(BATCH_CONCURRENCY, days.length) }, () => worker());
    await Promise.all(workers);

    // Bulk-merge into history once everything has settled. Functional
    // setHistory is what makes this safe even if other code raced —
    // we always rebuild from the latest committed state.
    setHistory(prev => {
      const merged = [...completedEntries, ...prev]
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 200);
      // Persist once, with the merged result. Best-effort — quota
      // errors should not blow up the success path.
      save(merged).catch(() => { /* swallow */ });
      return merged;
    });

    setBatchState(s => ({ ...s, active: false, currentYmd: null }));
    setBatchCompletedFlash(true);
    // The success flash auto-dismisses after a few seconds so the
    // strip isn't permanently glued to the bottom once the work is
    // done. The pill goes away on its own because unanalyzedDays
    // recomputes against the freshly-written letters.
    setTimeout(() => setBatchCompletedFlash(false), 5000);
    setRefreshTick(n => n + 1);
  }, [batchState.active, freeWindowDays, history, analyzeHistoricalDay]);

  // ── Weekly reading ─────────────────────────────────────────────
  // Aggregates last 7 days of seeds + each day's letter headlines,
  // then asks Claude for a synthesizing week's letter. Uses the same
  // letter schema; the week framing comes from a hint in the user
  // text. Persists to cpi_week_letter_<isoweekKey>. Fires automatically
  // after Sunday's daily reading; can also be triggered manually from
  // the WeeklyReadingCard.
  const composeWeekSeeds = () => {
    const repo = (() => { try { return loadRepo() || { entries: [] }; } catch { return { entries: [] }; } })();
    const out = [];
    const today = new Date();
    let totalSeeds = 0;
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const ymd = ymdISO(d);
      const dayLabel = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      days.push({ ymd, dayLabel });

      // Seeds for this day
      const daySeeds = (repo.entries || []).filter(s => stampMatchesDay(s?.uploadedAt || s?.date, ymd));
      // Daily letter for this day
      let letterHeadline = null;
      let letterParts = [];
      try {
        const raw = localStorage.getItem(`cpi_letter_${ymd}`);
        if (raw) {
          const stored = JSON.parse(raw);
          letterHeadline = stored?.result?.a?.letter?.headline || null;
          letterParts = Array.isArray(stored?.result?.a?.letter?.parts)
            ? stored.result.a.letter.parts.map(p => p?.id).filter(Boolean)
            : [];
        }
      } catch { /* ignore */ }

      if (daySeeds.length === 0 && !letterHeadline) continue;
      const partsLine = letterParts.length ? ` · parts visited: ${letterParts.join(", ")}` : "";
      const headlineLine = letterHeadline ? ` · headline: "${letterHeadline}"` : "";
      const seedTexts = daySeeds.map(s => (s?.text || s?.body || "").toString().trim()).filter(Boolean);
      totalSeeds += seedTexts.length;
      out.push(`[${dayLabel}]${headlineLine}${partsLine}\n${seedTexts.join("\n— ")}`);
    }
    const range = days.length
      ? `${days[0].dayLabel} — ${days[days.length - 1].dayLabel}`
      : "the past week";
    const hint = `\n\n--- WEEKLY READING ---\nThis text spans 7 days, not 1. Synthesize the WEEK as a whole — the throughlines, the rhythms, the parts that recurred. The headline should name the week's character. Paragraphs should weave longitudinal observations ("On days the maker was loud, your sleep ran longer the night before"). Parts should reflect who recurred — note their pattern across days, not within one day. Use the same gentle IFS-soft voice.`;
    return { text: out.join("\n\n") + hint, range, seedCount: totalSeeds };
  };

  const readWeek = async () => {
    const composed = composeWeekSeeds();
    if (!composed.text || !composed.text.includes("[")) return; // empty week
    setLoading(true);
    setAnalysisError(null);
    const stage = (label, model) => setAnalysisStage({ label, model, startedAt: Date.now() });
    try {
      stage("Gathering this week", null);
      let ouraHistoryMap = null;
      try { const raw = localStorage.getItem(OURA_HISTORY_KEY); if (raw) ouraHistoryMap = JSON.parse(raw); } catch { /* ignore */ }
      const todayDate = new Date().toISOString().split("T")[0];
      const biometricTrends = ouraHistoryMap ? computeBiometricTrends(ouraHistoryMap, todayDate) : null;

      stage("Reading your week", ANTHROPIC_MODEL);
      const a = await analyzeWithClaude(composed.text, "", history, biometricTrends, biometrics, lifestyle, { mode });
      // Reuse computeHCPI for completeness, even though weekly h is not
      // surfaced to the user — keeps result shape parallel to daily.
      const wH = parseInt(wakeTime.split(":")[0]) + parseInt(wakeTime.split(":")[1]) / 60;
      const bioWithSri = {
        ...biometrics,
        sri7d: biometricTrends?.sri ?? biometrics?.sri7d ?? null,
        sleepDebt7d: biometricTrends?.sleepDebtH ?? biometrics?.sleepDebt7d ?? null,
      };
      const h = computeHCPI(wH, a, history, bioWithSri, lifestyle, chronotype);

      const weekKey = isoWeekKey(new Date());
      try {
        localStorage.setItem(`cpi_week_letter_${weekKey}`, JSON.stringify({
          weekKey, range: composed.range, seedCount: composed.seedCount,
          result: { a, h },
        }));
      } catch { /* ignore */ }

      // Show the week's letter immediately by routing through the
      // standard result view, same as the daily.
      setResult({ a, h });
      setView("result");
    } catch (err) {
      setAnalysisError(err.message || "Couldn't compose this week's reading — please retry");
    } finally {
      setLoading(false);
      setAnalysisStage(null);
    }
  };
  const readWeekRef = useRef(null);
  readWeekRef.current = readWeek;

  // Auto-scheduler: in Reflect mode, when winding time arrives and the
  // user hasn't read today yet, compose tonight's reading without waiting
  // for a button press. Conditions (all required):
  //   · mode === "reflect"
  //   · view === "input" (not currently reading or loading)
  //   · now ≥ reflect time today (default 9 PM)
  //   · seeds exist today
  //   · today has no reading yet
  //   · textarea is empty (don't interrupt active writing)
  // Checks once on mount + every 60s. The hasReadingToday check itself is
  // self-limiting — once readToday() lands a new history entry, the next
  // tick short-circuits and the timer becomes a no-op.
  const readTodayRef = useRef(null);
  readTodayRef.current = readToday;
  useEffect(() => {
    if (mode !== "reflect" || view !== "input") return undefined;
    const tryFire = () => {
      if (loading) return;
      if (dayDesc.trim() || lingering.trim()) return;
      const todayKey = ymdISO(new Date());
      // Storage-first guard. Reading state alone is unreliable in the
      // iOS WebView: when readToday() finishes and we synchronously
      // reset() back to view="input", this effect re-fires before
      // setHistory() has flushed through React's scheduler, so the
      // `history` closure may still hold the pre-save snapshot. The
      // `cpi_last_reading` localStorage key is written synchronously
      // INSIDE the same analyze() that does setHistory, so checking
      // it is always definitive — if today's reading was saved, this
      // returns the truth no matter when the effect re-evaluates.
      try {
        const lastReadingRaw = localStorage.getItem("cpi_last_reading");
        if (lastReadingRaw) {
          const parsed = JSON.parse(lastReadingRaw);
          if (parsed?.date === todayKey) return;
        }
      } catch { /* fall through to state-based check below */ }
      if ((history || []).some(e => stampMatchesDay(e?.date, todayKey))) return;
      const raw = localStorage.getItem(REFLECT_TIME_KEY) || "21:00";
      const m = String(raw).match(/^(\d{1,2}):(\d{2})$/);
      const reflectMinutes = m ? Number(m[1]) * 60 + Number(m[2]) : 21 * 60;
      const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
      if (nowMinutes < reflectMinutes) return;
      let seedsToday = 0;
      try { seedsToday = (loadRepo()?.entries || []).filter(e => journalEntryCoversDay(e, todayKey)).length; } catch { /* ignore */ }
      if (seedsToday === 0) return;
      readTodayRef.current?.();
    };
    tryFire();
    const id = setInterval(tryFire, 60000);
    return () => clearInterval(id);
  }, [mode, view, loading, dayDesc, lingering, history]);

  // Re-focus the journal textarea whenever we land back on the input
  // view. Fixes the iOS WKWebView issue where keystrokes are dropped
  // after the textarea is unmounted (view="result") and remounted
  // (view="input" again after "Add a line" or Plant). On web this is
  // an idempotent no-op.
  useEffect(() => {
    if (view !== "input" || loading) return;
    const el = dayTextareaRef.current;
    if (!el) return;
    // requestAnimationFrame defers until after the textarea actually
    // paints — calling .focus() during render in iOS can target a stale
    // DOM node and silently fail.
    const id = requestAnimationFrame(() => {
      try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
    });
    return () => cancelAnimationFrame(id);
  }, [view, loading]);

  // Keep the screen on while the app is in the foreground. iOS dims the
  // screen aggressively after ~30s of no touch, which interrupts users
  // mid-thought during a Reflect session. The Screen Wake Lock API
  // (supported in iOS 16.4+ WKWebView and in Chromium-based browsers)
  // prevents the system display sleep timer while the page is visible.
  // iOS automatically releases the lock on visibility=hidden (phone
  // lock, app switch, incoming call), so we re-request on every return
  // to foreground. The wake lock has no battery cost when nothing else
  // is running — it only matters relative to the idle-sleep timer.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock = null;
    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      try { lock = await navigator.wakeLock.request("screen"); }
      catch { /* user may have denied, or system may be too low-power */ }
    };
    const onVisChange = () => {
      // Lock is auto-released on hidden; nothing for us to do until
      // the user is back. On visible, re-request.
      if (document.visibilityState === "visible") acquire();
    };
    acquire();
    document.addEventListener("visibilitychange", onVisChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      if (lock) { try { lock.release(); } catch { /* ignore */ } }
    };
  }, []);

  const analyze = async () => {
    if (!dayDesc.trim()) return;
    // Fold not-yet-final speech in before stopping the mics (matches the v2
    // surfaces): the interim phrase and any batch-fallback window still in
    // flight are real words the user expects analyzed.
    const dayLate = await dayVoice.flushPending?.();
    const lingLate = await lingVoice.flushPending?.();
    const dayText = `${dayDesc} ${dayVoice.interim || ''} ${dayLate || ''}`.replace(/\s+/g, ' ').trim();
    const lingText = `${lingering || ''} ${lingVoice.interim || ''} ${lingLate || ''}`.replace(/\s+/g, ' ').trim();
    if (dayText !== dayDesc) setDayDesc(dayText);
    if (lingText !== (lingering || '')) setLingering(lingText);
    if (dayVoice.listening) dayVoice.toggle();
    if (lingVoice.listening) lingVoice.toggle();
    setLoading(true);
    setAnalysisError(null);
    const stage = (label, model) => setAnalysisStage({ label, model, startedAt: Date.now() });
    try {
      stage("Gathering context", null);
      const todayE = getTodayEntries(history);
      const effectiveWake = todayE.length > 0 && todayE[todayE.length - 1].wakeTime ? todayE[todayE.length - 1].wakeTime : wakeTime;
      saveLastWake(effectiveWake);
      const wH = parseInt(effectiveWake.split(":")[0]) + parseInt(effectiveWake.split(":")[1]) / 60;
      const tc = getTimeContext();
      let ouraHistoryMap = null;
      try { const raw = localStorage.getItem(OURA_HISTORY_KEY); if (raw) ouraHistoryMap = JSON.parse(raw); } catch { /* ignore */ }
      const todayDate = new Date().toISOString().split("T")[0];
      const biometricTrends = ouraHistoryMap ? computeBiometricTrends(ouraHistoryMap, todayDate) : null;

      stage("Reading your entry", ANTHROPIC_MODEL);
      const a = await analyzeWithClaude(dayText, lingText, history, biometricTrends, biometrics, lifestyle, { mode });

      stage("Computing today's reading", null);
      const bioWithSri = {
        ...biometrics,
        sri7d: biometricTrends?.sri ?? biometrics?.sri7d ?? null,
        sleepDebt7d: biometricTrends?.sleepDebtH ?? biometrics?.sleepDebt7d ?? null,
      };
      const h = computeHCPI(wH, a, history, bioWithSri, lifestyle, chronotype);
      const entry = { date: new Date().toISOString(), wakeTime: effectiveWake, period: tc.period, checkInNum: todayE.length + 1, dayDesc: dayText.substring(0, 300), hcpi: h.HCPI, params: { S: a.S, C: a.C, mu: a.mu, psi: a.psi, W: a.W, L: a.L }, drivers: a.driverScores, E0: h.E0, recentStrain: h.recentStrain, lambda: h.lambda, chronotype, decisionCount: a.decisionCount, lingeringDriver: a.lingeringDriver || null, letterParts: Array.isArray(a?.letter?.parts) ? a.letter.parts.map(p => ({ id: p?.id, volume: p?.volume })).filter(p => p.id) : null, anonId: getOrCreateAnonId(), ageAtEntry: getUserAge(), bioSnapshot: buildEntrySnapshot(bioWithSri, biometricTrends) };
      const nH = [entry, ...history].slice(0, 200);
      setHistory(nH); await save(nH);
      setResult({ a, h });
      try {
        const todayKey = ymdISO(new Date());
        const stored = JSON.stringify({ date: todayKey, result: { a, h } });
        localStorage.setItem("cpi_last_reading", stored);
        localStorage.setItem(`cpi_letter_${todayKey}`, stored);
        // Tell any open Journal tab to drop its "letter brewing" placeholder.
        // Same-tab writes don't fire the `storage` event, so this custom
        // event is the only signal Journal gets in the current window.
        window.dispatchEvent(new Event("cpi:letter-written"));
      } catch { /* ignore */ }
      setView("result");
    } catch (err) {
      setAnalysisError(err.message || "Analysis failed — please retry");
    } finally {
      setLoading(false);
      setAnalysisStage(null);
    }
  };

  const reset = () => { setDayDesc(""); setLingering(""); setResult(null); setView("input"); setTab("analyze"); };
  const insColors = { positive: g, negative: r, warning: y, info: "var(--ac)" };
  const insIcons = { positive: "↑", negative: "↓", warning: "△", info: "→" };

  // First-run gate. Records garden name / reflect time / mode from the
  // welcome flow, then unmounts the opener. If the user picked Oura or
  // Apple Health, we also flip MODE_KEY to "full" and open the Integrations
  // panel on next render so they land straight in the connect flow.
  const completeWelcome = (data) => {
    try {
      if (data?.gardenName) localStorage.setItem(GARDEN_NAME_KEY, data.gardenName);
      if (data?.reflectTime) localStorage.setItem(REFLECT_TIME_KEY, data.reflectTime);
      // Persist the self-reported sleep window from onboarding. The Patterns
      // tab's chronotype + peak-window aggregators read this as a fallback
      // when device data (Oura, Apple Health) is sparse or absent.
      if (data?.sleepWindow && typeof data.sleepWindow.bedtimeMin === "number" && typeof data.sleepWindow.wakeMin === "number") {
        localStorage.setItem(SLEEP_WINDOW_KEY, JSON.stringify({
          bedtimeMin: data.sleepWindow.bedtimeMin,
          wakeMin: data.sleepWindow.wakeMin,
          updatedAt: new Date().toISOString(),
        }));
      }
      const nextMode = data?.mode === "reflect" ? "reflect" : "full";
      localStorage.setItem(MODE_KEY, nextMode);
      setMode(nextMode);
      localStorage.setItem(WELCOME_DONE_KEY, "1");
    } catch { /* ignore */ }
    setWelcomeDone(true);
    if (data?.mode === "oura" || data?.mode === "apple") {
      setTimeout(() => setIntegrationsOpen(true), 700);
    }
  };

  // Preview-frame mode: when the URL has `?frame=phone`, render the whole
  // app inside an iPhone-14-Pro-shaped frame (393×852) centered on a dark
  // background. Lets us iterate the mobile design ON the website prototype
  // (talk-to-me.ideaflow.page) without forcing the main URL into a phone-
  // shape. Compare the two URLs side-by-side until the design is right,
  // then port the styles into the default render.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('frame') !== 'phone') return;
    const prev = {
      body: document.body.getAttribute('style') || '',
      root: document.getElementById('root')?.getAttribute('style') || '',
    };
    document.body.setAttribute('style', `
      margin: 0; padding: 20px 0; min-height: 100vh;
      background: #0a0d0b;
      display: flex; justify-content: center; align-items: flex-start;
    `);
    const rootEl = document.getElementById('root');
    if (rootEl) {
      rootEl.setAttribute('style', `
        width: 393px;
        min-height: 852px;
        max-height: calc(100vh - 40px);
        overflow-y: auto;
        border-radius: 54px;
        background: #F7F3EC;
        box-shadow: 0 0 0 1px #2a3a2b, 0 22px 50px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.04);
        -webkit-overflow-scrolling: touch;
      `);
    }
    return () => {
      document.body.setAttribute('style', prev.body);
      if (rootEl) rootEl.setAttribute('style', prev.root);
    };
  }, []);

  if (!welcomeDone) {
    return <WelcomeGarden onComplete={completeWelcome} />;
  }

  return (
    <div style={{ "--bg": "#F7F3EC", "--fg": "#2B2824", "--mt": "#958E84", "--ln": "rgba(45,42,36,0.09)", "--cd": "rgba(255,252,246,0.7)", "--sf": "#FFFCF6", "--ac": "#7D92AE", "--body": "#94B79A", "--mind": "#9DB2C9", "--mood": "#E8A898", "--good": "#4F8A5F", "--warn": "#C4902A", "--alert": "#B0553A", "--fd": "'Playfair Display',Georgia,serif", "--fb": "'Source Serif 4',Georgia,serif", "--fm": "'DM Mono','Courier New',monospace", "--fn": "'Inter',system-ui,-apple-system,sans-serif", fontFamily: "var(--fb)", background: "var(--bg)", color: "var(--fg)", minHeight: "100vh" }}>
      <LlmFloatingPill stage={analysisStage} visible={loading && !!analysisStage} />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@300;400;500;600;700&family=Source+Serif+4:wght@300;400;500;600&family=DM+Mono:wght@300;400;500&family=Inter:wght@400;500;600;700&display=swap');
        @keyframes cen{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        .ca{animation:cen .65s ease-out both}
        .d1{animation-delay:.1s}.d2{animation-delay:.2s}.d3{animation-delay:.3s}.d4{animation-delay:.4s}.d5{animation-delay:.5s}.d6{animation-delay:.6s}.d7{animation-delay:.7s}.d8{animation-delay:.8s}
        @keyframes cbr{0%,100%{opacity:.3}50%{opacity:1}}
        input:focus,textarea:focus{border-color:var(--ac)!important;outline:none}
        textarea::placeholder,input::placeholder{color:rgba(0,0,0,.18)}
        button{cursor:pointer}button:active{transform:scale(.98)}
        input[type="range"]{height:3px}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(0,0,0,.08);border-radius:2px}
      `}</style>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "40px 24px calc(56px + env(safe-area-inset-bottom))", position: "relative" }}>

        {/* Gear icon — opens Settings (the new Phase 3 index) */}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          title="Settings"
          style={{
            position: "absolute", top: 30, right: 16,
            width: 44, height: 44, borderRadius: "50%",
            background: "transparent", border: "1px solid var(--ln)",
            color: "var(--mt)", cursor: "pointer", padding: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, zIndex: 10,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        <GardenKeeper
          open={keeperOpen}
          result={result}
          history={history}
          confirmations={confirmations}
          onConfirm={handlePartConfirmation}
          onClose={() => setKeeperOpen(false)}
        />

        <Settings
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          history={history}
          metToday={(() => {
            const today = ymdISO(new Date());
            const todayEntry = (history || []).find(e => stampMatchesDay(e?.date, today));
            return Array.isArray(todayEntry?.letterParts) ? todayEntry.letterParts.length : 0;
          })()}
          seedsToday={(() => {
            try {
              const todayKey = ymdISO(new Date());
              const repo = loadRepo() || { entries: [] };
              return (repo.entries || []).filter(s => stampMatchesDay(s?.uploadedAt || s?.date, todayKey)).length;
            } catch { return 0; }
          })()}
          mode={mode}
          onModeChange={(next) => { setMode(next); try { localStorage.setItem(MODE_KEY, next); } catch { /* ignore */ } }}
          onJumpReflect={() => { setMode("reflect"); try { localStorage.setItem(MODE_KEY, "reflect"); } catch { /* ignore */ } setTab("analyze"); setView("input"); }}
          onJumpKeeper={() => { setKeeperOpen(true); }}
          onJumpJournal={() => { setTab("journal"); }}
          onManageWearable={() => { setSettingsOpen(false); setIntegrationsOpen(true); }}
        />

        {integrationsOpen && <IntegrationsPanel
          onClose={() => setIntegrationsOpen(false)}
          setBiometrics={setBiometrics}
          mode={mode}
          onModeChange={(next) => { setMode(next); try { localStorage.setItem(MODE_KEY, next); } catch { /* ignore */ } }}
          reflectLang={reflectLang}
          onReflectLangChange={onReflectLangChange}
          onResetEverything={() => {
            // Full wipe: reset every piece of main-app state that drives
            // the dashboard, then bump resetTick so cached-state children
            // fully remount. `history` is the HCPI check-in timeline —
            // without resetting it here, the YOU-tab Efficiency card
            // keeps reading allostatic/hcpi averages from memory.
            setOuraToken(null);
            setBiometrics(null);
            setLifestyle({ hydration: 6, exercise: "none" });
            setHistory([]);
            setResetTick((n) => n + 1);
          }}
          onDataChanged={() => {
            // A sync (Oura connect/resync or Apple Health import) just
            // finished. Pull the fresh connection status into main state
            // and force a re-compute of todayTrends so every surface on
            // the first panel reflects the new data immediately.
            try {
              const tok = localStorage.getItem(OURA_ACCESS_KEY);
              setOuraToken(tok || null);
            } catch { /* ignore */ }
            setRefreshTick((n) => n + 1);
          }}
        />}

        {backfillBusy && (
          <div role="status" aria-live="polite" style={{
            position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
            zIndex: 10000,
            padding: "10px 16px",
            background: "var(--fg)", color: "var(--bg)",
            borderRadius: 999,
            fontFamily: "var(--fm)", fontSize: 11, letterSpacing: 1.2,
            textTransform: "uppercase",
            display: "flex", alignItems: "center", gap: 10,
            boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: "#94B79A",
              animation: "cbr 1.4s ease-in-out infinite",
            }} />
            Pulling sleep &amp; recovery history…
          </div>
        )}

        {/* Batch backfill progress strip — fixed near the bottom of the
            viewport so it persists across tab changes while the queue
            runs. The user can collapse it to a small floating badge so
            it stops covering the content; the badge re-expands on tap.
            On completion the strip flashes a short success message,
            then auto-dismisses. */}
        {batchState.active && !batchStripMinimized && (
          <div role="status" aria-live="polite" style={{
            position: "fixed", bottom: 96, left: 16, right: 16,
            zIndex: 9999,
            padding: "12px 16px",
            background: "var(--fg)", color: "var(--bg)",
            borderRadius: 14,
            boxShadow: "0 8px 24px rgba(0,0,0,0.20)",
            fontFamily: "var(--fb)", fontSize: 13, lineHeight: 1.4,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
              <span style={{ fontStyle: "italic", opacity: 0.95 }}>
                Ori is reading day {Math.min(batchState.completed + 1, batchState.total)} of {batchState.total}…
              </span>
              <button
                type="button"
                onClick={() => setBatchStripMinimized(true)}
                aria-label="Hide progress"
                style={{
                  width: 28, height: 28, borderRadius: 14,
                  border: "none", background: "rgba(255,255,255,0.12)",
                  color: "var(--bg)", cursor: "pointer", padding: 0,
                  display: "grid", placeItems: "center",
                  fontFamily: "var(--fm)", fontSize: 14, lineHeight: 1,
                }}
              >×</button>
            </div>
            <div style={{ height: 4, borderRadius: 999, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${(batchState.completed / Math.max(1, batchState.total)) * 100}%`,
                background: "#94B79A",
                transition: "width 320ms ease-out",
              }} />
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              marginTop: 6,
            }}>
              <span style={{ fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 0.8, opacity: 0.55 }}>
                You can keep using the app.
              </span>
              <span style={{ fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 1.2, opacity: 0.7 }}>
                {Math.round((batchState.completed / Math.max(1, batchState.total)) * 100)}%
              </span>
            </div>
          </div>
        )}

        {/* Minimized badge — tiny floating chip with the progress
            percentage. Out of the way of the content but always
            present so the user knows the batch is still going.
            Tapping it re-opens the full strip. */}
        {batchState.active && batchStripMinimized && (
          <button
            type="button"
            onClick={() => setBatchStripMinimized(false)}
            aria-label={`Reading progress: ${Math.round((batchState.completed / Math.max(1, batchState.total)) * 100)} percent`}
            style={{
              position: "fixed", bottom: 96, right: 16,
              zIndex: 9999,
              padding: "8px 12px", minHeight: 36, borderRadius: 999,
              background: "var(--fg)", color: "var(--bg)",
              border: "none", cursor: "pointer",
              boxShadow: "0 6px 16px rgba(0,0,0,0.20)",
              display: "inline-flex", alignItems: "center", gap: 8,
              fontFamily: "var(--fm)", fontSize: 11, letterSpacing: 1.2,
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: "50%", background: "#94B79A",
              animation: "cbr 1.6s ease-in-out infinite",
            }} />
            {batchState.completed}/{batchState.total}
          </button>
        )}

        {/* Completion flash — shown for ~5 seconds after the batch
            finishes so the user sees "done" without having to check.
            Auto-dismisses; pill on the Analyze tab already disappears
            on its own because unanalyzedDays recomputes empty. */}
        {batchCompletedFlash && !batchState.active && (
          <div role="status" aria-live="polite" style={{
            position: "fixed", bottom: 96, left: 16, right: 16,
            zIndex: 9999,
            padding: "14px 16px",
            background: "var(--fg)", color: "var(--bg)",
            borderRadius: 14,
            boxShadow: "0 8px 24px rgba(0,0,0,0.20)",
            fontFamily: "var(--fb)", fontSize: 13.5, lineHeight: 1.4,
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
          }}>
            <span style={{ fontStyle: "italic" }}>
              Ori finished reading {batchState.total} day{batchState.total === 1 ? "" : "s"}. Patterns are ready.
            </span>
            <button
              type="button"
              onClick={() => setBatchCompletedFlash(false)}
              aria-label="Dismiss"
              style={{
                width: 28, height: 28, borderRadius: 14,
                border: "none", background: "rgba(255,255,255,0.12)",
                color: "var(--bg)", cursor: "pointer", padding: 0,
                display: "grid", placeItems: "center",
                fontFamily: "var(--fm)", fontSize: 14, lineHeight: 1,
              }}
            >×</button>
          </div>
        )}

        {/* Post-import pill — small chip at the top of the Analyze tab.
            Single line, tap target opens the full pitch in a centered
            popup. The pill is intentionally unobtrusive so the journaling
            surface below it stays in pole position. */}
        {tab === "analyze" && !batchState.active && unanalyzedDays.length > 0 && (
          <div style={{ display: "flex", justifyContent: "center", margin: "0 0 14px" }}>
            <button
              type="button"
              onClick={() => setBatchPopupOpen(true)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "8px 14px", minHeight: 36, borderRadius: 999,
                background: "rgba(74,124,89,0.10)", color: g,
                border: "1px solid rgba(74,124,89,0.30)",
                fontFamily: "var(--fm)", fontSize: 11, letterSpacing: 1.2,
                cursor: "pointer",
              }}
              aria-label={`${unanalyzedDays.length} imported days waiting to be read`}
            >
              <span style={{
                width: 6, height: 6, borderRadius: "50%", background: g,
                animation: "cbr 1.6s ease-in-out infinite",
              }} />
              <span>{unanalyzedDays.length} day{unanalyzedDays.length === 1 ? "" : "s"} waiting · read {freeWindowDays.length}</span>
            </button>
          </div>
        )}

        {/* The centered popup that the pill opens. Backdrop dim, tap
            outside to dismiss. Same content the old inline banner had,
            now in a transient prompt that doesn't compete for the user's
            attention until they invite it. */}
        {batchPopupOpen && (
          <div
            onClick={() => setBatchPopupOpen(false)}
            data-modal-open="true"
            data-no-swipe="true"
            style={{
              position: "fixed", inset: 0, zIndex: 1100,
              background: "rgba(28,24,20,0.42)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "max(20px, env(safe-area-inset-top)) 18px max(20px, env(safe-area-inset-bottom))",
              animation: "ori-reader-fade 0.22s ease-out",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%", maxWidth: 420,
                background: "var(--bg)", color: "var(--fg)",
                borderRadius: 18,
                padding: "22px 22px 20px",
                boxShadow: "0 24px 60px rgba(28,24,20,0.28)",
                animation: "ori-reader-pop 0.30s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              <div style={{
                fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 1.6,
                textTransform: "uppercase", color: g, marginBottom: 8,
              }}>From your import</div>
              <div style={{
                fontFamily: "var(--fd)", fontStyle: "italic", fontSize: 20, lineHeight: 1.3,
                color: "var(--fg)", marginBottom: 8,
              }}>
                Ori hasn't read {unanalyzedDays.length} day{unanalyzedDays.length === 1 ? "" : "s"} of your writing yet.
              </div>
              <p style={{
                fontFamily: "var(--fb)", fontSize: 14, lineHeight: 1.55, color: "var(--mt)", margin: "0 0 18px",
              }}>
                {lockedRemainder > 0 ? (
                  <>She'll read the most recent <b>{freeWindowDays.length}</b> for you — free. Each reading takes about a minute, so plan on roughly {Math.ceil(freeWindowDays.length * 1.5)} minutes total.</>
                ) : (
                  <>She'll read all <b>{freeWindowDays.length}</b> of them for you — free. Each reading takes about a minute, so plan on roughly {Math.ceil(freeWindowDays.length * 1.5)} minutes total.</>
                )}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => { setBatchPopupOpen(false); runBatch(); }}
                  style={{
                    padding: "12px 18px", minHeight: 44, borderRadius: 999,
                    background: g, color: "#fff", border: "none",
                    fontFamily: "var(--fm)", fontSize: 12, letterSpacing: 1.5,
                    textTransform: "uppercase", fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Read {freeWindowDays.length} day{freeWindowDays.length === 1 ? "" : "s"}
                </button>
                {lockedRemainder > 0 && (
                  <p style={{
                    margin: "2px 0 0", textAlign: "center",
                    fontFamily: "var(--fb)", fontSize: 12, lineHeight: 1.5, color: "var(--mt)",
                  }}>
                    Your other {lockedRemainder} day{lockedRemainder === 1 ? "" : "s"} stay in your journal — every word is there to read.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setBatchPopupOpen(false)}
                  style={{
                    padding: "10px 16px", minHeight: 40,
                    background: "transparent", color: "var(--mt)", border: "none",
                    fontFamily: "var(--fm)", fontSize: 11, letterSpacing: 1.2,
                    textTransform: "uppercase", cursor: "pointer",
                  }}
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        )}

        {(() => {
          const tc = getTimeContext();
          const todayE = getTodayEntries(history);
          const lastAge = getLastEntryAge(history);
          const nudge = getNudgeMessage(todayE.length, lastAge);
          const now = new Date();
          const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
          const hourNow = now.getHours() + now.getMinutes() / 60;
          // Check for any suspect sleep days in the last 7 days — shows a
          // gentle count in the top-right corner so the user notices before
          // scrolling into the garden. Silent when nothing's off.
          const suspectCount = (() => {
            try {
              const raw = localStorage.getItem(OURA_HISTORY_KEY);
              if (!raw) return 0;
              const map = JSON.parse(raw);
              let count = 0;
              for (let i = 1; i <= 7; i++) {
                const d = new Date(); d.setDate(d.getDate() - i);
                const iso = d.toISOString().split("T")[0];
                if (needsSleepReview(map[iso])) count++;
              }
              return count;
            } catch { return 0; }
          })();
          const greeting = todayE.length === 0
            ? <>{tc.greeting}<span style={{ color: "#94B79A" }}>.</span></>
            : todayE.length === 1
            ? <>Welcome back<span style={{ color: "#94B79A" }}>.</span></>
            : <>Check-in {todayE.length + 1}<span style={{ color: "#94B79A" }}>.</span></>;
          return <>
            <header className="ca" style={{ marginBottom: todayE.length > 0 ? 20 : 28 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 10, letterSpacing: 1.8, textTransform: "uppercase", color: "var(--mt)", fontFamily: "var(--fm)" }}>{dateStr}</div>
                  <div style={{ fontSize: 30, fontWeight: 400, fontFamily: "var(--fd)", color: "var(--fg)", letterSpacing: -0.6, lineHeight: 1, marginTop: 4 }}>
                    {greeting}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "var(--mt)", fontFamily: "var(--fm)", textAlign: "right", lineHeight: 1.6, marginRight: 44 }}>
                  {suspectCount > 0
                    ? <span style={{ color: "#C4902A" }}>{suspectCount} to check</span>
                    : <>≈ {tc.timeStr}</>}
                  <br /><span style={{ opacity: 0.7 }}>{tc.period}</span>
                </div>
              </div>
              <SkyArc hour={hourNow} />
              {todayE.length > 0 && (
                <div style={{ fontSize: 13, fontStyle: "italic", fontFamily: "var(--fb)", color: "var(--mt)", lineHeight: 1.5, marginTop: 8, textAlign: "center" }}>
                  {tc.followUp}
                </div>
              )}
            </header>
            {/* Nudge */}
            {nudge && tab === "analyze" && view === "input" && (
              <div className="ca" style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 8, background: nudge.tone === "gentle" ? "rgba(184,134,11,0.06)" : nudge.tone === "encourage" ? "rgba(74,124,89,0.06)" : "var(--cd)", border: `1px solid ${nudge.tone === "gentle" ? "rgba(184,134,11,0.15)" : nudge.tone === "encourage" ? "rgba(74,124,89,0.15)" : "var(--ln)"}` }}>
                <div style={{ fontSize: 11, color: nudge.tone === "gentle" ? y : nudge.tone === "encourage" ? g : "var(--mt)", lineHeight: 1.6 }}>{nudge.text}</div>
              </div>
            )}
          </>;
        })()}


        {/* Mode pill — quiet status of which mode you're in. Centered so it
            doesn't feel squeezed against the right edge on phones. The full
            picker with explainer copy still lives in Settings → Profile. */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <div style={{
            display: "flex", padding: 2,
            background: "transparent", border: "1px solid var(--ln)", borderRadius: 999,
            fontFamily: "var(--fm)", fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            {[
              { id: "full",    label: "Full" },
              { id: "reflect", label: "Reflect" },
            ].map((opt) => {
              const active = mode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    if (active) return;
                    setMode(opt.id);
                    try { localStorage.setItem(MODE_KEY, opt.id); } catch { /* ignore */ }
                  }}
                  aria-label={`Switch to ${opt.label} mode`}
                  style={{
                    padding: "5px 12px", borderRadius: 999, border: 0, cursor: active ? "default" : "pointer",
                    background: active ? "var(--fg)" : "transparent",
                    color: active ? "var(--bg)" : "var(--mt)",
                    fontFamily: "inherit", fontSize: "inherit", letterSpacing: "inherit", textTransform: "inherit",
                    minHeight: 26, transition: "background 0.18s ease, color 0.18s ease",
                  }}
                >{opt.label}</button>
              );
            })}
          </div>
        </div>

        {/* Bottom tab bar — pinned to viewport bottom (iOS pattern) with
            safe-area-bottom padding so the home indicator never overlaps
            tab labels. Solid paper background (no backdrop-filter) — iOS
            Safari has a known bug where backdrop-filter on a fixed element
            can apply rendering filters to ancestors and haze the whole
            viewport. The wrapper above adds matching scroll padding. */}
        <nav style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100,
          background: "#F7F3EC",
          borderTop: "1px solid var(--ln)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}>
          <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", padding: "0 8px" }}>
            {[["analyze", "Analyze"], ["profile", "You"], ["patterns", "Patterns"], ["journal", "Journal"]].map(([id, label]) => (
              <button key={id} onClick={() => {
                setTab(id);
                if (id === "analyze" && view !== "result") setView("input");
                if (id === "patterns") { try { setRepoSnapshot(loadRepo()); } catch { /* ignore */ } }
              }}
                style={{ flex: 1, minHeight: 48, padding: "10px 0", background: "none", border: "none", borderTop: tab === id ? "2px solid var(--ac)" : "2px solid transparent", color: tab === id ? "var(--fg)" : "var(--mt)", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", fontFamily: "var(--fm)", fontWeight: tab === id ? 500 : 400, transition: "color .2s, border-color .2s" }}>{label}</button>
            ))}
          </div>
        </nav>

        {loading && (
          <LlmActivity stage={analysisStage} />
        )}

        {!loading && tab === "analyze" && view === "input" && (() => {
          const tc = getTimeContext();
          const todayE = getTodayEntries(history);
          const isFollowUp = todayE.length > 0;

          // Build Today-glance inputs live from localStorage + main state.
          let todayTrends = null;
          try {
            const raw = localStorage.getItem(OURA_HISTORY_KEY);
            if (raw) {
              const map = JSON.parse(raw);
              const today = new Date().toISOString().split("T")[0];
              todayTrends = computeBiometricTrends(map, today);
            }
          } catch { /* ignore */ }
          const todayCheckin = loadCheckin();

          const goPlumbing = (target, open) => {
            // User clicked an action in a PillarDetail — route them to the
            // existing plumbing (Oura sync, manual sliders, check-in taps).
            window.dispatchEvent(new CustomEvent("cpi:gotoSection", { detail: target }));
            // Specific opener — BiometricsPanel listens and opens the right sub-UI.
            if (open) window.dispatchEvent(new CustomEvent("cpi:open", { detail: open }));
            setTimeout(() => {
              const el = document.getElementById(target);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 60);
          };

          // Today's-Reading pinned card. Seeds + reflectTime read live so
          // the card reflects truth on every render.
          const seedsTodayCount = (() => {
            try {
              const todayKey = ymdISO(new Date());
              const repo = loadRepo() || { entries: [] };
              return (repo.entries || []).filter(s => stampMatchesDay(s?.uploadedAt || s?.date, todayKey)).length;
            } catch { return 0; }
          })();
          const reflectTimeNow = (() => {
            try { return localStorage.getItem(REFLECT_TIME_KEY) || "21:00"; } catch { return "21:00"; }
          })();
          const openTodaysLetter = () => {
            // If today's reading is in memory, just navigate. Otherwise
            // restore from cpi_last_reading. Fallback: regenerate.
            if (result?.a) { setView("result"); setTab("analyze"); return; }
            try {
              const raw = localStorage.getItem("cpi_last_reading");
              if (raw) {
                const stored = JSON.parse(raw);
                if (stored?.date === ymdISO(new Date()) && stored?.result?.a) {
                  setResult(stored.result);
                  setView("result");
                  setTab("analyze");
                  return;
                }
              }
            } catch { /* ignore */ }
            readToday();
          };

          // Seeds across the trailing 7 days — used by the weekly card
          // for its anticipating/imminent states.
          const seedsThisWeekCount = (() => {
            try {
              const repo = loadRepo() || { entries: [] };
              const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
              return (repo.entries || []).filter(s => {
                const t = new Date(s?.uploadedAt || s?.date).getTime();
                return Number.isFinite(t) && t >= cutoff;
              }).length;
            } catch { return 0; }
          })();
          const openWeeklyLetter = () => {
            try {
              // weekKey = this Sunday's date (Sunday-anchored week)
              const day = new Date();
              const dow = day.getDay();
              day.setDate(day.getDate() - dow);
              const weekKey = ymdISO(day);
              const raw = localStorage.getItem(`cpi_week_letter_${weekKey}`);
              if (raw) {
                const stored = JSON.parse(raw);
                if (stored?.result?.a) {
                  setResult(stored.result);
                  setView("result");
                  setTab("analyze");
                }
              }
            } catch { /* ignore */ }
          };

          // ─── v5 SIMPLIFIED INPUT VIEW ─────────────────────────────
          //  Renders when the `cpi:analyze-v5` flag is on. Journaling-
          //  first layout: greeting + body context + energy strip +
          //  reading card + textarea/buttons. Wake-time pill, Garden
          //  pots, BiometricsPanel, WeeklyReadingCard, ReflectBanner
          //  all live on the You tab (or are intentionally omitted).
          if (ANALYZE_V5) {
            const wakeHour = (() => {
              const [hh, mm] = (wakeTime || "07:00").split(":");
              return Number(hh) + Number(mm) / 60;
            })();
            const todayKeyStr = ymdISO(new Date());
            const hasReadingToday = (history || []).some(e => stampMatchesDay(e?.date, todayKeyStr));
            const reflectMinutes = (() => {
              const raw = localStorage.getItem(REFLECT_TIME_KEY) || "21:00";
              const m = raw.match(/^(\d{1,2}):(\d{2})$/);
              if (!m) return 21 * 60;
              return Number(m[1]) * 60 + Number(m[2]);
            })();
            const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
            const pastReflectTime = nowMinutes >= reflectMinutes;
            const isReflect = mode === "reflect";
            const cardReady = seedsTodayCount > 0 && (!isReflect || pastReflectTime) && !hasReadingToday;

            return (
              <div>
                <GreetingHeaderV5 history={history} />
                <BodyContextLineV5
                  biometrics={biometrics}
                  lifestyle={lifestyle}
                  history={history}
                  chronotype={chronotype}
                />
                <ReadingCardV5
                  seedsToday={seedsTodayCount}
                  reflectTime={reflectTimeNow}
                  hasReadingToday={hasReadingToday}
                  ready={cardReady}
                  onOpenLetter={openTodaysLetter}
                  onReadNow={readToday}
                />

                {/* Journal textarea (kept from legacy — works as designed) */}
                <div className="ca d2" style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, letterSpacing: 1.8, textTransform: "uppercase", color: "var(--mt)", fontFamily: "var(--fm)", marginBottom: 10 }}>
                    {mode === "reflect" ? "A seed for today" : "What's on you today?"}
                  </div>
                  <div style={{ background: "var(--sf)", border: `1px solid ${dayVoice.listening ? r : "var(--ln)"}`, borderRadius: 14, padding: "16px 18px", transition: "border-color .3s" }}>
                    <textarea ref={dayTextareaRef} value={dayDesc} onChange={e => setDayDesc(e.target.value)}
                      placeholder={mode === "reflect" ? "What's tending in your mind right now?" : (isFollowUp ? tc.followPlaceholder : tc.placeholder)}
                      style={{ width: "100%", minHeight: isFollowUp ? 80 : 100, background: "transparent", border: "none", fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 16, color: "var(--fg)", lineHeight: 1.65, resize: "vertical", outline: "none", boxSizing: "border-box" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, marginTop: 6, borderTop: "1px solid var(--ln)", flexWrap: "wrap", gap: 8 }}>
                      <MicButton listening={dayVoice.listening} onClick={dayVoice.toggle} supported={dayVoice.supported} interim={dayVoice.interim} confidence={dayVoice.confidence} error={dayVoice.error} />
                      <span style={{ fontSize: 9, fontFamily: "var(--fm)", color: "var(--mt)", opacity: 0.7, letterSpacing: 0.5 }}>stays on this device</span>
                    </div>
                  </div>
                </div>

                {analysisError && (
                  <div className="ca">
                    <FriendlyApiErrorV5 message={analysisError} onDismiss={() => setAnalysisError(null)} />
                  </div>
                )}
                {plantedFlash && (
                  <div className="ca" style={{ padding: "12px 14px", marginBottom: 16, background: "rgba(74,124,89,0.07)", border: `1px solid rgba(74,124,89,0.22)`, borderRadius: 6, fontSize: 12, color: g, fontFamily: "var(--fm)", lineHeight: 1.6, textAlign: "center", letterSpacing: 1 }}>
                    Seed planted. The garden is tending.
                  </div>
                )}

                {/* Plant + Read buttons (kept from legacy) */}
                {(() => {
                  const hasFresh = !!dayDesc.trim();
                  let seedsToday = 0;
                  try {
                    const tk = ymdISO(new Date());
                    const entries = loadRepo()?.entries || [];
                    seedsToday = entries.filter(e => journalEntryCoversDay(e, tk)).length;
                  } catch { /* ignore */ }
                  const totalForReading = seedsToday + (hasFresh ? 1 : 0);
                  const canRead = totalForReading > 0;
                  const readLabel = analysisError ? "Retry" : (canRead ? `Read today · ${totalForReading} seed${totalForReading === 1 ? "" : "s"}` : "Read today");
                  return (
                    <div className="ca" style={{ display: "flex", gap: 10 }}>
                      <button onClick={plantSeed} disabled={!hasFresh}
                        style={{ flex: 1, padding: "14px 0", background: "transparent", color: hasFresh ? "var(--fg)" : "var(--mt)", border: `1px solid ${hasFresh ? "var(--ln)" : "var(--ln)"}`, borderRadius: 12, fontSize: 11, fontWeight: 500, letterSpacing: 2.4, textTransform: "uppercase", fontFamily: "var(--fm)", transition: "all .3s" }}>
                        Plant
                      </button>
                      <button onClick={readToday} disabled={!canRead}
                        style={{ flex: 1, padding: "14px 0", background: canRead ? "#3F5B39" : "var(--ln)", color: canRead ? "var(--bg)" : "var(--mt)", border: `1px solid ${canRead ? "#3F5B39" : "var(--ln)"}`, borderRadius: 12, fontSize: 11, fontWeight: 500, letterSpacing: 2.4, textTransform: "uppercase", fontFamily: "var(--fm)", transition: "all .3s" }}>
                        {readLabel}
                      </button>
                    </div>
                  );
                })()}
              </div>
            );
          }

          // ─── LEGACY INPUT VIEW (renders when flag is OFF) ─────────
          return (
          <div>
            <LetterEmptyState history={history} />

            {/* Wake-time pill — sits in the top notification slot. First
                check-in only, both modes. Replaces TodaysReadingCard's
                "quiet" state so the user only sees one card here. Always
                visible so the math source is transparent: subtitle reads
                "from Oura/Apple" when a wearable is providing it, "edit"
                otherwise. Tappable either way for override. */}
            {!isFollowUp && (() => {
              const autoSource = getAutoWakeSource();
              const fromWearable = !!getAutoWakeTime() && !wakeOverride;
              const subtitleLabel = fromWearable
                ? (autoSource === "apple" ? "from Apple" : autoSource === "oura" ? "from Oura" : "from wearable")
                : "edit";
              const [h, m] = wakeTime.split(":");
              let hh = Number(h);
              const sfx = hh >= 12 ? "PM" : "AM";
              hh = hh % 12; if (hh === 0) hh = 12;
              const pretty = `${hh}:${m} ${sfx}`;
              return (
                <div style={{ margin: "0 0 22px", display: "flex", justifyContent: "center" }}>
                  {!wakeEditing ? (
                    <button
                      type="button"
                      onClick={() => setWakeEditing(true)}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--ln)",
                        borderRadius: 999,
                        padding: "6px 14px",
                        fontFamily: "var(--fm)",
                        fontSize: 11,
                        letterSpacing: 1.2,
                        color: "var(--mt)",
                        cursor: "pointer",
                      }}
                    >
                      Woke up at <span style={{ color: "var(--fg)" }}>{pretty}</span>
                      <span style={{ marginLeft: 10, fontSize: 9, opacity: 0.6 }}>{subtitleLabel}</span>
                    </button>
                  ) : (
                    <input
                      type="time"
                      value={wakeTime}
                      onChange={(e) => setWakeTime(e.target.value)}
                      onBlur={() => setWakeEditing(false)}
                      autoFocus
                      style={{
                        background: "transparent",
                        border: "1px solid var(--ln)",
                        borderRadius: 999,
                        padding: "6px 14px",
                        color: "var(--fg)",
                        fontSize: 16,
                        fontFamily: "var(--fb)",
                        width: 140,
                        textAlign: "center",
                      }}
                    />
                  )}
                </div>
              );
            })()}

            <TodaysReadingCard
              history={history}
              reflectTime={reflectTimeNow}
              seedsToday={seedsTodayCount}
              mode={mode}
              loading={loading}
              onOpenLetter={openTodaysLetter}
              onReadNow={readToday}
            />
            <WeeklyReadingCard
              reflectTime={reflectTimeNow}
              seedsThisWeek={seedsThisWeekCount}
              loading={loading}
              onOpenLetter={openWeeklyLetter}
              onReadNow={readWeek}
            />
            {mode === "reflect" && <ReflectTransparencyBanner onAddBody={() => setIntegrationsOpen(true)} />}
            {mode !== "reflect" && <TodayGlance key={`glance-${resetTick}`} biometrics={biometrics} lifestyle={lifestyle} trends={todayTrends} checkin={todayCheckin} history={history} onGoPlumbing={goPlumbing} mode={mode} />}
            {mode !== "reflect" && <BiometricsPanel key={`biopanel-${resetTick}`} biometrics={biometrics} setBiometrics={setBiometrics} ouraToken={ouraToken} setOuraToken={setOuraToken} lifestyle={lifestyle} setLifestyle={setLifestyle} chronotype={chronotype} setChronotype={setChronotype} mode={mode} />}


            <div className={`ca ${isFollowUp ? "d2" : "d3"}`} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, letterSpacing: 1.8, textTransform: "uppercase", color: "var(--mt)", fontFamily: "var(--fm)", marginBottom: 10 }}>
                {mode === "reflect" ? "A seed for today" : "A line for today"}
              </div>
              <div style={{ background: "var(--sf)", border: `1px solid ${dayVoice.listening ? r : "var(--ln)"}`, borderRadius: 14, padding: "16px 18px", transition: "border-color .3s" }}>
                <textarea value={dayDesc} onChange={e => setDayDesc(e.target.value)}
                  placeholder={mode === "reflect" ? "What's tending in your mind right now?" : (isFollowUp ? tc.followPlaceholder : tc.placeholder)}
                  style={{ width: "100%", minHeight: isFollowUp ? 80 : 100, background: "transparent", border: "none", fontFamily: "var(--fb)", fontStyle: "italic", fontSize: 16, color: "var(--fg)", lineHeight: 1.65, resize: "vertical", outline: "none", boxSizing: "border-box" }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, marginTop: 6, borderTop: "1px solid var(--ln)", flexWrap: "wrap", gap: 8 }}>
                  <MicButton listening={dayVoice.listening} onClick={dayVoice.toggle} supported={dayVoice.supported} interim={dayVoice.interim} confidence={dayVoice.confidence} error={dayVoice.error} />
                  <span style={{ fontSize: 9, fontFamily: "var(--fm)", color: "var(--mt)", opacity: 0.7, letterSpacing: 0.5 }}>stays on this device</span>
                </div>
              </div>
            </div>

            {/* Lingering field removed — single composer above is enough; multi-line
                works for follow-up thoughts. Both modes write to the same seed bucket. */}

            {analysisError && (
              <div className="ca">
                <FriendlyApiErrorV5 message={analysisError} onDismiss={() => setAnalysisError(null)} />
              </div>
            )}

            {/* Planted-seed confirmation — appears for ~3s after a seed is saved
                in either mode. Quiet feedback, no toast library. */}
            {plantedFlash && (
              <div className="ca" style={{ padding: "12px 14px", marginBottom: 16, background: "rgba(74,124,89,0.07)", border: `1px solid rgba(74,124,89,0.22)`, borderRadius: 6, fontSize: 12, color: g, fontFamily: "var(--fm)", lineHeight: 1.6, textAlign: "center", letterSpacing: 1 }}>
                Seed planted. The garden is tending.
              </div>
            )}

            {/* Plant + Read Today — unified across modes. Plant saves silently;
                Read Today composes all today's seeds + textarea, runs the
                analyzer, surfaces the result. Full mode runs full clinical pass
                (with biometrics); Reflect mode runs the words-only path. */}
            {(() => {
              const hasFresh = !!dayDesc.trim();
              let seedsToday = 0;
              try {
                const todayKey = ymdISO(new Date());
                const entries = loadRepo()?.entries || [];
                seedsToday = entries.filter(e => journalEntryCoversDay(e, todayKey)).length;
              } catch { /* ignore */ }
              const totalForReading = seedsToday + (hasFresh ? 1 : 0);
              const canRead = totalForReading > 0;
              const readLabel = analysisError ? "Retry" : (canRead ? `Read today · ${totalForReading} seed${totalForReading === 1 ? "" : "s"}` : "Read today");
              return (
                <div className={`ca ${isFollowUp ? "d4" : "d5"}`} style={{ display: "flex", gap: 10 }}>
                  <button onClick={plantSeed} disabled={!hasFresh}
                    style={{ flex: 1, padding: "14px 0", background: hasFresh ? "var(--fg)" : "var(--ln)", color: hasFresh ? "var(--bg)" : "var(--mt)", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, letterSpacing: 3, textTransform: "uppercase", fontFamily: "var(--fm)", transition: "all .3s" }}>
                    Plant
                  </button>
                  <button onClick={readToday} disabled={!canRead}
                    style={{ flex: 1, padding: "14px 0", background: "transparent", color: canRead ? "var(--fg)" : "var(--mt)", border: `1px solid ${canRead ? "var(--fg)" : "var(--ln)"}`, borderRadius: 6, fontSize: 12, fontWeight: 500, letterSpacing: 3, textTransform: "uppercase", fontFamily: "var(--fm)", transition: "all .3s" }}>
                    {readLabel}
                  </button>
                </div>
              );
            })()}

            {/* Today's reading card. Shape and palette match across modes;
                Reflect mode keeps its time-gated states, Full mode runs
                purely on what's planted/read so far. */}
            {(() => {
              const fmt = (raw) => {
                if (!raw || typeof raw !== "string") return null;
                const m = raw.match(/^(\d{1,2}):(\d{2})$/);
                if (!m) return null;
                let hh = Number(m[1]); const mm = m[2];
                if (Number.isNaN(hh) || hh < 0 || hh > 23) return null;
                const sfx = hh >= 12 ? "PM" : "AM";
                hh = hh % 12; if (hh === 0) hh = 12;
                return `${hh}:${mm} ${sfx}`;
              };
              const pretty = fmt(localStorage.getItem(REFLECT_TIME_KEY)) || "9:00 PM";

              const todayKey = ymdISO(new Date());
              const hasReadingToday = (history || []).some(e => stampMatchesDay(e?.date, todayKey));
              const todayReading = (history || []).find(e => stampMatchesDay(e?.date, todayKey));
              const reflectMinutes = (() => {
                const raw = localStorage.getItem(REFLECT_TIME_KEY) || "21:00";
                const m = raw.match(/^(\d{1,2}):(\d{2})$/);
                if (!m) return 21 * 60;
                return Number(m[1]) * 60 + Number(m[2]);
              })();
              const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
              const pastReflectTime = nowMinutes >= reflectMinutes;
              let seedsToday = 0;
              try {
                seedsToday = (loadRepo()?.entries || []).filter(e => journalEntryCoversDay(e, todayKey)).length;
              } catch { /* ignore */ }
              const isReflect = mode === "reflect";
              const headerLabel = isReflect ? "TONIGHT'S READING" : "TODAY'S READING";

              const baseCard = {
                marginTop: 28,
                padding: "18px 18px 16px",
                background: "var(--sf)",
                border: "1px solid var(--ln)",
                borderRadius: 8,
                textAlign: "center",
              };
              const readyCard = {
                ...baseCard,
                background: "rgba(106,138,92,0.06)",
                border: "1px solid rgba(106,138,92,0.35)",
                cursor: "pointer",
              };

              // 1. Already read today → soft echo (both modes).
              if (hasReadingToday) {
                const readAt = todayReading?.date
                  ? new Date(todayReading.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                  : null;
                return (
                  <div style={baseCard}>
                    <div style={{ fontFamily: "var(--fm)", fontSize: 8, letterSpacing: 3, color: "var(--mt)", marginBottom: 6 }}>{headerLabel}</div>
                    <div style={{ fontFamily: "var(--fd)", fontSize: 16, fontStyle: "italic", color: "var(--fg)", lineHeight: 1.5 }}>
                      {readAt ? `Came alive at ${readAt}.` : "Already done for today."}
                    </div>
                    <div style={{ fontFamily: "var(--fb)", fontSize: 11, color: "var(--mt)", marginTop: 6, lineHeight: 1.5 }}>
                      {isReflect ? "Plant freely; tomorrow's garden waits." : "Plant freely; tomorrow's slate clears at midnight."}
                    </div>
                  </div>
                );
              }

              // 2. Has seeds, not yet read → tappable CTA. Reflect mode gates on
              //    reflection time; Full mode shows it whenever seeds exist.
              const canShowCTA = seedsToday > 0 && (!isReflect || pastReflectTime);
              if (canShowCTA) {
                const ctaLabel = isReflect ? "TONIGHT'S READING IS READY" : "READY TO READ";
                return (
                  <div role="button" tabIndex={0}
                    onClick={readToday}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); readToday(); } }}
                    style={readyCard}>
                    <div style={{ fontFamily: "var(--fm)", fontSize: 8, letterSpacing: 3, color: g, marginBottom: 6 }}>{ctaLabel}</div>
                    <div style={{ fontFamily: "var(--fd)", fontSize: 18, fontStyle: "italic", color: "var(--fg)", lineHeight: 1.4 }}>
                      {seedsToday} seed{seedsToday === 1 ? "" : "s"} planted today.
                    </div>
                    <div style={{ fontFamily: "var(--fb)", fontSize: 12, color: g, marginTop: 8, lineHeight: 1.5, fontWeight: 500 }}>
                      → tap to read your day
                    </div>
                  </div>
                );
              }

              // 3. Reflect-only: past reflect time but no seeds yet → honest nudge.
              if (isReflect && pastReflectTime && seedsToday === 0) {
                return (
                  <div style={baseCard}>
                    <div style={{ fontFamily: "var(--fm)", fontSize: 8, letterSpacing: 3, color: "var(--mt)", marginBottom: 6 }}>TENDED IN THE QUIET</div>
                    <div style={{ fontFamily: "var(--fd)", fontSize: 16, fontStyle: "italic", color: "var(--fg)", lineHeight: 1.5 }}>
                      It's past <span style={{ color: g, fontStyle: "normal", fontFamily: "var(--fb)" }}>{pretty}</span>.
                    </div>
                    <div style={{ fontFamily: "var(--fb)", fontSize: 11, color: "var(--mt)", marginTop: 6, lineHeight: 1.5 }}>
                      Plant a seed and tonight's reading will compose.
                    </div>
                  </div>
                );
              }

              // 4. Reflect-only default: before reflect time, garden is waiting.
              if (isReflect) {
                return (
                  <div style={baseCard}>
                    <div style={{ fontFamily: "var(--fm)", fontSize: 8, letterSpacing: 3, color: "var(--mt)", marginBottom: 6 }}>TENDED IN THE QUIET</div>
                    <div style={{ fontFamily: "var(--fd)", fontSize: 16, fontStyle: "italic", color: "var(--fg)", lineHeight: 1.5 }}>
                      Your reading comes alive at <span style={{ color: g, fontStyle: "normal", fontFamily: "var(--fb)" }}>{pretty}</span>.
                    </div>
                    <div style={{ fontFamily: "var(--fb)", fontSize: 11, color: "var(--mt)", marginTop: 6, lineHeight: 1.5 }}>
                      Plant freely until then. The garden waits.
                    </div>
                  </div>
                );
              }

              // 5. Full mode, no reading, no seeds → hide. Analyze is on-demand;
              //    no orientation card needed when there's nothing to point at.
              return null;
            })()}
          </div>
          );
        })()}

        {!loading && tab === "analyze" && view === "result" && result && ANALYZE_V5 && (() => {
          // v5 result view: Reserves tile + letter + mini pots + reading block + actions.
          let v5Trends = null;
          try {
            const raw = localStorage.getItem(OURA_HISTORY_KEY);
            if (raw) {
              const map = JSON.parse(raw);
              const today = new Date().toISOString().split("T")[0];
              v5Trends = computeBiometricTrends(map, today);
            }
          } catch { /* ignore */ }
          const v5Checkin = loadCheckin();
          return (
            <div>
              {result.h.systemCritical && <SystemCriticalAlert Ha={result.h.Ha} />}

              <ReservesTileV5 h={result.h} history={history} />

              {/* Letter + Today's company sit together — the literary surface
                  the user came to read. hideCrisisFoot keeps the 988 strip
                  out of the middle of the page; we render it once at the
                  very bottom instead. */}
              <LetterReading
                result={result}
                insights={result.a.insights}
                tone="neutral"
                onChipClick={() => setKeeperOpen(true)}
                hideMathToggle={true}
                hideCrisisFoot={true}
              />

              {/* Body / mind / mood — numeric supporting cards, below the
                  letter so the letter is what the eye lands on first. */}
              <MiniPotsRowV5
                biometrics={biometrics}
                lifestyle={lifestyle}
                trends={v5Trends}
                checkin={v5Checkin}
                history={history}
                onTap={() => setTab("profile")}
                mode={mode}
              />

              <ReadingBlockV5
                h={result.h}
                a={result.a}
                biometrics={biometrics}
                chronotype={chronotype}
                history={history}
                mode={mode}
              />

              <LetterActionsV5
                onAddLine={reset}
                onSeeNumbers={() => setTab("profile")}
              />

              {/* Crisis footer pinned at the page bottom — small, centered,
                  one strip total. Was getting rendered inline at the foot
                  of LetterReading where it interrupted the visual flow
                  between the letter and the body cards. */}
              <CrisisFootStrip />
            </div>
          );
        })()}

        {!loading && tab === "analyze" && view === "result" && result && !ANALYZE_V5 && (
          <div>
            {result.h.systemCritical && <SystemCriticalAlert Ha={result.h.Ha} />}

            <LetterReading
              result={result}
              insights={result.a.insights}
              tone="neutral"
              onReset={reset}
              onChipClick={() => setKeeperOpen(true)}
            >
              {/* "Show the math" drawer — original dashboard, intact. Numbers
                  are not deleted; they live one tap away. */}
              {mode !== "reflect" && <SignalCard h={result.h} a={result.a} biometrics={biometrics} history={history} />}
              {mode !== "reflect" && <SleepPipelineTrace biometrics={biometrics} result={result.h} analysis={result.a} />}
              {/* Bedtime cue — sits at the foot of the Sleep pipeline section
                  when the wearable provides one. Small font, only the time
                  slightly bold. Renders nothing when the data is absent. */}
              {mode !== "reflect" && (() => {
                const bedtime = formatOptimalBedtime(biometrics?.optimalBedtime);
                if (!bedtime) return null;
                return (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: -10, marginBottom: 18, padding: "10px 2px 0", borderTop: "1px dashed var(--ln)", fontFamily: "var(--fm)", fontSize: 10.5, letterSpacing: 1.6, textTransform: "uppercase", color: "var(--mt)" }}>
                    <span style={{ opacity: 0.85 }}>Tonight · aim for</span>
                    <span style={{ fontWeight: 600, letterSpacing: 0.4, color: "var(--fg)" }}>{bedtime}</span>
                  </div>
                );
              })()}
              {mode !== "reflect" && <UltradianCard ultradian={result.h.ultradian} Ha={result.h.Ha} />}
              {mode !== "reflect" && <ChronotypeCard ctAlign={result.h.ctAlign} chronotype={chronotype} />}

              <div className="ca d7" style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--mt)", fontFamily: "var(--fm)", marginBottom: 6 }}>Drivers</div>
                {Object.entries(KB.drivers).map(([key, data]) => {
                  const val = result.a.driverScores[key] || 0;
                  const maxV = Math.max(1, ...Object.values(result.a.driverScores));
                  const isTop = val === maxV && val > 0;
                  return (
                    <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                      <div style={{ width: 80, fontSize: 11, color: isTop ? "var(--fg)" : "var(--mt)", fontFamily: "var(--fm)", fontWeight: isTop ? 600 : 400, textAlign: "right" }}>{data.icon} {data.name.split(" ")[0]}</div>
                      <div style={{ flex: 1, height: 5, background: "var(--ln)", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${(val / maxV) * 100}%`, background: isTop ? "var(--ac)" : "var(--mt)", borderRadius: 3, transition: "width 1.2s ease-out", opacity: isTop ? 1 : .4 }} /></div>
                      <div style={{ width: 20, fontSize: 11, color: "var(--mt)", fontFamily: "var(--fm)" }}>{val}</div>
                    </div>
                  );
                })}
                {/* Rest-mode footer — small, mono, no labels louder than the
                    drivers above. Lists days in the last 7 the user set
                    aside; renders nothing when the window is clean. */}
                {(() => {
                  let map = {};
                  try { const raw = localStorage.getItem(OURA_HISTORY_KEY); if (raw) map = JSON.parse(raw); } catch { /* ignore */ }
                  const restDays = restDaysInWindow(map, 7);
                  if (!restDays.length) return null;
                  const fmt = (ymd) => {
                    try { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch { return ymd; }
                  };
                  return (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--ln)", fontFamily: "var(--fm)", fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: "var(--mt)" }}>
                      <span><span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: "var(--mt)", opacity: 0.55, marginRight: 6, verticalAlign: "middle" }} />{restDays.length} day{restDays.length === 1 ? "" : "s"} excluded</span>
                      <span>{restDays.map(fmt).join(" · ")}</span>
                    </div>
                  );
                })()}
              </div>
            </LetterReading>
          </div>
        )}

        {!loading && tab === "patterns" && (
          <Patterns
            mode={mode}
            confirmations={confirmations}
            onOpenKeeper={() => setKeeperOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            history={history}
          />

        )}

        {/* ─── YOU TAB — journal-framed cognitive profile ─── */}
        {!loading && tab === "profile" && (
          <CognitiveProfile
            history={history}
            biometrics={biometrics}
            mode={mode}
            onGoPatterns={() => setTab("patterns")}
          />
        )}

        {!loading && tab === "journal" && (
          <JournalErrorBoundary>
            <JournalRepo
              checkins={history}
              onRemoveCheckin={(idx) => setHistory(prev => prev.filter((_, i) => i !== idx))}
              onAnalyzeDay={(text) => {
                // Bring the user back to the Analyze tab with the day's
                // text pre-loaded so they can tap Read to generate a
                // reading for an entry that doesn't have one yet (the
                // backup-import case where some days had writing but
                // never got analyzed). Reset to the input view in case
                // they're currently looking at a result.
                if (typeof text === "string" && text.trim()) {
                  setDayDesc(text.trim());
                  setLingering("");
                  setView("input");
                  setTab("analyze");
                }
              }}
            />
          </JournalErrorBoundary>
        )}

      </div>
    </div>
  );
}
