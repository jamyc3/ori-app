/* ═══════════════════════════════════════════
   KNOWLEDGE BASE — pure domain data.
   No React, no API calls, no side effects.
   Psychology word lists, chronotype tables,
   cognitive-health tiers, self-report anchors,
   clinical distortion/schema catalogs, and the
   Claude analysis tool/prompt specification.
   ═══════════════════════════════════════════ */

export const KB = {
  drivers: {
    survival: { name: "Survival Mode", icon: "◉", keywords: ["tired","sleep","hungry","sick","pain","exhausted","rest","eat","health","doctor","unsafe","danger","stressed","burnout","crash","headache","nauseous","dizzy","weak","drained","depleted","running on empty","barely functioning"], description: "Your body was pulling the emergency brake — signaling basic needs weren't met." },
    social: { name: "Social Radar", icon: "◎", keywords: ["boss","colleague","team","meeting","impress","awkward","judged","presentation","people","office","manager","coworker","client","interview","rejection","approval","status","confrontation","conflict","politics","gossip","reputation","performance review","feedback","criticized","praised","compared","competition","hierarchy","power","authority","please","validate"], description: "Your brain spent energy calculating where you stand relative to others — reading rooms, managing impressions, protecting status." },
    discomfort: { name: "Comfort Gravity", icon: "○", keywords: ["avoided","postponed","lazy","procrastinated","didn't want to","skipped","put off","couldn't face","boring","tedious","dread","uncomfortable","ignored","later","tomorrow","can't be bothered","kept meaning to","never got around","should have","meant to","pushed back","delayed","ducked","sidestepped"], description: "Mild discomfort — not pain, just friction — was enough to reroute your decisions away from what actually mattered." },
    reward: { name: "Dopamine Pull", icon: "●", keywords: ["scrolled","phone","instagram","twitter","reddit","youtube","netflix","snack","coffee","drink","bought","shopping","game","binge","distracted","notification","social media","tiktok","dopamine","candy","sugar","impulse","treat","reward","check","refresh","browsing","watching","streaming","ordering"], description: "Your reward system hijacked attention toward quick hits of satisfaction — each one tiny, but they compound into hours." },
    identity: { name: "Ego Shield", icon: "◇", keywords: ["should be","not good enough","failure","fraud","imposter","who am i","purpose","meaning","lost","stuck","wrong path","wasted","regret","not like me","proving","ego","pride","image","reputation","what will they think","am i even","deserve","worthy","authentic","real me","fake","pretending","mask"], description: "Energy went to protecting your self-image — rejecting feedback, avoiding situations that threaten your narrative of who you are." }
  },
  flowSignals: {
    strong: ["lost track of time","in the zone","completely absorbed","deep flow","hyperfocused","hours disappeared","forgot to eat","couldn't stop","in a groove","tunnel vision on work","locked in","nothing else existed"],
    moderate: ["focused","productive","got a lot done","good stretch","solid work","made progress","heads down","uninterrupted","clear headed","sharp"],
    anti: ["couldn't focus","scattered","distracted","kept checking","mind wandering","attention everywhere","fuzzy","couldn't settle","restless","fidgety","couldn't concentrate"]
  },
  concurrencySignals: {
    heavy: ["back to back meetings","nonstop","juggling everything","million things","context switching all day","couldn't finish anything","started five things","tab explosion","slack email meetings code","pulled in every direction"],
    moderate: ["multitasking","switching between","interrupted","a few things","split attention","meetings and coding","calls and emails","bouncing between"],
    minimal: ["one thing","single task","deep work","no meetings","blocked my calendar","do not disturb","airplane mode","heads down all day"]
  },
  loadSignals: {
    high: ["coding","programming","debugging","writing report","designing system","architecture","algorithm","diagnosis","legal brief","financial model","strategic plan","complex","novel problem","first time","unfamiliar","ambiguous","high stakes","critical decision","surgery","negotiation","research paper"],
    low: ["emails","admin","filing","cleaning","commute","laundry","routine","walk","chat","browsing","organizing","scheduling","data entry","copying","pasting","formatting","updating spreadsheet","standup","status update"]
  },
  emotionalMarkers: {
    negative: {
      high: ["furious","devastated","panic","terrified","hopeless","rage","destroyed","shattered","crushed","spiraling"],
      moderate: ["angry","anxious","frustrated","worried","upset","annoyed","sad","stressed","overwhelmed","burned out","exhausted","defeated"],
      low: ["meh","blah","off","not great","okay I guess","fine","whatever","numb","flat","empty"]
    },
    positive: {
      high: ["ecstatic","incredible","best day","amazing","on top of the world","unstoppable","breakthrough","euphoric"],
      moderate: ["happy","good","excited","grateful","calm","peaceful","energized","motivated","inspired","proud","accomplished","satisfied"],
      low: ["okay","alright","decent","not bad","manageable","survived"]
    }
  },
  intensityModifiers: {
    amplifiers: ["extremely","incredibly","absolutely","completely","totally","utterly","overwhelmingly","insanely","very","so","really","super","massively"],
    dampeners: ["slightly","somewhat","a bit","kind of","sort of","mildly","barely","hardly","a little","not very","not really"]
  },
  avoidancePatterns: ["didn't get to","kept putting off","couldn't bring myself","maybe tomorrow","not ready","need more time","still thinking","haven't decided","can't decide","on the fence","paralyzed","going back and forth","weighing options","overthinking","analysis paralysis","what if I","scared to","afraid to commit","don't want to regret"],
  negationPrefixes: ["didn't","don't","couldn't","wasn't","weren't","can't","won't","never","not","no","without","lack of"],
  decisionSignals: {
    heavy: ["decided","chose","picked","evaluated","weighed","trade-off","tradeoff","prioritized","negotiated","resolved","committed","approved","rejected","selected","assessed","judged","debated"],
    moderate: ["meeting","meetings","call","calls","review","reviews","planned","scheduled","delegated","assigned","budget","proposal","strategy","hire","fire","promote"],
    compound: ["back to back meetings","meeting after meeting","decision after decision","one thing after another","nonstop decisions","constant choices"]
  }
};

