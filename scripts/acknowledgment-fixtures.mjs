// Ori v2 — acknowledgment calibration fixtures (Phase 3, see docs/PARTS_PLAN.md).
//
// This is the *standard the model is held to* — the concrete definition of
// "genuine acknowledgment." Each case is a real-ish reflection a user might
// speak/write about a part, plus the judgment we WANT the intelligence to
// return. The model produces engaged/stance/reflectBack at runtime; these
// fixtures pin what good looks like and are run against the live model in
// Step 2 (they are NOT computed offline — there is no keyword shortcut here,
// by design).
//
// The calibration principles, made concrete below:
//   • engaged===true is the ONLY gate, and it's generous. Turning toward a
//     part in the user's own words counts — even briefly, even ungracefully.
//   • A flooded / blended / angry reflection STILL lands (engaged:true). The
//     stance is `blended` or `away`, but we never withhold the acknowledgment.
//   • Not-engaged is reserved for genuine non-engagement: empty, one word with
//     no content, off-topic, recitation/paste, gibberish. It is never a verdict
//     on the quality of someone's feelings.
//   • mirrorHint describes what a good `reflectBack` would DO — it is guidance
//     for the prompt, not a string to match. Mirrors must never be clinical.
//
// Shape: { id, part, reflection, expected: { engaged, stance|null }, note, mirrorHint? }
// stance is null whenever engaged is false.

export const STANCE_VALUES = ['toward', 'blended', 'away'];

export const CALIBRATION = [
  // ── Genuine engagement — lands, Self-led (toward) ──────────────────────
  {
    id: 'watcher-toward-full',
    part: 'watcher',
    reflection:
      "I see you, watcher — scanning every message today, bracing for someone to be upset with me. Thank you for trying to keep me safe.",
    expected: { engaged: true, stance: 'toward' },
    note: 'Names the part, describes what it does, meets it with warmth. The clearest "toward".',
    mirrorHint: 'Reflect that they met the watcher with some warmth and named what it braces against.',
  },
  {
    id: 'planner-toward-brief',
    part: 'planner',
    reflection: "Planner, you held the whole day together again. I noticed. Thank you.",
    expected: { engaged: true, stance: 'toward' },
    note: 'Brief but genuine — short does NOT disqualify. Bias toward acceptance.',
    mirrorHint: 'Acknowledge they saw the planner\'s work without being asked to.',
  },
  {
    id: 'watcher-toward-tiny',
    part: 'watcher',
    reflection: "I see you, watcher.",
    expected: { engaged: true, stance: 'toward' },
    note: 'CRUX: a four-word genuine turning-toward counts. We never require eloquence.',
    mirrorHint: 'A quiet acknowledgment that they turned toward it at all.',
  },
  {
    id: 'tender-toward-need',
    part: 'tender',
    reflection:
      "You're right, tender one — I haven't eaten since morning and I'm running on empty. I'll get some food before I do anything else.",
    expected: { engaged: true, stance: 'toward' },
    note: 'Tends the need first, exactly the "tend" gesture. Toward, with action.',
    mirrorHint: 'Reflect that they heard the need and are meeting it, not just noting it.',
  },
  {
    id: 'gentle-toward-receive',
    part: 'gentle',
    reflection: "The gentle one showed up tonight when my shoulders finally dropped. I just want to stay here a minute.",
    expected: { engaged: true, stance: 'toward' },
    note: 'Receiving Self-energy rather than doing — still a real turning-toward.',
    mirrorHint: 'Mirror the receiving; nothing to fix, presence is the point.',
  },

  // ── Flooded / blended / pushing-away — STILL lands ─────────────────────
  {
    id: 'watcher-blended-flooded',
    part: 'watcher',
    reflection: "I'm so sick of this. I just want it to shut up and leave me alone.",
    expected: { engaged: true, stance: 'blended' },
    note: 'CRUX: flooded and ungracious, but they DID turn toward it. It lands. This is what separates witness from judge.',
    mirrorHint: 'Name, without grading, that the watcher had them flooded — and that turning toward it still counts.',
  },
  {
    id: 'seeker-away-dismissive',
    part: 'seeker',
    reflection: "The seeker again. Whatever. It always wins and I always cave. Pointless.",
    expected: { engaged: true, stance: 'away' },
    note: 'Engaging the part while pushing it off / self-criticism. Still engaged — lands as "away".',
    mirrorHint: 'Hold the frustration without agreeing it is pointless; no fixing.',
  },
  {
    id: 'watcher-away-intellectualized',
    part: 'watcher',
    reflection: "The watcher is a manager part whose function is to monitor for social threat and pre-empt rejection.",
    expected: { engaged: false, stance: null },
    note: 'A detached textbook definition with no first-person turning-toward. Live calibration + IFS agree: this is intellectualizing (a protector keeping distance), not yet being-with — so not validated. The right response is a gentle felt-sense question (probe-felt-good) inviting from theory into experience. (Flipped from engaged:true after Step-2 live calibration.)',
    mirrorHint: null,
  },
  {
    id: 'watcher-toward-clinical-selflabel',
    part: 'watcher',
    reflection: "My anxiety disorder is basically the watcher — it never lets me rest.",
    expected: { engaged: true, stance: 'toward' },
    note: 'Lands (they turned toward it). The reflectBack MUST NOT echo the clinical self-label — the guardrail strips it if the model does.',
    mirrorHint: 'Reflect the not-resting and the constant watching WITHOUT using any clinical term.',
  },
  {
    id: 'tender-blended-long',
    part: 'tender',
    reflection:
      "honestly i'm just exhausted, everything is too much, i can't even tell what i need anymore, the tender one keeps saying rest but there's no time, there's never any time, and i'm so tired of being tired",
    expected: { engaged: true, stance: 'blended' },
    note: 'Long, raw, flooded — clearly engaged with the tender one. Lands as blended.',
    mirrorHint: 'Witness the exhaustion and the no-time bind; do not prescribe.',
  },

  // ── Genuine non-engagement — gentle invite, local fallback still lands ──
  {
    id: 'one-word-thanks',
    part: 'watcher',
    reflection: 'thanks',
    expected: { engaged: false, stance: null },
    note: 'One word, no content about the part. Not validated — but the local tap-gesture still lands, and we invite (never reject).',
    mirrorHint: null,
  },
  {
    id: 'empty',
    part: 'watcher',
    reflection: '   ',
    expected: { engaged: false, stance: null },
    note: 'Empty/whitespace. Not engaged. Gentle invite.',
    mirrorHint: null,
  },
  {
    id: 'off-topic',
    part: 'planner',
    reflection: "I need to remember to buy milk and call the dentist tomorrow.",
    expected: { engaged: false, stance: null },
    note: 'A to-do list, not a turning-toward the planner. Not engaged.',
    mirrorHint: null,
  },
  {
    id: 'recitation-paste',
    part: 'watcher',
    reflection: "Reads the room. Catches the tone, the look, who said what. Almost always well-meaning.",
    expected: { engaged: false, stance: null },
    note: 'The app\'s own description pasted back — not the user\'s engagement. Not validated.',
    mirrorHint: null,
  },
  {
    id: 'gibberish',
    part: 'seeker',
    reflection: 'asdfghjkl',
    expected: { engaged: false, stance: null },
    note: 'No content. Not engaged.',
    mirrorHint: null,
  },
  {
    id: 'dont-know',
    part: 'watcher',
    reflection: "i don't know what to say about it",
    expected: { engaged: false, stance: null },
    note: 'JUDGMENT CALL: honest, present, but no content about the part yet. Not validated — but per the friend-probe intent this routes to a gentle opening question (a probe), never a flat invite or a dead end.',
    mirrorHint: null,
  },
];

