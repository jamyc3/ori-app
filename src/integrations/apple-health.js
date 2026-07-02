// Apple Health bridge.
//
// On iOS, this module is the live-sync replacement for the ZIP export
// path. The ZIP import (engine.parseAppleHealthZip) stays available as a
// one-time historical backfill and as the only path on non-iOS — the
// native plugin only works in a Capacitor iOS shell.
//
// Public surface:
//   - isAvailable()                       true on iOS, false elsewhere
//   - requestPermission()                 HealthKit grant flow
//   - appleHealthAggregateRange(window)   pulls daily aggregates for the
//                                         given date range and returns the
//                                         same shape parseAppleHealthZip
//                                         emits ({ entries, totalRecords,
//                                         keptRecords, dateRange })
//
// All field names, units, and the score-derivation pass mirror the ZIP
// path so mergeAppleHealthIntoHistory and biometricsFromDayEntry need
// zero changes to consume native data.

import { Capacitor, registerPlugin } from "@capacitor/core";
import { Health } from "@flomentumsolutions/capacitor-health-extended";
import { computeDerivedAppleScores } from "../engine.js";

// SleepBridge is a tiny custom Capacitor plugin (Swift source at
// ios/App/App/SleepBridge.swift) that exposes raw HKCategorySample data
// for sleep analysis. The main capacitor-health-extended plugin we use
// for everything else collapses every stage record into a single
// duration sum before crossing the bridge, which both inflates totals
// (multiple sources writing overlapping records for the same night
// triple-count) and erases the per-stage breakdown the score formulas
// need. SleepBridge returns the underlying samples untouched so we can
// run the same union-merge dedup the ZIP parser proves correct.
const SleepBridge = registerPlugin("SleepBridge");

// QuantityBridge — second custom plugin (Swift source at
// ios/App/App/QuantityBridge.swift). The main capacitor-health-extended
// plugin does not expose VO2 max, walking heart-rate average, or
// heart-rate recovery, but the engine has fields wired for all three
// already and the validation research ranks them as the highest-signal
// additions we can make without new permissions (READ_HEART_RATE
// covers them). One method, one switch — give it a `kind` and a date
// window and it returns the raw HKQuantitySample data.
const QuantityBridge = registerPlugin("QuantityBridge");

// We request the broad set on first connect rather than a mode-narrowed
// subset. Reason: iOS HealthKit grants are one-shot — once a permission
// is declined, the app cannot re-prompt; the user must visit iOS
// Settings → Privacy → Health → Ori manually. If a user starts in
// Reflect mode with a narrow grant and later switches to Full, the
// wrist-derived data silently fails to read forever. Mode-gating is
// applied later at the prompt/UI layer, not at the permission layer.
const READ_PERMISSIONS = [
  "READ_STEPS",
  "READ_WORKOUTS",
  "READ_ACTIVE_CALORIES",
  "READ_BASAL_CALORIES",
  "READ_DISTANCE",
  "READ_HEART_RATE",
  "READ_RESTING_HEART_RATE",
  "READ_MINDFULNESS",
  "READ_HRV",
  "READ_RESPIRATORY_RATE",
  "READ_OXYGEN_SATURATION",
  "READ_BODY_TEMPERATURE",
  "READ_FLOORS_CLIMBED",
  "READ_SLEEP",
  "READ_EXERCISE_TIME",
  "READ_BLOOD_PRESSURE",
];

export function isAvailable() {
  return Capacitor.getPlatform() === "ios";
}

export async function requestPermission() {
  if (!isAvailable()) return { granted: false, reason: "not-ios" };
  try {
    await Health.requestHealthPermissions({ permissions: READ_PERMISSIONS });
    // iOS doesn't distinguish granted vs declined — the call returning
    // without throwing is the best signal we get. mergeAppleHealthIntoHistory's
    // fill-missing-only strategy means an actually-declined permission just
    // results in empty queries downstream, not corrupted data.
    return { granted: true, reason: "granted" };
  } catch (err) {
    return { granted: false, reason: String(err?.message || err) };
  }
}

