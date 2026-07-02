// Cross-day pattern templates. Each is a pure function over (history, ouraMap).
// Returns a Thread object or null. pickActiveThread() returns the first
// non-null template (declaration order).
//
// A Thread is: { id, headline, prose, examples: [{ date, summary }] }.
//
// Design notes:
//   · Thresholds are user-relative (percentile of the user's OWN distribution)
//     rather than absolute. A user whose HCPI rarely dips below 0.30 still
//     has "low days" — they're the bottom of their own range, not the bottom
//     of an absolute scale.
//   · Sleep lives on the Oura map (keyed by YYYY-MM-DD) as `totalSleepMin`.
//     Not on history entries. (We had this wrong before.)
//   · Drivers and HCPI live on history entries.
//   · A template needs ≥3 historical examples to render. Below that the
//     pattern isn't reliable enough to call a thread.

import { ymdISO } from "./dates.js";
// React-free source (LetterReading.jsx just re-exports this) so this pure
// module stays importable without JSX — node-runnable evals/tests included.
import { PARTS_LIB } from "./parts-lib.js";

function partName(id) {
  return PARTS_LIB?.[id]?.name || "one part of you";
}

function entryDate(e) {
  const v = e?.date;
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(s.length - 1, Math.floor(p * (s.length - 1))));
  return s[idx];
}

function buildHistoryByYmd(history) {
  const map = new Map();
  for (const e of history || []) {
    const d = entryDate(e);
    if (!d) continue;
    map.set(ymdISO(d), e);
  }
  return map;
}

function buildSleepByYmd(ouraMap) {
  const map = new Map();
  if (!ouraMap) return map;
  for (const ymd of Object.keys(ouraMap)) {
    const min = ouraMap[ymd]?.totalSleepMin;
    if (typeof min === "number" && min > 60) map.set(ymd, min);
  }
  return map;
}

// ── Significance gates ──────────────────────────────────────────────────
// A Thread makes a correlational claim ("X tends to follow Y"), so it must
// clear a real significance test — not just an effect-size threshold — before
// it speaks. Otherwise a 0.06 gap across 4 coincidental days reads as a
// confident pattern. This is the same discipline the letters/inbox alerts use
// (there: a Wilson CI on a proportion); Threads mostly compares MEANS, so:
//   · mean-vs-mean  → Welch's two-sample t (unequal variance)
//   · sample-vs-own-baseline → one-sample t
//   · rate-vs-rate  → two-proportion z
// all two-tailed at alpha = 0.05. The effect-size floors stay, so a thread
// must be BOTH statistically real AND practically meaningful.
function tmean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
function sampVar(a, m) {
  if (a.length < 2) return 0;
  return a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1);
}
// Critical |t| at alpha=0.05 two-tailed by (rounded-down) df. Small-df rows are
// much stricter — the whole point when a group has as few as 4 observations.
const T_CRIT_05 = [[1, 12.71], [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571], [6, 2.447], [7, 2.365], [8, 2.306], [10, 2.228], [12, 2.179], [15, 2.131], [20, 2.086], [30, 2.042], [60, 2.0]];
function tCrit05(df) {
  if (!isFinite(df) || df < 1) return Infinity;
  for (const [d, c] of T_CRIT_05) if (df <= d) return c;
  return 1.96;
}
// Welch's two-sample t. True iff the two groups' means differ significantly.
function welchSig(a, b) {
  if (a.length < 2 || b.length < 2) return false;
  const ma = tmean(a), mb = tmean(b);
  if (ma === mb) return false;
  const sa = sampVar(a, ma) / a.length, sb = sampVar(b, mb) / b.length;
  const denom = Math.sqrt(sa + sb);
  if (denom === 0) return true; // both groups constant, means differ → perfect separation
  const t = (ma - mb) / denom;
  const df = (sa + sb) ** 2 / ((sa * sa) / (a.length - 1) + (sb * sb) / (b.length - 1));
  return Math.abs(t) >= tCrit05(df);
}
// One-sample t: is the sample mean significantly different from a baseline?
function oneSampleSig(a, mu) {
  if (a.length < 2) return false;
  const m = tmean(a);
  if (m === mu) return false;
  const se = Math.sqrt(sampVar(a, m) / a.length);
  if (se === 0) return true; // constant sample that differs from the baseline
  return Math.abs((m - mu) / se) >= tCrit05(a.length - 1);
}
// Two-proportion z (pooled). True iff the two rates differ significantly.
function twoPropSig(x1, n1, x2, n2) {
  if (n1 < 1 || n2 < 1) return false;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!(se > 0)) return false;
  return Math.abs((x1 / n1 - x2 / n2) / se) >= 1.96;
}

