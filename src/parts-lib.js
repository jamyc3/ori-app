// Parts library — the data + pure derivation helpers behind Ori's "parts".
//
// Extracted from LetterReading.jsx so this logic is importable without pulling
// in React/JSX (the letter-reading *view* still lives there and re-exports all
// of this for its existing callers). Single source of truth for part
// names/glyphs/colors and for turning engine output into a visited-parts list,
// shared across LetterReading, GardenKeeper, the v2 surfaces, and the simulator.

export const GP = {
  bg: "#F7F3EC",
  paper: "#FFFCF6",
  ink: "#2B2824",
  muted: "#958E84",
  faint: "#B8B09D",
  line: "rgba(45,42,36,0.12)",
  hair: "rgba(45,42,36,0.07)",
  leaf: "#3F5B39",
  moss: "#6A8A5C",
  sage: "#A3B88A",
  bloom: "#C98660",
  sepia: "#705B3C",
};

// 1:1 driver-to-part map. Stable; engine drivers don't change without intent.
// Each `driverKey` lets the Keeper compute "last seen" by walking history.
export const DRIVER_TO_PART = {
  identity: {
    id: "planner", name: "the planner", nameBn: "গোছানো মন", glyph: "✿", color: GP.leaf, driverKey: "identity", kind: "protector",
    desc: "Holds the shape of the day so it doesn't fall apart. Steps forward when life gets loud — quiet when it doesn't need to be.",
    descBn: "দিনটাকে গুছিয়ে রাখে যাতে সব এলোমেলো না হয়ে যায়। জীবন যখন জোরালো, তখন এগিয়ে আসে — দরকার না হলে চুপ থাকে।",
  },
  social: {
    id: "watcher", name: "the watcher", nameBn: "খেয়াল-রাখা মন", glyph: "❉", color: GP.leaf, driverKey: "social", kind: "protector",
    desc: "Reads the room. Catches the tone, the look, who said what. Almost always well-meaning — trying to keep you on good footing with the people who matter.",
    descBn: "চারপাশটা পড়ে নেয়। সুর, চাহনি, কে কী বলল — সব খেয়াল রাখে। প্রায় সবসময়ই ভালো চায়, প্রিয় মানুষদের সঙ্গে সম্পর্ক ঠিক রাখতে চায়।",
  },
  survival: {
    id: "tender", name: "the tender one", nameBn: "শরীরের ডাক", glyph: "❋", color: GP.bloom, driverKey: "survival", kind: "protector",
    desc: "The body's gentle voice. Speaks up when basic needs are running low — sleep, food, rest. Worth listening to when it visits.",
    descBn: "শরীরের কোমল কণ্ঠ। ঘুম, খাওয়া, বিশ্রাম কমে এলে আওয়াজ তোলে। এলে শোনা ভালো।",
  },
  reward: {
    id: "seeker", name: "the seeker", nameBn: "চঞ্চল মন", glyph: "❁", color: GP.moss, driverKey: "reward", kind: "protector",
    desc: "Chases small bright things. Notifications, sweet snacks, the next click. Not bad — worth noticing when it stays past dusk.",
    descBn: "ছোট ছোট ঝলমলে জিনিসের পিছনে ছোটে — নোটিফিকেশন, মিষ্টি, পরের ক্লিক। খারাপ নয় — সন্ধে পেরিয়েও থাকলে খেয়াল করা ভালো।",
  },
  discomfort: {
    id: "hesitant", name: "the hesitant one", nameBn: "দ্বিধার মন", glyph: "❦", color: GP.sepia, driverKey: "discomfort", kind: "protector",
    desc: "Steps aside from friction. Postpones, sidesteps, finds a smoother path. Often misread — what looks like avoidance is usually your energy trying to protect itself.",
    descBn: "ঝামেলা থেকে একটু সরে যায়। পিছিয়ে দেয়, পাশ কাটায়, সহজ পথ খোঁজে। যা এড়ানো মনে হয়, তা আসলে শক্তি নিজেকে বাঁচাতে চাওয়া।",
  },
};

// Companions — non-protector figures Ori names from positive linguistic
// signals. NOT IFS Self-energy parts: in canonical IFS, Self is unitary
// and expressed via 8 C qualities (calm, curiosity, clarity, compassion,
// confidence, courage, creativity, connectedness), not as discrete parts.
// We use a hybrid model — five protector parts plus three companion
// figures — and own that as a hybrid, not as IFS-pure.
//
// `driverKey` is null because companions don't map to engine drivers.
// `kind` distinguishes them from protectors at render time, lets the
// Keeper surface honest framing instead of pretending these are IFS Self.
export const SELF_PARTS = {
  gentle: {
    id: "gentle", name: "the gentle one", nameBn: "স্নিগ্ধ মন", glyph: "❀", color: GP.bloom, driverKey: null, kind: "companion",
    desc: "Slow sentences, soft attention. Often arrives late in the day, around the time shoulders drop.",
    descBn: "ধীর কথা, কোমল মনোযোগ। প্রায়ই দিনের শেষে আসে, যখন কাঁধটা একটু নেমে আসে।",
  },
  witness: {
    id: "witness", name: "the witness", nameBn: "সাক্ষী মন", glyph: "❃", color: GP.sepia, driverKey: null, kind: "companion",
    desc: "Just notices. No agenda. The voice that holds the others without needing them to change.",
    descBn: "শুধু লক্ষ্য করে। কোনো তাড়া নেই। যে কণ্ঠ বাকিদের ধরে রাখে, বদলাতে না চেয়ে।",
  },
  maker: {
    id: "maker", name: "the maker", nameBn: "গড়ার মন", glyph: "✾", color: GP.sage, driverKey: null, kind: "companion",
    desc: "Wants to build. Shows up in seeds about ideas, sketches, half-finished things.",
    descBn: "নতুন কিছু গড়তে চায়। আইডিয়া, স্কেচ, আধখানা-করা জিনিসের কথায় দেখা দেয়।",
  },
};

