/* ═══════════════════════════════════════════
   STORAGE — IndexedDB-backed store for large blobs.

   Why: localStorage caps at ~5 MB per origin, which isn't enough once a
   user imports a multi-year Apple Health export. We keep tiny settings/
   tokens in localStorage (where they always were) and move the two keys
   that actually grow — the wearable-history map and the journal repo —
   into IndexedDB, which gives us tens to hundreds of MB with no silent
   QuotaExceededError drops.

   The public API stays synchronous. At app boot, `hydrateStorage()` pulls
   the large blobs into an in-memory cache. After that, `getLarge()` /
   `setLarge()` behave like localStorage — sync reads, fire-and-forget
   writes to IDB. Migration from the old localStorage copy is automatic
   and one-way (we never delete the localStorage copy, so a downgrade
   doesn't eat data).
   ═══════════════════════════════════════════ */

const DB_NAME = "ori-storage";
const STORE = "kv";
const VERSION = 1;

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB unavailable")); return; }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Keys that live in IDB. These are the ones that grow unboundedly.
export const LARGE_KEYS = {
  OURA_HISTORY: "cpi_oura_history",
  JOURNAL_REPO: "cpi_journal_repo",
};

const cache = new Map();
let hydrated = false;

// In-flight IDB writes/deletes. setLarge() / deleteLarge() are intentionally
// fire-and-forget at their callsites, but `flushStorage()` lets callers that
// MUST see writes durably committed (notably the Restore-from-backup path)
// await the queue before they reload / migrate. Without this, the import
// flow's window.location.reload() could kill an in-flight `cpi_journal_repo`
// write and silently drop the user's journal entries on iOS, where IDB
// writes are slow enough for the race to bite.
const pendingOps = new Set();
function trackOp(promise) {
  pendingOps.add(promise);
  // Use .then for both branches so the entry is removed once either
  // settles. We don't propagate errors here — the original op handlers
  // already have their own .catch fallback.
  promise.then(
    () => pendingOps.delete(promise),
    () => pendingOps.delete(promise),
  );
  return promise;
}
export async function flushStorage() {
  if (pendingOps.size === 0) return;
  // Snapshot first — operations that fire AFTER this call won't be awaited,
  // but the typical caller (handleConfirmRestore) runs all of its writes
  // synchronously before calling flush, so the snapshot is complete.
  await Promise.allSettled(Array.from(pendingOps));
}

export async function hydrateStorage() {
  try {
    for (const key of Object.values(LARGE_KEYS)) {
      let value = null;
      try { value = await idbGet(key); } catch { /* ignore — fall through to localStorage */ }
      if (value == null) {
        // First boot after the migration: pull the old localStorage copy into IDB.
        // We keep the localStorage copy intact so a rollback still has the data.
        // MUST read through the pristine getItem — the shim is already
        // installed by now, and shimmed getItem(largeKey) routes back into
        // getLarge(), which recurses into this read until the stack blows
        // and the catch below quietly returns nothing. That swallowed the
        // entire pre-IDB localStorage migration.
        try {
          const raw = localStoragePristine.getItem.call(localStorage, key);
          if (raw) {
            value = JSON.parse(raw);
            try { await idbSet(key, value); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      }
      if (value != null) cache.set(key, value);
    }
  } finally {
    hydrated = true;
  }
}

export function isHydrated() { return hydrated; }

export function getLarge(key) {
  if (cache.has(key)) return cache.get(key);
  // Before hydration completes (or if IDB is unavailable), fall back to
  // the localStorage copy so nothing breaks on a cold load. Pristine
  // getItem, NOT the shimmed one — the shim routes large keys back here.
  try {
    const raw = localStoragePristine.getItem.call(localStorage, key);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

export function setLarge(key, value) {
  cache.set(key, value);
  // Fire-and-forget IDB write. If it fails (private mode, etc.) we fall
  // back to localStorage so the user's data at least survives the session.
  // The returned promise is tracked so `flushStorage()` can wait on it.
  trackOp(idbSet(key, value).catch(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore — quota */ }
  }));
}

export function deleteLarge(key) {
  cache.delete(key);
  trackOp(idbDelete(key).catch(() => { /* ignore */ }));
  try { localStoragePristine.removeItem.call(localStorage, key); } catch { /* ignore */ }
}

// ── Transparent shim ───────────────────────────────────────────────────
// The codebase has 15+ callsites that read/write these blobs via the raw
// localStorage API. Rather than chase every one (and risk missing one,
// which would silently write to the capped store and blow the 5 MB
// quota), we intercept localStorage.{get,set,remove}Item for just the
// large keys and route them through the IDB cache. Every other key in
// localStorage passes through untouched.
const LARGE_KEY_SET = new Set(Object.values(LARGE_KEYS));
const localStoragePristine = {
  getItem: localStorage.getItem,
  setItem: localStorage.setItem,
  removeItem: localStorage.removeItem,
};

function installLocalStorageShim() {
  localStorage.getItem = function (key) {
    if (LARGE_KEY_SET.has(key)) {
      const v = getLarge(key);
      return v == null ? null : JSON.stringify(v);
    }
    return localStoragePristine.getItem.call(this, key);
  };
  localStorage.setItem = function (key, value) {
    if (LARGE_KEY_SET.has(key)) {
      try { setLarge(key, JSON.parse(value)); } catch { /* value wasn't JSON — fall through */ }
      return;
    }
    return localStoragePristine.setItem.call(this, key, value);
  };
  localStorage.removeItem = function (key) {
    if (LARGE_KEY_SET.has(key)) { deleteLarge(key); return; }
    return localStoragePristine.removeItem.call(this, key);
  };
}

// Install the shim immediately on import. Before hydration completes the
// cache is empty and getLarge() falls back to the original localStorage,
// so a cold boot still reads whatever was there before the migration.
if (typeof localStorage !== "undefined") installLocalStorageShim();
