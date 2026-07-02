// Ori v2 — the acknowledgment guardrail.
//
// Phase 3 of the Parts model (see docs/PARTS_PLAN.md). When a user reflects on
// a part (spoken or written), the MODEL judges whether they genuinely turned
// toward it — engaged? in what stance? — and writes one mirrored line back.
// That judgment is the *intelligence working*; it does NOT live here.
//
// This module is the guardrail AROUND that judgment, the exact analog of
// letterGate.validateLetter: a pure function (no DOM, no React, no model call)
// that takes the model's raw output and makes it safe to use. The eval suite
// (scripts/eval-acknowledgment.mjs) exercises this same code under Node.
//
// Two non-negotiables, both enforced here:
//   1. NEVER a clinical judgment. Anything shown to the user is scanned with
//      the shared CLINICAL_LEXICON; a mirror/invite carrying clinical language
//      is dropped, not surfaced. (Reuses letterGate's lexicon — one source.)
//   2. NEVER a gate on the person. A "not engaged" result is not a rejection:
//      it returns validated:false so the UI falls back to the local-only
//      gesture — the acknowledgment still lands, just unvalidated. Malformed
//      model output fails SAFE (validated:false, no crash), never fails closed.

import { CLINICAL_LEXICON } from './letterGate.js';

// IFS stance of the reflection toward the part. `toward` = some Self-energy /
// separation (curiosity, compassion); `blended` = the part has them flooded
// but they still turned toward it; `away` = engaging the part while pushing it
// off or intellectualizing it. All three still *land* — stance only colors the
// mirror, it never blocks.
export const STANCES = ['toward', 'blended', 'away'];

// One mirrored line, not a paragraph. Bounds the witnessing so the model can't
// turn it into prose (or smuggle a clinical mini-essay past the lexicon).
export const MAX_MIRROR_LEN = 240;

// ── Distress backstop — a crisis is NEVER a routine acknowledgment ─────────
// A deterministic phrase scan beneath the model's own `concern` flag: explicit
// risk language routes straight to support, suppressing any mirror/probe so the
// app can never invite someone to deepen into self-harm ideation. Substring,
// lowercased; biased toward catching (a false positive just shows a support
// message — the safe direction). This is NOT a diagnosis, and NOT a substitute
// for clinical/legal review of the actual support content the UI will show.
export const DISTRESS_LEXICON = [
  'better off without me', 'better off if i',
  "wasn't here anymore", 'wasnt here anymore',
  "weren't here anymore", 'werent here anymore', 'not be here anymore',
  'want to die', 'wanna die', "don't want to be alive", 'dont want to be alive',
  "don't want to be here", 'dont want to be here',
  'kill myself', 'killing myself', 'end my life', 'end it all',
  'hurt myself', 'harm myself', 'no reason to live',
  'disappear forever', 'suicide', 'suicidal',
  // High-precision additions (variants/evasions of the above). Each is an
  // UNAMBIGUOUS risk phrasing — substring-safe. Ambiguous soft signals ("I
  // can't do this anymore", "what's the point") are deliberately NOT here:
  // they're context-dependent and handled by the model's `concern` judgment, so
  // the deterministic tier never over-routes ordinary venting. (Terms like
  // "kms"=kilometers, "cut myself [shaving]", "cutting myself [some slack]",
  // "overdose on [caffeine]" were considered and rejected for substring
  // collisions — they'd flag benign text.)
  'kill my self', 'killmyself', 'end myself', 'end my self',
  'unalive', 'want to be dead', 'wanna be dead',
  'wish i was dead', 'wish i were dead',
  "wish i wasn't here", 'wish i wasnt here', "wish i weren't here",
  "don't want to live", 'dont want to live', 'do not want to live',
  'better off dead', 'better off gone',
  'no point in living', 'no point living', 'nothing to live for', 'no will to live',
  'self harm', 'self-harm', 'take my own life', 'taking my own life', 'took my own life',
];

export function scanDistress(text) {
  const lower = String(text || '').toLowerCase();
  return DISTRESS_LEXICON.some((term) => lower.includes(term));
}

