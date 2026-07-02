// Ori v2 — remote killswitches, synced once per boot.
//
// The server's /proxy/config carries operator-controlled DISABLE flags (env
// vars on the VPS, e.g. ORI_KILL_REFLECT=1). This module mirrors them into
// localStorage so gates like reflectEnabled() can consult them synchronously.
//
// Fail-safe direction, by design:
//   • flags can only turn features OFF — a missing/failed fetch changes nothing,
//     and no remote value can enable a feature the shipped build keeps dark
//     (the ACK_REFLECT_ENABLED literal + its build tripwire stay authoritative).
//   • the mirror persists across launches, so a kill issued while the user was
//     online still holds when they next open the app offline.

export const KILL_REFLECT_KEY = 'ori_remote_kill_reflect';
export const VOICE_NOTICE_KEY = 'ori_remote_voice_notice';

export async function syncRemoteConfig() {
  try {
    const res = await fetch('/proxy/config', { cache: 'no-store' });
    if (!res.ok) return;
    const cfg = await res.json();
    if (cfg?.kill?.reflect) {
      localStorage.setItem(KILL_REFLECT_KEY, '1');
    } else {
      localStorage.removeItem(KILL_REFLECT_KEY);
    }
    // Service notice: voice/STT dependency is down. Same mirror pattern —
    // the flag can only SHOW an honesty banner, never enable a feature.
    if (cfg?.notice?.voice) {
      localStorage.setItem(VOICE_NOTICE_KEY, '1');
    } else {
      localStorage.removeItem(VOICE_NOTICE_KEY);
    }
  } catch {
    /* offline or proxy unreachable — keep the last mirrored state */
  }
}

// Synchronous read for gates. True ONLY when the operator has killed the flow.
export function reflectKilled() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(KILL_REFLECT_KEY) === '1'; }
  catch { return false; }
}

// Synchronous read for the voice-outage banner.
export function voiceNoticeActive() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(VOICE_NOTICE_KEY) === '1'; }
  catch { return false; }
}
