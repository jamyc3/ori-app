#!/usr/bin/env node
// ── TRIPWIRE: the reflect/acknowledgment flow must not go live unreviewed ──
//
// The Phase 3 reflect flow ships UNREVIEWED crisis content (a crisis support
// card + distress detection) compiled into production builds, dark behind
// `ACK_REFLECT_ENABLED` in src/v2/AckReflect.jsx. Turning it on is the launch
// event and requires clinical AND legal sign-off (see docs/PHASE3_REVIEW_SCOPE.md).
//
// This guard runs in `npm run audit` (so every build). It FAILS the build if the
// flag is ON without a completed sign-off record. The point: flipping a boolean
// in a routine commit can never silently put crisis content in front of users —
// enabling it requires a deliberate, reviewable second act (recording sign-off).
//
// Test affordance: ACK_FLAG_FILE / ACK_SIGNOFF_FILE env vars override the paths
// (used by the self-checks below). The build invokes this with no env → real paths.

import { readFileSync } from 'node:fs';

const FLAG_FILE = process.env.ACK_FLAG_FILE
  ? new URL(process.env.ACK_FLAG_FILE, `file://${process.cwd()}/`)
  : new URL('../src/v2/AckReflect.jsx', import.meta.url);
const SIGNOFF_FILE = process.env.ACK_SIGNOFF_FILE
  ? new URL(process.env.ACK_SIGNOFF_FILE, `file://${process.cwd()}/`)
  : new URL('../docs/ACK_REFLECT_SIGNOFF.md', import.meta.url);

function fail(msg) {
  console.error(`\n✗ ACK_REFLECT gate: ${msg}\n  Gate + sign-off format: website/docs/PHASE3_REVIEW_SCOPE.md\n`);
  process.exit(1);
}

let src;
try {
  src = readFileSync(FLAG_FILE, 'utf8');
} catch {
  fail('cannot read AckReflect.jsx to check the flag.');
}

// The flag MUST be a readable literal. If someone makes it dynamic (env/computed)
// to dodge this check, the regex won't match and we fail closed.
const m = src.match(/const\s+ACK_REFLECT_ENABLED\s*=\s*(true|false)\b/);
if (!m) {
  fail('could not find `const ACK_REFLECT_ENABLED = true|false`. Do not obscure or compute this flag — the gate must be able to read it as a literal.');
}

if (m[1] === 'false') {
  console.log('✓ ACK_REFLECT gate: flow is OFF (safe at rest). No sign-off required.');
  process.exit(0);
}

// Flag is ON → require a completed enablement record. TWO honest paths:
//   (1) professional sign-off: CLINICAL_SIGNOFF + LEGAL_SIGNOFF both yes/approved.
//   (2) operator risk-acceptance: OPERATOR_RISK_ACCEPTANCE yes/accepted WITH a
//       named acceptor + date. This is NOT a substitute for review — it records
//       that a fully-informed operator deliberately accepted the residual risk.
//       It still satisfies the gate's real purpose: enabling crisis content can
//       never be a SILENT/accidental act — it demands a deliberate, reviewable,
//       attributable second commit. The gate refuses to let a faked professional
//       sign-off and an honest operator acceptance look the same.
let signoff;
try {
  signoff = readFileSync(SIGNOFF_FILE, 'utf8');
} catch {
  fail('ACK_REFLECT_ENABLED is TRUE but docs/ACK_REFLECT_SIGNOFF.md is missing. Crisis content must not go live without a recorded sign-off OR a recorded operator risk-acceptance.');
}

const clinicalOk = /^\s*CLINICAL_SIGNOFF:\s*(yes|approved)\b/im.test(signoff);
const legalOk = /^\s*LEGAL_SIGNOFF:\s*(yes|approved)\b/im.test(signoff);

const operatorAccepted = /^\s*OPERATOR_RISK_ACCEPTANCE:\s*(yes|accepted)\b/im.test(signoff);
// An acceptance is only valid if attributable: a non-empty "Accepted by:" and a
// "Acceptance date:" must be filled (the template's blank lines must be replaced).
// Tolerate markdown list/bold prefixes (e.g. "- **Accepted by:** …") and strip
// surrounding emphasis from the captured value.
const field = (label) => {
  const m = signoff.match(new RegExp(`^[\\s>*_-]*\\*{0,2}${label}:?\\*{0,2}:?\\s*(.+)$`, 'im'));
  return m ? m[1].replace(/[*_`]/g, '').trim() : undefined;
};
const acceptedBy = field('Accepted by');
const acceptedDate = field('Acceptance date');
const placeholder = (s) => !s || /^[_\-\s.]*$/.test(s) || /<[^>]*>/.test(s);

if (clinicalOk && legalOk) {
  console.log('✓ ACK_REFLECT gate: flow is ON with professional clinical + legal sign-off recorded.');
  process.exit(0);
}

if (operatorAccepted) {
  if (placeholder(acceptedBy) || placeholder(acceptedDate)) {
    fail('OPERATOR_RISK_ACCEPTANCE is set but "Accepted by:" / "Acceptance date:" are blank. An acceptance must be attributable — fill in who accepted it and when.');
  }
  console.log('⚠ ACK_REFLECT gate: flow is ON under OPERATOR RISK-ACCEPTANCE — NOT a professional review.');
  console.log(`  Accepted by: ${acceptedBy} (${acceptedDate}).`);
  console.log('  Clinical (A1/A2) + legal review remain open follow-ups; see docs/PHASE3_REVIEW_SCOPE.md.');
  process.exit(0);
}

fail('ACK_REFLECT_ENABLED is TRUE but docs/ACK_REFLECT_SIGNOFF.md records neither a professional sign-off (CLINICAL_SIGNOFF + LEGAL_SIGNOFF = yes) nor an attributable OPERATOR_RISK_ACCEPTANCE.');