function scanClinical(text) {
  const lower = String(text || '').toLowerCase();
  const hits = [];
  for (const term of CLINICAL_LEXICON) if (lower.includes(term)) hits.push(term);
  return hits;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// Sanitize a user-facing line: drop it entirely if it carries clinical
// language (never show a clinical judgment), else trim and bound its length.
// Returns { text, problem } — text is null when dropped.
function safeLine(value, label) {
  if (!isNonEmptyString(value)) return { text: null, problem: null };
  const trimmed = value.trim();
  const hits = scanClinical(trimmed);
  if (hits.length) return { text: null, problem: `${label} clinical: ${hits.join(', ')}` };
  const text = trimmed.length > MAX_MIRROR_LEN ? trimmed.slice(0, MAX_MIRROR_LEN).trim() : trimmed;
  return { text, problem: null };
}

/**
 * Guardrail around the model's acknowledgment judgment.
 *
 * @param {object} modelOut  what the model returned: { engaged, stance, reflectBack, inviteDeeper }
 * @param {object} [opts]
 * @param {{id?:string}} [opts.part]  the part being reflected on (for partId echo)
 * @returns {{
 *   validated: boolean,      // engaged===true → a validated self-report acknowledgment
 *   stance: string|null,     // normalized enum, or null when not engaged
 *   reflectBack: string|null,// safe, bounded mirror line — or null if absent/dropped
 *   inviteDeeper: string|null,// safe, bounded gentle invite — or null
 *   problems: string[],      // non-fatal notes for telemetry/eval; NEVER shown to the user
 *   partId: string|null,
 * }}
 *
 * Note the shape has no `ok`/reject field by design: there is no value this
 * function can return that blocks the person. The caller always lands the
 * acknowledgment; `validated` only decides whether it also counts on the
 * separate descriptive axis and whether a mirror is shown.
 */
export function validateAcknowledgment(modelOut, { part = null, concern = false } = {}) {
  const problems = [];
  const raw = modelOut && typeof modelOut === 'object' ? modelOut : {};
  const partId = part?.id ?? (typeof raw.partId === 'string' ? raw.partId : null);

  // Safety first: any distress signal — passed in by the engine's deterministic
  // scan, or flagged by the model — overrides everything. Never validate it as
  // a routine acknowledgment; never surface a model-authored mirror/probe that
  // could deepen the thought. The UI shows a fixed, caring support response.
  if (concern === true || raw.concern === true) {
    return {
      validated: false, concern: true, stance: null,
      reflectBack: null, inviteDeeper: null,
      problems: ['distress signal — routed to support'], partId,
    };
  }

  if (!modelOut || typeof modelOut !== 'object') problems.push('no model output; failing safe');

  // engaged: strict boolean. Anything that isn't literally true is treated as
  // not-engaged — conservative, but NOT a block (caller falls back to local).
  const validated = raw.engaged === true;

  // stance: only meaningful when engaged; normalize to the enum, default
  // 'toward' if engaged but the model omitted/garbled it.
  let stance = null;
  if (validated) {
    if (STANCES.includes(raw.stance)) {
      stance = raw.stance;
    } else {
      stance = 'toward';
      problems.push(`stance missing/invalid (${JSON.stringify(raw.stance)}); defaulted to toward`);
    }
  }

  // reflectBack + inviteDeeper: the only user-facing strings. Sanitize both.
  // The model authors them (the intelligence) — we never invent copy here; we
  // only pass through what is safe, or null. UI owns any neutral fallback.
  const mirror = safeLine(raw.reflectBack, 'reflectBack');
  if (mirror.problem) problems.push(mirror.problem);
  const invite = safeLine(raw.inviteDeeper, 'inviteDeeper');
  if (invite.problem) problems.push(invite.problem);
  // The deepening invite is a friend's question — it asks, it doesn't tell.
  // Format guardrail only: flag a non-question. The *openness* and warmth of
  // the question are the model's job, pinned by PROBE_CALIBRATION, not here.
  if (invite.text && !invite.text.includes('?')) {
    problems.push('inviteDeeper is not a question');
  }

  return {
    validated,
    concern: false,
    stance,
    reflectBack: mirror.text,
    inviteDeeper: invite.text,
    problems,
    partId,
  };
}
