// Honesty audit — the on-screen claim inventory.
//
// Every numeric or qualitative claim the app shows the user is listed
// here, tagged by whether it's auditable in ≤1 tap.
//
//   "yes"     — there's an explicit info-dot, methodology drawer, or
//               equivalent surface that shows source data + math +
//               uncertainty + threshold/rule.
//   "partial" — some of the four is visible (e.g. hover-title), but not
//               a full one-tap audit path.
//   "no"      — the claim is shown without any explanation surface.
//
// This file is the source of truth for what the app claims. It's
// public — anyone reading the source can see exactly what we say.
//
// The HonestyAuditPanel in Settings reads this list and shows the
// current coverage number. To move the number, ship info-dots/method
// drawers on items still marked "partial" or "no" and update their
// status here.

// Each claim with auditable:"yes" carries a `proof` field — the file
// path and exact strings that must appear in the source to prove the
// methodology surface is wired up. The scripts/audit-honesty.mjs
// script reads each file and asserts every `contains` string is
// present. Build fails if any threshold disclosure goes missing.
// (Not adversarial against intentional rewording — but a clean
// regression net against silent removal.)

export const HONESTY_CLAIMS = [
  // ── You tab — primary surface ────────────────────────────────────
  {
    id: "you.headline.threeAct",
    surface: "You tab",
    claim: "Three-act narrative headline (“Above your typical reserves, into a heavier day, you came through strong.”)",
    auditable: "yes",
    why: "Info-dot next to the headline reveals the ±4 delta-vs-baseline mapping for each state word.",
    proof: {
      file: "src/CognitiveProfile.jsx",
      contains: ["headlineInfoOpen", "more than 4 points over your typical", "more than 4 points under your typical", "±4 is the band we treat as on par"],
    },
  },
  {
    id: "you.scoreCircles.delta",
    surface: "You tab",
    claim: "Reserves / Demands / Form score circles with “+N vs typical” delta",
    auditable: "yes",
    why: "Bucket modal names the ±4 on-par rule directly under the score band; Reserves circle now reads from today's sleep alone; Form circle reads from today's WHO-5 alone.",
    proof: {
      file: "src/CognitiveProfile.jsx",
      contains: [
        "The vertical mark is your typical", "within <b>±4 points</b>",
        "Reserves headline score = today's sleep restoration alone",
        "Form headline score = today's WHO-5 wellbeing alone",
      ],
    },
  },
  {
    id: "you.chartCard.hero",
    surface: "You tab → chart card",
    claim: "Hero value + “N-day average X · usually X–Y” summary line",
    auditable: "yes",
    why: "Info-dot opens the methodology block on each card.",
    proof: {
      file: "src/ChartCard.jsx",
      contains: ["setShowInfo", "{methodology && <div", "showInfo &&"],
    },
  },
  {
    id: "you.chartCard.firstThirty",
    surface: "You tab → chart card",
    claim: "FIRST 30 anchor line (frozen first-30-days median)",
    auditable: "yes",
    why: "Methodology drawer auto-includes the FIRST 30 anchor explanation whenever the line renders.",
    proof: {
      file: "src/ChartCard.jsx",
      contains: ["The dashed \"FIRST 30\" line", "median of your earliest 30 days, frozen"],
    },
  },
  {
    id: "you.chartCard.driftCaption",
    surface: "You tab → chart card",
    claim: "“Currently N% above/below your first 30 days” caption",
    auditable: "yes",
    why: "Methodology drawer auto-includes the ±5% on-par threshold explanation alongside the FIRST 30 block.",
    proof: {
      file: "src/ChartCard.jsx",
      contains: ["On par with where you started", "within ±5% of that anchor"],
    },
  },
  {
    id: "you.chartCard.usuallyBand",
    surface: "You tab → chart card",
    claim: "“Usually” 15–85 percentile band (neutral gray fill)",
    auditable: "yes",
    why: "Methodology drawer auto-includes the 15th–85th percentile band explanation whenever the band renders.",
    proof: {
      file: "src/ChartCard.jsx",
      contains: ["The gray band", "15th–85th percentile", "middle 70% of your readings"],
    },
  },
  {
    id: "you.worthNoticing",
    surface: "You tab",
    claim: "“Worth noticing” body × words divergence reflection card",
    auditable: "yes",
    why: "Info-dot on the card exposes the ±0.10 divergence rule and names it as a reflection prompt, not a measurement claim.",
    proof: {
      file: "src/CognitiveProfile.jsx",
      contains: ["worthInfoOpen", "at least <b>0.10</b> away from neutral", "reflection prompt, not a measurement claim"],
    },
  },
  {
    id: "you.patterns.classifier",
    surface: "You tab → Your patterns drawer",
    claim: "Four-tier part classification (Stable / Borderline / Coming & going / Still forming)",
    auditable: "yes",
    why: "How-this-works drawer now spells out the 0.70 / 0.30 thresholds and the Wilson 95% CI rule for the borderline tier explicitly.",
    proof: {
      file: "src/CognitiveProfile.jsx",
      contains: ["recurs on <b>70%+</b>", "<b>30%–70%</b>", "Wilson 95%", "confidence interval still straddles it"],
    },
  },
  {
    id: "you.formBucket.steadiness",
    surface: "You tab → Form bucket → Day-to-day steadiness card",
    claim: "Day-to-day steadiness derived from WHO-5 variance over the last 30 days",
    auditable: "yes",
    why: "Replaces variance-of-HCPI with variance-of-WHO-5 (Topp 2015). Gate ≥7 daily check-ins; mapping SD 5→1.0, SD 25→0.0 documented in source.",
    proof: {
      file: "src/CognitiveProfile.jsx",
      contains: ["recentWho5(30)", "who5Stats.n >= 7", "(who5Stats.std - 5) / 20", "Standard deviation of your daily check-in scores"],
    },
  },
  {
    id: "letter.narrative",
    surface: "Letter view → ReadingBlockV5 templated closer + ReservesTileV5 tile",
    claim: "Reserve-state language (\"reserves are full / steady / thinner\") and the Reserves tile tier (Low tide / Drifting / Steady / Peak) read from today's WHO-5 score via Topp 2015 bands",
    auditable: "yes",
    why: "HCPI no longer drives any user-visible threshold branch in the Letter view. h.HCPI keeps flowing to the LLM prompt as engine context (rich generation), but the templated-fallback closer and the ReservesTile tier read from WHO-5.",
    proof: {
      file: "src/Analyze.jsx",
      contains: [
        "wellbeingHigh    = who5Score != null && who5Score >= 73",
        "wellbeingTypical = who5Score != null && who5Score >= 51 && who5Score < 73",
        "wellbeingLow     = who5Score != null && who5Score < 51",
        "instead of h.HCPI",
        "Topp 2015 bands",
      ],
    },
  },
  {
    id: "letter.baroMeter",
    surface: "Letter view → BaroMeter (SignalCard)",
    claim: "Today's wellbeing score (0–100) on the published Topp four-band scale",
    auditable: "yes",
    why: "BaroMeter reads from today's WHO-5 score; bands are the published Topp 2015 cutoffs (≤28 Low / 29–50 Below / 51–72 Typical / ≥73 Optimal). HCPI no longer renders here.",
    proof: {
      file: "src/Analyze.jsx",
      contains: ["TOPP_BANDS", "Topp 2015 published bands", "todayWho5", "who5BandFor", "Today's wellbeing"],
    },
  },
  {
    id: "you.extendedWake",
    surface: "You tab → Extended-wake card (gated on Ha > 14)",
    claim: "Late-day heads-up at 14h awake; sleep-is-the-lever alert at 16h+, citing Dawson & Reid 1997 cognitive-impairment-vs-BAC equivalence",
    auditable: "yes",
    why: "Two-tier card rescues the one validated term from HCPI (the 16h decay wall). Single input (wake time), no composite math. Hides when Ha ≤ 14 so it only takes space when it has something to say.",
    proof: {
      file: "src/CognitiveProfile.jsx",
      contains: [
        "Dawson &amp; Reid 1997",
        "0.05% blood-alcohol",
        "function ExtendedWakeCard",
        "if (Ha <= 14) return null",
      ],
    },
  },
  {
    id: "you.who5.daily",
    surface: "You tab → Daily check-in tile + intake sheet",
    claim: "WHO-5 daily wellbeing score (0–100) with published Topp bands",
    auditable: "yes",
    why: "Five-item self-report stored daily; intake shows the live score, You-tab tile shows today's band. Cite Topp 2015 internally; user-facing copy stays plain.",
    proof: {
      file: "src/who5.js",
      contains: ["WHO5_ITEMS", "WHO5_SCALE", "WHO5_BANDS", "scoreWho5", "sum * 4", "Topp"],
    },
  },
  // letter.lensBadges retired — the MEASURED/INTERPRETIVE badge layer
  // was part of the JournalInsights card stack removed in
  // c44ca8c (chore(cpi): remove dead JournalInsights component + its
  // transitive imports). The claim is removed rather than downgraded
  // because the audit's contract is "if it's claimed, it's provable" —
  // an `auditable: "no"` entry for a feature that no longer exists
  // would be misleading. If the badges return in a future iteration,
  // re-add the claim with proof pointing at the new component path.

  // ── v2 — Demands ring ────────────────────────────────────────────
  {
    id: "v2.demands.composite",
    surface: "v2 Today / Ring detail / Day",
    claim: "Demands ring value = mean of observed per-day contributors (decisions, context shifts, calendar load)",
    auditable: "yes",
    why: "One shared lookup feeds all three surfaces; every contributor is a count from the user's writing or calendar with its cap disclosed in source, and days with no contributor stay null.",
    proof: {
      file: "src/v2/demandsData.js",
      contains: [
        "min(1, decisionCount / 15)",
        "min(1, (C − 1) / 3)",
        "days with ≥1 meeting only",
        "if (!vals.length) return null",
      ],
    },
  },
  {
    id: "v2.demands.sourceLine",
    surface: "v2 Ring detail",
    claim: "Demands source line names its sources and the own-trend-only framing",
    auditable: "yes",
    why: "The ring detail's source line discloses where the number comes from; classifyBucket keeps it on Warming up below a 10-day personal baseline.",
    proof: {
      file: "src/v2/RingDetail.jsx",
      contains: ["counted from your writing · from your calendar when connected · your own trend only"],
    },
  },
  // ── v2 — Decisions (defer-to-window) ─────────────────────────────
  {
    id: "v2.decisions.window",
    surface: "v2 Decisions → parked-decision window",
    claim: "When a parked decision resurfaces is an estimate — the user's measured wake time read through a chronotype peak-window model (interpretation), not a measured time; with no wake time it resurfaces on sight rather than inventing a clock",
    auditable: "yes",
    why: "The window blends a measured input (wearable bedtimeEnd) with an unvalidated chronotype band, so it's hedged as 'around' and the surface discloses it's a model, not a measurement. Timing is framed as an average tendency, never a guarantee, and the user can always decide now. The 'defer → better decision' premise is a reasonable extrapolation, not a tested intervention.",
    proof: {
      file: "src/v2/decisions.js",
      contains: [
        "unvalidated chronotype peak-window model",
        "never a measured time",
        "timing helps on average, it is not a guarantee",
        "not a tested intervention",
      ],
    },
  },
  {
    id: "v2.decisions.clarity",
    surface: "v2 Decisions → pre-decision clarity check",
    claim: "Pre-decision clarity check is the Karolinska Sleepiness Scale (1–9, Åkerstedt 1990) validated alertness probe; a foggy reading is permission to wait, never a verdict on judgment",
    auditable: "yes",
    why: "The probe is the published KSS, presented as alertness (not a decision-quality score); the read is interpretive and gives permission to defer rather than instructing. Stored additively on the decision; no clinical claim.",
    proof: {
      file: "src/v2/decisions.js",
      contains: [
        "Karolinska Sleepiness Scale (Åkerstedt 1990)",
        "never a decision-quality score",
        "permission to wait, never a verdict on judgment",
      ],
    },
  },
  {
    id: "v2.inbox.alerts",
    surface: "v2 Inbox",
    claim: "Behavioral alerts fire only when the Wilson 95% interval clears the disclosed line — never on a point estimate",
    auditable: "yes",
    why: "Each alert names its share-of-days source and the interval bound that gated it; the eval suite (scripts/eval-inbox-alerts.mjs) pins the thresholds in the build's audit step.",
    proof: {
      file: "src/v2/inboxAlerts.js",
      contains: [
        "STABLE_LINE = 0.70",
        "MAJORITY_LINE = 0.50",
        "wilsonCI",
        "Wilson 95% lower bound",
      ],
    },
  },
  {
    id: "v2.inbox.untended",
    surface: "v2 Inbox + Part detail",
    claim: "A part is flagged as “keeps showing up” only when it clears the SAME Wilson 95% recurrence gate as part-stable AND has never been reflected on — surfaced as an invitation to tend it, never a read on the person",
    auditable: "yes",
    why: "The tending nudge (Inbox card + PartDetail line) rests on partClearsRecurrence (the same Wilson-CI lower-bound-clears-the-line gate the patterns drawer uses) plus the local fact of zero validated acknowledgments; its source copy frames it as an invitation, not a measurement, and the eval suite (scripts/eval-inbox-alerts.mjs) pins the gate.",
    proof: {
      file: "src/v2/inboxAlerts.js",
      contains: [
        "partClearsRecurrence",
        "part-untended:",
        "haven't sat with it yet",
        "an invitation, never a read on how you're doing",
      ],
    },
  },
  {
    id: "v2.letter.gate",
    surface: "v2 nightly letter",
    claim: "Letters are validated before display — readable shape, no clinical/diagnostic language, resolvable part references",
    auditable: "yes",
    why: "letterEngine runs every candidate through validateLetter and fails closed (banner stays on 'tonight') rather than show an unvetted letter; the eval suite (scripts/eval-letter-v2.mjs) runs in the build's audit step.",
    proof: {
      file: "src/v2/letterGate.js",
      contains: [
        "CLINICAL_LEXICON",
        "'diagnos'",
        "'prescrib'",
        "fails closed",
        "clinical language:",
      ],
    },
  },
  {
    id: "v2.provenance.chips",
    surface: "v2 Today / Ring detail / Day / Patterns / Letter",
    claim: "Every visible metric carries an ⓘ chip naming its honesty layer, source, and method",
    auditable: "yes",
    why: "One registry (PROVENANCE) holds the disclosure per metric — surfaces pass ids, so the layer/source copy can't drift per-screen. The letter's own chip names it L4 interpretive.",
    proof: {
      file: "src/v2/Provenance.jsx",
      contains: [
        "export const PROVENANCE",
        "layer: 'l1'",
        "layer: 'l2'",
        "layer: 'l3'",
        "layer: 'l4'",
        "interpretation, not measurement",
      ],
    },
  },
  {
    id: "v2.day.ringsObserved",
    surface: "v2 Day view",
    claim: "Per-day rings read observed sources only; the HCPI composite is never surfaced",
    auditable: "yes",
    why: "Day rings map to Oura sleepScore, the shared demands lookup, and that date's WHO-5 — with a dash when a source has nothing for the day.",
    proof: {
      file: "src/v2/Day.jsx",
      contains: ["never surfaced (it's engine-internal per the honesty contract)", "sleepScore", "loadWho5History"],
    },
  },
  {
    id: "v2.acknowledgment.consent",
    surface: "v2 Part detail — reflect",
    claim: "A written reflection is sent to the model only with explicit one-time consent; one-tap gestures never leave the device; explicit distress language routes to support without any model call",
    auditable: "yes",
    why: "judgeAcknowledgment asks once (needsConsent) before any send, and a deterministic distress scan short-circuits to support before the model is ever called — so a crisis is never transmitted or deepened.",
    proof: {
      file: "src/v2/acknowledgmentEngine.js",
      contains: [
        "if (!hasConsent) return { needsConsent: true };",
        "if (scanDistress(reflection)) {",
        "REFLECTION_CONSENT_KEY",
      ],
    },
  },
  {
    id: "v2.acknowledgment.axis",
    surface: "v2 Part detail — reflect",
    claim: "A validated acknowledgment is validated self-report on a separate descriptive axis (surfaced as continuity, never a count); it never moves the visit-based familiarity stage",
    auditable: "yes",
    why: "appendAcknowledgment stores validated reflections distinctly, but THANK_WEIGHT stays 0 so neither taps nor reflections advance familiarity — frequency and relationship stay separate layers (docs/PARTS_PLAN.md).",
    proof: {
      file: "src/part-history.js",
      contains: [
        "export const THANK_WEIGHT = 0;",
        "validated: validated === true,",
        "the separate descriptive axis",
      ],
    },
  },
];

