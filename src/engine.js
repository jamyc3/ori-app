/* ═══════════════════════════════════════════
   ENGINE — all non-UI logic.
   Oura sync, Apple Health parser, biometrics
   computation, clinical/insights/lore analysis
   pipelines, journal repo, HCPI math, NLP.
   No React components here — only pure fns and
   async data operations.
   ═══════════════════════════════════════════ */

import JSZip from "jszip";
import * as mammoth from "mammoth/mammoth.browser.js";
import { canonicalCheckinDay } from "./date-util.js";
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


/* ═══════════════════════════════════════════
   CHRONOTYPE & ULTRADIAN SYSTEMS
   ═══════════════════════════════════════════ */

// Phase-anchored alignment using hours-since-wake (Ha), NOT clock time.
//
// Why this replaced the old clock-time-based getChronotypeAlignment:
// the chronobiology literature ([Schmidt et al. 2007](https://www.tandfonline.com/doi/abs/10.1080/02643290701754158);
// [Roenneberg 2007](https://longevity.stanford.edu/wp-content/uploads/sites/2/2016/04/2007SleepMedRevRoenneberg.pdf))
// anchors cognitive peak windows to wake time / sleep midpoint, not to
// the wall clock. A Night Owl forced to wake at 6am is biologically in
// the same homeostatic-decay arc as anyone else 12h post-wake; tagging
// them "off-peak at noon because true peak is 2pm clock-time" is wrong.
//
// This term *also* now carries the time-of-day signal that used to live
// in the standalone circadian sine inside M (1 − 0.15·sin(2π·Ha/24)).
// One source of truth, ~±15% swing, instead of two stacked terms
// reaching ~±36% combined. Flagged in HCPI validation audit Cluster B.
//
// Peak-Ha bands (typical adult, chronotype-dependent):
//   Early Bird  (morning):  Ha 2–5h after wake — rapid ramp-up
//   Flexible (default):     Ha 3–6h after wake
//   Night Owl   (evening):  Ha 5–10h after wake — slow ramp-up, longer plateau
export function getPhaseAlignment(chronotype, Ha) {
  const PEAK_BANDS = {
    morning:  { start: 2, end: 5 },
    flexible: { start: 3, end: 6 },
    evening:  { start: 5, end: 10 },
  };
  const band = PEAK_BANDS[chronotype] || PEAK_BANDS.flexible;
  if (Ha >= band.start && Ha < band.end) return { score: 1.00, label: "Peak window", phase: "peak" };
  const dist = Ha < band.start ? band.start - Ha : Ha - band.end;
  if (dist <= 2) return { score: 0.92, label: "Near peak", phase: "shoulder" };
  if (dist <= 5) return { score: 0.85, label: "Off-peak", phase: "off" };
  return { score: 0.78, label: "Deep off-peak", phase: "trough" };
}

export function getUltradianPhase(hoursAwake) {
  const cycleMinutes = (hoursAwake * 60) % 90;
  const phase = cycleMinutes / 90;
  const wave = 0.85 + 0.15 * Math.cos(2 * Math.PI * phase);
  const minutesToDip = phase < 0.67 ? Math.round((0.67 - phase) * 90) : Math.round((1.67 - phase) * 90);
  const minutesToPeak = phase > 0.1 ? Math.round((1.0 - phase) * 90) : Math.round((0.0 - phase + 1) * 90 % 90);
  const cycleNum = Math.floor(hoursAwake * 60 / 90) + 1;
  let label, status;
  if (phase < 0.22) { label = "Ramping up"; status = "ascending"; }
  else if (phase < 0.55) { label = "Peak focus zone"; status = "peak"; }
  else if (phase < 0.72) { label = "Beginning to fade"; status = "descending"; }
  else { label = "Recovery dip"; status = "dip"; }
  return { wave, phase, minutesToDip, minutesToPeak: Math.min(minutesToPeak, 90), cycleNum, label, status };
}

/* ═══════════════════════════════════════════
   TIME-AWARE DAILY ENGAGEMENT
   ═══════════════════════════════════════════ */

export function getTimeContext() {
  const h = new Date().getHours();
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (h >= 5 && h < 12) return { period: "morning", greeting: "Good morning", prompt: "How did you sleep? What's ahead?", placeholder: "Woke up feeling rested, have a big presentation at 10...", followUp: "What's shifted since this morning?", followPlaceholder: "The meeting went well but now I'm drained from back-to-back calls...", timeStr };
  if (h >= 12 && h < 17) return { period: "afternoon", greeting: "Afternoon", prompt: "How's your mind holding up?", placeholder: "Morning was productive but hit a wall after lunch, scrolling too much...", followUp: "How has the afternoon been?", followPlaceholder: "Energy picked up after a walk, but still procrastinating on the report...", timeStr };
  if (h >= 17 && h < 22) return { period: "evening", greeting: "Evening", prompt: "How did your mind work today?", placeholder: "Good day overall but too many meetings drained me by 3pm...", followUp: "Anything changed since last check-in?", followPlaceholder: "Feeling calmer now, but still thinking about that conversation with my boss...", timeStr };
  return { period: "night", greeting: "Late night", prompt: "What's keeping you up?", placeholder: "Can't stop thinking about tomorrow's deadline...", followUp: "Still processing?", followPlaceholder: "Mind won't quiet down, going back and forth on the decision...", timeStr };
}

export function getTodayEntries(history) {
  const today = new Date().toISOString().split("T")[0];
  return history.filter(h => h.date && h.date.startsWith(today));
}

export function getLastEntryAge(history) {
  if (history.length === 0) return null;
  const last = new Date(history[0].date);
  const now = new Date();
  const hours = (now - last) / (1000 * 60 * 60);
  return hours;
}

export function getNudgeMessage(todayCount, lastAge) {
  if (todayCount === 0 && lastAge !== null && lastAge > 24) return { text: "It's been a while. A 30-second check-in keeps your profile accurate.", tone: "gentle" };
  if (todayCount === 0) return null;
  if (todayCount === 1) return { text: "First check-in logged. A second one later today gives the model a sharper picture of your cognitive curve.", tone: "encourage" };
  if (todayCount === 2) return { text: `${todayCount} check-ins today — your daily profile is building well.`, tone: "affirm" };
  return { text: `${todayCount} check-ins today. Rich data for your profile.`, tone: "affirm" };
}

// Per-day aggregation helpers (dayKey, groupCheckinsByDay, uniqueDayCount)
// and HEALTH_INDEX are imported from ./knowledge-base.js.

/* ═══════════════════════════════════════════
   OURA API V2 — Personal Access Token via Vite dev proxy
   (browser → /oura/* → api.ouraring.com/v2/* — sidesteps CORS)
   ═══════════════════════════════════════════ */

export const OURA_BASE = "/oura/usercollection";

// Append the Oura PAT as a `_t` URL query parameter. We do this — rather than
// send it in an Authorization or X-Oura-Auth header — so the request stays a
// CORS "simple" GET that doesn't trigger an OPTIONS preflight. The
// ideaflow.page gateway intercepts preflights and answers them itself without
// an `Access-Control-Allow-Origin` header, which would otherwise break every
// cross-origin caller (most notably the Capacitor iOS app at Ori://localhost).
// HTTPS still encrypts the full URL on the wire, server logs strip `_t`, and
// the URL never enters browser history (it's a fetch, not a navigation).
function withOuraAuth(url, token) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_t=${encodeURIComponent(token)}`;
}
export const OURA_CLIENT_KEY = "cpi_oura_client_id";
export const OURA_ACCESS_KEY = "cpi_oura_access_token";
export const OURA_REFRESH_KEY = "cpi_oura_refresh_token";
export const OURA_EXPIRES_KEY = "cpi_oura_expires_at";
export const OURA_HISTORY_KEY = "cpi_oura_history";
export const OURA_LAST_SYNC_KEY = "cpi_oura_last_sync";
// High-water mark: ISO date (YYYY-MM-DD) of the most recent successful sync.
// Subsequent syncs use it to pull only the delta, not the full 180-day window.
export const OURA_HWM_KEY = "cpi_oura_hwm";
export const OURA_SYNC_DAYS = 180;
// 2-day overlap on the trailing edge of incremental syncs — Oura sometimes
// finalizes a previous day's score after midnight, so re-pulling the last
// couple of days catches late updates cheaply.
export const OURA_HWM_OVERLAP_DAYS = 2;

// Decide the fetch window for the next sync. If we have a high-water mark,
// pull from (HWM - overlap) through today. Otherwise fall back to the full
// initial window (first connect). Returns ISO date strings.
export function ouraSyncWindow() {
  const fmt = (d) => d.toISOString().slice(0, 10);
  const end = new Date();
  try {
    const hwm = localStorage.getItem(OURA_HWM_KEY);
    if (hwm) {
      const start = new Date(new Date(hwm).getTime() - OURA_HWM_OVERLAP_DAYS * 86400000);
      return { start: fmt(start), end: fmt(end), incremental: true };
    }
  } catch { /* ignore */ }
  const start = new Date(end.getTime() - OURA_SYNC_DAYS * 86400000);
  return { start: fmt(start), end: fmt(end), incremental: false };
}

// Per-field source preferences for the dual-wearable merge. Backed by the
// 2024-25 validation literature comparing Oura ring vs Apple Watch
// against PSG (sleep), chest-strap ECG (HRV), and research-grade
// pedometers (steps). Fields NOT listed here retain the legacy
// "Oura wins by default" — Oura still has the deeper biometric surface
// for sleep, HRV, and resting-heart-rate signals.
//
// Apple Watch wins (better evidence): step count (Apple ~0.034% error
// vs ActivPAL; Oura under-counts because finger-mounted), flights
// climbed, distance walking/running, active exercise minutes.
//
// activeKcal is handled specially in the merge — Apple Watch wins on
// days that have a tagged workout (continuous wrist HR during exercise);
// Oura is preferred for daily total EE on rest days.
export const APPLE_PRIORITY_FIELDS = new Set([
  "steps", "flights", "distanceKm", "activeMinutes",
]);

// "Do these two sources agree?" tolerance per field. abs is an absolute
// delta in the field's unit (minutes, ms, bpm, decimal fraction for spo2).
// rel is a relative delta (fraction of the larger value) used for activity
// volumes whose absolute magnitude varies day-to-day.
const AH_OURA_AGREEMENT_TOLERANCE = {
  totalSleepMin: { abs: 20 },
  deepSleepMin:  { abs: 20 },
  remSleepMin:   { abs: 20 },
  avgHRV:        { abs: 5 },
  restingHR:     { abs: 3 },
  avgHR:         { abs: 4 },
  respiratoryRate: { abs: 1 },
  spo2Avg:       { abs: 0.01 },
  steps:         { rel: 0.15 },
  flights:       { rel: 0.20 },
  distanceKm:    { rel: 0.15 },
  activeKcal:    { rel: 0.15 },
};

function ahOuraFieldsAgree(field, a, b) {
  const t = AH_OURA_AGREEMENT_TOLERANCE[field];
  if (!t) return null;
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (typeof t.abs === "number") return Math.abs(a - b) <= t.abs;
  if (typeof t.rel === "number") {
    const denom = Math.max(Math.abs(a), Math.abs(b), 1);
    return Math.abs(a - b) / denom <= t.rel;
  }
  return null;
}

// Merge a fresh Oura historyMap (from a sync) into the stored historyMap,
// preserving older days we already have. Per-day field-level merge: new
// values win when present, existing values are kept where the fresh map has
// gaps. APPLE_PRIORITY_FIELDS that Apple Health already populated are NOT
// overwritten by a subsequent Oura sync — Apple wins steps even if Oura
// re-syncs after Apple. Source attribution is recorded on `_sources`
// so the UI can label each field correctly.
export function mergeOuraHistory(existing, incoming) {
  const merged = { ...(existing || {}) };
  for (const [date, entry] of Object.entries(incoming || {})) {
    const cur = merged[date] || {};
    const sources = { ...(cur._sources || {}) };
    const out = { ...cur };
    for (const [k, v] of Object.entries(entry)) {
      if (k === "_sources" || k === "_agreement") continue;
      if (v == null) continue;
      // Apple holds an Apple-priority field for this day → don't let Oura overwrite.
      if (APPLE_PRIORITY_FIELDS.has(k) && sources[k] === "apple-health" && cur[k] != null) continue;
      out[k] = v;
      // Don't claim a source for `date` / `source` plumbing fields.
      if (k !== "date" && k !== "source") sources[k] = "oura";
    }
    out._sources = sources;
    merged[date] = out;
  }
  return merged;
}

export function recordOuraHwm(date = new Date()) {
  try { localStorage.setItem(OURA_HWM_KEY, date.toISOString().slice(0, 10)); } catch { /* ignore */ }
}

// Apple Health native sync uses the same high-water-mark pattern as Oura.
// 180-day initial backfill (covers about half a year of sleep + HRV +
// activity, enough for the rolling 28-day baseline and longer-arc pattern
// detection), 2-day trailing overlap on subsequent syncs to catch
// late-finalized sleep sessions (Watch finalizes stages overnight,
// retroactive sleep edits via Health app, etc.).
export const AH_HWM_KEY = "cpi_ah_hwm";
export const AH_SYNC_DAYS = 180;
export const AH_HWM_OVERLAP_DAYS = 2;
export function ahSyncWindow() {
  const fmt = (d) => d.toISOString().slice(0, 10);
  const end = new Date();
  try {
    const hwm = localStorage.getItem(AH_HWM_KEY);
    if (hwm) {
      const start = new Date(new Date(hwm).getTime() - AH_HWM_OVERLAP_DAYS * 86400000);
      return { start: fmt(start), end: fmt(end), incremental: true };
    }
  } catch { /* ignore */ }
  const start = new Date(end.getTime() - AH_SYNC_DAYS * 86400000);
  return { start: fmt(start), end: fmt(end), incremental: false };
}
export function recordAhHwm(date = new Date()) {
  try { localStorage.setItem(AH_HWM_KEY, date.toISOString().slice(0, 10)); } catch { /* ignore */ }
}

export const BIOMETRICS_KEY = "cpi_biometrics";
export const LIFESTYLE_KEY = "cpi_lifestyle";
export const CHRONO_KEY = "cpi_chronotype";
export const CHECKIN_KEY = "cpi_checkin"; // KSS + PSS-4 + PVT-B
// "full" (default, biometric-led) or "reflect" (journal + cognition led,
// lighter biometric surface, shown to users whose only source is Apple
// Health — where wrist HRV is too noisy to support a trustworthy
// Recovery/Readiness composite).
export const MODE_KEY = "cpi_mode";

// Capability matrix — single source of truth for what each mode is allowed
// to read into LLM prompts (and, in Pass 2, fetch from Oura). A field that
// isn't on Reflect's whitelist gets stripped before the prompt is built,
// so wrist-derived signals never reach Claude even when Oura is still
// connected and the data sits in local storage. The transparency banner
// users see in Reflect mode points at this list as its literal contract.
//
// To add a new mode or a new sensor: edit this matrix, nothing else.
export const MODE_CAPABILITIES = {
  full: {
    // bodyContextFields === "all" means no filtering — every field with a
    // value gets emitted to the prompt.
    bodyContextFields: "all",
    // ouraEndpointKeys === "all" means fetch every endpoint defined in
    // OURA_ENDPOINTS (Pass 2 gating).
    ouraEndpointKeys: "all",
  },
  reflect: {
    // Whitelist. Phone-detectable signals only — anything that needs a
    // wrist sensor (HRV, RHR, respiratory rate, sleep stages, wrist temp,
    // composite scores) is intentionally absent.
    bodyContextFields: new Set([
      "totalSleepMin",       // phone-detectable via Apple Health, or raw Oura duration
      "steps", "activeMinutes",
      "mindfulMinutes",
    ]),
    // Oura endpoints worth fetching in Reflect:
    //  - daily_activity: phone-coprocessor data (steps, active minutes)
    //  - rest_mode_period: user-set annotation (illness/travel flag), not a sensor reading
    // Every other endpoint is wrist-derived and would only be discarded
    // downstream by the body-context gate, so we skip the network call.
    ouraEndpointKeys: new Set(["daily_activity", "rest_mode_period"]),
  },
};

export function isFieldAllowed(mode, field) {
  const cap = MODE_CAPABILITIES[mode] || MODE_CAPABILITIES.full;
  if (cap.bodyContextFields === "all") return true;
  return cap.bodyContextFields.has(field);
}

export function canFetchOuraEndpoint(mode, endpointKey) {
  const cap = MODE_CAPABILITIES[mode] || MODE_CAPABILITIES.full;
  if (cap.ouraEndpointKeys === "all") return true;
  return cap.ouraEndpointKeys.has(endpointKey);
}

// First-run welcome. `cpi_welcome_done` gates the whole app behind the
// Name-Your-Garden opener on a fresh install. Gardenname + reflect time are
// captured in that flow and read by the dashboard greeting / reflection
// scheduler.
export const WELCOME_DONE_KEY = "cpi_welcome_done";
export const GARDEN_NAME_KEY = "cpi_garden_name";
export const REFLECT_TIME_KEY = "cpi_reflect_time";

// Anonymous device identifier and optional user age — used for future
// anonymous data analysis (Path B validation study). The ID is a random
// v4 UUID generated once per install, stored locally, never linked to
// name/email/phone. Age is an optional integer the user can set in
// Settings; HCPI math doesn't read it yet (no age-bucketed calibration
// until we have anonymous cohort data), but new entries carry an
// `ageAtEntry` snapshot so a future calibration pass can age-bucket
// historical data without losing it to schema migration.
export const ANON_DEVICE_ID_KEY = "cpi_anon_device_id";
export const USER_AGE_KEY = "cpi_user_age";

// Returns the stored anonymous device ID, generating one on first call.
// Idempotent — subsequent calls return the same UUID. Falls back to a
// Math.random()-based ID on the off chance crypto.randomUUID isn't
// available (e.g., older WebView), but the prefix lets future analysis
// distinguish strong vs weak IDs if it ever matters.
export function getOrCreateAnonId() {
  try {
    const existing = localStorage.getItem(ANON_DEVICE_ID_KEY);
    if (existing) return existing;
    let id;
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      id = crypto.randomUUID();
    } else {
      id = "weak-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
    localStorage.setItem(ANON_DEVICE_ID_KEY, id);
    return id;
  } catch {
    return null;
  }
}

// Reads the optional user-provided age. Returns null if unset or invalid.
// Range guard 5–120 to catch typos without being pedantic about edge cases.
export function getUserAge() {
  try {
    const raw = localStorage.getItem(USER_AGE_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 5 || n > 120) return null;
    return n;
  } catch { return null; }
}

// Builds a compact per-entry snapshot of everything that fed HCPI for
// that moment — used so each stored entry is self-contained for future
// anonymous analysis (Path B). Pulls only the fields that actually
// drive E0/M/chronoMod; the full Oura/Apple Health blob lives elsewhere
// keyed by date. Returns null when nothing useful is available.
export function buildEntrySnapshot(biometrics, biometricTrends) {
  if (!biometrics && !biometricTrends) return null;
  const b = biometrics || {};
  const t = biometricTrends || {};
  const snap = {
    // Score-level inputs to E0
    sleepScore: b.sleepScore ?? null,
    readinessScore: b.readinessScore ?? null,
    // Raw biometrics that feed E0 directly
    avgHRV: b.avgHRV ?? null,
    restingHR: b.restingHR ?? null,
    totalSleepMin: b.totalSleepMin ?? null,
    deepSleepMin: b.deepSleepMin ?? null,
    // Newly-wired underused Oura fields
    sleepEfficiency: b.sleepEfficiency ?? null,
    latencyMin: b.latencyMin ?? null,
    stressHighSec: b.stressHighSec ?? null,
    recoveryIndex: b.readinessContributors?.recovery_index ?? null,
    // Sleep-timing for SRI re-derivation
    bedtimeStart: b.bedtimeStart ?? null,
    bedtimeEnd: b.bedtimeEnd ?? null,
    // Derived trends (computed elsewhere, captured here so the entry stands alone)
    sri7d: t.sri ?? b.sri7d ?? null,
    sleepDebt7d: t.sleepDebtH ?? b.sleepDebt7d ?? null,
  };
  // Drop the entry entirely if nothing useful is present — keeps storage
  // clean when a user has no wearable and hasn't filled out manual data.
  const hasAny = Object.values(snap).some(v => v != null);
  return hasAny ? snap : null;
}

// Validated cognitive self-reports.
// KSS: Åkerstedt 1990 — 1 (extremely alert) to 9 (fighting sleep)
// PSS-4: Cohen 1988 — 4 items, items 2 & 3 reverse-scored, total 0-16
// PVT-B: Dinges 1985 — reaction-time test; we measure mean RT, lapses (>500ms), fastest 10%
/* Circadian context for cognitive tests.
   KSS and PVT are acutely sensitive to time-since-wake — reaction time
   is ~30 ms faster at midday than just-after-waking; KSS swings ~2
   points across the day. Without stamping each measurement with how
   long the user has been awake, future trend views would confuse
   circadian variation for trend signal. We pull wake-time from the
   most recent wearable `bedtimeEnd` (Oura or Apple-Health-derived) —
   no extra prompt required. Returns null when no wearable-derived
   wake time is available in the last ~28 hours (honest absence). */
export function minutesSinceLastWake(historyMap) {
  if (!historyMap) return null;
  const now = Date.now();
  const dates = Object.keys(historyMap).sort().reverse().slice(0, 3);
  for (const d of dates) {
    const be = historyMap[d]?.bedtimeEnd;
    if (!be) continue;
    const wakeMs = new Date(be).getTime();
    const delta = now - wakeMs;
    if (delta < 0 || delta > 28 * 60 * 60 * 1000) continue;
    return Math.round(delta / 60000);
  }
  return null;
}

export function formatAwake(mins) {
  if (typeof mins !== "number" || mins < 0) return null;
  if (mins < 60) return `${mins}m awake`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m < 5 ? `${h}h awake` : `${h}h ${m}m awake`;
}

// SELF_RATE_ANCHORS / selfRateAnchor imported from ./knowledge-base.js.

export function loadCheckin() {
  try { return JSON.parse(localStorage.getItem(CHECKIN_KEY) || "{}"); } catch { return {}; }
}
export function saveCheckin(next) { localStorage.setItem(CHECKIN_KEY, JSON.stringify(next)); }

export function pss4Score(items) {
  // items is [q1, q2, q3, q4], each 0-4. Q2 and Q3 are positively worded → reverse.
  if (!items || items.length !== 4) return null;
  return items[0] + (4 - items[1]) + (4 - items[2]) + items[3];
}

export function timeAgo(iso) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

// Status codes worth retrying. 429 = rate limit. 408/500/502/503/504 = transient
// gateway/upstream hiccups. Our ideaflow.page gateway caps requests at ~30s and
// returns 504 on slow Oura endpoints (SpO2 especially) — retrying after a short
// backoff usually succeeds.
export const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
// Fire a client-side abort 5s below the gateway's ~30s cap so we get a clean
// AbortError we can retry, rather than a raw 504 after the gateway kills us.
export const FETCH_TIMEOUT_MS = 25000;

// Anthropic-specific retryable codes. Same transient set as Oura plus 529
// ("overloaded_error") which Anthropic returns when their infra is briefly
// saturated. A few-second backoff almost always clears it.
const ANTHROPIC_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

// NO client-side timeout on model calls. Letter/analysis generation can take as
// long as it needs — it normally runs in the background, and a rare manual
// "read it now" can wait however long. A client timeout only ever aborted our
// own in-flight request and produced a dead button while the server was still
// working, so we don't impose one.

// Shared wrapper for every /proxy/anthropic call.
//   - Retries ONLY on explicit transient HTTP statuses (the set above).
//   - No client-side timeout — we let the request run to completion.
//   - Honors Retry-After on 429/529, exponential backoff (1s/2s/4s +
//     jitter) otherwise.
//   - On final failure throws "Claude API {status}: {body}" so the
//     FriendlyApiErrorV5 parser keeps working unchanged.
export async function fetchAnthropicWithRetry(body, { maxRetries = 2 } = {}) {
  let attempt = 0;
  while (true) {
    let res;
    try {
      res = await fetch("/proxy/anthropic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      // Genuine network error (no client timeout aborts us anymore). Surfaced,
      // not retried — the server may still be processing and a retry would race
      // the in-flight call and double-bill credits.
      throw e;
    }
    if (res.ok) return await res.json();
    if (!ANTHROPIC_RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Claude API ${res.status}: ${errText.slice(0, 200) || res.statusText}`);
    }
    const retryAfterSec = parseInt(res.headers.get("retry-after") || "", 10);
    const useRetryAfter = (res.status === 429 || res.status === 529)
      && Number.isFinite(retryAfterSec) && retryAfterSec > 0;
    const wait = useRetryAfter
      ? Math.min(30000, retryAfterSec * 1000)
      : Math.min(30000, (2 ** attempt) * 1000 + Math.floor(Math.random() * 500));
    await new Promise(r => setTimeout(r, wait));
    attempt++;
  }
}

