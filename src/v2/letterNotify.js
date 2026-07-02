// Ori v2 — the two everyday letter-cycle notifications (local, on-device).
//
//  1. Journaling reminder (id 8801): a one-shot at the user's reflection hour,
//     fired ONLY when they haven't written anything today. The shell re-syncs it
//     on launch, on foreground and after every capture, so the moment the user
//     journals it's cancelled. Tapping it opens the capture (journal) flow.
//
//  2. Letter ready (id 8804): fired the instant tonight's letter is actually
//     written (cpi:letter-written). The shell only fires it when the app is in
//     the background — when Ori is open the screen already shows the letter, so
//     a banner would just be noise. Tapping it opens the letter.
//
// No server, no push: Capacitor's LocalNotifications schedules both on-device.
// Best-effort throughout — a denied permission or missing plugin just means no
// notification, never an error. Web is a no-op (the plugin is native).

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { letterHourToday, todayHasWords, letterExistsToday } from './letterEngine.js';
import { dailyNudgeEnabled } from './dailyNudge.js';
import { ensureNotifyPermission } from './notifyPermission.js';

const JOURNAL_REMINDER_ID = 8801; // "you haven't noted today yet"
const LETTER_READY_ID = 8804;     // "your letter is ready"

function isNative() {
  try { return Boolean(Capacitor?.isNativePlatform?.()); } catch { return false; }
}

// Shared gate (notifyPermission.js): no caching (Settings re-grants picked up
// on next sync) and the one-shot OS dialog can only fire AFTER onboarding —
// never over a brand-new user's first screen.
const ensurePermission = ensureNotifyPermission;

// ── 1. Journaling reminder ────────────────────────────────────────────────
let syncing = false; // guards focus + visibilitychange racing the cancel→schedule

// (Re)schedule the "note your day" reminder for the reflection hour — but only
// when today still has no words. Cancels itself the moment something's written.
// Call on launch, on foreground and after a capture.
export async function syncJournalReminder() {
  if (!isNative() || syncing) return;
  syncing = true;
  try {
    // Always clear the prior schedule first — state may have changed. The guard
    // above keeps two near-simultaneous foreground events (focus AND
    // visibilitychange) from interleaving a cancel with a schedule.
    await LocalNotifications.cancel({ notifications: [{ id: JOURNAL_REMINDER_ID }] }).catch(() => {});

    // If the repeating daily nudge (8803) is on, it already fires at this exact
    // hour and covers "open Ori" — scheduling this too would land TWO banners at
    // the same minute. Let the nudge own it.
    if (dailyNudgeEnabled()) return;

    // Only nudge if nothing's written yet today and the hour is still ahead.
    if (todayHasWords()) return;
    const at = letterHourToday();
    if (!(at instanceof Date) || at.getTime() <= Date.now() + 30 * 1000) return;

    if (!(await ensurePermission())) return;

    await LocalNotifications.schedule({
      notifications: [{
        id: JOURNAL_REMINDER_ID,
        title: 'How was today?',
        body: 'You haven’t noted your day yet — a minute is enough.',
        schedule: { at, allowWhileIdle: true },
      }],
    });
  } catch {
    /* notifications are best-effort — never block the app */
  } finally {
    syncing = false;
  }
}

export async function cancelJournalReminder() {
  if (!isNative()) return;
  try { await LocalNotifications.cancel({ notifications: [{ id: JOURNAL_REMINDER_ID }] }); } catch { /* noop */ }
}

export function onJournalReminderTap(onOpen) {
  if (!isNative()) return () => {};
  let handle = null;
  try {
    const p = LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      if (action?.notification?.id === JOURNAL_REMINDER_ID) onOpen?.();
    });
    Promise.resolve(p).then((h) => { handle = h; }).catch(() => {});
  } catch {
    /* listener unavailable */
  }
  return () => { try { handle?.remove?.(); } catch { /* noop */ } };
}

