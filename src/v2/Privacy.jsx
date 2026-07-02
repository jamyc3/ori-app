// Ori v2 — Export & privacy.
//
// The design's "Export & privacy" screen. Three honest facts and three
// actions: everything is on-device (true — localStorage), cloud backup is
// not built yet (shown as coming, never as a working toggle), export
// downloads the real stored data as JSON, delete-a-day removes one date's
// user-authored data, and erase-all clears every Ori key after an explicit
// typed confirmation.

import { useState } from 'react';
import './styles/sources.css';
import './styles/settings.css'; // shared .v2-toggle switch primitive
import { LARGE_KEYS } from '../storage.js';
import { loadWho5History, bandFor } from '../who5.js';
import { buildDemandsLookup } from './demandsData.js';
import { hasReflectionConsent, revokeReflectionConsent, grantReflectionConsent } from './acknowledgmentEngine.js';
import { gatherJournal, prettyDate } from './journalData.js';
import { buildJournalBook, shareJournalBook } from './journalBook.js';

function localIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Every Ori localStorage key starts with one of these.
const KEY_PREFIXES = ['cpi_', 'cpi-', 'ori-'];

// …except a few that don't carry the prefix (shared-with-jot naming). Without
// these in the set, "Erase all of Ori" leaves the Apple Health grant flag
// behind, so the Shell's next sync re-pulls Health data onto the "erased"
// device. List them so erase actually disconnects.
const UNPREFIXED_KEYS = ['apple_health_granted'];

function oriKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && KEY_PREFIXES.some((p) => k.startsWith(p))) keys.push(k);
    }
  } catch {
    // Storage unavailable.
  }
  // The journal repo and wearable history live in IndexedDB behind the
  // storage shim. getItem() is shimmed to read them, but key-enumeration
  // is NOT — so a user whose data only ever existed in IDB would export
  // (and erase) without their journal. Add the large keys explicitly.
  for (const k of Object.values(LARGE_KEYS)) {
    try {
      if (!keys.includes(k) && localStorage.getItem(k) != null) keys.push(k);
    } catch { /* skip */ }
  }
  for (const k of UNPREFIXED_KEYS) {
    try {
      if (!keys.includes(k) && localStorage.getItem(k) != null) keys.push(k);
    } catch { /* skip */ }
  }
  return keys;
}

function download(filename, content, type) {
  // iOS WKWebView ignores programmatic <a download> clicks — route the
  // file through the system share sheet instead (Files, AirDrop, Mail).
  const isIos = (() => {
    try { return window.Capacitor?.getPlatform?.() === 'ios'; } catch { return false; }
  })();
  if (isIos) {
    (async () => {
      try {
        const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
        const { Share } = await import('@capacitor/share');
        await Filesystem.writeFile({
          path: filename,
          data: content,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });
        const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
        await Share.share({ title: filename, url: uri });
      } catch (e) {
        console.warn('Share-sheet export failed:', e?.message || e);
      }
    })();
    return;
  }
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// A clean, consolidated per-day Reserves / Demands / Form table for the export,
// so the file is directly analysable rather than a scatter of raw keys. Reads
// the immutable snapshot where one was captured (the frozen value the letter was
// written from); otherwise recomputes from the same observed sources the journal
// uses, so historical days fill in too. `captured:false` marks a recomputed day.
function buildDailyRings() {
  const out = {};
  const ouraMap = (() => { try { return JSON.parse(localStorage.getItem('cpi_oura_history') || '{}'); } catch { return {}; } })();
  const demandsFor = buildDemandsLookup();
  const who5ByDay = {};
  try {
    // loadWho5History() is a date-keyed MAP, not an array — for...of threw here,
    // so Form was missing from the privacy data-rings/export. The key is already
    // a local YYYY-MM-DD, so use it directly (no new Date(c.when) dance).
    for (const [d, rec] of Object.entries(loadWho5History() || {})) {
      if (!rec || typeof rec.score !== 'number') continue;
      who5ByDay[d] = Math.round(rec.score);
    }
  } catch { /* no check-ins */ }
  const analyzedDays = new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem('cpi-v2-data') || 'null');
    const hist = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.history) ? parsed.history : []);
    for (const h of hist) { if (h?.date) { const d = new Date(h.date); if (!isNaN(d.getTime())) analyzedDays.add(localIso(d)); } }
  } catch { /* no analysed history */ }
  const snaps = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = k && k.match(/^cpi_day_rings_(\d{4}-\d{2}-\d{2})$/);
      if (m) { try { snaps[m[1]] = JSON.parse(localStorage.getItem(k)); } catch { /* skip */ } }
    }
  } catch { /* storage unavailable */ }

  const days = new Set([...Object.keys(ouraMap), ...Object.keys(who5ByDay), ...analyzedDays, ...Object.keys(snaps)]);
  for (const day of [...days].sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const snap = snaps[day];
    const num = (v) => (typeof v === 'number' ? v : null);
    const reserves = snap && typeof snap.reserves === 'number' ? snap.reserves
      : (typeof ouraMap?.[day]?.sleepScore === 'number' ? Math.round(ouraMap[day].sleepScore) : null);
    let demands = snap && typeof snap.demands === 'number' ? snap.demands : null;
    if (demands == null) { try { demands = num(demandsFor(day)) != null ? Math.round(demandsFor(day)) : null; } catch { demands = null; } }
    const form = snap && typeof snap.form === 'number' ? snap.form : (who5ByDay[day] ?? null);
    if (reserves == null && demands == null && form == null) continue;
    out[day] = { reserves, demands, form, reservesSource: ouraMap?.[day]?.source || null, captured: Boolean(snap) };
  }
  return out;
}