export async function fetchPaginated(baseUrl, token, { maxRetries = 3 } = {}) {
  const authedBase = withOuraAuth(baseUrl, token);
  const all = [];
  let nextToken = null;
  let safety = 0;
  do {
    // authedBase already has at least one query param (`_t`), so always `&`.
    const url = nextToken ? `${authedBase}&next_token=${encodeURIComponent(nextToken)}` : authedBase;
    let res;
    let attempt = 0;
    // Fetch + retry loop for transient failures (429/408/5xx and client-side
    // AbortError from our 25s timeout). Honor Retry-After on 429 when present;
    // otherwise exponential backoff (1s, 2s, 4s) with jitter. After maxRetries
    // we bubble the last error up to the outer handler.
    let lastTransient = null;
    while (true) {
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        lastTransient = null;
      } catch (e) {
        // AbortError from our timeout is retryable; real network errors are not.
        const isAbort = e?.name === "AbortError" || e?.name === "TimeoutError";
        if (isAbort && attempt < maxRetries) {
          lastTransient = e;
          const backoffMs = Math.min(30000, (2 ** attempt) * 1000 + Math.floor(Math.random() * 500));
          await new Promise((r) => setTimeout(r, backoffMs));
          attempt++;
          continue;
        }
        const msg = e?.message || "";
        if (isAbort) throw new Error("timeout — Oura response took too long, try again");
        if (msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("network")) {
          throw new Error("network/CORS — check connection, token, or try reconnecting");
        }
        throw e;
      }
      if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) break;
      const retryAfterSec = parseInt(res.headers.get("retry-after") || "", 10);
      // Only trust Retry-After on 429 (rate limits). On 5xx it's often bogus
      // or missing — use exponential backoff instead.
      const useRetryAfter = res.status === 429 && Number.isFinite(retryAfterSec) && retryAfterSec > 0;
      const backoffMs = useRetryAfter
        ? Math.min(30000, retryAfterSec * 1000)
        : Math.min(30000, (2 ** attempt) * 1000 + Math.floor(Math.random() * 500));
      await new Promise((r) => setTimeout(r, backoffMs));
      attempt++;
    }
    if (!res.ok) {
      if (res.status === 404 || res.status === 422) return all;
      // Attach status to the thrown error so callers can distinguish "bad
      // token" (401 + probe also 401s) from "endpoint not available for this
      // Oura account" (401 on optional endpoint, probe still OK).
      let err;
      if (res.status === 401) err = new Error("token expired — disconnect & reconnect Oura");
      else if (res.status === 429) err = new Error("rate limited by Oura — wait a minute and retry");
      else if (res.status >= 500) err = new Error(`Oura/gateway ${res.status} — retried ${maxRetries}x, try again in a minute`);
      else err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const d = await res.json();
    if (Array.isArray(d.data)) all.push(...d.data);
    nextToken = d.next_token || null;
    safety++;
  } while (nextToken && safety < 40);
  return all;
}

// Split [startDate..endDate] (inclusive) into consecutive sub-ranges of at most
// `days` days. Used for endpoints like daily_spo2 that time out under the
// gateway's ~30s cap on long ranges. Adjacent chunks have non-overlapping day
// boundaries, and the endpoint's own merge step de-dups by the date key.
export function chunkDateRange(startDate, endDate, days = 30) {
  const chunks = [];
  const toD = (s) => new Date(`${s}T00:00:00Z`);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const end = toD(endDate);
  let cur = toD(startDate);
  while (cur <= end) {
    const next = new Date(cur.getTime() + (days - 1) * 86400000);
    const chunkEnd = next > end ? end : next;
    chunks.push({ start: fmt(cur), end: fmt(chunkEnd) });
    cur = new Date(chunkEnd.getTime() + 86400000);
  }
  return chunks;
}

// Merge a single endpoint's `data` array into the per-day output map using the
// endpoint's pick / filter / accumulate rules. Pulled out of fetchOuraRange so
// both the bulk sync and the paint-today-first path can share it.
export function mergeOuraEndpointEntries(out, ep, entries) {
  for (const entry of entries) {
    if (ep.filter && !ep.filter(entry)) continue;
    const date = entry[ep.dateKey];
    if (!date) continue;
    // Tag every Oura-originated day with `source: "oura"` so the merge with
    // Apple Health below can produce honest labels ("oura+apple-health" when
    // both contributed). Without this tag, mergeAppleHealthIntoHistory falls
    // into its falsy-source branch and labels combined days as "apple-health"
    // alone, which then surfaces in the UI as a wrong-device source line.
    if (!out[date]) out[date] = { date, source: "oura" };
    const picked = ep.pick(entry);
    if (ep.expandRange) {
      // For period endpoints (rest_mode_period). The API returns a span
      // {start_day, end_day}; we write the picked fields onto every day
      // in the inclusive range so the per-day historyMap stays consistent.
      // If end_day is null/undefined, the period is still open — expand
      // through today.
      const startStr = entry.start_day || date;
      const endStr = entry.end_day || new Date().toISOString().slice(0, 10);
      const start = new Date(startStr + "T00:00:00");
      const end = new Date(endStr + "T00:00:00");
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
          const k = new Date(t).toISOString().slice(0, 10);
          if (!out[k]) out[k] = { date: k, source: "oura" };
          for (const [kk, vv] of Object.entries(picked)) {
            if (vv != null) out[k][kk] = vv;
          }
        }
      }
    } else if (ep.accumulate) {
      if (!out[date][ep.accumulate]) out[date][ep.accumulate] = [];
      if (picked.tag) out[date][ep.accumulate].push(picked.tag);
    } else if (ep.pickLongest) {
      // Some endpoints (notably `sleep`) return multiple sessions per day — a
      // nap and the main night sleep. Default first-write-wins can latch onto
      // a 45-min nap and block the real 7-hour session. For these, keep the
      // session with the largest value of `pickLongest` and overwrite the
      // other fields from that same session so the day's record is coherent.
      const existingBest = typeof out[date][ep.pickLongest] === "number" ? out[date][ep.pickLongest] : 0;
      const incomingBest = typeof picked[ep.pickLongest] === "number" ? picked[ep.pickLongest] : 0;
      if (incomingBest > existingBest) {
        for (const [k, v] of Object.entries(picked)) {
          if (v != null) out[date][k] = v;
        }
      }
    } else {
      for (const [k, v] of Object.entries(picked)) {
        if (v != null && (out[date][k] == null)) out[date][k] = v;
      }
    }
  }
}

// Per-endpoint policy. `required` endpoints surface errors; `optional` ones
// silently cache unavailability on 401 for 24h. `chunkDays` splits long date
// ranges into parallel sub-requests so no single call nears the gateway cap.
// Window sizes chosen from community experience: heartrate is sample-level
// (smallest), spo2 is dense, sleep paginates on nap-heavy users.
export const OURA_ENDPOINTS = [
  { key: "daily_sleep", path: "daily_sleep", dateKey: "day", required: true, chunkDays: 90, pick: (e) => ({ sleepScore: e.score ?? null, sleepContributors: e.contributors || null, hrvBalance: e.contributors?.hrv_balance ?? null }) },
  { key: "daily_readiness", path: "daily_readiness", dateKey: "day", required: true, chunkDays: 90, pick: (e) => ({ readinessScore: e.score ?? null, readinessContributors: e.contributors || null, restingHR: e.contributors?.resting_heart_rate ?? null, temperatureDeviation: e.temperature_deviation ?? null, temperatureTrendDeviation: e.temperature_trend_deviation ?? null }) },
  { key: "daily_activity", path: "daily_activity", dateKey: "day", required: true, chunkDays: 90, pick: (e) => ({ activityScore: e.score ?? null, steps: e.steps ?? null, activeMinutes: (e.high_activity_time ?? 0) + (e.medium_activity_time ?? 0), sedentaryTime: e.sedentary_time ?? null, totalCalories: e.total_calories ?? null }) },
  { key: "sleep", path: "sleep", dateKey: "day", required: true, chunkDays: 60, pickLongest: "totalSleepMin", filter: (s) => s.type === "long_sleep" || s.type === "sleep", pick: (e) => ({ avgHRV: e.average_hrv ?? null, avgHR: e.average_heart_rate ?? null, lowestHR: e.lowest_heart_rate ?? null, sleepEfficiency: e.efficiency ?? null, deepSleepMin: e.deep_sleep_duration ? Math.round(e.deep_sleep_duration / 60) : null, remSleepMin: e.rem_sleep_duration ? Math.round(e.rem_sleep_duration / 60) : null, lightSleepMin: e.light_sleep_duration ? Math.round(e.light_sleep_duration / 60) : null, totalSleepMin: e.total_sleep_duration ? Math.round(e.total_sleep_duration / 60) : null, latencyMin: e.latency ? Math.round(e.latency / 60) : null, respiratoryRate: e.average_breath ?? null, bedtimeStart: e.bedtime_start ?? null, bedtimeEnd: e.bedtime_end ?? null }) },
  { key: "daily_stress", path: "daily_stress", dateKey: "day", optional: true, chunkDays: 90, pick: (e) => ({ stressHighSec: e.stress_high ?? null, recoveryHighSec: e.recovery_high ?? null, stressDaySummary: e.day_summary ?? null }) },
  { key: "daily_spo2", path: "daily_spo2", dateKey: "day", optional: true, chunkDays: 30, pick: (e) => ({ spo2Avg: e.spo2_percentage?.average ?? null }) },
  { key: "daily_resilience", path: "daily_resilience", dateKey: "day", optional: true, chunkDays: 90, pick: (e) => ({ resilienceLevel: e.level ?? null, resilienceContributors: e.contributors || null }) },
  // enhanced_tag replaces the legacy `tag` endpoint. The legacy model only
  // exposed free-text `text`; enhanced_tag adds structured `tag_type_code`,
  // user-set `custom_name`, `comment`, and proper `start_day`/`end_day`
  // spans for multi-day tags. We accumulate the human label per start_day —
  // multi-day handling is a follow-up if/when downstream code reads tags.
  { key: "enhanced_tag", path: "enhanced_tag", dateKey: "start_day", optional: true, chunkDays: 180, accumulate: "tags", pick: (e) => ({ tag: e.custom_name || e.tag_type_code || e.comment || null }) },

  // sleep_time gives Oura's recommended bedtime window for each day.
  // optimal_bedtime is an object {start_offset, end_offset, day_tz} —
  // offsets are seconds from local midnight. We store the raw object and
  // format on render so the user sees their own clock time.
  { key: "sleep_time", path: "sleep_time", dateKey: "day", optional: true, chunkDays: 90, pick: (e) => ({ optimalBedtime: e.optimal_bedtime || null, bedtimeStatus: e.status ?? null, bedtimeRecommendation: e.recommendation ?? null }) },

  // rest_mode_period covers user-flagged illness/travel windows. The API
  // returns periods (start_day → end_day); we expand each into its
  // constituent days so the per-day historyMap can carry restMode=true
  // on each affected day. Downstream consumers can then exclude those
  // days from averages without re-reading periods.
  { key: "rest_mode_period", path: "rest_mode_period", dateKey: "start_day", optional: true, chunkDays: 180, expandRange: true, pick: (e) => ({ restMode: true }) },
];