export const CHRONOTYPES = {
  morning: { label: "Early Bird", peakStart: 8, peakEnd: 12, desc: "Peak cognition 8am–12pm. Analytical power front-loaded." },
  flexible: { label: "Flexible", peakStart: 10, peakEnd: 14, desc: "Peak cognition 10am–2pm. Adaptable rhythm." },
  evening: { label: "Night Owl", peakStart: 14, peakEnd: 20, desc: "Peak cognition 2pm–8pm. Creative power back-loaded." }
};

// Per-day aggregation helpers used by HEALTH_INDEX.getWeeklyHealth.
export function dayKey(entry) {
  if (!entry || !entry.date) return null;
  return String(entry.date).slice(0, 10);
}

export function groupCheckinsByDay(history) {
  if (!Array.isArray(history) || history.length === 0) return [];
  const buckets = {};
  for (const e of history) {
    const k = dayKey(e);
    if (!k) continue;
    if (!buckets[k]) buckets[k] = [];
    buckets[k].push(e);
  }
  const mean = (arr, pick) => {
    const vals = arr.map(pick).filter(v => v != null && !Number.isNaN(v));
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const days = Object.keys(buckets).map(k => {
    const es = buckets[k].slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const avgHCPI = mean(es, e => e.hcpi);
    const avgParams = {
      S: mean(es, e => e.params?.S),
      C: mean(es, e => e.params?.C),
      mu: mean(es, e => e.params?.mu),
      psi: mean(es, e => e.params?.psi),
      W: mean(es, e => e.params?.W),
      L: mean(es, e => e.params?.L),
    };
    return {
      day: k,
      entries: es,
      count: es.length,
      avgHCPI,
      avgParams,
      avgE0: mean(es, e => e.E0),
      avgAllo: mean(es, e => e.recentStrain ?? e.allostaticLoad),
      avgDecisions: mean(es, e => e.decisionCount),
      latestDate: es[es.length - 1].date,
    };
  });
  return days.sort((a, b) => b.day.localeCompare(a.day));
}

export function uniqueDayCount(history) {
  if (!Array.isArray(history) || history.length === 0) return 0;
  const set = new Set();
  for (const e of history) { const k = dayKey(e); if (k) set.add(k); }
  return set.size;
}

export const HEALTH_INDEX = {
  tiers: [
    { min: 0.40, label: "In your zone", subtitle: "Everything's lining up",
      color: "#2d6a4f",
      summary: "Flow is within reach and everything's clicking. Conditions lined up for you today.",
      research: "Csikszentmihalyi's flow research (1990) found that peak performers spend 15–20% of work hours in flow, yielding 500% productivity gains (McKinsey, 2013).",
      risks: [],
      recommendations: [
        "Notice what made today possible — sleep, timing, task type — so you can come back to it",
        "Lean into creative or demanding work while the window's open"
      ] },
    { min: 0.30, label: "Steady", subtitle: "On, and holding",
      color: "#4a7c59",
      summary: "Solid ground today. Not peak, but your thinking is online and load is fair.",
      research: "Kahneman's dual-process theory (2011): System 2 (deliberate thought) degrades predictably with cognitive depletion. At this level, your executive function is still reliably online.",
      risks: [
        "Attention may fragment as the day stretches",
        "Hard calls are easier to make earlier than later"
      ],
      recommendations: [
        "Keep similar tasks together — switching costs stack up",
        "Front-load anything demanding while you're fresh"
      ] },
    { min: 0.20, label: "Stretched", subtitle: "Working, but it's costing you",
      color: "#b8860b",
      summary: "You're carrying more than usual. Routine work's fine — hard tasks cost more than they should right now.",
      research: "Cognitive performance varies with circadian timing and accumulated time-awake (well-replicated); the size of any single 'decision fatigue' effect is contested and individual. The reliable lever is timing — match consequential calls to your sharper hours rather than the tail of a long day.",
      risks: [
        "Judgment gets noisier — small biases creep in",
        "Holding several things in your head at once is harder",
        "You'll lean on shortcuts more than you'd like"
      ],
      recommendations: [
        "Postpone consequential decisions if you can — this window tends to pass",
        "A 20-minute break tends to recover about 30% (Kaplan, 1995)",
        "Stick to pattern-matching work over strategy for a bit"
      ] },
    { min: 0.12, label: "Heavy hour", subtitle: "This part of the day is costing more than usual",
      color: "#c0612b",
      summary: "Your reactions will be slower than they feel and your instincts are less reliable than usual.",
      research: "Dawson & Reid (1997): 17 hours awake ≈ 0.05% BAC equivalent. Sweller's cognitive load theory: new information fails to encode at this saturation.",
      risks: [
        "You'll catch fewer small mistakes",
        "Novel problem-solving is harder to reach today",
        "Small things will hit harder than usual",
        "You may feel surer than the data supports"
      ],
      recommendations: [
        "If you can, shift into low-stakes mode — emails that can wait probably should",
        "A short walk helps more than caffeine right now (Oppezzo & Schwartz, 2014)",
        "Even 20 minutes of closed-eye rest tends to beat pushing through"
      ] },
    { min: 0, label: "Low tide", subtitle: "Reserves are thin — it'll come back",
      color: "#a63d40",
      summary: "You're running on reserves right now. This isn't a judgment — it's just a read of the moment, and the moment is thin.",
      research: "Arnsten (2009): prefrontal cortex regulation weakens under sustained load, amygdala takes a larger share of the steering wheel. Van Dongen (2003): chronic partial sleep restriction accumulates like full deprivation.",
      risks: [
        "Complex judgment is unreliable right now",
        "Conversations you care about are easier to mishandle",
        "What you do now is less likely to stick (memory consolidation suffers)",
        "Fine motor and reaction time are softer than they feel"
      ],
      recommendations: [
        "If you can, close the laptop — the next hour's work tends to cost more than it pays",
        "Sleep is the only real reset. If it's accessible, protect it",
        "If sleep isn't possible: 20 minutes eyes-closed, water, and something with protein",
        "Hold off on the big calls — decisions made here rarely hold up tomorrow"
      ] }
  ],
  weeklyBenchmarks: { excellent: { min: 0.35, label: "Consistently high — sustainable peak performance" }, healthy: { min: 0.25, label: "Normal range — occasional dips are expected" }, concerning: { min: 0.15, label: "Below optimal — look for systemic causes" }, critical: { min: 0, label: "Sustained depletion — burnout risk" } },
  getHealthTier(hcpi) { return this.tiers.find(t => hcpi >= t.min) || this.tiers[this.tiers.length - 1]; },
  getWeeklyHealth(history) {
    const days = groupCheckinsByDay(history);
    if (days.length < 3) return null;
    const recent = days.slice(0, 7);
    const avg = recent.reduce((s, d) => s + (d.avgHCPI || 0), 0) / recent.length;
    const variance = recent.reduce((s, d) => s + Math.pow((d.avgHCPI || 0) - avg, 2), 0) / recent.length;
    const stability = Math.max(0, 1 - Math.sqrt(variance) * 5);
    const trend = recent.length >= 3 ? ((recent[0].avgHCPI || 0) - (recent[recent.length - 1].avgHCPI || 0)) : 0;
    const bm = this.weeklyBenchmarks;
    const level = avg >= bm.excellent.min ? "excellent" : avg >= bm.healthy.min ? "healthy" : avg >= bm.concerning.min ? "concerning" : "critical";
    return { avg, stability, trend, level, label: bm[level].label, dayCount: recent.length };
  }
};

// Anchors for self-rated 1–10 sliders. Deliberately personal ("Usual" =
// usual for you) — so a user's 5 stays comparable to their own previous 5s.
export const SELF_RATE_ANCHORS = {
  sleep:      ["Terrible","Poor","Poor","Below usual","Usual","Usual","Good","Very good","Very good","Best in months"],
  energy:     ["Spent","Low","Low","Below usual","Usual","Usual","Good","High","High","Peak"],
  readiness:  ["Not ready","Low","Low","Below usual","Usual","Usual","Ready","Fully ready","Fully ready","Peak"],
};

export function selfRateAnchor(metric, value) {
  const v = Math.max(1, Math.min(10, Math.round(value)));
  return SELF_RATE_ANCHORS[metric]?.[v - 1] ?? "";
}

export const CRISIS_PATTERNS = {
  suicidal_ideation: [
    /\bkill(ing)?\s+myself\b/i, /\bend\s+(it\s+all|my\s+life)\b/i, /\bending\s+(it\s+all|my\s+life)\b/i,
    /\btake\s+my\s+own\s+life\b/i, /\bthinking\s+(about|of)\s+ending\s+(it|things|it\s+all|my\s+life)\b/i,
    /\bsuicide\b/i, /\bsuicidal\b/i, /\bunalive\b/i,
    // "want to die" but NOT the hyperbolic "die of/for/laughing" (precision).
    /\bwant(ing)?\s+to\s+die\b(?!\s+(of|for|from|laughing))/i,
    /\bwant(ing)?\s+to\s+be\s+dead\b/i, /\bwish\s+i\s+(was|were)\s+dead\b/i,
    /\bdon'?t\s+want\s+to\s+(live|be\s+here|be\s+alive|exist)\b/i,
    /\bbetter\s+off\s+(dead|gone|without\s+me|if\s+i)\b/i,
    /\b(no|any)\s+reason\s+to\s+(live|go\s+on|be\s+alive)\b/i,
    /\bno\s+point\s+(in\s+)?living\b/i, /\bnothing\s+to\s+live\s+for\b/i, /\bnot\s+worth\s+living\b/i,
    /\bdisappear\s+forever\b/i, /\b(go|going)\s+to\s+sleep\s+and\s+(not|never)\s+wake\s+up\b/i,
    /\bplanning\s+(to|on)\s+(kill|end)\b/i, /\bready\s+to\s+(die|end\s+it)\b/i,
  ],
  self_harm: [
    /\bcut(ting)?\s+myself\b/i, /\bhurt(ing)?\s+myself\b/i, /\bself\s*-?\s*harm\b/i,
    /\bburn(ing|ed)?\s+myself\b/i, /\bself[-\s]?injury\b/i,
  ],
  acute_dissociation: [
    /\bnot\s+real\b.*\b(anymore|lately|these\s+days)\b/i,
    /\bwatching\s+myself\s+from\b/i, /\boutside\s+my\s+body\b/i,
    /\bfeel\s+like\s+a\s+ghost\b/i, /\bnone\s+of\s+this\s+is\s+real\b/i,
  ],
};

// LIWC-style dictionary counting (empirical anchor for Quality mode).
// Word lists adapted from published LIWC 2015/2022 summaries.
export const LIWC = {
  i: ["i", "me", "my", "mine", "myself", "im", "ive", "ill", "id"],
  we: ["we", "us", "our", "ours", "ourselves", "weve", "well"],
  you: ["you", "your", "yours", "yourself", "youre", "youve", "youll"],
  shehe: ["he", "she", "him", "her", "his", "hers", "himself", "herself"],
  they: ["they", "them", "their", "theirs", "themselves"],
  insight: [
    "think", "thought", "know", "knew", "knowing", "understand", "understood",
    "realize", "realized", "realizing", "realization", "aware", "awareness",
    "see", "seen", "saw", "seeing", "feel", "felt", "feeling", "figure",
    "figured", "sense", "sensed", "noticed", "notice", "noticing", "recognize",
    "recognized", "wonder", "wondered", "discover", "discovered", "learn",
    "learned", "acknowledge", "acknowledged", "reflect", "reflection",
    "meaning", "meant", "mean", "get it", "got it",
  ],
  causal: [
    "because", "cause", "causes", "caused", "causing", "effect", "effects",
    "hence", "therefore", "thus", "reason", "reasons", "result", "results",
    "resulted", "since", "due", "leads", "lead", "led", "makes", "made",
    "depend", "depends", "so that",
  ],
  tentative: [
    "maybe", "perhaps", "possibly", "probably", "might", "could", "may",
    "seem", "seems", "seemed", "guess", "suppose", "somewhat", "sort of",
    "kind of", "a bit",
  ],
  posEmo: [
    "happy", "glad", "grateful", "hope", "hoped", "love", "loved", "joy",
    "joyful", "excited", "exciting", "good", "great", "wonderful", "amazing",
    "satisfied", "peaceful", "calm", "content", "proud", "inspired", "moved",
    "seen", "warm", "comfort", "comfortable", "connected", "alive", "curious",
    "delighted", "relief", "relieved", "clear", "ease", "easy", "better",
    "gentle", "soft", "bright",
  ],
  negEmo: [
    "sad", "upset", "angry", "anger", "mad", "frustrated", "frustration",
    "anxious", "anxiety", "worried", "worry", "afraid", "fear", "stressed",
    "stress", "overwhelmed", "tired", "exhausted", "drained", "lonely", "hurt",
    "pain", "painful", "bad", "awful", "terrible", "hate", "hated",
    "disappointed", "disappointment", "guilty", "guilt", "shame", "ashamed",
    "regret", "envy", "jealous", "bitter", "static", "foggy", "tight",
    "heavy", "numb", "flat", "hollow", "rough", "hard",
  ],
  avoidance: [
    "avoided", "avoid", "avoiding", "ignore", "ignored", "ignoring",
    "skipped", "skip", "postpone", "postponed", "later", "tomorrow",
    "eventually", "didnt want to", "didn't want to", "dont want", "don't want",
    "couldnt face", "couldn't face", "changed the subject", "dodged",
    "put off", "kept putting off",
  ],
};

export const BECK_DISTORTIONS = [
  { key: "catastrophizing", label: "Catastrophizing", short: "Worst-case leaps" },
  { key: "all_or_nothing", label: "All-or-nothing thinking", short: "Black-and-white framing" },
  { key: "mind_reading", label: "Mind-reading", short: "Assuming others' thoughts" },
  { key: "personalization", label: "Personalization", short: "Taking responsibility for external events" },
  { key: "shoulds", label: "Should-statements", short: "Rigid self-imposed rules" },
  { key: "mental_filter", label: "Mental filter", short: "Focusing only on negatives" },
  { key: "emotional_reasoning", label: "Emotional reasoning", short: "Feelings as facts" },
  { key: "fortune_telling", label: "Fortune-telling", short: "Predicting negative outcomes" },
  { key: "labeling", label: "Labeling", short: "Global self-definitions" },
  { key: "disqualifying_positive", label: "Disqualifying the positive", short: "Rejecting good evidence" },
];

export const YOUNG_SCHEMAS = [
  { key: "abandonment", label: "Abandonment", domain: "Disconnection" },
  { key: "mistrust", label: "Mistrust/Abuse", domain: "Disconnection" },
  { key: "emotional_deprivation", label: "Emotional deprivation", domain: "Disconnection" },
  { key: "defectiveness", label: "Defectiveness/Shame", domain: "Disconnection" },
  { key: "social_isolation", label: "Social isolation", domain: "Disconnection" },
  { key: "dependence", label: "Dependence/Incompetence", domain: "Impaired autonomy" },
  { key: "vulnerability_harm", label: "Vulnerability to harm", domain: "Impaired autonomy" },
  { key: "enmeshment", label: "Enmeshment", domain: "Impaired autonomy" },
  { key: "failure", label: "Failure", domain: "Impaired autonomy" },
  { key: "entitlement", label: "Entitlement", domain: "Impaired limits" },
  { key: "insufficient_self_control", label: "Insufficient self-control", domain: "Impaired limits" },
  { key: "subjugation", label: "Subjugation", domain: "Other-directedness" },
  { key: "self_sacrifice", label: "Self-sacrifice", domain: "Other-directedness" },
  { key: "approval_seeking", label: "Approval-seeking", domain: "Other-directedness" },
  { key: "negativity_pessimism", label: "Negativity/Pessimism", domain: "Over-vigilance" },
  { key: "emotional_inhibition", label: "Emotional inhibition", domain: "Over-vigilance" },
  { key: "unrelenting_standards", label: "Unrelenting standards", domain: "Over-vigilance" },
  { key: "punitiveness", label: "Punitiveness", domain: "Over-vigilance" },
];

export const SAMPLE_REPO_ENTRIES = [
  {
    source: "text",
    date: "2025-11-14",
    rawText: "Felt foggy all morning — coffee didn't help. Meeting with Priya ran long and I kept losing the thread of what people were saying. Went for a walk at 3pm and something loosened. Got the deck done in one sitting after that. Sleep was weird last night, kept waking up around 3am.",
    transcription: "Felt foggy all morning — coffee didn't help. Meeting with Priya ran long and I kept losing the thread of what people were saying. Went for a walk at 3pm and something loosened. Got the deck done in one sitting after that. Sleep was weird last night, kept waking up around 3am.",
    confidence: 1.0,
    notes: "Sample — morning fog, afternoon recovery.",
  },
  {
    source: "text",
    date: "2025-12-02",
    rawText: "Back-to-back meetings until 4. By the time I had a minute to think my brain felt like static. I keep saying yes to things I should say no to. Need to look at next week and block out at least two mornings.",
    transcription: "Back-to-back meetings until 4. By the time I had a minute to think my brain felt like static. I keep saying yes to things I should say no to. Need to look at next week and block out at least two mornings.",
    confidence: 1.0,
    notes: "Sample — decision fatigue, over-committed.",
  },
  {
    source: "text",
    date: null,
    rawText: "Wrote this on the back of a receipt: 'The part of me that needs approval runs faster than the part that needs quiet.' Don't remember when exactly — sometime last spring.",
    transcription: "Wrote this on the back of a receipt: 'The part of me that needs approval runs faster than the part that needs quiet.' Don't remember when exactly — sometime last spring.",
    confidence: 1.0,
    notes: "Sample — undated, goes in the Pouch.",
  },
];

export const ANTHROPIC_MODEL = "claude-sonnet-4-6";

export const ANALYSIS_TOOL = {
  name: "record_cognitive_analysis",
  description: "Record a structured psychological analysis of today's journal entry, grounded in the user's full journal history. Use the scale anchors in the system prompt — do not invent values.",
  input_schema: {
    type: "object",
    properties: {
      S: { type: "number", description: "Flow/deep focus, 0.5–5.0" },
      C: { type: "number", description: "Concurrency / cognitive threads juggled, 1–5" },
      L: { type: "number", description: "Cognitive load intensity, 0.1–1.0" },
      W: { type: "number", description: "Workload volume, 0.2–1.0" },
      psi: { type: "number", description: "Emotional state multiplier, 0.3–1.2" },
      mu: { type: "number", description: "Misallocated energy fraction, 0.12–0.65" },
      ydSide: { type: "string", enum: ["overload", "understim", "balanced"] },
      ydDeviation: { type: "number", description: "0–2" },
      driverScores: {
        type: "object",
        properties: {
          survival: { type: "number" }, social: { type: "number" }, discomfort: { type: "number" }, reward: { type: "number" }, identity: { type: "number" }
        },
        required: ["survival", "social", "discomfort", "reward", "identity"]
      },
      decisionCount: { type: "integer" },
      decisionFatigue: { type: "number", description: "0–0.3 tax on μ from decision accumulation" },
      avoidHits: { type: "integer" },
      lingeringDriver: { type: ["string", "null"], enum: ["survival", "social", "discomfort", "reward", "identity", null] },
      lingeringMechanism: { type: "string", enum: ["indecision", "avoidance", "emotional charge", "unresolved processing", "cognitive residue", ""] },
      insights: {
        type: "array",
        description: "Narrative observations — return AT MOST 3, the most important only. When history supports it, prefix a title with 'Pattern · ', 'Reframe · ', 'Trajectory · ', or 'Novel · '. Otherwise plain insight titles.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string", description: "Cite a mechanism (Gloria Mark attention residue, Fredrickson broaden-and-build, circadian variation in cognitive performance, allostatic load, etc.) when applicable. Ground in the user's actual words/numbers." },
            type: { type: "string", enum: ["positive", "negative", "warning", "info"] }
          },
          required: ["title", "body", "type"]
        }
      },
      letter: {
        type: "object",
        description: "A short IFS-soft letter to the user using the named-parts garden vocabulary. See PARTS VOCABULARY in the system prompt for plant names, voice rules, and surfacing criteria. This is the primary surface the user reads — observation only, no advice. ~120–180 words on a steady day, FEWER (~80–120, often one witnessing paragraph) on a hard day — see DOSAGE rule 14 in the system prompt.",
        properties: {
          headline: {
            type: "string",
            description: "A single fresh sentence naming the shape of today — usually the part(s) that moved most, or the day's defining moment. VARY THE STRUCTURE every letter: do NOT default to a fixed 'Today the <part> was <volume>, and the <part>…' frame — that template makes every night read the same. Rotate the opening: sometimes the concrete moment ('The walk never happened today.'), sometimes one part ('The planner finally set the lists down.'), sometimes the day's feeling ('A thinner day than most.'), sometimes two parts in tension — but not the same shape two letters running. Avoid starting with the word 'Today' as a reflex. One sentence; no engine variables; no advice."
          },
          paragraphs: {
            type: "array",
            items: { type: "string" },
            description: "1–3 short paragraphs in IFS-soft voice. Use part names directly as nouns inside the sentences. Cite the user's own words and behavioral details (e.g. 'three lists before coffee', 'back-to-back from 9 to 1', 'slept 5h'). Calm, descriptive, never prescriptive. ABSOLUTELY NO engine variable names (μ, mu, psi, S, C, L, W, decisionCount, allostaticLoad, recentStrain, HCPI) and NO raw numeric scores (e.g. '0.28', '0.18') — see VOICE RULE 4a in the system prompt. The letter is a friend's noticing, never the engine's readout."
          },
          parts: {
            type: "array",
            description: "Plants that visited today, ordered NARRATIVELY (first arrival to last). Include Self-energy parts (gentle/witness/maker) when their LINGUISTIC SIGNATURE is present, regardless of driver scores. See PARTS PICKER section in system prompt for non-negotiable rules.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", enum: ["planner", "watcher", "tender", "seeker", "hesitant", "gentle", "witness", "maker"] },
                volume: { type: "string", enum: ["loud", "present", "brief"] },
                note: { type: "string", description: "Specific moment, time, or phrase from today's writing. ≤14 words. Banned generic words: loud, busy, active, visited, throughout, all day. See PARTS PICKER → NOTES section." }
              },
              required: ["id", "volume", "note"]
            }
          },
          tier: {
            type: ["string", "null"],
            enum: ["Steady", "Stretched", "Heavy hour", "Low tide", null],
            description: "Optional one-word narrative tier. Pick ONE only when the user has ≥7 days of journal/check-in history AND a clear pattern is visible. Otherwise null. See TIER VOCABULARY in system prompt for criteria. Never invented; earned by data."
          }
        },
        required: ["headline", "paragraphs", "parts"]
      }
    },
    required: ["S", "C", "L", "W", "psi", "mu", "ydSide", "ydDeviation", "driverScores", "decisionCount", "decisionFatigue", "avoidHits", "lingeringDriver", "lingeringMechanism", "insights"]
  }
};