function exportEverything() {
  const out = {};
  for (const k of oriKeys()) {
    try {
      const raw = localStorage.getItem(k);
      try { out[k] = JSON.parse(raw); } catch { out[k] = raw; }
    } catch { /* skip unreadable key */ }
  }
  // A ready-to-analyse per-day Reserves/Demands/Form table alongside the raw keys.
  try { out._dailyRings = buildDailyRings(); } catch { /* best-effort */ }
  const iso = localIso();
  download(`ori-export-${iso}.json`, JSON.stringify(out, null, 2), 'application/json');
}

// The journal as a book — one Markdown file, newest day first: your
// entries in your words (with the time they were written), that day's
// WHO-5 check-in, then that night's letter. Readable anywhere, forever,
// with no Ori required.
function exportJournalMarkdown() {
  // The whole journal, gathered once (the PDF keepsake book reads the same).
  const { days, entriesByDay, lettersByDay, who5ByDay, entryCount, letterCount } = gatherJournal();
  const fmt = prettyDate;

  const lines = ['# Ori — the journal', ''];
  if (days.length > 0) {
    const first = fmt(days[days.length - 1]);
    const last = fmt(days[0]);
    lines.push(
      `_${first} — ${last} · ${days.length} day${days.length === 1 ? '' : 's'} · ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'} · ${letterCount} letter${letterCount === 1 ? '' : 's'}_`,
      '',
      '---',
      '',
    );
  }
  for (const day of days) {
    lines.push(`## ${fmt(day)}`, '');
    if (who5ByDay[day] != null) {
      const score = Math.round(who5ByDay[day]);
      const band = (() => {
        try { return bandFor(score)?.label || null; } catch { return null; }
      })();
      lines.push(`_Wellbeing check-in: ${score} out of 100${band ? ` · ${band}` : ''}_`, '');
    }
    for (const entry of entriesByDay[day] || []) {
      if (entry.when) lines.push(`**${entry.when}**${entry.source === 'checkin' ? '' : ' · imported'}`, '');
      lines.push(entry.text, '');
    }
    const letter = lettersByDay[day];
    if (letter) {
      lines.push(`### The letter`, '');
      if (letter.headline) lines.push(`**${String(letter.headline).trim()}**`, '');
      const paras = Array.isArray(letter.paragraphs) ? letter.paragraphs : [];
      for (const p of paras) {
        const t = String(p || '').trim();
        if (t) lines.push(`> ${t}`, '');
      }
      lines.push('> — Ori', '');
    }
    lines.push('---', '');
  }
  if (days.length === 0) lines.push('_Nothing here yet — the journal fills as you write._', '');
  lines.push('', '_Exported from Ori. Your words are yours — this file is complete and needs no app to read._', '');

  const iso = localIso();
  download(`ori-journal-${iso}.md`, lines.join('\n'), 'text/markdown');
}

// Removes one date's user-authored data: journal entries, the letter and
// its read-mark, and the WHO-5 check-in. Wearable history isn't touched —
// it re-syncs from the source and isn't authored here.
function deleteDay(iso) {
  try {
    localStorage.removeItem(`cpi_letter_${iso}`);
    localStorage.removeItem(`cpi_letter_read_${iso}`);

    const who5Raw = localStorage.getItem('cpi_who5_history');
    if (who5Raw) {
      const map = JSON.parse(who5Raw);
      if (map && typeof map === 'object' && map[iso]) {
        delete map[iso];
        localStorage.setItem('cpi_who5_history', JSON.stringify(map));
      }
    }

    const repoRaw = localStorage.getItem('cpi_journal_repo');
    if (repoRaw) {
      const parsed = JSON.parse(repoRaw);
      const entries = Array.isArray(parsed?.entries) ? parsed.entries
        : (Array.isArray(parsed) ? parsed : null);
      if (entries) {
        const keep = entries.filter((e) => {
          const d = typeof e?.date === 'string' ? e.date.slice(0, 10)
            : (e?.createdAt ? localIso(new Date(e.createdAt)) : null);
          return d !== iso;
        });
        const next = Array.isArray(parsed?.entries) ? { ...parsed, entries: keep } : keep;
        localStorage.setItem('cpi_journal_repo', JSON.stringify(next));
      }
    }
    return true;
  } catch {
    return false;
  }
}

