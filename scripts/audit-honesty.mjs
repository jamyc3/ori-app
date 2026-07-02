#!/usr/bin/env node
// Adversarial honesty-coverage check.
//
// Reads HONESTY_CLAIMS from src/honesty-audit.js. For every claim
// marked auditable:"yes", asserts that every `proof.contains` string
// appears verbatim in the proof.file. Fails the build if a threshold
// disclosure is removed or renamed.
//
// Why bother? Without this, the audit dashboard is self-graded: I
// write the claim, I write the dot, I tick "yes". This script forces
// the source to actually contain the threshold value before the build
// passes — so renaming "±4 points" to "small swings" silently breaks
// the build, not just the claim.
//
// This is a regression net, not a correctness proof. It catches silent
// removal. It does NOT catch:
//   · semantic drift (the threshold is still printed but means something different now)
//   · components being unmounted/conditionally hidden
//   · intentional rewording with the same meaning (string match fails → false positive)
// A full DOM test would catch (1) and (2). For solo design work this
// is the lighter contract: name the strings I expect to see, let the
// build remind me when they vanish.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const auditModule = await import(join("file://", PROJECT_ROOT, "src/honesty-audit.js"));
const { HONESTY_CLAIMS } = auditModule;

const fileCache = new Map();
async function readSource(rel) {
  if (fileCache.has(rel)) return fileCache.get(rel);
  const text = await readFile(join(PROJECT_ROOT, rel), "utf8");
  fileCache.set(rel, text);
  return text;
}

const failures = [];
const warnings = [];
let checked = 0;

for (const claim of HONESTY_CLAIMS) {
  if (claim.auditable !== "yes") {
    warnings.push(`  ! ${claim.id} marked auditable:"${claim.auditable}" — coverage gap`);
    continue;
  }
  if (!claim.proof) {
    failures.push(`  × ${claim.id}: marked "yes" but has no proof field`);
    continue;
  }
  const { file, contains } = claim.proof;
  if (!file || !Array.isArray(contains) || contains.length === 0) {
    failures.push(`  × ${claim.id}: malformed proof (need file + non-empty contains[])`);
    continue;
  }
  let source;
  try {
    source = await readSource(file);
  } catch (e) {
    failures.push(`  × ${claim.id}: cannot read ${file} — ${e.message}`);
    continue;
  }
  const missing = contains.filter((s) => !source.includes(s));
  checked++;
  if (missing.length > 0) {
    failures.push(`  × ${claim.id} (${file})`);
    for (const s of missing) failures.push(`      missing: ${JSON.stringify(s)}`);
  }
}

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";

console.log(`${BOLD}Honesty audit${RESET} — ${checked}/${HONESTY_CLAIMS.length} claims with proof checked`);

if (warnings.length > 0) {
  console.log(`\n${YELLOW}Coverage gaps:${RESET}`);
  for (const w of warnings) console.log(w);
}

if (failures.length > 0) {
  console.log(`\n${RED}${BOLD}FAIL${RESET} — threshold disclosure missing from source:`);
  for (const f of failures) console.log(f);
  console.log(`\n${RED}A claim is marked auditable:"yes" but the source no longer contains the strings that prove it.${RESET}`);
  console.log(`Either restore the disclosure, update the proof.contains array, or downgrade the claim.\n`);
  process.exit(1);
}

console.log(`\n${GREEN}${BOLD}PASS${RESET} — every "yes" claim's threshold disclosure is present in source.\n`);
