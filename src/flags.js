// Feature-flag registry.
//
// One JSON blob in localStorage at "cpi:flags". Tiny API on top: isFlagOn,
// setFlag, getAllFlags. Two reasons this exists:
//
//   1. Future shadow-mode work (adaptive-depth LLM tiering, joined
//      classifier) needs to run new and old code paths in parallel and
//      compare diffs. Flipping each by name from a console is faster than
//      adding a new one-off localStorage key every time.
//   2. The existing one-off pattern (`cpi:analyze-v5` read directly via
//      localStorage.getItem) is fine for one flag but doesn't scale. New
//      flags should go through this registry. The existing key stays as-is.
//
// Defaults are baked into each call site — isFlagOn(name, defaultValue) —
// so a missing flag is never an exception, and the default ships with the
// feature that uses it.
//
// Flip a flag from the browser console:
//   await import("/src/flags.js").then(m => m.setFlag("adaptive-depth", true))

const KEY = "cpi:flags";

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(obj) {
  try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch { /* quota / private mode */ }
}

export function isFlagOn(name, defaultValue = false) {
  const all = readAll();
  return Object.prototype.hasOwnProperty.call(all, name) ? !!all[name] : !!defaultValue;
}

export function setFlag(name, value) {
  const all = readAll();
  all[name] = !!value;
  writeAll(all);
}

export function getAllFlags() {
  return readAll();
}

// Schema version stamped onto every new history entry so future
// migrations can route by version instead of guessing. v1 = entries
// written before this stamp existed; v2 = entries written after.
export const ANALYSIS_VERSION = 2;
