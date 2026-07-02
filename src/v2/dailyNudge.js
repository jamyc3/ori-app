// Ori v2 — daily "show up" nudge (native local notification).
//
// A gentle once-a-day reminder to open Ori at the hour the user already chose
// (the same letter/daily time, Sunrise + overrides resolved by letterHourToday),
// worded for whichever mode they're in — Full (a check-in on their day) or
// Reflect (a moment with a part). Unlike the letter reminder (a one-shot tied to
// "words today, no letter yet"), this is a REPEATING daily schedule so it still
// arrives when the app has been closed for days — which is the whole point of a
// come-back nudge.
//
// No server, no push: Capacitor's LocalNotifications schedules it on-device.
// Off by default; the user turns it on in Settings → Your day. Best-effort
// throughout — a denied permission or missing plugin just means no nudge, never
// an error. Web is a no-op (the plugin is native).

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { ensureNotifyPermission } from './notifyPermission.js';
import { letterHourToday } from './letterEngine.js';
import { MODE_KEY } from '../engine.js';

// Distinct from the letter (8801) and decision (8802) reminders.
const NOTIF_ID = 8803;
const ENABLED_KEY = 'cpi_daily_nudge_enabled';

function isNative() {
  try { return Boolean(Capacitor?.isNativePlatform?.()); } catch { return false; }
}

export function dailyNudgeEnabled() {
  try { return localStorage.getItem(ENABLED_KEY) === '1'; } catch { return false; }
}

export function setDailyNudgeEnabled(on) {
  try { localStorage.setItem(ENABLED_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}

// Mode-aware copy — plain language only, no instrument names or methodology.
function nudgeCopy() {
  let mode = 'full';
  try { mode = localStorage.getItem(MODE_KEY) || 'full'; } catch { /* default */ }
  if (mode === 'reflect') {
    return {
      title: 'A moment to reflect',
      body: "Sit with a part for a minute — Ori's here when you want to.",
    };
  }
  return {
    title: 'A moment with Ori',
    body: "A minute on your day keeps the picture honest. Ori's ready when you are.",
  };
}

// Shared gate (notifyPermission.js): no session cache, and the one-shot OS
// dialog can only fire AFTER onboarding — never on a cold first open.
const ensurePermission = ensureNotifyPermission;

// (Re)schedule or clear the daily nudge. Call on launch, on foreground, and
// whenever the toggle / mode / time changes — it always cancels the prior
// schedule first, so the copy and hour stay current.
export async function syncDailyNudge() {
  if (!isNative()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: NOTIF_ID }] }).catch(() => {});
    if (!dailyNudgeEnabled()) return;

    const at = letterHourToday();
    if (!(at instanceof Date) || isNaN(at.getTime())) return;
    const hour = at.getHours();
    const minute = at.getMinutes();

    if (!(await ensurePermission())) return;

    const { title, body } = nudgeCopy();
    await LocalNotifications.schedule({
      notifications: [{
        id: NOTIF_ID,
        title,
        body,
        // Repeats daily at the user's hour — fires even after the app has been
        // closed for days (a one-shot wouldn't, and a come-back nudge must).
        schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
      }],
    });
  } catch {
    /* notifications are best-effort — never block the app */
  }
}

// Register a tap handler. `onOpen` is called when the user taps the nudge.
// Returns an unsubscribe function (or a no-op on web).
export function onDailyNudgeTap(onOpen) {
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
