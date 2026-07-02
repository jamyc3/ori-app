#!/usr/bin/env node
// Build guard: nothing heavy should ever ship inside the app bundle.
// `public/` is copied wholesale into the iOS/web build (and `cap sync` sweeps it
// into the App Store binary). Marketing videos once bloated the approved build to
// 95 MB (see memory: check-build-size-before-shipping). Fail loudly instead.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PUBLIC = new URL("../public/", import.meta.url).pathname;
const MAX_FILE_MB = 3;                 // any single asset over this is suspicious
const MAX_TOTAL_MB = 12;               // whole public/ folder ceiling
const BANNED_EXT = [".mp4", ".mov", ".webm", ".avi", ".m4v"]; // media belongs in docs/marketing/

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  return e.isDirectory() ? walk(p) : [{ path: p, size: statSync(p).size }];
});

const files = walk(PUBLIC);
const mb = (b) => (b / 1024 / 1024).toFixed(1);
const rel = (p) => p.slice(PUBLIC.length);
const problems = [];

for (const f of files) {
  const ext = f.path.slice(f.path.lastIndexOf(".")).toLowerCase();
  if (BANNED_EXT.includes(ext)) problems.push(`  ✗ ${rel(f.path)} — ${ext} media (${mb(f.size)} MB); move it to docs/marketing/`);
  else if (f.size > MAX_FILE_MB * 1024 * 1024) problems.push(`  ✗ ${rel(f.path)} — ${mb(f.size)} MB > ${MAX_FILE_MB} MB single-file limit`);
}

const total = files.reduce((s, f) => s + f.size, 0);
if (total > MAX_TOTAL_MB * 1024 * 1024) problems.push(`  ✗ public/ totals ${mb(total)} MB > ${MAX_TOTAL_MB} MB ceiling`);

if (problems.length) {
  console.error(`\n[check-public-assets] These would bloat the shipped app bundle:\n${problems.join("\n")}\n`);
  console.error("Ori is LIVE on the App Store — keep public/ lean. Aborting build.\n");
  process.exit(1);
}
console.log(`[check-public-assets] OK — public/ is ${mb(total)} MB across ${files.length} files.`);
