// Ori v2 — voice transcription confidence (the "did Ori hear that right?" layer).
//
// Deepgram returns a per-word confidence with every final result (alt.words).
// We keep ONLY the words it was unsure about, so the Day view can faintly
// underline them and the user can fix a mishear in one tap — before the wrong
// word ever drifts into the evening letter. Pure + dependency-free so the eval
// suite proves the logic under Node (scripts/eval-voice-confidence.mjs).
//
// Honesty: this is a transcription-quality hint about Deepgram's own output,
// never a claim about the user. The raw confidence number is never shown — only
// a quiet underline. Defensive throughout: any junk/changed shape degrades to
// "no flags", never a crash, so a Deepgram schema change can't break capture.

// Deepgram's own guidance: most words score >0.90 on clean audio, and ~0.65
// works as an error detector — words below are very likely a genuine mistake
// (developers.deepgram.com/docs/confidence). Below this line we flag the word.
export const LOW_CONF = 0.65;

// Normalize a token for matching: lowercase, strip surrounding punctuation, so
// "seen." / "Seen" / "(seen)" all match the stored low-confidence word "seen".
export function normalizeWord(w) {
  return String(w == null ? '' : w)
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '');
}

// From a Deepgram words array ([{ word | punctuated_word, confidence }]),
// return the normalized words below the threshold, de-duplicated (keeping the
// lowest confidence seen for each). Any non-array / malformed input yields [].
export function collectLowConf(words) {
  if (!Array.isArray(words)) return [];
  const out = new Map();
  for (const w of words) {
    if (!w || typeof w.confidence !== 'number') continue;
    if (w.confidence >= LOW_CONF) continue;
    const norm = normalizeWord(w.punctuated_word || w.word);
    if (!norm) continue;
    if (!out.has(norm) || w.confidence < out.get(norm)) out.set(norm, w.confidence);
  }
  return [...out.entries()].map(([w, c]) => ({ w, c }));
}

// Merge a freshly-collected batch into the running accumulator (across the
// streamed final chunks), keeping the lowest confidence per word. Returns a NEW
// array — callers can hold it in a ref without mutation surprises.
export function mergeLowConf(acc, batch) {
  const map = new Map((Array.isArray(acc) ? acc : []).map((e) => [e.w, e.c]));
  for (const e of (Array.isArray(batch) ? batch : [])) {
    if (!e || !e.w) continue;
    if (!map.has(e.w) || e.c < map.get(e.w)) map.set(e.w, e.c);
  }
  return [...map.entries()].map(([w, c]) => ({ w, c }));
}

// A Set of normalized low-confidence words, for render-time matching.
export function lowConfSet(lowConf) {
  return new Set((Array.isArray(lowConf) ? lowConf : []).map((e) => normalizeWord(e && e.w)).filter(Boolean));
}

// Split text into render tokens, preserving every character (including
// whitespace), flagging the tokens whose normalized form is a known
// low-confidence word. Returns [{ text, flagged }]. Whitespace is never
// flagged. INVARIANT: tokens.map(t => t.text).join('') === text exactly — we
// never drop or alter the user's words, only mark some of them.
export function tokenizeWithFlags(text, lowConf) {
  const src = String(text == null ? '' : text);
  if (!src) return [];
  const set = lowConfSet(lowConf);
  if (set.size === 0) return [{ text: src, flagged: false }];
  const parts = src.split(/(\s+)/); // keep the whitespace separators
  const tokens = [];
  for (const p of parts) {
    if (p === '') continue;
    if (/^\s+$/.test(p)) { tokens.push({ text: p, flagged: false }); continue; }
    tokens.push({ text: p, flagged: set.has(normalizeWord(p)) });
  }
  return tokens;
}