// Defines the per-data-type mapping from `queryAggregated` results into
// the cpi_oura_history field name and any value transform. Daily bucket
// queries return one entry per calendar-day in the device's time zone.
const AGG_MAP = [
  { dataType: "hrv",                  field: "avgHRV",            round: 1 },
  { dataType: "resting-heart-rate",   field: "restingHR",         round: 1 },
  { dataType: "heart-rate",           field: "avgHR",             round: 0 },
  { dataType: "respiratory-rate",     field: "respiratoryRate",   round: 1 },
  { dataType: "oxygen-saturation",    field: "spo2Avg",           round: 1, transform: (v) => v <= 1 ? v * 100 : v },
  { dataType: "body-temperature",     field: "bodyTempAvg",       round: 2 },
  { dataType: "steps",                field: "steps",             round: 0 },
  { dataType: "flights-climbed",      field: "flights",           round: 0 },
  { dataType: "exercise-time",        field: "activeMinutes",     round: 0 },
  { dataType: "active-calories",      field: "activeKcal",        round: 0 },
  { dataType: "basal-calories",       field: "basalKcal",         round: 0 },
  { dataType: "distance",             field: "distanceKm",        round: 2, transform: (v) => v / 1000 },
  // Plugin returns mindfulness in seconds (HKUnit.second() / TimeInterval),
  // not minutes — verified in HealthPlugin.swift's queryMindfulnessAggregated
  // and the per-type switch at the aggregated-quantity path. Divide by 60.
  { dataType: "mindfulness",          field: "mindfulMinutes",    round: 1, transform: (v) => v / 60 },
];

function round(v, places) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

