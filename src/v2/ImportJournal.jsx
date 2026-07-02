// Ori v2 — Import journals.
//
// The design's "Import journals" screen, working: paste text, or add
// files — .txt/.md, PDF, Word, photos of pages (read on device or via
// the same engine pipeline v1 uses), and audio memos (Deepgram). Each
// staged item shows what was read and the date it will be planted under
// (editable; the parser's detected date wins when it finds one). Nothing
// touches the journal until "Plant into journal" — and items that fail
// to parse say so instead of planting something half-read.
//
// All parsing comes from the shared engine (readTextFile, readPdfFile,
// readDocxFile, transcribeJournalImage, transcribeAudioFile, repoAdd) —
// the same code path v1's Import sheet uses, so entries land identically.

import { useRef, useState } from 'react';
import './styles/sources.css';
import './styles/import.css';
import { flushStorage } from '../storage.js';
import {
  detectFileKind,
  readTextFile,
  readPdfFile,
  readDocxFile,
  transcribeJournalImage,
  transcribeAudioFile,
  repoAdd,
  loadRepo,
  REPO_MAX_TEXT_CHARS,
} from '../engine.js';

// ── JSON backup restore ──────────────────────────────────────────────
// Accepts every export Ori has ever produced:
//   1. v1 backup bundle   { schema: "ori-backup/1", entries: [{key,value}] }
//   2. v2 "Export everything"  — flat { "cpi_…": value } object (values
//      already parsed by the exporter, or raw strings)
//   3. naked repo          { entries: [...] }
//   4. bare entries array  [...]
// Returns canonical arrays ready to merge. Mirrors v1's
// ImportJournalSheet.extractFromAnyShape, extended for shape 2.
function extractFromAnyShape(data) {
  const out = { journalEntries: [], historyEntries: [], letterEntries: [], who5: null, ouraHistory: null, otherKeys: [] };
  if (!data) return out;

  const takeRepo = (repo) => {
    if (Array.isArray(repo?.entries)) out.journalEntries = repo.entries;
    else if (Array.isArray(repo)) out.journalEntries = repo;
  };
  const takeHistory = (parsed) => {
    const arr = Array.isArray(parsed) ? parsed
      : (Array.isArray(parsed?.history) ? parsed.history : null);
    if (arr) out.historyEntries = arr;
  };
  const asParsed = (v) => {
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return null; }
  };

  // Every cpi_/ori- key in a backup that isn't one of the merge-handled
  // stores gets restored verbatim when this device doesn't have it yet —
  // the Oura token + high-water mark, biometrics, profile, mode, check-in
  // scales. Dropping them silently (as the first cut did) meant a restore
  // brought back the words but none of the body data behind the rings.
  const classify = (key, value) => {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (key === 'cpi_journal_repo') takeRepo(asParsed(value));
    else if (key === 'cpi-v2-data') takeHistory(asParsed(value));
    else if (key === 'cpi_who5_history') out.who5 = asParsed(value);
    else if (key === 'cpi_oura_history') out.ouraHistory = asParsed(value);
    else if (/^cpi_letter_\d{4}-\d{2}-\d{2}$/.test(key)) out.letterEntries.push({ key, value: str });
    else if (key.startsWith('cpi') || key.startsWith('ori-')) out.otherKeys.push({ key, value: str });
  };

  // Shape 1: v1 backup bundle.
  if (data.schema === 'ori-backup/1' && Array.isArray(data.entries)) {
    for (const kv of data.entries) {
      if (!kv?.key || typeof kv.value !== 'string') continue;
      classify(kv.key, kv.value);
    }
    return out;
  }

  // Shape 2: v2 "Export everything" — flat key→value object.
  if (!Array.isArray(data) && typeof data === 'object'
      && Object.keys(data).some((k) => k.startsWith('cpi') || k.startsWith('ori-'))) {
    for (const [key, value] of Object.entries(data)) classify(key, value);
    return out;
  }

  // Shapes 3 & 4.
  const arr = Array.isArray(data.entries) ? data.entries : (Array.isArray(data) ? data : null);
  if (arr) out.journalEntries = arr;
  return out;
}

