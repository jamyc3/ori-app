/* ─────────────────────────────────────────────────────────────────
   part-history.test.js — Node-runnable test suite for the parts
   compute layer. No test framework dependency; uses node:assert.
   Run with: node src/part-history.test.js
   ───────────────────────────────────────────────────────────────── */

import assert from "node:assert/strict";

// Minimal localStorage shim for Node — keeps the thank store testable
// without touching real browser storage.
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => _store.set(k, String(v)),
  removeItem: (k) => _store.delete(k),
  clear: () => _store.clear(),
};

const {
  STAGE_NEWCOMER, STAGE_REGULAR, STAGE_FREQUENT, STAGE_CONSTANT,
  STAGE_THRESHOLDS, THANK_WEIGHT,
  THANK_MODE_THANK, THANK_MODE_TEND, THANK_MODE_RECEIVE, thankModeFor,
  stageFor, stageTransition, familiarityFraction,
  effectiveFamiliarity, thanksFor, appendThank, loadThanks,
  appendAcknowledgment, lastAcknowledgmentFor, acknowledgmentsFor, ACK_REFLECTION_MAX,
  volumeDistributionFor, coOccurrencesFor, dayOfWeekPeakFor,
  trendLabelFor, frequencyRateFor, quietStreakDaysFor,
  isFirstAppearanceToday, statsFor, sortPartsForList,
} = await import("./part-history.js");

// ── test harness ──────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  ✓ " + name);
    passed++;
  } catch (e) {
    console.log("  ✗ " + name);
    console.log("    " + (e.message || e));
    if (e.stack) {
      const line = e.stack.split("\n").find((s) => s.includes("test.js"));
      if (line) console.log("    " + line.trim());
    }
    failed++;
  }
}

// ── fixtures ──────────────────────────────────────────────────────────
function entry(daysAgo, letterParts = []) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(20, 0, 0, 0);
  return {
    date: d.toISOString(),
    letterParts: letterParts.map(([id, volume = "present"]) => ({ id, volume })),
    drivers: {},
  };
}

const planner = { id: "planner", kind: "protector" };
const critic = { id: "critic", kind: "protector" };
const witness = { id: "witness", kind: "companion" };
const stranger = { id: "stranger", kind: "protector" };

console.log("\npart-history.js\n");

// ── stages at boundaries ──────────────────────────────────────────────
test("stageFor → newcomer at 0", () => {
  assert.equal(stageFor(0), STAGE_NEWCOMER);
});
test("stageFor → newcomer just below regular", () => {
  assert.equal(stageFor(2), STAGE_NEWCOMER);
});
test("stageFor → regular at threshold (3)", () => {
  assert.equal(stageFor(3), STAGE_REGULAR);
});
test("stageFor → regular just below frequent", () => {
  assert.equal(stageFor(7), STAGE_REGULAR);
});
test("stageFor → frequent at threshold (8)", () => {
  assert.equal(stageFor(8), STAGE_FREQUENT);
});
test("stageFor → frequent just below constant", () => {
  assert.equal(stageFor(14), STAGE_FREQUENT);
});
test("stageFor → constant at threshold (15)", () => {
  assert.equal(stageFor(15), STAGE_CONSTANT);
});
test("stageFor → constant stays for large values", () => {
  assert.equal(stageFor(100), STAGE_CONSTANT);
});
test("stageFor → handles non-finite gracefully", () => {
  assert.equal(stageFor(NaN), STAGE_NEWCOMER);
  assert.equal(stageFor(-1), STAGE_NEWCOMER);
});

// ── transitions ──────────────────────────────────────────────────────
test("stageTransition fires when crossing each boundary", () => {
  assert.equal(stageTransition(2, 3), STAGE_REGULAR);
  assert.equal(stageTransition(7, 8), STAGE_FREQUENT);
  assert.equal(stageTransition(14, 15), STAGE_CONSTANT);
});
test("stageTransition silent within a stage", () => {
  assert.equal(stageTransition(3, 5), null);
  assert.equal(stageTransition(8, 10), null);
  assert.equal(stageTransition(15, 20), null);
});
test("stageTransition silent when going down", () => {
  assert.equal(stageTransition(5, 4), null);
  assert.equal(stageTransition(15, 8), null);
});
test("stageTransition silent on non-finite input", () => {
  assert.equal(stageTransition(NaN, 5), null);
  assert.equal(stageTransition(3, NaN), null);
});

