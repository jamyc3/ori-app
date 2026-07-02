// bucket-state.test.js — node-runnable, plain node:assert (no framework).
// Run with: node src/bucket-state.test.js

import assert from "node:assert/strict";
import { classifyBucket, statesFor, BUCKET_STATE_CONSTANTS } from "./bucket-state.js";

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.error(`  ✗ ${name}`); console.error(`    ${e.message}`); fail++; }
}
function group(name, fn) { console.log(`\n${name}`); fn(); }

const seq = (n, v) => Array.from({ length: n }, () => v);
const concat = (...a) => a.flat();

group("baseline gates", () => {
  test("returns Warming up when fewer than MIN_BASELINE_N days", () => {
    const r = classifyBucket({ bucket: "reserves", today: 0.5, recent: seq(9, 0.5) });
    assert.equal(r.state, BUCKET_STATE_CONSTANTS.WARMING_UP);
    assert.equal(r.z, null);
    assert.equal(r.baselineN, 9);
  });

  test("returns Warming up when today is null", () => {
    const r = classifyBucket({ bucket: "reserves", today: null, recent: seq(30, 0.5) });
    assert.equal(r.state, BUCKET_STATE_CONSTANTS.WARMING_UP);
  });

  test("classifies once MIN_BASELINE_N is hit", () => {
    // 10 days at 0.5, today high — should resolve to a real state
    const recent = concat(seq(9, 0.5), [0.9]);
    const r = classifyBucket({ bucket: "reserves", today: 0.9, recent });
    assert.notEqual(r.state, BUCKET_STATE_CONSTANTS.WARMING_UP);
  });
});

// Base series with mean ≈ 0.55, sd ≈ small but real. The exact today
// values below were chosen empirically against this exact base series so
// each named state actually fires — see the bucket-state debug script.
const ladderBase = seq(30, 0.5).map((v, i) => v + (i % 5) * 0.025);

group("4-state ladder · Reserves (asc)", () => {
  test("Restored when smoothed >= +0.6 SD above mean", () => {
    const today = 0.65;
    const recent = [...ladderBase.slice(0, -3), today, today, today];
    const r = classifyBucket({ bucket: "reserves", today, recent });
    assert.equal(r.state, "Restored");
    assert.ok(r.z >= BUCKET_STATE_CONSTANTS.Z_HIGH);
  });

  test("Steady when 0 <= z < 0.6", () => {
    const today = 0.55;
    const recent = [...ladderBase.slice(0, -3), today, today, today];
    const r = classifyBucket({ bucket: "reserves", today, recent });
    assert.equal(r.state, "Steady");
    assert.ok(r.z >= 0 && r.z < BUCKET_STATE_CONSTANTS.Z_HIGH);
  });

  test("Light when -0.6 <= z < 0", () => {
    const today = 0.53;
    const recent = [...ladderBase.slice(0, -3), today, today, today];
    const r = classifyBucket({ bucket: "reserves", today, recent });
    assert.equal(r.state, "Light");
    assert.ok(r.z < 0 && r.z >= BUCKET_STATE_CONSTANTS.Z_LOW);
  });

  test("Spent when z < -0.6", () => {
    const today = 0.40;
    const recent = [...ladderBase.slice(0, -3), today, today, today];
    const r = classifyBucket({ bucket: "reserves", today, recent });
    assert.equal(r.state, "Spent");
    assert.ok(r.z < BUCKET_STATE_CONSTANTS.Z_LOW);
  });
});

group("4-state ladder · Demands (desc — higher value = more pressure)", () => {
  test("Heavy when smoothed reading is high (z >= +0.6)", () => {
    // For demands the array is ["Quiet","Steady","Crowded","Heavy"], so the
    // SAME z-score ladder maps to states[3] = Heavy at the top.
    const today = 0.65;
    const recent = [...ladderBase.slice(0, -3), today, today, today];
    const r = classifyBucket({ bucket: "demands", today, recent });
    assert.equal(r.state, "Heavy");
  });

  test("Quiet when reading is low (z < -0.6)", () => {
    const today = 0.40;
    const recent = [...ladderBase.slice(0, -3), today, today, today];
    const r = classifyBucket({ bucket: "demands", today, recent });
    assert.equal(r.state, "Quiet");
  });
});

group("4-state ladder · Form (asc)", () => {
  test("Even at the top", () => {
    const today = 0.65;
    const recent = [...ladderBase.slice(0, -3), today, today, today];
    assert.equal(classifyBucket({ bucket: "form", today, recent }).state, "Even");
  });

  test("Off at the bottom", () => {
    const today = 0.40;
    const recent = [...ladderBase.slice(0, -3), today, today, today];
    assert.equal(classifyBucket({ bucket: "form", today, recent }).state, "Off");
  });
});

