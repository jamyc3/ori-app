// Ori v2 — parked-decision resurface reminder (local notification).
//
// Sibling of letterNotify.js: when a decision is parked for a future "sharp
// window", iOS suspends the in-app timer, so we bridge with a one-shot LOCAL
// notification (no server, no push) fired at the soonest pending resurface time.
// Tapping it opens the app to the decisions surface. Best-effort throughout — a
// denied permission or missing plugin just means no reminder, never an error.
// Web is a no-op.

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { ensureNotifyPermission } from './notifyPermission.js';
import { nextResurfaceAt } from './decisions.js';

// Distinct stable id from the letter reminder (8801) so they never collide.
const NOTIF_ID = 8802;

function isNative() {
  try { return Boolean(Capacitor?.isNativePlatform?.()); } catch { return false; }
}

// Shared gate (notifyPermission.js): no session cache, and the one-shot OS
// dialog can only fire AFTER onboarding — never on a cold first open.
const ensurePermission = ensureNotifyPermission;

// Recompute and (re)schedule the reminder for the soonest pending parked
// decision. Call after parking, on launch, and on foreground. Clears the
// reminder when nothing is pending.
export async function syncDecisionReminder() {
  if (!isNative()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: NOTIF_ID }] }).catch(() => {});
    const at = nextResurfaceAt();
    if (!(at instanceof Date) || at.getTime() <= Date.now() + 30 * 1000) return;
    if (!(await ensurePermission())) return;
    await LocalNotifications.schedule({
      notifications: [{
        id: NOTIF_ID,
        title: 'A decision is ready',
        body: 'You parked this for a sharper hour — that window’s opening now.',
        schedule: { at, allowWhileIdle: true },
      }],
    });
  } catch {
    /* best-effort — never block the app */
  }
}

export function onDecisionReminderTap(onOpen) {
  if (!isNative()) return () => {};
  let handle = null;
  try {
    const p = LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      if (action?.notification?.id === NOTIF_ID) onOpen?.();
    });
    Promise.resolve(p).then((h) => { handle = h; }).catch(() => {});
  } catch {
    /* listener unavailable */
  }
  return () => { try { handle?.remove?.(); } catch { /* noop */ } };
}
