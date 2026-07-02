// Ori v2 — Letter surface.
//
// Renders today's letter from the shared cache (cpi_letter_<ymd>). The
// engine and the LLM that produces the letter are unchanged — v2 only
// re-skins how it's presented. Tappable part references in the prose
// open the Per-Part detail screen.
//
// Phase 2 scope: pending state, dateline + salutation, parts-peek ribbon,
// body paragraphs with inline part-refs, signature, helpline footer.
// Deferred to later phases: pull-quote (engine doesn't emit one yet),
// source chips, long-letter clamp, action row.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useModalA11y } from './useModalA11y.js';
import './styles/letter.css';
import { PARTS_LIB, visitedPartsFromLetter, visitedPartsFromAnalysis, headlineFor, partLabel } from '../LetterReading.jsx';
import { reflectSttLanguage } from '../integrations/deepgram.js';
import { buildLetterCard, shareLetterCard } from './letterCard.js';
import { ymdISO } from '../dates.js';
import { SAMPLE_DATE, SAMPLE_LETTER } from './sampleLetter.js';
import { ProvenanceChip } from './Provenance.jsx';
import { writeLetterFor, dayHasWords, letterDueNow, letterStaleFor, newEntriesSince } from './letterEngine.js';
import { WAITING_FACTS } from './waitingFacts.js';
import { CrisisHelpFooter } from './CrisisSupport.jsx';
import { noteLetterReadAndMaybeAsk } from './reviewPrompt.js';

// The first thing shown when the letter starts writing — it simply says Ori is
// at work. After that we drift slowly through WAITING_FACTS (little wonders of
// animal & human psychology), so a longer wait stays interesting instead of
// looping a handful of lines. See waitingFacts.js.
const WRITING_OPENER = 'Writing now — reading back through your day…';

// Wall-clock backstop for a manual/auto write. The letter call has NO client
// timeout by design (letters can legitimately take up to ~a minute — see the
// long note in engine.js), but a socket that stalls mid-stream and never errors
// would otherwise leave the "Writing…" spinner up forever. 4 minutes is far
// beyond any real generation, so this only ever fires on a genuine hang — it
// converts the eternal spinner into the existing offline "Try again" state and
// never cuts off a letter that's still streaming in.
const WRITE_BACKSTOP_MS = 240_000;

// The letter time the user picked ("9 PM", "Sunrise", or v1's "HH:MM").
function letterTimePref() {
  try {
    return localStorage.getItem('cpi_reflect_time') || '9 PM';
  } catch {
    return '9 PM';
  }
}

// How the letter signs off — the Settings → Signature value, or "— Ori".
function signaturePref() {
  try {
    const s = (localStorage.getItem('cpi_signature') || '').trim();
    return s || '— Ori';
  } catch {
    return '— Ori';
  }
}

