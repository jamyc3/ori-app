// Calendar feed storage + sync orchestrator.
//
// Stored in localStorage under `cpi_calendar_feeds`. Each feed:
//   { id, label, category, method, provider, url, lastSyncAt,
//     lastSyncStatus, lastSyncError, events }
// `events` is the most recent sanitised event list from the server.
// Categories: "work" | "personal".
//
// The sync orchestrator hits /calendar/ics with the feed URL and stores
// the result. Sync is browser-driven (no background worker) — called
// when the user opens Settings, lands on the You tab, or hits Sync now.

import { signalsForDay, signalsForWindow } from "./calendar-signals.js";

export const FEEDS_KEY = "cpi_calendar_feeds";
export const MAX_FEEDS = 8; // generous cap — 4 typical + headroom

// ── Session-scope events cache ───────────────────────────────────
// Events arrays are heavy and can push localStorage past the browser
// quota when combined with Oura history + journal entries. We persist
// only the feed metadata (URL, label, category, sync status) and keep
// events in a module-level cache. On refresh the cache is empty and
// the next sync repopulates it. This makes the sync URL durable even
// when storage is tight.
const _eventsCache = new Map();

function setCachedEvents(feedId, events) {
  _eventsCache.set(feedId, Array.isArray(events) ? events : []);
}
function getCachedEvents(feedId) {
  return _eventsCache.has(feedId) ? _eventsCache.get(feedId) : null;
}
// Strip the heavyweight `events` array off a feed before persisting.
function trimForStorage(feed) {
  if (!feed || typeof feed !== "object") return feed;
  const { events: _omit, ...rest } = feed;
  return rest;
}

// ── Storage helpers ──────────────────────────────────────────────

export function loadFeeds() {
  try {
    const raw = localStorage.getItem(FEEDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// Hydrate the session cache from any events still on disk from older
// saves. Runs once at module load so the first read after refresh has
// data while the background re-sync catches up.
(function hydrateCacheFromDisk() {
  try {
    for (const f of loadFeeds()) {
      if (Array.isArray(f?.events) && f.events.length > 0) {
        setCachedEvents(f.id, f.events);
      }
    }
  } catch { /* no-op */ }
})();

// Persist the feed list. Throws on quota / private-mode errors so the
// UI can surface "your storage is full" instead of silently losing the
// URL the user just pasted. Always strips `events` — those live in the
// session cache, never on disk.
export function saveFeeds(feeds) {
  const safe = (feeds || []).map(trimForStorage);
  try {
    localStorage.setItem(FEEDS_KEY, JSON.stringify(safe));
    return feeds;
  } catch (e) {
    const isQuota = (e?.name || "").toLowerCase().includes("quota") || e?.code === 22 || e?.code === 1014;
    throw new Error(isQuota
      ? "Your browser storage is full — open Settings → clear old check-ins or Oura history to make room, then try again."
      : `Couldn't save calendar feed: ${e?.message || String(e)}`);
  }
}

// Public helper for callers that want the effective event list for a
// feed without knowing whether it lives on disk or in the cache.
export function getFeedEvents(feedId) {
  const cached = getCachedEvents(feedId);
  if (cached != null) return cached;
  const feed = loadFeeds().find((f) => f.id === feedId);
  return Array.isArray(feed?.events) ? feed.events : [];
}

export function addFeed({ label, category, url, method = "ics", provider = "unknown" }) {
  const feeds = loadFeeds();
  if (feeds.length >= MAX_FEEDS) {
    throw new Error(`Maximum ${MAX_FEEDS} calendars`);
  }
  const id = `feed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const newFeed = {
    id,
    label: label || (category === "personal" ? "Personal" : "Work"),
    category: category === "personal" ? "personal" : "work",
    method, provider, url,
    lastSyncAt: null,
    lastSyncStatus: "pending",
    lastSyncError: null,
    events: [],
  };
  saveFeeds([...feeds, newFeed]); // throws on quota; events are stripped before write
  // Defence in depth: verify the URL actually landed on disk. Private-mode
  // Safari has been seen to no-op setItem without throwing, so we re-read.
  const verified = loadFeeds().find((f) => f.id === id);
  if (!verified) {
    throw new Error("Couldn't persist the calendar feed. Your browser may be in private/incognito mode where storage doesn't survive a refresh.");
  }
  setCachedEvents(id, []);
  return newFeed;
}

export function removeFeed(id) {
  const feeds = loadFeeds().filter((f) => f.id !== id);
  saveFeeds(feeds);
  _eventsCache.delete(id);
  return feeds;
}

export function updateFeed(id, patch) {
  const feeds = loadFeeds();
  const next = feeds.map((f) => (f.id === id ? { ...f, ...patch } : f));
  // Move events off the patch into the session cache before persisting.
  // Old saves may have events on disk; the next saveFeeds will strip them.
  if (patch && Array.isArray(patch.events)) setCachedEvents(id, patch.events);
  saveFeeds(next);
  return next.find((f) => f.id === id);
}

// ── Sync ─────────────────────────────────────────────────────────
// Hits the server which fetches the .ics and returns sanitised events.

const PROXY_BASE = ""; // same-origin

export async function syncFeed(feedId) {
  const feed = loadFeeds().find((f) => f.id === feedId);
  if (!feed) throw new Error("Unknown feed");

  try {
    const res = await fetch(`${PROXY_BASE}/calendar/ics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: feed.url }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = payload?.error || `HTTP ${res.status}`;
      updateFeed(feedId, {
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: "error",
        lastSyncError: message,
        lastSyncDiagnostic: payload?.diagnostic || null,
      });
      return { ok: false, error: message, diagnostic: payload?.diagnostic || null };
    }
    // Tag every event with the feed's category so downstream signals can
    // weight work vs personal.
    const events = (payload.events || []).map((e) => ({ ...e, category: feed.category }));
    updateFeed(feedId, {
      lastSyncAt: payload.fetchedAt || new Date().toISOString(),
      lastSyncStatus: "ok",
      lastSyncError: null,
      lastSyncDiagnostic: payload?.diagnostic || null,
      events,
    });
    return { ok: true, count: events.length, diagnostic: payload?.diagnostic || null };
  } catch (e) {
    updateFeed(feedId, {
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: "error",
      lastSyncError: e.message || String(e),
    });
    return { ok: false, error: e.message || String(e) };
  }
}

