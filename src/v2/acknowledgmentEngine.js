// Ori v2 — acknowledgment engine (Phase 3, Step 2). See docs/PARTS_PLAN.md.
//
// This is where the *intelligence works*: a focused model pass that reads a
// person's reflection about a part and judges whether they genuinely turned
// toward it. It mirrors the house transport exactly — the same
// fetchAnthropicWithRetry → /proxy/anthropic + Anthropic tool-use that
// generateLore / runClaudeClinicalPass use — but as its own small module so
// the heavy letter pass (engine.js / letterEngine.js) is untouched.
//
// Hard lines (also enforced downstream by acknowledgmentGate.validateAcknowledgment):
//   • Never clinical. The prompt forbids diagnosis/labels; the gate strips any
//     that slip through before anything is shown.
//   • Never a gate on the person. No consent → we ask (needsConsent), we do not
//     judge. Empty input or a model/network failure → fails SAFE (not validated,
//     no throw) so the UI falls back to the local gesture and the acknowledgment
//     still lands.
//
// Structure is split so everything except the network call is pure and offline-
// testable (scripts/eval-acknowledgment.mjs):
//   buildAcknowledgmentRequest()   pure  — the request body
//   parseAcknowledgmentResponse()  pure  — tool_use → raw judgment
//   judgeAcknowledgment()          async — consent + call + parse + gate
// The transport is lazy-imported so importing this module under Node never
// pulls in browser-only engine.js code.

import { validateAcknowledgment, STANCES, scanDistress } from './acknowledgmentGate.js';

// ── Consent (Phase 3 privacy decision) ────────────────────────────────────
// Reflections leave the device for the model (consistent with the letter
// engine). Two layers, in precedence order:
//   1. cpi_data_consent — the SINGLE informed consent taken at onboarding. It
//      names every off-device flow (journal text → Anthropic/OpenAI for the
//      Letter; voice → Deepgram to transcribe; reflections + distress detection
//      in the parts flow). Once given, the reflect flow does not re-ask.
//   2. cpi_reflection_consent — the per-feature fallback. Honors the legacy
//      "ask once in the reflect flow" path for users onboarded before the
//      unified consent, and lets someone WITHDRAW just the reflect purpose
//      (sentinel 'withdrawn') without losing the rest. 'withdrawn' always wins.
export const REFLECTION_CONSENT_KEY = 'cpi_reflection_consent';
export const DATA_CONSENT_KEY = 'cpi_data_consent';
// Bump when the disclosed flows change materially, to re-prompt at next onboarding.
export const DATA_CONSENT_VERSION = '2026-06-15';

// The global, onboarding-time informed consent. Versioned so a material change
// to what's disclosed can require a fresh grant.
export function hasDataConsent() {
  try {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(DATA_CONSENT_KEY);
    if (!raw) return false;
    // Tolerate both a bare 'granted' and a JSON record { granted, version }.
    if (raw === 'granted') return true;
    const rec = JSON.parse(raw);
    return rec?.granted === true && rec?.version === DATA_CONSENT_VERSION;
  } catch {
    return false;
  }
}
export function grantDataConsent() {
  try {
    localStorage?.setItem(DATA_CONSENT_KEY, JSON.stringify({
      granted: true, version: DATA_CONSENT_VERSION, at: new Date().toISOString(),
    }));
  } catch { /* quota — non-fatal */ }
}

export function hasReflectionConsent() {
  try {
    if (typeof localStorage === 'undefined') return false;
    const v = localStorage.getItem(REFLECTION_CONSENT_KEY);
    if (v === 'withdrawn') return false;      // explicit reflect withdrawal wins
    if (v === 'granted') return true;         // legacy per-feature grant
    return hasDataConsent();                  // else honor the unified consent
  } catch {
    return false;
  }
}
export function grantReflectionConsent() {
  try { localStorage?.setItem(REFLECTION_CONSENT_KEY, 'granted'); } catch { /* quota — non-fatal */ }
}
// Withdraw JUST the reflect purpose. Records a 'withdrawn' sentinel so it also
// overrides a broader cpi_data_consent — letters keep working, reflections stop.
export function revokeReflectionConsent() {
  try { localStorage?.setItem(REFLECTION_CONSENT_KEY, 'withdrawn'); } catch { /* non-fatal */ }
}

