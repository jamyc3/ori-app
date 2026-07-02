// Ori v2 — per-user voice vocabulary (Deepgram keyterm prompting, Nova-3).
//
// The complaint that started this: a few spoken words come through wrong, and a
// misheard NAME is the worst kind — "Maya" → "my a", "Devi" → "Davey". Deepgram
// can be told the terms to expect ("keyterm prompting", up to 100 terms / 500
// tokens; developers.deepgram.com/docs/keyterm). The honest, self-improving
// source for those terms is the user's OWN journal: the recurring proper nouns
// they keep writing — names of people, places, projects. We feed those back so
// the next dictation gets them right. And because the Edit feature lets a user
// correct a misheard name, the correction re-enters the journal and boosts the
// vocabulary next time — a virtuous loop.
//
// Privacy: these are words the user already says aloud, so the audio carries
// them to Deepgram regardless; sending them as keyterms exposes nothing new.
// Pure + dependency-free so the eval suite can prove it under Node.

// High-frequency words that get capitalised at the start of a sentence — never
// names, so they must never become keyterms even if they appear capitalised.
const STOP = new Set([
  'the', 'a', 'an', 'and', 'but', 'or', 'so', 'i', 'it', 'we', 'they', 'he',
  'she', 'you', 'my', 'me', 'this', 'that', 'today', 'tonight', 'yesterday',
  'tomorrow', 'then', 'there', 'here', 'when', 'what', 'why', 'how', 'still',
  'just', 'maybe', 'after', 'before', 'every', 'some', 'one', 'two',
]);

export const MAX_KEYTERMS = 40;   // well under Deepgram's 100-term / 500-token cap
const MIN_OCCURRENCES = 2;        // recurring, not a one-off

function entryText(e) {
  return String((e && (e.transcription || e.rawText || e.text)) || '');
}

// A proper-noun-like token: starts with a capital letter, the rest lower/letters,
// 3..20 chars. Sentence-initial position (index 0 of its entry) is excluded by
// the caller, since that capital is just grammar, not a name.
function properNoun(raw) {
  const t = raw.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
  if (t.length < 3 || t.length > 20) return null;
  if (!/^\p{Lu}[\p{L}'’-]+$/u.test(t)) return null;
  if (STOP.has(t.toLowerCase())) return null;
  return t;
}

// Build the keyterm list from journal entries: recurring proper nouns, most
// frequent first, capped. Returns [] for thin/empty input (→ no boost, no harm).
export function buildKeyterms(entries, { max = MAX_KEYTERMS } = {}) {
  const counts = new Map();
  for (const e of (Array.isArray(entries) ? entries : [])) {
    const words = entryText(e).split(/\s+/);
    for (let i = 0; i < words.length; i += 1) {
      if (i === 0) continue; // skip the sentence-initial capital (grammar, not a name)
      const name = properNoun(words[i]);
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= MIN_OCCURRENCES)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, max))
    .map(([w]) => w);
}

// Append keyterm params to a Deepgram listen URL. Encodes each term; safe with
// the existing query string (the base URL already carries model/format params).
export function withKeyterms(baseUrl, keyterms) {
  let url = String(baseUrl || '');
  for (const t of (Array.isArray(keyterms) ? keyterms : [])) {
    if (t && typeof t === 'string') url += `&keyterm=${encodeURIComponent(t)}`;
  }
  return url;
}