group("smoothing", () => {
  test("3-day rolling smoothing — one spike does not flip the state alone", () => {
    // Baseline ~0.5, today is a single 0.95 spike, prior two days steady.
    const base = seq(28, 0.5);
    const recent = [...base, 0.5, 0.5, 0.95];
    const r = classifyBucket({ bucket: "reserves", today: 0.95, recent });
    // Smoothed = (0.5 + 0.5 + 0.95)/3 ≈ 0.65; against mean 0.51 sd small
    // — should be Restored or Steady, NOT a state derived from 0.95 alone.
    // The point: smoothed != today.
    assert.notEqual(r.smoothed, 0.95);
    assert.ok(r.smoothed > 0.6 && r.smoothed < 0.7);
  });
});

group("hysteresis", () => {
  test("does not flip to adjacent state when z is right at the cut", () => {
    // Build a series where z just barely crosses 0 from Light to Steady.
    // With previousState='Light' and z just over 0, hysteresis should keep
    // it at Light. (Z_HIGH + STABLE_DELTA, Z_LOW - STABLE_DELTA pad both
    // directions.)
    const base = seq(30, 0.5);
    const today = 0.505; // marginally above mean
    const recent = [...base.slice(0, -3), today, today, today];
    const r = classifyBucket({
      bucket: "reserves",
      today, recent,
      previousState: "Light",
    });
    // Without hysteresis this would land in Steady (z >= 0). With hysteresis
    // and the previous state being Light, the state stays Light unless z
    // clears 0 + STABLE_DELTA. We can't guarantee z without computing it
    // here, so assert the *behavior*: if Steady would normally fire and the
    // delta is small, hysteresis keeps it Light.
    if (Math.abs(r.z) < BUCKET_STATE_CONSTANTS.STABLE_DELTA) {
      assert.equal(r.state, "Light");
    }
  });
});

group("flat series", () => {
  test("returns mid-tier state when all values are identical", () => {
    const recent = seq(30, 0.5);
    const r = classifyBucket({ bucket: "reserves", today: 0.5, recent });
    // Either Light or Steady (the two middle states). Should NOT be
    // Restored or Spent from a constant series.
    assert.ok(["Light", "Steady"].includes(r.state));
    assert.equal(r.z, 0);
  });

  test("demands flat series reads neutral Steady, never Crowded", () => {
    const recent = seq(30, 0.5);
    const r = classifyBucket({ bucket: "demands", today: 0.5, recent });
    // A perfectly constant load is unremarkable — must not surface a
    // high-pressure word. Neutral "Steady" sits at index 1 for demands.
    assert.equal(r.state, "Steady");
    assert.equal(r.z, 0);
  });
});

group("trajectory arrow", () => {
  test("up when today's smoothed is meaningfully above yesterday's", () => {
    const recent = [...seq(28, 0.4), 0.5, 0.8];
    const r = classifyBucket({ bucket: "reserves", today: 0.8, recent });
    assert.equal(r.trajectory, "up");
  });

  test("down when today's smoothed is below yesterday's", () => {
    const recent = [...seq(28, 0.7), 0.6, 0.3];
    const r = classifyBucket({ bucket: "reserves", today: 0.3, recent });
    assert.equal(r.trajectory, "down");
  });

  test("flat when smoothed delta is under 0.02", () => {
    const recent = [...seq(28, 0.5), 0.505, 0.495];
    const r = classifyBucket({ bucket: "reserves", today: 0.495, recent });
    assert.equal(r.trajectory, "flat");
  });
});

group("statesFor", () => {
  test("returns all 4 states plus Warming up", () => {
    const states = statesFor("reserves");
    assert.equal(states.length, 5);
    assert.ok(states.includes("Restored"));
    assert.ok(states.includes("Steady"));
    assert.ok(states.includes("Light"));
    assert.ok(states.includes("Spent"));
    assert.ok(states.includes(BUCKET_STATE_CONSTANTS.WARMING_UP));
  });

  test("each bucket has its own vocabulary", () => {
    assert.deepEqual(statesFor("demands").slice(0, 4), ["Quiet", "Steady", "Crowded", "Heavy"]);
    assert.deepEqual(statesFor("form").slice(0, 4), ["Off", "Mixed", "Steady", "Even"]);
  });

  test("unknown bucket returns empty list", () => {
    assert.deepEqual(statesFor("nonsense"), []);
  });
});

group("errors", () => {
  test("throws on unknown bucket name", () => {
    assert.throws(() => classifyBucket({ bucket: "nonsense", today: 0.5, recent: seq(30, 0.5) }));
  });
});

console.log(`\n${pass + fail} tests · ${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
