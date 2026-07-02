// Ori v2 — Screen Time signal (iOS only, inert until the native side lands).
//
// Apple walls off raw Screen Time numbers: the totals only live inside a
// sandboxed DeviceActivityReport extension that can't pass them back. The most
// we can extract is COARSE threshold events from a DeviceActivityMonitor
// extension, written to a shared App Group and surfaced by the ScreenTimeBridge
// CAPPlugin (ios/App/App/ScreenTimeBridge.swift). Full design + limits:
// docs/SCREEN_TIME_PLAN.md.
//
// This module is the JS half. It is deliberately a NO-OP everywhere today:
//   • web / non-native        → isScreenTimeAvailable() === false
//   • native, pre-entitlement → the bridge isn't registered / auth fails
//   • no data for a day        → screenLoadFor() === null  → Demands unchanged
// So it can ship dormant. Flip SCREEN_TIME_ENABLED (and wire the Demands
// contributor per the plan) only once a real device confirms the signal flows.

import { Capacitor, registerPlugin } from '@capacitor/core';

// Master gate. Stays false until the Apple Family Controls entitlement is
// approved AND a device confirms the monitor extension is writing the signal.
export const SCREEN_TIME_ENABLED = false;

// The native plugin (ios/App/App/ScreenTimeBridge.swift). registerPlugin is
// safe to call on web — methods simply reject as "unimplemented", which we
// always catch.
const ScreenTimeBridge = registerPlugin('ScreenTimeBridge');

const HISTORY_KEY = 'cpi_screen_history'; // { 'YYYY-MM-DD': { high: bool, level: 0|1|2 } }
const HIGH_THRESHOLD_MIN = 150;           // 2.5h — the evening line that fires the Inbox note

function localYmd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isNative() {
  try { return Boolean(Capacitor?.isNativePlatform?.()); } catch { return false; }
}

// Dev/testing escape hatch (mirrors AckReflect's 'ori_ack_reflect'): lets us
// exercise the full read+alert path on web by injecting cpi_screen_history,
// without the native extension. Harmless in the wild — with no injected data,
// screenHighToday() still returns false.
function devOverride() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('ori_screen_time') === '1'; }
  catch { return false; }
}

// True only when we could actually have a signal: native iOS + enabled,
// or the dev hatch is set.
export function isScreenTimeAvailable() {
  return devOverride() || (SCREEN_TIME_ENABLED && isNative());
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const m = raw ? JSON.parse(raw) : {};
    return m && typeof m === 'object' ? m : {};
  } catch { return {}; }
}

// One-time setup: the system authorization prompt + the category picker. There
// is NO in-app button — call this once from onboarding / first Demands render on
// a native build, so the only thing the user sees is the OS prompt + one picker.
// Best-effort: any failure leaves the feature simply off.
export async function ensureScreenTimeSetup() {
  if (!isScreenTimeAvailable()) return false;
  try {
    const auth = await ScreenTimeBridge.requestAuthorization();
    if (!auth?.granted) return false;
    await ScreenTimeBridge.presentPicker();   // FamilyActivityPicker — broad categories
    await ScreenTimeBridge.startMonitoring();  // schedule + threshold events
    return true;
  } catch {
    return false; // unimplemented (web) / denied / pre-entitlement — stay off
  }
}

// Pull the latest per-day coarse signals from the App Group into our local
// cache, so the Demands lookup can read them synchronously like every other
// contributor. Call on launch / focus (alongside the wearable + calendar syncs).
export async function syncScreenSignal() {
  if (!isScreenTimeAvailable()) return;
  try {
    const res = await ScreenTimeBridge.getDailySignal(); // { days: [{date, level, eveningHeavy}] }
    const days = Array.isArray(res?.days) ? res.days : [];
    if (!days.length) return;
    const map = loadHistory();
    for (const d of days) {
      if (typeof d?.date !== 'string') continue;
      map[d.date] = { high: Boolean(d.high), level: Math.max(0, Math.min(2, Math.round(d.level ?? 0))) };
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(map));
  } catch {
    /* best-effort — never block the app on Screen Time */
  }
}

// Did TODAY's evening phone use cross the 2.5-hour line? Drives the once-a-day
// Inbox note. False everywhere until the entitlement + native signal land.
export function screenHighToday() {
  if (!isScreenTimeAvailable()) return false;
  return loadHistory()[localYmd()]?.high === true;
}

// Today's local day key — the Inbox passes this through so the alert id is
// date-scoped (fires at most once per day).
export function screenAlertDay() {
  return localYmd();
}

// Optional Demands contributor (documented but not wired): a coarse 0..1 from
// the high flag. Returns null when there's no signal so Demands is unchanged.
// OBSERVED layer — never minutes, never shown as a number (docs/SCREEN_TIME_PLAN.md).
export function screenLoadFor(dateKey) {
  if (!isScreenTimeAvailable()) return null;
  const entry = loadHistory()[dateKey];
  if (!entry) return null;
  return entry.high ? 1 : null;
}