// ── The prompt — a friend witnessing, never a clinician ───────────────────
// The inviteDeeper bullet encodes the one piece of real method here: an
// IFS-informed "depth ladder" (the 6 F's — notice it → describe it → how you
// feel toward it → what it's trying to do → what it fears → what it needs),
// climbed only as far as the person's STANCE allows, and shaped by the KIND of
// part. When earlier turns are supplied, the question takes the NEXT step
// instead of restarting — the fix for "Say more just re-asks the opener".
export const ACK_SYSTEM_PROMPT = `You are a warm, perceptive friend helping someone notice a part of themselves inside a personal journal — in the spirit of Internal Family Systems. You are NOT a therapist. You NEVER diagnose, label, pathologize, or give medical or clinical judgments, and you never try to fix anything.

You are given a "part" (a recurring inner figure the app has named) and a short reflection the person wrote or spoke about it. If earlier turns of this same reflection are included, treat it as one continuing conversation. Judge ONLY:

• engaged — did they genuinely turn toward THIS part, in their own words? Be generous: a brief, raw, even angry or flooded reflection still counts as engaged as long as it is about the part. If the person uses clinical or diagnostic words about themselves (naming a condition, etc.), that does NOT disqualify them — judge by whether they turned toward the part, and simply keep your own reflectBack free of those clinical words. Mark engaged=false ONLY for genuine non-engagement: empty, a single word with no content, off-topic, the app's own description pasted back, gibberish, or a detached textbook definition of the part with no first-person turning-toward.
• stance — "toward" (some calm/curiosity/compassion), "blended" (the part has them flooded but they still turned toward it), or "away" (engaging it while pushing it off or describing it only from the head). All three still count as engaged.
• reflectBack — when engaged, ONE short line (≤ 25 words) that simply reflects what you heard, like a friend witnessing. No advice, no reassurance, no fixing, no clinical words. Empty when not engaged.
• inviteDeeper — ONE open, gentle question that takes them ONE small step deeper into THIS part, like a caring friend. Meet them where they are:
  – stance "away" (heady, or holding it at arm's length): don't push for depth — invite them to notice where they feel it in the body, or what it's like, as a soft way back in.
  – stance "blended" (flooded, taken over by it): help them find a little space FIRST ("is there a bit of room between you and that feeling?") before anything deeper.
  – stance "toward" (some openness): you may go a step further — what the part might be trying to do for them, what it's afraid would happen if it stopped, or what it needs.
  Fit the KIND of part too (named in the guidance line): a protective part → what it's trying to protect or what it fears; a tender, vulnerable part → what it needs right now, gently, never an interrogation; a calm/settled/creative presence → simply invite them to stay with it a moment, don't probe.
  If earlier turns are given, BUILD ON what they already said and never re-ask a question they've answered — take the next small step. Never leading, never advice, never "why are you like this", never a yes/no question. Always optional; offer it especially when not engaged, as a soft way in.
• concern — set true ONLY when the reflection shows a genuine signal the person may be at risk: EXPLICIT (self-harm, suicidal thoughts, wanting to not exist / disappear / "not be here", intent to hurt themselves) OR a CLEAR IMPLICIT signal of hopelessness about LIVING itself — that life or everything is pointless or that nothing matters anymore ("what's the point of any of this", "nothing matters", "why even bother" said broadly about everything, not about one task), that others would be better off without them, or "I can't go on / I can't do this anymore" said about their LIFE. Require a real signal about living or self-harm; do NOT infer one from ordinary hard feelings. Ordinary overwhelm, stress, exhaustion, sadness, burnout, venting, "a lot going on", "I can't keep up", frustration, or being "done" with a task / a job / this exercise are NOT concern — even when intense, heavy, or vaguely worded. When it is only ordinary distress with no clear signal about living or self-harm, set concern=false and respond with a normal acknowledgment; an unwanted crisis card on ordinary venting is itself a harm. (Explicit risk phrases are already caught before you ever see them; your job is the genuine implicit signal, not a guess.) When concern is true, do NOT write a reflectBack or inviteDeeper that deepens into it — leave them empty. The app will respond with care and human support, not a routine acknowledgment.

Record your judgment via the record_acknowledgment tool.`;

export const ACK_TOOL_NAME = 'record_acknowledgment';
export const ACK_MODEL = 'claude-sonnet-4-6';

// A model-only role hint for the depth ladder — which lane of the inviteDeeper
// guidance applies. NEVER surfaced to the user (PartDetail's copy rule); it only
// rides along in the request so the question fits the part. `tender` is kind
// 'protector' in the driver map but is the one vulnerable/exile figure, so it
// gets its own lane.
function roleHintFor(part) {
  if (!part) return 'an inner part';
  if (part.kind === 'companion') return 'a calm, settled inner presence — to be received, not probed';
  if (part.id === 'tender') return 'a tender, vulnerable part that carries unmet needs';
  return 'a protective part';
}