// ────────────────────────────────────────────────────────────────────────
// Template 1: heavy Mondays bleed into Tuesday mornings.
// Uses the user's own social driver P75 + HCPI P40 — much more likely
// to fire than absolute thresholds.

function socialMondayBleed(history) {
  const socialVals = (history || []).map(e => e?.drivers?.social).filter(v => typeof v === "number");
  const hcpiVals = (history || []).map(e => e?.hcpi).filter(v => typeof v === "number");
  if (socialVals.length < 7 || hcpiVals.length < 7) return null;

  // Core sanity check: Mondays must actually carry more social load than the
  // rest of the week, otherwise the "bleed" claim is meaningless. Eval
  // surfaced that the template was firing for archetypes where social was
  // distributed evenly across weekdays (steady users, burnout cycles, slow
  // drifts) — the user's top-tail Mondays passed P85 just by being in the
  // top 15% of an evenly-distributed series.
  const mondaySocials = [];
  const otherSocials = [];
  for (const e of history || []) {
    const d = entryDate(e);
    if (!d) continue;
    const s = e?.drivers?.social;
    if (typeof s !== "number") continue;
    if (d.getDay() === 1) mondaySocials.push(s);
    else otherSocials.push(s);
  }
  if (mondaySocials.length < 4 || otherSocials.length < 20) return null;
  const mondayMean = mondaySocials.reduce((s, v) => s + v, 0) / mondaySocials.length;
  const otherMean = otherSocials.reduce((s, v) => s + v, 0) / otherSocials.length;
  if (mondayMean - otherMean < 1.5) return null;
  // Significance: is Monday's social load really higher, not just noisily so?
  if (!welchSig(mondaySocials, otherSocials)) return null;

  // Eval showed that with P75 + P40 thresholds, pure-noise users also hit
  // 3+ examples in a 6-month window (~2.6 expected by random alone). Tighter
  // tails (P85 + P30) push the noise floor below the 3-example minimum so
  // we only call this thread when the pattern is genuinely the user's tails,
  // not their middles.
  const socialP85 = percentile(socialVals, 0.85) ?? 0;
  const hcpiP30 = percentile(hcpiVals, 0.30) ?? 0;
  const byYmd = buildHistoryByYmd(history);

  const examples = [];
  for (const e of history || []) {
    const d = entryDate(e);
    if (!d || d.getDay() !== 1) continue; // Monday
    const sVal = e?.drivers?.social;
    if (typeof sVal !== "number" || sVal < socialP85 || sVal === 0) continue;
    const next = new Date(d); next.setDate(d.getDate() + 1);
    const tue = byYmd.get(ymdISO(next));
    if (!tue || typeof tue.hcpi !== "number" || tue.hcpi >= hcpiP30) continue;
    examples.push({ date: fmtDate(d), summary: "busy Monday, heavier Tuesday" });
    if (examples.length >= 6) break;
  }
  if (examples.length < 3) return null;
  return {
    id: "social-monday-bleed",
    headline: "Heavy Mondays seem to spill into Tuesday.",
    prose: `When Monday is full of people and pressure, Tuesday tends to land in your tougher half of days. Seen ${examples.length} times.`,
    examples: examples.slice(0, 3),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Template 2: short sleep precedes a heavier day.
// Sleep comes from the Oura map. Compares each night to the user's own
// sleep distribution (P25 = "short for you") and checks if the next day's
// HCPI falls below their median.

function sleepDebtBeforeHeavy(history, ouraMap) {
  const sleepByYmd = buildSleepByYmd(ouraMap);
  if (sleepByYmd.size < 7) return null;
  const sleepVals = [...sleepByYmd.values()];
  const sleepP25 = percentile(sleepVals, 0.25);
  const sleepP50 = percentile(sleepVals, 0.50);
  const hcpiVals = (history || []).map(e => e?.hcpi).filter(v => typeof v === "number");
  if (hcpiVals.length < 7) return null;
  const hcpiP50 = percentile(hcpiVals, 0.50);
  const byYmd = buildHistoryByYmd(history);

  // Effect-size gate: a quantile-based filter (sleep ≤ P25 → HCPI ≤ P50)
  // ALWAYS fires by construction on enough days, even on pure noise. The
  // real question is whether short-sleep nights actually precede *worse*
  // days than long-sleep nights do. Compare the two groups' mean next-day
  // HCPI; only call the thread when the gap is real (≥0.06).
  const shortNextHcpi = [];
  const longNextHcpi = [];
  for (const [ymd, sleepMin] of sleepByYmd.entries()) {
    const [y, m, dd] = ymd.split("-").map(Number);
    const nextDay = new Date(y, m - 1, dd + 1);
    const nextE = byYmd.get(ymdISO(nextDay));
    if (!nextE || typeof nextE.hcpi !== "number") continue;
    if (sleepMin <= sleepP25) shortNextHcpi.push(nextE.hcpi);
    else if (sleepMin >= sleepP50) longNextHcpi.push(nextE.hcpi);
  }
  if (shortNextHcpi.length < 4 || longNextHcpi.length < 4) return null;
  const shortMean = shortNextHcpi.reduce((s, v) => s + v, 0) / shortNextHcpi.length;
  const longMean = longNextHcpi.reduce((s, v) => s + v, 0) / longNextHcpi.length;
  if (longMean - shortMean < 0.06) return null;
  // Significance: do short-sleep nights really precede heavier days?
  if (!welchSig(shortNextHcpi, longNextHcpi)) return null;

  const examples = [];
  for (const [ymd, sleepMin] of sleepByYmd.entries()) {
    if (sleepMin > sleepP25) continue; // not a short-for-you night
    const [y, m, dd] = ymd.split("-").map(Number);
    const nextDay = new Date(y, m - 1, dd + 1);
    const nextE = byYmd.get(ymdISO(nextDay));
    if (!nextE || typeof nextE.hcpi !== "number" || nextE.hcpi >= hcpiP50) continue;
    examples.push({ date: fmtDate(new Date(y, m - 1, dd)), summary: `short sleep (${(sleepMin / 60).toFixed(1)}h), heavier day after` });
    if (examples.length >= 6) break;
  }
  if (examples.length < 3) return null;
  return {
    id: "sleep-debt-before-heavy",
    headline: "Short sleep tends to land you in a heavier day.",
    prose: `On nights when sleep dips below your usual, the next day tends to feel harder than average. Seen ${examples.length} times.`,
    examples: examples.slice(0, 3),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Template 3: a specific protector appears more often after rough sleep.

function protectorAfterPoorSleep(history, ouraMap) {
  const sleepByYmd = buildSleepByYmd(ouraMap);
  if (sleepByYmd.size < 7) return null;
  const sleepVals = [...sleepByYmd.values()];
  const sleepP25 = percentile(sleepVals, 0.25);
  const sleepP50 = percentile(sleepVals, 0.50);

  // Count part appearances on days after a SHORT-sleep night vs. after a
  // LONG-sleep night. The thread should only fire if some part appears
  // noticeably MORE after short sleep than after long sleep — otherwise
  // we're just naming whatever part happens to be most common overall.
  const shortCounts = {};
  const longCounts = {};
  let shortDays = 0, longDays = 0;
  for (const e of history || []) {
    const d = entryDate(e);
    if (!d) continue;
    const prev = new Date(d); prev.setDate(d.getDate() - 1);
    const sleepPrev = sleepByYmd.get(ymdISO(prev));
    if (typeof sleepPrev !== "number") continue;
    const parts = Array.isArray(e?.letterParts) ? e.letterParts : [];
    if (sleepPrev <= sleepP25) {
      shortDays++;
      for (const p of parts) if (p?.id) shortCounts[p.id] = (shortCounts[p.id] || 0) + 1;
    } else if (sleepPrev >= sleepP50) {
      longDays++;
      for (const p of parts) if (p?.id) longCounts[p.id] = (longCounts[p.id] || 0) + 1;
    }
  }
  if (shortDays < 4 || longDays < 4) return null;
  let top = null, topVal = 0, topGap = 0;
  for (const id of Object.keys(shortCounts)) {
    const v = shortCounts[id];
    const shortRate = v / shortDays;
    const longRate = (longCounts[id] || 0) / longDays;
    const gap = shortRate - longRate;
    if (gap > topGap && v >= 3) { top = id; topVal = v; topGap = gap; }
  }
  // Require a 20-percentage-point appearance gap — under noise a part
  // appears at ~the same rate after short and long sleep, so the gap stays
  // near zero. Real protector effect lifts the post-short-sleep rate.
  if (!top || topGap < 0.20) return null;
  // Significance: is the top part's post-short-sleep rate really higher?
  if (!twoPropSig(topVal, shortDays, longCounts[top] || 0, longDays)) return null;

  // Gather example dates where the top part appeared after rough sleep.
  // Each example shows the actual sleep hours so three rows aren't visually
  // identical the way "after a short night" × 3 was.
  const examples = [];
  for (const e of history || []) {
    const d = entryDate(e);
    if (!d) continue;
    const prev = new Date(d); prev.setDate(d.getDate() - 1);
    const sleepPrev = sleepByYmd.get(ymdISO(prev));
    if (typeof sleepPrev !== "number" || sleepPrev > sleepP25) continue;
    const parts = Array.isArray(e?.letterParts) ? e.letterParts : [];
    if (!parts.some(p => p?.id === top)) continue;
    examples.push({ date: fmtDate(d), summary: `${(sleepPrev / 60).toFixed(1)}h sleep the night before` });
    if (examples.length >= 3) break;
  }
  const name = partName(top);
  return {
    id: "protector-after-poor-sleep",
    headline: `${name.charAt(0).toUpperCase() + name.slice(1)} tends to show up after rough sleep.`,
    prose: `On the days right after a short night for you, ${name} tends to step forward. Seen ${topVal} times.`,
    examples,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Template 4: recovery after a low-tide day.
// A "low day" is now defined as the user's own bottom-quartile HCPI.

function recoveryAfterLowTide(history) {
  const hcpiVals = (history || []).map(e => e?.hcpi).filter(v => typeof v === "number");
  if (hcpiVals.length < 7) return null;
  const hcpiP25 = percentile(hcpiVals, 0.25);
  const overallMean = hcpiVals.reduce((s, v) => s + v, 0) / hcpiVals.length;
  const byYmd = buildHistoryByYmd(history);

  // Effect-size gate: under noise alone, the days after a low day rebound
  // simply by regression to the mean (their average equals the overall
  // mean). A real "you bounce back" insight requires the post-low days to
  // *exceed* the overall mean by a meaningful amount — the user is actually
  // returning to a baseline they own, not just sampling from variance.
  const postLowMeans = [];
  for (const e of history || []) {
    const d = entryDate(e);
    if (!d || typeof e?.hcpi !== "number" || e.hcpi >= hcpiP25) continue;
    const next3 = [];
    for (let k = 1; k <= 3; k++) {
      const next = new Date(d); next.setDate(d.getDate() + k);
      const nE = byYmd.get(ymdISO(next));
      if (nE && typeof nE.hcpi === "number") next3.push(nE.hcpi);
    }
    if (next3.length) postLowMeans.push(next3.reduce((s, v) => s + v, 0) / next3.length);
  }
  if (postLowMeans.length < 4) return null;
  const postLowAvg = postLowMeans.reduce((s, v) => s + v, 0) / postLowMeans.length;
  if (postLowAvg - overallMean < 0.06) return null;
  // Significance: do post-low days really sit above the user's own baseline?
  if (!oneSampleSig(postLowMeans, overallMean)) return null;

  const examples = [];
  for (const e of history || []) {
    const d = entryDate(e);
    if (!d || typeof e?.hcpi !== "number" || e.hcpi >= hcpiP25) continue;
    let foundRecovery = false;
    for (let k = 1; k <= 3; k++) {
      const next = new Date(d); next.setDate(d.getDate() + k);
      const nE = byYmd.get(ymdISO(next));
      if (nE && typeof nE.hcpi === "number" && nE.hcpi >= e.hcpi + 0.10) { foundRecovery = true; break; }
    }
    if (foundRecovery) examples.push({ date: fmtDate(d), summary: "tough day, lifted within 72h" });
    if (examples.length >= 6) break;
  }
  if (examples.length < 3) return null;
  return {
    id: "recovery-after-low-tide",
    headline: "You bounce back from the heavy days.",
    prose: `After your toughest days, the next two or three days tend to lift. Seen ${examples.length} times.`,
    examples: examples.slice(0, 3),
  };
}

// ────────────────────────────────────────────────────────────────────────
// NOTE: there is deliberately NO weekday-shape template here.
// "Your strongest weekday" is the Rhythms tile's lens — Rhythms always renders
// the per-weekday bars with the peak day lit — so a weekday "thread" only ever
// duplicated (and sometimes contradicted) it, which is exactly what users saw.
// A cross-day THREAD makes a causal-shaped claim ("X tends to follow Y"); a
// static weekday average isn't one. So weekday strength lives in Rhythms alone.

// ────────────────────────────────────────────────────────────────────────
// Entry point — first non-null wins. Within a pass, order matters: more
// specific observations come first; the weekday-shape fallback is last
// because it's the most likely to fire (and the least precise).
//
// Each template is tagged with whether its trigger is SLEEP. When the Drifts
// tile is already narrating a sleep reading, the caller passes avoidSleep so
// Threads prefers a thread that crosses days some OTHER way — the tab stops
// telling the same sleep story twice. Sleep templates stay as a fallback: a
// real sleep thread still beats a false "nothing crossing days yet".
//
// (There is no weekday template — see the note above; weekday strength is the
// Rhythms tile's lens, never a thread.) When nothing below fires, the Threads
// TILE hides entirely rather than showing a filler card — see PatternTiles.

const TEMPLATES = [
  { fn: socialMondayBleed, sleep: false },
  { fn: sleepDebtBeforeHeavy, sleep: true },
  { fn: protectorAfterPoorSleep, sleep: true },
  { fn: recoveryAfterLowTide, sleep: false },
];

export function pickActiveThread(history, biometricTrends, ouraMap, opts = {}) {
  // Array.sort is stable, so non-sleep-first still keeps each group's order.
  const ordered = opts.avoidSleep
    ? [...TEMPLATES].sort((a, b) => Number(a.sleep) - Number(b.sleep))
    : TEMPLATES;
  for (const t of ordered) {
    const result = t.fn(history, ouraMap);
    if (result) return result;
  }
  return {
    calibrating: true,
    headline: "Nothing crossing days yet.",
    prose: "These appear after a few weeks, when one day's shape leads to another reliably enough to call it a thread.",
    examples: [],
  };
}