// Merge a parsed backup into local storage. Existing local data always
// wins: letters only fill missing days, history dedupes on its ISO
// timestamp, journal entries skip exact (date + text) duplicates so
// restoring the same file twice is harmless.
function restoreBackup(data) {
  const { journalEntries, historyEntries, letterEntries, who5, ouraHistory, otherKeys } = extractFromAnyShape(data);
  if (!journalEntries.length && !historyEntries.length && !letterEntries.length
      && !ouraHistory && !otherKeys.length) {
    throw new Error("Couldn't find any journal data in this file.");
  }

  // Wearable nights: merge date-keyed maps, this device's days win.
  let nights = 0;
  if (ouraHistory && typeof ouraHistory === 'object') {
    try {
      const cur = JSON.parse(localStorage.getItem('cpi_oura_history') || '{}') || {};
      for (const [day, v] of Object.entries(ouraHistory)) {
        if (cur[day] == null) { cur[day] = v; nights++; }
      }
      localStorage.setItem('cpi_oura_history', JSON.stringify(cur));
    } catch { /* quota */ }
  }

  // Everything else (token, high-water mark, biometrics, profile, mode,
  // check-in scales…): fill only what's missing — local always wins.
  let settingsAdded = 0;
  for (const { key, value } of otherKeys) {
    try {
      if (localStorage.getItem(key) == null) { localStorage.setItem(key, value); settingsAdded++; }
    } catch { /* quota — skip */ }
  }
  let letters = 0;
  for (const { key, value } of letterEntries) {
    try {
      if (localStorage.getItem(key) == null) { localStorage.setItem(key, value); letters++; }
    } catch { /* quota — skip */ }
  }

  let entries = 0;
  const existing = new Set(
    (loadRepo().entries || []).map((e) => `${String(e?.date || '').slice(0, 10)}|${(e?.transcription || e?.rawText || '').slice(0, 80)}`)
  );
  for (const e of journalEntries) {
    const text = e?.rawText || e?.transcription;
    if (!text) continue;
    const sig = `${String(e?.date || '').slice(0, 10)}|${String(text).slice(0, 80)}`;
    if (existing.has(sig)) continue;
    existing.add(sig);
    repoAdd({
      source: e.source || 'text',
      date: e.date || null,
      dateEnd: e.dateEnd || null,
      rawText: e.rawText || e.transcription || '',
      transcription: e.transcription || e.rawText || '',
      confidence: typeof e.confidence === 'number' ? e.confidence : 1.0,
      notes: e.notes || 'Restored from backup',
      dateText: e.dateText || null,
      uploadedAt: e.uploadedAt || new Date().toISOString(),
    });
    entries++;
  }

  let history = 0;
  if (historyEntries.length > 0) {
    let current = [];
    try {
      const parsed = JSON.parse(localStorage.getItem('cpi-v2-data') || 'null');
      if (Array.isArray(parsed)) current = parsed;
      else if (Array.isArray(parsed?.history)) current = parsed.history;
    } catch { /* start empty */ }
    const seen = new Set(current.map((e) => e?.date).filter(Boolean));
    const merged = [...current];
    for (const e of historyEntries) {
      if (!e?.date || seen.has(e.date)) continue;
      merged.push(e); seen.add(e.date); history++;
    }
    merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    try { localStorage.setItem('cpi-v2-data', JSON.stringify(merged)); } catch { /* quota */ }
  }

  let who5Added = 0;
  if (who5 && typeof who5 === 'object') {
    try {
      const cur = JSON.parse(localStorage.getItem('cpi_who5_history') || '{}') || {};
      for (const [day, v] of Object.entries(who5)) {
        if (cur[day] == null) { cur[day] = v; who5Added++; }
      }
      localStorage.setItem('cpi_who5_history', JSON.stringify(cur));
    } catch { /* quota */ }
  }

  return { entries, history, letters, who5Added, nights, settingsAdded };
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Find a date written near the top of a journal entry. The engine's text
// reader returns no detectedDate (only the image transcriber does), so
// without this every imported file lands on "today" — which reads as
// "import didn't work" when the writing is months old. Handles:
// 2026-03-03 · March 3, 2026 · Mar 3 2026 · 3 March 2026 · 3/3/2026.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function detectDateInText(text) {
  const head = String(text || '').slice(0, 240);
  const mk = (y, m, d) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return iso <= todayIso() ? iso : null; // journals live in the past
  };
  let m = head.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (m) { const r = mk(+m[1], +m[2], +m[3]); if (r) return r; }
  m = head.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/);
  if (m) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    if (mo) { const r = mk(+m[3], mo, +m[2]); if (r) return r; }
  }
  m = head.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(20\d{2})\b/);
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    if (mo) { const r = mk(+m[3], mo, +m[1]); if (r) return r; }
  }
  m = head.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (m) { const r = mk(+m[3], +m[1], +m[2]); if (r) return r; }
  return null;
}

const KIND_LABEL = {
  text: 'Text', pdf: 'PDF', docx: 'Word', image: 'Photo', audio: 'Audio',
};

async function parseFile(file) {
  const kind = detectFileKind(file);
  switch (kind) {
    case 'text': return { kind, ...(await readTextFile(file)) };
    case 'pdf': return { kind, ...(await readPdfFile(file)) };
    case 'docx': return { kind, ...(await readDocxFile(file)) };
    case 'image': return { kind, ...(await transcribeJournalImage(file)) };
    case 'audio': return { kind, ...(await transcribeAudioFile(file)) };
    case 'doc': throw new Error('Old .doc format — save it as .docx and try again.');
    default: throw new Error('Unrecognized file type.');
  }
}

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4l-6 6 6 6" />
    </svg>
  );
}