// Pure: assemble the /proxy/anthropic request body for one reflection.
//
// `thread` (optional) is the prior turns of THIS sitting, oldest first:
//   [{ q: "the question Ori asked", a: "what they answered" }, …]
// When present it's included so the model deepens instead of restarting — the
// continuity fix for "Say more". Empty/absent → a single-shot reflection,
// identical to before.
export function buildAcknowledgmentRequest(reflection, part, thread = []) {
  const partLine = part
    ? `${part.name || part.id}${part.desc ? ` — ${part.desc}` : ''}`
    : '(unknown part)';
  const guidance = `(For your guidance only — never name this to the person: this is ${roleHintFor(part)}.)`;
  let priorBlock = '';
  if (Array.isArray(thread) && thread.length) {
    const turns = thread
      .filter((t) => t && (t.q || t.a))
      .map((t) => `Ori asked: ${String(t.q || '(opening)').trim()}\nThey answered: "${String(t.a || '').trim()}"`)
      .join('\n\n');
    if (turns) {
      priorBlock = `EARLIER IN THIS REFLECTION (oldest first):\n${turns}\n\nNOW THEY ADDED:`;
    }
  }
  const body = priorBlock
    ? `PART: ${partLine}\n${guidance}\n\n${priorBlock}\n"""\n${String(reflection || '').trim()}\n"""\n\nBuild on what they already said — take the next small step, never re-ask. Judge it via ${ACK_TOOL_NAME}.`
    : `PART: ${partLine}\n${guidance}\n\nTHE PERSON'S REFLECTION:\n"""\n${String(reflection || '').trim()}\n"""\n\nJudge it via ${ACK_TOOL_NAME}.`;
  const user = body;
  return {
    model: ACK_MODEL,
    max_tokens: 300,
    system: ACK_SYSTEM_PROMPT,
    tools: [{
      name: ACK_TOOL_NAME,
      description: 'Record the acknowledgment judgment for one reflection about a part.',
      input_schema: {
        type: 'object',
        properties: {
          engaged: { type: 'boolean', description: 'Did they genuinely turn toward this part in their own words?' },
          stance: { type: 'string', enum: STANCES, description: 'toward / blended / away. Only when engaged.' },
          reflectBack: { type: 'string', description: 'One short witnessing line when engaged; empty otherwise. Never clinical.' },
          inviteDeeper: { type: 'string', description: 'One open, gentle question — a friend helping them reestablish what they think it is. Optional.' },
          concern: { type: 'boolean', description: 'True if the reflection shows any sign of self-harm or crisis. When true, the app routes to support instead of a normal acknowledgment.' },
        },
        required: ['engaged'],
      },
    }],
    tool_choice: { type: 'tool', name: ACK_TOOL_NAME },
    messages: [{ role: 'user', content: user }],
  };
}

// Pure: pull the tool_use input out of an Anthropic response. Null if absent.
export function parseAcknowledgmentResponse(data) {
  const toolUse = (data?.content || []).find(
    (c) => c?.type === 'tool_use' && c?.name === ACK_TOOL_NAME,
  );
  return toolUse?.input ?? null;
}

/**
 * Judge one reflection about a part.
 *
 * @param {string} reflection
 * @param {object} part  PARTS_LIB entry ({ id, name, desc, ... })
 * @param {object} [opts]
 * @param {function} [opts.call]    transport override (tests inject a stub); defaults
 *                                  to the lazy-imported fetchAnthropicWithRetry.
 * @param {boolean}  [opts.consent] consent override; defaults to hasReflectionConsent().
 * @param {Array}    [opts.thread]  prior turns of this sitting, oldest first:
 *                                  [{ q, a }, …]. Lets "Say more" deepen instead
 *                                  of restart. Each new turn is still scanned for
 *                                  distress before it is ever sent.
 * @returns {Promise<object>} either { needsConsent: true } (UI must ask first),
 *   or a validateAcknowledgment() result ({ validated, stance, reflectBack,
 *   inviteDeeper, problems, partId }). Never throws.
 */
export async function judgeAcknowledgment(reflection, part, { call, consent, thread = [] } = {}) {
  const hasConsent = consent ?? hasReflectionConsent();
  if (!hasConsent) return { needsConsent: true };

  // Empty input never burns a model call — return a safe not-validated result.
  if (typeof reflection !== 'string' || reflection.trim().length === 0) {
    return validateAcknowledgment({ engaged: false }, { part });
  }

  // Safety: explicit risk language routes straight to support — no model call,
  // so there is no chance of a deepening probe. Runs on every turn (including
  // each "Say more"), before anything is sent. The model's own `concern` flag
  // (handled by the gate, below) is the secondary net for phrasings the lexicon
  // misses.
  if (scanDistress(reflection)) {
    return validateAcknowledgment(null, { part, concern: true });
  }

  try {
    const callFn = call || (await import('../engine.js')).fetchAnthropicWithRetry;
    const data = await callFn(buildAcknowledgmentRequest(reflection, part, thread));
    return validateAcknowledgment(parseAcknowledgmentResponse(data), { part });
  } catch {
    // Offline / proxy down / malformed — fail safe. The acknowledgment still
    // lands locally; it just isn't validated this time.
    return validateAcknowledgment(null, { part });
  }
}