// Format Oura's optimal_bedtime { start_offset, end_offset, day_tz } as a
// human-readable bedtime string ("10:43 PM"). Returns null when the
// object is missing or malformed. start_offset/end_offset are seconds
// from local midnight; we use start_offset as the "aim for" time.
export function formatOptimalBedtime(ob) {
  if (!ob || typeof ob.start_offset !== "number") return null;
  const totalSec = ob.start_offset;
  const h24 = Math.floor(totalSec / 3600) % 24;
  const m = Math.floor((totalSec % 3600) / 60);
  const sfx = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${sfx}`;
}

// Returns YYYY-MM-DD strings for rest-mode days within the last `days`
// calendar days. Reads the same historyMap the rest of the app uses so
// the answer reflects whatever's been synced. Up to the caller to pick
// the slice (e.g. last 7 vs last 14).
export function restDaysInWindow(historyMap, days = 7) {
  const out = [];
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    if (historyMap?.[k]?.restMode) out.push(k);
  }
  return out.sort();
}

// ── Endpoint unavailability cache ───────────────────────────────────────
// Some Oura endpoints 401 not because the token is bad, but because the user
// hasn't enabled that feature on their ring (daily_resilience and
// daily_stress need an active Oura membership). Retrying them every sync
// floods the console with 401s and
// wastes quota. Pattern (per research): on the FIRST 401 for an optional
// endpoint, probe /personal_info with the same token. If the probe
// succeeds, the token is fine and it's the endpoint that's gated — cache
// "unavailable" for 24h and stop asking. If the probe ALSO 401s, the token
// is bad — bubble up so the user re-connects.
export const OURA_UNAVAILABLE_KEY = "cpi_oura_unavailable_eps";
export const OURA_UNAVAILABLE_TTL_MS = 24 * 60 * 60 * 1000;

export function getUnavailableOuraEndpoints() {
  try {
    const raw = localStorage.getItem(OURA_UNAVAILABLE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    const now = Date.now();
    // Drop stale entries so we try them again after 24h.
    const fresh = {};
    for (const [k, ts] of Object.entries(obj)) {
      if (typeof ts === "number" && now - ts < OURA_UNAVAILABLE_TTL_MS) fresh[k] = ts;
    }
    return fresh;
  } catch { return {}; }
}
export function markOuraEndpointUnavailable(key) {
  const cur = getUnavailableOuraEndpoints();
  cur[key] = Date.now();
  try { localStorage.setItem(OURA_UNAVAILABLE_KEY, JSON.stringify(cur)); } catch { /* ignore */ }
}
export function isOuraEndpointUnavailable(key) {
  return Object.prototype.hasOwnProperty.call(getUnavailableOuraEndpoints(), key);
}

// Probe known-good endpoint to distinguish bad-token from endpoint-gated.
// Returns true if the token works, false if even /personal_info 401s.
export async function probeOuraToken(token) {
  try {
    const res = await fetch(withOuraAuth(`${OURA_BASE}/personal_info`, token), {
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch { return true; /* network blip — don't wrongly invalidate the token */ }
}

export async function fetchOuraRange(token, startDate, endDate, onProgress = () => {}, options = {}) {
  // mode gates which endpoints we hit. In Reflect we only pull
  // daily_activity (phone-coprocessor) and rest_mode_period (annotation).
  // Pulling more would waste rate-limit budget and store data the body-
  // context gate would just throw away downstream.
  const { mode = "full" } = options;
  const endpoints = OURA_ENDPOINTS.filter((ep) => canFetchOuraEndpoint(mode, ep.key));

  // Token rides as a `_t` URL query parameter (see withOuraAuth above) — we
  // send no Authorization or X-Oura-Auth header so the request stays a CORS
  // simple GET (no preflight). The proxy reads `_t`, strips it before
  // forwarding to Oura, and rebuilds the Authorization header server-side.

  // Fire all mode-allowed endpoints in parallel. Oura's rate limit is
  // 5000 req/5 min (~16/sec); even at the Full-mode fanout of 10 this
  // peaks at <1% of budget. Total wall time drops from sum(endpoint
  // durations) to max(endpoint durations).
  //
  // We merge each endpoint's data into `out` as soon as it resolves and
  // invoke onProgress with the current `partialMap`, so callers doing
  // paint-today-first (connectOura) can push biometrics the moment
  // daily_sleep / daily_readiness come back — without waiting on slower
  // endpoints like daily_activity or sleep-stage-level data.
  const out = {};
  const errors = [];
  let completed = 0;
  const total = endpoints.length;
  onProgress({ step: "fetching", done: 0, total, partialMap: out });

  // One-shot token probe shared across the fanout. When the first endpoint
  // sees a 401, we probe /personal_info ONCE; subsequent 401s reuse the
  // result so we don't fire N probes when a token is genuinely bad.
  let probePromise = null;
  const tokenStillValid = () => {
    if (!probePromise) probePromise = probeOuraToken(token);
    return probePromise;
  };

  await Promise.all(
    endpoints.map(async (ep) => {
      // Skip optional endpoints we've already confirmed unavailable in the
      // last 24h (e.g. daily_resilience for users without Oura membership).
      if (ep.optional && isOuraEndpointUnavailable(ep.key)) {
        completed++;
        onProgress({ step: `${ep.key} (skipped)`, done: completed, total, partialMap: out });
        return;
      }
      try {
        if (ep.chunkDays) {
          // Fan the date range into parallel sub-requests so no single call
          // nears the gateway's ~30s cap. Required for daily_sleep (flagship
          // endpoint, 90d), sleep (nap-heavy, 60d), and daily_spo2 (densest
          // sample data, 30d).
          const chunks = chunkDateRange(startDate, endDate, ep.chunkDays);
          const perChunk = await Promise.all(
            chunks.map(({ start, end }) =>
              fetchPaginated(`${OURA_BASE}/${ep.path}?start_date=${start}&end_date=${end}`, token)
            )
          );
          mergeOuraEndpointEntries(out, ep, perChunk.flat());
        } else {
          const url = `${OURA_BASE}/${ep.path}?start_date=${startDate}&end_date=${endDate}`;
          const entries = await fetchPaginated(url, token);
          mergeOuraEndpointEntries(out, ep, entries);
        }
      } catch (e) {
        if (e?.status === 401 && ep.optional) {
          // Could be a bad token OR an endpoint the user doesn't have access
          // to. Probe /personal_info: if it works, token is fine and the
          // endpoint is gated — cache as unavailable for 24h and move on.
          const ok = await tokenStillValid();
          if (ok) markOuraEndpointUnavailable(ep.key);
          else errors.push(`${ep.key}: token expired — disconnect & reconnect Oura`);
        } else if (!ep.optional) {
          errors.push(`${ep.key}: ${e.message}`);
        }
        // Optional non-401 failures (spo2 504 etc.) are intentionally silent.
      }
      completed++;
      onProgress({ step: ep.key, done: completed, total, partialMap: out });
    })
  );

  onProgress({ step: "done", done: total, total, partialMap: out });
  if (Object.keys(out).length === 0 && errors.length > 0) {
    return { connected: false, error: errors.join("; ") };
  }
  return { connected: true, historyMap: out, daysFetched: Object.keys(out).length, errors };
}

export async function fetchOuraData(token, options = {}) {
  const today = new Date().toISOString().split("T")[0];
  const res = await fetchOuraRange(token, today, today, () => {}, options);
  if (!res.connected) return { connected: false, error: res.error };
  const today_d = res.historyMap[today] || {};
  return { ...today_d, connected: true };
}

export function median(vals) {
  const v = vals.filter((x) => typeof x === "number" && !isNaN(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 === 0 ? (v[m - 1] + v[m]) / 2 : v[m];
}

// Parity rule: Ori mirrors the wearable value verbatim. Manual entries only
// win when (a) Oura has no reading (gap fill) or (b) Oura's reading is flagged
// suspect by our own intelligence AND the user has provided a correction.
// Everywhere else the wearable value is what we display.
export function sleepMinFor(entry) {
  if (!entry) return null;
  const oura = entry.totalSleepMin;
  const manual = entry.manualSleepMin;
  if (typeof oura === "number" && !isSuspectSleep(entry)) return oura;
  if (typeof manual === "number") return manual;
  return typeof oura === "number" ? oura : null;
}
export function sleepSourceFor(entry) {
  if (!entry) return null;
  const oura = entry.totalSleepMin;
  const manual = entry.manualSleepMin;
  if (typeof oura === "number" && !isSuspectSleep(entry)) return "oura";
  if (typeof manual === "number") return "manual";
  if (typeof oura === "number") return "oura";
  return null;
}
// Banner trigger: Oura's reading looks off AND the user hasn't corrected it
// yet. When this is true, the UI prompts the user to override; if they
// ignore, the wearable value still displays (parity).
export function needsSleepReview(entry) {
  if (!entry) return false;
  if (!isSuspectSleep(entry)) return false;
  return entry.manualSleepMin == null;
}
// Score a manual sleep duration (minutes) + optional user 1–10 quality rating
// into the 0–100 sleepScore scale every downstream reader expects. The
// duration curve mirrors the Apple Health fallback formula used in the rest
// of the codebase (CPI.jsx:1783, engine.js:882) — piecewise so <7h is
// penalised harder than >8h:
//   h=4 → 35, h=5 → 50, h=6 → 65, h=7 → 80, h=8 → 95, h=9+ → 100
// Quality (1–10) nudges ±12 points around 7 as neutral. Kept in one helper so
// the manual→canonical promotion is consistent across the app.
export function manualSleepToScore(sleepMin, qual) {
  if (typeof sleepMin !== "number") return null;
  const h = sleepMin / 60;
  const duration = h < 7 ? Math.max(0, (h - 4) * 15 + 35) : Math.min(100, 80 + (h - 7) * 15);
  const q = typeof qual === "number" ? (qual - 7) * 4 : 0;
  return Math.round(Math.max(0, Math.min(100, duration + q)));
}

// Fold a manual overlay into the canonical fields (totalSleepMin, sleepScore)
// the rest of the app reads. Parity rule: the wearable value is shown
// verbatim when it's clean. Manual only promotes to canonical when either
//   (a) Oura has nothing at all (gap fill), or
//   (b) Oura's reading is suspect AND the user has provided a correction.
// A clean Oura reading is NEVER overwritten by a manual entry — we respect
// the source of truth. If the user disagrees with a clean reading, the UX
// path is to surface a review banner, not to silently swap values.
export function normalizeSleepEntry(entry) {
  if (!entry) return entry;
  const manual = entry.manualSleepMin;
  if (typeof manual !== "number") return entry;
  const patched = { ...entry };
  // Gap fill — no Oura data at all.
  if (patched.totalSleepMin == null) {
    patched.totalSleepMin = manual;
    if (patched.sleepScore == null) {
      const s = manualSleepToScore(manual, entry.manualSleepQual);
      if (s != null) patched.sleepScore = s;
    }
    return patched;
  }
  // Suspect correction — Oura logged something, but our detector flagged it
  // as likely ring-not-worn / napped. User has entered the real number.
  if (isSuspectSleep(entry)) {
    patched.totalSleepMin = manual;
    const s = manualSleepToScore(manual, entry.manualSleepQual);
    if (s != null) patched.sleepScore = s;
    return patched;
  }
  // Oura reading is clean — display it as-is. Manual is ignored at the
  // canonical-field level (kept on the entry so the user's note isn't lost,
  // but the parity rule means display + downstream scoring use Oura's value).
  return patched;
}

// Our app's independent suspect-reading detector. Runs on the wearable value
// itself — whether or not the user has added a manual correction. (A manual
// correction doesn't change the fact that Oura's reading WAS suspect; it just
// means the user has provided a trusted alternative we can display instead.)
// Heuristic: <3h of "main sleep" almost always means the ring wasn't worn or
// picked up a nap rather than the night. Independent of whether Oura's own
// sleep-detection algorithm flagged it — we do our own check.
export function isSuspectSleep(entry) {
  if (!entry) return false;
  const oura = entry.totalSleepMin;
  if (oura == null) return false;
  return oura < 180;
}

// Merges a manual overlay into a single day without touching Oura fields.
export function upsertManualDay(historyMap, date, overlay) {
  const map = { ...(historyMap || {}) };
  const existing = map[date] || { date };
  const safe = {};
  for (const [k, v] of Object.entries(overlay || {})) {
    if (k.startsWith("manual") && (v === null || typeof v === "number")) safe[k] = v;
  }
  map[date] = { ...existing, ...safe };
  // If all manual fields are null AND there are no oura fields, drop the day entirely.
  const has = Object.entries(map[date]).some(([k, v]) => k !== "date" && v != null && v !== "");
  if (!has) delete map[date];
  return map;
}

/* ─── Sleep Regularity Index (SRI) ──────────────────────────────────
   Phillips et al. 2017 (Scientific Reports) + Windred et al. 2023 (Sleep).
   The probability that any two time points 24h apart are in the same
   sleep/wake state, averaged over the recording window, scaled 0–100.
   100 = perfect regularity (identical sleep/wake times day to day);
   ≤70 = associated with worse mood, metabolic, and mortality outcomes
   in population studies.

   Implementation: for each day in the window, paint a 1440-minute bitmap
   (1 = asleep, 0 = awake) from `bedtimeStart`/`bedtimeEnd`. For each pair
   of consecutive days, count minutes where the two bitmaps match. The
   SRI is (200 × agreement) − 100, clamped to [0, 100].

   Requires `bedtimeStart` + `bedtimeEnd` ISO strings on each day (Oura
   provides them directly; Apple Health parsing derives them from the
   outermost Asleep-segment edges of the night). Needs ≥6 consecutive-day
   pairs to return a score — otherwise null. ─────────────────────────── */
export function computeSRI(historyMap, targetDateIso, windowDays = 14) {
  if (!historyMap) return null;
  const end = new Date((targetDateIso || new Date().toISOString().slice(0, 10)) + "T00:00:00");
  const spans = [];
  for (let i = 0; i <= windowDays; i++) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const e = historyMap[iso];
    if (!e || !e.bedtimeStart || !e.bedtimeEnd) continue;
    const s = new Date(e.bedtimeStart);
    const t = new Date(e.bedtimeEnd);
    if (!(s < t)) continue;
    spans.push({ start: s, stop: t });
  }
  if (spans.length < 6) return null;

  // Paint minute-level bitmaps keyed by local calendar date. Spans that
  // cross midnight naturally contribute to both days.
  const bitmaps = new Map();
  const isoLocal = (d) => {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  };
  for (const span of spans) {
    const cur = new Date(span.start);
    cur.setSeconds(0, 0);
    while (cur < span.stop) {
      const key = isoLocal(cur);
      if (!bitmaps.has(key)) bitmaps.set(key, new Uint8Array(1440));
      const m = cur.getHours() * 60 + cur.getMinutes();
      bitmaps.get(key)[m] = 1;
      cur.setTime(cur.getTime() + 60000);
    }
  }

  const days = Array.from(bitmaps.keys()).sort();
  let matches = 0, total = 0, pairs = 0;
  for (let i = 0; i < days.length - 1; i++) {
    const d1 = new Date(days[i] + "T00:00:00");
    const d2 = new Date(days[i + 1] + "T00:00:00");
    if (Math.round((d2 - d1) / 86400000) !== 1) continue;
    const a = bitmaps.get(days[i]);
    const b = bitmaps.get(days[i + 1]);
    pairs++;
    for (let m = 0; m < 1440; m++) {
      if (a[m] === b[m]) matches++;
      total++;
    }
  }
  if (pairs < 6 || total === 0) return null;
  const agreement = matches / total;
  const sri = Math.round(200 * agreement - 100);
  return { sri: Math.max(0, Math.min(100, sri)), nDays: pairs + 1 };
}

/* ─── Baseline status ────────────────────────────────────────────────
   Counts how many of the N prior days have each of the variables we
   depend on. Used to gate derived scores (Readiness, deltas) behind
   enough personal baseline to make the comparison non-noisy.

   Published floors:
     • Altini (HRV4Training): 7 days minimum for a working HRV baseline
     • Plews & Laursen: 7–10 days for meaningful trend analysis
     • Oura internal calibration: "~2 weeks to stabilize"
     • WHOOP: 7 days minimum before publishing recovery

   We use 7 days as the hard gate for publishing any score that depends
   on a z-score vs personal baseline. Below that, the card shows
   "Calibrating · X/7" instead of a number. Above it, the score is
   published and the calibration badge quietly disappears. No two-tier
   fuzz between 7 and 14 — one clean threshold. ─────────────────────── */
export const BASELINE_MIN_DAYS = 7;

export function computeBaselineStatus(historyMap, targetDateIso, windowDays = 14) {
  const out = { windowDays, hrvDays: 0, rhrDays: 0, sleepDays: 0, tempDays: 0, respDays: 0 };
  if (!historyMap) return out;
  const end = new Date((targetDateIso || new Date().toISOString().slice(0, 10)) + "T00:00:00");
  for (let i = 1; i <= windowDays; i++) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const e = historyMap[iso];
    if (!e) continue;
    if (typeof e.avgHRV === "number") out.hrvDays++;
    if (typeof e.restingHR === "number") out.rhrDays++;
    if (typeof e.totalSleepMin === "number") out.sleepDays++;
    if (typeof e.bodyTempAvg === "number" || typeof e.temperatureTrendDeviation === "number") out.tempDays++;
    if (typeof e.respiratoryRate === "number") out.respDays++;
  }
  // Readiness is published when at least one of the two heaviest-
  // weighted contributors (HRV, RHR — 40% + 25% = 65% of the blend)
  // has reached the threshold. If both are thin, we're calibrating.
  out.readinessCalibrated = out.hrvDays >= BASELINE_MIN_DAYS || out.rhrDays >= BASELINE_MIN_DAYS;
  out.recoveryCalibrated = out.hrvDays >= BASELINE_MIN_DAYS;
  return out;
}

export function computeBiometricTrends(historyMap, targetDate) {
  if (!historyMap || Object.keys(historyMap).length === 0) return null;
  const sorted = Object.keys(historyMap).sort();
  // If the target date isn't in the map (iPhone sync lag, stale export, etc.)
  // fall back to the most recent day that has data — better than returning null
  // and showing empty rings.
  let target = targetDate || sorted[sorted.length - 1];
  let idx = sorted.indexOf(target);
  if (idx < 0) { target = sorted[sorted.length - 1]; idx = sorted.length - 1; }

  // Normalize every entry so manually-entered sleep hours appear in the
  // canonical fields downstream readers look for (totalSleepMin, sleepScore).
  // Without this the overlay path is silently invisible to HCPI / E0 / the
  // hero Sleep tile — see CPI.jsx's saveManualOverlay path.
  const windowDays = (n) => sorted.slice(Math.max(0, idx - n + 1), idx + 1).map((d) => normalizeSleepEntry(historyMap[d]));
  const last7 = windowDays(7);
  const last14 = windowDays(14);
  const last21 = windowDays(21);
  const last30 = windowDays(30);

  const avgOf = (arr, key) => {
    const vals = arr.map((e) => e?.[key]).filter((v) => typeof v === "number");
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const sumOf = (arr, key) => arr.reduce((s, e) => s + (typeof e?.[key] === "number" ? e[key] : 0), 0);

  const today = normalizeSleepEntry(historyMap[target]) || {};
  // Sleep-debt: only counts days where sleep was actually measured. Otherwise
  // a week of empty day-shells (e.g. step-only entries) produces a spurious
  // "56 hours behind" — classic fabrication from missing-as-zero.
  const daysWithSleep7 = last7.filter((e) => typeof sleepMinFor(e) === "number" && sleepMinFor(e) > 0);
  const sleepMinSum7 = daysWithSleep7.reduce((s, e) => s + sleepMinFor(e), 0);
  const selfReportedDays7 = daysWithSleep7.filter((e) => sleepSourceFor(e) === "manual").length;
  // Require at least 3 measured nights; a 1- or 2-night average is too noisy
  // to call a "7-day debt". Below that threshold, it's honestly unknown.
  const sleepDebtH = daysWithSleep7.length >= 3 ? 8 * daysWithSleep7.length - sleepMinSum7 / 60 : null;
  // Slow sleep drift over ~3 weeks (the Drifts lens). Separate from the 7-day
  // sleepDebtH above (which HCPI/E0 read): Drifts is a SLOW signal, so it reads
  // a 21-night window and reports the signed per-night deviation from an 8h
  // norm (+ = short, − = surplus). Needs ≥7 measured nights to mean anything;
  // below that the lens honestly stays calibrating.
  const daysWithSleep21 = last21.filter((e) => typeof sleepMinFor(e) === "number" && sleepMinFor(e) > 0);
  const sleepDriftNights = daysWithSleep21.length;
  const sleepDriftPerNightH = sleepDriftNights >= 7
    ? 8 - (daysWithSleep21.reduce((s, e) => s + sleepMinFor(e), 0) / 60) / sleepDriftNights
    : null;
  const hrvBaseline30 = median(last30.map((e) => e?.avgHRV));
  const hrvDelta = hrvBaseline30 && typeof today.avgHRV === "number" ? ((today.avgHRV - hrvBaseline30) / hrvBaseline30) * 100 : null;
  const stress7 = avgOf(last7, "stressHighSec");
  const tempDev7 = avgOf(last7, "temperatureTrendDeviation");
  const readiness7 = avgOf(last7, "readinessScore");
  const readiness30 = avgOf(last30, "readinessScore");
  const sleepScore7 = avgOf(last7, "sleepScore");
  const rhr30 = median(last30.map((e) => e?.restingHR));
  const rhrDelta = rhr30 && typeof today.restingHR === "number" ? today.restingHR - rhr30 : null;

  const sriResult = computeSRI(historyMap, target, 14);
  const baselineStatus = computeBaselineStatus(historyMap, target, 14);

  return {
    today, sleepDebtH, sleepDriftPerNightH, sleepDriftNights, hrvBaseline30, hrvDelta, stress7, tempDev7, readiness7, readiness30, sleepScore7,
    rhr30, rhrDelta, daysSynced: sorted.length, windowStart: sorted[0], windowEnd: sorted[sorted.length - 1],
    selfReportedDays7,
    sri: sriResult?.sri ?? null,
    sriN: sriResult?.nDays ?? null,
    baselineStatus,
  };
}

export function formatBodyContext(trends, manualBiometrics, lifestyle, options = {}) {
  // mode gates which body fields reach the prompt. Reflect mode strips
  // wrist-derived signals (HRV, Readiness, Sleep score, etc.) even when
  // they exist in local storage — that's the contract the transparency
  // banner promises the user.
  const { mode = "full" } = options;
  const allowed = (field) => isFieldAllowed(mode, field);

  const fmt = (n, d = 0) => (typeof n === "number" ? n.toFixed(d) : "—");
  const signed = (n, d = 0) => (typeof n === "number" ? `${n >= 0 ? "+" : ""}${n.toFixed(d)}` : "—");
  const lines = [];
  // Merge biometrics state with trends.today so Apple-Health-populated days
  // feed the LLM even when the export doesn't include today's date yet.
  const mb = manualBiometrics || {};
  const t = { ...(trends?.today || {}) };
  for (const k of Object.keys(mb)) if (t[k] == null && mb[k] != null) t[k] = mb[k];
  const hasWearable = (t.sleepScore != null || t.readinessScore != null || t.avgHRV != null || t.totalSleepMin != null || t.restingHR != null);

  // Source-adaptive label — LoreCard was saying "Oura Ring" even when
  // the underlying data was Apple Health. Relabel based on actual source.
  const src = (t.source || mb.source || "").toLowerCase();
  const sourceLabel = src.includes("apple") && src.includes("oura") ? "Apple Health + Oura"
    : src.includes("apple") ? "Apple Health"
    : src.includes("oura") ? "Oura Ring"
    : "wearable";

  if (hasWearable) {
    // Trimmed set: only the fields that meaningfully drive journal-analysis
    // reasoning. Stable baselines (VO2 max, HR recovery, resilience level),
    // sleep-stage breakdowns, body-temp deviation, SpO2, workout detail, and
    // reproductive-cycle phase are deliberately NOT sent — they rarely change
    // the interpretation and they're the highest-sensitivity fields to send
    // to a third-party model that retains inputs for abuse detection.
    // In Reflect mode, the field-level gate strips wrist-derived signals
    // further — see MODE_CAPABILITIES.
    const bodyLines = [];
    if (t.sleepScore != null && allowed("sleepScore")) bodyLines.push(`  Sleep score: ${t.sleepScore}/100${trends?.sleepScore7 != null ? ` (7-day avg ${fmt(trends.sleepScore7)})` : ""}`);
    if (t.readinessScore != null && allowed("readinessScore")) bodyLines.push(`  Readiness: ${t.readinessScore}/100${trends?.readiness7 != null ? ` (7d avg ${fmt(trends.readiness7)}, 30d ${fmt(trends.readiness30)})` : ""}`);
    if (t.activityScore != null && allowed("activityScore")) bodyLines.push(`  Activity: ${t.activityScore}/100`);
    if (t.avgHRV != null && allowed("avgHRV")) bodyLines.push(`  Avg HRV: ${fmt(t.avgHRV)}ms${trends?.hrvBaseline30 ? ` — 30-day baseline ${fmt(trends.hrvBaseline30)}ms (${signed(trends.hrvDelta, 0)}%)` : ""}`);
    if (t.restingHR != null && allowed("restingHR")) bodyLines.push(`  Resting HR: ${t.restingHR}${trends?.rhr30 ? ` (baseline ${fmt(trends.rhr30)}, ${signed(trends.rhrDelta, 0)})` : ""}`);
    if (t.respiratoryRate != null && allowed("respiratoryRate")) bodyLines.push(`  Respiratory rate: ${fmt(t.respiratoryRate, 1)}/min`);
    if (t.totalSleepMin != null && allowed("totalSleepMin")) bodyLines.push(`  Sleep: ${Math.floor(t.totalSleepMin / 60)}h${Math.round(t.totalSleepMin % 60)}m total${t.sleepEfficiency && allowed("sleepEfficiency") ? ` · eff ${t.sleepEfficiency}%` : ""}`);
    if (t.stressHighSec != null && t.stressHighSec > 0 && allowed("stressHighSec")) bodyLines.push(`  High-stress time today: ${Math.round(t.stressHighSec / 60)}min`);
    const showSteps = t.steps != null && allowed("steps");
    const showActive = t.activeMinutes != null && allowed("activeMinutes");
    if (showSteps || showActive) bodyLines.push(`  Activity: ${showSteps ? t.steps : 0} steps, ${showActive ? t.activeMinutes : 0}min active`);
    if (bodyLines.length > 0) {
      lines.push(`TODAY (from ${sourceLabel}):`);
      lines.push(...bodyLines);
    }
  }

  // Rolling trends — sleep debt stays in Reflect (it's just summed total
  // sleep duration, which Reflect allows). Stress and temp deviation are
  // wrist-derived and dropped.
  const showSleepDebt = trends?.sleepDebtH != null && allowed("totalSleepMin");
  const showStress7 = trends?.stress7 != null && allowed("stressHighSec");
  const showTempDev7 = trends?.tempDev7 != null && allowed("temperatureTrendDeviation");
  if (showSleepDebt || showStress7 || showTempDev7) {
    if (lines.length > 0) lines.push("");
    lines.push("ROLLING TRENDS:");
    if (showSleepDebt) lines.push(`  7-day sleep debt vs 8h target: ${trends.sleepDebtH >= 0 ? fmt(trends.sleepDebtH, 1) + "h behind" : fmt(Math.abs(trends.sleepDebtH), 1) + "h surplus"}`);
    if (showStress7) lines.push(`  7-day high-stress avg: ${Math.round(trends.stress7 / 60)}min/day`);
    if (showTempDev7) lines.push(`  7-day temp trend deviation: ${signed(trends.tempDev7, 2)}°C`);
    if (trends.windowStart) lines.push(`  Data window: ${trends.windowStart} → ${trends.windowEnd} (${trends.daysSynced} days)`);
  }

  const hasManual = mb.manualSleep != null || mb.manualEnergy != null || mb.manualReadiness != null;
  if (hasManual) {
    if (lines.length > 0) lines.push("");
    lines.push(hasWearable ? `USER SELF-REPORT (alongside ${sourceLabel}):` : "USER SELF-REPORT (no wearable data — rely on these):");
    if (mb.manualSleep != null) lines.push(`  Self-rated sleep quality last night: ${mb.manualSleep}/10`);
    if (mb.manualEnergy != null) lines.push(`  Self-rated current energy: ${mb.manualEnergy}/10`);
    if (mb.manualReadiness != null) lines.push(`  Self-rated readiness: ${mb.manualReadiness}/10`);
  }

  const ls = lifestyle || {};
  const hydLvl = ls.hydrationLevel
    ?? (typeof ls.hydration === "number" ? (ls.hydration < 4 ? "low" : ls.hydration > 8 ? "good" : "average") : null);
  const hasLifestyle = hydLvl || (ls.exercise && ls.exercise !== "none");
  if (hasLifestyle) {
    if (lines.length > 0) lines.push("");
    lines.push("LIFESTYLE TODAY:");
    if (hydLvl) lines.push(`  Hydration (self-reported): ${hydLvl}`);
    if (ls.exercise) lines.push(`  Exercise: ${ls.exercise}${ls.steps ? ` (${ls.steps} steps)` : ""}`);
  }

  // Validated cognitive check-ins
  let checkin = {};
  try { checkin = JSON.parse(localStorage.getItem("cpi_checkin") || "{}"); } catch { /* ignore */ }
  const freshMins = (iso) => iso ? (Date.now() - new Date(iso).getTime()) / 60000 : Infinity;
  const hasKss = checkin.kss && freshMins(checkin.kss.timestamp) < 720; // 12h
  const hasPss = checkin.pss4 && freshMins(checkin.pss4.timestamp) < 10080; // 7d
  const hasPvt = checkin.pvtb?.latest && freshMins(checkin.pvtb.latest.timestamp) < 2880; // 48h
  if (hasKss || hasPss || hasPvt) {
    if (lines.length > 0) lines.push("");
    lines.push("COGNITIVE CHECK-INS (validated scales):");
    if (hasKss) {
      const v = checkin.kss.value;
      const desc = v <= 3 ? "alert" : v <= 6 ? "drifting" : "fighting sleep";
      lines.push(`  KSS alertness: ${v}/9 (${desc}) — ${timeAgo(checkin.kss.timestamp)}`);
    }
    if (hasPss) {
      const s = checkin.pss4.score;
      const band = s <= 5 ? "low" : s <= 9 ? "moderate" : "high";
      lines.push(`  PSS-4 stress (last 7d): ${s}/16 (${band} perceived stress)`);
    }
    if (hasPvt) {
      const p = checkin.pvtb.latest;
      const band = p.meanRT < 280 ? "sharp" : p.meanRT < 330 ? "typical" : p.meanRT < 400 ? "slowed" : "significantly slowed";
      lines.push(`  PVT-B reaction: ${p.meanRT}ms mean · ${p.lapses} lapses (${band})`);
    }
  }

  if (lines.length === 0) return "No biometric or self-report data available. Base the analysis on the journal text alone, and gently suggest wearing the ring tonight or using the sleep + energy sliders next time.";
  return lines.join("\n");
}

export function e0Label(v) {
  if (v == null) return { text: "—", tone: "var(--mt)" };
  if (v < 0.6) return { text: "Spent", tone: "#B0553A" };
  if (v < 0.8) return { text: "Low", tone: "#C4902A" };
  if (v < 1.0) return { text: "Steady", tone: "#4F8A5F" };
  return { text: "Charged", tone: "#4F8A5F" };
}

// Daily glance rings: Body / Mind / Mood composites (0-100). Each ring reports
// which signals contributed so the UI can show source counts and gaps.
export function computeDailyRings(biometrics, lifestyle, trends, checkin, history, options = {}) {
  // mode === "reflect" skips wrist-derived signals (composite Sleep score,
  // Readiness, Activity score, HRV delta, stress-high seconds) even when
  // they exist in storage. Self-report sliders and phone-detectable
  // signals (totalSleepMin, activeMinutes, KSS, PVT-B, PSS-4) still feed
  // the rings — Reflect just gets sparser rings, not none.
  const { mode = "full" } = options;
  const allowed = (field) => isFieldAllowed(mode, field);

  // Merge trends.today with biometrics state so Apple-Health-populated days
  // show up even if the export doesn't include today's date yet. biometrics
  // state is set to the freshest day at import time.
  const mb = biometrics || {};
  const t = { ...(mb || {}), ...(trends?.today || {}) };
  // If biometrics has data the trends object doesn't, fill it in.
  for (const k of Object.keys(mb)) if (t[k] == null && mb[k] != null) t[k] = mb[k];
  const ci = checkin || {};
  const freshMins = (iso) => iso ? (Date.now() - new Date(iso).getTime()) / 60000 : Infinity;
  const srcOf = (key) => (mb.source || "").startsWith("apple") ? "apple" : "oura";

  // ── BODY: sleep · readiness · (optional activity)
  const bodySignals = [];
  if (t.sleepScore != null && allowed("sleepScore")) bodySignals.push({ key: "sleep", label: "Sleep score", value: t.sleepScore, source: srcOf() });
  else if (mb.manualSleep != null) bodySignals.push({ key: "sleep", label: "Sleep (self-rated)", value: mb.manualSleep * 10, source: "manual" });
  else if (t.totalSleepMin != null && allowed("totalSleepMin")) {
    const v = Math.max(0, Math.min(100, (t.totalSleepMin / 60 - 4) * 25 + 40));
    bodySignals.push({ key: "sleep", label: "Sleep duration", value: v, source: srcOf() });
  }
  if (t.readinessScore != null && allowed("readinessScore")) bodySignals.push({ key: "readiness", label: "Readiness", value: t.readinessScore, source: srcOf() });
  else if (mb.manualReadiness != null) bodySignals.push({ key: "readiness", label: "Readiness (self-rated)", value: mb.manualReadiness * 10, source: "manual" });
  if (t.activityScore != null && allowed("activityScore")) {
    bodySignals.push({ key: "activity", label: "Activity", value: t.activityScore, source: srcOf() });
  } else if (t.activeMinutes != null && allowed("activeMinutes")) {
    const v = Math.max(0, Math.min(100, (t.activeMinutes / 30) * 100));
    bodySignals.push({ key: "activity", label: "Active minutes", value: v, source: srcOf() });
  } else if (lifestyle?.exercise && lifestyle.exercise !== "none") {
    const v = ({ light: 60, moderate: 80, intense: 95 }[lifestyle.exercise] || 50);
    bodySignals.push({ key: "activity", label: "Movement (self-rated)", value: v, source: "manual" });
  }

  // ── MIND: KSS alertness · PVT-B reaction · HRV delta
  const mindSignals = [];
  if (ci.kss && freshMins(ci.kss.timestamp) < 720) {
    // KSS 1 = alert (100), KSS 9 = fighting sleep (10)
    const v = Math.max(0, Math.min(100, (10 - ci.kss.value) * 11.11));
    mindSignals.push({ key: "kss", label: "Alertness (KSS)", value: v, source: "self" });
  }
  if (ci.pvtb?.latest && freshMins(ci.pvtb.latest.timestamp) < 2880) {
    // 250ms = 100, 400ms = 50, 550ms+ = 0
    const rt = ci.pvtb.latest.meanRT;
    const v = rt ? Math.max(0, Math.min(100, 100 - (rt - 250) / 3)) : null;
    if (v != null) mindSignals.push({ key: "pvt", label: "Reaction time (PVT-B)", value: v, source: "self" });
  }
  if (trends?.hrvDelta != null && trends?.hrvBaseline30 != null && allowed("avgHRV")) {
    // hrvDelta is % change from 30d baseline. +10% = 70, 0% = 50, -10% = 30
    const v = Math.max(0, Math.min(100, 50 + trends.hrvDelta * 2));
    // Apple Health provides HRV too (avgHRV) — so an Apple-only user's HRV must
    // not be labelled "oura" like a hardcode would. Resolve the device the same
    // way the body signals do. (Stress below stays "oura": Apple has no stress
    // signal, so that field is always Oura when present.)
    mindSignals.push({ key: "hrv", label: "HRV vs baseline", value: v, source: srcOf() });
  }

  // ── MOOD: PSS-4 stress · stress minutes · recent journal trend
  const moodSignals = [];
  if (ci.pss4 && freshMins(ci.pss4.timestamp) < 10080) {
    // PSS-4 score 0-16. Lower = calmer. 0=100, 16=0
    const v = Math.max(0, Math.min(100, 100 - (ci.pss4.score / 16) * 100));
    moodSignals.push({ key: "pss4", label: "Felt stress — how you rate it (PSS-4)", value: v, source: "self" });
  }
  if (t.stressHighSec != null && allowed("stressHighSec")) {
    // Stress minutes today. 0min=100, 180min=10
    const mins = t.stressHighSec / 60;
    const v = Math.max(0, Math.min(100, 100 - (mins / 180) * 90));
    moodSignals.push({ key: "stress", label: "Body stress — nervous system load (Oura)", value: v, source: "oura" });
  }
  // Mood pot previously included a third signal here — a 3-day-average HCPI
  // remapped to 0-100 ("journal tone"). Removed because HCPI is an unvalidated
  // internal composite (see docs/HCPI_VALIDATION_AUDIT_2026-05-14): mixing it
  // into a user-visible "Mood" number turned a validated-instrument reading
  // (PSS-4 + Oura stress minutes) into a partially decorative composite. Mood
  // now reads only from sources that have their own validation chain.

  const avg = (arr) => arr.length ? arr.reduce((s, x) => s + x.value, 0) / arr.length : null;
  return {
    body: { value: avg(bodySignals), signals: bodySignals },
    mind: { value: avg(mindSignals), signals: mindSignals },
    mood: { value: avg(moodSignals), signals: moodSignals },
  };
}

export const LORE_KEY = "cpi_lore";
export function loadLore() {
  try { return JSON.parse(localStorage.getItem(LORE_KEY) || "null") || { bullets: [], signature: null, generatedAt: null, corrections: [] }; }
  catch { return { bullets: [], signature: null, generatedAt: null, corrections: [] }; }
}
export function saveLore(l) { try { localStorage.setItem(LORE_KEY, JSON.stringify(l)); } catch { /* ignore */ } }

export function loreSignature(history, trends, checkin) {
  const n = history?.length || 0;
  const last = history?.[0]?.date?.slice(0, 10) || "none";
  const t = trends?.today || {};
  const sleep = t.sleepScore ?? "x";
  const readiness = t.readinessScore ?? "x";
  const hrv = t.avgHRV ?? "x";
  const kss = checkin?.kss?.value ?? "x";
  const pss = checkin?.pss4?.score ?? "x";
  const wearableWindow = trends?.windowEnd || "x";
  return `${n}|${last}|${sleep}|${readiness}|${hrv}|${kss}|${pss}|${wearableWindow}`;
}

export async function generateLore(history, biometrics, lifestyle, trends, checkin, corrections, options = {}) {
  const { mode = "full" } = options;

  const recent = (history || []).slice(0, 12).map(h => {
    const d = h.date?.slice(0, 10) || "?";
    const hcpi = typeof h.hcpi === "number" ? Math.round(h.hcpi * 100) : "?";
    const drivers = h.drivers ? Object.entries(h.drivers).filter(([, v]) => v > 0.15).map(([k]) => k).join(",") : "";
    return `  ${d}: HCPI ${hcpi}, drivers=${drivers || "none"}, S=${h.params?.S?.toFixed?.(1) || "?"}, ψ=${h.params?.psi?.toFixed?.(1) || "?"}`;
  }).join("\n");

  const body = formatBodyContext(trends, biometrics, lifestyle, { mode });
  const correctionsBlock = corrections?.length ? `\nUSER CORRECTIONS (respect these — don't repeat retracted patterns):\n${corrections.map(c => `  - ${c}`).join("\n")}` : "";

  const system = `You are Ori — a quiet, honest observer inside a personal health app. Produce EXACTLY 5 short observations about this specific user, derived ONLY from the provided data. Each bullet ≤ 18 words. Use observer voice ("You tend to...", "When X, you...", "Your best days..."). Be specific and cite evidence succinctly. No compliments, no fluff, no emoji, no generic advice. Prioritize patterns that would feel surprising or validating to read about yourself. Return a tool call with the bullets array.`;

  const user = `RECENT JOURNALS (newest first):\n${recent || "  (no journals yet)"}\n\nBODY CONTEXT:\n${body}\n\nCHECK-INS:\n${JSON.stringify(checkin || {}, null, 2).slice(0, 600)}${correctionsBlock}\n\nReturn 5 observations via the tool call.`;

  try {
    const data = await fetchAnthropicWithRetry({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system,
      tools: [{
        name: "record_lore",
        description: "Record 5 observations about this user.",
        input_schema: {
          type: "object",
          properties: {
            bullets: {
              type: "array",
              items: { type: "string" },
              minItems: 5,
              maxItems: 5,
              description: "Exactly 5 short observations, each ≤ 18 words.",
            },
          },
          required: ["bullets"],
        },
      }],
      tool_choice: { type: "tool", name: "record_lore" },
      messages: [{ role: "user", content: user }],
    });
    const toolUse = (data.content || []).find(c => c.type === "tool_use" && c.name === "record_lore");
    if (!toolUse?.input?.bullets) return null;
    return toolUse.input.bullets.slice(0, 5);
  } catch {
    return null;
  }
}

/* ─── CRISIS WORD DETECTION (client-side, pre-LLM gate) ─── */
// Phrases are screened before any clinical analysis. If hit, the UI shows
// resources and suppresses risk scores — we never want to "score" someone in
// active crisis, just point to help.
// CRISIS_PATTERNS imported from ./knowledge-base.js.

export function detectCrisis(entries) {
  const hits = [];
  for (const e of (entries || [])) {
    const text = e.rawText || e.transcription || "";
    for (const [category, patterns] of Object.entries(CRISIS_PATTERNS)) {
      for (const p of patterns) {
        const m = text.match(p);
        if (m) {
          const idx = text.indexOf(m[0]);
          const start = Math.max(0, idx - 40);
          const end = Math.min(text.length, idx + m[0].length + 40);
          hits.push({
            category,
            date: e.date || "(undated)",
            quote: text.slice(start, end).trim(),
            pattern: m[0],
          });
          break; // one hit per category per entry is enough
        }
      }
    }
  }
  return hits;
}

// LIWC imported from ./knowledge-base.js.

export function normalizeText(t) {
  return (t || "").toLowerCase().replace(/[''`]/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
}

export function countMatches(tokens, wordList) {
  const phrases = wordList.filter(w => w.includes(" "));
  const singles = new Set(wordList.filter(w => !w.includes(" ")));
  let count = 0;
  const joined = tokens.join(" ");
  for (const p of phrases) {
    const re = new RegExp(`\\b${p.replace(/\s+/g, " ")}\\b`, "g");
    count += (joined.match(re) || []).length;
  }
  for (const t of tokens) if (singles.has(t)) count++;
  return count;
}

// Count distinct emotion words present (proxy for emotional granularity).
export function countDistinct(tokens, wordList) {
  const set = new Set(wordList);
  const seen = new Set();
  for (const t of tokens) if (set.has(t)) seen.add(t);
  return seen.size;
}

/* ─── CLINICAL SIGNALS (opt-in dual-model risk screening) ─── */
export const CLINICAL_KEY = "cpi_clinical_signals";
export function loadClinical() { try { return JSON.parse(localStorage.getItem(CLINICAL_KEY) || "null"); } catch { return null; } }
export function saveClinical(x) { try { localStorage.setItem(CLINICAL_KEY, JSON.stringify(x)); } catch { /* ignore */ } }

// BECK_DISTORTIONS and YOUNG_SCHEMAS imported from ./knowledge-base.js.

export async function runClaudeClinicalPass(entriesBlock, system, distortionKeys, schemaKeys) {
  const evidenceItem = {
    type: "object",
    properties: { date: { type: "string" }, quote: { type: "string", description: "≤120 chars verbatim" } },
    required: ["date", "quote"],
  };
  const data = await fetchAnthropicWithRetry({
      model: "claude-sonnet-4-6",
      max_tokens: 10000,
      system,
      tools: [{
        name: "record_clinical_signals",
        description: "Record structured clinical-adjacent pattern detection.",
        input_schema: {
          type: "object",
          properties: {
            rumination: {
              type: "object",
              properties: {
                level: { type: "number", description: "0-1 overall rumination level (Nolen-Hoeksema RRS)" },
                brooding_dominance: { type: "number", description: "0-1 how much of the rumination is brooding (unproductive) vs reflective" },
                reading: { type: "string", description: "≤30 words" },
                evidence: { type: "array", maxItems: 3, items: evidenceItem },
              },
              required: ["level", "brooding_dominance", "reading"],
            },
            cognitive_distortions: {
              type: "array",
              description: "One entry per Beck distortion detected. Only include distortions actually present.",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: distortionKeys },
                  frequency: { type: "integer", description: "Count of entries displaying this pattern" },
                  severity: { type: "number", description: "0-1 — how rigid/pervasive when present" },
                  evidence: { type: "array", maxItems: 2, items: evidenceItem },
                },
                required: ["type", "frequency", "severity"],
              },
            },
            schemas: {
              type: "array",
              description: "Young Early Maladaptive Schemas with clear evidence. Skip any not observed.",
              items: {
                type: "object",
                properties: {
                  schema: { type: "string", enum: schemaKeys },
                  activation: { type: "number", description: "0-1 activation strength across entries" },
                  evidence: { type: "array", maxItems: 2, items: evidenceItem },
                },
                required: ["schema", "activation"],
              },
            },
            attachment: {
              type: "object",
              properties: {
                dominant: { type: "string", enum: ["secure", "anxious", "avoidant", "disorganized", "insufficient_data"] },
                confidence: { type: "number" },
                reading: { type: "string", description: "≤35 words" },
                evidence: { type: "array", maxItems: 3, items: evidenceItem },
              },
              required: ["dominant", "confidence"],
            },
            phq9_proxy: {
              type: "object",
              description: "LINGUISTIC proxy for PHQ-9 depression markers — NOT a diagnosis.",
              properties: {
                value: { type: "number", description: "0-1" },
                notes: { type: "string", description: "≤30 words — which markers present" },
              },
              required: ["value"],
            },
            gad7_proxy: {
              type: "object",
              description: "LINGUISTIC proxy for GAD-7 anxiety markers — NOT a diagnosis.",
              properties: {
                value: { type: "number", description: "0-1" },
                notes: { type: "string", description: "≤30 words" },
              },
              required: ["value"],
            },
            key_findings: {
              type: "array",
              description: "Top 3 patterns this screening surfaces. Framed as patterns, not labels.",
              maxItems: 3,
              items: {
                type: "object",
                properties: {
                  finding: { type: "string", description: "≤50 words" },
                  confidence: { type: "number" },
                  category: { type: "string", enum: ["rumination", "distortion", "schema", "attachment", "mood_anxiety"] },
                },
                required: ["finding", "confidence", "category"],
              },
            },
          },
          required: ["rumination", "cognitive_distortions", "schemas", "attachment", "phq9_proxy", "gad7_proxy"],
        },
      }],
      tool_choice: { type: "tool", name: "record_clinical_signals" },
      messages: [{ role: "user", content: entriesBlock }],
  });
  const tool = (data.content || []).find(c => c.type === "tool_use" && c.name === "record_clinical_signals");
  if (!tool) throw new Error("No structured clinical signals returned");
  return tool.input;
}

export async function runGpt5ClinicalPass(entriesText, distortionKeys, schemaKeys) {
  const system = `You are a clinical research assistant performing pattern detection on personal journal entries. This is NOT diagnosis — screen for research-backed patterns and return STRICT JSON. Never encourage, diagnose, or prescribe.`;
  const schemaList = schemaKeys.join(", ");
  const distortionList = distortionKeys.join(", ");

  const user = `Entries:
${entriesText}

Return STRICT JSON only, matching this schema exactly:
{
  "rumination": { "level": 0-1, "brooding_dominance": 0-1 },
  "cognitive_distortions": [ { "type": "<one of: ${distortionList}>", "frequency": int, "severity": 0-1 } ],
  "schemas": [ { "schema": "<one of: ${schemaList}>", "activation": 0-1 } ],
  "attachment": { "dominant": "secure|anxious|avoidant|disorganized|insufficient_data", "confidence": 0-1 },
  "phq9_proxy": { "value": 0-1 },
  "gad7_proxy": { "value": 0-1 }
}
Only include distortions/schemas that are actually present.`;

  try {
    const res = await fetch("/proxy/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5",
        messages: [ { role: "system", content: system }, { role: "user", content: user } ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      if (res.status === 500 && /not configured/i.test(t)) {
        return { status: "skipped", reason: "OpenAI key not configured on server — set OPENAI_API_KEY." };
      }
      return { status: "error", error: `OpenAI ${res.status}: ${t.slice(0, 140)}` };
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return { status: "error", error: "No content from OpenAI" };
    try {
      return { status: "done", model: "gpt-5", data: JSON.parse(content) };
    } catch {
      return { status: "error", error: "GPT-5 JSON parse failed" };
    }
  } catch (e) {
    return { status: "error", error: e.message };
  }
}

// Merges Claude + GPT-5 outputs. Only surfaces findings both models see.
export function mergeClinicalFindings(claudeResult, gpt5Result) {
  const agreement = { rumination: null, distortions: [], schemas: [], attachment: null, mood_anxiety: null };
  if (!gpt5Result || gpt5Result.status !== "done") {
    // Fallback: show Claude only, tag all as "single-model"
    return { mode: "single-model", claude: claudeResult, gpt5Status: gpt5Result };
  }
  const gpt = gpt5Result.data;

  // Rumination: agree if gap < 0.25
  const cRum = claudeResult.rumination?.level ?? 0;
  const gRum = gpt.rumination?.level ?? 0;
  agreement.rumination = {
    agreed: Math.abs(cRum - gRum) <= 0.25,
    claude: cRum,
    gpt5: gRum,
    brooding: claudeResult.rumination?.brooding_dominance ?? null,
  };

  // Distortions: surface only distortions both models flagged with severity/freq > 0
  const gptDistortionTypes = new Set((gpt.cognitive_distortions || []).filter(d => (d.severity || 0) > 0.2 || (d.frequency || 0) >= 1).map(d => d.type));
  agreement.distortions = (claudeResult.cognitive_distortions || [])
    .filter(d => (d.severity || 0) > 0.2 || (d.frequency || 0) >= 1)
    .map(d => ({ ...d, bothModels: gptDistortionTypes.has(d.type) }));

  // Schemas: surface only schemas both models flagged with activation > 0.3
  const gptSchemaKeys = new Set((gpt.schemas || []).filter(s => (s.activation || 0) > 0.3).map(s => s.schema));
  agreement.schemas = (claudeResult.schemas || [])
    .filter(s => (s.activation || 0) > 0.3)
    .map(s => ({ ...s, bothModels: gptSchemaKeys.has(s.schema) }));

  // Attachment: agree if same dominant category
  const cAtt = claudeResult.attachment?.dominant;
  const gAtt = gpt.attachment?.dominant;
  agreement.attachment = {
    agreed: cAtt === gAtt,
    claude: cAtt,
    gpt5: gAtt,
    confidence: Math.min(claudeResult.attachment?.confidence ?? 0, gpt.attachment?.confidence ?? 0),
    reading: claudeResult.attachment?.reading,
    evidence: claudeResult.attachment?.evidence,
  };

  // Mood/anxiety: average the two, flag if gap > 0.3
  const cP = claudeResult.phq9_proxy?.value ?? 0;
  const gP = gpt.phq9_proxy?.value ?? 0;
  const cG = claudeResult.gad7_proxy?.value ?? 0;
  const gG = gpt.gad7_proxy?.value ?? 0;
  agreement.mood_anxiety = {
    phq9: { claude: cP, gpt5: gP, avg: (cP + gP) / 2, agreed: Math.abs(cP - gP) <= 0.3 },
    gad7: { claude: cG, gpt5: gG, avg: (cG + gG) / 2, agreed: Math.abs(cG - gG) <= 0.3 },
    notes_phq9: claudeResult.phq9_proxy?.notes,
    notes_gad7: claudeResult.gad7_proxy?.notes,
  };

  return { mode: "dual-model", claude: claudeResult, gpt5: gpt, agreement, gpt5Status: gpt5Result };
}

export async function generateClinicalSignals(entries, onProgress) {
  const usable = (entries || []).filter(e => ((e.rawText || e.transcription || "").length) > 30);
  if (usable.length < 5) throw new Error("Clinical screening needs at least 5 substantive entries for reliability.");

  onProgress?.("Screening for crisis indicators first…");
  const crisisHits = detectCrisis(usable);
  if (crisisHits.length > 0) {
    return { crisisDetected: true, crisisHits, generatedAt: Date.now() };
  }

  onProgress?.("Preparing entries for dual-model screening…");
  const sorted = usable.slice().sort((a, b) => (a.date || "ZZZ").localeCompare(b.date || "ZZZ"));
  const entriesText = sorted.map((e, i) => `[E${i + 1}] ${e.date || "(undated)"}\n${(e.rawText || e.transcription).slice(0, 2500)}`).join("\n\n---\n\n");

  const distortionKeys = BECK_DISTORTIONS.map(d => d.key);
  const schemaKeys = YOUNG_SCHEMAS.map(s => s.key);

  const system = `You are a clinical research assistant performing pattern screening on personal journals. You detect research-backed patterns: Nolen-Hoeksema rumination, Beck's 10 cognitive distortions, Young's 18 Early Maladaptive Schemas, adult attachment style, and linguistic proxies for PHQ-9 (depression) and GAD-7 (anxiety).

HARD RULES:
1. You are NOT diagnosing. Frame all findings as "patterns observed in research."
2. If evidence is thin, set low activation/severity and low confidence. Prefer silence over false signal.
3. Every surfaced distortion or schema must have 2+ supporting entries or clear verbatim evidence.
4. Never suggest the writer is "ill." You are a research lens, not a clinician.
5. Use the record_clinical_signals tool with exact enum values for distortion types and schema keys.

FRAMEWORKS:
— Rumination Response Scale (RRS, Nolen-Hoeksema) — brooding vs reflective
— Cognitive Distortions (Beck 1979 · Burns 1980) — 10 canonical types
— Young Schema Therapy (Young, Klosko, Weishaar 2003) — 18 Early Maladaptive Schemas across 5 domains
— Adult Attachment (Bowlby, Main) — secure / anxious / avoidant / disorganized linguistic markers
— PHQ-9 / GAD-7 linguistic proxies (these are NOT diagnostic — only markers visible in text)`;

  const user = `JOURNAL ENTRIES (${sorted.length} total):

${entriesText}

Run record_clinical_signals now. Be conservative. Prefer silence over overclaim.`;

  onProgress?.("Running Claude Sonnet 4.6 clinical pass…");
  const claudePromise = runClaudeClinicalPass(user, system, distortionKeys, schemaKeys);

  onProgress?.("Running GPT-5 cross-check in parallel…");
  const gpt5Promise = runGpt5ClinicalPass(entriesText, distortionKeys, schemaKeys);

  const [claudeResult, gpt5Result] = await Promise.all([claudePromise, gpt5Promise]);

  onProgress?.("Merging agreement across models…");
  const merged = mergeClinicalFindings(claudeResult, gpt5Result);

  return { crisisDetected: false, ...merged, generatedAt: Date.now() };
}

/* ─── JOURNAL INSIGHTS (6-layer structured psychological analysis) ─── */
export const INSIGHTS_KEY = "cpi_journal_insights";
export function saveInsights(x) { try { localStorage.setItem(INSIGHTS_KEY, JSON.stringify(x)); } catch { /* ignore */ } }

/* ─── MIND SEEDS (incremental per-entry extractions) ───────────────────
   Cheap per-entry findings — 1-3 short observations each — extracted by
   Claude Haiku 4.5 as entries are added to the repo. Accumulates into a
   personal collection without re-running the full 60-90s six-framework
   synthesis every time the repo changes. The expensive synthesis stays
   manual; seeds are the always-on, always-fresh background layer.

   Shape:
     { version: 1,
       seeds: {
         [entryId]: {
           entryId, entryDate, textHash, extractedAt, model,
           items: [ { theme, note, quote } ]
         }
       }
     }
   ────────────────────────────────────────────────────────────────────── */
export const MIND_SEEDS_KEY = "cpi_mind_seeds_v1";
export const MIND_SEEDS_MODEL = "claude-haiku-4-5-20251001";

export function loadSeeds() {
  try {
    const raw = JSON.parse(localStorage.getItem(MIND_SEEDS_KEY) || "null");
    return raw && typeof raw === "object" ? { version: 1, seeds: {}, ...raw } : { version: 1, seeds: {} };
  } catch { return { version: 1, seeds: {} }; }
}
export function saveSeeds(x) {
  try { localStorage.setItem(MIND_SEEDS_KEY, JSON.stringify(x)); return true; }
  catch { return false; }
}

// Fast non-crypto hash — good enough for text-change detection (caches invalidate
// on edit). Keeps the seed store from re-extracting identical text.
export function hashText(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Finds entries that need seeds (no seed on file, or text has changed).
// Returns an array up to `limit` — callers run one at a time to avoid
// burst-calling Anthropic.
export function pendingSeedEntries(repo, seedsStore, limit = 1) {
  const seeds = seedsStore?.seeds || {};
  const out = [];
  for (const e of (repo?.entries || [])) {
    const text = (e.transcription || e.rawText || "").trim();
    if (text.length < 30) continue;
    const hash = hashText(text);
    const existing = seeds[e.id];
    if (!existing || existing.textHash !== hash) {
      out.push(e);
      if (out.length >= limit) break;
    }
  }
  return out;
}

const SEED_EXTRACTION_TOOL = {
  name: "record_seeds",
  description: "Record 1–3 short, distinct observations (seeds) noticed in a single journal entry. A seed is a compact finding — not a summary of the whole entry. Each seed has a theme tag, a short note, and a verbatim quote from the entry that supports it.",
  input_schema: {
    type: "object",
    properties: {
      seeds: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            theme: { type: "string", description: "Short tag, lowercase, hyphenated if multi-word. Examples: 'agency', 'overthinking', 'gratitude', 'avoidance', 'self-kindness', 'relational-repair', 'flow', 'control', 'grief-signal', 'growth'. Pick a theme that will aggregate well across many entries." },
            note: { type: "string", description: "One sentence, ≤25 words, describing the observation. Plain human voice, not clinical." },
            quote: { type: "string", description: "A short verbatim phrase from the entry (≤15 words) that supports the seed. Must appear in the entry text." },
          },
          required: ["theme", "note", "quote"],
        },
      },
    },
    required: ["seeds"],
  },
};

const SEED_SYSTEM_PROMPT = `You are extracting small observations (seeds) from a single journal entry. You are NOT summarising the entry — you are picking out 1-3 distinct noticings that, if accumulated over many entries, would form a useful picture.

Rules:
- Each seed must be a different kind of observation (don't pick 3 variations of the same theme).
- Themes must be reusable across many entries so counts aggregate. Use short, lowercase tags.
- The quote must appear verbatim in the source text.
- The note is plain voice — what a thoughtful friend would notice, not a clinical finding.
- If the entry is short or flat, one seed is fine. Do not pad.
- Skip crisis language — if the entry contains self-harm or crisis content, return a single seed with theme "crisis-signal" and a non-prescriptive note.`;

export async function extractSeeds(entry) {
  const text = (entry.transcription || entry.rawText || "").trim();
  if (text.length < 30) return null;
  const data = await fetchAnthropicWithRetry({
    model: MIND_SEEDS_MODEL,
    max_tokens: 600,
    system: [{ type: "text", text: SEED_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [SEED_EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "record_seeds" },
    messages: [{ role: "user", content: `JOURNAL ENTRY${entry.date ? ` (${entry.date})` : ""}:\n\n${text}` }],
  });
  const block = (data?.content || []).find(b => b.type === "tool_use" && b.name === "record_seeds");
  const seeds = block?.input?.seeds || [];
  // Defensive filter: quote must actually be in the source (drop hallucinations).
  const validated = seeds.filter(s => s?.theme && s?.note && s?.quote && text.toLowerCase().includes(s.quote.trim().toLowerCase().slice(0, 20)));
  return {
    entryId: entry.id,
    entryDate: entry.date || null,
    textHash: hashText(text),
    extractedAt: Date.now(),
    model: MIND_SEEDS_MODEL,
    items: validated,
  };
}

// Aggregate the seeds map into a ranked list of themes with counts + recent items.
// Used for the Mind Seeds card's "top themes" view.
export function summarizeSeeds(seedsStore) {
  const seeds = seedsStore?.seeds || {};
  const themes = new Map();
  let total = 0;
  for (const e of Object.values(seeds)) {
    for (const item of (e.items || [])) {
      total++;
      const key = item.theme || "other";
      const entry = themes.get(key) || { theme: key, count: 0, items: [] };
      entry.count++;
      entry.items.push({ ...item, entryId: e.entryId, entryDate: e.entryDate, extractedAt: e.extractedAt });
      themes.set(key, entry);
    }
  }
  // Sort each theme's items newest-first
  for (const t of themes.values()) t.items.sort((a, b) => (b.extractedAt || 0) - (a.extractedAt || 0));
  const ranked = Array.from(themes.values()).sort((a, b) => b.count - a.count);
  return { total, themes: ranked, entryCount: Object.keys(seeds).length };
}


/* ─── APPLE HEALTH — parse Health app's export.zip into our daily history ─── */
export function hkParseAttrs(s) {
  const attrs = {};
  const re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

// Parse an Apple Health export .zip file and return daily aggregates in the
// same shape our cpi_oura_history entries use. Runs in the main thread but
// yields every 50k records so the UI stays responsive.
//
// Raw Apple data is flat. After aggregation we call `computeDerivedAppleScores`
// so the app's composite metrics (sleepScore, readinessScore, activityScore)
// are populated the same way Oura would populate them — derived from validated
// protocols, not pulled "as is".
export async function parseAppleHealthZip(file, options = {}, onProgress) {
  const days = Math.max(7, Math.min(3650, options.days || 90));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  onProgress?.({ phase: "Reading archive…", percent: 5 });
  const zip = await JSZip.loadAsync(file);
  const xmlEntry = zip.file("apple_health_export/export.xml") || zip.file("export.xml");
  if (!xmlEntry) throw new Error("export.xml not found — this doesn't look like an Apple Health export ZIP.");

  onProgress?.({ phase: "Unpacking XML…", percent: 15 });
  const xml = await xmlEntry.async("string");

  onProgress?.({ phase: "Scanning records…", percent: 30 });
  const daily = {};
  const recordRe = /<Record\s+([^>]*?)\/?>/g;
  let match;
  let count = 0;
  let kept = 0;
  const touch = (dateStr) => {
    if (!daily[dateStr]) daily[dateStr] = { date: dateStr };
    return daily[dateStr];
  };

  while ((match = recordRe.exec(xml)) !== null) {
    count++;
    const attrs = hkParseAttrs(match[1]);
    const type = attrs.type;
    if (!type) continue;

    // Use endDate as the day key — matches Oura's "wake day" convention.
    const dateStr = (attrs.endDate || attrs.startDate || "").slice(0, 10);
    if (!dateStr || dateStr < cutoffIso) continue;

    const d = touch(dateStr);
    const val = parseFloat(attrs.value);

    switch (type) {
      case "HKCategoryTypeIdentifierSleepAnalysis": {
        if (!attrs.startDate || !attrs.endDate) break;
        const sMs = new Date(attrs.startDate).getTime();
        const eMs = new Date(attrs.endDate).getTime();
        const durMin = (eMs - sMs) / 60000;
        if (durMin <= 0 || durMin > 720) break;
        const sv = attrs.value || "";
        // Collect raw intervals per bucket. We DON'T sum yet — Apple Health
        // stores overlapping records from every source that ever wrote sleep
        // (Apple Watch native + AutoSleep + Oura-syncing-in + Pillow + …).
        // Summing double- or triple-counts the same night. Instead we push
        // the raw time range into a per-bucket interval list and compute
        // the union-length during the aggregation pass.
        const pushSeg = (bucket) => {
          d._segs = d._segs || {};
          (d._segs[bucket] = d._segs[bucket] || []).push([sMs, eMs]);
        };
        if (sv.includes("InBed")) pushSeg("inBed");
        else if (sv.includes("Awake")) pushSeg("awake");
        else if (sv.includes("Asleep")) {
          pushSeg("asleep");
          if (sv.includes("Deep")) pushSeg("deep");
          else if (sv.includes("REM")) pushSeg("rem");
          else if (sv.includes("Core") || sv.includes("Unspecified")) pushSeg("light");
          // Outermost Asleep edges feed the Sleep Regularity Index.
          if (!d._sleepStartMs || sMs < d._sleepStartMs) d._sleepStartMs = sMs;
          if (!d._sleepEndMs || eMs > d._sleepEndMs) d._sleepEndMs = eMs;
        }
        kept++;
        break;
      }
      case "HKQuantityTypeIdentifierHeartRateVariabilitySDNN":
        if (!isNaN(val)) { (d._hrv = d._hrv || []).push(val); kept++; }
        break;
      case "HKQuantityTypeIdentifierRestingHeartRate":
        if (!isNaN(val)) { (d._rhr = d._rhr || []).push(val); kept++; }
        break;
      case "HKQuantityTypeIdentifierHeartRate":
        if (!isNaN(val)) { (d._hr = d._hr || []).push(val); kept++; }
        break;
      case "HKQuantityTypeIdentifierWalkingHeartRateAverage":
        if (!isNaN(val)) { (d._whr = d._whr || []).push(val); kept++; }
        break;
      case "HKQuantityTypeIdentifierHeartRateRecoveryOneMinute":
        if (!isNaN(val)) { (d._hrr = d._hrr || []).push(val); kept++; }
        break;
      case "HKQuantityTypeIdentifierVO2Max":
        if (!isNaN(val)) { d.vo2Max = val; kept++; }
        break;
      case "HKQuantityTypeIdentifierStepCount":
        if (!isNaN(val)) { d.steps = (d.steps || 0) + val; kept++; }
        break;
      case "HKQuantityTypeIdentifierFlightsClimbed":
        if (!isNaN(val)) { d.flights = (d.flights || 0) + val; kept++; }
        break;
      case "HKQuantityTypeIdentifierAppleExerciseTime":
        if (!isNaN(val)) { d.activeMinutes = (d.activeMinutes || 0) + val; kept++; }
        break;
      case "HKQuantityTypeIdentifierActiveEnergyBurned":
        if (!isNaN(val)) { d.activeKcal = (d.activeKcal || 0) + val; kept++; }
        break;
      case "HKQuantityTypeIdentifierBasalEnergyBurned":
        if (!isNaN(val)) { d.basalKcal = (d.basalKcal || 0) + val; kept++; }
        break;
      case "HKQuantityTypeIdentifierDistanceWalkingRunning":
        if (!isNaN(val)) { d.distanceKm = (d.distanceKm || 0) + val; kept++; }
        break;
      case "HKQuantityTypeIdentifierRespiratoryRate":
        if (!isNaN(val)) { (d._resp = d._resp || []).push(val); kept++; }
        break;
      case "HKQuantityTypeIdentifierOxygenSaturation":
        if (!isNaN(val)) { (d._spo2 = d._spo2 || []).push(val * 100); kept++; }
        break;
      case "HKQuantityTypeIdentifierAppleSleepingWristTemperature":
      case "HKQuantityTypeIdentifierWristTemperature":
      case "HKQuantityTypeIdentifierBasalBodyTemperature":
        if (!isNaN(val)) { (d._temp = d._temp || []).push(val); kept++; }
        break;
      case "HKCategoryTypeIdentifierMindfulSession": {
        if (!attrs.startDate || !attrs.endDate) break;
        const mm = (new Date(attrs.endDate) - new Date(attrs.startDate)) / 60000;
        d.mindfulMinutes = (d.mindfulMinutes || 0) + mm;
        kept++;
        break;
      }
      default:
        break;
    }

    // Yield every 50k records so the UI stays responsive.
    if (count % 50000 === 0) {
      onProgress?.({ phase: `Scanning records… ${(count / 1000).toFixed(0)}k`, percent: Math.min(75, 30 + Math.floor(count / 20000)) });
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // Workouts — separate tag, richer than Record.
  onProgress?.({ phase: "Scanning workouts…", percent: 78 });
  const workoutRe = /<Workout\s+([^>]*?)(?:\/>|>)/g;
  let wMatch;
  while ((wMatch = workoutRe.exec(xml)) !== null) {
    const a = hkParseAttrs(wMatch[1]);
    const dateStr = (a.endDate || a.startDate || "").slice(0, 10);
    if (!dateStr || dateStr < cutoffIso) continue;
    const d = touch(dateStr);
    d.workouts = d.workouts || [];
    d.workouts.push({
      type: (a.workoutActivityType || "Unknown").replace("HKWorkoutActivityType", ""),
      durationMin: parseFloat(a.duration) || null,
      kcal: parseFloat(a.totalEnergyBurned) || null,
      distanceKm: parseFloat(a.totalDistance) || null,
    });
    kept++;
  }

  onProgress?.({ phase: "Aggregating daily totals…", percent: 85 });
  const result = [];
  for (const date of Object.keys(daily).sort()) {
    const d = daily[date];
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    if (d._hrv) { d.avgHRV = Math.round(avg(d._hrv) * 10) / 10; delete d._hrv; }
    if (d._rhr) { d.restingHR = Math.round(avg(d._rhr) * 10) / 10; delete d._rhr; }
    if (d._hr)  {
      d.avgHR = Math.round(avg(d._hr));
      d.minHR = Math.round(Math.min(...d._hr));
      d.maxHR = Math.round(Math.max(...d._hr));
      delete d._hr;
    }
    if (d._whr) { d.walkingHR = Math.round(avg(d._whr)); delete d._whr; }
    if (d._hrr) { d.hrRecovery = Math.round(avg(d._hrr)); delete d._hrr; }
    if (d._resp) { d.respiratoryRate = Math.round(avg(d._resp) * 10) / 10; delete d._resp; }
    if (d._spo2) { d.spo2Avg = Math.round(avg(d._spo2) * 10) / 10; delete d._spo2; }
    if (d._temp) { d.bodyTempAvg = Math.round(avg(d._temp) * 100) / 100; delete d._temp; }
    // Emit bedtime edges (ISO) when we captured them during sleep parsing.
    // Used downstream by the Sleep Regularity Index.
    if (d._sleepStartMs && d._sleepEndMs && d._sleepEndMs > d._sleepStartMs) {
      d.bedtimeStart = new Date(d._sleepStartMs).toISOString();
      d.bedtimeEnd = new Date(d._sleepEndMs).toISOString();
    }
    delete d._sleepStartMs; delete d._sleepEndMs;

    // Sleep-interval dedup. Apple Health SleepAnalysis records from
    // multiple sources (Watch, AutoSleep, Oura-bridge, Pillow, etc.)
    // overlap in time for the same night. Summing their durations
    // double- or triple-counts; instead we union-merge the intervals
    // and take the resulting non-overlapping minutes. Reliable whether
    // the user has 1 source or 5.
    if (d._segs) {
      const unionMinutes = (segs) => {
        if (!segs || segs.length === 0) return 0;
        const sorted = segs.slice().sort((a, b) => a[0] - b[0]);
        let total = 0, curStart = sorted[0][0], curEnd = sorted[0][1];
        for (let i = 1; i < sorted.length; i++) {
          const [s, e] = sorted[i];
          if (s <= curEnd) { if (e > curEnd) curEnd = e; }
          else { total += curEnd - curStart; curStart = s; curEnd = e; }
        }
        total += curEnd - curStart;
        return total / 60000;
      };
      const S = d._segs;
      if (S.asleep) d.totalSleepMin = unionMinutes(S.asleep);
      if (S.deep)   d.deepSleepMin  = unionMinutes(S.deep);
      if (S.rem)    d.remSleepMin   = unionMinutes(S.rem);
      if (S.light)  d.lightSleepMin = unionMinutes(S.light);
      if (S.inBed)  d.inBedMin      = unionMinutes(S.inBed);
      if (S.awake)  d.awakeMin      = unionMinutes(S.awake);
      delete d._segs;

      // Plausibility cap — if after dedup a single night is still
      // >14h of sleep, the export is likely pathological (e.g., a
      // source writing multi-day spans). Don't publish.
      if (typeof d.totalSleepMin === "number" && d.totalSleepMin > 840) {
        d.sleepSuspect = true;
        d.totalSleepMin = null; d.deepSleepMin = null;
        d.remSleepMin = null; d.lightSleepMin = null;
      }
    }
    ["totalSleepMin", "deepSleepMin", "remSleepMin", "lightSleepMin", "inBedMin", "awakeMin", "steps", "flights", "activeMinutes", "activeKcal", "basalKcal", "distanceKm", "mindfulMinutes"].forEach((k) => {
      if (d[k] != null) d[k] = Math.round(d[k] * 100) / 100;
    });
    d.source = "apple-health";
    result.push(d);
  }

  // Derive sleep / readiness / activity scores using rolling baselines.
  onProgress?.({ phase: "Computing scores…", percent: 94 });
  computeDerivedAppleScores(result);

  onProgress?.({ phase: "Done", percent: 100 });
  return { entries: result, totalRecords: count, keptRecords: kept, dateRange: { from: cutoffIso, to: new Date().toISOString().slice(0, 10) } };
}

/* ─── DERIVED SCORES ─────────────────────────────────────────────
   Apple Health gives raw physiology. The app UI expects 0-100
   composite scores the same way Oura produces them. These formulas
   mirror published protocols so the numbers are comparable and
   defensible:

   SLEEP SCORE (0-100) — weighted by wrist-sensor reliability.
   Wearable agreement with polysomnography (Chinoy 2021, de Zambotti
   2019): duration ~88%, efficiency ~80%, REM detection ~75%,
   deep-sleep ~58%. We weight accordingly — most of the score leans
   on the signals the sensor gets right, a little on the ones it
   doesn't. Scores shift less dramatically than before; that's the
   point. The measurement became more honest.
     · Duration (50%): peak at 7-9h, tapers 0-4h and 10h+
     · Efficiency (30%): asleep / in-bed × 100 (≥85% = full marks)
     · REM %  (15%): 20-25% of total sleep is target band
     · Deep % ( 5%): 13-23% target band — lowest weight because
                      wrist detection of slow-wave sleep is weakest

   READINESS SCORE (0-100) — based on HRV4Training / Altini lnRMSSD
     · HRV z-score vs 14-day baseline (40%)
     · RHR z-score vs 14-day baseline (25%, inverted — lower is better)
     · Previous night's sleep score (20%)
     · Respiratory-rate stability (10%)
     · Wrist-temperature deviation (5%)

   ACTIVITY SCORE (0-100) — Apple Move-ring analogue
     · Active kcal (40%, target 500)
     · Exercise minutes (30%, target 30)
     · Steps (30%, target 8000)
   ─────────────────────────────────────────────────────────────── */
export function computeDerivedAppleScores(sortedDays) {
  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  const rollingMedian = (arr, idx, key, window = 14) => {
    const slice = arr.slice(Math.max(0, idx - window), idx).map(d => d?.[key]).filter(v => typeof v === "number");
    return slice.length >= 3 ? median(slice) : null;
  };
  const rollingSd = (arr, idx, key, window = 14) => {
    const slice = arr.slice(Math.max(0, idx - window), idx).map(d => d?.[key]).filter(v => typeof v === "number");
    if (slice.length < 3) return null;
    const m = slice.reduce((s, v) => s + v, 0) / slice.length;
    const variance = slice.reduce((s, v) => s + (v - m) ** 2, 0) / slice.length;
    return Math.sqrt(variance) || null;
  };
  // lnRMSSD — HRV distributions are right-skewed; the log transform makes
  // them roughly normal, which is what Altini / Plews / Kiviniemi / Esco
  // all actually use. Z-scoring on log-transformed HRV is strictly more
  // defensible than on raw rMSSD; the cost is nothing but a Math.log.
  const rollingLnStats = (arr, idx, key, window = 14) => {
    const slice = arr.slice(Math.max(0, idx - window), idx)
      .map(d => d?.[key])
      .filter(v => typeof v === "number" && v > 0)
      .map(Math.log);
    if (slice.length < 3) return null;
    const m = slice.reduce((s, v) => s + v, 0) / slice.length;
    const variance = slice.reduce((s, v) => s + (v - m) ** 2, 0) / slice.length;
    const sd = Math.sqrt(variance) || null;
    return sd ? { mean: m, sd } : null;
  };

  for (let i = 0; i < sortedDays.length; i++) {
    const d = sortedDays[i];

    // ── Sleep Score ──────────────────────────────────────────
    if (d.totalSleepMin != null && d.totalSleepMin > 30) {
      const sleepH = d.totalSleepMin / 60;
      // Duration: peak 7-9h, linear taper
      let duration;
      if (sleepH >= 7 && sleepH <= 9) duration = 100;
      else if (sleepH < 7) duration = clamp((sleepH / 7) * 100);
      else duration = clamp(100 - (sleepH - 9) * 15);

      // Efficiency: only computable when we have real wake detection.
      // `inBedMin > 0` means in-bed was measured directly; `awakeMin > 0`
      // means wake was detected and we can reconstruct in-bed honestly.
      // If neither is present, efficiency is unknown — don't fabricate.
      let efficiency = null, effScore = null;
      const haveInBed = typeof d.inBedMin === "number" && d.inBedMin > 0;
      const haveWake  = typeof d.awakeMin === "number" && d.awakeMin > 0;
      if (haveInBed) {
        efficiency = clamp((d.totalSleepMin / d.inBedMin) * 100);
      } else if (haveWake) {
        efficiency = clamp((d.totalSleepMin / (d.totalSleepMin + d.awakeMin)) * 100);
      }
      if (efficiency != null) effScore = clamp(((efficiency - 70) / 25) * 100); // 70%=0, 95%=100

      // Deep/REM — only if we have stage data
      let deepScore = 70, remScore = 70;
      if (d.deepSleepMin != null) {
        const deepPct = d.deepSleepMin / d.totalSleepMin;
        // Target 13-23%, bell curve
        deepScore = deepPct >= 0.13 && deepPct <= 0.23 ? 100
          : deepPct < 0.13 ? clamp((deepPct / 0.13) * 100)
          : clamp(100 - (deepPct - 0.23) * 300);
      }
      if (d.remSleepMin != null) {
        const remPct = d.remSleepMin / d.totalSleepMin;
        remScore = remPct >= 0.20 && remPct <= 0.25 ? 100
          : remPct < 0.20 ? clamp((remPct / 0.20) * 100)
          : clamp(100 - (remPct - 0.25) * 300);
      }
      // Weighted score with honest redistribution: when efficiency is
      // unknown, its 30% weight redistributes across remaining signals
      // rather than a fabricated default driving the score.
      const parts = [{ s: duration, w: 0.50 }, { s: remScore, w: 0.15 }, { s: deepScore, w: 0.05 }];
      if (effScore != null) parts.push({ s: effScore, w: 0.30 });
      const wSum = parts.reduce((a, p) => a + p.w, 0);
      d.sleepScore = Math.round(parts.reduce((a, p) => a + p.s * p.w, 0) / wSum);
      d.sleepEfficiency = efficiency != null ? Math.round(efficiency) : null;
      // Rough parity with Oura "contributors" so downstream formulas can read them.
      d.sleepContributors = {
        total_sleep: Math.round(duration),
        efficiency: effScore != null ? Math.round(effScore) : null,
        deep_sleep: Math.round(deepScore),
        rem_sleep: Math.round(remScore),
      };
    }

    // ── Readiness Score ──────────────────────────────────────
    const hrvBaseline = rollingMedian(sortedDays, i, "avgHRV", 14);
    const hrvSd = rollingSd(sortedDays, i, "avgHRV", 14);
    const rhrBaseline = rollingMedian(sortedDays, i, "restingHR", 14);
    const rhrSd = rollingSd(sortedDays, i, "restingHR", 14);
    const respBaseline = rollingMedian(sortedDays, i, "respiratoryRate", 14);
    const respSd = rollingSd(sortedDays, i, "respiratoryRate", 14);
    const tempBaseline = rollingMedian(sortedDays, i, "bodyTempAvg", 14);

    const hrvLn = rollingLnStats(sortedDays, i, "avgHRV", 14);
    const pieces = [];
    if (d.avgHRV != null && d.avgHRV > 0 && hrvLn) {
      // Log-transformed HRV z-score. This is the same thing every serious
      // HRV paper does (Plews, Altini). The final piece score is shaped
      // identically to before so downstream consumers need no changes.
      const z = (Math.log(d.avgHRV) - hrvLn.mean) / hrvLn.sd;
      pieces.push({ w: 0.40, s: clamp(50 + z * 20) }); // +1 SD → 70, -1 SD → 30
    }
    if (d.restingHR != null && rhrBaseline && rhrSd) {
      const z = (d.restingHR - rhrBaseline) / rhrSd;
      pieces.push({ w: 0.25, s: clamp(50 - z * 20) }); // higher RHR = worse
    }
    const prior = sortedDays[i - 1]?.sleepScore;
    if (typeof prior === "number") pieces.push({ w: 0.20, s: prior });

    if (d.respiratoryRate != null && respBaseline && respSd) {
      const z = Math.abs((d.respiratoryRate - respBaseline) / respSd);
      pieces.push({ w: 0.10, s: clamp(100 - z * 25) });
    }
    if (d.bodyTempAvg != null && tempBaseline) {
      const dev = Math.abs(d.bodyTempAvg - tempBaseline);
      pieces.push({ w: 0.05, s: clamp(100 - dev * 50) });
      d.temperatureTrendDeviation = Math.round((d.bodyTempAvg - tempBaseline) * 100) / 100;
    }

    // Baseline depth check — don't publish a Readiness score until at
    // least 7 prior days of HRV or RHR exist. Below that threshold the
    // z-scores are dominated by measurement noise rather than the
    // user's actual state. The card shows a "Calibrating · X/7" state
    // instead. This matches Altini/HRV4Training, Plews & Laursen, and
    // WHOOP's published calibration windows.
    const hrvBaselineN = sortedDays.slice(Math.max(0, i - 14), i).filter((x) => typeof x?.avgHRV === "number").length;
    const rhrBaselineN = sortedDays.slice(Math.max(0, i - 14), i).filter((x) => typeof x?.restingHR === "number").length;
    const baselineReady = hrvBaselineN >= BASELINE_MIN_DAYS || rhrBaselineN >= BASELINE_MIN_DAYS;

    if (pieces.length && baselineReady) {
      const totalW = pieces.reduce((s, p) => s + p.w, 0);
      d.readinessScore = Math.round(pieces.reduce((s, p) => s + p.s * p.w, 0) / totalW);
      d.readinessContributors = {
        hrv_balance: d.avgHRV != null && d.avgHRV > 0 && hrvLn ? Math.round(clamp(50 + ((Math.log(d.avgHRV) - hrvLn.mean) / hrvLn.sd) * 20)) : null,
        resting_heart_rate: d.restingHR != null && rhrBaseline ? Math.round(clamp(50 - ((d.restingHR - rhrBaseline) / (rhrSd || 1)) * 20)) : null,
        previous_night: typeof prior === "number" ? prior : null,
      };
      if (d.avgHRV != null && d.avgHRV > 0 && hrvLn) {
        d.hrvBalance = Math.round(clamp(50 + ((Math.log(d.avgHRV) - hrvLn.mean) / hrvLn.sd) * 25));
      }
    }

    // ── Activity Score ───────────────────────────────────────
    if (d.activeKcal != null || d.activeMinutes != null || d.steps != null) {
      const kcal = clamp(((d.activeKcal || 0) / 500) * 100);
      const min  = clamp(((d.activeMinutes || 0) / 30) * 100);
      const stp  = clamp(((d.steps || 0) / 8000) * 100);
      d.activityScore = Math.round(kcal * 0.40 + min * 0.30 + stp * 0.30);
    }
  }
}

// Merge Apple Health daily entries into the existing Oura history map.
// Oura takes precedence when both sources have the same day + field.
// Returns { added, merged, latestDay, historyMap } so the caller can push
// the freshest biometrics into React state and run the AI insight pass.
export function mergeAppleHealthIntoHistory(appleEntries) {
  let map = {};
  try { const raw = localStorage.getItem(OURA_HISTORY_KEY); if (raw) map = JSON.parse(raw); } catch { /* ignore */ }
  let merged = 0, added = 0;
  // Sleep fields that travel together — when Apple Health rescues a day
  // from Oura's bad reading, we replace all of them from AH so the record
  // is internally consistent (can't have AH's 7h total + Oura's 45m deep).
  const SLEEP_BLOCK = ["totalSleepMin", "deepSleepMin", "remSleepMin", "lightSleepMin", "inBedMin", "awakeMin", "sleepEfficiency"];
  // Apple Watch happily logs a 20-minute couch doze or daytime nap as a
  // sleep sample. If we accept everything under 3h as "last night's sleep",
  // the You-tab Sleep restoration card displays a 30-min nap on a day the
  // user never went to bed — and the rolling baseline gets dragged down by
  // months of stray daytime detections. The 3h floor matches the existing
  // ouraSuspect threshold below, keeping the policy consistent across paths.
  const AH_SLEEP_MIN_FLOOR = 180;
  for (const rawEntry of appleEntries) {
    const isNapOrPartial = typeof rawEntry.totalSleepMin === "number" && rawEntry.totalSleepMin < AH_SLEEP_MIN_FLOOR;
    // Strip the sleep block from sub-floor entries so non-sleep fields
    // (steps, HRV, activeMinutes, etc.) still merge correctly without
    // contaminating the day's sleep record.
    const entry = isNapOrPartial
      ? Object.fromEntries(Object.entries(rawEntry).filter(([k]) => !SLEEP_BLOCK.includes(k) && k !== "bedtimeStart" && k !== "bedtimeEnd"))
      : rawEntry;
    const existing = map[entry.date];
    if (!existing) {
      // No Oura data for this date — Apple Health stands alone. Stamp
      // every populated field as Apple-sourced so a later Oura sync knows
      // to defer to Apple on the priority fields.
      const sources = {};
      for (const [k, v] of Object.entries(entry)) {
        if (k === "date" || k === "source" || v == null) continue;
        sources[k] = "apple-health";
      }
      map[entry.date] = { ...entry, _sources: sources };
      added++;
    } else {
      const sources = { ...(existing._sources || {}) };
      const agreement = { ...(existing._agreement || {}) };
      // Workout tag is the day-level signal for "Apple owns activeKcal":
      // Apple Watch's continuous wrist HR during the session is what makes
      // it more trustworthy than Oura's interpolation on workout days.
      const appleHasWorkout = Array.isArray(entry.workouts) && entry.workouts.length > 0;

      for (const [k, appleVal] of Object.entries(entry)) {
        if (k === "date" || k === "source" || k === "_sources" || k === "_agreement") continue;
        if (appleVal == null) continue;
        const ouraVal = existing[k];

        if (ouraVal == null) {
          // Apple fills a gap.
          existing[k] = appleVal;
          sources[k] = "apple-health";
          continue;
        }

        // Both sources have a value — record agreement for the fields we
        // have a tolerance defined for. "high" = within tolerance,
        // "low" = both present but disagree significantly.
        const agrees = ahOuraFieldsAgree(k, ouraVal, appleVal);
        if (agrees !== null) agreement[k] = agrees ? "high" : "low";

        // Per-field winner. APPLE_PRIORITY_FIELDS list is research-backed
        // (step count, flights, distance, active minutes — Apple Watch is
        // significantly more accurate). activeKcal is conditional on a
        // tagged workout. Everything else stays with Oura.
        let appleWins = APPLE_PRIORITY_FIELDS.has(k);
        if (k === "activeKcal" && appleHasWorkout) appleWins = true;

        if (appleWins) {
          existing[k] = appleVal;
          sources[k] = "apple-health";
        } else if (!sources[k]) {
          // Default attribution for an Oura-sourced field that the legacy
          // merge never tagged. Future syncs will respect this.
          sources[k] = "oura";
        }
      }

      // Sleep rescue: if Oura recorded <3h of "main sleep" (almost always a
      // missed night or a nap mislabelled as long_sleep) and Apple Health
      // has a plausible reading, let Apple Health take over the sleep block
      // for that day. Without this the day sits flagged ⚠ CHECK even though
      // AH has the truth. Manual overrides still win.
      const ouraSuspect = typeof existing.totalSleepMin === "number" && existing.totalSleepMin < 180 && existing.manualSleepMin == null;
      const appleHas = typeof entry.totalSleepMin === "number" && entry.totalSleepMin >= 180;
      if (ouraSuspect && appleHas) {
        for (const k of SLEEP_BLOCK) {
          if (entry[k] != null) {
            existing[k] = entry[k];
            sources[k] = "apple-health";
          }
        }
      }

      existing._sources = sources;
      existing._agreement = agreement;
      existing.source = existing.source === "apple-health" ? "apple-health" : (existing.source ? `${existing.source}+apple-health` : "apple-health");
      merged++;
    }
  }
  try { localStorage.setItem(OURA_HISTORY_KEY, JSON.stringify(map)); } catch { /* ignore */ }
  return { added, merged, latestDay: pickLatestMeaningfulDay(map), historyMap: map };
}

// Pick the most recent day in a history map that actually has meaningful
// signal. iPhone/Oura sync can lag a day, so "today" may still be empty —
// walk backwards until we find a day with at least one real reading.
export function pickLatestMeaningfulDay(historyMap) {
  if (!historyMap) return null;
  const dates = Object.keys(historyMap).sort();
  for (let i = dates.length - 1; i >= 0; i--) {
    const e = historyMap[dates[i]];
    if (e && (e.sleepScore != null || e.readinessScore != null || e.avgHRV != null || e.restingHR != null || e.totalSleepMin != null)) return e;
  }
  return null;
}

// Build a biometrics state object in the same shape Oura produces, so the
// rest of the app (rings, Signal, Claude prompt) sees apple data identically.
export function biometricsFromDayEntry(entry) {
  if (!entry) return null;
  return {
    sleepScore: entry.sleepScore ?? null,
    readinessScore: entry.readinessScore ?? null,
    activityScore: entry.activityScore ?? null,
    hrvBalance: entry.hrvBalance ?? null,
    avgHRV: entry.avgHRV ?? null,
    lowestHR: entry.minHR ?? null,
    restingHR: entry.restingHR ?? null,
    walkingHR: entry.walkingHR ?? null,
    hrRecovery: entry.hrRecovery ?? null,
    vo2Max: entry.vo2Max ?? null,
    sleepEfficiency: entry.sleepEfficiency ?? null,
    deepSleepMin: entry.deepSleepMin ?? null,
    remSleepMin: entry.remSleepMin ?? null,
    lightSleepMin: entry.lightSleepMin ?? null,
    totalSleepMin: entry.totalSleepMin ?? null,
    inBedMin: entry.inBedMin ?? null,
    respiratoryRate: entry.respiratoryRate ?? null,
    spo2Avg: entry.spo2Avg ?? null,
    temperatureTrendDeviation: entry.temperatureTrendDeviation ?? null,
    steps: entry.steps ?? null,
    activeMinutes: entry.activeMinutes ?? null,
    activeKcal: entry.activeKcal ?? null,
    flights: entry.flights ?? null,
    mindfulMinutes: entry.mindfulMinutes ?? null,
    bpSystolic: entry.bpSystolic ?? null,
    bpDiastolic: entry.bpDiastolic ?? null,
    sleepContributors: entry.sleepContributors ?? null,
    readinessContributors: entry.readinessContributors ?? null,
    optimalBedtime: entry.optimalBedtime ?? null,
    bedtimeStatus: entry.bedtimeStatus ?? null,
    restMode: entry.restMode ?? null,
    source: entry.source || "apple-health",
    date: entry.date,
  };
}

/* ─── AI INTELLIGENCE LAYER — Claude Sonnet 4.6 over parsed biometrics ──
   After raw Apple Health data is parsed and scored, we run it through
   Claude to generate a short, clinical-flavored narrative: what changed,
   what's likely driving it, and what (if anything) to watch. This keeps
   the "intelligence on" after the pull — the user sees interpretation,
   not a dashboard of numbers.
   ───────────────────────────────────────────────────────────────────── */
export async function runAppleHealthIntelligence(historyMap, latestDay, options = {}) {
  // Reflect mode is the words-only contract — no HRV/RHR/sleep-stage
  // intelligence card after import. The user can still see their data
  // in the integrations panel; we just don't write a Claude narrative
  // grounded in fields the rest of the app has agreed not to read.
  const { mode = "full" } = options;
  if (mode === "reflect") return null;
  if (!latestDay) return null;
  const today = latestDay.date;
  const trends = computeBiometricTrends(historyMap, today);
  if (!trends) return null;

  const compact = (e) => ({
    date: e.date,
    sleepScore: e.sleepScore ?? null, readinessScore: e.readinessScore ?? null, activityScore: e.activityScore ?? null,
    sleepH: e.totalSleepMin ? +(e.totalSleepMin / 60).toFixed(1) : null,
    efficiency: e.sleepEfficiency ?? null, deepMin: e.deepSleepMin ?? null, remMin: e.remSleepMin ?? null,
    avgHRV: e.avgHRV ?? null, restingHR: e.restingHR ?? null, respRate: e.respiratoryRate ?? null,
    steps: e.steps ?? null, activeMinutes: e.activeMinutes ?? null, activeKcal: e.activeKcal ?? null,
  });
  const sortedDates = Object.keys(historyMap).sort();
  const last14 = sortedDates.slice(-14).map(d => compact(historyMap[d])).filter(Boolean);

  const system = `You are a biometrics interpretation layer grounded in sleep medicine (AASM) and autonomic physiology (HRV/RHR protocols from Altini, Plews, Buchheit).

You receive 14 days of parsed Apple Health data plus rolling baselines. Your job is NOT to list numbers the UI is already showing. Your job is to identify the one or two MOST MEANINGFUL signals in the data and explain them in plain language.

Rules:
- One headline: the most important pattern (not just today's snapshot).
- 2-4 bullets of context: what's trending, why it may matter, any divergence between systems (e.g., HRV crashed but user slept 8h — autonomic stress even without sleep debt).
- If baselines are too short (< 7 days), say so briefly and refrain from strong claims.
- If red flags are present (HRV >20% below baseline for 3+ days, RHR elevation >7bpm, respiratory rate stepped up >2 breaths/min) name them explicitly and suggest a plain-language action ("scale back training for 48h", "check for illness onset", "prioritize sleep tonight").
- Never invent numbers. Refer to what's in the data.

Return JSON only:
{
  "headline": "one sentence",
  "bullets": ["...", "..."],
  "flags": ["red-flag string", ...],
  "actions": ["plain-language action", ...],
  "confidence": "high|medium|low"
}`;

  const user = `TODAY: ${today}
LATEST DAY: ${JSON.stringify(compact(latestDay))}
BASELINES (14d):
  HRV median: ${trends.hrvBaseline30 ? Math.round(trends.hrvBaseline30) : "n/a"}ms
  RHR median: ${trends.rhr30 ?? "n/a"}
  Sleep-score 7d avg: ${trends.sleepScore7 != null ? Math.round(trends.sleepScore7) : "n/a"}
  Readiness 7d avg: ${trends.readiness7 != null ? Math.round(trends.readiness7) : "n/a"}
  HRV delta vs baseline: ${trends.hrvDelta != null ? trends.hrvDelta.toFixed(1) + "%" : "n/a"}
  RHR delta vs baseline: ${trends.rhrDelta != null ? (trends.rhrDelta >= 0 ? "+" : "") + trends.rhrDelta.toFixed(1) : "n/a"}
  Sleep-debt 7d: ${trends.sleepDebtH != null ? trends.sleepDebtH.toFixed(1) + "h" : "n/a"}

LAST 14 DAYS: ${JSON.stringify(last14)}`;

  try {
    const data = await fetchAnthropicWithRetry({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = data?.content?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

/* ─── JOURNAL REPOSITORY (bulk import of past writings + image OCR) ─── */
export const JOURNAL_REPO_KEY = "cpi_journal_repo";
export const REPO_MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // Anthropic cap
export const REPO_MAX_TEXT_CHARS  = 50_000;
// Runaway-loop backstop only — NOT a quota knob. The repo lives in
// IndexedDB (storage.js), so there is no 5 MB pressure; 5000 entries is
// ~13 years of daily writing. The old cap of 500 silently dropped a
// heavy user's oldest journals, which violates the data contract
// (scripts/audit-data-safety.mjs): existing journals are never deleted
// by an upgrade or an ordinary write.
export const REPO_MAX_ENTRIES     = 5000;

// One-time migration: earlier Reflect-mode plants saved seed text under
// `entry.text`, but the reader and AI analyzer both look at `transcription`
// or `rawText`. Result: those seeds opened almost blank and were dropped
// from analysis. On every load we promote any `text` field into the
// canonical fields and persist. Idempotent — once an entry has
// transcription/rawText, the loop is a no-op.
function migrateLegacyTextField(repo) {
  if (!repo || !Array.isArray(repo.entries)) return { repo, changed: false };
  let changed = false;
  const entries = repo.entries.map(e => {
    if (!e || typeof e !== "object") return e;
    const hasCanonical = (typeof e.transcription === "string" && e.transcription.length > 0)
      || (typeof e.rawText === "string" && e.rawText.length > 0);
    if (hasCanonical) return e;
    if (typeof e.text === "string" && e.text.length > 0) {
      changed = true;
      const next = { ...e, transcription: e.text, rawText: e.text };
      delete next.text;
      return next;
    }
    return e;
  });
  return { repo: { ...repo, entries }, changed };
}

// One-time migration: plantSeed used to stamp `date` via UTC slicing
// (`new Date().toISOString().split("T")[0]`), which pushes evening
// writers' seeds into "tomorrow" once the wall clock crosses midnight
// UTC. We re-stamp `date` to the local YMD of `uploadedAt`, which is
// what the user actually wrote on. Scoped to source==="checkin" (only
// path that shipped with this bug) and idempotent — only updates when
// stored date diverges from the local date.
function migrateSeedDateDrift(repo) {
  if (!repo || !Array.isArray(repo.entries)) return { repo, changed: false };
  let changed = false;
  const entries = repo.entries.map(e => {
    if (!e || e.source !== "checkin") return e;
    if (typeof e.date !== "string") return e;
    // Cross-midnight safe: a check-in's canonical day is when it STARTED, not
    // when it was submitted. canonicalCheckinDay heals toward the recorded
    // startedAt (never the submit time, or a note begun 11:59 PM and saved 12:01
    // AM would be dragged onto the next day); legacy entries with no startedAt
    // fall back to the uploadedAt local day (the original seed-date-drift heal).
    if (e.startedAt == null && !e.uploadedAt) return e;
    const local = canonicalCheckinDay(e);
    if (local && local !== e.date) {
      changed = true;
      return { ...e, date: local };
    }
    return e;
  });
  return { repo: { ...repo, entries }, changed };
}

// One-time migration: entries written before repoAdd assigned ids (or imported
// without one) have no stable id, so repoUpdate/repoRemove can't target them —
// they'd be uneditable in the Day view. Backfill a STABLE id derived from the
// entry's own timestamp (createdAt → uploadedAt → date) plus its index, so the
// id is identical on every load and gets persisted on first read. Idempotent —
// entries that already have an id are left untouched.
function migrateBackfillIds(repo) {
  if (!repo || !Array.isArray(repo.entries)) return { repo, changed: false };
  let changed = false;
  const entries = repo.entries.map((e, i) => {
    if (!e || typeof e !== "object" || e.id) return e;
    changed = true;
    const stamp = e.createdAt || Date.parse(e.uploadedAt || e.date || "") || 0;
    return { ...e, id: `rep_mig_${stamp}_${i}` };
  });
  return { repo: changed ? { ...repo, entries } : repo, changed };
}

export function loadRepo() {
  try {
    const raw = JSON.parse(localStorage.getItem(JOURNAL_REPO_KEY) || "null") || { entries: [] };
    const { repo: r1, changed: c1 } = migrateLegacyTextField(raw);
    const { repo: r2, changed: c2 } = migrateSeedDateDrift(r1);
    const { repo: r3, changed: c3 } = migrateBackfillIds(r2);
    if (c1 || c2 || c3) {
      try { localStorage.setItem(JOURNAL_REPO_KEY, JSON.stringify(r3)); } catch { /* quota — non-fatal */ }
    }
    return r3;
  } catch { return { entries: [] }; }
}
// Shrink guard — the journal is the product's irreplaceable store, and
// loadRepo() falls back to { entries: [] } on any read/parse failure. If
// that ever happened mid-session (IDB hiccup, corrupted blob), the next
// ordinary save would persist the empty repo over years of writing. So a
// save that would drop more than half of an established repo is refused
// unless the caller says it means to shrink (delete-a-day, till-under,
// swipe-delete all pass allowShrink). Refusal returns false and writes
// nothing — the stored journal stays exactly as it was.
export function saveRepo(r, { allowShrink = false } = {}) {
  try {
    if (!allowShrink) {
      try {
        const prevRaw = localStorage.getItem(JOURNAL_REPO_KEY);
        const prev = prevRaw ? JSON.parse(prevRaw) : null;
        const prevN = Array.isArray(prev?.entries) ? prev.entries.length
          : (Array.isArray(prev) ? prev.length : 0);
        const nextN = Array.isArray(r?.entries) ? r.entries.length : 0;
        if (prevN >= 5 && nextN < prevN / 2) {
          console.error(`saveRepo blocked: would shrink the journal ${prevN} → ${nextN} entries without allowShrink`);
          return false;
        }
      } catch { /* guard unreadable — let the write proceed */ }
    }
    localStorage.setItem(JOURNAL_REPO_KEY, JSON.stringify(r));
    return true;
  } catch { return false; } // quota exceeded
}
export function repoAdd(entry) {
  const r = loadRepo();
  r.entries = [{ ...entry, id: entry.id || `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }, ...r.entries].slice(0, REPO_MAX_ENTRIES);
  saveRepo(r);
  return r;
}
export function repoRemove(id) {
  const r = loadRepo();
  r.entries = r.entries.filter(e => e.id !== id);
  saveRepo(r, { allowShrink: true });
  return r;
}
export function repoUpdate(id, patch) {
  const r = loadRepo();
  r.entries = r.entries.map(e => e.id === id ? { ...e, ...patch } : e);
  saveRepo(r);
  return r;
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = fr.result;
      const b64 = typeof s === "string" ? s.split(",")[1] : "";
      resolve(b64);
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// Detect what kind of file the user uploaded. Images still go through the
// photo pipeline; everything else routes here.
export const REPO_MAX_DOC_BYTES = 25 * 1024 * 1024;
export const REPO_MAX_AUDIO_BYTES = 50 * 1024 * 1024;

export function detectFileKind(file) {
  const n = (file?.name || "").toLowerCase();
  const t = file?.type || "";
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("audio/") || /\.(mp3|wav|m4a|ogg|webm|flac|aac)$/.test(n)) return "audio";
  if (t === "application/pdf" || /\.pdf$/.test(n)) return "pdf";
  if (/\.(docx)$/.test(n) || t === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (/\.(doc)$/.test(n)) return "doc";
  if (t.startsWith("text/") || /\.(txt|md|markdown|text)$/.test(n)) return "text";
  return "unknown";
}

export async function readTextFile(file) {
  if (file.size > REPO_MAX_DOC_BYTES) throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 25MB.`);
  const text = await file.text();
  return {
    transcription: text,
    detectedDate: "",
    dateText: "",
    confidence: 1.0,
    illegibleCount: 0,
    notes: `Imported from ${file.name}`,
  };
}

export async function readDocxFile(file) {
  if (file.size > REPO_MAX_DOC_BYTES) throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 25MB.`);
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const text = (result.value || "").trim();
  if (!text) throw new Error("Document appears empty.");
  return {
    transcription: text,
    detectedDate: "",
    dateText: "",
    confidence: 1.0,
    illegibleCount: 0,
    notes: `Imported from ${file.name}${result.messages?.length ? ` · ${result.messages.length} formatting note(s)` : ""}`,
  };
}

export async function readPdfFile(file) {
  if (file.size > REPO_MAX_DOC_BYTES) throw new Error(`PDF too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 25MB.`);
  const b64 = await fileToBase64(file);

  const system = `You are extracting text from a journal PDF (typed or scanned) with maximum fidelity. Preserve paragraph breaks. Mark illegible words as [illegible] — do NOT guess. Detect any date written in or at the top of the document (return as YYYY-MM-DD when possible, else raw phrase in dateText). Always call the tool.`;

  const data = await fetchAnthropicWithRetry({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system,
      tools: [{
        name: "record_transcription",
        description: "Record the extracted journal text from this PDF.",
        input_schema: {
          type: "object",
          properties: {
            transcription: { type: "string", description: "Verbatim extracted text, preserving paragraph breaks." },
            detectedDate: { type: "string", description: "Date found (YYYY-MM-DD); empty string if none." },
            dateText: { type: "string", description: "Raw date phrase as written; empty if none." },
            confidence: { type: "number", description: "0 to 1 extraction confidence." },
            illegibleCount: { type: "integer", description: "[illegible] marker count." },
            notes: { type: "string", description: "One short line of observations." },
          },
          required: ["transcription", "confidence"],
        },
      }],
      tool_choice: { type: "tool", name: "record_transcription" },
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: "Extract the journal text from this PDF using the record_transcription tool." },
        ],
      }],
  });
  const tool = (data.content || []).find(c => c.type === "tool_use" && c.name === "record_transcription");
  if (!tool) throw new Error("No extraction returned");
  return tool.input;
}

