// Ori simulator — synthetic data generator.
//
// Ori's value is invisible in a cold demo: it needs a wearable and weeks of
// history before the rings, baselines, letters and PARTS mean anything. This
// module fabricates that history — a chosen persona over N days — in the EXACT
// shapes the real app reads, then writes them through the real storage layer.
// Load the result and the shipped surfaces (Today rings, Journal, Day, Letter,
// Parts, and the reflect doorway) light up as if you'd used Ori for N days.
//
// Nothing here re-implements the engine. We only seed its inputs:
//   • cpi_oura_history    {iso: {sleepScore, source, ...}}   → Reserves
//   • cpi_who5_history    {iso: {items, score, ts}}          → Form
//   • cpi-v2-data         [{date, decisionCount, params,     → Demands, Patterns,
//                           drivers, letterParts, tone, hcpi}]  Parts, reflect flow
//   • cpi_journal_repo    {entries:[…]}                      → Journal + day count
//   • cpi_letter_<iso>    {result:{a:{letter}}}              → Inbox / Letter
//   • cpi_day_rings_<iso> {reserves, demands, form}          → Day detail
// plus the gate keys (cpi_welcome_done, cpi_garden_name).
//
// Parts (and therefore the reflect doorway) are derived from each entry's
// `drivers` map + `letterParts`, via the SAME visitedPartsFromResult() the real
// letter engine uses — so the parts a persona surfaces can't drift from the app.
//
// Day N is anchored to the real "today" (newest day), because every surface
// reads new Date() for today. Per-day noise is seeded on (persona, date) so a
// given day looks identical no matter where you scrubbed from.

import { LARGE_KEYS } from '../storage.js';
import { visitedPartsFromResult } from '../parts-lib.js';

const KEY_PREFIXES = ['cpi_', 'cpi-', 'ori-'];

// Matches the real engine's history cap (letterEngine.js: [entry,...].slice(0,200)).
// Generating past this still works, but the live app would only retain 200 days
// of analyzed history — so we surface it in the scalability read-out.
export const ENGINE_HISTORY_CAP = 200;