function eraseAll() {
  for (const k of oriKeys()) {
    try { localStorage.removeItem(k); } catch { /* keep going */ }
  }
}

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4l-6 6 6 6" />
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg width="8" height="13" viewBox="0 0 8 13" aria-hidden="true">
      <path d="M1 1 L7 6.5 L1 12" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
// Per-action glyphs so the four data rows read as four distinct things,
// not one repeated button.
function IconBook() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5a2 2 0 0 1 2-2h5v16H6a2 2 0 0 0-2 2z" />
      <path d="M20 5a2 2 0 0 0-2-2h-5v16h5a2 2 0 0 1 2 2z" />
    </svg>
  );
}
// The garden bloom — the same ❀ that sits on the keepsake book's cover.
function IconKeepsake() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="7.6" r="2.7" />
      <circle cx="7.7" cy="10.7" r="2.7" />
      <circle cx="9.4" cy="15.7" r="2.7" />
      <circle cx="14.6" cy="15.7" r="2.7" />
      <circle cx="16.3" cy="10.7" r="2.7" />
      <circle cx="12" cy="12" r="1.5" />
    </svg>
  );
}
function IconBackup() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 8v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8" />
      <path d="M2 4h20v4H2z" />
      <path d="M12 12v5m0 0l-2.5-2.5M12 17l2.5-2.5" />
    </svg>
  );
}
function IconCalX() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
      <path d="M10 14l4 4m0-4l-4 4" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </svg>
  );
}

