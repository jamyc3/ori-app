#!/usr/bin/env node
// Generate public/crisis-resources.json from the VERIFIED bundled set, so the
// remote refresh source provably matches the offline floor on first publish
// (no hand-retyping → no drift). After this, the published JSON is authoritative
// and ops edits it directly to correct a number without an app-store update.
//
// Run: node scripts/gen-crisis-json.mjs   (also wired into the build, see below)

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { BUNDLED_RESOURCES, CRISIS_DB_VERSION } from '../src/v2/crisisResources.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../public/crisis-resources.json');

// Shape consumed by loadDb()/isValidDb()/resourcesForUser(): { version, countries }.
const db = { version: CRISIS_DB_VERSION, countries: BUNDLED_RESOURCES };

await writeFile(out, JSON.stringify(db, null, 2) + '\n', 'utf8');
console.log(`wrote ${out} — version ${CRISIS_DB_VERSION}, ${Object.keys(BUNDLED_RESOURCES).length} countries`);