export async function transcribeAudioFile(file) {
  if (file.size > REPO_MAX_AUDIO_BYTES) throw new Error(`Audio too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 50MB.`);
  const mime = file.type || "audio/mpeg";
  const url = `/proxy/deepgram?model=nova-3&smart_format=true&punctuate=true&paragraphs=true&utterances=false&language=en`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": mime },
    body: file,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Deepgram ${res.status}: ${t.slice(0, 180)}`);
  }
  const data = await res.json();
  const channel = data?.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  if (!alt?.transcript) throw new Error("No speech detected.");
  const paras = alt.paragraphs?.paragraphs || [];
  const text = paras.length
    ? paras.map(p => (p.sentences || []).map(s => s.text).join(" ")).join("\n\n")
    : alt.transcript;
  const conf = typeof alt.confidence === "number" ? alt.confidence : 0.9;
  return {
    transcription: text,
    detectedDate: "",
    dateText: "",
    confidence: conf,
    illegibleCount: 0,
    notes: `Audio transcription (${Math.round(conf * 100)}% confidence) — ${file.name}`,
  };
}

export async function transcribeJournalImage(file) {
  if (file.size > REPO_MAX_IMAGE_BYTES) throw new Error(`Image too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 5MB.`);
  const mime = file.type || "image/jpeg";
  if (!/^image\//.test(mime)) throw new Error(`Not an image: ${mime}`);
  const b64 = await fileToBase64(file);

  const system = `You are transcribing handwritten or typed journal entries with maximum fidelity. Preserve the writer's exact words, punctuation, and paragraph breaks. If words are illegible, mark them [illegible] — do NOT guess. Detect any date written at the top or within (return as YYYY-MM-DD if possible, else a short free-text date phrase). Report your overall confidence (0-1). Keep observations brief. Always call the tool.`;

  const data = await fetchAnthropicWithRetry({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      system,
      tools: [{
        name: "record_transcription",
        description: "Record the transcription of a journal page.",
        input_schema: {
          type: "object",
          properties: {
            transcription: { type: "string", description: "Verbatim transcription with original line breaks." },
            detectedDate: { type: "string", description: "Date found on the page, YYYY-MM-DD if possible; empty string if none." },
            dateText: { type: "string", description: "Raw date phrase as written ('Tues 3rd Feb' etc); empty if none." },
            confidence: { type: "number", description: "0 to 1 overall transcription confidence." },
            illegibleCount: { type: "integer", description: "Number of [illegible] markers inserted." },
            notes: { type: "string", description: "One short line of observations (tone, length, context)." },
          },
          required: ["transcription", "confidence"],
        },
      }],
      tool_choice: { type: "tool", name: "record_transcription" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
          { type: "text", text: "Transcribe this journal page using the record_transcription tool." },
        ],
      }],
  });
  const tool = (data.content || []).find(c => c.type === "tool_use" && c.name === "record_transcription");
  if (!tool) throw new Error("No transcription returned");
  return tool.input;
}