// ── deterministic noise ────────────────────────────────────────────────
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// mulberry32 — tiny seeded PRNG. Same seed → same stream.
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── personas ───────────────────────────────────────────────────────────
// signals(p, ctx) maps progress p∈[0,1] (0 = oldest seeded day, 1 = today) and
// a day context {dow, i, N} to the day's underlying values BEFORE noise.
// Correlation is the whole point: in burnout, sleep and mood fall together
// while decisions, context-shifts and the protector drivers (identity, survival,
// discomfort) all climb — that coupling is what makes the rings, patterns AND
// parts read as one coherent person.
//
// drivers are on a 0–6 scale: identity→planner, social→watcher, survival→tender,
// reward→seeker, discomfort→hesitant. tone ∈ positive|neutral|negative seeds the
// gentle companion on quiet positive days.
export const PERSONAS = {
  burnout: {
    label: 'Burning out',
    blurb: 'Sleep and mood drift down together; decisions, context-shifts and the protector parts all climb.',
    wearable: true,
    signals: (p) => ({
      sleepScore: lerp(84, 55, p),
      who5: lerp(72, 36, p),
      decisionCount: lerp(3, 13, p),
      C: lerp(1.2, 3.7, p),
      psi: lerp(0.76, 0.30, p),
      mu: lerp(0.56, 0.28, p),
      drivers: {
        identity: lerp(2.0, 6.0, p),     // the planner, working overtime
        survival: lerp(1.0, 5.0, p),     // the tender one — sleep debt
        discomfort: lerp(1.0, 4.2, p),   // the hesitant one
        reward: lerp(2.2, 3.0, p),
        social: lerp(1.0, 3.0, p),
      },
      tone: p < 0.3 ? 'positive' : p < 0.6 ? 'neutral' : 'negative',
    }),
    journal: {
      early: [
        'Slept well, woke before the alarm. Mapped the week over coffee — felt on top of it for once.',
        'Good day. Two big decisions but they came easy. Walked at lunch.',
      ],
      mid: [
        'Back-to-back from nine. Three lists before I even started the real work. Coffee number four.',
        'Keep getting pulled between the launch and the hiring stuff. Never finished a single thread today.',
        'Tired but wired. Lay awake running tomorrow on a loop.',
      ],
      late: [
        'Five hours again. Snapped at the standup, apologised, didn’t mean it as much as I should.',
        'Everything is a decision and none of them feel like mine. Just want a day where nothing pings.',
        'Skipped lunch, skipped the walk, skipped the gym. Told myself it’s temporary three weeks ago.',
      ],
    },
    letters: {
      headline: 'A quieter evening, if you’ll let it',
      paragraphs: [
        'You’ve been carrying a lot of decisions lately — the kind that don’t announce themselves as heavy until you’re three lists deep before coffee.',
        'The part of you that keeps the plates spinning has been working overtime. It might be worth letting one plate land, gently, tonight.',
      ],
    },
  },
  recovering: {
    label: 'Recovering',
    blurb: 'Coming back up: sleep and mood climbing, the load and the protectors easing off.',
    wearable: true,
    signals: (p) => ({
      sleepScore: lerp(58, 83, p),
      who5: lerp(40, 70, p),
      decisionCount: lerp(11, 4, p),
      C: lerp(3.4, 1.4, p),
      psi: lerp(0.34, 0.72, p),
      mu: lerp(0.31, 0.54, p),
      drivers: {
        identity: lerp(5.0, 2.0, p),
        survival: lerp(4.5, 1.0, p),
        discomfort: lerp(4.0, 1.0, p),
        reward: lerp(1.5, 2.5, p),
        social: lerp(2.0, 2.4, p),
      },
      tone: p < 0.35 ? 'negative' : p < 0.7 ? 'neutral' : 'positive',
    }),
    journal: {
      early: [
        'Rough start. Forced myself out for ten minutes of air. Didn’t fix anything but didn’t hurt.',
        'Said no to the Friday thing. Felt guilty, then didn’t.',
      ],
      mid: [
        'Slept through for the first time in a while. The morning felt less like a sprint.',
        'Cleared two things that had been hanging over me. Smaller than they felt.',
      ],
      late: [
        'Made dinner properly, sat down to eat it. Small thing, big difference.',
        'Noticed I wasn’t bracing for the day. Just… having it.',
      ],
    },
    letters: {
      headline: 'You’re coming back up',
      paragraphs: [
        'The mornings have stopped feeling like something to survive. That’s not nothing — it’s the part of you that protects your rest finally being heard.',
        'Whatever you changed, it’s holding. You don’t have to name it to keep doing it.',
      ],
    },
  },
  steady: {
    label: 'Steady baseline',
    blurb: 'A stable life with normal noise — the control case. Rings sit near the middle and stay there.',
    wearable: true,
    signals: () => ({
      sleepScore: 76, who5: 64, decisionCount: 5, C: 1.8, psi: 0.62, mu: 0.50,
      drivers: { identity: 3.0, survival: 1.6, discomfort: 1.4, reward: 2.4, social: 2.2 },
      tone: 'neutral',
    }),
    journal: {
      early: ['Ordinary day. Work, gym, dinner, early night.'],
      mid: ['Steady. Nothing on fire, nothing remarkable. Slept fine.'],
      late: ['Same shape as most days. Took the long way home.'],
    },
    letters: {
      headline: 'A steady week',
      paragraphs: [
        'Nothing’s shouting for your attention this week, and that’s its own kind of good. The plates are spinning at a pace you set.',
      ],
    },
  },
  reflectOnly: {
    label: 'Reflect mode (no wearable)',
    blurb: 'No wrist signals at all — journal + check-ins only. Shows Ori in Reflect mode (parts still form from writing).',
    wearable: false,
    signals: (p) => ({
      sleepScore: null,
      who5: lerp(66, 50, p),
      decisionCount: lerp(4, 8, p),
      C: lerp(1.5, 2.6, p),
      psi: lerp(0.66, 0.45, p),
      mu: lerp(0.52, 0.40, p),
      drivers: {
        identity: lerp(2.0, 4.0, p),
        discomfort: lerp(2.0, 4.0, p),
        survival: lerp(1.0, 2.0, p),
        reward: lerp(1.6, 1.4, p),
        social: lerp(1.2, 1.8, p),
      },
      tone: p < 0.5 ? 'neutral' : 'negative',
    }),
    journal: {
      early: ['Wrote a little tonight. Nice to have somewhere to put it.'],
      mid: ['Busy stretch. Logged it even though I almost didn’t.'],
      late: ['Felt thin today. Wrote it down anyway.'],
    },
    letters: {
      headline: 'Just your words tonight',
      paragraphs: [
        'You don’t wear anything that tells me how you slept, so I only have what you choose to say — and tonight you said you felt thin. I’m holding that with you.',
      ],
    },
  },
  volatile: {
    label: 'Volatile (swinging)',
    blurb: 'Big week-to-week swings up and down — stresses the baseline/variance and state-transition logic.',
    wearable: true,
    signals: (p, ctx) => {
      // ~10-day cycle so a 6-month run holds ~18 swings.
      const wave = Math.sin((ctx.i / 10) * Math.PI * 2);
      return {
        sleepScore: clamp(70 + wave * 22, 30, 96),
        who5: clamp(58 + wave * 26, 8, 96),
        decisionCount: clamp(7 - wave * 4, 1, 14),
        C: clamp(2.4 - wave * 1.2, 1, 4.5),
        psi: clamp(0.55 + wave * 0.22, 0.1, 0.9),
        mu: clamp(0.46 + wave * 0.12, 0.1, 0.9),
        drivers: {
          identity: clamp(3 - wave * 2.5, 0, 6),
          survival: clamp(3 - wave * 2.5, 0, 6),
          discomfort: clamp(2.5 - wave * 2, 0, 6),
          reward: clamp(2.5 + wave * 1.5, 0, 6),
          social: 2.0,
        },
        tone: wave > 0.3 ? 'positive' : wave < -0.3 ? 'negative' : 'neutral',
      };
    },
    journal: {
      early: ['On top of the world today. Everything clicked.'],
      mid: ['Crashed hard. Could barely get off the sofa.'],
      late: ['Up again. I never know which version of me wakes up.'],
    },
    letters: {
      headline: 'The tide goes in and out',
      paragraphs: [
        'Some weeks you’re moving at full tilt and some weeks the same tasks feel underwater. Neither one is the real you — they’re both just weather.',
      ],
    },
  },
  weekendDip: {
    label: 'Weekend dip (day-of-week)',
    blurb: 'A clear Fri/Sat pattern — built to unlock the weekday-rhythm finding (needs months of samples).',
    wearable: true,
    signals: (p, ctx) => {
      const weekend = ctx.dow === 5 || ctx.dow === 6; // Fri, Sat
      return {
        sleepScore: weekend ? 60 : 78,
        who5: weekend ? 48 : 68,
        decisionCount: weekend ? 3 : 6,
        C: weekend ? 2.6 : 1.6,
        psi: weekend ? 0.45 : 0.64,
        mu: weekend ? 0.40 : 0.52,
        hcpi: weekend ? 0.42 : 0.66,
        drivers: weekend
          ? { identity: 2.0, survival: 4.0, discomfort: 3.5, reward: 3.0, social: 1.5 }
          : { identity: 3.5, survival: 1.5, discomfort: 1.2, reward: 2.0, social: 2.5 },
        tone: weekend ? 'negative' : 'neutral',
      };
    },
    journal: {
      early: ['Weekends keep getting away from me. Mondays I feel fine again.'],
      mid: ['Saturday gone before it started. Slept badly, ate badly.'],
      late: ['Why do the days off feel harder than the work days?'],
    },
    letters: {
      headline: 'The shape of your week',
      paragraphs: [
        'There’s a rhythm to how you land — the back half of the week asks more of you than the front. Worth knowing, so you can meet it on purpose.',
      ],
    },
  },
  kai: {
    label: 'Data-driven skeptic',
    blurb: 'Tracks everything closely, questions unsupported claims. Wants data, not narrative.',
    wearable: true,
    signals: (p) => ({
      sleepScore: lerp(78, 72, p),
      who5: lerp(68, 62, p),
      decisionCount: lerp(4, 7, p),
      C: lerp(1.6, 2.1, p),
      psi: lerp(0.62, 0.55, p),
      mu: lerp(0.50, 0.48, p),
      drivers: {
        identity: lerp(2.5, 3.2, p),
        survival: lerp(1.8, 2.2, p),
        discomfort: lerp(1.5, 2.0, p),
        reward: lerp(2.1, 2.4, p),
        social: lerp(1.9, 2.3, p),
      },
      tone: 'neutral',
    }),
    journal: {
      early: ['Logged data today. Sleep 7h 24m, HRV 58, baseline recovery good. Ordinary day.'],
      mid: ['Slept 6h 52m. HRV dipped to 42 but readiness still 71. Weather changed, might explain variance.'],
      late: ['This week mirrors last week pretty closely. Same sleep, same mood range.', 'The parts thing is interesting but I wonder what it actually tracks. Waiting to see the data.'],
    },
    letters: {
      headline: 'Your baseline stayed your baseline',
      paragraphs: ['This week looked a lot like the last one. Sleep steady, decisions roughly the same weight. You are tracking everything, so you probably already noticed.'],
    },
  },
  maya: {
    label: 'In therapy, high self-awareness',
    blurb: 'Therapy-engaged, articulate about inner dynamics. Risk: clinical reframing instead of grounding in actual day.',
    wearable: true,
    signals: (p) => ({
      sleepScore: 72 + Math.sin(p * Math.PI * 2) * 8,
      who5: 68 + Math.sin(p * Math.PI * 1.5) * 12,
      decisionCount: 7,
      C: 2.2,
      psi: 0.58,
      mu: 0.48,
      drivers: {
        identity: 4.5 + p * 1.5,
        survival: 2.5 + p * 1.0,
        discomfort: 3.2 - p * 0.8,
        reward: 1.8,
        social: 3.5,
      },
      tone: p < 0.4 ? 'neutral' : 'positive',
    }),
    journal: {
      early: [
        'Therapy session today. She asked about my mother and I realized I have been doing the same thing. Unsettling.',
        'At dinner I noticed myself managing everyone mood. That is just me, I thought. But maybe it is a learned thing.',
        'Writing this down feels important. Like I am finally paying attention to the things I have been running past.',
      ],
      mid: [
        'Had a hard conversation with my sister. I usually avoid conflict but I named what I was noticing. She did not hear it the way I meant it.',
        'Therapist pointed out how much energy I spend interpreting what people mean. I am in my head a lot, reading everything.',
        'Recognized my dad voice in my own internal critic today. That is new awareness. Uncomfortable but something shifted.',
      ],
      late: [
        'I have been in therapy for six months now and it is like seeing the same room in daylight for the first time. The furniture has not moved but I understand what is here.',
        'Spent the afternoon just sitting with some realizations instead of trying to reframe them. That felt brave.',
        'My sister reached out after our hard talk. We did not solve anything but the fact that we came back -- that feels like new ground.',
      ],
    },
    letters: {
      headline: 'You are seeing the furniture more clearly now',
      paragraphs: [
        'Six months in and the room did not change shape -- just the light. Your mother pattern, your sister reaching back, the voice in your head that sounds familiar now because it is. These are the things showing up when you pay attention instead of move past them.',
        'That takes courage. Not the loud kind, just the steady kind -- sitting with what you see instead of reframing it into something easier. That is the work right here.',
      ],
    },
  },
  carrying: {
    label: 'Carrying their people',
    blurb: 'A stretched parent whose pages are full of people — partner, daughter, mum, an old friend. The relational persona: recurrence forms around WHO, not just what.',
    wearable: true,
    signals: (p) => ({
      sleepScore: lerp(76, 64, p < 0.6 ? p : 0.6) + (p > 0.6 ? (p - 0.6) * 20 : 0),
      who5: lerp(64, 46, p < 0.6 ? p : 0.6) + (p > 0.6 ? (p - 0.6) * 45 : 0),
      decisionCount: lerp(6, 10, p),
      C: lerp(1.8, 2.9, p),
      psi: lerp(0.62, 0.45, p),
      mu: lerp(0.52, 0.42, p),
      drivers: {
        social: lerp(3.2, 5.2, p),       // the watcher — managing everyone
        identity: lerp(2.8, 4.4, p),     // the planner — the calendar of a household
        survival: lerp(1.6, 3.4, p),     // the tender one — running low
        discomfort: lerp(1.4, 2.4, p),
        reward: 1.6,
      },
      tone: p < 0.35 ? 'positive' : p < 0.7 ? 'neutral' : 'positive',
    }),
    journal: {
      early: [
        'Good morning with my daughter before school — she told me a whole story about her week and I actually listened, no phone.',
        'My partner handled dinner so I could finish the deck. Small thing. Meant a lot. Should have said so.',
        'Called my mum on the walk home. She sounded brighter than last week. I keep forgetting how easy it is to just call.',
        'Coffee with Dev after ages. He is going through it at work but we laughed like the old days.',
        'My manager flagged the reshuffle again. Trying not to carry it home with me.',
      ],
      mid: [
        'Snapped at my daughter over shoes this morning of all things. She went quiet in the car. It sat in my chest all day.',
        'My partner and I only talked logistics again — pickups, bins, whose turn. We used to talk about everything.',
        'Missed my mum’s call twice this week. She left a voicemail saying no rush, which somehow made it worse.',
        'Dev texted about the weekend and I still have not answered. I keep meaning to.',
        'Dev sent one of his terrible puns mid-meeting. Needed it more than he knows. Still owe him a reply.',
        'Bedtime went long, work went longer, and my partner and I passed each other like colleagues on a shift change.',
        'My manager wants the plan Friday. I did the maths of the week in bed instead of sleeping.',
      ],
      late: [
        'Told my daughter I was sorry about the shoe morning. One sentence. Her whole face changed. Ten minutes of her game after — best part of the week.',
        'Sat with my partner after bedtime, no phones, actually asked about their week. Twenty minutes felt like the old us.',
        'Drove to my mum’s on Sunday instead of calling. She cooked. I did not look at the time once.',
        'Finally saw Dev. He said he thought I had drifted. I told him the truth — the season, not the friendship.',
        'Work still loud, but I left it at the door twice this week. Counting that.',
      ],
    },
    letters: {
      headline: 'The people in your pages this week',
      paragraphs: [
        'Your daughter shows up in your writing more than anything else this month — the shoe morning, the story before school, ten minutes of her game. The repair you made with one sentence did more than the guilt did in a week.',
        'And there is a pattern worth holding gently: the weeks that ask the most of you at work are the weeks your partner becomes a colleague and your mum becomes a missed call. You already turned that around once — Sunday proved it.',
      ],
    },
  },
};