export function computeCoverage(claims = HONESTY_CLAIMS) {
  let full = 0, partial = 0, missing = 0;
  for (const c of claims) {
    if (c.auditable === "yes") full++;
    else if (c.auditable === "partial") partial++;
    else missing++;
  }
  const total = claims.length;
  const fullPct  = total ? Math.round((full / total) * 100) : 0;
  const creditPct = total ? Math.round(((full + partial * 0.5) / total) * 100) : 0;
  return { total, full, partial, missing, fullPct, creditPct };
}

// Honesty gates currently active in the codebase. Hardcoded mirror of
// the constants in CognitiveProfile.jsx — kept here so the dashboard
// can name them without grepping the source at runtime. If you change
// a constant in the code, update it here too.
export const HONESTY_GATES = [
  { key: "MIN_N_BASELINE",      value: 7,    purpose: "Minimum sample size before any “your typical” line renders." },
  { key: "MIN_N_CI",            value: 5,    purpose: "Minimum sample before we report a confidence interval." },
  { key: "PATTERNS_WINDOW",     value: 28,   purpose: "Days of calendar history we look back for the patterns drawer." },
  { key: "PATTERNS_READY_DAYS", value: 14,   purpose: "Writing days needed inside the patterns window before the drawer unlocks." },
  { key: "PATTERNS_STABLE",     value: 0.70, purpose: "Recurrence rate above which a part is called “stable.”" },
  { key: "PATTERNS_NOISY",      value: 0.30, purpose: "Lower bound of the “coming & going” band; below that with ≥2 days = still forming." },
  { key: "PATTERNS_MIN_DAYS",   value: 2,    purpose: "Minimum days a part must appear before it counts at all. Single-day occurrences are dropped." },
  { key: "WILSON_Z",            value: 1.96, purpose: "Z-score for the 95% Wilson CI used by the borderline tier." },
  { key: "ANCHOR_N",            value: 30,   purpose: "Days used to compute the FIRST 30 drift anchor on every chart." },
];