// ── familiarity bar ──────────────────────────────────────────────────
test("familiarityFraction is 0 at 0 visits", () => {
  assert.equal(familiarityFraction(0), 0);
});
test("familiarityFraction reaches 0.25 at regular threshold", () => {
  assert.equal(familiarityFraction(3), 0.25);
});
test("familiarityFraction reaches 0.5 at frequent threshold", () => {
  assert.equal(familiarityFraction(8), 0.5);
});
test("familiarityFraction reaches 0.75 at constant threshold", () => {
  assert.equal(familiarityFraction(15), 0.75);
});
test("familiarityFraction climbs past constant toward 1", () => {
  assert.ok(familiarityFraction(20) > 0.75);
  assert.ok(familiarityFraction(45) > 0.95);
  assert.equal(familiarityFraction(1000), 1);
});
test("familiarityFraction is monotone within each stage", () => {
  for (const eff of [1, 2, 4, 5, 6, 9, 12, 16, 20]) {
    assert.ok(familiarityFraction(eff) > familiarityFraction(eff - 1),
      `expected fraction at ${eff} > at ${eff - 1}`);
  }
});

// ── thank weight (0 by design — thanks tracked but don't advance stage) ──
test("effectiveFamiliarity equals visits regardless of thanks (THANK_WEIGHT=0)", () => {
  const history = [
    entry(1, [["planner", "loud"]]),
    entry(2, [["planner", "present"]]),
  ];
  const thanks = [
    { partId: "planner", dateISO: new Date().toISOString() },
    { partId: "planner", dateISO: new Date().toISOString() },
  ];
  assert.equal(effectiveFamiliarity(history, planner, thanks), 2);
});
test("THANK_WEIGHT is locked at 0", () => {
  assert.equal(THANK_WEIGHT, 0);
});
test("effectiveFamiliarity with no thanks equals visit count", () => {
  const history = [
    entry(1, [["planner", "loud"]]),
    entry(2, [["planner", "present"]]),
    entry(3, [["planner", "brief"]]),
  ];
  assert.equal(effectiveFamiliarity(history, planner, []), 3);
});

// ── thank modes (gesture differs by IFS part type) ───────────────────────
test("thankModeFor classifies protectors as 'thank'", () => {
  assert.equal(thankModeFor("planner"), THANK_MODE_THANK);   // manager
  assert.equal(thankModeFor("watcher"), THANK_MODE_THANK);   // manager
  assert.equal(thankModeFor("hesitant"), THANK_MODE_THANK);  // manager
  assert.equal(thankModeFor("seeker"), THANK_MODE_THANK);    // firefighter
});
test("thankModeFor maps the exile to 'tend' (never thank-and-move-on)", () => {
  assert.equal(thankModeFor("tender"), THANK_MODE_TEND);
});
test("thankModeFor maps Self-energy companions to 'receive'", () => {
  assert.equal(thankModeFor("gentle"), THANK_MODE_RECEIVE);
  assert.equal(thankModeFor("witness"), THANK_MODE_RECEIVE);
  assert.equal(thankModeFor("maker"), THANK_MODE_RECEIVE);
});
test("thankModeFor defaults unknown ids to the safest gesture ('thank')", () => {
  assert.equal(thankModeFor("nope"), THANK_MODE_THANK);
  assert.equal(thankModeFor(undefined), THANK_MODE_THANK);
});

// ── thank store (with localStorage shim) ─────────────────────────────
test("appendThank persists and thanksFor reads it back", () => {
  _store.clear();
  appendThank("planner");
  appendThank("planner");
  appendThank("critic");
  assert.equal(thanksFor("planner"), 2);
  assert.equal(thanksFor("critic"), 1);
  assert.equal(thanksFor("witness"), 0);
});
test("appendThank ignores empty partId", () => {
  _store.clear();
  appendThank("");
  appendThank(null);
  appendThank(undefined);
  assert.equal(loadThanks().length, 0);
});

