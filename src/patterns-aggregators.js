// Pure-function aggregators that turn `history` + `biometricTrends` into
// self-described "findings" for the Patterns tab cards. Each finding object
// carries a `headline`, a `meta` paragraph, and viz-friendly data. No React,
// no DOM — just data in, data out. See docs/superpowers/specs for design.

import { ymdISO } from "./dates.js";
import { qualifiedPartIdsForKeeper, partAppearanceDays } from "./parts-stats.js";

// ────────────────────────────────────────────────────────────────────────
// Small helpers

function entryHCPI(e) {
  const v = e?.hcpi;
  return typeof v === "number" && !isNaN(v) ? v : null;
}

function entryDate(e) {
  // YYYY-MM-DD strings: parse local-date directly so a PDT plant from
  // today doesn't get UTC-shifted back to yesterday. Anything else falls
  // back to the Date constructor.
  const v = e?.date;
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function withinDays(e, days) {
  const d = entryDate(e);
  if (!d) return false;
  return Date.now() - d.getTime() <= days * 86400000;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ────────────────────────────────────────────────────────────────────────
// Weekday HCPI profile — per-DOW average over the window.

export function weekdayProfile(history, windowDays = 30) {
  const buckets = [[], [], [], [], [], [], []]; // Sun..Sat
  for (const e of history || []) {
    if (!withinDays(e, windowDays)) continue;
    const hcpi = entryHCPI(e);
    const d = entryDate(e);
    if (hcpi == null || !d) continue;
    buckets[d.getDay()].push(hcpi);
  }
  const byDow = buckets.map(b => mean(b));
  let peakDow = -1, peakVal = -Infinity;
  for (let i = 0; i < 7; i++) {
    if (buckets[i].length >= 2 && byDow[i] != null && byDow[i] > peakVal) {
      peakDow = i; peakVal = byDow[i];
    }
  }
  const sampleSize = buckets.reduce((s, b) => s + b.length, 0);

  // "peakStrong" — does the peak weekday meaningfully lead the rest, or is
  // it just the largest of seven near-equal piles? Eval showed pure random
  // data over a 30-day window (~4 samples per DOW) can throw up a 0.18 lead
  // by chance alone. The right yardstick is the standard ERROR of the
  // bucket mean (within-SD ÷ √n), which collapses as n grows. We require
  // the peak to lead the others by ≥ 2 SE — the rough analog of a 95%
  // confidence-interval separation.
  const qualifiedBuckets = buckets.filter(b => b.length >= 2);
  const withinSDs = qualifiedBuckets.map(b => {
    const m = mean(b);
    const v = b.reduce((s, x) => s + (x - m) ** 2, 0) / b.length;
    return Math.sqrt(v);
  });
  const meanWithinSD = withinSDs.length
    ? withinSDs.reduce((a, c) => a + c, 0) / withinSDs.length
    : 0;
  const meanBucketSize = qualifiedBuckets.length
    ? qualifiedBuckets.reduce((s, b) => s + b.length, 0) / qualifiedBuckets.length
    : 0;
  const meanSE = meanBucketSize > 0 ? meanWithinSD / Math.sqrt(meanBucketSize) : 0;
  const others = byDow.filter((v, i) => i !== peakDow && v != null);
  const othersMean = others.length ? others.reduce((a, c) => a + c, 0) / others.length : 0;
  const peakLead = peakDow >= 0 ? peakVal - othersMean : 0;
  // Strength as a t-stat: peakLead in units of SE-of-bucket-mean. When SE is 0
  // (all qualifying buckets internally constant) a real lead is infinitely
  // significant — but Infinity rides on the returned finding and isn't JSON-safe
  // (serializes to null, and any downstream arithmetic NaNs out). Use a large
  // finite sentinel that still clears every peakStrong threshold.
  const peakStrength = meanSE > 0 ? peakLead / meanSE : (peakLead > 0.05 ? 999 : 0);
  // Strong if the lead clears 3.0 SE AND has a meaningful absolute size,
  // AND every qualifying weekday has at least 4 samples. The 3.0 threshold
  // is roughly a Bonferroni-corrected 95% — picking the LARGEST of 7
  // weekday means inflates type-I error compared to a single comparison,
  // so we need a stricter cutoff. Min-sample-size keeps thinly-sampled
  // weekdays from masquerading as peaks just because they're under-counted.
  const allBucketsAdequate = qualifiedBuckets.length === 7 && qualifiedBuckets.every(b => b.length >= 4);
  const peakStrong = peakStrength >= 3.0 && peakLead >= 0.06 && allBucketsAdequate;

  return { byDow, peakDow, sampleSize, peakLead, peakStrength, peakStrong };
}

// ────────────────────────────────────────────────────────────────────────
// Derived chronotype — from average sleep midpoint across recent nights.
// MCTQ-inspired: < 3:30am midpoint = morning, 3:30–5:30 = intermediate,
// > 5:30 = evening.
//
// Data source: the Oura history map (keyed by YYYY-MM-DD) carries
// `bedtimeStart` / `bedtimeEnd` as ISO timestamps when an Oura ring is
// connected. We extract the wall-clock midpoint of each night's sleep.

function midpointMinutesFromISO(bedISO, endISO) {
  const bed = new Date(bedISO), end = new Date(endISO);
  if (isNaN(bed.getTime()) || isNaN(end.getTime())) return null;
  if (end.getTime() <= bed.getTime()) return null;
  const midMs = bed.getTime() + (end.getTime() - bed.getTime()) / 2;
  const mid = new Date(midMs);
  return mid.getHours() * 60 + mid.getMinutes(); // 0..1439, local time
}

export function derivedChronotype(ouraMap, opts = {}) {
  const windowDays = typeof opts === "number" ? opts : (opts?.windowDays ?? 30);
  const fallback = (typeof opts === "object" && opts) ? opts.fallback : null;
  const midpoints = [];
  if (ouraMap && typeof ouraMap === "object") {
    const cutoff = Date.now() - windowDays * 86400000;
    for (const ymd of Object.keys(ouraMap)) {
      const e = ouraMap[ymd];
      const bedISO = e?.bedtimeStart, endISO = e?.bedtimeEnd;
      if (!bedISO || !endISO) continue;
      const t = new Date(bedISO).getTime();
      if (isNaN(t) || t < cutoff) continue;
      const m = midpointMinutesFromISO(bedISO, endISO);
      if (m != null) midpoints.push(m);
    }
  }

  // Device-data path: ≥7 nights of Oura/AH gives a real per-night picture.
  if (midpoints.length >= 7) {
    const m = median(midpoints);
    // Reliability gate: only name a chronotype when bedtimes are actually
    // consistent. SD > 60 min means the user shifts nightly and doesn't
    // HAVE a stable chronotype to claim. Eval surfaced chronotype
    // false-fires on chaotic-sleep users whose random midpoints happened
    // to median into the morning band.
    const meanMid = midpoints.reduce((s, v) => s + v, 0) / midpoints.length;
    const sdMid = Math.sqrt(midpoints.reduce((s, v) => s + (v - meanMid) ** 2, 0) / midpoints.length);
    if (sdMid > 60) return { label: null, midpointMin: m, nights: midpoints.length, midpointSdMin: sdMid, source: "device" };
    let label = "intermediate";
    if (m < 3.5 * 60) label = "morning";
    else if (m > 5.5 * 60) label = "evening";
    return { label, midpointMin: m, nights: midpoints.length, midpointSdMin: sdMid, source: "device" };
  }

  // Self-reported fallback: when the user told us their typical sleep
  // window in onboarding/Settings, the midpoint is a single deterministic
  // value (no SD, no reliability gate — we trust their self-report).
  if (fallback && typeof fallback.midpointMin === "number") {
    const m = fallback.midpointMin;
    let label = "intermediate";
    if (m < 3.5 * 60) label = "morning";
    else if (m > 5.5 * 60) label = "evening";
    return { label, midpointMin: m, nights: midpoints.length, source: "self_report" };
  }

  return { label: null, midpointMin: null, nights: midpoints.length, source: null };
}

// ────────────────────────────────────────────────────────────────────────
// Peak window — chronotype-driven estimate of sharpest two-hour band.
// Real circadian cognition peaks ~7h after sleep-midpoint (Schmidt 2007).

export function peakWindow(ouraMap, opts = {}) {
  const chrono = derivedChronotype(ouraMap, opts);
  if (chrono.midpointMin == null) return null;
  const peakMin = (chrono.midpointMin + 7 * 60) % (24 * 60);
  const startMin = peakMin - 60, endMin = peakMin + 60;
  const fmt = (m) => {
    let h = Math.floor((m / 60 + 24) % 24);
    const suffix = h >= 12 ? "pm" : "am";
    h = h % 12; if (h === 0) h = 12;
    return `${h}${suffix}`;
  };
  return { startMin, endMin, label: `${fmt(startMin)}–${fmt(endMin)}`, chronotype: chrono.label };
}

// ────────────────────────────────────────────────────────────────────────
// Sleep regularity wrapper — uses the SRI already on biometricTrends if
// present, else returns null. Phillips et al, Sci Rep 2017.

export function sleepRegularityFinding(biometricTrends) {
  const sri = biometricTrends?.sri;
  if (typeof sri !== "number") return null;
  let descriptor = "steady";
  if (sri >= 85) descriptor = "unusually steady";
  else if (sri >= 70) descriptor = "steady";
  else if (sri >= 55) descriptor = "somewhat irregular";
  else descriptor = "all-over-the-place";
  return { score: sri, descriptor };
}

// ────────────────────────────────────────────────────────────────────────
// Rhythms — composite finding combining chronotype + peak window + weekday +
// sleep regularity. Returns null if neither HCPI nor sleep data is enough.

export function rhythmsFinding(history, biometricTrends, ouraMap, opts = {}) {
  const fallback = opts?.selfReportedSleepWindow || null;
  const chronoOpts = { windowDays: 30, fallback };
  const wd = weekdayProfile(history, 30);
  const chrono = derivedChronotype(ouraMap, chronoOpts);
  const peak = peakWindow(ouraMap, chronoOpts);
  const sri = sleepRegularityFinding(biometricTrends);

  const haveStrongWeekday = wd.peakStrong;
  // "Soft" weekday signal: we have a leading day-of-week, but not enough
  // samples to claim statistical significance. Renders the bars with a
  // hedged headline ("strongest in your first N days") so the user has
  // something to look at instead of an empty calibrating placeholder.
  const haveSoftWeekday = !haveStrongWeekday && wd.peakDow >= 0 && wd.sampleSize >= 7;
  const haveChrono = !!chrono.label;
  if (!haveStrongWeekday && !haveSoftWeekday && !haveChrono) {
    // Truly calibrating: less than a week of writing AND no chronotype
    // reading. Show a placeholder so the card still appears.
    const daysSoFar = wd.sampleSize;
    return {
      calibrating: true,
      headline: "Still learning your rhythm.",
      meta: daysSoFar > 0
        ? `Your week's shape comes into focus after a couple weeks of writing. ${daysSoFar} day${daysSoFar === 1 ? "" : "s"} so far.`
        : "Your week's shape comes into focus after a couple weeks of writing.",
    };
  }

  const dowName = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  const chronoPhrase = {
    morning: "You're a quiet morning person.",
    intermediate: "Your clock sits in the middle of the dial.",
    evening: "You're more of an evening thinker.",
  };

  // Pick the headline source by which signal is most distinctive FOR THIS
  // user. Eval showed that always-leading-with-chronotype made every morning
  // person see the same opening line; a strong weekday peak is rarer and
  // more uniquely "you."
  //
  // Priority:
  //   1. Strong weekday peak (clears 1× within-SD lead)
  //   2. Distinct chronotype (morning or evening — NOT the middle bucket
  //      that ~50% of people land in)
  //   3. Extreme sleep regularity (unusually steady or all-over-the-place)
  //   4. Intermediate chronotype (least differentiating, used as fallback)
  let headlineSource = "fallback";
  let headline;
  const sriExtreme = sri && (sri.descriptor === "unusually steady" || sri.descriptor === "all-over-the-place");
  if (haveStrongWeekday) {
    headlineSource = "weekday";
    headline = `${dowName[wd.peakDow]} tend to be your strongest day of the week.`;
  } else if (haveChrono && chrono.label !== "intermediate") {
    headlineSource = "chronotype";
    headline = chronoPhrase[chrono.label];
  } else if (sriExtreme) {
    headlineSource = "sri";
    headline = sri.descriptor === "unusually steady"
      ? "Your sleep clock has been remarkably steady."
      : "Your sleep clock has been all over the place.";
  } else if (haveChrono) {
    headlineSource = "chronotype";
    headline = chronoPhrase[chrono.label];
  } else if (haveSoftWeekday) {
    headlineSource = "weekday-soft";
    headline = `${dowName[wd.peakDow]} have been your strongest so far.`;
  } else {
    headline = "Still learning your rhythm.";
  }

  // Meta carries the signals NOT used for the headline.
  const parts = [];
  if (headlineSource !== "chronotype" && haveChrono) {
    parts.push(`your clock sits in the ${chrono.label} part of the dial`);
  }
  if (peak) parts.push(`your clearest two hours land between ${peak.label}`);
  if (headlineSource !== "weekday" && haveStrongWeekday) {
    parts.push(`${dowName[wd.peakDow]} tend to run stronger than the rest of the week`);
  }
  if (headlineSource !== "sri" && sri) {
    parts.push(`your sleep clock has been ${sri.descriptor} this month`);
  }

  const meta = parts.length
    ? capitalizeFirst(parts.join(", and ") + ".")
    : (headlineSource === "weekday-soft"
        ? `Your week's shape will sharpen as you keep writing. ${wd.sampleSize} day${wd.sampleSize === 1 ? "" : "s"} so far.`
        : "More data and the rest of the picture comes in.");

  // Honest "no clear structure" reading vs. a confident pattern claim. A
  // volatile sleep clock, an intermediate chronotype, a still-soft weekday, or
  // the "still learning" fallback are all truthful no-pattern readings — NOT
  // assertions of weekly/circadian structure. Lets the eval separate a real
  // false positive from honest noise-reporting, and lets the UI de-emphasize a
  // tentative card. (A "remarkably steady" clock IS a real finding — not flagged.)
  const noPattern = headlineSource === "fallback"
    || headlineSource === "weekday-soft"
    || (headlineSource === "sri" && /all over the place/i.test(headline))
    || (headlineSource === "chronotype" && chrono.label === "intermediate");

  return {
    headline,
    meta,
    noPattern,
    weekdayBars: wd.byDow,
    peakDow: wd.peakDow,
    peakStrong: wd.peakStrong,
    peakBand: peak,
    chronotype: chrono.label,
    sleepRegularity: sri,
    headlineSource,
  };
}

function capitalizeFirst(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ────────────────────────────────────────────────────────────────────────
// Highlights — the brightest and the heaviest day of the recent window, each
// named by date. DESCRIPTIVE, not correlational: it makes no claim that one
// thing caused another — it just points back at two real days (the user's most
// and least steady) so they can re-read them. No score is ever shown, only the
// day. Returns null below a week of readings, so a thin history shows nothing
// here rather than a forced "highlight".

export function highlightsFinding(history, windowDays = 30) {
  const seen = new Set();
  const days = [];
  for (const e of history || []) {
    const h = entryHCPI(e);
    const d = entryDate(e);
    if (h == null || !d || !withinDays(e, windowDays)) continue;
    const key = ymdISO(d);
    if (seen.has(key)) continue; // one reading per local day
    seen.add(key);
    days.push({ key, date: d, hcpi: h });
  }
  // "Brightest/heaviest of the month" only means something with a real spread
  // of days behind it. Under a week, show nothing — a forced highlight is just
  // the filler we're trying to avoid.
  if (days.length < 7) return null;

  let bright = days[0];
  let heavy = days[0];
  for (const x of days) {
    if (x.hcpi > bright.hcpi) bright = x;
    if (x.hcpi < heavy.hcpi) heavy = x;
  }
  // Degenerate / near-flat case — no high or low worth pointing at. A 1e-9 floor
  // only caught exact ties; a tiny-but-nonzero spread still forced a "brightest
  // vs heaviest" highlight on two functionally-identical days. Require a
  // perceptible gap (~5 points on the 0–1 scale) or hide the tile.
  if (bright.key === heavy.key || bright.hcpi - heavy.hcpi < 0.05) return null;

  const fmt = (d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return {
    brightest: { key: bright.key, label: fmt(bright.date) },
    heaviest: { key: heavy.key, label: fmt(heavy.date) },
    headline: "Your month's brightest day, and its heaviest — both worth a second look.",
  };
}

// ────────────────────────────────────────────────────────────────────────
// Returns — most-visiting part, longest-absent part, friction lean, lingering mode.

export function daysSinceLastVisit(history, partId) {
  if (!partId || !Array.isArray(history)) return null;
  let mostRecent = null;
  for (const e of history) {
    const parts = Array.isArray(e?.letterParts) ? e.letterParts : [];
    if (!parts.some(p => p?.id === partId)) continue;
    const d = entryDate(e);
    if (!d) continue;
    if (!mostRecent || d > mostRecent) mostRecent = d;
  }
  if (!mostRecent) return null;
  return Math.floor((Date.now() - mostRecent.getTime()) / 86400000);
}

export function frictionLean(history, windowDays = 30) {
  const totals = { survival: 0, social: 0, discomfort: 0, reward: 0, identity: 0 };
  let n = 0;
  for (const e of history || []) {
    if (!withinDays(e, windowDays)) continue;
    const d = e?.drivers || {};
    for (const k of Object.keys(totals)) {
      if (typeof d[k] === "number") totals[k] += d[k];
    }
    n++;
  }
  if (n < 7) return null;
  let top = null, topVal = -1;
  for (const k of Object.keys(totals)) {
    if (totals[k] > topVal) { top = k; topVal = totals[k]; }
  }
  const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  return { dominant: top, share: totals[top] / sum, days: n };
}

export function lingeringMode(history, windowDays = 30) {
  const counts = {};
  for (const e of history || []) {
    if (!withinDays(e, windowDays)) continue;
    const drv = e?.lingeringDriver;
    if (!drv) continue;
    counts[drv] = (counts[drv] || 0) + 1;
  }
  let top = null, topVal = 0;
  for (const k of Object.keys(counts)) if (counts[k] > topVal) { top = k; topVal = counts[k]; }
  return top ? { dominant: top, occurrences: topVal } : null;
}

export function returnsFinding(history, confirmations, partsLib) {
  if (!partsLib) return null;
  const qualified = qualifiedPartIdsForKeeper(history, partsLib, confirmations);
  if (!qualified.size) {
    // Calibrating: no parts have qualified for the Keeper roster yet.
    return {
      calibrating: true,
      headline: "Still learning who shows up.",
      meta: "A few more days of writing and the patterns of who keeps coming forward will settle.",
      keeperCount: 0,
    };
  }

  let topVisitor = null, topVisits = 0, runnerUpVisits = 0;
  let lapsed = null, lapsedDays = 0;
  // Roster: the same per-part visit counts the top/lapsed picks are drawn
  // from, kept in full so the Patterns → Returns detail can show the whole
  // ranked garden (each row taps through to its part). Same L3 own-history
  // count as topVisitor.visits — no new claim, rides the `patterns` chip.
  const roster = [];
  for (const id of qualified) {
    const part = partsLib[id];
    if (!part) continue;
    const visits = partAppearanceDays(history, part, 30);
    const since = daysSinceLastVisit(history, id);
    roster.push({ id, name: part.name, glyph: part.glyph, color: part.color, visits, daysAway: since });
    if (visits > topVisits) {
      runnerUpVisits = topVisits;
      topVisits = visits;
      topVisitor = { id, name: part.name, glyph: part.glyph, color: part.color, visits };
    } else if (visits > runnerUpVisits) {
      runnerUpVisits = visits;
    }
    if (since != null && since > lapsedDays) { lapsedDays = since; lapsed = { id, name: part.name, glyph: part.glyph, color: part.color, daysAway: since }; }
  }
  roster.sort((a, b) => b.visits - a.visits || (a.daysAway ?? 1e9) - (b.daysAway ?? 1e9));

  const friction = frictionLean(history);
  const lingering = lingeringMode(history);

  const driverNoun = {
    survival: "the body and what it needs",
    social: "how others might see you",
    discomfort: "what you've been avoiding",
    reward: "the next small distraction",
    identity: "questions of worthiness",
  };

  if (!topVisitor) return null;

  // Headline picker — eval showed that always leading with topVisitor made
  // every user's Returns card open the same way ("The planner has been
  // around a lot this month") whenever one part visited most. Lead instead
  // with whichever signal is most distinctive FOR this user:
  //   1. Dominant visitor — clears a margin over the runner-up
  //   2. Long absence — a familiar part has been quiet for ≥10 days
  //   3. Lingering driver — what the user's mind chews on
  //   4. Fallback — parts have been showing up about equally
  const visitsDominant = topVisits >= 8 && (topVisits - runnerUpVisits >= 3 || topVisits >= runnerUpVisits * 1.4);
  const lapsedSignificant = lapsed && lapsed.id !== topVisitor.id && lapsed.daysAway >= 10;
  let headlineSource = "fallback";
  let headline;
  const cap = (n) => n.charAt(0).toUpperCase() + n.slice(1);
  const stripThe = (n) => n.replace(/^the\s+/i, "");
  if (visitsDominant) {
    headlineSource = "topVisitor";
    headline = `${cap("The " + stripThe(topVisitor.name))} has been around a lot this month.`;
  } else if (lapsedSignificant) {
    headlineSource = "lapsed";
    headline = `${cap("The " + stripThe(lapsed.name))} hasn't been around in ${lapsed.daysAway} days.`;
  } else if (lingering && driverNoun[lingering.dominant]) {
    headlineSource = "lingering";
    headline = `When your mind wanders, it tends toward ${driverNoun[lingering.dominant]}.`;
  } else {
    headline = "Your parts have been showing up about equally.";
  }

  const metaParts = [];
  if (headlineSource !== "topVisitor") {
    metaParts.push(`${topVisitor.name} has shown up ${topVisits} day${topVisits === 1 ? "" : "s"} this month`);
  } else {
    metaParts.push(`${topVisits} day${topVisits === 1 ? "" : "s"}, more than any other part of you`);
  }
  if (headlineSource !== "lapsed" && lapsed && lapsed.id !== topVisitor.id && lapsed.daysAway >= 5) {
    metaParts.push(`${lapsed.name} hasn't been around in ${lapsed.daysAway} days — longer than usual`);
  }
  if (headlineSource !== "lingering" && lingering && driverNoun[lingering.dominant]) {
    metaParts.push(`when your mind wanders, it tends to chew on ${driverNoun[lingering.dominant]} more than anything else`);
  }
  const meta = capitalizeFirst(metaParts.join(". ").replace(/\.\s+\./g, ".") + ".");

  return {
    headline,
    meta,
    // "Showing up about equally" is an honest no-pattern reading, not a claim
    // that a specific part is recurring — same separation rhythms/weather use.
    noPattern: headlineSource === "fallback",
    topVisitor,
    lapsed,
    friction,
    lingering,
    roster,
    keeperCount: qualified.size,
    headlineSource,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Drifts — sleep-debt drift + recovery profile (HRV-based bounce-back).

export function recoveryProfile(history, biometricTrends, ouraMap) {
  const baseline = biometricTrends?.hrvBaseline30;
  if (typeof baseline !== "number" || baseline <= 0) return null;
  if (!ouraMap || typeof ouraMap !== "object") return null;
  // HRV lives on the Oura day-entry, keyed by YYYY-MM-DD.
  const hrvByDate = new Map();
  for (const ymd of Object.keys(ouraMap)) {
    const hrv = ouraMap[ymd]?.avgHRV;
    if (typeof hrv === "number") hrvByDate.set(ymd, hrv);
  }
  // Only count a low day as EVALUABLE if at least one of the next 5 days has
  // an HRV reading — otherwise we can't tell whether it bounced, and silently
  // dropping it would bias toward fast recovery (survivorship). `bounces` holds
  // the days-to-bounce for the ones that did recover; `evaluable` counts every
  // low day we could actually judge.
  const bounces = [];
  let evaluable = 0;
  for (const e of history || []) {
    const hcpi = entryHCPI(e);
    const d = entryDate(e);
    if (hcpi == null || !d || hcpi >= 0.20) continue;
    let hadFollowup = false, bounceK = null;
    for (let k = 1; k <= 5; k++) {
      const next = new Date(d); next.setDate(next.getDate() + k);
      const hrv = hrvByDate.get(ymdISO(next));
      if (typeof hrv !== "number") continue;
      hadFollowup = true;
      if (hrv >= baseline * 0.95) { bounceK = k; break; }
    }
    if (!hadFollowup) continue; // can't judge this low day — exclude it entirely
    evaluable++;
    if (bounceK != null) bounces.push(bounceK);
  }
  // Need enough judged low days AND a real majority that actually recovered —
  // otherwise "back to your usual in N days" is just the days that happened to
  // bounce talking over the ones that didn't. The data is daily, so the answer
  // is reported in whole DAYS (mean bounce-day, never finer than the sampling).
  if (bounces.length < 3 || evaluable < 4 || bounces.length / evaluable < 0.5) return null;
  const daysToBaseline = Math.max(1, Math.round(mean(bounces)));
  return { daysToBaseline, samples: bounces.length, recoveredShare: bounces.length / evaluable };
}

export function driftsFinding(history, biometricTrends, ouraMap) {
  // No wearable history at all — quiet calibrating placeholder.
  if (!biometricTrends) {
    return {
      calibrating: true,
      headline: "Nothing drifting yet.",
      meta: "When Oura or Apple Health data lands, the slow movement in your sleep — debt, surplus, recovery — will show up here.",
    };
  }

  // Drifts is a SLOW signal: it reads the signed per-night sleep deviation across
  // a ~3-week window (sleepDriftPerNightH), NOT the 7-day debt HCPI uses. It only
  // truly calibrates until there are enough measured nights to read three weeks.
  const shortBy = biometricTrends.sleepDriftPerNightH;
  const nights = biometricTrends.sleepDriftNights ?? 0;
  if (typeof shortBy !== "number") {
    return {
      calibrating: true,
      headline: "Nothing drifting yet.",
      meta: nights > 0
        ? `Drifts reads the slow movement in your sleep across about three weeks. So far ${nights === 1 ? "one night has" : `${nights} nights have`} wearable data — a few more and this comes alive.`
        : "Drifts reads the slow movement in your sleep across about three weeks, once Oura or Apple Health nights start landing.",
    };
  }

  // Enough data exists. A small drift is a REAL reading ("steady"), not
  // calibrating — the card should show it rather than greying out.
  if (Math.abs(shortBy) < 0.5) {
    return {
      headline: "Your sleep's been steady.",
      meta: "Across the last three weeks your sleep has sat close to your own normal — no debt or surplus worth flagging.",
      primary: { metric: "sleep", deltaHours: 0 },
      steady: true,
    };
  }

  const recovery = recoveryProfile(history, biometricTrends, ouraMap);

  const headline = shortBy > 0
    ? "You've been running on a little less sleep lately."
    : "You've been getting more sleep than usual.";

  const hours = (Math.abs(shortBy)).toFixed(1);
  const driftPhrase = shortBy > 0
    ? `About ${hours} hours short of what's normal for you each night, built up over the last three weeks`
    : `About ${hours} hours more than usual each night, three weeks running`;

  const recoveryPhrase = recovery
    ? `when a heavy day comes, you've tended to be back to your own usual within about ${recovery.daysToBaseline} day${recovery.daysToBaseline === 1 ? "" : "s"}`
    : null;
  const meta = recoveryPhrase
    ? `${driftPhrase}. The reassuring part: ${recoveryPhrase}.`
    : `${driftPhrase}. Worth knowing before it starts to show.`;

  return {
    headline,
    meta,
    primary: { metric: "sleep", deltaHours: -shortBy },
    recovery,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Streaks — consecutive seeded days (any entry that covers the day).

export function streakStats(history, extraWritingDates = []) {
  // A "writing day" = the user produced text Ori can read, whether or not
  // they tapped Read on that day. We union analyzed history (cpi-v2-data)
  // with any extra dates the caller pulls from the journal repo
  // (cpi_journal_repo). Without this merge, batch-imported journals show
  // 30+ readings in the You tab but Streaks reads "1" because only today
  // got a fresh Claude run — see GitHub thread on May-19 phone session.
  const dates = new Set();
  for (const e of history || []) {
    const d = entryDate(e);
    if (!d) continue;
    dates.add(ymdISO(d));
  }
  for (const ymd of extraWritingDates) {
    if (typeof ymd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) dates.add(ymd);
  }
  let current = 0;
  const today = new Date();
  for (let k = 0; k < 400; k++) {
    const d = new Date(today); d.setDate(today.getDate() - k);
    if (dates.has(ymdISO(d))) current++;
    else if (k === 0) continue;
    else break;
  }
  const sorted = [...dates].sort();
  let longest = 0, run = 0, prev = null;
  for (const ymd of sorted) {
    const cur = new Date(ymd);
    if (prev && (cur.getTime() - prev.getTime()) === 86400000) run++;
    else run = 1;
    if (run > longest) longest = run;
    prev = cur;
  }
  const ninetyAgo = new Date(); ninetyAgo.setDate(today.getDate() - 90);
  const recent = sorted.filter(s => new Date(s) >= ninetyAgo);
  let longest90 = 0, run90 = 0, prev90 = null;
  for (const ymd of recent) {
    const cur = new Date(ymd);
    if (prev90 && (cur.getTime() - prev90.getTime()) === 86400000) run90++;
    else run90 = 1;
    if (run90 > longest90) longest90 = run90;
    prev90 = cur;
  }

  if (current === 0) {
    return {
      current: 0, longest, longest90,
      headline: "Plant your first seed and the rhythm begins.",
      meta: "Streaks show up here once you start writing.",
      writingDays: [...dates],
    };
  }
  // Headline: gentler grammar for one-day streaks ("1 day in a row" reads
  // weird). When current === 1 but the user has prior writing, "First day
  // planted" is wrong — they're not a first-time user, they're resuming
  // after a gap. Acknowledge that.
  const totalDaysWritten = dates.size;
  const headline = current === 1
    ? (totalDaysWritten > 1
        ? "Picking back up. Today's a new stretch."
        : "First day planted.")
    : `${current} days of writing in a row.`;

  // Meta. The structure here was previously buggy: `current === longest90`
  // fired the "Just matched your season best" branch even for first-time
  // users where their current run IS their only run — making the app
  // congratulate someone on matching a "previous best" that never existed.
  // Fix: when current is the longest run (tied with or beating `longest`),
  // never compare backward — this IS the user's best. Backward comparisons
  // only make sense when there was a separate prior stretch to compare to.
  let meta;
  if (current >= longest) {
    // Current run is the user's longest ever (or tied with it). No prior
    // achievement to point at. Scale the celebration to the run's length.
    if (current === 1) {
      meta = totalDaysWritten > 1
        ? `You've written ${totalDaysWritten} days total. Plant another tomorrow and a new streak begins.`
        : "Plant another tomorrow and the rhythm starts.";
    } else if (current < 7) {
      meta = "The rhythm's just beginning.";
    } else if (current < 30) {
      meta = "Your longest stretch yet.";
    } else {
      meta = `Your longest stretch yet — ${current} days running.`;
    }
  } else if (current > longest90) {
    // Past this season's best, but the all-time stretch was longer.
    const past = current - longest90;
    const fromAllTime = longest - current;
    meta = `${past} day${past === 1 ? "" : "s"} past your season best; ${fromAllTime} from your all-time stretch of ${longest}.`;
  } else if (current === longest90) {
    // Tied with this season's best, all-time was longer.
    meta = `Just matched your season best — your all-time stretch was ${longest}.`;
  } else {
    // Behind this season's best.
    const behind = longest90 - current;
    meta = `${behind} day${behind === 1 ? "" : "s"} from tying your season best of ${longest90}.`;
  }
  return { current, longest, longest90, headline, meta, writingDays: [...dates] };
}

// ────────────────────────────────────────────────────────────────────────
// Weather — mood-energy quadrant from Psi (valence) + E0/activity (energy).

export function weatherFinding(history, biometricTrends, windowDays = 30) {
  // Collect every day with valid psi/E0 across the full history, then split
  // into "recent" (the user's last N unique writing days) and "prior"
  // (everything older than that). Previously this was a CALENDAR window
  // (last 30 days), which locked out anyone who batch-imported old data —
  // 79 readings dated months ago counted for zero because none fell inside
  // Date.now() − 30d. Sliding through the user's actual writing means
  // Weather lights up the moment they have 14 days of writing total,
  // whenever that writing happened.
  const allDays = [];
  for (const e of history || []) {
    const date = entryDate(e);
    if (!date) continue;
    const psi = typeof e?.params?.psi === "number" ? e.params.psi : null;
    const eVal = typeof e?.E0 === "number" ? e.E0 : (typeof e?.activityScore === "number" ? e.activityScore / 100 : null);
    if (psi == null || eVal == null) continue;
    const x = Math.max(0, Math.min(1, (psi - 0.5) / 1.0));
    const y = Math.max(0, Math.min(1, eVal));
    allDays.push({ x, y, date });
  }
  // Sliding window: keep one row per calendar day (newest wins), then
  // take the user's most-recent N unique writing days as "recent" and
  // the rest as "prior" for drift detection.
  const byYmd = new Map();
  for (const row of allDays) {
    const key = ymdISO(row.date);
    if (!byYmd.has(key)) byYmd.set(key, row);
    else if (row.date.getTime() > byYmd.get(key).date.getTime()) byYmd.set(key, row);
  }
  const sortedRows = [...byYmd.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
  const days = sortedRows.slice(0, windowDays).sort((a, b) => a.date.getTime() - b.date.getTime());
  const prior = sortedRows.slice(windowDays);

  if (days.length < 14) {
    return {
      calibrating: true,
      headline: "Weather still gathering.",
      meta: days.length > 0
        ? `Two more weeks of writing and your emotional weather comes into view. ${days.length} day${days.length === 1 ? "" : "s"} so far.`
        : "Two more weeks of writing and your emotional weather comes into view.",
      days: [],
    };
  }
  const counts = { tl: 0, tr: 0, bl: 0, br: 0 };
  for (const d of days) {
    const top = d.y >= 0.5, right = d.x >= 0.5;
    if (top && right) counts.tr++;
    else if (top) counts.tl++;
    else if (right) counts.br++;
    else counts.bl++;
  }
  const sortedQuadrants = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const modal = sortedQuadrants[0][0];
  const modalShare = counts[modal] / days.length;
  const runnerUpShare = (sortedQuadrants[1]?.[1] ?? 0) / days.length;
  const today = days[days.length - 1];
  const quadrantLabel = {
    tr: "more energy, lighter days — excited and sharp",
    tl: "more energy, heavier days — sharp and pressed",
    br: "less energy, lighter days — calm and curious",
    bl: "less energy, heavier days — tired and heavy",
  };
  const quadrantHeadline = {
    tr: "This month has been mostly excited and sharp.",
    tl: "This month has been mostly sharp and pressed.",
    br: "This month has been mostly calm and curious.",
    bl: "This month has been mostly heavy and tired.",
  };
  const shortLabel = {
    tr: "excited and sharp",
    tl: "sharp and pressed",
    br: "calm and curious",
    bl: "heavy and tired",
  };
  // Drift mode: if there are at least 14 days of prior history, compare
  // recent average valence (x) and energy (y) to the prior window. A shift
  // of ≥0.10 on either axis is a real lift or dip month-over-month — much
  // more user-specific than naming whichever quadrant happens to be largest
  // right now. Pick the bigger of the two shifts when both move.
  if (prior.length >= 14) {
    const recentX = mean(days.map(d => d.x));
    const recentY = mean(days.map(d => d.y));
    const priorX = mean(prior.map(d => d.x));
    const priorY = mean(prior.map(d => d.y));
    const xShift = recentX - priorX;
    const yShift = recentY - priorY;
    const xMag = Math.abs(xShift), yMag = Math.abs(yShift);
    if (xMag >= 0.10 || yMag >= 0.10) {
      const useValence = xMag >= yMag;
      const shift = useValence ? xShift : yShift;
      const headline = useValence
        ? (shift > 0
          ? "Your days have lightened up this month."
          : "Your days have gotten heavier this month.")
        : (shift > 0
          ? "You've had more energy this month."
          : "Your energy has dipped this month.");
      // No "points" — that magnitude is a raw internal valence/energy axis delta.
      // The ≥0.10 gate already guarantees the shift is real, so the adjective carries it.
      const meta = useValence
        ? (shift > 0
          ? `Compared to the months before, this stretch leans noticeably more positive — toward the lighter side.`
          : `Compared to the months before, this stretch leans noticeably heavier — toward the weightier side.`)
        : (shift > 0
          ? `You've been carrying more energy this month than the prior stretch.`
          : `Your energy this month sits below the prior stretch — lower than what's been normal for you.`);
      return {
        headline,
        meta,
        days,
        today,
        modalQuadrant: modal,
        modalShare,
        drift: {
          axis: useValence ? "valence" : "energy",
          shift,
          recentMean: useValence ? recentX : recentY,
          priorMean: useValence ? priorX : priorY,
        },
      };
    }
  }

  // Modal-share gate: a single quadrant winning 30% of days isn't really
  // "the month's weather" — it's just the largest of four near-equal piles.
  // We require BOTH (a) the modal owns ≥40% of days and (b) it leads the
  // runner-up by ≥15pp. The margin check matters because noise over 180
  // days has SE ~3.5pp per quadrant; 15pp gap is the ~99% noise tail.
  // Below those, surface a mixed-weather reading.
  if (modalShare < 0.4 || (modalShare - runnerUpShare) < 0.15) {
    const pct = (k) => Math.round((counts[k] / days.length) * 100);
    return {
      headline: "Your weather this month has been mixed.",
      meta: `No single feeling owned the month — roughly ${pct("tr")}% excited and sharp, ${pct("tl")}% sharp and pressed, ${pct("br")}% calm and curious, ${pct("bl")}% heavy and tired. Worth knowing that no one mood ran the show.`,
      days,
      today,
      modalQuadrant: modal,
      modalShare,
      mixed: true,
    };
  }
  return {
    headline: quadrantHeadline[modal],
    meta: `About ${Math.round(modalShare * 100)}% of your days leaned ${shortLabel[modal]} — clearer than the alternatives. That's a quiet shape worth noticing.`,
    days,
    today,
    modalQuadrant: modal,
    modalShare,
  };
}
