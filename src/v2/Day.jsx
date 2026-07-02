// Ori v2 — Day view.
//
// "Where the day landed" — per-day Reserves/Demands/Form rings, that day's
// readings (timestamped italic snippets), parts that visited, and the day's
// letter inline. Opens from a Journal day cell. Phase 4.5.
//
// Honesty: each ring reads its own observed source for that date — Oura
// sleepScore (Reserves), the shared demands lookup (Demands), the WHO-5
// check-in (Form) — and shows a dash where the source has nothing. The
// HCPI composite stays engine-internal. Readings come from the shared
// journal repo, filtered by date. Parts come from the history entry's
// letterParts. Letter snippet comes from the cached letter (cpi_letter_<ymd>).

import { useEffect, useMemo, useState } from 'react';
import './styles/day.css';
import { PARTS_LIB, partLabel } from '../LetterReading.jsx';
import { reflectSttLanguage } from '../integrations/deepgram.js';
import { loadWho5History } from '../who5.js';
import { buildDemandsLookup } from './demandsData.js';
import { ProvenanceChip } from './Provenance.jsx';
import { loadRepo, repoUpdate, repoRemove } from '../engine.js';
import { tokenizeWithFlags } from '../voiceConfidence.js';
import { dayHasWords } from './letterEngine.js';
import { CrisisHelpFooter } from './CrisisSupport.jsx';

function loadHistory() {
  try {
    const raw = localStorage.getItem('cpi-v2-data');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (parsed?.history || []);
  } catch {
    return [];
  }
}

