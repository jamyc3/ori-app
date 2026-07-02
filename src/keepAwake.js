// Ori — keep the screen awake while a voice transcription session is live.
//
// THE PROBLEM (user-reported): the phone auto-locks after the user's Auto-Lock
// interval, and when it does, iOS kills the mic mid-dictation — the session just
// dies under them. (integrations/deepgram.js carries a self-heal watchdog for
// exactly this; that's recovery. This module is prevention.)
//
// THE FIX: while a session is active we suppress ONLY the auto-lock idle timer,
// and lift it the instant listening stops. We never override a manual lock (side
// button) or the user's settings, and we never run in the background.
//   • iOS (Capacitor) → UIApplication.isIdleTimerDisabled, via the native
//     IdleTimerBridge plugin (ios/App/App/IdleTimerBridge.swift). No entitlement.
//   • Web → the Screen Wake Lock API (navigator.wakeLock).
//
// SELF-HEALING: the OS releases both mechanisms when the app backgrounds (iOS
// resets isIdleTimerDisabled; the web wake-lock sentinel auto-releases on tab
// hide). So we re-apply our desired state whenever the app/tab returns to the
// foreground, as long as something still holds it awake.
//
// REF-COUNTED: acquire/release is balanced and counted, so overlapping voice
// hooks (or a quick stop/start) never strand the screen awake or release it
// early. release() only truly lifts the lock when the last holder lets go.

import { Capacitor, registerPlugin } from "@capacitor/core";

const IdleTimerBridge = registerPlugin("IdleTimerBridge");

const isIOS = () => { try { return Capacitor?.getPlatform?.() === "ios"; } catch { return false; } };
const hasWakeLock = () => typeof navigator !== "undefined" && "wakeLock" in navigator;

let holders = 0;          // ref count of active sessions wanting the screen awake
let wakeSentinel = null;  // web Screen Wake Lock sentinel, when held
let bound = false;        // foreground re-acquire listeners installed once

async function applyWeb(on) {
  if (!hasWakeLock()) return;
  try {
    if (on) {
      if (!wakeSentinel) {
        wakeSentinel = await navigator.wakeLock.request("screen");
        // The OS can release the sentinel (e.g. tab hidden); drop our ref so the
        // foreground re-acquire re-requests it cleanly.
        wakeSentinel.addEventListener?.("release", () => { wakeSentinel = null; });
      }
    } else if (wakeSentinel) {
      const s = wakeSentinel;
      wakeSentinel = null;
      try { await s.release(); } catch { /* noop */ }
    }
  } catch { /* a wake lock is best-effort — never throw into the voice path */ }
}

function applyNative(on) {
  try { IdleTimerBridge.setEnabled({ enabled: on }); } catch { /* noop */ }
}

function apply() {
  const on = holders > 0;
  if (isIOS()) applyNative(on);
  else applyWeb(on);
}

// Re-apply on return to foreground — the OS drops both mechanisms on background.
function bindReacquire() {
  if (bound || typeof document === "undefined") return;
  bound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // The OS has already released the wake lock; forget our (now-stale) ref so
      // the foreground re-acquire re-requests instead of seeing it as still held.
      // Robust even if the sentinel's "release" event never fired.
      wakeSentinel = null;
      return;
    }
    if (holders > 0) apply();
  });
  // visibilitychange is unreliable inside a WKWebView; the native appState event
  // is the dependable foreground signal on iOS.
  import("@capacitor/app")
    .then(({ App }) => App.addListener("appStateChange", ({ isActive }) => { if (isActive && holders > 0) apply(); }))
    .catch(() => { /* web — visibilitychange covers it */ });
}

// Take a hold on "screen stays awake." Balanced by allowScreenSleep().
export function keepScreenAwake() {
  holders += 1;
  bindReacquire();
  if (holders === 1) apply();
}

// Release one hold. The screen is only allowed to sleep again once every holder
// has released.
export function allowScreenSleep() {
  if (holders === 0) return;
  holders -= 1;
  if (holders === 0) apply();
}