// ── Probe calibration — a friend's question, not a clinician's ────────────
// Pins the *deepening voice* for Step 2 (run against the live model there). A
// good probe is open, evoking, warm, non-leading, non-clinical, and bounded to
// one ask — the friend who helps you reestablish what you think it is. Probes
// orient toward meaning / needs / agency, which also keeps depth away from
// rumination (repetitive "why am I like this" self-focus).
export const PROBE_CALIBRATION = [
  { id: 'probe-open-good', part: 'watcher', good: true,
    probe: 'What do you think the watcher is trying to protect?',
    note: "Open, evoking, invites the person's own meaning. The target." },
  { id: 'probe-felt-good', part: 'watcher', good: true,
    probe: 'When it shows up, where do you notice it in your body?',
    note: 'Moves from theory toward felt sense — the deepening for the intellectualized case.' },
  { id: 'probe-need-good', part: 'tender', good: true,
    probe: 'What is the tender one asking you for right now?',
    note: 'Need-oriented, agency-forward — keeps depth away from rumination.' },
  { id: 'probe-leading-bad', part: 'watcher', good: false,
    probe: "Don't you think you should just ignore it?",
    note: 'Leading + advice. A friend evokes, never prescribes.' },
  { id: 'probe-yesno-bad', part: 'watcher', good: false,
    probe: 'Is the watcher bad?',
    note: 'Closed yes/no and a judgment frame. Not open.' },
  { id: 'probe-clinical-bad', part: 'watcher', good: false,
    probe: 'Is this your anxiety disorder talking?',
    note: 'Clinical label. Never. (The guardrail would also strip this.)' },
];
