// Ori v2 — the App Store review ask, done honestly.
//
// Principle (engagement = mirror, not slot machine): ask ONLY after Ori has
// actually given something back — never on launch, never mid-flow, never
// twice. The moment chosen is closing a letter, when the person has just
// finished reading, and only once they've read at least two (the first letter
// is still a first impression; the second means it landed).
//
// iOS is the final arbiter anyway: SKStoreReviewController caps prompts at
// ~3/year and may silently show nothing, so this can never nag.
//
// Web is a no-op. All state is local:
//   ori_review_asked        — '1' once we've requested (we never ask again)
//   ori_letters_read_count  — letters the user has finished reading

import { Capacitor, registerPlugin } from '@capacitor/core';

const ReviewBridge = registerPlugin('ReviewBridge');

const ASKED_KEY = 'ori_review_asked';
const COUNT_KEY = 'ori_letters_read_count';
const MIN_LETTERS_READ = 2;

function isNative() {
  try { return Boolean(Capacitor?.isNativePlatform?.()); } catch { return false; }
}

// Call when the user CLOSES a real (non-sample) letter they had open.
export function noteLetterReadAndMaybeAsk() {
  let count = 0;
  try {
    count = (parseInt(localStorage.getItem(COUNT_KEY), 10) || 0) + 1;
    localStorage.setItem(COUNT_KEY, String(count));
  } catch { return; }
  if (!isNative()) return;
  try {
    if (localStorage.getItem(ASKED_KEY) === '1') return;
    if (count < MIN_LETTERS_READ) return;
    localStorage.setItem(ASKED_KEY, '1');
    // A beat after the close animation so the sheet never collides with the
    // letter dismissal. Fire-and-forget; a missing plugin just does nothing.
    setTimeout(() => { ReviewBridge.requestReview().catch(() => {}); }, 1200);
  } catch { /* best-effort — never block the close */ }
}