export const PERSONA_KEYS = Object.keys(PERSONAS);

// Pick a journal-phase bucket from progress p.
function phaseFor(p) { return p < 0.34 ? 'early' : p < 0.67 ? 'mid' : 'late'; }

// DEV/SIM ONLY: synthesize the kind of "words Deepgram was unsure of" a voice
// entry would carry, so the persona test exercises the low-confidence underline
// + tap-to-fix in the Day view (real entries get this from voiceConfidence.js).
// To read true, it flags the words a transcriber actually fumbles — names and
// longer/distinctive words — never trivial high-frequency ones. ~40% of voice
// entries get one or two flags, with realistic sub-0.65 confidences.
const SIM_STOP = new Set([
  'that', 'this', 'with', 'have', 'here', 'there', 'just', 'really', 'should',
  'about', 'what', 'when', 'then', 'they', 'them', 'from', 'your', 'their',
  'been', 'were', 'would', 'could', 'much', 'some', 'like', 'feel', 'felt',
  'today', 'again', 'into', 'over', 'they’re', 'didn’t',
]);
function simLowConf(text, r) {
  if (r() > 0.4) return [];
  const words = String(text).split(/\s+/);
  const cands = [];
  for (let i = 0; i < words.length; i += 1) {
    const raw = words[i].replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
    const lower = raw.toLowerCase();
    if (lower.length < 4 || SIM_STOP.has(lower)) continue;
    const proper = i > 0 && /^\p{Lu}/u.test(raw);          // a name mid-sentence
    const weight = (proper ? 3 : 0) + Math.max(0, lower.length - 5);
    if (weight <= 0) continue;                              // skip the unremarkable
    cands.push({ w: lower, weight });
  }
  if (!cands.length) return [];
  cands.sort((a, b) => b.weight - a.weight);
  const top = cands.slice(0, 4);                            // the most mishearable
  const n = r() < 0.6 ? 1 : 2;
  const picks = [];
  for (let i = 0; i < n && top.length; i += 1) {
    const idx = Math.floor(r() * top.length) % top.length;
    const w = top.splice(idx, 1)[0].w;
    picks.push({ w, c: +(0.4 + r() * 0.2).toFixed(2) });   // 0.40–0.60, realistic low
  }
  return picks;
}