function loadLetter(iso) {
  try {
    const raw = localStorage.getItem(`cpi_letter_${iso}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function ymdOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// The letter time the user picked — matches Journal/Letter/Inbox copy.
function letterTimePref() {
  try {
    return localStorage.getItem('cpi_reflect_time') || '9 PM';
  } catch {
    return '9 PM';
  }
}

function entryYmd(entry) {
  if (typeof entry?.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(entry.date)) {
    return entry.date.slice(0, 10);
  }
  if (entry?.createdAt) {
    const d = new Date(entry.createdAt);
    if (!isNaN(d.getTime())) return ymdOf(d);
  }
  if (entry?.date) {
    const d = new Date(entry.date);
    if (!isNaN(d.getTime())) return ymdOf(d);
  }
  return null;
}

function isoToDate(iso) {
  const parts = iso.split('-').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return new Date();
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatHeadDate(iso) {
  const d = isoToDate(iso);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatTime(when) {
  if (!when) return '';
  const d = new Date(when);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

function entrySnippet(entry) {
  return String(entry?.transcription || entry?.rawText || entry?.text || entry?.dayDesc || '').trim();
}

// A quiet ripple — marks an entry that came from the reflect flow ("say a little
// about <part>") rather than a plain written/spoken entry.
function IconReflection() {
  return (
    <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <circle cx="8" cy="8" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="5.4" opacity="0.5" />
    </svg>
  );
}

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4l-6 6 6 6" />
    </svg>
  );
}

// A quiet pencil — the affordance to fix what you wrote or what Ori misheard.
function IconPencil() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10z" />
    </svg>
  );
}

// Render an entry's text, faintly underlining the words the transcriber was
// unsure of (entry.lowConf). Tapping a flagged word opens the editor — the
// fix for a mishear is one tap away. Falls back to plain text when there are
// no flags (the common case), and never alters a character of what was said.
function EntryText({ snip, lowConf, onEdit }) {
  const tokens = tokenizeWithFlags(snip, lowConf);
  if (tokens.length === 1 && !tokens[0].flagged) return <p>{snip}</p>;
  return (
    <p>
      {tokens.map((t, i) => (t.flagged ? (
        <button
          key={i}
          type="button"
          className="v2-dr-lowconf"
          onClick={onEdit}
          title="Ori wasn’t sure it heard this — tap to fix"
        >
          {t.text}
        </button>
      ) : (
        <span key={i}>{t.text}</span>
      )))}
    </p>
  );
}

export default function Day({ dateIso, onBack, onOpenLetter, onOpenPart }) {
  const todayIso = ymdOf(new Date());
  const isToday = dateIso === todayIso;
  const headerLabel = formatHeadDate(dateIso);

  const history = useMemo(() => loadHistory(), []);
  const repo = useMemo(() => loadRepo(), []);
  const letter = useMemo(() => loadLetter(dateIso), [dateIso]);

  const dayHistory = useMemo(() => {
    return history.find((h) => {
      const d = h?.date ? new Date(h.date) : null;
      return d && !isNaN(d.getTime()) && ymdOf(d) === dateIso;
    }) || null;
  }, [history, dateIso]);

  const dayEntries = useMemo(() => {
    return (repo.entries || [])
      .filter((e) => entryYmd(e) === dateIso)
      .slice()
      .sort((a, b) => {
        const ta = a?.createdAt || new Date(a?.uploadedAt || a?.date || 0).getTime();
        const tb = b?.createdAt || new Date(b?.uploadedAt || b?.date || 0).getTime();
        return ta - tb;
      });
  }, [repo, dateIso]);

  // Editable copy of the day's entries — the repo is read once on mount, so a
  // fix needs to re-render from local state. Re-seeds when the day changes.
  const [entries, setEntries] = useState(dayEntries);
  useEffect(() => { setEntries(dayEntries); }, [dayEntries]);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');
  // Two-step delete: emptying the box turns Save into "Delete entry"; that asks
  // to confirm before anything is removed, so a cleared box is never a silent
  // data loss.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const beginEdit = (entry) => { setEditingId(entry.id); setDraft(entrySnippet(entry)); setConfirmingDelete(false); };
  const cancelEdit = () => { setEditingId(null); setDraft(''); setConfirmingDelete(false); };
  const deleteEntry = (entry) => {
    repoRemove(entry.id);
    setEntries((es) => es.filter((e) => e.id !== entry.id));
    cancelEdit();
  };
  const commitEdit = (entry) => {
    const next = draft.trim();
    if (!next || next === entrySnippet(entry)) { cancelEdit(); return; }
    // Update BOTH text fields so a pre-letter edit flows into the analysis
    // (batch-analyze reads rawText || transcription), and stamp editedAt for
    // provenance. lowConf is left as-is: a still-present uncertain word stays
    // flagged; a word the user fixed simply no longer matches.
    const patch = { rawText: next, transcription: next, editedAt: new Date().toISOString() };
    repoUpdate(entry.id, patch);
    setEntries((es) => es.map((e) => (e.id === entry.id ? { ...e, ...patch } : e)));
    cancelEdit();
  };

  // Per-day ring values from the same sources every other surface uses:
  // Oura sleepScore that date for Reserves, the shared demands lookup for
  // Demands, that date's WHO-5 check-in for Form. Days a source didn't
  // cover show a dash — nothing is fabricated, and the HCPI composite is
  // never surfaced (it's engine-internal per the honesty contract).
  const rings = useMemo(() => {
    // Prefer the immutable snapshot captured when this day's letter was written
    // — the frozen record of where the day landed, matching the letter. Days
    // from before the snapshot existed fall back to a live recompute (backfill).
    try {
      const snap = JSON.parse(localStorage.getItem(`cpi_day_rings_${dateIso}`) || 'null');
      if (snap && typeof snap === 'object') {
        return [
          { label: 'Reserves', dot: 'amber', score: typeof snap.reserves === 'number' ? snap.reserves : null, metric: 'reserves' },
          { label: 'Demands', dot: 'ink', score: typeof snap.demands === 'number' ? snap.demands : null, metric: 'demands' },
          { label: 'Form', dot: 'sage', score: typeof snap.form === 'number' ? snap.form : null, metric: 'form' },
        ];
      }
    } catch { /* no snapshot — recompute live below */ }

    let reserves = null;
    try {
      const map = JSON.parse(localStorage.getItem('cpi_oura_history') || '{}');
      const v = map?.[dateIso]?.sleepScore;
      if (typeof v === 'number') reserves = Math.round(v);
    } catch { /* no wearable history */ }

    let demands = null;
    try {
      const v = buildDemandsLookup()(dateIso);
      if (typeof v === 'number') demands = Math.round(v);
    } catch { /* no demands sources */ }

    let form = null;
    try {
      // loadWho5History() returns a date-keyed MAP ({ 'YYYY-MM-DD': { score, ts } }),
      // not an array — iterating it with for...of throws (caught below), which is why
      // the Day view's Form read silently came back null. Look the day up directly.
      const rec = (loadWho5History() || {})[dateIso];
      if (rec && typeof rec.score === 'number') form = Math.round(rec.score);
    } catch { /* no check-ins */ }

    return [
      { label: 'Reserves', dot: 'amber', score: reserves, metric: 'reserves' },
      { label: 'Demands', dot: 'ink', score: demands, metric: 'demands' },
      { label: 'Form', dot: 'sage', score: form, metric: 'form' },
    ];
  }, [dateIso]);

  const partsOnDay = useMemo(() => {
    const ids = Array.isArray(dayHistory?.letterParts)
      ? dayHistory.letterParts.map((p) => p?.id).filter(Boolean)
      : (Array.isArray(letter?.result?.a?.letter?.parts)
        ? letter.result.a.letter.parts.map((p) => p?.id).filter(Boolean)
        : []);
    // A day with only part-reflections (no nightly letter) still touched parts —
    // each reflection entry names its partId. Union them in so the tile reflects
    // them instead of staying empty.
    const reflIds = (entries || [])
      .filter((e) => e?.source === 'reflection' && e?.partId)
      .map((e) => e.partId);
    return [...new Set([...ids, ...reflIds])]
      .map((id) => PARTS_LIB[id])
      .filter(Boolean);
  }, [dayHistory, letter, entries]);

  const letterFirstPara = useMemo(() => {
    const paras = letter?.result?.a?.letter?.paragraphs;
    if (!Array.isArray(paras) || paras.length === 0) return null;
    const first = String(paras[0] || '').trim();
    return first.length > 220 ? `${first.slice(0, 220)}…` : first;
  }, [letter]);

  return (
    <section className="v2-day">
      <button type="button" className="v2-backrow" onClick={onBack} aria-label="Back to journal">
        <IconChevronLeft />
        <span>Journal</span>
      </button>

      {/* Title owns its full width so the date never gets squeezed onto two
          lines by the button beside it. The "Read letter" action and the
          reading count share the meta row just beneath. */}
      <h1 className="v2-day-title">{headerLabel}</h1>
      <div className="v2-day-metarow">
        <span className="v2-day-sub">
          {dayEntries.length === 0
            ? 'No readings'
            : `${dayEntries.length} reading${dayEntries.length === 1 ? '' : 's'}`}
        </span>
        {letter ? (
          <button type="button" className="v2-day-read-btn" onClick={() => onOpenLetter?.(dateIso)}>
            Read letter
          </button>
        ) : null}
      </div>

      {/* "Where the day landed" — only the rings that actually have a reading
          for this date. A day with just a sleep score shows one tidy "79 ·
          Reserves" tile, centered — never a box padded out with dashes. */}
      {rings.some((r) => r.score != null) && (
        <>
          <div className="v2-day-eyebrow">Where the day landed</div>
          <div className="v2-day-rings">
            {rings.filter((r) => r.score != null).map((r) => (
              <div key={r.label} className="v2-day-ring">
                <span className={`v2-dr-dot ${r.dot}`} />
                <span className="v2-dr-score">{r.score}</span>
                <span className="v2-dr-lbl">{r.label}</span>
                <ProvenanceChip metric={r.metric} dateIso={dateIso} />
              </div>
            ))}
          </div>
        </>
      )}

      {/* Inline letter card */}
      {letter ? (
        <button type="button" className="v2-day-letter" onClick={() => onOpenLetter?.(dateIso)}>
          <div className="v2-dl-eye">A letter from Ori</div>
          <p>{letterFirstPara || 'A letter is waiting.'}</p>
          <span className="v2-dl-open">Read it in full →</span>
        </button>
      ) : isToday ? (
        <button type="button" className="v2-day-letter pending" onClick={() => onOpenLetter?.(dateIso)}>
          <div className="v2-dl-eye">Tonight</div>
          <p>Still being written. Your letter arrives around {letterTimePref()}.</p>
          {dayHasWords(dateIso) && <span className="v2-dl-open">Read it now →</span>}
        </button>
      ) : dayHasWords(dateIso) ? (
        <button type="button" className="v2-day-letter pending" onClick={() => onOpenLetter?.(dateIso)}>
          <div className="v2-dl-eye">Your letter is waiting</div>
          <p>This day’s letter wasn’t written yet — open it to read, from what you wrote.</p>
          <span className="v2-dl-open">Read it now →</span>
        </button>
      ) : (
        <div className="v2-day-letter pending">
          <div className="v2-dl-eye">No letter for this day</div>
          <p>There weren’t words this day to write a letter from.</p>
        </div>
      )}

      {/* Parts that showed up */}
      {partsOnDay.length > 0 ? (
        <>
          <div className="v2-day-eyebrow">Parts that visited</div>
          <div className="v2-day-parts">
            {partsOnDay.map((p) => (
              <button
                key={p.id}
                type="button"
                className="v2-day-part"
                style={{ color: p.color || 'var(--ink)' }}
                onClick={() => onOpenPart?.(p.id)}
              >
                {partLabel(p, reflectSttLanguage())}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {/* Readings list — repo entries, or the day's check-in text when the
          only record is a v1 history entry (dayDesc). */}
      {entries.length > 0 ? (
        <>
          <div className="v2-day-eyebrow">What you said</div>
          {entries.map((entry, i) => {
            const snip = entrySnippet(entry);
            const when = entry?.createdAt || entry?.uploadedAt || entry?.date;
            const time = formatTime(when);
            const isReflection = entry?.source === 'reflection';
            const editable = Boolean(entry.id);
            const editing = editingId === entry.id;
            const hasFlags = Array.isArray(entry.lowConf) && entry.lowConf.length > 0;
            return (
              <div key={entry.id || i} className={`v2-day-read${isReflection ? ' is-reflection' : ''}`}>
                <div className="v2-dr-head">
                  {time ? <span className="v2-dr-time">{time}</span> : <span />}
                  <span className="v2-dr-headend">
                    {isReflection ? (
                      <span className="v2-dr-refl">
                        <IconReflection />
                        {entry.partName ? `On ${entry.partName}` : 'Reflection'}
                      </span>
                    ) : null}
                    {entry.editedAt && !editing ? <span className="v2-dr-edited">edited</span> : null}
                    {editable && !editing ? (
                      <button type="button" className="v2-dr-editbtn" onClick={() => beginEdit(entry)} aria-label="Edit this entry">
                        <IconPencil />
                      </button>
                    ) : null}
                  </span>
                </div>
                {editing ? (
                  <div className="v2-dr-editbox">
                    <textarea
                      className="v2-dr-editarea"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      aria-label="Edit your entry"
                      autoFocus
                    />
                    <div className="v2-dr-editactions">
                      {confirmingDelete ? (
                        <>
                          <span className="v2-dr-confirmq">Delete this entry?</span>
                          <button type="button" className="v2-dr-cancel" onClick={() => setConfirmingDelete(false)}>Keep it</button>
                          <button type="button" className="v2-dr-delete" onClick={() => deleteEntry(entry)}>Yes, delete</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="v2-dr-cancel" onClick={cancelEdit}>Cancel</button>
                          {draft.trim() ? (
                            <button type="button" className="v2-dr-save" onClick={() => commitEdit(entry)}>Save</button>
                          ) : (
                            <button type="button" className="v2-dr-delete" onClick={() => setConfirmingDelete(true)}>Delete entry</button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <EntryText snip={snip} lowConf={entry.lowConf} onEdit={() => beginEdit(entry)} />
                    {hasFlags ? (
                      <span className="v2-dr-hint">Underlined words may be misheard — tap one to fix.</span>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </>
      ) : dayHistory?.dayDesc ? (
        <>
          <div className="v2-day-eyebrow">What you said</div>
          <div className="v2-day-read">
            {formatTime(dayHistory.date) ? <span className="v2-dr-time">{formatTime(dayHistory.date)}</span> : null}
            <p>{String(dayHistory.dayDesc).trim()}</p>
          </div>
        </>
      ) : null}
      <CrisisHelpFooter />
    </section>
  );
}