// SAMPLE_REPO_ENTRIES imported from ./knowledge-base.js.

export const COACH_CACHE_KEY = "cpi_coach_line";
export function loadCoachCache() {
  try { return JSON.parse(localStorage.getItem(COACH_CACHE_KEY) || "null"); } catch { return null; }
}
export function saveCoachCache(obj) {
  try { localStorage.setItem(COACH_CACHE_KEY, JSON.stringify(obj)); } catch { /* ignore */ }
}
export function ringSignature(rings) {
  const r = (n) => n == null ? "_" : Math.round(n / 5) * 5;
  const today = new Date().toISOString().split("T")[0];
  return `${today}|${r(rings.body.value)}|${r(rings.mind.value)}|${r(rings.mood.value)}`;
}

// ─────────────────────────────────────────────────────────────────────
//  generateReadingInsight — Claude-written "The reading" block insight.
//  Replaces the templated explanation in ReadingBlockV5 when the API
//  works. Cached by analysis signature so repeat renders don't re-call.
//
//  Voice: consumer-friendly, specific, factual, one educative beat.
//  No clinical jargon (HRV / chronotype / off-peak), no abbreviations.
//  Numbers always with meaning. 2 short sentences max.
// ─────────────────────────────────────────────────────────────────────
export const READING_INSIGHT_CACHE_KEY = "cpi_reading_insight";