export default function Privacy({ onBack }) {
  const [deleting, setDeleting] = useState(false);
  const [deleteIso, setDeleteIso] = useState('');
  const [notice, setNotice] = useState('');
  const [makingBook, setMakingBook] = useState(false);
  // Reflection-sharing consent is grantable in the part-reflection flow; per
  // GDPR Art. 7(3) withdrawal must be as easy as granting, so it lives here.
  const [reflectConsent, setReflectConsent] = useState(() => hasReflectionConsent());

  const handleWithdrawReflect = () => {
    revokeReflectionConsent();
    setReflectConsent(false);
    setNotice('Reflection sharing withdrawn. Ori will ask again before the next written reflection.');
  };

  // Granting from here too (not only inside the reflect flow), so the control is
  // symmetric — on and off both live in one place.
  const handleGrantReflect = () => {
    grantReflectionConsent();
    setReflectConsent(true);
    setNotice('Reflection sharing on. You can withdraw any time — gestures keep working either way.');
  };

  const handleDeleteDay = () => {
    if (!deleteIso) return;
    const ok = window.confirm(`Delete your entries, letter and check-in for ${deleteIso}? This can't be undone.`);
    if (!ok) return;
    const done = deleteDay(deleteIso);
    setNotice(done ? `${deleteIso} deleted.` : 'Could not delete that day.');
    setDeleting(false);
    setDeleteIso('');
  };

  const handleEraseAll = () => {
    const typed = window.prompt('This erases every letter, entry, check-in and connection on this device. Type ERASE to confirm.');
    if (typed !== 'ERASE') return;
    eraseAll();
    window.location.assign('/');
  };

  // Bind the whole journal into the garden-paper PDF keepsake, then hand it to
  // the share sheet (iOS) or download it (web). Building rasterises a page at a
  // time, so we flag a "Preparing…" state while it runs.
  const handleExportBook = async () => {
    if (makingBook) return;
    setMakingBook(true);
    setNotice('Gathering your journal into a book…');
    try {
      const book = await buildJournalBook();
      if (!book) { setNotice('Nothing to bind yet — your journal is still empty.'); return; }
      await shareJournalBook(book.blob, book.filename);
      setNotice(`Your keepsake book is ready — ${book.pages} page${book.pages === 1 ? '' : 's'}.`);
    } catch (e) {
      console.warn('Keepsake book failed:', e?.message || e);
      setNotice('Could not make the book just now. Please try again.');
    } finally {
      setMakingBook(false);
    }
  };

  return (
    <section className="v2-src">
      <button type="button" className="v2-backrow" onClick={onBack} aria-label="Back to Settings">
        <IconChevronLeft />
        <span>Settings</span>
      </button>

      <h1 className="v2-src-title">Export &amp; privacy</h1>
      <p className="v2-src-sub">
        Your readings, letters and rings live on this device. Ori never trains on them and never sells them.
      </p>

      <div className="v2-src-group">
        <div className="v2-src-row static">
          <span className="v2-src-tx">
            <span className="v2-src-l">Stored on device</span>
            <span className="v2-src-s">Everything stays local unless you back it up yourself.</span>
          </span>
          <span className="v2-src-status connected">On</span>
        </div>
        <div className="v2-src-row static">
          <span className="v2-src-tx">
            <span className="v2-src-l">Sent to write your letters</span>
            <span className="v2-src-s">Your writing goes to the AI model to write your letters. Anything you speak passes through Deepgram to become text first. Taps and one-tap gestures never leave this device.</span>
          </span>
          <span className="v2-src-status">Model</span>
        </div>
      </div>

      {/* Reflection sharing — the one data flow the user opts into, with its
          withdrawal control (GDPR Art. 7(3): as easy to withdraw as to grant). */}
      <div className="v2-src-eyebrow">Reflection sharing</div>
      <div className="v2-src-group">
        <div className="v2-src-row static">
          <span className="v2-src-tx">
            <span className="v2-src-l">Part-reflections</span>
            <span className="v2-src-s">
              {reflectConsent
                ? 'On — reflecting on a part sends that writing so Ori can mirror it back. Withdraw any time.'
                : 'Off — turn it on to let Ori mirror your reflections back. Otherwise Ori asks the first time you reflect.'}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={reflectConsent}
            aria-label="Share part-reflections"
            className={`v2-toggle${reflectConsent ? ' on' : ''}`}
            onClick={reflectConsent ? handleWithdrawReflect : handleGrantReflect}
          >
            <span className="k" />
          </button>
        </div>
      </div>

      {/* Two jobs, kept apart: a keepsake book to READ/print, and a backup to
          RESTORE. (The plain-Markdown export was removed — the PDF keepsake and
          the JSON backup cover "keep a copy" and "move to a new phone".) */}
      <div className="v2-src-eyebrow">Take it with you</div>
      <div className="v2-src-group">
        <button type="button" className="v2-src-row" onClick={handleExportBook} disabled={makingBook}>
          <span className="v2-src-ic"><IconKeepsake /></span>
          <span className="v2-src-tx">
            <span className="v2-src-l">A keepsake book</span>
            <span className="v2-src-s">Your whole journal laid out on Ori’s garden paper — one PDF to keep or print.</span>
          </span>
          <span className="v2-src-chev">{makingBook ? 'Preparing…' : 'PDF'} <IconChevronRight /></span>
        </button>
        <button type="button" className="v2-src-row" onClick={exportEverything}>
          <span className="v2-src-ic"><IconBackup /></span>
          <span className="v2-src-tx">
            <span className="v2-src-l">Back up &amp; move</span>
            <span className="v2-src-s">A complete save file — load it on a new phone in Import → Restore a backup.</span>
          </span>
          <span className="v2-src-chev">JSON <IconChevronRight /></span>
        </button>
      </div>

      <div className="v2-src-eyebrow">Remove</div>
      <div className="v2-src-group">
        {deleting ? (
          <div className="v2-src-row static">
            <span className="v2-src-ic clay"><IconCalX /></span>
            <span className="v2-src-tx">
              <span className="v2-src-l">Delete a day</span>
              <span className="v2-src-del">
                <input
                  type="date"
                  className="v2-src-date"
                  value={deleteIso}
                  onChange={(e) => setDeleteIso(e.target.value)}
                  max={localIso()}
                />
                <button type="button" className="v2-src-mini clay" onClick={handleDeleteDay} disabled={!deleteIso}>Delete</button>
                <button type="button" className="v2-src-mini" onClick={() => { setDeleting(false); setDeleteIso(''); }}>Cancel</button>
              </span>
            </span>
          </div>
        ) : (
          <button type="button" className="v2-src-row" onClick={() => setDeleting(true)}>
            <span className="v2-src-ic"><IconCalX /></span>
            <span className="v2-src-tx">
              <span className="v2-src-l">Delete a day</span>
              <span className="v2-src-s">Remove one date's entries, letter and check-in.</span>
            </span>
            <span className="v2-src-chev"><IconChevronRight /></span>
          </button>
        )}

        <button type="button" className="v2-src-row" onClick={handleEraseAll}>
          <span className="v2-src-ic clay"><IconTrash /></span>
          <span className="v2-src-tx">
            <span className="v2-src-l clay">Erase all of Ori</span>
            <span className="v2-src-s">Every entry, letter and connection — gone from this device.</span>
          </span>
          <span className="v2-src-chev clay"><IconChevronRight /></span>
        </button>
      </div>

      {notice && <p className="v2-src-foot">{notice}</p>}
    </section>
  );
}