// ── generation ─────────────────────────────────────────────────────────
// Returns the flat {key: value} object an "Export everything" backup would
// contain — the same shape restoreBackup() / the surfaces consume.
export function generate(personaKey, nDays, now = new Date()) {
  const persona = PERSONAS[personaKey] || PERSONAS.burnout;
  const N = clamp(Math.round(nDays), 1, 730);
  const ouraHistory = {};
  const who5History = {};
  const v2data = [];          // newest-first
  const journalEntries = [];
  const dayRings = {};
  const out = {};

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (let i = 0; i < N; i++) {
    // i = 0 → today; i = N-1 → oldest. progress p: 0 oldest … 1 today.
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = iso(d);
    const p = N === 1 ? 1 : (N - 1 - i) / (N - 1);
    const r = rng(hashStr(`${personaKey}:${key}`));
    const sig = persona.signals(p, { dow: d.getDay(), i: N - 1 - i, N });

    // Reserves source — Oura, with the occasional Apple Health day so the
    // source attribution path gets exercised (per wearable-source memory).
    if (persona.wearable && sig.sleepScore != null) {
      const sleepScore = Math.round(clamp(sig.sleepScore + (r() - 0.5) * 10, 20, 100));
      const source = r() < 0.18 ? 'Apple Health' : 'Oura';
      ouraHistory[key] = {
        sleepScore,
        readinessScore: Math.round(clamp(sleepScore + (r() - 0.5) * 12, 20, 100)),
        hrv: Math.round(clamp(lerp(70, 40, p) + (r() - 0.5) * 14, 18, 110)),
        rhr: Math.round(clamp(lerp(54, 64, p) + (r() - 0.5) * 4, 44, 80)),
        totalSleepMin: Math.round(clamp(sig.sleepScore * 5.4 + (r() - 0.5) * 50, 240, 540)),
        source,
        ts: d.toISOString(),
      };
    }

    // Form — WHO-5 (0–100), stored as the real 5-item shape.
    if (sig.who5 != null) {
      const score = Math.round(clamp(sig.who5 + (r() - 0.5) * 12, 0, 100));
      const items = who5Items(score, r);
      who5History[key] = { items, score, ts: d.toISOString() };
    }

    // Demands + Parts inputs — the analyzed-writing entry. drivers + letterParts
    // make the protector/companion parts surface (and the reflect doorway open);
    // letterParts is derived the SAME way the real letter engine derives it.
    const drivers = {};
    for (const [k, v] of Object.entries(sig.drivers || {})) {
      drivers[k] = +clamp(v + (r() - 0.5) * 0.8, 0, 6).toFixed(2);
    }
    const tone = sig.tone || 'neutral';
    const letterParts = visitedPartsFromResult(drivers, tone)
      .map((vp) => ({ id: vp.part.id, volume: vp.volume }))
      .filter((p2) => p2.id);
    const decisionCount = Math.max(0, Math.round(sig.decisionCount + (r() - 0.5) * 2));
    const hcpi = typeof sig.hcpi === 'number'
      ? sig.hcpi
      : +clamp(0.2 + 0.45 * ((sig.sleepScore ?? sig.who5 ?? 60) / 100) + 0.35 * ((sig.who5 ?? 60) / 100) - 0.15 * Math.min(1, decisionCount / 15), 0.05, 0.98).toFixed(3);

    v2data.push({
      date: d.toISOString(),
      decisionCount,
      hcpi,
      tone,
      drivers,
      letterParts: letterParts.length ? letterParts : null,
      params: {
        C: +clamp(sig.C + (r() - 0.5) * 0.4, 1, 5).toFixed(2),
        psi: +clamp(sig.psi + (r() - 0.5) * 0.08, 0.05, 0.95).toFixed(3),
        mu: +clamp(sig.mu + (r() - 0.5) * 0.06, 0.05, 0.95).toFixed(3),
        S: +clamp(lerp(2.0, 3.4, p) + (r() - 0.5) * 0.3, 1, 5).toFixed(2),
      },
    });

    // Journal — not every day (≈70%), to look lived-in rather than logged.
    if (r() < 0.72) {
      const pool = persona.journal[phaseFor(p)] || [];
      if (pool.length) {
        const text = pool[Math.floor(r() * pool.length) % pool.length];
        const when = new Date(d); when.setHours(20, Math.floor(r() * 59), 0, 0);
        const lowConf = simLowConf(text, r);
        journalEntries.push({
          source: 'checkin',
          date: key,
          rawText: text,
          transcription: text,
          confidence: 1.0,
          createdAt: when.toISOString(),
          uploadedAt: when.toISOString(),
          ...(lowConf.length ? { lowConf } : {}),
        });
      }
    }

    // Day-detail ring snapshot (what the letter was "written from").
    const reserves = ouraHistory[key]?.sleepScore ?? null;
    const form = who5History[key]?.score ?? null;
    const demands = Math.round(clamp(lerp(28, 78, p) + (r() - 0.5) * 12, 0, 100));
    if (reserves != null || form != null || demands != null) {
      dayRings[`cpi_day_rings_${key}`] = JSON.stringify({ reserves, demands, form, at: d.toISOString() });
    }
  }

  // Letters for the two most-recent days, so the Inbox has something unread.
  const L = persona.letters;
  for (let i = 0; i < Math.min(2, N); i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    out[`cpi_letter_${iso(d)}`] = {
      result: { a: { letter: { headline: L.headline, paragraphs: L.paragraphs } } },
      at: d.toISOString(),
    };
  }

  // Assemble the flat export object.
  out['cpi_oura_history'] = ouraHistory;
  out['cpi_who5_history'] = who5History;
  out['cpi-v2-data'] = v2data;                       // newest-first
  out['cpi_journal_repo'] = { entries: journalEntries.sort((a, b) => a.createdAt < b.createdAt ? 1 : -1) };
  for (const [k, v] of Object.entries(dayRings)) out[k] = JSON.parse(v);
  out['cpi_welcome_done'] = '1';
  out['cpi_garden_name'] = 'Sam’s evenings';
  out['_simMeta'] = { persona: personaKey, days: N, generatedFor: iso(today) };
  return out;
}

