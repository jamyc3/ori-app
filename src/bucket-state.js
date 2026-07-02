// bucket-state.js — classifier that maps a bucket's numeric reading
// into one of 4 literary state words, given the user's personal baseline.
//
// Used by the 3 rings on the Today screen (Reserves · Demands · Form)
// to display a state word inside the ring instead of a number. The
// underlying number is still computed; it only encodes the arc fill
// silently.
//
// Decisions baked in (locked 2026-06-02):
//
//   · 4 states per bucket, plus "Warming up" when there isn't enough data.
//   · States are personal — z-scored against the user's own last 30 days,
//     never compared to an external norm.
//   · ±0.6 z-score cuts. Wider than ±0.5 (less noisy day-to-day), tighter
//     than ±1.0 (real shifts still move the label).
//   · 3-day rolling smoothing on the input value before z-scoring, so a
//     single noisy day doesn't flip the state.
//   · Demands inverts the direction — higher pressure lands in Crowded /
//     Heavy, not Quiet. "Heavy" is descriptive, not a judgment.
//
// All numeric thresholds are documented inline so the honesty audit and
// reviewers can verify what the math does.

const VOCAB = {
  reserves: {
    direction: "asc",  // higher value → top state
    states: ["Spent", "Light", "Steady", "Restored"],
  },
  demands: {
    direction: "desc", // higher value → bottom state (Heavy)
    states: ["Quiet", "Steady", "Crowded", "Heavy"],
  },
  form: {
    direction: "asc",
    states: ["Off", "Mixed", "Steady", "Even"],
  },
};

const WARMING_UP = "Warming up";

// Personal-baseline threshold knobs — these are the only numbers in this
// file that are tunable design choices, not derived. Bumping them changes
// how often the state flips.
const Z_HIGH = 0.6;
const Z_LOW = -0.6;
const SMOOTHING_DAYS = 3;
const MIN_BASELINE_N = 10; // need at least this many days before classifying
const STABLE_DELTA = 0.05; // hysteresis on state transitions

// ─── Helpers ────────────────────────────────────────────────────────

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

function rollingMean(series, n) {
  if (!series.length) return null;
  const tail = series.slice(-n).filter((v) => typeof v === "number" && !isNaN(v));
  if (!tail.length) return null;
  return mean(tail);
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Classify one bucket reading into a state word.
 *
 * @param {object} input
 * @param {"reserves"|"demands"|"form"} input.bucket
 * @param {number|null} input.today        — today's 0-1 bucket score
 * @param {number[]}    input.recent       — last 30 days of 0-1 bucket scores
 *                                            (today included; nulls allowed,
 *                                            filtered internally)
 * @param {string|null} [input.previousState] — yesterday's state, for hysteresis
 *
 * @returns {{ state: string, z: number|null, smoothed: number|null,
 *             trajectory: "up"|"flat"|"down"|null,
 *             stable: boolean,
 *             baselineN: number }}
 */
export function classifyBucket({ bucket, today, recent, previousState }) {
  const def = VOCAB[bucket];
  if (!def) throw new Error(`Unknown bucket: ${bucket}`);

  const series = (recent || []).filter(
    (v) => typeof v === "number" && !isNaN(v)
  );

  // Not enough history yet — be honest about it.
  if (series.length < MIN_BASELINE_N || today == null || isNaN(today)) {
    return {
      state: WARMING_UP,
      z: null,
      smoothed: null,
      trajectory: null,
      stable: true,
      baselineN: series.length,
    };
  }

  // Smooth the input — last N days including today.
  const smoothed = rollingMean(series.slice(-SMOOTHING_DAYS), SMOOTHING_DAYS);
  if (smoothed == null) {
    return {
      state: WARMING_UP,
      z: null,
      smoothed: null,
      trajectory: null,
      stable: true,
      baselineN: series.length,
    };
  }

  const mu = mean(series);
  const sd = std(series);

  // If everything is constant, treat as the neutral "Steady" tier. That word
  // sits at a DIFFERENT index per direction: index 2 for asc (reserves/form),
  // but index 1 for desc (demands), whose array is ["Quiet","Steady","Crowded",
  // "Heavy"]. Using Math.floor(len/2)=2 for demands wrongly labeled a perfectly
  // flat, unremarkable load "Crowded" (a high-pressure word from a no-signal day).
  if (sd == null || sd < 1e-6) {
    const neutralIdx = def.direction === "desc"
      ? Math.floor(def.states.length / 2) - 1
      : Math.floor(def.states.length / 2);
    const flatState = def.states[neutralIdx];
    return {
      state: flatState,
      z: 0,
      smoothed,
      trajectory: "flat",
      stable: true,
      baselineN: series.length,
    };
  }

  const z = (smoothed - mu) / sd;

  // Choose the state based on z-score cuts.
  // For "asc" (reserves, form): higher z → state index higher in the array.
  //   z >= +0.6 → states[3] (top)
  //   0 <= z < +0.6 → states[2]
  //   -0.6 <= z < 0 → states[1]
  //   z < -0.6 → states[0]
  // For "desc" (demands): the same z-score ladder maps to the same array
  // indices, but the array is ordered so that the "more pressure" labels
  // sit at the top — see VOCAB. So the lookup logic is identical.
  let idx;
  if (z >= Z_HIGH) idx = 3;
  else if (z >= 0) idx = 2;
  else if (z >= Z_LOW) idx = 1;
  else idx = 0;

  let state = def.states[idx];

  // Hysteresis: if the new state is adjacent to previousState, require
  // |z| to clear the cut by STABLE_DELTA before flipping. Stops flicker.
  if (previousState && previousState !== state) {
    const prevIdx = def.states.indexOf(previousState);
    if (prevIdx >= 0 && Math.abs(prevIdx - idx) === 1) {
      const cutsZ = idx > prevIdx ? Z_HIGH : Z_LOW;
      if (idx > prevIdx && z < cutsZ + STABLE_DELTA) state = previousState;
      else if (idx < prevIdx && z > cutsZ - STABLE_DELTA) state = previousState;
    }
  }

  // Trajectory — compare today's smoothed value to yesterday's smoothed.
  const yesterdaySmoothed = rollingMean(
    series.slice(-SMOOTHING_DAYS - 1, -1),
    SMOOTHING_DAYS
  );
  let trajectory = null;
  if (yesterdaySmoothed != null) {
    const delta = smoothed - yesterdaySmoothed;
    // "up" / "down" in the asc sense — for demands the caller may want to
    // flip the arrow direction at the UI layer (rising demand = up = more
    // pressure = Crowded direction).
    if (Math.abs(delta) < 0.02) trajectory = "flat";
    else if (delta > 0) trajectory = "up";
    else trajectory = "down";
  }

  return {
    state,
    z,
    smoothed,
    trajectory,
    stable: true,
    baselineN: series.length,
  };
}

// Convenience: list of all state words a bucket can emit (for tests, copy,
// and the legend in the Honesty layers explainer).
export function statesFor(bucket) {
  const def = VOCAB[bucket];
  if (!def) return [];
  return [...def.states, WARMING_UP];
}

// Export the constants so the test file and any future code can refer to
// the same values rather than re-typing them.
export const BUCKET_STATE_CONSTANTS = {
  Z_HIGH,
  Z_LOW,
  SMOOTHING_DAYS,
  MIN_BASELINE_N,
  STABLE_DELTA,
  WARMING_UP,
};
