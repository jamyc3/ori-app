// Ori v2 — one place that reads the whole journal out of storage.
//
// Shared by the Markdown export (Privacy → "Read it anywhere") and the PDF
// keepsake book (journalBook.js → "A keepsake book"), so both always describe
// the exact same journal from the exact same source of truth.

import { loadWho5History } from '../who5.js';

function localIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayIso() {
  return localIso();
}

// "2026-06-15" → "Monday, June 15, 2026"
export function prettyDate(iso) {
  const [y, mo, da] = String(iso).split('-').map((p) => parseInt(p, 10));
  return new Date(y, mo - 1, da).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

// "2026-06-15" → "Jun 15, 2026" (compact, for the cover's date range)
export function shortDate(iso) {
  const [y, mo, da] = String(iso).split('-').map((p) => parseInt(p, 10));
  return new Date(y, mo - 1, da).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

// Read every day's entries, that day's WHO-5 check-in and that night's letter.
// Returns newest-day-first `days` plus the lookups, and the headline counts.
export function gatherJournal() {
  const entriesByDay = {};
  try {
    const parsed = JSON.parse(localStorage.getItem('cpi_journal_repo') || 'null');
    const entries = Array.isArray(parsed?.entries) ? parsed.entries
      : (Array.isArray(parsed) ? parsed : []);
    for (const e of entries) {
      const d = typeof e?.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(e.date)
        ? e.date.slice(0, 10)
        : (e?.createdAt ? localIso(new Date(e.createdAt)) : null);
      if (!d) continue;
      const text = String(e?.transcription || e?.rawText || e?.text || '').trim();
      if (!text) continue;
      let when = null;
      const ts = e?.createdAt || e?.uploadedAt;
      if (ts) {
        const t = new Date(ts);
        if (!isNaN(t.getTime())) {
          when = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
        }
      }
      (entriesByDay[d] ||= []).push({ text, when, source: e?.source || null });
    }
  } catch { /* empty repo */ }

  // That day's WHO-5 check-in, if one was logged (validated self-report —
  // worth keeping next to the words it belongs to).
  const who5ByDay = {};
  try {
    // loadWho5History() returns a map keyed by local YYYY-MM-DD ({ items, score, ts }),
    // NOT an array — iterate its entries; the key is already the right local date.
    for (const [d, rec] of Object.entries(loadWho5History() || {})) {
      if (!rec || typeof rec.score !== 'number') continue;
      who5ByDay[d] = rec.score;
    }
  } catch { /* no check-ins */ }

  const lettersByDay = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = k && k.match(/^cpi_letter_(\d{4}-\d{2}-\d{2})$/);
      if (!m) continue;
      try {
        const letter = JSON.parse(localStorage.getItem(k))?.result?.a?.letter;
        if (letter) lettersByDay[m[1]] = letter;
      } catch { /* skip unreadable letter */ }
    }
  } catch { /* storage unavailable */ }

  const days = [...new Set([
    ...Object.keys(entriesByDay),
    ...Object.keys(lettersByDay),
    ...Object.keys(who5ByDay),
  ])].sort().reverse();

  const entryCount = Object.values(entriesByDay).reduce((n, a) => n + a.length, 0);
  const letterCount = Object.keys(lettersByDay).length;

  return { days, entriesByDay, lettersByDay, who5ByDay, entryCount, letterCount };
}