export function readingInsightSignature(h, a, biometrics, options = {}) {
  // Mode is part of the cache key so a Full-mode reading doesn't get
  // served back to a user who has since switched to Reflect (and would
  // still see HRV / Sleep references baked into the cached text).
  // todayText hash forces a fresh reading whenever the user adds a line —
  // without it, the cached reading lags behind what the user just wrote.
  const { mode = "full", todayText = "" } = options;
  const r = (n) => n == null ? "_" : Math.round(n * 100) / 100;
  const today = new Date().toISOString().split("T")[0];
  const sleep = biometrics?.totalSleepMin || biometrics?.manualSleepMin || 0;
  let txtHash = 0;
  for (let i = 0; i < todayText.length; i++) txtHash = ((txtHash << 5) - txtHash + todayText.charCodeAt(i)) | 0;
  const dec = a?.decisionCount ?? "_";
  return `${today}|m=${mode}|hcpi=${r(h?.HCPI)}|cm=${r(h?.chronoMod)}|rs=${r(h?.recentStrain)}|psi=${r(a?.psi)}|sl=${Math.round(sleep)}|dec=${dec}|t=${txtHash}|len=${todayText.length}`;
}

export function loadReadingInsightCache() {
  try { return JSON.parse(localStorage.getItem(READING_INSIGHT_CACHE_KEY) || "null"); } catch { return null; }
}
export function saveReadingInsightCache(obj) {
  try { localStorage.setItem(READING_INSIGHT_CACHE_KEY, JSON.stringify(obj)); } catch { /* ignore */ }
}