export default function ImportJournal({ onBack, onDone }) {
  const [items, setItems] = useState([]);       // { id, name, kind, text, date, status, error }
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteDate, setPasteDate] = useState(todayIso());
  const [planted, setPlanted] = useState(0);
  const [plantedDates, setPlantedDates] = useState([]);
  const [restoreMsg, setRestoreMsg] = useState('');
  const fileRef = useRef(null);
  const jsonRef = useRef(null);
  const idRef = useRef(0);

  const handleRestoreJson = async (file) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const r = restoreBackup(data);
      const bits = [];
      if (r.entries) bits.push(`${r.entries} ${r.entries === 1 ? 'entry' : 'entries'}`);
      if (r.history) bits.push(`${r.history} daily reading${r.history === 1 ? '' : 's'}`);
      if (r.letters) bits.push(`${r.letters} letter${r.letters === 1 ? '' : 's'}`);
      if (r.who5Added) bits.push(`${r.who5Added} check-in${r.who5Added === 1 ? '' : 's'}`);
      if (r.nights) bits.push(`${r.nights} wearable night${r.nights === 1 ? '' : 's'}`);
      if (r.settingsAdded) bits.push(`${r.settingsAdded} setting${r.settingsAdded === 1 ? '' : 's'}`);
      if (bits.length === 0) {
        setRestoreMsg('Everything in that backup is already here — nothing to add.');
        return;
      }
      setRestoreMsg(`Restored ${bits.join(', ')}. Settling in…`);
      // Flag a pending read so the post-reload mount offers "read your last 30
      // days" (Shell checks for actual unread days before showing it).
      try { localStorage.setItem('cpi_v2_backfill_pending', '1'); } catch { /* fine */ }
      // Mounted surfaces read storage once at mount — a reload is the
      // honest way to light up Journal/Patterns with the restored past.
      // flushStorage() first: repo writes land in IndexedDB async, and
      // reloading before they settle would lose the restore.
      await flushStorage();
      setTimeout(() => window.location.assign('/'), 900);
    } catch (e) {
      setRestoreMsg(e?.message || 'Could not read that backup file.');
    }
  };

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    for (const file of files) {
      const id = ++idRef.current;
      setItems((prev) => [...prev, {
        id, name: file.name, kind: detectFileKind(file),
        text: '', date: todayIso(), status: 'reading', error: null,
      }]);
      try {
        const parsed = await parseFile(file);
        const text = (parsed.transcription || '').trim().slice(0, REPO_MAX_TEXT_CHARS);
        if (!text) throw new Error('Nothing readable found inside.');
        const detected = /^\d{4}-\d{2}-\d{2}$/.test(parsed.detectedDate || '')
          ? parsed.detectedDate
          : detectDateInText(text);
        setItems((prev) => prev.map((it) => it.id === id ? {
          ...it,
          kind: parsed.kind,
          text,
          date: detected || it.date,
          status: 'ready',
        } : it));
      } catch (e) {
        setItems((prev) => prev.map((it) => it.id === id ? {
          ...it, status: 'error', error: e?.message || 'Could not read this file.',
        } : it));
      }
    }
  };

  const stagePaste = () => {
    const text = pasteText.trim();
    if (!text) return;
    const id = ++idRef.current;
    setItems((prev) => [...prev, {
      id, name: 'Pasted text', kind: 'text',
      text: text.slice(0, REPO_MAX_TEXT_CHARS),
      date: pasteDate || todayIso(), status: 'ready', error: null,
    }]);
    setPasteText('');
    setPasteOpen(false);
  };

  const setItemDate = (id, date) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, date } : it)));
  };
  const removeItem = (id) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const ready = items.filter((it) => it.status === 'ready');

  const plantAll = async () => {
    let count = 0;
    const dates = new Set();
    for (const it of ready) {
      repoAdd({
        date: it.date,
        source: 'checkin',
        transcription: it.text,
        rawText: it.text,
        uploadedAt: new Date().toISOString(),
        createdAt: Date.now(),
      });
      dates.add(it.date);
      count++;
    }
    setPlanted(count);
    setPlantedDates([...dates].sort());
    setItems((prev) => prev.filter((it) => it.status !== 'ready'));
    // Repo writes land in IndexedDB asynchronously — settle them now so
    // closing the app right after planting can't lose the import.
    await flushStorage();
  };

  return (
    <section className="v2-src">
      <button type="button" className="v2-backrow" onClick={onBack} aria-label="Back to Settings">
        <IconChevronLeft />
        <span>Settings</span>
      </button>

      <h1 className="v2-src-title">Import journals</h1>
      <p className="v2-src-sub">
        Bring your old entries in — they become dated days in your journal. Read on this device — your words travel only when Ori writes your letter.
      </p>

      <div className="v2-src-group">
        <button type="button" className="v2-src-row" onClick={() => fileRef.current?.click()}>
          <span className="v2-src-tx">
            <span className="v2-src-l">Add files</span>
            <span className="v2-src-s">.txt · .md · PDF · Word · photos of pages · voice memos</span>
          </span>
          <span className="v2-src-status">Choose</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".txt,.md,.markdown,text/plain,.pdf,application/pdf,.docx,image/*,audio/*"
          style={{ display: 'none' }}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />

        <button type="button" className="v2-src-row" onClick={() => jsonRef.current?.click()}>
          <span className="v2-src-tx">
            <span className="v2-src-l">Restore a backup</span>
            <span className="v2-src-s">An Ori export (.json) — entries, readings, letters and check-ins come back. Nothing already here is overwritten.</span>
          </span>
          <span className="v2-src-status">.json</span>
        </button>
        <input
          ref={jsonRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => { handleRestoreJson(e.target.files?.[0]); e.target.value = ''; }}
        />
        {restoreMsg && <p className="v2-src-foot" role="status">{restoreMsg}</p>}

        {pasteOpen ? (
          <div className="v2-imp-paste">
            <textarea
              className="v2-imp-ta"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste an entry — or a whole stretch of them."
              rows={6}
              autoFocus
            />
            <div className="v2-imp-paste-foot">
              <input
                type="date"
                className="v2-src-date"
                value={pasteDate}
                max={todayIso()}
                onChange={(e) => setPasteDate(e.target.value)}
                aria-label="Date for the pasted entry"
              />
              <button type="button" className="v2-src-mini" onClick={() => setPasteOpen(false)}>Cancel</button>
              <button type="button" className="v2-imp-stage" onClick={stagePaste} disabled={!pasteText.trim()}>Stage</button>
            </div>
          </div>
        ) : (
          <button type="button" className="v2-src-row" onClick={() => setPasteOpen(true)}>
            <span className="v2-src-tx">
              <span className="v2-src-l">Paste text</span>
              <span className="v2-src-s">Drop in plain text from anywhere.</span>
            </span>
            <span className="v2-src-status">Paste</span>
          </button>
        )}
      </div>

      {items.length > 0 && (
        <>
          <div className="v2-src-eyebrow">Staged</div>
          <div className="v2-src-group">
            {items.map((it) => (
              <div key={it.id} className="v2-src-row static v2-imp-item">
                <span className="v2-src-tx">
                  <span className="v2-src-l">
                    {it.name}
                    <i className="v2-imp-kind">{KIND_LABEL[it.kind] || it.kind}</i>
                  </span>
                  {it.status === 'reading' && <span className="v2-src-s">Reading…</span>}
                  {it.status === 'error' && <span className="v2-src-s warn">{it.error}</span>}
                  {it.status === 'ready' && (
                    <span className="v2-src-s">
                      {it.text.length.toLocaleString()} characters · “{it.text.slice(0, 70)}{it.text.length > 70 ? '…' : ''}”
                    </span>
                  )}
                </span>
                {it.status === 'ready' && (
                  <input
                    type="date"
                    className="v2-src-date"
                    value={it.date}
                    max={todayIso()}
                    onChange={(e) => setItemDate(it.id, e.target.value)}
                    aria-label={`Date for ${it.name}`}
                  />
                )}
                <button type="button" className="v2-src-mini" onClick={() => removeItem(it.id)}>Remove</button>
              </div>
            ))}
          </div>
          {ready.length > 0 && (
            <button type="button" className="v2-imp-plant" onClick={plantAll}>
              Plant {ready.length} {ready.length === 1 ? 'entry' : 'entries'} into the journal
            </button>
          )}
        </>
      )}

      {planted > 0 && items.length === 0 && (
        <div className="v2-imp-done">
          <p>
            {planted} {planted === 1 ? 'entry' : 'entries'} planted
            {plantedDates.length > 0 && ` under ${plantedDates.map((d) => {
              const [y, m, da] = d.split('-').map((p) => parseInt(p, 10));
              return new Date(y, m - 1, da).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            }).join(', ')}`}.
            {' '}Find them in the Journal under those months — and tonight's reading can include today's.
          </p>
          <button type="button" className="v2-imp-stage" onClick={onDone || onBack}>Open the Journal</button>
        </div>
      )}

      <p className="v2-src-foot">
        Photos and voice memos are read by the same transcription Ori already uses. Day One ZIP and Apple Health archives still import via classic settings.
      </p>
    </section>
  );
}