// Full library used by the Garden Keeper page (Phase 2). Kept here so
// names/glyphs/colors stay coherent across letter and keeper.
export const PARTS_LIB = {
  ...Object.fromEntries(Object.values(DRIVER_TO_PART).map(p => [p.id, p])),
  ...SELF_PARTS,
};

// Localized display label / description for a part. `lang === "bn"` returns the
// Bengali label when present, else falls back to English. Pure — callers pass the
// current language so the Node eval suite stays deterministic.
export function partLabel(part, lang) {
  if (!part) return "";
  return lang === "bn" && part.nameBn ? part.nameBn : (part.name || "");
}
export function partDescOf(part, lang) {
  if (!part) return "";
  return lang === "bn" && part.descBn ? part.descBn : (part.desc || "");
}

// Bucket a relative score into a volume word.
function volumeFor(score, maxScore) {
  if (!maxScore || score <= 0) return null;
  const ratio = score / maxScore;
  if (ratio >= 0.66) return "loud";
  if (ratio >= 0.33) return "present";
  return "brief";
}

// Pull the visited-today plant list from engine output.
//   driverScores  : { identity: 4, social: 1, survival: 0, reward: 2, discomfort: 0 }
//   tone          : "positive" | "negative" | "neutral"  (optional)
// Returns: [{ part, volume, note? }] sorted by score desc, max 4 entries.
//
// Phase 1.1 fallback path. When the engine returns a `letter.parts` array
// (Claude-curated), prefer that via visitedPartsFromLetter() instead.
export function visitedPartsFromResult(driverScores = {}, tone = "neutral") {
  const entries = Object.entries(driverScores).filter(([k]) => DRIVER_TO_PART[k]);
  const max = Math.max(0, ...entries.map(([, v]) => v));
  const visited = entries
    .map(([k, v]) => ({ part: DRIVER_TO_PART[k], volume: volumeFor(v, max), score: v }))
    .filter(x => x.volume)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ part, volume }) => ({ part, volume }));

  // If the day was quiet (no driver loud) and the tone is positive, the
  // gentle one came through. This is a soft heuristic only used when the
  // engine didn't return its own letter.parts (Phase 1.0 fallback).
  const quietDay = visited.length === 0 || visited.every(v => v.volume === "brief");
  if (quietDay && tone === "positive") {
    visited.unshift({ part: SELF_PARTS.gentle, volume: "present" });
  }
  return visited;
}

// Phase 1.1: prefer Claude's curated parts list when the engine returns one.
// Schema: result.a.letter.parts = [{ id, volume, note }]. Each id must be a
// known PARTS_LIB key. Unknown ids are dropped silently. Returns [] if the
// letter is missing or malformed — caller falls back to driver-derived list.
export function visitedPartsFromLetter(letter) {
  if (!letter || !Array.isArray(letter.parts)) return [];
  return letter.parts
    .map(p => {
      const part = PARTS_LIB[p?.id];
      if (!part) return null;
      const volume = (p.volume === "loud" || p.volume === "present" || p.volume === "brief") ? p.volume : "present";
      return { part, volume, note: typeof p.note === "string" ? p.note : null };
    })
    .filter(Boolean)
    .slice(0, 5);
}

// Single source of truth used by both LetterReading and GardenKeeper.
// Prefers the LLM-curated list; falls back to driver-derived heuristic.
export function visitedPartsFromAnalysis(a, tone = "neutral") {
  const fromLetter = visitedPartsFromLetter(a?.letter);
  if (fromLetter.length > 0) return fromLetter;
  return visitedPartsFromResult(a?.driverScores || {}, tone);
}

// Compose the headline. One or two parts → simple sentence; nothing → quiet.
export function headlineFor(visited) {
  if (visited.length === 0) {
    return "A quiet day. The garden was its own company.";
  }
  if (visited.length === 1) {
    const v = visited[0];
    return `Today ${v.part.name} was ${v.volume}.`;
  }
  const a = visited[0], b = visited[1];
  return `Today ${a.part.name} was ${a.volume}, and ${b.part.name} was ${b.volume}.`;
}