// ── validated acknowledgments — the separate descriptive axis ────────────
test("appendAcknowledgment persists a validated event with reflection + mirror", () => {
  _store.clear();
  appendAcknowledgment("planner", { validated: true, reflection: "you held my day together", mirror: "You saw its work." });
  const ack = lastAcknowledgmentFor("planner");
  assert.ok(ack);
  assert.equal(ack.reflection, "you held my day together");
  assert.equal(ack.mirror, "You saw its work.");
});
test("lastAcknowledgmentFor ignores non-validated gestures", () => {
  _store.clear();
  appendThank("planner");
  appendAcknowledgment("planner", { validated: false, reflection: "meh" });
  assert.equal(lastAcknowledgmentFor("planner"), null);
});
test("lastAcknowledgmentFor returns the most recent validated one", () => {
  _store.clear();
  appendAcknowledgment("planner", { validated: true, reflection: "first", now: new Date("2026-01-01T00:00:00Z") });
  appendAcknowledgment("planner", { validated: true, reflection: "second", now: new Date("2026-02-01T00:00:00Z") });
  assert.equal(lastAcknowledgmentFor("planner").reflection, "second");
});
test("acknowledgmentsFor returns validated events newest-first, excluding taps", () => {
  _store.clear();
  appendAcknowledgment("planner", { validated: true, reflection: "a", now: new Date("2026-01-01T00:00:00Z") });
  appendAcknowledgment("planner", { validated: true, reflection: "b", now: new Date("2026-03-01T00:00:00Z") });
  appendThank("planner");
  const list = acknowledgmentsFor("planner");
  assert.equal(list.length, 2);
  assert.equal(list[0].reflection, "b");
});
test("appendAcknowledgment caps the reflection excerpt", () => {
  _store.clear();
  appendAcknowledgment("planner", { validated: true, reflection: "x".repeat(ACK_REFLECTION_MAX + 50) });
  assert.equal(lastAcknowledgmentFor("planner").reflection.length, ACK_REFLECTION_MAX);
});
test("appendAcknowledgment ignores empty partId", () => {
  _store.clear();
  appendAcknowledgment("", { validated: true, reflection: "x" });
  appendAcknowledgment(null, { validated: true });
  assert.equal(loadThanks().length, 0);
});
test("validated acknowledgments do NOT move familiarity (THANK_WEIGHT=0)", () => {
  _store.clear();
  const history = [entry(1, [["planner", "loud"]])];
  appendAcknowledgment("planner", { validated: true, reflection: "deep" });
  appendAcknowledgment("planner", { validated: true, reflection: "deeper" });
  assert.equal(effectiveFamiliarity(history, planner), 1);
});

// ── volume distribution ──────────────────────────────────────────────
test("volumeDistribution returns share at each level", () => {
  const history = [
    entry(1, [["planner", "loud"]]),
    entry(2, [["planner", "loud"]]),
    entry(3, [["planner", "present"]]),
    entry(4, [["planner", "brief"]]),
  ];
  const v = volumeDistributionFor(history, planner);
  assert.equal(v.loud, 0.5);
  assert.equal(v.present, 0.25);
  assert.equal(v.brief, 0.25);
  assert.equal(v.total, 4);
});
test("volumeDistribution returns zeros for never-seen part", () => {
  assert.deepEqual(volumeDistributionFor([], planner),
    { loud: 0, present: 0, brief: 0, total: 0 });
});
test("volumeDistribution ignores unknown volume labels", () => {
  const history = [{ date: new Date().toISOString(),
    letterParts: [{ id: "planner", volume: "thunder" }] }];
  assert.equal(volumeDistributionFor(history, planner).total, 0);
});

// ── co-occurrence ────────────────────────────────────────────────────
test("coOccurrences returns shared partners above threshold", () => {
  const history = [
    entry(1, [["planner", "loud"], ["critic", "present"]]),
    entry(2, [["planner", "present"], ["critic", "loud"]]),
    entry(3, [["planner", "present"], ["critic", "brief"], ["witness", "brief"]]),
    entry(4, [["planner", "present"], ["witness", "present"]]),
  ];
  const co = coOccurrencesFor(history, planner);
  assert.equal(co.length, 1);
  assert.equal(co[0].partId, "critic");
  assert.equal(co[0].count, 3);
  assert.equal(co[0].rate, 3 / 4);
});
test("coOccurrences returns [] when nothing meets threshold", () => {
  const history = [
    entry(1, [["planner", "loud"], ["critic", "present"]]),
    entry(2, [["planner", "present"]]),
  ];
  assert.deepEqual(coOccurrencesFor(history, planner), []);
});
test("coOccurrences excludes the part itself", () => {
  const history = [
    entry(1, [["planner", "loud"], ["critic", "present"]]),
    entry(2, [["planner", "present"], ["critic", "loud"]]),
    entry(3, [["planner", "present"], ["critic", "brief"]]),
  ];
  const co = coOccurrencesFor(history, planner);
  assert.ok(!co.some(c => c.partId === "planner"));
});

