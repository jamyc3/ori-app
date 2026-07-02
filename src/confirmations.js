/* ─────────────────────────────────────────────────────────────────
   confirmations — localStorage wrapper for user-in-the-loop part
   confirmations. Lives in its own module so parts-stats.js stays
   storage-agnostic and testable from a plain node script.

   Schema (single key, JSON-encoded object):
     {
       gentle:  { state: "confirmed", at: "2026-04-28T..." },
       witness: { state: "dismissed", at: "...", askAgainAfter: "..." }
     }

   API:
     loadConfirmations()           → object
     saveConfirmation(id, state)   → updates one entry, returns full object
     clearConfirmation(id)         → removes one entry, returns full object

   The "dismissed" cooldown duration is a constant in parts-stats.js so
   the gate logic and the storage layer agree on when to ask again.
   ───────────────────────────────────────────────────────────────── */

import { CONFIRMATION_COOLDOWN_DAYS } from "./parts-stats.js";

const STORAGE_KEY = "cpi_part_confirmations";

export function loadConfirmations() {
  try {
    const raw = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveConfirmation(partId, state) {
  if (!partId) return loadConfirmations();
  const all = loadConfirmations();
  const now = new Date();
  const nowISO = now.toISOString();

  if (state === "confirmed") {
    all[partId] = { state: "confirmed", at: nowISO };
  } else if (state === "dismissed") {
    const cooldownMs = CONFIRMATION_COOLDOWN_DAYS * 86400000;
    const askAgainAfter = new Date(now.getTime() + cooldownMs).toISOString();
    all[partId] = { state: "dismissed", at: nowISO, askAgainAfter };
  } else {
    delete all[partId];
  }

  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    }
  } catch { /* quota or private mode — silent */ }

  return all;
}

export function clearConfirmation(partId) {
  return saveConfirmation(partId, null);
}