// Who the letter is addressed to — the user's name, drawn from the garden
// name ("Sam's evenings" → "Sam"). Falls back to "you" when unset.
function salutationName() {
  try {
    const raw = (localStorage.getItem('cpi_garden_name') || '').trim();
    if (!raw) return 'you';
    const m = raw.match(/^(.+?)['’]s\s+evenings$/i);
    const name = (m ? m[1] : raw).trim();
    return name || 'you';
  } catch {
    return 'you';
  }
}

function loadLetterFor(dateIso) {
  if (dateIso === SAMPLE_DATE) return SAMPLE_LETTER;
  try {
    const raw = localStorage.getItem(`cpi_letter_${dateIso}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isoToDate(iso) {
  const parts = iso.split('-').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return new Date();
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDateline(date = new Date()) {
  // A letter dates itself plainly — "Friday, June 12" — not as a mono caps tag.
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function IconShare() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v13" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
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

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Split a paragraph string on every visited part name (case-insensitive,
// whole-word) and wrap matches in a tappable button. Same approach as v1's
// renderWithParts but as a button so the focus / click semantics are
// proper for the part-detail navigation.
function renderParagraph(text, visited, onOpenPart) {
  if (!visited.length || !text) return text;
  const lang = reflectSttLanguage();
  const names = visited.map((v) => partLabel(v.part, lang)).filter(Boolean);
  if (!names.length) return text;
  // The whole visited set, in letter order — passed alongside the tapped id so
  // the part screen can page through every part this letter named.
  const ids = visited.map((v) => v.part.id);
  const re = new RegExp(`(${names.map(escapeRe).join('|')})`, 'gi');
  const src = String(text);
  const out = [];
  let last = 0;
  let key = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    const start = m.index;
    let end = start + m[0].length;
    // A Bengali case/possessive ending attaches to the noun with NO space
    // (শরীরের ডাক → শরীরের ডাকের). Splitting it off would orphan the leading
    // dependent vowel sign, which the text renderer shows as a dotted circle
    // (◌). So extend the match over any immediately-following Bengali code
    // points (incl. ZWJ/ZWNJ) so the whole orthographic word — and its grapheme
    // clusters — stay intact inside one element. Latin scripts have no such
    // trailing marks, so the English path is unchanged.
    while (end < src.length && /[\u0980-\u09FF\u200C\u200D]/.test(src[end])) end++;
    const tok = src.slice(start, end);
    // Resolve the part from the name the regex actually matched (m[0]), not the
    // suffix-extended token.
    const matched = visited.find((v) => partLabel(v.part, lang).toLowerCase() === m[0].toLowerCase());
    if (start > last) out.push(<span key={key++}>{src.slice(last, start)}</span>);
    if (matched) {
      out.push(
        <button
          key={key++}
          type="button"
          className="v2-part-ref"
          style={{ color: matched.part.color || 'var(--forest)' }}
          onClick={() => onOpenPart?.(matched.part.id, ids)}
        >
          {tok}
        </button>
      );
    } else {
      out.push(<span key={key++}>{tok}</span>);
    }
    last = end;
    re.lastIndex = end; // resume after the extended match, not mid-suffix
  }
  if (last < src.length) out.push(<span key={key++}>{src.slice(last)}</span>);
  return out;
}

export default function Letter({ onClose, onOpenPart, dateIso }) {
  const targetIso = dateIso || ymdISO(new Date());
  const isToday = targetIso === ymdISO(new Date());
  const targetDate = isoToDate(targetIso);
  const [stored, setStored] = useState(() => loadLetterFor(targetIso));
  // Declared up here (not beside "Read it now" below) so the cpi:letter-written
  // refresh effect can clear it the moment the letter lands from any writer.
  const [writing, setWriting] = useState(false);
  // Live prose streamed from Call A (the "read it now" path) — rendered token by
  // token while the structured analysis (Call B) runs in parallel. Cleared the
  // moment the final stored letter lands so the enriched render takes over.
  const [streamingText, setStreamingText] = useState('');

  // Re-read today's letter when it could have changed. Crucially this listens
  // for `cpi:letter-written` — the 8 PM auto-tick (and the share/other tabs)
  // dispatch it while THIS screen may already be open. Without it the screen
  // stayed stuck on "your letter arrives around 8 PM" even after the letter
  // had been written. `focus` alone never fired in that case. (Matches Today.jsx.)
  useEffect(() => {
    if (!isToday) return undefined;
    const refresh = () => {
      const s = loadLetterFor(targetIso);
      setStored(s);
      // Whoever wrote the letter (the shell's clock, another tab, this screen)
      // ends any in-progress wait spinner — the render keys off the letter, but
      // this also stops the waiting-line interval.
      if (s) { setWriting(false); setStreamingText(''); }
    };
    const events = ['focus', 'cpi:letter-written', 'cpi:wearable-synced', 'cpi:who5-updated'];
    for (const e of events) window.addEventListener(e, refresh);
    return () => { for (const e of events) window.removeEventListener(e, refresh); };
  }, [isToday, targetIso]);

  // Opening a letter marks it read — Today's Inbox badge counts the
  // letters that exist without this mark.
  useEffect(() => {
    if (!stored || targetIso === SAMPLE_DATE) return;
    try {
      localStorage.setItem(`cpi_letter_read_${targetIso}`, '1');
    } catch { /* storage unavailable — badge just stays */ }
  }, [stored, targetIso]);

  const isSample = targetIso === SAMPLE_DATE;
  const [expanded, setExpanded] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [card, setCard] = useState(null); // built keepsake card, shown in a preview
  const cardDialogRef = useRef(null);
  useModalA11y(Boolean(card), () => setCard(null), cardDialogRef);

  // "Read it now" — v1 wrote the letter the moment you checked in; v2's
  // clock waits for letter hour. This hands the pen back: write today's
  // letter early, from whatever has been shared so far. (`writing` is declared
  // up top so the refresh effect can clear it.)
  // false = no failure; otherwise the reason string ('no-words' | 'gate' | 'offline').
  const [writeFailed, setWriteFailed] = useState(false);
  // Any day with words and no letter yet can be read on demand — today (early,
  // before the letter hour) OR a past day whose letter was never written because
  // the app wasn't open at its hour. The sample never writes.
  const canWriteNow = !isSample && !stored && dayHasWords(targetIso);
  const handleWriteNow = async () => {
    if (writing) return;
    setWriting(true);
    setWriteFailed(false);
    setStreamingText('');
    let res = null;
    try {
      // onProse streams Call A's letter prose into view while Call B's structured
      // analysis runs in parallel; English-only and best-effort (no stream → just
      // the wait line, then the finished letter). Raced against WRITE_BACKSTOP_MS
      // so a hung (never-settling) connection can't strand the spinner — a real
      // letter always finishes far inside the cap; only a genuine stall trips it.
      res = await Promise.race([
        writeLetterFor(targetIso, { onProse: (t) => setStreamingText(t) }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('backstop')), WRITE_BACKSTOP_MS)),
      ]);
    } catch {
      res = { error: 'offline' };
    }
    // A real letter always wins over a transient failure result: if one exists
    // now, show it and clear any error — never an error when there's a letter to
    // open. (writeLetterFor's fetch is bounded, so this await always settles and
    // we always leave the spinner here; no wall-clock backstop is needed.)
    const fresh = loadLetterFor(targetIso);
    if (fresh) { setWriteFailed(false); setStored(fresh); setStreamingText(''); setWriting(false); return; }
    if (res && res.error) { setStreamingText(''); setWriting(false); setWriteFailed(res.error); return; }
    // res === null: another writer holds the lock (the shell's clock). Drop the
    // spinner — today's letter arrives via the cpi:letter-written listener, and a
    // past day can simply be tapped again.
    setStreamingText(''); setWriting(false);
  };

  // "Read again" — the explicit, always-available way to re-read TODAY's letter
  // from EVERY entry that exists now, including reflections added after an early
  // read. This is the reliable manual path; the auto-refresh effect below is a
  // convenience on top, not the only way to get a complete letter. Force-rewrites
  // and shows the writing animation; a failure keeps the current letter.
  const handleReadAgain = async () => {
    if (writing) return;
    setWriting(true);
    try { await writeLetterFor(targetIso, { force: true }); } catch { /* keep current letter */ }
    const fresh = loadLetterFor(targetIso);
    if (fresh) setStored(fresh);
    setWriting(false);
  };

  // Auto-write on open. Landing on today's letter at/after the letter hour with
  // words but nothing written yet — e.g. having tapped the "your letter is ready"
  // notification — starts the write immediately and shows the animation, instead
  // of a static line and a "Read it now" button to hunt for. letterDueNow() is
  // false before the letter hour and during the retry backoff, so this never
  // writes early (the manual button stays the deliberate early path) and never
  // fights an in-progress attempt.
  useEffect(() => {
    if (!(isToday && !stored && letterDueNow())) return undefined;
    // Defer the kickoff a tick so the write starts after this screen has painted
    // its "Writing…" state, and so the setState lives outside the effect body.
    const id = setTimeout(handleWriteNow, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToday, stored]);

  // Living-draft refresh. Today's letter is provisional: if you read it early
  // and then reflected more (spoke or wrote again), the day's words have
  // outgrown what's on screen. On open we quietly rewrite it from EVERYTHING
  // said today, rather than freezing you on the first early read. Runs at most
  // once per open; a failed rewrite keeps the existing letter (never a blank).
  // Past days (final) and crisis days never regenerate — letterStaleFor gates
  // both. This is the logic that replaces the old "write once, ignore the rest".
  const staleTriedRef = useRef(false);
  useEffect(() => {
    if (staleTriedRef.current) return undefined;
    if (isSample || !isToday || !stored || stored.crisis) return undefined;
    if (!letterStaleFor(targetIso)) return undefined;
    staleTriedRef.current = true;
    setWriting(true);
    let cancelled = false;
    const id = setTimeout(async () => {
      try { await writeLetterFor(targetIso, { force: true }); } catch { /* keep current letter */ }
      if (cancelled) return;
      const fresh = loadLetterFor(targetIso);
      if (fresh) setStored(fresh);
      setWriting(false);
    }, 0);
    return () => { cancelled = true; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToday, targetIso, stored]);

  // While writing, drift through the facts on a slow, readable cadence — long
  // enough to actually take one in (the key change replays the fade). Index 0 is
  // the opener; we start the pool at a random point each time so consecutive
  // evenings don't replay the same opening facts. Resets to the opener when
  // writing ends.
  const [waitIdx, setWaitIdx] = useState(0);
  useEffect(() => {
    if (!writing) { setWaitIdx(0); return undefined; }
    const start = Math.floor(Math.random() * WAITING_FACTS.length);
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setWaitIdx(((start + n) % WAITING_FACTS.length) + 1);
    }, 6500);
    return () => clearInterval(id);
  }, [writing]);
  const waitLine = waitIdx === 0
    ? WRITING_OPENER
    : WAITING_FACTS[(waitIdx - 1) % WAITING_FACTS.length];
  const hasOura = (() => {
    try { return Boolean(localStorage.getItem('cpi_oura_access_token')); } catch { return false; }
  })();

  // A crisis day carries a sentinel ({ crisis: true }) instead of a letter:
  // letterEngine suppressed generation because the day's writing tripped the
  // crisis detector. We never compose prose over that — we route to help.
  const isCrisis = Boolean(stored?.crisis);
  const letter = stored?.result?.a?.letter;
  const insights = stored?.result?.a?.insights;
  // Today's letter only: how many reflections recorded since it was written but
  // not yet read into it. Labels the always-available "Read again" button so a
  // letter is never silently incomplete.
  const newCount = (isToday && stored && !isCrisis && !isSample) ? newEntriesSince(targetIso) : 0;

  const { visited, headline, paragraphs } = useMemo(() => {
    if (!letter) return { visited: [], headline: null, paragraphs: [] };
    const v = visitedPartsFromLetter(letter).length
      ? visitedPartsFromLetter(letter)
      : visitedPartsFromAnalysis(stored?.result?.a, 'neutral');
    const h = (typeof letter.headline === 'string' && letter.headline.trim())
      ? letter.headline.trim()
      : headlineFor(v);
    const llmParas = Array.isArray(letter.paragraphs)
      ? letter.paragraphs.map((p) => String(p || '').trim()).filter(Boolean)
      : [];
    const body = llmParas.length > 0
      ? llmParas
      : (insights || []).slice(0, 2).map((ins) => ins?.body).filter(Boolean);
    return { visited: v, headline: h, paragraphs: body };
  }, [letter, insights, stored?.result?.a]);

  // Long letters clamp behind "Continue reading" (design's .letter-more).
  const clamped = paragraphs.length > 3 && !expanded;

  // Pull this letter out as a keepsake image — the whole letter, on the garden
  // paper, to save to Photos or share. Real letters only (never the sample).
  // Tapping builds the card and shows it in a preview first, so you SEE the
  // keepsake on screen before deciding to save/share (a silent download left
  // people unsure anything happened).
  const handleShare = async () => {
    if (sharing || isSample || !headline) return;
    setSharing(true);
    try {
      // Mirror the letter exactly as read: dateline → salutation → prose →
      // signature. No headline line (the in-app letter doesn't show one).
      const built = await buildLetterCard({
        dateline: formatDateline(targetDate),
        salutation: `Dear ${salutationName()},`,
        paragraphs,
        signature: signaturePref(),
      });
      setCard(built);
    } catch {
      /* best-effort — sharing never blocks reading */
    } finally {
      setSharing(false);
    }
  };

  const handleSaveCard = async () => {
    if (!card) return;
    await shareLetterCard(card, `ori-letter-${targetIso}.png`, 'A letter from Ori');
  };

  // Closing a letter the person actually had in front of them is the one
  // moment we count toward the (single, native-only) review ask — see
  // reviewPrompt.js for the gating. Sample letters don't count.
  const handleClose = () => {
    if (stored && !isSample) noteLetterReadAndMaybeAsk();
    onClose?.();
  };

  return (
    <div className="v2-letter">
      <div className="v2-letter-top">
        <button type="button" className="v2-backrow" onClick={handleClose} aria-label="Close letter">
          <IconChevronLeft />
          <span>{isToday ? 'Today' : 'Back'}</span>
        </button>
        {!isSample && headline && (
          <button
            type="button"
            className="v2-letter-share-ic"
            onClick={handleShare}
            disabled={sharing}
            aria-label="Keep this letter"
            title="Keep this letter"
          >
            <IconShare />
          </button>
        )}
      </div>

      {isCrisis ? (
        // Letter withheld — the day's words tripped the crisis detector. Lead
        // with verified, one-tap lines (same copy as the Today capture banner);
        // no AI reflection is composed over crisis writing.
        <div className="v2-crisis is-center" role="alert">
          <b>If tonight is heavy, you don't have to carry it alone.</b>
          <span>
            <a href="tel:988">Call or text 988 (US)</a> · <a href="sms:741741&body=HOME">text HOME to 741741</a> · <a href="https://findahelpline.com" target="_blank" rel="noopener noreferrer">find a helpline anywhere</a>
          </span>
          <i>Ori is a journal, not a crisis service — these are real people who can help right now.</i>
        </div>
      ) : (!letter || writing) ? (
        <>
          {writing ? (
            // Streamed prose (Call A) renders live as it arrives. The streamed
            // text is "headline\n\nparagraphs"; the in-app letter hides the
            // headline (it's for the keepsake card), so we show salutation +
            // paragraphs to match the finished letter. Before the first paragraph
            // lands we keep the rotating wait line.
            (() => {
              const blocks = streamingText.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
              const paras = blocks.slice(1); // drop the headline block
              if (!paras.length) {
                return (
                  <p key={waitIdx} className="v2-letter-pending v2-letter-waiting is-center">
                    {waitLine}
                  </p>
                );
              }
              return (
                <div className="v2-letter-streaming" aria-live="polite">
                  <h1 className="v2-letter-salutation">Dear {salutationName()},</h1>
                  <div className="v2-letter-body">
                    {paras.map((p, i) => <p key={i}>{p}</p>)}
                  </div>
                </div>
              );
            })()
          ) : (
            <p className="v2-letter-pending is-center">
              {canWriteNow
                ? (isToday
                    ? `Your letter arrives around ${letterTimePref()} — or read it now, from what you've shared so far.`
                    : 'This day’s letter is still waiting — read it now, written from what you wrote that day.')
                : (isToday
                    ? `Your letter arrives around ${letterTimePref()}, once today has some words in it.`
                    : 'No letter for this day — there weren’t words to write one from.')}
            </p>
          )}
          {canWriteNow && !writing && !writeFailed && (
            <button type="button" className="v2-letter-now" onClick={handleWriteNow}>
              Read it now
            </button>
          )}
          {writeFailed && !writing && (
            <>
              <p className="v2-letter-pending v2-letter-failmsg">
                {writeFailed === 'no-words'
                  ? "There aren't quite enough words yet to write from. Add a little more about today, then try again."
                  : writeFailed === 'gate'
                    ? "The letter didn't come out right just now — one more try usually settles it."
                    : "Couldn't reach the writing desk just now. Check your connection and try again."}
              </p>
              <button type="button" className="v2-letter-now" onClick={handleWriteNow}>
                Try again
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <div className="v2-letter-dateline">{isSample ? 'Some evening, soon' : formatDateline(targetDate)}</div>
          <h1 className="v2-letter-salutation">Dear {isSample ? 'you' : salutationName()},</h1>

          {/* Just the letter: salutation straight into flowing prose, no widget
              card or pull-quote breaking the voice. Tappable part names stay
              inline. Long letters clamp behind "Continue reading". */}
          <div className={`v2-letter-body${clamped ? ' clamped' : ''}`}>
            {paragraphs.length > 0 ? (
              paragraphs.map((p, i) => (
                <p key={i}>{renderParagraph(p, visited, onOpenPart)}</p>
              ))
            ) : (
              <p>The garden was steady today. Nothing in the writing asked for a closer look.</p>
            )}
          </div>
          {clamped && (
            <button type="button" className="v2-letter-more" onClick={() => setExpanded(true)}>
              Continue reading
            </button>
          )}

          <div className="v2-letter-signature">{isSample ? '— Ori' : signaturePref()}</div>

          {/* A letter's quiet footer — who moved through the day, then one
              honest line on where the letter came from. No widget cards or
              chips: it stays a letter to its last line. */}
          {visited.length > 0 ? (
            <div className="v2-letter-foot-parts">
              <span className="v2-lpp-avs">
                {visited.slice(0, 3).map(({ part }) => (
                  <span
                    key={part.id}
                    className="v2-lpp-av"
                    style={{ background: part.color || 'var(--forest)' }}
                    aria-hidden="true"
                  />
                ))}
              </span>
              <span className="v2-lpp-tx">
                {visited.length === 1
                  ? '1 part moved through your day'
                  : `${visited.length} parts moved through your day`}
              </span>
              <button
                type="button"
                className="v2-lpp-go"
                onClick={() => onOpenPart?.(visited[0]?.part?.id, visited.map((v) => v.part.id))}
              >
                explore
              </button>
            </div>
          ) : null}

          <div className="v2-letter-source">
            <span>Written from your words today{hasOura ? ' · and last night’s sleep' : ''}.</span>
            <ProvenanceChip metric="letter" />
          </div>

          {/* Always-available on today's letter: re-read from EVERY entry that
              exists now, so reflections added after an early read are never
              stranded. When new ones are detected, the label says how many. */}
          {isToday && !isSample && (
            <button
              type="button"
              className={`v2-letter-now v2-letter-readagain${newCount > 0 ? ' has-new' : ''}`}
              onClick={handleReadAgain}
            >
              {newCount > 0
                ? `Read again · ${newCount} new reflection${newCount === 1 ? '' : 's'}`
                : 'Read again'}
            </button>
          )}
        </>
      )}

      {/* Crisis help stays always reachable, but as the same quiet always-on
          footer every other surface uses ("In crisis? Get help") — not a
          prominent inline helpline that reads oddly on the neutral waiting /
          fun-fact screen. The crisis-DETECTED day keeps its prominent card
          above (the isCrisis branch); this footer is the calm baseline. */}
      <CrisisHelpFooter />

      {card && (
        <div className="v2-card-overlay" onClick={() => setCard(null)} role="presentation">
          <div
            className="v2-card-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Your letter as a card"
            tabIndex={-1}
            ref={cardDialogRef}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="v2-card-scroll">
              <img className="v2-card-img" src={card.dataUrl} alt="Your letter, as a card to keep" />
            </div>
            <div className="v2-card-actions">
              <button type="button" className="v2-card-btn primary" onClick={handleSaveCard}>Save / share</button>
              <button type="button" className="v2-card-btn ghost" onClick={() => setCard(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
