// Ori v2 — the ONE place that may trigger the iOS notification-permission
// dialog.
//
// Found on a real fresh install (simulator, 2026-07-01): the OS prompt fired
// the moment a brand-new user opened the app — over the FIRST onboarding
// screen, before they'd tapped anything. iOS gives exactly one system ask;
// spending it on a cold open (lowest possible opt-in moment, no letter time
// even chosen yet) wastes it. So:
//
//   • If permission is already granted → true (scheduling can proceed).
//   • If denied → false, NOT cached — a user who re-grants in iOS Settings
//     is picked up on the next sync (launch/foreground/capture).
//   • If never asked ('prompt') → only fire the dialog AFTER onboarding is
//     complete (cpi_welcome_done), i.e. after the person has chosen a letter
//     time and knows what the notification is for. Before that, stay silent.
//
// Shared by letterNotify, dailyNudge and decisionNotify so no caller can
// reintroduce a launch-time ask.

import { LocalNotifications } from '@capacitor/local-notifications';

export async function ensureNotifyPermission() {
  try {
    const chk = await LocalNotifications.checkPermissions();
    if (chk.display === 'granted') return true;
    if (chk.display === 'denied') return false;
    let onboarded = false;
    try { onboarded = Boolean(localStorage.getItem('cpi_welcome_done')); } catch { /* stay silent */ }
    if (!onboarded) return false;
    const req = await LocalNotifications.requestPermissions();
    return req.display === 'granted';
  } catch {
    return false;
  }
}