// The plugin's aggregated-result `startDate` is inconsistent across query
// paths: the standard quantity path serializes a millisecond-epoch Double
// (HealthPlugin.swift line 1317 — `timeIntervalSince1970 * 1000`), while
// the mindfulness and sleep aggregation paths pass the Date object
// directly, which Capacitor serializes as an ISO-ish string. We handle
// both shapes here so callers never have to care.
//
// For numeric (ms-epoch) inputs we extract LOCAL date components rather
// than calling toISOString(): the plugin generates daily buckets at the
// device-local-midnight boundary (per its calendar-day contract). UTC
// conversion would shift the bucket date by ±1 for users not in UTC —
// e.g., a JST user's "2026-05-15" bucket starts at 2026-05-14T15:00Z,
// whose toISOString slice is "2026-05-14".
function toYmd(input) {
  if (input == null) return null;
  if (typeof input === "number" && Number.isFinite(input)) {
    const d = new Date(input);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (typeof input === "string") return input.slice(0, 10);
  return null;
}

// Pull aggregated Apple Health data for the date range and shape it into
// the same per-day entries parseAppleHealthZip returns. `start` and `end`
// are ISO YYYY-MM-DD strings; the plugin treats them as calendar days in
// the device's local time zone.
//
// Sleep is the one signal that does NOT come from queryAggregated: the
// plugin's sleep aggregation sums durations across overlapping sources
// (Watch + AutoSleep + Oura-bridge + …) which inflates 7h sleep to 20+h.
// Phase 1 uses queryLatestSample for sleep — single de-duplicated session
// for today only. Historical sleep on the native path is intentionally
// empty; the user can ZIP-import once to backfill.
export async function appleHealthAggregateRange({ start, end } = {}) {
  if (!isAvailable()) return { entries: [], totalRecords: 0, keptRecords: 0, dateRange: { from: start, to: end } };

  const now = new Date();
  const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const endIso = end || todayLocal;
  const startIso = start || (() => {
    const back = new Date(now.getTime() - 90 * 86400000);
    return `${back.getFullYear()}-${String(back.getMonth() + 1).padStart(2, "0")}-${String(back.getDate()).padStart(2, "0")}`;
  })();

  // Build query bounds at LOCAL midnight, not UTC. The plugin uses
  // calendar-day boundaries in the device's time zone (per its docs);
  // sending "YYYY-MM-DDT00:00:00.000Z" would represent UTC midnight,
  // which for a non-UTC user lands inside the previous local day and
  // shifts every bucket by one. Constructing via local Date components
  // and round-tripping through toISOString gives the correct absolute
  // time of local-midnight in ISO-Z form.
  const localMidnight = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const localMidnightNextDay = (iso) => {
    // Always next-calendar-day local midnight. Going through the Date
    // constructor (rather than +86400000 ms) is required for the DST
    // fall-back night where the local day is 25 hours long — a fixed
    // 24-hour offset would cut off the final hour of that day's sleep.
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d + 1);
  };
  const startDate = localMidnight(startIso).toISOString();
  const endPlusOne = localMidnightNextDay(endIso).toISOString();

  // Per-day bucket map keyed by YYYY-MM-DD.
  const daily = {};
  const touch = (date) => {
    if (!daily[date]) daily[date] = { date, source: "apple-health" };
    return daily[date];
  };

  let totalRecords = 0;
  let keptRecords = 0;

  // Issue all aggregated queries in parallel. A failure on any one type
  // is contained — the rest still populate. This matters when a
  // permission was silently denied for a specific type.
  await Promise.allSettled(
    AGG_MAP.map(async ({ dataType, field, round: places, transform }) => {
      try {
        const res = await Health.queryAggregated({
          startDate,
          endDate: endPlusOne,
          dataType,
          bucket: "day",
        });
        const samples = res?.aggregatedData || [];
        for (const s of samples) {
          totalRecords++;
          const dateStr = toYmd(s.startDate);
          if (!dateStr) continue;
          let v = typeof s.value === "number" ? s.value : null;
          if (v == null || !Number.isFinite(v) || v === 0) continue;
          if (transform) v = transform(v);
          const rounded = round(v, places);
          if (rounded == null) continue;
          touch(dateStr)[field] = rounded;
          keptRecords++;
        }
      } catch (err) {
        console.warn(`[apple-health] queryAggregated(${dataType}) failed:`, err);
      }
    })
  );

  // Heart-rate-derived quantity samples that the main plugin doesn't
  // expose: VO2 max, walking heart-rate average, and the iOS 16+
  // one-minute heart-rate recovery. Run all three in parallel via the
  // custom QuantityBridge; each kind buckets to its sample's local
  // calendar day. These are the three biometric fields the engine has
  // wired for through biometricsFromDayEntry but never received native
  // data for until now. A failure on any single kind is contained —
  // permission denial for one type doesn't lose the others.
  const QUANTITY_KINDS = [
    { kind: "vo2-max",                          field: "vo2Max",     round: 1 },
    { kind: "walking-hr-average",               field: "walkingHR",  round: 0 },
    { kind: "heart-rate-recovery-one-minute",   field: "hrRecovery", round: 0 },
    // Apple Sleeping Wrist Temperature (iOS 17+) — the signal the
    // readiness model already wants. Captured nightly during sleep, so
    // it's far more stable than the daytime generic body-temperature
    // samples the main AGG_MAP picks up. Stored in its own field;
    // copied into bodyTempAvg in a post-pass below so the existing
    // temperatureTrendDeviation formula picks it up automatically.
    { kind: "wrist-temp-sleeping",              field: "wristTempC", round: 2 },
  ];
  await Promise.allSettled(
    QUANTITY_KINDS.map(async ({ kind, field, round: places }) => {
      try {
        const res = await QuantityBridge.queryQuantitySamples({
          kind, startDate, endDate: endPlusOne,
        });
        const samples = res?.samples || [];
        // Group by local calendar day. Multiple samples in a single day
        // — common for Walking HR Average on a long walking day — get
        // averaged so the bucket reflects the day's central tendency.
        const dayBuckets = {};
        for (const s of samples) {
          totalRecords++;
          const dateStr = toYmd(s.endDate) || toYmd(s.startDate);
          if (!dateStr) continue;
          const v = typeof s.value === "number" ? s.value : null;
          if (v == null || !Number.isFinite(v) || v === 0) continue;
          (dayBuckets[dateStr] = dayBuckets[dateStr] || []).push(v);
        }
        for (const [dateStr, values] of Object.entries(dayBuckets)) {
          const avg = values.reduce((a, b) => a + b, 0) / values.length;
          const rounded = round(avg, places);
          if (rounded == null) continue;
          touch(dateStr)[field] = rounded;
          keptRecords++;
        }
      } catch (err) {
        console.warn(`[apple-health] QuantityBridge(${kind}) failed:`, err);
      }
    })
  );

  // Wrist-temp post-pass — if the Watch logged a sleeping wrist temp
  // for a given day, prefer it over whatever generic body-temperature
  // ended up in bodyTempAvg. Sleeping wrist temp is the signal the
  // engine's temperatureTrendDeviation formula was designed for, so
  // copying it into the same field gets the better number into the
  // existing math without any engine-side change.
  for (const day of Object.values(daily)) {
    if (typeof day.wristTempC === "number") {
      day.bodyTempAvg = day.wristTempC;
    }
  }

  // Blood pressure — separate aggregated query because the result
  // shape carries two numbers (systolic + diastolic) instead of one,
  // which doesn't fit the AGG_MAP single-field pattern. User-logged
  // only for most people; silent when no cuff readings exist.
  try {
    const bpRes = await Health.queryAggregated({
      startDate, endDate: endPlusOne, dataType: "blood-pressure", bucket: "day",
    });
    const samples = bpRes?.aggregatedData || [];
    for (const s of samples) {
      totalRecords++;
      const dateStr = toYmd(s.startDate);
      if (!dateStr) continue;
      const sys = round(typeof s.systolic === "number" ? s.systolic : null, 0);
      const dia = round(typeof s.diastolic === "number" ? s.diastolic : null, 0);
      if (sys == null && dia == null) continue;
      const d = touch(dateStr);
      if (sys != null) d.bpSystolic = sys;
      if (dia != null) d.bpDiastolic = dia;
      keptRecords++;
    }
  } catch (err) {
    console.warn("[apple-health] queryAggregated(blood-pressure) failed:", err);
  }

  // Workouts — separate API. We append the same shape parseAppleHealthZip
  // emits ({ type, durationMin, kcal, distanceKm }) so downstream consumers
  // don't have to branch on path-of-origin.
  try {
    const wRes = await Health.queryWorkouts({
      startDate,
      endDate: endPlusOne,
      includeHeartRate: false,
      includeRoute: false,
      includeSteps: false,
    });
    const workouts = wRes?.workouts || [];
    for (const w of workouts) {
      totalRecords++;
      const dateStr = toYmd(w.endDate) || toYmd(w.startDate);
      if (!dateStr) continue;
      const d = touch(dateStr);
      d.workouts = d.workouts || [];
      d.workouts.push({
        type: w.workoutType || "Unknown",
        durationMin: typeof w.duration === "number" ? w.duration / 60 : null,
        kcal: typeof w.calories === "number" ? w.calories : null,
        distanceKm: typeof w.distance === "number" ? w.distance / 1000 : null,
      });
      keptRecords++;
    }
  } catch (err) {
    console.warn("[apple-health] queryWorkouts failed:", err);
  }

  // Full per-stage sleep across the whole window via SleepBridge.
  //
  // Each HKCategorySample is bucketed into the calendar day its endDate
  // belongs to (so a session that ran 11pm → 7am attributes to the wake
  // day, matching the ZIP parser's convention and what every wearable
  // calls "today's sleep"). Stage strings from the Swift side:
  //   "inBed", "awake",
  //   "asleep" (legacy / pre-iOS 16),
  //   "asleepCore" → light,
  //   "asleepDeep" → deep,
  //   "asleepREM"  → rem,
  //   "asleepUnspecified" → light (closest match — matches ZIP parser).
  //
  // After collection we union-merge per bucket so overlapping records
  // from multiple sources (Watch + Oura + AutoSleep + Pillow + …) sum
  // to the actual non-overlapping minutes rather than 3x the truth.
  try {
    const sleepRes = await SleepBridge.querySleepSamples({
      startDate,
      endDate: endPlusOne,
    });
    const sleepSamples = sleepRes?.samples || [];

    // Per-day bucket map: date → { asleep: [[s,e], …], deep: [...], rem: [...], light: [...], inBed: [...], awake: [...] }
    const sleepBuckets = {};
    const segOf = (date, bucket) => {
      if (!sleepBuckets[date]) sleepBuckets[date] = {};
      if (!sleepBuckets[date][bucket]) sleepBuckets[date][bucket] = [];
      return sleepBuckets[date][bucket];
    };
    // Outermost session edges per day, for bedtimeStart / bedtimeEnd.
    const sessionEdges = {};

    for (const s of sleepSamples) {
      totalRecords++;
      const startMs = typeof s.startDate === "number" ? s.startDate : null;
      const endMs   = typeof s.endDate   === "number" ? s.endDate   : null;
      if (startMs == null || endMs == null || endMs <= startMs) continue;
      const durMin = (endMs - startMs) / 60000;
      // Plausibility filter mirrors the ZIP parser. Any individual
      // sample longer than 12h is malformed — common when a source
      // accidentally writes a multi-day "in-bed" span.
      if (durMin <= 0 || durMin > 720) continue;

      // Attribute the sample to the LOCAL calendar day of its endDate,
      // not the UTC day. The ZIP parser slices Apple's local-time export
      // string directly; matching that ensures the same night of sleep
      // lands on the same date no matter which path imported it. UTC
      // attribution would shift cross-midnight stages to the wrong day
      // for every user whose timezone isn't UTC.
      const ed = new Date(endMs);
      const date = `${ed.getFullYear()}-${String(ed.getMonth() + 1).padStart(2, "0")}-${String(ed.getDate()).padStart(2, "0")}`;
      if (date < startIso || date > endIso) continue;

      const stage = s.value;
      if (stage === "inBed") {
        segOf(date, "inBed").push([startMs, endMs]);
      } else if (stage === "awake") {
        segOf(date, "awake").push([startMs, endMs]);
      } else if (
        stage === "asleep" ||
        stage === "asleepCore" ||
        stage === "asleepDeep" ||
        stage === "asleepREM" ||
        stage === "asleepUnspecified"
      ) {
        segOf(date, "asleep").push([startMs, endMs]);
        if (stage === "asleepDeep") segOf(date, "deep").push([startMs, endMs]);
        else if (stage === "asleepREM") segOf(date, "rem").push([startMs, endMs]);
        else if (stage === "asleepCore" || stage === "asleepUnspecified") {
          segOf(date, "light").push([startMs, endMs]);
        }
        // Track outermost asleep edges per day for bedtime metadata.
        const edge = sessionEdges[date] || { startMs: null, endMs: null };
        if (edge.startMs == null || startMs < edge.startMs) edge.startMs = startMs;
        if (edge.endMs   == null || endMs   > edge.endMs)   edge.endMs   = endMs;
        sessionEdges[date] = edge;
      } else {
        continue;
      }
      keptRecords++;
    }

    // Union-merge a sorted array of [startMs, endMs] segments and return
    // the total non-overlapping minutes. Same algorithm as the ZIP parser.
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

    for (const date of Object.keys(sleepBuckets)) {
      const segs = sleepBuckets[date];
      const d = touch(date);
      if (segs.asleep) d.totalSleepMin   = Math.round(unionMinutes(segs.asleep) * 100) / 100;
      if (segs.deep)   d.deepSleepMin    = Math.round(unionMinutes(segs.deep)   * 100) / 100;
      if (segs.rem)    d.remSleepMin     = Math.round(unionMinutes(segs.rem)    * 100) / 100;
      if (segs.light)  d.lightSleepMin   = Math.round(unionMinutes(segs.light)  * 100) / 100;
      if (segs.inBed)  d.inBedMin        = Math.round(unionMinutes(segs.inBed)  * 100) / 100;
      if (segs.awake)  d.awakeMin        = Math.round(unionMinutes(segs.awake)  * 100) / 100;

      const edge = sessionEdges[date];
      if (edge?.startMs && edge?.endMs && edge.endMs > edge.startMs) {
        d.bedtimeStart = new Date(edge.startMs).toISOString();
        d.bedtimeEnd   = new Date(edge.endMs).toISOString();
      }

      // Same plausibility cap the ZIP parser uses. After full dedup, a
      // single night >14h means the data is still pathological (a source
      // wrote multi-day spans we couldn't catch otherwise); blank the
      // sleep block rather than publish nonsense.
      if (typeof d.totalSleepMin === "number" && d.totalSleepMin > 840) {
        d.sleepSuspect = true;
        d.totalSleepMin = null;
        d.deepSleepMin = null;
        d.remSleepMin = null;
        d.lightSleepMin = null;
      }
    }
  } catch (err) {
    console.warn("[apple-health] SleepBridge.querySleepSamples failed:", err);
  }

  const sortedDays = Object.keys(daily).sort().map((k) => daily[k]);

  // Score derivation — same pass the ZIP path uses, so sleepScore /
  // readinessScore / activityScore land in the entries exactly as they
  // would from a ZIP import.
  computeDerivedAppleScores(sortedDays);

  return {
    entries: sortedDays,
    totalRecords,
    keptRecords,
    dateRange: { from: startIso, to: endIso },
  };
}
