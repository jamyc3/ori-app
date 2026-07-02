// Ori v2 — on-device storage pressure check.
//
// Everything the user writes lives on-device (localStorage + IndexedDB), and
// browsers fail writes SILENTLY once the origin's quota is exhausted — the
// try/catch guards around setItem mean the app keeps running but new words
// stop landing. This module gives the UI one honest, cheap signal: "you are
// close to full, export soon", surfaced quietly in Settings — never a scare
// banner, and nothing at all while space is fine (show-nothing > filler).
//
// navigator.storage.estimate() is supported by WKWebView (iOS 17+) and every
// modern browser; where it's missing we return null and show nothing.

const HIGH_WATER = 0.85; // warn above 85% of the origin quota

export async function checkStoragePressure() {
  try {
    if (!navigator?.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    if (!quota || !Number.isFinite(usage)) return null;
    return { usage, quota, high: usage / quota > HIGH_WATER };
  } catch {
    return null;
  }
}