// ── day-of-week affinity ─────────────────────────────────────────────
test("dayOfWeekPeak null below visit minimum", () => {
  const history = [
    entry(1, [["planner", "present"]]),
    entry(8, [["planner", "present"]]),
  ];
  assert.equal(dayOfWeekPeakFor(history, planner), null);
});
test("dayOfWeekPeak null when distribution is flat", () => {
  const history = [];
  for (let i = 0; i < 14; i++) {
    history.push(entry(i, [["planner", "present"]]));
  }
  // 14 consecutive days = ~2 per weekday — no real peak.
  const peak = dayOfWeekPeakFor(history, planner);
  assert.equal(peak, null);
});

// ── trend ────────────────────────────────────────────────────────────
test("trendLabel null below 60-day history floor", () => {
  const history = [
    entry(1, [["planner", "present"]]),
    entry(7, [["planner", "present"]]),
  ];
  assert.equal(trendLabelFor(history, planner), null);
});
test("trendLabel null when part has < 5 visits", () => {
  const history = [];
  for (let i = 0; i < 70; i++) {
    history.push(entry(i, i % 30 === 0 ? [["planner", "present"]] : []));
  }
  // Part visits = ~3, below 5 threshold.
  assert.equal(trendLabelFor(history, planner), null);
});
test("trendLabel returns 'louder' when recent rate exceeds older by ≥50%", () => {
  const history = [];
  // Older 60 days: 2 visits → rate ≈ 0.033/day
  history.push(entry(70, [["planner", "present"]]));
  history.push(entry(50, [["planner", "present"]]));
  for (let i = 31; i < 90; i++) history.push(entry(i));
  // Recent 30 days: 8 visits → rate ≈ 0.27/day → ratio ≈ 8× → "louder"
  for (let i = 0; i < 30; i++) {
    history.push(entry(i, i % 4 === 0 ? [["planner", "present"]] : []));
  }
  history.sort((a, b) => new Date(b.date) - new Date(a.date));
  assert.equal(trendLabelFor(history, planner), "louder");
});
test("trendLabel returns 'quieter' when recent rate drops ≥50% from older", () => {
  const history = [];
  // Older 60 days: 8 visits (every 7 days)
  for (let i = 31; i < 90; i++) {
    history.push(entry(i, i % 7 === 0 ? [["planner", "present"]] : []));
  }
  // Recent 30 days: 0 visits but with day entries so totalLetterDays grows
  for (let i = 0; i < 30; i++) history.push(entry(i));
  history.sort((a, b) => new Date(b.date) - new Date(a.date));
  assert.equal(trendLabelFor(history, planner), "quieter");
});
test("trendLabel returns 'steady' when recent and older rates are similar", () => {
  const history = [];
  // Older 60 days: 6 visits (every 10 days, days 30-89)
  for (let i = 31; i < 90; i++) {
    history.push(entry(i, i % 10 === 0 ? [["planner", "present"]] : []));
  }
  // Recent 30 days: 3 visits (every 10 days)
  for (let i = 0; i < 30; i++) {
    history.push(entry(i, i % 10 === 0 ? [["planner", "present"]] : []));
  }
  history.sort((a, b) => new Date(b.date) - new Date(a.date));
  assert.equal(trendLabelFor(history, planner), "steady");
});

// ── frequency rate ───────────────────────────────────────────────────
test("frequencyRate divides visits by total letter days", () => {
  const history = [
    entry(1, [["planner", "present"]]),
    entry(2, []),
    entry(3, [["planner", "present"]]),
    entry(4, []),
  ];
  assert.equal(frequencyRateFor(history, planner), 0.5);
});
test("frequencyRate is 0 on empty history", () => {
  assert.equal(frequencyRateFor([], planner), 0);
});

// ── quiet streak ─────────────────────────────────────────────────────
test("quietStreakDays equals daysAgo of last seen", () => {
  const history = [entry(5, [["planner", "present"]])];
  assert.equal(quietStreakDaysFor(history, planner), 5);
});
test("quietStreakDays is null for never-seen part", () => {
  assert.equal(quietStreakDaysFor([], planner), null);
});

