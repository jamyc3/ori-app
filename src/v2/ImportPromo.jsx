// Ori v2 — "Read your past month" announcement (Wrapped-style).
//
// A full-bleed reveal for existing users: bring a journal you've kept elsewhere
// (up to ~30 days back) and Ori reads your most recent 30 days, writing a letter
// for each. Styled like Spotify Wrapped — animated gradient, an oversized hero
// number, stat rows, a staggered reveal — but in Ori's voice and palette. The CTA
// routes straight to the upload surface (ImportJournal).
//
// Cadence (no infinite nag — honours the "mirror, not slot machine" guardrail):
// shown at most ONCE PER CALENDAR DAY, capped at IMPORT_PROMO_MAX_DAYS distinct
// days, then never again — even if the user never imports. Tapping "Upload" (real
// engagement) stops it permanently right away. `shouldShowImportPromo()` is the
// gate the shell asks on each open; `recordImportPromoImpression()` is called when
// it actually displays.
//
// Honesty: the big "30" is the real offer ceiling — your most recent 30 days get a
// reading; older entries stay in your journal as writing (no false "unlock"). No
// invented stats: "1 letter a day" and "every word kept" are literally true. The
// read runs after upload via the shared backfill runner.

import { useEffect } from 'react';
import './styles/backfill.css';

export const IMPORT_PROMO_SEEN_KEY = 'cpi_v2_import_promo_seen';   // permanent stop: engaged or cap reached
const PROMO_DAY_KEY = 'cpi_v2_import_promo_day';                   // last calendar day it was shown
const PROMO_COUNT_KEY = 'cpi_v2_import_promo_count';               // # of distinct days shown so far
export const IMPORT_PROMO_MAX_DAYS = 3;

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// One-time migration: the promo used to be gated by a single permanent "seen"
// boolean. Treat a legacy seen flag (set before the daily-cap logic existed —
// i.e. with no day-count recorded) as a single past impression, so those users
// still get the remaining daily showings instead of never seeing it again.
function migrateLegacyPromoFlag() {
  try {
    if (localStorage.getItem(IMPORT_PROMO_SEEN_KEY) === '1'
        && localStorage.getItem(PROMO_COUNT_KEY) === null) {
      localStorage.setItem(PROMO_COUNT_KEY, '1');
      localStorage.removeItem(IMPORT_PROMO_SEEN_KEY);
    }
  } catch { /* storage unavailable — fine */ }
}

// Should the promo show on this open? Once per calendar day, capped at
// IMPORT_PROMO_MAX_DAYS distinct days, never after a permanent stop.
export function shouldShowImportPromo() {
  try {
    migrateLegacyPromoFlag();
    if (localStorage.getItem(IMPORT_PROMO_SEEN_KEY) === '1') return false;       // engaged / capped → done
    const count = parseInt(localStorage.getItem(PROMO_COUNT_KEY) || '0', 10) || 0;
    if (count >= IMPORT_PROMO_MAX_DAYS) return false;                            // cap reached
    if (localStorage.getItem(PROMO_DAY_KEY) === todayStamp()) return false;      // already shown today
    return true;
  } catch { return false; }
}

// Record that the promo displayed today: stamp the day, bump the day-count, and
// once the cap is hit set the permanent flag so it never returns. Idempotent
// within a calendar day (and across StrictMode's double-mount).
export function recordImportPromoImpression() {
  try {
    const day = todayStamp();
    if (localStorage.getItem(PROMO_DAY_KEY) === day) return;
    localStorage.setItem(PROMO_DAY_KEY, day);
    const count = (parseInt(localStorage.getItem(PROMO_COUNT_KEY) || '0', 10) || 0) + 1;
    localStorage.setItem(PROMO_COUNT_KEY, String(count));
    if (count >= IMPORT_PROMO_MAX_DAYS) localStorage.setItem(IMPORT_PROMO_SEEN_KEY, '1');
  } catch { /* quota — fine */ }
}

// The user engaged (tapped Upload) — never show the promo again.
export function markImportPromoSeen() {
  try { localStorage.setItem(IMPORT_PROMO_SEEN_KEY, '1'); } catch { /* quota — fine */ }
}

function IconArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <path d="M3 8h9M8 4l4 4-4 4" />
    </svg>
  );
}

export default function ImportPromo({ onUpload, onClose }) {
  // Count this as one daily impression the moment it actually renders. Idempotent
  // per calendar day, so a same-day reopen or StrictMode's double-mount won't
  // double-count. The cap (and the permanent stop on hitting it) lives in here.
  useEffect(() => { recordImportPromoImpression(); }, []);

  // Upload = real engagement → never show again. "Maybe later" just closes; the
  // daily-cap impression already recorded above governs whether it returns.
  const upload = () => { markImportPromoSeen(); onUpload?.(); };
  const dismiss = () => { onClose?.(); };

  return (
    <section className="v2-promo wrapped">
      {/* animated gradient field + soft grain, purely decorative */}
      <div className="v2-promo-field" aria-hidden="true" />
      <div className="v2-promo-grain" aria-hidden="true" />

      <div className="v2-promo-inner">
        <div className="v2-promo-kicker"><span className="v2-promo-dot" />Ori · New</div>

        <div className="v2-promo-hero">
          <div className="v2-promo-bignum">30</div>
          <div className="v2-promo-bigword">days, read<br />back to you</div>
        </div>

        <p className="v2-promo-sub">
          Already keep a journal? Bring it. Ori reads your most recent
          thirty days and writes you a letter for each one.
        </p>

        <div className="v2-promo-stats">
          <div className="v2-promo-stat"><b>1</b><span>letter<br />a day</span></div>
          <div className="v2-promo-stat"><b>30</b><span>days<br />read</span></div>
          <div className="v2-promo-stat"><b className="glyph">∞</b><span>every word<br />kept</span></div>
        </div>

        <div className="v2-promo-actions">
          <button type="button" className="v2-promo-cta" onClick={upload}>
            Upload your journal
            <IconArrow />
          </button>
          <button type="button" className="v2-promo-later" onClick={dismiss}>
            Maybe later
          </button>
        </div>
      </div>
    </section>
  );
}