export async function syncAllFeeds() {
  const feeds = loadFeeds();
  const results = [];
  for (const f of feeds) {
    const r = await syncFeed(f.id);
    results.push({ id: f.id, ...r });
  }
  return results;
}

// Auto-sync if any feed is stale (older than `staleAfterMs`) — or has no
// events in the session cache, which happens on every page reload because
// events are deliberately never persisted (quota). Without the cache check
// a fresh load would trust lastSyncAt and read zero events for an hour.
export async function syncStaleFeeds(staleAfterMs = 60 * 60 * 1000) {
  const feeds = loadFeeds();
  let synced = 0;
  for (const f of feeds) {
    const last = f.lastSyncAt ? new Date(f.lastSyncAt).getTime() : 0;
    const cacheEmpty = (getCachedEvents(f.id) || []).length === 0;
    if (Date.now() - last > staleAfterMs || cacheEmpty) {
      await syncFeed(f.id);
      synced++;
    }
  }
  if (isNativeCalendarConnected()) {
    const meta = nativeCalendarMeta();
    const last = meta?.lastSyncAt ? new Date(meta.lastSyncAt).getTime() : 0;
    if (Date.now() - last > staleAfterMs || _nativeEvents.length === 0) {
      const r = await syncNativeCalendar();
      if (r?.ok) synced++;
    }
  }
  return synced;
}

// ── Native Apple Calendar (iOS) ──────────────────────────────────
// The Capacitor calendar plugin reads device calendars directly — no ICS
// URL involved — so it lives beside the feed list, not in it. Metadata
// (connected flag, category, sync status) persists; events stay in a
// session cache like feed events and re-sync on each launch (the query
// is local and fast). The integration module is imported dynamically so
// this file stays loadable under plain Node (eval scripts).

export const NATIVE_CAL_KEY = "cpi_native_calendar";
let _nativeEvents = [];

export function nativeCalendarMeta() {
  try {
    const raw = localStorage.getItem(NATIVE_CAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveNativeCalendarMeta(meta) {
  try {
    localStorage.setItem(NATIVE_CAL_KEY, JSON.stringify(meta));
  } catch { /* quota — connection state just won't survive the reload */ }
}

export function isNativeCalendarConnected() {
  return Boolean(nativeCalendarMeta()?.connected);
}

export async function connectNativeCalendar(category = "work") {
  const apple = await import("./integrations/apple-calendar.js");
  if (!apple.isAvailable()) {
    return { ok: false, error: "Apple Calendar is only available in the iOS app." };
  }
  const perm = await apple.requestPermission();
  if (!perm.granted) {
    return { ok: false, error: "Calendar access wasn't granted. You can allow it in iOS Settings → Privacy → Calendars." };
  }
  saveNativeCalendarMeta({
    connected: true,
    category: category === "personal" ? "personal" : "work",
    connectedAt: new Date().toISOString(),
    lastSyncAt: null,
    lastSyncStatus: "pending",
    lastSyncError: null,
  });
  return syncNativeCalendar();
}

export function disconnectNativeCalendar() {
  try { localStorage.removeItem(NATIVE_CAL_KEY); } catch { /* fine */ }
  _nativeEvents = [];
}

export async function syncNativeCalendar() {
  const meta = nativeCalendarMeta();
  if (!meta?.connected) return { ok: false, error: "Not connected" };
  try {
    const apple = await import("./integrations/apple-calendar.js");
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 35);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    const events = await apple.getEvents({
      startISO: start.toISOString(),
      endISO: end.toISOString(),
    });
    _nativeEvents = (events || []).map((e) => ({ ...e, category: meta.category || "work" }));
    saveNativeCalendarMeta({
      ...meta,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: "ok",
      lastSyncError: null,
      lastEventCount: _nativeEvents.length,
    });
    return { ok: true, count: _nativeEvents.length };
  } catch (e) {
    saveNativeCalendarMeta({
      ...meta,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: "error",
      lastSyncError: e?.message || String(e),
    });
    return { ok: false, error: e?.message || String(e) };
  }
}

// ── Signal accessors ─────────────────────────────────────────────
// Convenience for callers (You tab) that want signals for today and
// the 14-day window without re-knowing where events live.

export function allEvents() {
  const feeds = loadFeeds();
  const out = [];
  for (const f of feeds) {
    const cached = getCachedEvents(f.id);
    if (cached && cached.length) out.push(...cached);
    else if (Array.isArray(f.events) && f.events.length) out.push(...f.events);
  }
  if (_nativeEvents.length) out.push(..._nativeEvents);
  return out;
}

export function signalsForToday(today = new Date()) {
  return signalsForDay(allEvents(), today);
}

export function signalsForLast14Days(today = new Date()) {
  return signalsForWindow(allEvents(), 14, today);
}

export function hasAnyFeed() {
  return loadFeeds().length > 0 || isNativeCalendarConnected();
}