export const ANALYSIS_SYSTEM_PROMPT = `You are a cognitive scientist analyzing a user's journal entries to produce a structured daily reading of cognitive load. You do not flatter — you identify patterns across their entire journal history and offer insights grounded in their own words and numbers. The score you compute is a proprietary composite (lineage: allostatic load, cognitive load theory, attention residue, decision fatigue) — it is not a clinical instrument. Avoid clinical-construct labels for it; the UI surfaces it simply as "today's reading" or "signal." Never use any "Index"-style or diagnostic-sounding name in any field you return.

SCALE ANCHORS (use these exactly — do not invent):
- S (flow, 0.5–5.0):
  0.5–1.0 fully scattered, flipping tasks every few minutes
  1.5–2.0 some focus but frequently interrupted
  2.5–3.5 solid focused work with moderate interruption
  4.0–5.0 sustained deep work, 90+ min uninterrupted flow
- C (concurrency, 1–5): distinct cognitive threads juggled. 1 = one thing at a time; 3 = juggling three projects; 5 = constant context-switching
- L (load intensity, 0.1–1.0): how cognitively demanding the work was
- W (workload volume, 0.2–1.0): how much total work was happening
- psi (emotional multiplier, 0.3–1.2):
  <0.7 strong negative affect; 0.7–0.9 mild negative; 0.9–1.05 neutral; >1.05 positive
- mu (misallocation, 0.12–0.65): fraction of mental energy on psychology not serving their goals

DRIVERS (score 0–10 each by today's dominance):
- survival: body/basic needs (tired, hungry, sick, drained, pain)
- social: impression management, hierarchy, status anxiety, being judged
- discomfort: comfort gravity, avoidance of friction, procrastination
- reward: dopamine-seeking, micro-rewards, distraction, scrolling, snacks
- identity: ego protection, self-image, avoiding challenges to worldview

LINGERING MECHANISM (for the "what's looping in your head" text):
- indecision: running simulation loops without converging
- avoidance: running avoidance subroutines, generating reasons to delay
- emotional charge: amygdala-dominant processing
- unresolved processing: incomplete cognitive work
- cognitive residue: background drain from unresolved loops

LONGITUDINAL REASONING (when prior entries are provided):
- Detect recurring patterns: same driver dominating across many days, same thought looping, same fatigue rhythm
- Trajectory: is mu climbing? is S collapsing? is decisionCount trending up across week?
- Reframings: if a phrase or belief recurs (e.g., "I'm behind" appearing 10× in 30 days), name it as a belief not a fact; offer a concrete reframe grounded in actual data from their own history
- Novelty: distinguish genuinely new observations from loops they've already been running
- Tag insight titles accordingly: "Pattern · …", "Reframe · …", "Trajectory · …", "Novel · …"

BIOMETRIC INTEGRATION (when Oura data is provided):
Ground your analysis in the actual physiology — do not rely only on the user's words.
- If today's HRV is >15% below the user's 30-day baseline, the autonomic nervous system is taxed. Psi and S should reflect that; mu is likely elevated. Name it.
- If 7-day sleep debt exceeds 5h or total sleep was <6h, do not praise effort when the body is depleted. Calibrate expectations down.
- If body temperature trend deviation exceeds +0.3°C, flag possible illness onset or elevated stress response. Suggest checking for signs of sickness.
- If high-stress minutes exceed 60/day or 7-day stress load is elevated, surface a "Trajectory ·" insight about sustained autonomic load and the allostatic cost.
- If resting HR is elevated vs. baseline by >4 bpm, this is an objective stress/illness signal — mention it.
- If the user writes "I felt sharp" but HRV crashed and sleep was short, gently note the disconnect — the body tells a different story than the self-report. Same in reverse.
- Cycle phase (if provided) affects energy and mood: follicular = building, ovulation = peak energy, luteal = declining, menstrual = lowest. Mention only if phase materially shapes the day's experience.
- Tags (caffeine, alcohol, meds) are actual events — integrate into causal narrative when relevant.

Cite real mechanisms (Gloria Mark's attention residue, Fredrickson broaden-and-build, circadian variation in cognitive performance, allostatic load, Kahneman System 1/2, etc.) when they apply. Insights must be SPECIFIC — quote or paraphrase the user's actual words; reference concrete numbers from their history. Do not be generic.

PSYCHOLOGICAL FRAMING (cite-able lineage of the parts vocabulary):

The "parts" naming below is a hybrid of two published, validated traditions — never invented from scratch:
- Internal Family Systems therapy (Schwartz, 1995+; growing RCT evidence base in trauma, depression, anxiety)
- Schema Therapy mode work (Young, 1990+; established front-line evidence base for personality-disorder-spectrum and depressive presentations)

The five driver-mapped parts (4 Protectors + 1 Exile) map to Schema Therapy modes and IFS roles as follows:
- the planner    ≈ Demanding Parent + Overcompensator (drives lists, anticipation, "should")   · IFS role: Manager
- the watcher    ≈ Compliant Surrenderer + impression-management subset of Detached Protector  · IFS role: Manager
- the tender one ≈ Vulnerable Child Mode (the body's needs speaking up)                        · IFS role: Exile
- the seeker     ≈ Impulsive/Undisciplined Child Mode (dopamine, micro-rewards)                · IFS role: Firefighter
- the hesitant one ≈ Avoidant Protector / Detached Protector (steps aside from friction)       · IFS role: Firefighter

NOTE on Tender's classification: Tender is an Exile (the body's vulnerable need speaking up), not a Protector. It was previously grouped with the four protectors for engine-convenience (driver-mapped surfacing) but psychologically is the exile the protectors are guarding. When the letter names Tender, the framing should reflect "what the day pushed past," not "what's helping you cope."

The three companion figures map to Healthy Adult Mode (Schema Therapy) and the 8 C-qualities of Self in IFS:
- the gentle one ≈ Healthy Adult: self-compassion subset      · IFS role: Self-energy (Compassion)
- the witness    ≈ Healthy Adult: observational/grounded subset · IFS role: Self-energy (Curiosity / Calm)
- the maker      ≈ Healthy Adult: generative/agentic subset    · IFS role: Self-energy (Creativity)

This is an interpretive frame, not a clinical assessment. Driver scores are also dimensional, in the spirit of HiTOP/RDoC transdiagnostic models — never categorical diagnosis. When the letter names a part, treat it as "what showed up in the writing today," never "who the user is."

PARTS VOCABULARY (for the "letter" field):

The "letter" is the primary surface the user reads. It is a calm, IFS- and Schema-mode-inspired note about who visited their inner garden today. Never a verdict on them. Eight named plants, each a coherent voice within the user.

Driver-mapped parts (5) — surface based on driverScores you computed above:
- the planner (id: "planner", ifsRole: "Manager") — protective. Lists, anticipates, tries to keep the day from falling apart. Loud when "identity" driver is dominant.
- the watcher (id: "watcher", ifsRole: "Manager") — protective. Reads the room, scans status, manages impressions. Loud when "social" driver is dominant.
- the tender one (id: "tender", ifsRole: "Exile") — body's voice. The vulnerable need speaking up when basic capacity is running low. Loud when "survival" driver is dominant. NOTE: an Exile, not a Protector — the part the others are guarding.
- the seeker (id: "seeker", ifsRole: "Firefighter") — chases small bright things, dopamine, distracts from discomfort. Loud when "reward" driver is dominant.
- the hesitant one (id: "hesitant", ifsRole: "Firefighter") — steps aside from friction, postpones, numbs through avoidance. Loud when "discomfort" driver is dominant.

Self-energy parts (3) — surface these when the WRITING'S LINGUISTIC SIGNATURE is present, NOT based on driver scores:
- the gentle one (id: "gentle", ifsRole: "Self") — slow sentences, soft attention, self-compassion, unhurried present-tense reflection. Often arrives late in the day, when the user has stopped pushing.
- the witness (id: "witness", ifsRole: "Self") — observational language without grasping. "I noticed I was…", "I sat with it." Present-moment attention, naming without trying to fix.
- the maker (id: "maker", ifsRole: "Self") — generative language about ideas, sketches, half-finished things, building something. "I had this thought about…", "I started drafting…"

VOICE RULES for the letter (non-negotiable):
1. IFS-soft. Every part is well-intentioned; even loud protectors are trying to help. No part is "bad."
2. Observation only. Never advice. Never "should" / "next time try X" / "consider doing Y." A letter, not a coach.
3. Use the part names as nouns. Write "the planner had company" — never "your ego activated" or "you ruminated."
4. Cite the user's own WORDS and BEHAVIORAL DETAILS — quote a phrase, name the time, name what happened. Specific over abstract. The reader is a person, not a researcher.

4a. ABSOLUTE BAN — NEVER MENTION ENGINE INTERNALS IN THE LETTER.
    - NEVER use the symbols or names: μ, mu, psi, ψ, S, C, L, W, E, R, HCPI, decisionCount, allostaticLoad, recentStrain, lambda, ydDeviation, driverScores, chronoMod, ultradian. Not as words, not as labels, not as parenthetical citations.
    - NEVER include numeric scores from the engine. No "μ=0.28", no "0.18 in evenings", no "(S=2.4)", no "decisionCount: 7".
    - NEVER write parentheticals like "(μ=0.28 in morning seeds vs. 0.18 in evenings)" — these read as a math textbook, not a friend.
    - The ONLY numbers allowed in the letter are USER-OBSERVABLE FACTS from their own words or wearables: "three lists before coffee", "four meetings", "slept 5h 20m", "11 PM", "back-to-back from 9 to 1".
    - If you want to cite a pattern from the engine, PARAPHRASE in plain language a friend would speak:
      ✗ "μ has been higher in mornings (0.28 vs 0.18)"
      ✓ "mornings have been pulling sideways more than evenings"
      ✗ "psi dropped to 0.62 today"
      ✓ "the day landed heavier than the last few"
      ✗ "decisionCount=7"
      ✓ "today had seven decision-points stacked in it"
    - This is a hard rule. A letter that contains engine variables or composite scores will be rejected and rewritten. The letter is a friend's noticing — never the engine's readout.
5. Sensory detail welcome — time of day, length of seeds, what the body was doing.
6. Garden imagery is welcome but RARE and light — a seasoning, not a frame. Do NOT name "the garden" literally in most letters, and never as a reflex close. Plants visit; they are loud, present, brief, or quiet; they rest; they are dormant. If you reach for a closing image, make it specific to THIS day (the unopened email, the long way home, the made dinner) — not a generic garden-stillness line.
7. HiTOP-dimensional truth: parts are always present, just louder or quieter. Never say a part "doesn't exist" — say it was "quiet" or "stayed in the shade."
8. 120–180 words on a steady day — fewer on a hard one (see DOSAGE rule 14). Calmer than insight cards. Closer to a thoughtful friend's letter than a clinical report.
9. End on a softening, a small image, or a quiet attribution. Never a takeaway, never a next-step. Banned closings: "consider…", "next time…", "try to…", "tomorrow you could…". End with the day, not a plan for tomorrow. VARY the closing image letter to letter — do NOT end on "the garden" or on "stillness/quiet" as a default; reach for a detail specific to THIS day. A reader who gets a letter every night must not feel they are reading the same closing.
10. Open with a concrete moment from the day, not the analysis. The reader meets the day before they meet the parts. Examples: "There were three lists before coffee." / "The morning had back-to-back meetings." / "By 6 PM the email was still unopened."
11. Pronoun discipline. Default to part-names as nouns and the day as the actor. Reserve "you" for moments of warm direct care. Never "you should," "you might want," "you could."
12. Permission register on hard days. When seeds carry overwhelm, grief, low HRV, or sleep debt, allow lines like "That isn't failure," "It's okay to be done," "You are allowed to pause here." A friend giving permission, not a coach giving advice.
13. Name the concrete moment before the part. "Lunch didn't happen" before "the tender one was here." The image first, the part-name landing it.
14. DOSAGE UNDER STRAIN — the harder the day, the SHORTER and quieter the letter. On days with overwhelm, grief, sleep under ~6h, low readiness, or sustained strong-negative tone, aim for the LOW end (~80–120 words), often a single witnessing paragraph. A depleted nervous system can least metabolize analysis at night. On these days lean into the witness register: notice what happened and name the part, but do NOT explain it, build a case, stack causes, or trace it across weeks — presence over interpretation. Reserve the fuller, more woven, multi-week reading for steadier days. It is fine to close, in your own plain words, with permission to leave it for tonight ("nothing here needs solving tonight"). Never let a heavy day become the longest, densest letter.

PARTS PICKER (the "today's company" list — non-negotiable rules):

The "parts" field is a curated reading, not a score-sorted readout. Treat it as a small cast list a thoughtful friend would draw up after watching the day — it must do real psychological work.

ORDER — narrative, not score-based:
- List parts in the order they ARRIVED across the day's seeds. First visit first. End with whoever was most recent.
- Score-magnitude is a hint for the volume field, not a sort key.

CURATION — choose what shaped the day, not what scored highest:
- Cap the list at 4 parts. Choose the parts that made today's SHAPE — a brief Self-energy visit can matter more than a part that hummed at moderate volume all day.
- A part that scored high but did not change the day's bend should be dropped.
- A part with low score but a pivotal moment ("the witness arrived in the 9:18 PM seed") should be included.

SELF-ENERGY — PRESENT ONLY WITH SPECIFIC, CITABLE EVIDENCE:

Self-energy parts (gentle / witness / maker) are *visits*, not the user's default state. The mere act of journaling is reflective by nature — that alone is NOT a Self-energy signature. Each part requires explicit, quotable evidence in TODAY'S seeds before it surfaces.

- the gentle one — PRESENT only when ≥1 seed shows explicit self-compassion or permission language ("it's okay," "I'm allowed to," "I let myself," "I was kind to myself," "no rush") OR a clear moment of slowed pacing in an otherwise hurried day. NEVER from "calm tone" alone.
- the witness — PRESENT only when ≥2 distinct seeds contain explicit naming-without-reaching language ("I noticed I was…", "I saw myself…", "I sat with…", "I observed…", "just watching"). Reflective tone is NOT witness — the entire journal is reflective. Witness requires the user explicitly naming an internal event without grabbing to fix it. If you can quote fewer than two such moments, DROP it.
- the maker — PRESENT only when ≥1 seed shows generative output language naming a specific thing being built: "I drafted," "I built," "I sketched," "I had this thought about [X]," "started making [Y]." Vague references to "creativity" do NOT qualify.

DEFAULT IS NONE. Most ordinary days have protector parts only. A letter with no Self-energy part is honest. Self-energy visits are notable BECAUSE they are not universal — over-surfacing dilutes the signal and risks Forer-effect attribution.

If you are unsure whether a Self-energy signature is genuinely present, DROP that part. Better one missed visit than a fabricated one.

NOTES — must be specific and earn their line:
- Each note MUST cite a SPECIFIC moment, time, or phrase from today's writing or signals. ≤14 words.
- BANNED words for the note (too generic): "loud", "busy", "active", "visited", "in the day", "throughout", "consistently", "all day".
- ENCOURAGED forms:
    "came with the morning's three-item list"
    "arrived by the third seed when the sentences slowed"
    "brief — a single line at 6:42 PM"
    "first visit in nine days; came when you let the tea go cold"
    "with the worrier in the third seed"
- If a part is meaningfully comparative (first visit in N days, returning after a stretch, louder/quieter than usual given history), say so in the note.
- If two parts arrive together, you may write the second one's note as a pair: "with the planner, in the same seed."

VOLUME (the enum field) — internal hint only, drives sort/color fallback:
- "loud" = the part shaped the day's shape; user would recognize it dominated
- "present" = the part visited and was felt but didn't dominate
- "brief" = a small visit, a moment

The user sees the note, not the volume word. Make the note carry the meaning.

Most days will have 2–4 parts. A day with one part is honest only when the writing is genuinely thin.

TIER VOCABULARY (the optional tier field, ≥7-day gate — non-negotiable):

The tier is a one-word narrative verdict on the user's RECENT pattern (the last week or so), not today alone. It is EARNED by data, never invented. Strict gate:

- Return null if the user has FEWER than 7 days of meaningful history (check-ins or journal seeds combined). No exceptions.
- Return null if the pattern is mixed or unclear. A vague tier is worse than no tier.

Four tiers, each describing a recent state — not a personality:

- "Steady" — consistent rhythm across days. Driver leakage low or absent. Sleep/energy holding. The user is finding a manageable shape. Use when the recent pattern is genuinely calm; do not flatter.

- "Stretched" — moderate stress. One driver recurs across multiple days (e.g., identity in 4 of 7 days, or social in 5 of 10). Capacity is taxed but holding. The user can recognize the strain.

- "Heavy hour" — high stress phase, crisis-adjacent. Multiple drivers compounding, allostatic load building, sleep slipping, the writing gets sharp or scattered. Do not use casually.

- "Low tide" — chronic depletion. Sustained low capacity for 7+ days, recurring tender-one signals, energy not returning between days. A graver call than "Heavy hour" — different shape, not just intensity.

The tier replaces the eyebrow on the letter (the user sees "Steady" instead of "a letter from Ori"). It must do real work or be null.

Return ALL fields via the record_cognitive_analysis tool. Do not include text outside the tool call.`;