export async function generateReadingInsight(h, a, biometrics, chronotype, options = {}) {
  // In Reflect, the facts block omits body-derived lines (sleep, time-of-day
  // rhythm, stress carryover) so Claude can only ground in journal-derived
  // signals. This is what makes the "words-only" contract literal.
  const { mode = "full", todayText = "" } = options;
  const sig = readingInsightSignature(h, a, biometrics, { mode, todayText });
  const cached = loadReadingInsightCache();
  if (cached?.signature === sig && cached.text) return cached.text;

  const ct = (chronotype && CHRONOTYPES?.[chronotype]) || { label: "Flexible", peakStart: 10, peakEnd: 14 };
  const sleepMin = biometrics?.totalSleepMin || biometrics?.manualSleepMin || 0;
  const sleepStr = sleepMin > 30 ? `${Math.floor(sleepMin/60)}h ${Math.round(sleepMin%60)}m` : "no sleep data";
  const fmtPct = (v) => v == null ? "(n/a)" : (v * 100).toFixed(0) + "%";

  // Sleep regularity qualitative label (Phillips 2017 SRI bands).
  // Kept qualitative — the audit's voice-rule work translates engine
  // internals away from raw numbers in LLM context.
  const sriLabel = typeof biometrics?.sri7d !== "number"
    ? "(n/a)"
    : biometrics.sri7d >= 85 ? "very stable"
    : biometrics.sri7d >= 70 ? "stable"
    : biometrics.sri7d >= 50 ? "variable"
    : "irregular";

  // Sleep debt 7-day qualitative label (Van Dongen 2003 dose-response bands).
  // Hours behind an 8h/night target across the last 7 nights with data.
  const debtLabel = typeof biometrics?.sleepDebt7d !== "number"
    ? "(n/a)"
    : biometrics.sleepDebt7d <= -3 ? "ahead of target"
    : biometrics.sleepDebt7d < 3 ? "on target"
    : biometrics.sleepDebt7d < 10 ? "mild debt"
    : biometrics.sleepDebt7d < 18 ? "moderate debt"
    : "severe debt";

  // Decision count comes from the engine's tool response (a.decisionCount),
  // which counts decision-named phrases in TODAY's writing only. The previous
  // version summed all driver keyword hits (survival + social + reward + etc.)
  // and labeled the total as "decisions" — that produced misleading numbers
  // like "22 decisions" when the user named ~5 and the rest were tiredness /
  // social / dopamine keywords. Fixed: use the real field.
  const decCount = Math.max(0, Math.round(a?.decisionCount || 0));
  // Compact data dump for Claude — facts only, no narrative.
  const fullFacts = [
    `HCPI score: ${(h?.HCPI ?? 0).toFixed(2)} (0 lowest, 1 highest)`,
    `Sleep last night: ${sleepStr} (typical 7h)`,
    `Sleep regularity (last 14 days): ${sriLabel}`,
    `Sleep debt (last 7 days): ${debtLabel}`,
    `Hours awake: ${h?.Ha ? Math.round(h.Ha) : "?"}h`,
    `Time-of-day rhythm match: ${fmtPct(h?.chronoMod)} (1 = peak window)`,
    `Stress carryover last 7 days: ${(h?.recentStrain ?? 1).toFixed(2)} (1 = baseline)`,
    `Emotional tone in writing: ${a?.psi != null ? a.psi.toFixed(2) : "(n/a)"} (1 = neutral, <0.7 = heavy)`,
    `Decisions named in today's writing: ${decCount}`,
    `Sharpest window: ${ct.peakStart}:00–${ct.peakEnd}:00`,
  ];
  // Reflect: drop everything wrist/body-derived. Keep only journal-grounded
  // signals.
  const reflectFacts = [
    `HCPI score: ${(h?.HCPI ?? 0).toFixed(2)} (0 lowest, 1 highest)`,
    `Emotional tone in writing: ${a?.psi != null ? a.psi.toFixed(2) : "(n/a)"} (1 = neutral, <0.7 = heavy)`,
    `Decisions named in today's writing: ${decCount}`,
  ];
  const facts = (mode === "reflect" ? reflectFacts : fullFacts).join("\n");

  const system = `You are Ori — a quiet, factual coach inside a personal health app.

Write a TWO-SENTENCE explanation of why today's "reserves" reading is what it is, GROUNDED IN WHAT THE USER ACTUALLY WROTE TODAY (provided below). Then ONE italic educative sentence that teaches the user something they can carry forward.

VOICE RULES (non-negotiable):
- Plain English. Never use: chronotype, HRV, off-peak, baseline, NLP, BRAC, allostatic, autonomic. Say "your sharpest hours", "your body's recovery", "your usual", etc.
- Always pair a number with meaning. Not "Sleep 6h 12m" — write "6h 12m, an hour short of your usual."
- Specific to TODAY. Reference something the user actually wrote — a phrase, an event, a person, a moment from today's writing below. Never write generic philosophy.
- The facts below describe TODAY only. Do NOT reference yesterday, this week, history, or trends. Today is the only horizon.
- Never contradict yourself. If sleep was 8h, do not say "short sleep is pulling on you."
- No fluff, no emoji, no pep-talk. Don't be overly empathetic.
- Don't lead with the HCPI number itself. The user already sees the score.

OUTPUT FORMAT (exact):
First sentence + second sentence on one line — both in regular voice.
Then a line break.
Then ONE sentence in italics (use *asterisks*) as the educative beat.

Length: 60 words total, hard cap.`;

  const reflectGuard = mode === "reflect"
    ? `\n\nMODE: words-only. No body data is available this analysis. Do NOT mention sleep, HRV, heart rate, recovery, time-of-day rhythm, sharpest window, or stress carryover. Ground the reading in the user's writing only — emotional tone and decisions named.`
    : "";
  // Hard cap on text length so the prompt doesn't balloon when the user
  // wrote a long entry. 1500 chars (~300 words) is plenty for grounding.
  const todayBlock = todayText && todayText.trim()
    ? `\n\nTODAY'S WRITING (verbatim — quote or paraphrase a specific moment from this):\n"""\n${todayText.trim().slice(0, 1500)}\n"""`
    : "";
  const user = `Today's facts:\n${facts}${reflectGuard}${todayBlock}\n\nWrite the two-sentence reading + one italic educative beat. The first sentence MUST reference a specific phrase, image, or moment from today's writing above.`;

  try {
    const data = await fetchAnthropicWithRetry({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = (data.content || []).find(c => c.type === "text")?.text?.trim();
    if (!text) return null;
    saveReadingInsightCache({ signature: sig, text, generatedAt: Date.now() });
    return text;
  } catch {
    return null;
  }
}

export async function generateCoachLine(rings, bodyContext) {
  const sig = ringSignature(rings);
  const cached = loadCoachCache();
  if (cached?.signature === sig && cached.text) return cached.text;

  const summary = [
    rings.body.value != null ? `Body ${Math.round(rings.body.value)}/100` : "Body no data",
    rings.mind.value != null ? `Mind ${Math.round(rings.mind.value)}/100` : "Mind no data",
    rings.mood.value != null ? `Mood ${Math.round(rings.mood.value)}/100` : "Mood no data",
  ].join(" · ");

  const system = `You are Ori — a quiet, honest coach inside a personal health app. One short line only (max 22 words). Be specific, use the actual numbers/signals to predict how the next few hours may feel. No fluff, no emoji, no generic pep-talk. Do not be overly empathetic. Do not repeat the numbers verbatim — translate them into a felt prediction. If data is missing, acknowledge it in one phrase.`;

  const user = `Today's rings:\n${summary}\n\nContext:\n${bodyContext || "(limited body context)"}\n\nWrite ONE line for the user.`;

  try {
    const data = await fetchAnthropicWithRetry({
      model: "claude-sonnet-4-6",
      max_tokens: 90,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = (data.content || []).find(c => c.type === "text")?.text?.trim();
    if (!text) return null;
    saveCoachCache({ signature: sig, text, generatedAt: Date.now() });
    return text;
  } catch {
    return null;
  }
}

export function computeE0(biometrics, lifestyle) {
  if (!biometrics && !lifestyle) return 1.0;
  // Manual sleep-hour overlay takes precedence over the 1-10 quality slider
  // when the user has actually typed in a duration. The slider was a legacy
  // fallback for "I don't have a ring."
  const manualFromHours = manualSleepToScore(biometrics?.manualSleepMin, biometrics?.manualSleepQual);
  const sleep = biometrics?.sleepScore ?? manualFromHours ?? (biometrics?.manualSleep || 7) * 10;
  const readiness = biometrics?.readinessScore ?? (biometrics?.manualEnergy || 7) * 10;
  let e0 = (sleep / 100) * 0.6 + (readiness / 100) * 0.4;

  // Raw HRV (ms) — autonomic nervous system readiness. Magnon 2022 (Cortex)
  // meta-analysis k=13 puts HRV↔executive-function r ≈ 0.19 (small effect).
  // A r=0.19 effect explains ~3.6% of cognitive variance, so the multiplier
  // clamp is tightened from the original ±20–40% to **±10%** per the HCPI
  // validation audit (Cluster A). At avgHRV=50 the factor is neutral.
  if (biometrics?.avgHRV != null) {
    const hrvFactor = Math.min(1.10, Math.max(0.90, biometrics.avgHRV / 50));
    e0 *= hrvFactor;
  } else if (biometrics?.hrvBalance != null) {
    e0 *= Math.min(1.10, Math.max(0.90, biometrics.hrvBalance / 75));
  }

  // Resting HR — Yoo 2022 J Clin Neurol meta-analysis: null association in
  // healthy adults once HRV is partialled out; effect emerges only in
  // disease cohorts. Tightened from ±10–15% to **±5%** per the audit.
  if (biometrics?.restingHR != null) {
    const hrFactor = Math.min(1.05, Math.max(0.95, 1.075 - biometrics.restingHR / 400));
    e0 *= hrFactor;
  }

  // Deep sleep % — Dijk 2009 J Clin Sleep Med: largely redundant with total
  // sleep time for next-day cognition in healthy adults. SWS is critical
  // for homeostatic recovery and memory consolidation, but as a *direct*
  // next-day cognitive predictor independent of TST it carries little
  // additional weight. Tightened from ±10–15% to **±5%** per the audit.
  // Centered so typical deep-sleep proportion (~20%) ≈ neutral.
  if (biometrics?.deepSleepMin != null && biometrics?.totalSleepMin) {
    const deepPct = biometrics.deepSleepMin / biometrics.totalSleepMin;
    const deepFactor = Math.min(1.05, Math.max(0.95, 1.0 + (deepPct - 0.20) * 0.5));
    e0 *= deepFactor;
  }

  // Sleep Regularity Index (Phillips et al. 2017, Sci Rep) — the strongest
  // emerging single predictor of next-day cognition and long-term cognitive
  // outcomes in the sleep literature. SRI = 100 means perfect minute-to-
  // minute agreement of sleep/wake state across consecutive 24-hour
  // windows; SRI = 0 means none. Phillips 2017 r ≈ 0.37 with academic
  // performance; Windred 2024 HR 1.53 for dementia at low SRI.
  //
  // Caller injects `sri7d` into biometrics from computeBiometricTrends().sri
  // before computing HCPI. Neutral anchor at SRI = 70 (typical adult value).
  // Clamp ±15% — the largest single defensibility upgrade per the HCPI
  // validation audit (Cluster A).
  if (typeof biometrics?.sri7d === "number") {
    const sriFactor = Math.min(1.15, Math.max(0.85, 1.0 + (biometrics.sri7d - 70) * 0.005));
    e0 *= sriFactor;
  }

  // Cumulative sleep debt (Van Dongen 2003: "Cumulative Cost of Additional
  // Wakefulness"). 14 nights at 6h sleep (~14h debt vs 8h target) caused PVT
  // lapse counts ~equivalent to two nights of total sleep deprivation —
  // dose-dependent and approximately linear in the debt range we observe in
  // normal life (0–25h over a week). Effect on next-day cognition is real
  // but smaller than SRI's circadian-misalignment effect, so we clamp ±10%
  // (vs ±15% for SRI). Neutral anchor at 0h debt (hit your 8h target).
  // Positive sleepDebt7d = hours behind target; negative = surplus.
  if (typeof biometrics?.sleepDebt7d === "number") {
    const debtFactor = Math.min(1.10, Math.max(0.90, 1.0 - biometrics.sleepDebt7d * 0.005));
    e0 *= debtFactor;
  }

  // ─── Underused-Oura factors ───────────────────────────────────────────
  // Four small multipliers folding in data Oura ships but HCPI ignored
  // until 2026-05-14. Each is tight (±2 to ±5%) because they overlap
  // with signals already in E0 (HRV, RHR, sleep duration, deep sleep %)
  // — these add the *residual* Oura-only signal, not double-counted base.

  // 1) Recovery Index — Oura's own readiness sub-score (0-100 scale)
  //    derived from HRV/RHR/temperature regression against their internal
  //    outcome data. We collect it via /daily_readiness contributors but
  //    didn't read it. Tight ±3% because it overlaps with our own HRV/RHR
  //    factors above.
  const recoveryIdx = biometrics?.readinessContributors?.recovery_index;
  if (typeof recoveryIdx === "number") {
    const recoveryFactor = Math.min(1.03, Math.max(0.97, 1.0 + (recoveryIdx - 50) * 0.0006));
    e0 *= recoveryFactor;
  }

  // 2) Sleep efficiency — % of time-in-bed actually asleep. Buysse 2008
  //    PSQI scoring puts healthy at ≥85%; chronic insomnia <75%. Centered
  //    at 85%, ±3% clamp.
  if (typeof biometrics?.sleepEfficiency === "number") {
    const effFactor = Math.min(1.03, Math.max(0.97, 1.0 + (biometrics.sleepEfficiency - 85) * 0.002));
    e0 *= effFactor;
  }

  // 3) Sleep latency — minutes to fall asleep. Healthy adult range
  //    10–20 min (Hirshkowitz 2015 NSF consensus). >30 min = autonomic
  //    activation / anxiety. <5 min = often a sign of severe sleep
  //    debt (already counted via sleepDebt7d, so we tap lightly here
  //    to avoid double-counting).
  if (typeof biometrics?.latencyMin === "number") {
    const lat = biometrics.latencyMin;
    let latFactor = 1.0;
    if (lat > 30) latFactor = 0.98;        // long onset → -2%
    else if (lat < 5) latFactor = 0.99;    // hyper-rapid onset → light -1%
    e0 *= latFactor;
  }

  // 4) Stress signal — Oura's stressHighSec = total seconds of
  //    elevated-stress wrist-temp/HRV signals during waking hours.
  //    > 30 min/day starts to register; smooth drag up to 90 min/day = -3%.
  //    Fallback: PSS-4 (Cohen 1988, validated 4-item Perceived Stress
  //    Scale) from the user's most recent in-app check-in, freshness
  //    7 days. Score 0–16; tight ±4% clamp centered on score 4 (low
  //    stress baseline). Only one of these fires per call — Oura wins.
  if (typeof biometrics?.stressHighSec === "number") {
    const stressMin = biometrics.stressHighSec / 60;
    const stressFactor = Math.min(1.0, Math.max(0.97, 1.0 - Math.max(0, stressMin - 30) * 0.0005));
    e0 *= stressFactor;
  } else {
    try {
      const checkin = JSON.parse(localStorage.getItem(CHECKIN_KEY) || "{}");
      if (checkin?.pss4 && checkin.pss4.timestamp) {
        const ageMin = (Date.now() - new Date(checkin.pss4.timestamp).getTime()) / 60000;
        if (ageMin < 10080) { // 7-day freshness
          const pss = checkin.pss4.score;
          if (typeof pss === "number") {
            const pssFactor = Math.min(1.0, Math.max(0.96, 1.0 - Math.max(0, pss - 4) * 0.005));
            e0 *= pssFactor;
          }
        }
      }
    } catch { /* checkin parse failures — skip the fallback */ }
  }

  // Hydration is self-reported and imprecise — qualitative 3-state avoids fake
  // precision. Default "average" = neutral, ±3% max swing.
  const hydrationLevel = lifestyle?.hydrationLevel
    ?? (typeof lifestyle?.hydration === "number"
        ? (lifestyle.hydration < 4 ? "low" : lifestyle.hydration > 8 ? "good" : "average")
        : null);
  if (hydrationLevel) {
    e0 *= ({ low: 0.97, average: 1.0, good: 1.03 }[hydrationLevel] || 1.0);
  }
  if (lifestyle?.exercise && lifestyle.exercise !== "none") {
    e0 *= (1 + ({ light: 0.04, moderate: 0.08, intense: 0.06 }[lifestyle.exercise] || 0));
  }
  return Math.max(0.3, Math.min(1.3, e0));
}

// Deepgram voice hook (useVoice, getSharedMic, DEEPGRAM_*) imported from ./integrations/deepgram.js.


/* ═══════════════════════════════════════════
   CLAUDE SONNET 4.6 — LONGITUDINAL ANALYSIS
   ═══════════════════════════════════════════ */

// Anthropic calls go through /proxy/anthropic — server attaches the key.
// ANTHROPIC_MODEL, ANALYSIS_TOOL, and ANALYSIS_SYSTEM_PROMPT imported from ./knowledge-base.js.

// Translate engine values to qualitative labels so the LLM has signal
// without seeing math it might quote back into the letter. The numeric
// values still feed engine math elsewhere — this is purely the LLM's
// view of history.
function qualS(s)   { return s >= 4 ? "deep" : s >= 3 ? "solid" : s >= 2 ? "scattered" : "fragmented"; }
function qualC(c)   { return c >= 4 ? "many threads" : c >= 3 ? "several threads" : c >= 2 ? "two threads" : "one thread"; }
function qualMu(m)  { return m >= 0.40 ? "high" : m >= 0.25 ? "moderate" : "low"; }
function qualPsi(p) { return p >= 1.05 ? "positive" : p >= 0.85 ? "neutral" : p >= 0.65 ? "mild-negative" : "strong-negative"; }
function qualDec(n) { return n >= 7 ? "many" : n >= 3 ? "some" : n >= 1 ? "few" : "none"; }

export function buildHistoryContext(history) {
  if (!history || history.length === 0) return "No prior entries.";
  const recent = history.slice(0, 30).reverse();
  return recent.map(e => {
    const d = new Date(e.date);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const p = e.params || {};
    const drivers = e.drivers
      ? Object.entries(e.drivers)
          .filter(([, v]) => typeof v === "number" && v > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([k]) => k)
          .join(", ")
      : "";
    const focus = typeof p.S === "number" ? qualS(p.S) : "—";
    const threads = typeof p.C === "number" ? qualC(p.C) : "—";
    const misalloc = typeof p.mu === "number" ? qualMu(p.mu) : "—";
    const tone = typeof p.psi === "number" ? qualPsi(p.psi) : "—";
    const dec = qualDec(e.decisionCount || 0);
    const dominant = drivers ? `; dominant drivers: ${drivers}` : "";
    // INTERNAL marker reminds the LLM these descriptors are engine-derived
    // context — read for pattern, don't quote verbatim into the letter.
    return `[INTERNAL CONTEXT — ${dateStr} ${e.period || ""}] focus: ${focus}; threads: ${threads}; misallocation: ${misalloc}; tone: ${tone}; decisions: ${dec}${dominant}\n  User's own words: "${e.dayDesc || ""}"`;
  }).join("\n\n");
}

// Compute a short, deterministic "precomputed patterns" block from the
// FULL history (not just the 30-entry slice). The eval-longitudinal v2
// found that long-arc patterns invisible to the 30-cap model (chronotype:
// 0/38, sleep-debt cycle: 0/38) are exactly the patterns we can detect
// client-side with cheap stats. By pre-computing them and injecting one
// labelled block into the prompt, the model gets the signal without
// having to re-infer from raw history blocks. Costs ~60 input tokens.
export function computePrecomputedPatterns(history) {
  if (!Array.isArray(history) || history.length === 0) return null;

  // Period distribution + μ split (chronotype detector).
  // Each history entry has period: "morning" | "evening" and params.mu.
  let mornN = 0, evenN = 0, mornMu = 0, evenMu = 0;
  for (const e of history) {
    const mu = e?.params?.mu;
    if (typeof mu !== "number" || isNaN(mu)) continue;
    if (e.period === "morning") { mornN++; mornMu += mu; }
    else if (e.period === "evening") { evenN++; evenMu += mu; }
  }
  // Translated to plain language so the LLM has nothing math-y to quote
  // back into the letter. Direction-only, no raw values.
  let periodLine = null;
  if (mornN >= 3 && evenN >= 3) {
    const am = mornMu / mornN, pm = evenMu / evenN;
    const diff = am - pm;
    if (Math.abs(diff) >= 0.05) {
      periodLine = diff > 0
        ? `chronotype tilt: across your recent entries, mornings have been pulling sideways more than evenings — the planner shows up louder in AM writing`
        : `chronotype tilt: across your recent entries, evenings have been pulling sideways more than mornings — the day's drift accumulates by night`;
    } else {
      periodLine = `chronotype tilt: mornings and evenings have read about the same recently`;
    }
  }

  // Weekday tilt — mean params.psi per day-of-week. Higher psi = more loaded.
  const dowSums = Array(7).fill(0), dowCounts = Array(7).fill(0);
  for (const e of history) {
    const psi = e?.params?.psi;
    if (typeof psi !== "number" || isNaN(psi)) continue;
    const d = new Date(e.date + "T12:00:00");
    if (isNaN(d.getTime())) continue;
    const dow = d.getDay();
    dowSums[dow] += psi;
    dowCounts[dow]++;
  }
  const dowAvgs = dowSums.map((s, i) => dowCounts[i] >= 3 ? s / dowCounts[i] : null);
  const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let weekdayLine = null;
  if (dowAvgs.some(v => v != null)) {
    const validAvgs = dowAvgs.map((v, i) => ({ v, i })).filter(x => x.v != null);
    if (validAvgs.length >= 4) {
      const peak = validAvgs.reduce((a, b) => b.v > a.v ? b : a);
      const trough = validAvgs.reduce((a, b) => b.v < a.v ? b : a);
      const spread = peak.v - trough.v;
      if (spread > 0.08) {
        weekdayLine = `weekday tilt: ${dowNames[peak.i]}s have been your heaviest day of the week recently; ${dowNames[trough.i]}s the lightest`;
      }
    }
  }

  // Driver z-scores: today vs full-history mean (per driver).
  let driverLine = null;
  const todayE = history[history.length - 1];
  if (todayE?.drivers) {
    const sums = {}, counts = {}, sqSums = {};
    for (const e of history) {
      const d = e?.drivers || {};
      for (const [k, v] of Object.entries(d)) {
        if (typeof v !== "number") continue;
        sums[k] = (sums[k] || 0) + v;
        sqSums[k] = (sqSums[k] || 0) + v * v;
        counts[k] = (counts[k] || 0) + 1;
      }
    }
    const shifts = [];
    for (const [k, v] of Object.entries(todayE.drivers)) {
      if (typeof v !== "number" || (counts[k] || 0) < 14) continue;
      const mean = sums[k] / counts[k];
      const variance = sqSums[k] / counts[k] - mean * mean;
      const sd = Math.sqrt(Math.max(0.001, variance));
      const zScore = (v - mean) / sd;
      // Translate z-score magnitude to plain-language direction labels.
      if (Math.abs(zScore) >= 1.0) {
        const intensity = Math.abs(zScore) >= 1.8 ? "well" : "noticeably";
        const direction = zScore > 0 ? `${intensity} louder than usual` : `${intensity} quieter than usual`;
        shifts.push(`${k} is ${direction}`);
      }
    }
    if (shifts.length) driverLine = `drivers shifted today: ${shifts.join("; ")}`;
  }

  // Sleep-debt cycle detection (7-week window).
  // The synthetic eval planted a 7-week cycle. In real data, look for any
  // recurring fatigue pattern: a week-by-week mean of psi where a regular
  // peak emerges at multi-week intervals. Cheap heuristic: bucket entries
  // by week-index, mean psi per bucket, report if the rolling 7-week
  // autocorrelation is >0.3 OR if every Nth week (3 ≤ N ≤ 8) shows ≥0.15
  // higher psi than the others.
  let cycleLine = null;
  if (history.length >= 56) { // need ≥8 weeks to talk about 7-week cycles
    const weekBuckets = [];
    for (const e of history) {
      const psi = e?.params?.psi;
      if (typeof psi !== "number") continue;
      const d = new Date(e.date + "T12:00:00");
      if (isNaN(d.getTime())) continue;
      const weekIdx = Math.floor((Date.now() - d.getTime()) / (7 * 86400000));
      weekBuckets[weekIdx] = weekBuckets[weekIdx] || [];
      weekBuckets[weekIdx].push(psi);
    }
    const wAvgs = weekBuckets.map(wb => wb && wb.length >= 3 ? wb.reduce((a, b) => a + b, 0) / wb.length : null);
    const validWeeks = wAvgs.filter(v => v != null);
    if (validWeeks.length >= 8) {
      const overallMean = validWeeks.reduce((a, b) => a + b, 0) / validWeeks.length;
      // Check for any N (3..8) where every Nth week is ≥ overallMean + 0.10.
      for (let N = 3; N <= 8; N++) {
        const onCycle = wAvgs.filter((_, i) => i % N === 0 && wAvgs[i] != null).map(v => v);
        if (onCycle.length < 2) continue;
        const onMean = onCycle.reduce((a, b) => a + b, 0) / onCycle.length;
        if (onMean > overallMean + 0.10) {
          cycleLine = `sleep-load cycle: roughly every ~${N}th week shows a noticeably heavier stretch than your baseline`;
          break;
        }
      }
    }
  }

  // Trajectory: last 14 days mean psi vs prior 14 days.
  let trajectoryLine = null;
  if (history.length >= 28) {
    const last14 = history.slice(-14).map(e => e?.params?.psi).filter(v => typeof v === "number");
    const prior14 = history.slice(-28, -14).map(e => e?.params?.psi).filter(v => typeof v === "number");
    if (last14.length >= 7 && prior14.length >= 7) {
      const lm = last14.reduce((a, b) => a + b, 0) / last14.length;
      const pm = prior14.reduce((a, b) => a + b, 0) / prior14.length;
      const delta = lm - pm;
      if (Math.abs(delta) >= 0.06) {
        trajectoryLine = delta < 0
          ? `trajectory: the last two weeks have been easing — lighter than the two weeks before them`
          : `trajectory: the last two weeks have been building — heavier than the two weeks before them`;
      }
    }
  }

  const lines = [periodLine, weekdayLine, driverLine, cycleLine, trajectoryLine].filter(Boolean);
  if (lines.length === 0) return null;
  return lines.map(l => `- ${l}`).join("\n");
}

export async function analyzeWithClaude(dayText, lingeringText, history, biometricTrends, biometrics, lifestyle, options = {}) {
  // mode === "reflect" forces the WORDS-ONLY prompt branch and strips
  // wrist-derived fields from the body context — even when biometrics
  // exist locally. That's the contract the Reflect transparency banner
  // promises the user.
  const { mode = "full" } = options;

  // Language seam. Reflect-mode বাংলা users get a Bengali letter; everyone else
  // English. The reflect-language pref IS the seam for now (a reflect user is
  // single-language); a per-entry tag can replace it later. Only the prose the
  // user reads becomes Bengali — scores, drivers, and part ids stay the same
  // internal tokens.
  const lang = options.lang
    || ((typeof localStorage !== "undefined" && localStorage.getItem("ori_reflect_lang") === "bn") ? "bn" : "en");
  // The letter runs on Sonnet 4.6 for BOTH languages. Opus is ~13s faster on this
  // large structured call, but it costs ~1.67x as much per letter ($5/$25 vs
  // $3/$15 per MTok) — and with no client-side timeout on the call (see above) the
  // extra latency never fails the letter, the prose still streams either way. So
  // Sonnet is the deliberate cost choice. Matches ANTHROPIC_MODEL, the default for
  // the lighter seed/transcription calls elsewhere.
  const model = "claude-sonnet-4-6";
  const langDirective = lang === "bn"
    ? "\n\n---\nLANGUAGE — IMPORTANT: The user writes in Bengali, often mixed with English (Banglish). Do ALL internal analysis and scoring exactly as the system prompt instructs. Write everything the user reads — letter.headline, every letter.paragraphs entry, and each part's note — in natural, warm Kolkata (West Bengal) Bengali in Bangla script.\n\nCarry EVERY voice rule from the system prompt into the Bengali — not just the language, the gentleness too:\n- Register: address the reader as তুমি — the warm, close-friend register. Never আপনি (too formal and distant for this letter); never তুই (too familiar). Keep তুমি consistent throughout.\n- IFS-soft: every part is well-meaning, even the loud ones. No part is bad, a fault, or a flaw.\n- Observation, never advice. No উচিত / উচিত ছিল, no পরের বার, no করে দেখো, no fixing — this is a friend gently noticing, not a coach. Banned closings: never end with পরের বার…, চেষ্টা কোরো…, তুমি পারবে…, কাল…. End with the day itself — a small image or a quiet noticing — never a plan, a lesson, or a takeaway.\n- Open with a concrete moment from today before naming any part — a time, a phrase, what the body was doing — in the user's own words. Quote their actual words and times.\n- On a heavy day (overwhelm, grief, exhaustion, thin sleep), use the permission register a kind friend would, e.g. এটা কোনো ব্যর্থতা নয় · একটু থেমে গেলেও চলবে · এখানে একটু বিশ্রাম নেওয়া যায় — permission, never instruction.\n- Time: name a clock time ONLY if the user themselves stated it in today's words (or it is a real wearable fact). NEVER invent a time, and NEVER turn the current timestamp at the top of this message into an event in their day. Write times the way a Bengali speaker says them — সকাল / দুপুর / বিকেল / সন্ধে / রাত with the hour — matching exactly what the user actually said.\n- A part is loud / present / brief / quiet — never absent or non-existent.\n- No clinical or diagnostic words; never an engine number or symbol — only facts the user themselves wrote or that came from their wearable.\n\nWhen you name a part in the Bengali prose, use these EXACT Bengali names — keep the part `id` as its English token; translate only the visible prose, never the id, volume, or numeric fields:\n- planner → গোছানো মন (যে দিনটাকে গুছিয়ে রাখে)\n- watcher → খেয়াল-রাখা মন (চারপাশের মানুষ, সুর, কথা যে খেয়াল করে)\n- tender → শরীরের ডাক (ঘুম, খাওয়া, বিশ্রামের কোমল ডাক)\n- seeker → চঞ্চল মন (ছোট ছোট ভালোলাগার পিছনে ছোটে)\n- hesitant → দ্বিধার মন (ঝামেলা এড়িয়ে একটু পিছিয়ে থাকে)\n- gentle → স্নিগ্ধ মন (ধীর, কোমল মনোযোগ; দিনের শেষে আসে)\n- witness → সাক্ষী মন (শুধু লক্ষ্য করে, কিছু বদলাতে চায় না)\n- maker → গড়ার মন (নতুন কিছু বানাতে চায়)\nDo not put English sentences into the letter unless the user used those exact English words."
    : "";

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const historyBlock = buildHistoryContext(history);
  const bodyBlock = formatBodyContext(biometricTrends, biometrics, lifestyle, { mode });
  const patternBlock = computePrecomputedPatterns(history);

  // Force WORDS-ONLY whenever the user is in Reflect (even if biometrics
  // are present locally — Reflect is a contract, not a fallback) OR when
  // no body data exists at all.
  const hasAnyBody = !!biometrics || !!biometricTrends;
  const wordsOnly = mode === "reflect" || !hasAnyBody;
  const dataAvailability = wordsOnly
    ? "DATA AVAILABILITY: WORDS-ONLY mode — no body data this analysis. Skip the BIOMETRIC INTEGRATION section in your system prompt entirely. Ground your reading in the user's writing, lingual signature, decisions named, and any KSS/PSS-4 self-reports. Do NOT invent or assume body signals (HRV, sleep, RHR). Do NOT mention 'no body data' to the user — just write the reading from what you have."
    : "DATA AVAILABILITY: biometric + journal data available. Use both.";

  // PRECOMPUTED PATTERNS block: client-side stats over the user's FULL
  // history (chronotype, weekday tilt, driver z-scores, multi-week cycles,
  // 28d trajectory). The 30-entry history slice can't show these — they
  // need the whole record. By passing them as pre-computed facts the
  // model can ground long-arc claims without re-deriving from raw entry
  // text. eval-longitudinal v2 showed 0/38 chronotype detection without
  // this; expect a meaningful jump once it's in the prompt.
  const patternsSection = patternBlock
    ? `\n\n---\nPRECOMPUTED PATTERNS (from your FULL history, not just the 30 entries below — use these to ground any long-arc / pattern / trajectory claims; do NOT re-derive these from raw history):\n${patternBlock}`
    : "";

  const userMessage = `${dataAvailability}\n\n---\nBIOMETRIC CONTEXT:\n${bodyBlock}${patternsSection}\n\n---\nPRIOR JOURNAL HISTORY (oldest to newest, up to 30 entries):\n${historyBlock}\n\n---\nTODAY — ${today}\nDay: ${dayText}\nLingering: ${lingeringText || "(nothing noted)"}\n\n---\nAnalyze today, grounding the reading in whatever data is genuinely available, and using history for pattern/trajectory/reframing insights. When a precomputed pattern above is relevant, name it in the letter (e.g. chronotype, weekday tilt, recurring cycle) — these are facts you have, not inferences. Call the record_cognitive_analysis tool.${langDirective}`;

  async function callOnce() {
    const data = await fetchAnthropicWithRetry({
      model: model,
      max_tokens: 2000,
      system: [{ type: "text", text: ANALYSIS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: "tool", name: "record_cognitive_analysis" },
      messages: [{ role: "user", content: userMessage }],
    });
    const toolUse = (data.content || []).find(c => c.type === "tool_use" && c.name === "record_cognitive_analysis");
    if (!toolUse) throw new Error("No tool response from Claude");
    return toolUse.input;
  }

  // First attempt
  let a = await callOnce();
  let letter = validateLetter(a.letter);

  // validateLetter now fix-forwards the common ~2% "letter-as-JSON-string"
  // failure (parses it in place), so this full re-call is a rare last resort for
  // genuinely malformed output, not the routine recovery it used to be.
  if (!letter) {
    try {
      const aRetry = await callOnce();
      const letterRetry = validateLetter(aRetry.letter);
      if (letterRetry) {
        a = aRetry;
        letter = letterRetry;
      }
    } catch {
      /* retry failed; keep original a, letter stays null, UI falls back to template */
    }
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  return {
    S: clamp(a.S, 0.5, 5.0),
    C: clamp(a.C, 1, 5),
    L: clamp(a.L, 0.1, 1.0),
    W: clamp(a.W, 0.2, 1.0),
    psi: clamp(a.psi, 0.3, 1.2),
    mu: clamp(a.mu, 0.12, 0.65),
    ydSide: a.ydSide || "balanced",
    ydDeviation: clamp(a.ydDeviation, 0, 2),
    driverScores: a.driverScores || { survival: 0, social: 0, discomfort: 0, reward: 0, identity: 0 },
    decisionCount: Math.max(0, Math.round(a.decisionCount || 0)),
    decisionFatigue: clamp(a.decisionFatigue, 0, 0.3),
    avoidHits: Math.max(0, Math.round(a.avoidHits || 0)),
    lingeringDriver: a.lingeringDriver || null,
    lingeringMechanism: a.lingeringMechanism || "",
    insights: Array.isArray(a.insights) ? a.insights.filter(i => i?.title && i?.body).slice(0, 3) : [],
    letter,
  };
}

// ── Streaming letter prose (Call A) ──────────────────────────────────────────
// Phase-2 speed work: the user only waits to READ the letter, so generate the
// prose (headline + paragraphs) in a dedicated, STREAMED, plain-text call and
// render it token-by-token (first text in ~1.5–2s) instead of blocking on the
// full structured analysis. The heavy record_cognitive_analysis call (scores,
// insights, parts) runs in parallel as Call B (analyzeWithClaude) and feeds the
// engine + parts garden when it lands. English only — Bengali keeps the single
// structured path (its directive is bound to the tool fields). On ANY failure the
// caller falls back to Call B's letter, so this can never regress the letter.
//
// onChunk(accumulatedText) fires as prose streams. Returns { headline,
// paragraphs, raw } or throws (caller falls back to Call B).
export async function streamLetterProse(dayText, lingeringText, history, biometricTrends, biometrics, lifestyle, options = {}, onChunk) {
  const { mode = "full" } = options;
  const lang = options.lang
    || ((typeof localStorage !== "undefined" && localStorage.getItem("ori_reflect_lang") === "bn") ? "bn" : "en");
  if (lang === "bn") throw new Error("streamLetterProse: English only");

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const historyBlock = buildHistoryContext(history);
  const bodyBlock = formatBodyContext(biometricTrends, biometrics, lifestyle, { mode });
  const patternBlock = computePrecomputedPatterns(history);
  const hasAnyBody = !!biometrics || !!biometricTrends;
  const wordsOnly = mode === "reflect" || !hasAnyBody;
  const dataAvailability = wordsOnly
    ? "DATA AVAILABILITY: WORDS-ONLY mode — no body data this analysis. Ground your reading in the user's writing, lingual signature, decisions named, and any KSS/PSS-4 self-reports. Do NOT invent body signals (HRV, sleep, RHR). Do NOT mention 'no body data' — just write from what you have."
    : "DATA AVAILABILITY: biometric + journal data available. Use both.";
  const patternsSection = patternBlock
    ? `\n\n---\nPRECOMPUTED PATTERNS (from your FULL history — ground long-arc claims on these, do NOT re-derive):\n${patternBlock}`
    : "";

  // Same context as the structured call, but the directive asks for PLAIN-TEXT
  // letter prose only. The system prompt's letter voice rules (IFS-soft,
  // observation-only, parts vocabulary, dosage) still apply.
  const userMessage = `${dataAvailability}\n\n---\nBIOMETRIC CONTEXT:\n${bodyBlock}${patternsSection}\n\n---\nPRIOR JOURNAL HISTORY (oldest to newest, up to 30 entries):\n${historyBlock}\n\n---\nTODAY — ${today}\nDay: ${dayText}\nLingering: ${lingeringText || "(nothing noted)"}\n\n---\nWrite ONLY the letter the user reads, grounded in the day and history, following ALL the letter/voice rules in your system prompt (IFS-soft, observation only, name parts directly in the prose, dosage). Output PLAIN TEXT in this exact shape and NOTHING else:\nLine 1: the headline — one fresh sentence; vary the structure; do not default to a 'Today the <part>…' template.\nThen a blank line, then 1–3 short paragraphs separated by blank lines.\nNo JSON, no tool call, no scores, no labels, no engine variables or numbers.`;

  const body = {
    // Sonnet 4.6 (not Opus) — the streamed read path. See analyzeWithClaude's
    // model note above: Sonnet is the deliberate cost choice, and prose streams
    // token-by-token regardless of model, so the read feels the same.
    model: "claude-sonnet-4-6",
    max_tokens: 700,
    stream: true,
    system: [{ type: "text", text: ANALYSIS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMessage }],
  };

  const res = await fetch("/proxy/anthropic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`stream ${res.status}: ${t.slice(0, 160)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let evt;
      try { evt = JSON.parse(payload); } catch { continue; }
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
        text += evt.delta.text;
        if (typeof onChunk === "function") { try { onChunk(text); } catch { /* ignore */ } }
      }
    }
  }
  return parseProse(text);
}

// Parse streamed plain-text prose into { headline, paragraphs, raw }. First
// non-empty block is the headline; remaining blank-line-separated blocks are
// paragraphs. Scrubs engine leakage per piece, like validateLetter.
function parseProse(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("empty prose");
  let blocks = raw.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  if (blocks.length < 2) blocks = raw.split(/\n/).map(l => l.trim()).filter(Boolean);
  const headline = scrubEngineLeakage(blocks.shift() || "");
  const paragraphs = blocks.map(b => scrubEngineLeakage(b)).filter(Boolean);
  if (!headline) throw new Error("no headline");
  return { headline, paragraphs, raw };
}

// Defensive validation for the `letter` field. Returns a clean object or null.
// Never throws. Trims, type-checks, caps note length, normalizes volume enum.
// Defense-in-depth scrub for engine-variable leakage in the Letter.
//
// The system prompt forbids the LLM from citing μ=0.28, mu=0.18, S=2.4,
// decisionCount=7, etc. inside the letter — that reads as a math
// textbook, not a friend's noticing. The prompt mostly works, but the
// model occasionally slips a parenthetical past. This scrub catches it.
//
// Strategy:
//   1. Strip parenthetical groups that contain forbidden symbols.
//   2. Strip bare "var=N.NN" occurrences.
//   3. Collapse the double-spaces and orphan punctuation the removals
//      leave behind so prose still reads naturally.
//
// Logs a warning to console when leakage is detected so we know which
// patterns the model is sneaking through — informs future prompt work.
const FORBIDDEN_VAR = /\b(?:μ|mu|psi|ψ|S|C|L|W|HCPI|decisionCount|allostaticLoad|recentStrain|lambda|chronoMod|ultradian|ydDeviation|driverScores)\b/;
const FORBIDDEN_VAR_EQ = /\b(?:μ|mu|psi|ψ|HCPI|decisionCount|allostaticLoad|recentStrain|lambda|chronoMod|ydDeviation)\s*[=:]\s*[\d.]+/gi;
function scrubEngineLeakage(text) {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  // Strip parens that contain any engine variable reference.
  out = out.replace(/\s*\([^()]*\)/g, (paren) => {
    return FORBIDDEN_VAR.test(paren) ? "" : paren;
  });
  // Strip bare "var=N.NN" occurrences not caught by the paren pass.
  out = out.replace(FORBIDDEN_VAR_EQ, "");
  // Clean up double spaces, orphan punctuation, leading commas.
  out = out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])\s*\1+/g, "$1")
    .replace(/\.\s*\./g, ".")
    .replace(/^\s*[,;:]\s*/gm, "")
    .trim();
  if (out !== text) {
    try { console.warn("[letter] scrubbed engine leakage:", { before: text, after: out }); } catch { /* ignore */ }
  }
  return out;
}

function validateLetter(L) {
  // Fix-forward the observed ~2% failure where the letter arrives as a
  // JSON-encoded STRING instead of an object — parse it in place rather than
  // paying a full second model call (the retry path below). Saves ~one whole
  // letter's latency on the days this fires.
  if (typeof L === "string") {
    try { L = JSON.parse(L); } catch { return null; }
  }
  if (!L || typeof L !== "object") return null;
  const headline = scrubEngineLeakage(typeof L.headline === "string" ? L.headline.trim() : "");
  const paragraphs = Array.isArray(L.paragraphs)
    ? L.paragraphs.map(p => scrubEngineLeakage(String(p ?? "").trim())).filter(Boolean)
    : [];
  const allowedIds = new Set(["planner", "watcher", "tender", "seeker", "hesitant", "gentle", "witness", "maker"]);
  const allowedVolumes = new Set(["loud", "present", "brief"]);
  const parts = Array.isArray(L.parts)
    ? L.parts
        .filter(p => p && typeof p.id === "string" && allowedIds.has(p.id))
        .map(p => ({
          id: p.id,
          volume: typeof p.volume === "string" && allowedVolumes.has(p.volume) ? p.volume : "present",
          note: typeof p.note === "string" ? p.note.trim().slice(0, 140) : "",
        }))
        .filter(p => p.note.length > 0)
    : [];
  // Tier is gated by Claude (≥7 days) but we re-check the enum here so a
  // typo in the model output never leaks through.
  const allowedTiers = new Set(["Steady", "Stretched", "Heavy hour", "Low tide"]);
  const tier = typeof L.tier === "string" && allowedTiers.has(L.tier) ? L.tier : null;
  if (!headline && paragraphs.length === 0 && parts.length === 0) return null;
  return { headline, paragraphs, parts, tier };
}

/* ═══════════════════════════════════════════
   RELIABILITY PROBE — internal test-retest stability monitor
   ───────────────────────────────────────────
   Why it exists: the parts taxonomy makes empirical claims (e.g.,
   "the planner has been resting"). LLM sampling is stochastic —
   running the same input twice can produce different parts lists.
   Without measurement, we don't know if Keeper claims reflect the
   user's internal state or just reflect Claude's output variance.

   What it does: after a real Read Today succeeds, the probe re-runs
   analyzeWithClaude with the same composed seeds at most once per
   24 hours. Compares the probe's letter.parts to the user-visible
   run via Jaccard set agreement and per-part volume agreement.
   Logs to localStorage; surfaces in Settings → Help → Stability.

   Cost guardrail: 24h debounce. One extra Anthropic call per day max.
   ═══════════════════════════════════════════ */

export const RELIABILITY_LOG_KEY = "cpi_reliability_log";
export const LAST_PROBE_KEY = "cpi_last_probe_at";

function _jaccardOnIds(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const x of setA) if (setB.has(x)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function _volumeAgreement(primary, probe) {
  const probeMap = new Map();
  for (const p of probe || []) probeMap.set(p?.id, p?.volume);
  let matched = 0;
  let compared = 0;
  for (const p of primary || []) {
    if (!p?.id) continue;
    if (probeMap.has(p.id)) {
      compared++;
      if (probeMap.get(p.id) === p.volume) matched++;
    }
  }
  return compared > 0 ? matched / compared : null;
}

export function shouldRunReliabilityProbe() {
  try {
    const last = Number(localStorage.getItem(LAST_PROBE_KEY) || 0);
    return Date.now() - last > 24 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

export async function runReliabilityProbe({ composedText, lingering, history, biometricTrends, biometrics, lifestyle, primaryLetterParts, mode, seedCount }) {
  if (!composedText || !composedText.trim()) return null;
  try {
    const probe = await analyzeWithClaude(composedText, lingering || "", history, biometricTrends, biometrics, lifestyle, { mode });
    const probeParts = Array.isArray(probe?.letter?.parts)
      ? probe.letter.parts.map(p => ({ id: p?.id, volume: p?.volume })).filter(p => p.id)
      : [];
    const primaryIds = (primaryLetterParts || []).map(p => p?.id).filter(Boolean);
    const probeIds = probeParts.map(p => p.id);
    const j = _jaccardOnIds(primaryIds, probeIds);
    const v = _volumeAgreement(primaryLetterParts || [], probeParts);

    const round3 = (n) => Math.round(n * 1000) / 1000;
    const log = (() => {
      try { return JSON.parse(localStorage.getItem(RELIABILITY_LOG_KEY) || "[]"); } catch { return []; }
    })();
    log.unshift({
      ts: new Date().toISOString(),
      jaccard: round3(j),
      volumeAgreement: v == null ? null : round3(v),
      primaryIds, probeIds,
      seedCount: seedCount || 0,
      mode: mode || "full",
    });
    const trimmed = log.slice(0, 50);
    try {
      localStorage.setItem(RELIABILITY_LOG_KEY, JSON.stringify(trimmed));
      localStorage.setItem(LAST_PROBE_KEY, String(Date.now()));
    } catch { /* ignore */ }
    return { jaccard: j, volumeAgreement: v, primaryIds, probeIds };
  } catch {
    return null;
  }
}

export function loadReliabilityStats() {
  try {
    const log = JSON.parse(localStorage.getItem(RELIABILITY_LOG_KEY) || "[]");
    if (!Array.isArray(log) || !log.length) return null;
    const valid = log.filter(e => typeof e?.jaccard === "number");
    if (!valid.length) return null;
    const meanJ = valid.reduce((s, e) => s + e.jaccard, 0) / valid.length;
    const volsValid = valid.filter(e => typeof e?.volumeAgreement === "number");
    const meanV = volsValid.length ? volsValid.reduce((s, e) => s + e.volumeAgreement, 0) / volsValid.length : null;
    return {
      probeCount: valid.length,
      meanJaccard: Math.round(meanJ * 1000) / 1000,
      meanVolumeAgreement: meanV == null ? null : Math.round(meanV * 1000) / 1000,
      latest: valid[0],
    };
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════
   HCPI COMPUTATION — UCD Model v0.4
   ═══════════════════════════════════════════ */

export function computeHCPI(wakeHour, a, historyForAllostatic, biometrics, lifestyle, chronotype) {
  const now = new Date().getHours() + new Date().getMinutes() / 60;
  const Ha = Math.max(0, now - wakeHour + (now < wakeHour ? 24 : 0));

  const lambda = a.L > 0.7 ? 0.15 : 0.08;
  const Et = Math.exp(-lambda * Ha);
  const inertia = Ha < 0.5 ? (1 - Math.exp(-8 * Ha)) : 1.0;
  const E0 = computeE0(biometrics, lifestyle);
  const E = E0 * inertia * Et;

  // M is now purely text-derived. The time-of-day signal that used to
  // live here as a standalone circadian sine has been folded into the
  // single phase-anchored alignment term below — see getPhaseAlignment.
  const M = a.psi * (1 - a.mu);

  const WL = a.W * a.L;
  const theta = 0.5;
  const beta = WL >= theta ? 7.5 : 3.0;
  const YD = Math.exp(-beta * Math.pow(WL - theta, 2)) * Math.exp(-a.ydDeviation);
  // Linear concurrency penalty (Pashler 1994 Psychol Bull; Salvucci & Taatgen
  // 2008 Psychol Rev). Previous code raised C to the 2.0 power as a
  // supra-linear penalty, but the dual-task literature is consistently
  // bottleneck/additive — costs scale roughly *linearly* in number of
  // competing threads up to resource saturation, not quadratically. The
  // squared exponent was an aesthetic choice with no published source.
  // Switched to linear per the HCPI validation audit (Cluster C).
  const Ceff = Math.max(1, a.C);
  const Rc = a.C > 1.5 ? 0.12 * Math.exp(-0.03 * 23) * (a.C - 1) : 0;
  const CeffTotal = Ceff + Rc;
  const R = YD / CeffTotal;

  // Internally named `recentStrain` — a 7-day rolling text-derived stress
  // index. NOT McEwen's allostatic-load construct (which is a 10-biomarker
  // composite: cortisol, DHEA-S, BP, lipids, HbA1c…). Renamed from
  // `allostaticLoad` per the HCPI validation audit (Cluster D, vocabulary
  // appropriation finding). The stored journal-entry key is also
  // `recentStrain` going forward; legacy entries with the old key are
  // read with backward compatibility in CognitiveProfile.jsx.
  let recentStrain = 1.0;
  if (historyForAllostatic?.length > 0) {
    // Recent strain = stress across recent DAYS, not sessions. Aggregate first.
    const recentDays = groupCheckinsByDay(historyForAllostatic).slice(0, 7);
    if (recentDays.length > 0) {
      const stressHits = recentDays.filter(d => (d.avgParams?.psi ?? 1) < 0.7).length;
      const avgStress = recentDays.reduce((s, d) => s + Math.max(0, 1 - (d.avgParams?.psi ?? 1)), 0) / recentDays.length;
      recentStrain = 1 + (stressHits * 0.08) + (avgStress * 0.15);
    }
  }

  const decayWall = Math.exp(0.15 * Math.max(0, Ha - 16));
  const systemCritical = Ha > 16;

  // Single phase-anchored arousal term (Schmidt 2007, Roenneberg 2007).
  // Replaces the old clock-time chronoMod × standalone circadian sine
  // stack — one term, anchored to hours-since-wake. ±15% swing total.
  const ctAlign = getPhaseAlignment(chronotype, Ha);
  const chronoMod = ctAlign.score;

  // Ultradian phase — kept for the UI label ("Ramping up / Peak focus /
  // Fading / Recovery dip"), but NO LONGER a multiplier in HCPI math.
  // Removed per the HCPI validation audit (Cluster B): Lavie 1995 (PMID
  // 7669837), titled "Ultradian rhythms in cognitive performance: no
  // evidence for a 90-min cycle," along with Wackermann 2002 and the
  // broader chronobiology literature, show that the 1960s BRAC
  // hypothesis has not replicated in waking hours. The deterministic
  // 90-min cosine that previously swung HCPI ±15% from clock time
  // alone (and triple-counted circadian phase against chronoMod and
  // the circadian sine) is gone from the score.
  const ultradian = getUltradianPhase(Ha);

  // HCPI = S · E · M · R · chrono / (recentStrain · decayWall)
  const P = (a.S * E * M * R * chronoMod) / (recentStrain * decayWall);
  const HCPI = Math.min(1, Math.max(0, P));

  // `circadian` is kept as an alias of `chronoMod` for back-compat with
  // UI surfaces that previously displayed the separate sine value —
  // they now show the same number as the chronoMod row, which is the
  // intended behavior post-collapse.
  return { HCPI, Et: E, Ha, YD, recentStrain, systemCritical, E0, Rc, CeffTotal, lambda, decayWall, circadian: chronoMod, M, R, chronoMod, ctAlign, ultradian };
}