// Build 5 WHO-5 item scores (each 0–5) that sum near the target 0–100 score.
function who5Items(score, r) {
  const target = clamp(Math.round((score / 100) * 25), 0, 25); // 0–25 raw
  const items = [0, 0, 0, 0, 0];
  let left = target;
  for (let i = 0; i < 5; i++) {
    const remainingSlots = 5 - i;
    const avg = left / remainingSlots;
    const v = clamp(Math.round(avg + (r() - 0.5)), 0, 5);
    items[i] = v; left -= v;
  }
  return items;
}

// ── seeding ────────────────────────────────────────────────────────────
function oriKeysInStorage() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && KEY_PREFIXES.some((p) => k.startsWith(p))) keys.push(k);
    }
  } catch { /* unavailable */ }
  for (const k of Object.values(LARGE_KEYS)) if (!keys.includes(k)) keys.push(k);
  return keys;
}

// Synchronous "does this look like a real session?" check (no IDB reads) so the
// seeder can confirm before wiping. Onboarding done, any saved letter, or any
// check-in are unambiguous signs of real use worth protecting.
export function hasRealOriData() {
  try {
    if (localStorage.getItem('cpi_welcome_done') === '1') return true;
    const who5 = JSON.parse(localStorage.getItem('cpi_who5_history') || '{}');
    if (who5 && typeof who5 === 'object' && Object.keys(who5).length > 0) return true;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^cpi_letter_\d{4}-\d{2}-\d{2}$/.test(k)) return true;
    }
  } catch { /* storage unavailable → treat as no data */ }
  return false;
}

// Wipe every Ori key (small + the IDB-backed large keys via the shim), then
// write the generated backup through the same shimmed localStorage the app
// uses — so large keys land in IndexedDB exactly as a real session would.
export function seed(personaKey, nDays, now = new Date()) {
  for (const k of oriKeysInStorage()) {
    try { localStorage.removeItem(k); } catch { /* keep going */ }
  }
  const data = generate(personaKey, nDays, now);
  for (const [k, v] of Object.entries(data)) {
    if (k === '_simMeta') continue;
    try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch { /* quota */ }
  }
  return data._simMeta;
}
