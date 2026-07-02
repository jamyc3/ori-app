// Ori v2 — bridge part-reflections into the main journal.
//
// The reflect flow ("say a little about <part>") used to write only to the
// per-part store (cpi_part_thanks): invisible in the Journal tab, and a
// reflection that didn't "validate" was dropped entirely. This module mirrors
// every reflection into the journal repo (cpi_journal_repo) as a real, tagged
// entry, so a person can see ALL their writing in one place.
//
// Discipline:
//  · Additive + local-only — never deletes the per-part record, never sends
//    anything anywhere (cpi_journal_repo lives on the device).
//  · Tagged `source: 'reflection'` (+ partId / partName) so the Day view can
//    mark it and the letter analysis can EXCLUDE it (see batch-analyze.js) — a
//    reflection is yours to see, not fuel for the next letter.
//  · Deterministic id (`refl_<partId>_<dateISO>`) so the backfill of older
//    reflections is idempotent: re-running it never duplicates an entry, and a
//    going-forward write (sharing the same timestamp as its part-record) can't
//    collide with a later backfill of the same reflection.

import { repoAdd, loadRepo, saveRepo } from '../engine.js';
import { PARTS_LIB } from '../LetterReading.jsx';
import { entryDayFromStart, startIso } from '../date-util.js';

const ACK_KEY = 'cpi_part_thanks';
const REPO_KEY = 'cpi_journal_repo';

function reflId(partId, dateISO) {
  return `refl_${partId}_${dateISO}`;
}

// Ids already in the journal repo — read straight from storage (same shape the
// Journal/Day surfaces read) so dedup doesn't depend on engine internals.
function existingRepoIds() {
  try {
    const raw = localStorage.getItem(REPO_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed?.entries) ? parsed.entries
      : (Array.isArray(parsed) ? parsed : []);
    return new Set(entries.map((e) => e?.id).filter(Boolean));
  } catch {
    return new Set();
  }
}

// A reflection shaped like every other repo entry (so Day/Journal render it
// indistinguishably) plus the reflection tags.
function buildEntry(partId, reflection, dateISO, startedAt) {
  const text = String(reflection || '').trim();
  const t = new Date(dateISO);
  const valid = !isNaN(t.getTime());
  const entry = {
    id: reflId(partId, dateISO),
    // LOCAL calendar day the reflection BELONGS to. When a sitting start is
    // known, the day comes from THAT (so a reflection begun before midnight and
    // submitted after it stays on the prior day); else from the event timestamp.
    // Either way local, never dateISO.slice(0,10) (that's UTC — rolls a day
    // early for an evening note west of UTC).
    date: entryDayFromStart(startedAt != null ? startedAt : (valid ? t : null)),
    source: 'reflection',
    partId,
    partName: PARTS_LIB[partId]?.name || null,
    transcription: text,
    rawText: text,
    uploadedAt: dateISO,
    createdAt: valid ? t.getTime() : Date.now(),
  };
  // Persist the sitting start when known, so the date healer (repairReflectionDates)
  // recomputes from the start — not the submit timestamp — and never undoes a
  // cross-midnight date. Omitted for backfilled rows (no start info).
  if (startedAt != null) entry.startedAt = startIso(startedAt);
  return entry;
}

// Save one reflection as a journal entry. Idempotent by id; returns the entry,
// or null when empty / already present. `dateISO` should match the part-record
// timestamp so a later backfill recognises it as the same event (it also keys
// the per-turn id, so a multi-turn "Say more" sitting writes a distinct row per
// turn). `startedAt`, when given, is the sitting's start and drives the entry's
// DATE (cross-midnight safe) without touching the id.
export function saveReflectionEntry(partId, reflection, { dateISO, startedAt } = {}) {
  const text = String(reflection || '').trim();
  if (!partId || !text) return null;
  const iso = dateISO || new Date().toISOString();
  if (existingRepoIds().has(reflId(partId, iso))) return null;
  const entry = buildEntry(partId, text, iso, startedAt);
  repoAdd(entry);
  return entry;
}

// One-time (idempotent) backfill: copy every past VALIDATED reflection from the
// per-part store into the journal. Safe to call on every Journal mount —
// already-present ids are skipped. Returns the count added.
// Heal any reflection row whose `date` is the old UTC slice instead of the local
// day (written before the timezone fix). Recomputes from the entry's own
// timestamp; the entry count is unchanged, so saveRepo's shrink guard never
// trips. Idempotent — once a row is local-correct it's left alone.
function repairReflectionDates() {
  let repo;
  try { repo = loadRepo(); } catch { return 0; }
  let fixed = 0;
  for (const e of (repo?.entries || [])) {
    if (e?.source !== 'reflection') continue;
    // Recompute from the sitting START when we have it (keeps cross-midnight
    // dates intact); else from the entry's own timestamp (the original UTC-slice
    // heal for rows written before any of this).
    const t = e.createdAt ? new Date(e.createdAt)
      : (e.uploadedAt ? new Date(e.uploadedAt) : null);
    if (e.startedAt == null && (!t || isNaN(t.getTime()))) continue;
    const correct = entryDayFromStart(e.startedAt != null ? e.startedAt : t);
    if (e.date !== correct) { e.date = correct; fixed += 1; }
  }
  if (fixed) { try { saveRepo(repo); } catch { /* best-effort */ } }
  return fixed;
}

export function backfillReflectionsToJournal() {
  repairReflectionDates(); // fix any UTC-dated rows written before the tz fix
  let acks = [];
  try { acks = JSON.parse(localStorage.getItem(ACK_KEY) || '[]'); } catch { return 0; }
  if (!Array.isArray(acks) || acks.length === 0) return 0;
  const have = existingRepoIds();
  let added = 0;
  for (const e of acks) {
    if (e?.validated !== true) continue;
    const text = String(e?.reflection || '').trim();
    if (!text || !e?.partId || !e?.dateISO) continue;
    const id = reflId(e.partId, e.dateISO);
    if (have.has(id)) continue;
    repoAdd(buildEntry(e.partId, text, e.dateISO));
    have.add(id);
    added += 1;
  }
  return added;
}