// ── 2. Letter ready ───────────────────────────────────────────────────────
// Two paths put the "your letter is ready" banner (id 8804) in front of the
// user, sharing one id so they never see two:
//
//   • syncLetterReminder() SCHEDULES it at the letter hour, whenever today has
//     words but no letter yet. This is the one that matters when the app is
//     closed: iOS's system scheduler delivers it even though our JS isn't
//     running, so the letter no longer depends on the app being open at the
//     hour (the letter clock can't tick in the background). Tapping it opens the
//     letter, which writes itself on arrival. The journal reminder (8801) owns
//     the no-words case; this owns the has-words case — together they close the
//     dead zone where a user who journalled then closed the app heard nothing.
//   • notifyLetterReady() fires it immediately — used the instant the letter is
//     written while the app happens to be backgrounded during a live session.
//
// Re-armed by the shell on launch, on foreground, after every capture, and on a
// letter-time change; cancelled the moment the letter exists.
let letterSyncing = false; // guards focus + visibilitychange racing cancel→schedule

export async function syncLetterReminder() {
  if (!isNative() || letterSyncing) return;
  letterSyncing = true;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: LETTER_READY_ID }] }).catch(() => {});
    // Same anti-double-banner rule as the journal reminder: the daily nudge fires
    // at this hour and tapping it reaches the letter, so don't stack a second.
    if (dailyNudgeEnabled()) return;
    // Already written → nothing to announce. No words yet → that's the journal
    // reminder's job, not this one.
    if (letterExistsToday() || !todayHasWords()) return;
    const at = letterHourToday();
    // Only schedule a FUTURE fire. If the hour already passed we're in a live
    // foreground session and the letter clock writes it directly — a banner
    // scheduled in the past would fire instantly and just read as noise.
    if (!(at instanceof Date) || isNaN(at.getTime()) || at.getTime() <= Date.now() + 30 * 1000) return;
    if (!(await ensurePermission())) return;

    await LocalNotifications.schedule({
      notifications: [{
        id: LETTER_READY_ID,
        // At SCHEDULE time the letter doesn't exist yet (it writes when tapped),
        // so this can't promise it's "ready" — it's an invitation, not an
        // assertion. The immediate notifyLetterReady() below fires only after the
        // letter is actually written, so it keeps the "is written" wording.
        title: 'Tonight’s letter',
        body: 'Your reflection for today is waiting — tap to open it.',
        schedule: { at, allowWhileIdle: true },
      }],
    });
  } catch {
    /* notifications are best-effort — never block the app */
  } finally {
    letterSyncing = false;
  }
}

export async function cancelLetterReminder() {
  if (!isNative()) return;
  try { await LocalNotifications.cancel({ notifications: [{ id: LETTER_READY_ID }] }); } catch { /* noop */ }
}

// Deliver "your letter is ready" now (a hair in the future so iOS still
// schedules it even as the app suspends). The caller decides WHEN — typically
// the instant the letter is written while the app is backgrounded.
export async function notifyLetterReady() {
  if (!isNative()) return;
  try {
    if (!(await ensurePermission())) return;
    // Cancel any hour-scheduled 8804 first (awaited) so the OS can't deliver both
    // the scheduled invitation and this "it's written" banner around the hour.
    await LocalNotifications.cancel({ notifications: [{ id: LETTER_READY_ID }] }).catch(() => {});
    await LocalNotifications.schedule({
      notifications: [{
        id: LETTER_READY_ID,
        title: 'Your letter is ready',
        body: 'Tonight’s letter is written — tap to read it.',
        schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true },
      }],
    });
  } catch {
    /* notifications are best-effort — never block the app */
  }
}

export function onLetterReadyTap(onOpen) {
  if (!isNative()) return () => {};
  let handle = null;
  try {
    const p = LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      if (action?.notification?.id === LETTER_READY_ID) onOpen?.();
    });
    Promise.resolve(p).then((h) => { handle = h; }).catch(() => {});
  } catch {
    /* listener unavailable */
  }
  return () => { try { handle?.remove?.(); } catch { /* noop */ } };
}
