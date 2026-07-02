// Ori v2 — shared submit helper.
//
// Both the write capture (Capture.jsx) and the voice capture (Listen.jsx)
// route through this function so the journal repo only ever sees one entry
// shape — the one v1 writes from CPI.jsx:2031–2041. That guarantees v1's
// analyze pipeline reads v2-written entries indistinguishably from its own.

import { repoAdd } from '../engine.js';
import { entryDayFromStart, startIso } from '../date-util.js';

// `startedAt` (ms epoch / Date / ISO) is when the interaction BEGAN — the screen
// opened, the mic started, the first keystroke. The entry's `date` is derived
// from THAT, never from submit time, so a capture that crosses midnight stays on
// the day it started. Omitting it falls back to now (the old behaviour).
export function saveTodayEntry(text, { lowConf, startedAt } = {}) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  const entry = {
    date: entryDayFromStart(startedAt),
    source: 'checkin',
    transcription: trimmed,
    rawText: trimmed,
    startedAt: startIso(startedAt),       // when it began (drives `date`)
    uploadedAt: new Date().toISOString(), // when it was submitted (audit)
    createdAt: Date.now(),
  };
  // The words Deepgram was unsure of, when this came from voice — drives the
  // faint underline + tap-to-fix in the Day view. Stored only when non-empty so
  // typed entries (and the storage shape) stay exactly as before.
  if (Array.isArray(lowConf) && lowConf.length) entry.lowConf = lowConf;
  repoAdd(entry);
  return entry;
}
