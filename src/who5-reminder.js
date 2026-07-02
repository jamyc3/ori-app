// WHO-5 daily reminder — opt-in notification that fires at a user-
// chosen hour if today's WHO-5 hasn't been logged yet.
//
// PWA reality: we cannot push to a closed browser without server
// infrastructure (VAPID + push service + backend). What we can do:
// when the app loads or is open at the reminder hour, fire a local
// notification via the service worker. That covers users who keep
// the PWA installed and open it at least once a day past their
// reminder hour. Anything stronger (background push to a closed
// app) needs server work and is out of scope for PR #2.
//
// Storage:
//   cpi_who5_reminder            { hour: 0–23, enabled: bool }
//   cpi_who5_reminder_fired      "YYYY-MM-DD" — last day we fired
//                                a notification (one per day max)
//   cpi_who5_reminder_dismissed  "YYYY-MM-DD" — set when user
//                                dismisses the in-app prompt for today

import { todayWho5 } from "./who5.js";

const KEY        = "cpi_who5_reminder";
const FIRED_KEY  = "cpi_who5_reminder_fired";
const DISMISS_KEY = "cpi_who5_reminder_dismissed";

const DEFAULT_HOUR = 20;   // 8pm — matches Bech 2003 daily-diary convention

function ymdLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function loadReminder() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { hour: DEFAULT_HOUR, enabled: false };
    const parsed = JSON.parse(raw);
    return {
      hour: typeof parsed?.hour === "number" && parsed.hour >= 0 && parsed.hour <= 23 ? parsed.hour : DEFAULT_HOUR,
      enabled: !!parsed?.enabled,
    };
  } catch { return { hour: DEFAULT_HOUR, enabled: false }; }
}

export function saveReminder(next) {
  const cur = loadReminder();
  const merged = { ...cur, ...next };
  try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* ignore */ }
  return merged;
}

export function notificationPermission() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission() {
  if (typeof Notification === "undefined") return "unsupported";
  try {
    const p = await Notification.requestPermission();
    return p;
  } catch { return "denied"; }
}

function firedToday() {
  try { return localStorage.getItem(FIRED_KEY) === ymdLocal(); } catch { return false; }
}
function markFiredToday() {
  try { localStorage.setItem(FIRED_KEY, ymdLocal()); } catch { /* ignore */ }
}

export function dismissReminderToday() {
  try { localStorage.setItem(DISMISS_KEY, ymdLocal()); } catch { /* ignore */ }
}
export function dismissedToday() {
  try { return localStorage.getItem(DISMISS_KEY) === ymdLocal(); } catch { return false; }
}

// True if all conditions hold:
//   · reminder is enabled
//   · current local hour ≥ configured reminder hour
//   · today's WHO-5 has not been logged
//   · user hasn't dismissed for today
export function shouldRemindNow(now = new Date()) {
  const cfg = loadReminder();
  if (!cfg.enabled) return false;
  if (now.getHours() < cfg.hour) return false;
  if (todayWho5(now)) return false;
  if (dismissedToday()) return false;
  return true;
}

// Fires a local notification if shouldRemindNow + permission granted
// + we haven't already fired today. Resolves to true if we actually
// showed the notification, false otherwise. Safe to call on every
// app load / focus / visibility-change.
export async function maybeFireReminder({ now = new Date() } = {}) {
  if (!shouldRemindNow(now)) return false;
  if (firedToday()) return false;
  if (notificationPermission() !== "granted") return false;
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return false;

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg || typeof reg.showNotification !== "function") return false;
    await reg.showNotification("Five quick ones · 30 sec", {
      body: "Daily check-in time — tap when you're back.",
      tag: "ori-who5-daily",
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { route: "who5" },
      renotify: false,
      requireInteraction: false,
    });
    markFiredToday();
    return true;
  } catch { return false; }
}

export { DEFAULT_HOUR as WHO5_DEFAULT_REMINDER_HOUR };