// ── first-appearance-today ───────────────────────────────────────────
test("isFirstAppearanceToday true on first ever visit", () => {
  const history = [entry(0, [["stranger", "loud"]])];
  assert.equal(isFirstAppearanceToday(history, stranger), true);
});
test("isFirstAppearanceToday false when part visited before", () => {
  const history = [
    entry(0, [["planner", "loud"]]),
    entry(5, [["planner", "present"]]),
  ];
  assert.equal(isFirstAppearanceToday(history, planner), false);
});
test("isFirstAppearanceToday false when not in today's letter", () => {
  const history = [entry(0, [["planner", "loud"]])];
  assert.equal(isFirstAppearanceToday(history, stranger), false);
});
test("isFirstAppearanceToday false when most recent entry is not today", () => {
  // Most recent entry is 3 days old. Part never seen before. Without the
  // date check this would incorrectly fire the Inbox 'Met today' card.
  const history = [entry(3, [["stranger", "loud"]])];
  assert.equal(isFirstAppearanceToday(history, stranger), false);
});
test("isFirstAppearanceToday false on empty history", () => {
  assert.equal(isFirstAppearanceToday([], stranger), false);
});

// ── sort for list ────────────────────────────────────────────────────
test("sortPartsForList sinks recently-thanked to back", () => {
  _store.clear();
  const history = [
    entry(1, [["planner", "present"]]),
    entry(2, [["planner", "present"]]),
    entry(3, [["critic", "present"]]),
  ];
  const thanks = [{ partId: "critic", dateISO: new Date().toISOString() }];
  const sorted = sortPartsForList(history, [critic, stranger, planner], thanks);
  // planner: 2 visits, 0 thanks (effective 2); stranger: 0 (effective 0);
  // critic: 1 visit + recently thanked → sinks to back.
  assert.equal(sorted[0].id, "planner");
  assert.equal(sorted[2].id, "critic");
});
test("sortPartsForList: thanks older than window don't sink", () => {
  _store.clear();
  const history = [
    entry(1, [["planner", "present"]]),
    entry(2, [["planner", "present"]]),
    entry(3, [["critic", "present"]]),
  ];
  const eightDaysAgo = new Date();
  eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
  const thanks = [{ partId: "critic", dateISO: eightDaysAgo.toISOString() }];
  const sorted = sortPartsForList(history, [critic, stranger, planner], thanks);
  // THANK_WEIGHT=0: critic effective = 1 visit, planner = 2, stranger = 0
  assert.equal(sorted[0].id, "planner");
  assert.equal(sorted[1].id, "critic");
  assert.equal(sorted[2].id, "stranger");
});

// ── unified entry ────────────────────────────────────────────────────
test("statsFor returns the full shape for a known part", () => {
  const history = [
    entry(1, [["planner", "loud"]]),
    entry(2, [["planner", "present"]]),
  ];
  const s = statsFor(history, planner, []);
  assert.equal(s.visits, 2);
  assert.equal(s.thanks, 0);
  assert.equal(s.effective, 2);
  assert.equal(s.stage, STAGE_NEWCOMER);
  assert.ok(s.familiarityFraction > 0 && s.familiarityFraction < 0.25);
  assert.equal(s.volumeDistribution.total, 2);
  assert.equal(s.frequencyRate, 1);
  assert.ok(s.lastSeen);
  assert.ok(s.firstSeen);
  assert.deepEqual(s.coOccurrences, []);
  assert.equal(s.dayOfWeekPeak, null);
  assert.equal(s.trendLabel, null);
  assert.equal(s.firstAppearanceToday, false);
});
test("statsFor handles a never-seen part gracefully", () => {
  const s = statsFor([], stranger, []);
  assert.equal(s.visits, 0);
  assert.equal(s.thanks, 0);
  assert.equal(s.effective, 0);
  assert.equal(s.stage, STAGE_NEWCOMER);
  assert.equal(s.familiarityFraction, 0);
  assert.equal(s.frequencyRate, 0);
  assert.equal(s.lastSeen, null);
  assert.equal(s.firstSeen, null);
  assert.equal(s.quietStreakDays, null);
  assert.equal(s.volumeDistribution.total, 0);
  assert.deepEqual(s.coOccurrences, []);
});

// ── done ─────────────────────────────────────────────────────────────
console.log(`\n  ${passed}/${passed + failed} passed${failed ? " · " + failed + " failed" : ""}\n`);
process.exit(failed > 0 ? 1 : 0);