// Cold-start ladder — when each feature unlocks. Computed against a
// user's local history + Oura nights. The Honesty panel runs this on
// the live data and shows where the user actually is on the ladder.
export const COLD_START_MILESTONES = [
  { id: "reserves",     label: "Reserves",                   need: "biometric",     days: 7,
    desc: "Sleep + HRV become readable once 7 nights of Oura are in." },
  { id: "demands",      label: "Demands & Form",             need: "writing",       days: 14,
    desc: "The day's pressures and how you came through need 14 writing days for baselines." },
  { id: "patterns",     label: "Your patterns drawer",       need: "writing-window", days: 14,
    desc: "Needs 14 writing days inside the most recent 28 calendar days." },
  { id: "anchor",       label: "First-30-days drift anchor", need: "any",           days: 30,
    desc: "Frozen baseline on every chart, set from your earliest 30 days." },
];

// Compute where the current user is against the ladder.
//   history          array of journal entries (from CPI.jsx state)
//   ouraNightCount   integer (from CPI.jsx — reads from OURA_HISTORY_KEY)
//   writingDaysIn28  integer (last 28 calendar days)
// Returns array of milestones with { unlocked, current, need }.
export function coldStartStatus({ history = [], ouraNightCount = 0, writingDaysIn28 = 0 } = {}) {
  const uniqueWritingDays = new Set();
  for (const h of history) {
    const d = h?.date;
    if (!d) continue;
    const k = typeof d === "string" ? d.slice(0, 10)
      : (() => { try { return new Date(d).toISOString().slice(0, 10); } catch { return null; } })();
    if (k && /^\d{4}-\d{2}-\d{2}$/.test(k)) uniqueWritingDays.add(k);
  }
  const totalWritingDays = uniqueWritingDays.size;
  return COLD_START_MILESTONES.map((m) => {
    let current;
    if (m.need === "biometric") current = ouraNightCount;
    else if (m.need === "writing-window") current = writingDaysIn28;
    else current = totalWritingDays;
    return {
      ...m,
      current,
      unlocked: current >= m.days,
      remaining: Math.max(0, m.days - current),
    };
  });
}
