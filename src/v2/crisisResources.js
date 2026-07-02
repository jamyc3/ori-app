// Ori v2 — localized, refreshable crisis resources (Phase 3). SAFETY-CRITICAL.
//
// MHACSAF (Frontiers in Digital Health, 2026) calls for jurisdiction-specific
// crisis resources, one-tap, available offline. This module provides them in
// two tiers:
//   1. A bundled, VERIFIED default (BUNDLED_RESOURCES) — works with no network,
//      which a crisis card must. Numbers verified against official sources
//      ~2026-06 (see CRISIS_DB_VERSION); each is a well-established public line.
//   2. An optional remote refresh (refreshCrisisResources): fetch the latest
//      JSON, validate it, cache it. The bundled set is always the floor, so a
//      bad/empty fetch can never blank the card. This lets ops correct a number
//      WITHOUT an app-store update — the "keep the database refreshing" path.
//
// Any country not in the DB routes to findahelpline.com, which auto-localizes
// and is professionally maintained — the safe catch-all for the long tail.
//
// ⚠️ Ops: BUNDLED_RESOURCES is a starting set for the major English-first
// markets + a few high-volume others. Treat the remote JSON at CRISIS_DB_URL as
// authoritative; verify every number on a schedule. A wrong number here is a
// safety failure — when unsure, drop the entry and let findahelpline cover it.

export const CRISIS_DB_VERSION = '2026-06-13';
export const FIND_A_HELPLINE = 'https://findahelpline.com';

// ── VOUCHING SWITCH (Option A) ──────────────────────────────────────────────
// When FALSE, the crisis card does NOT render specific country phone numbers —
// it routes everyone to findahelpline.com (professionally maintained, auto-
// localizing) plus the local emergency number. We keep the BUNDLED_RESOURCES
// data below, but we do not put our name behind any single number until a
// qualified clinician has verified each line (PHASE3_REVIEW_SCOPE A3 + the
// CRISIS_RESOURCES_OWNERSHIP cadence). This removes the highest-stakes safety
// item (a wrong-but-plausible number) without removing the safety net itself —
// the directory still gets a person in distress to a verified local line.
// Flip to TRUE only once A3 is signed off; that re-enables the localized lines
// (and the remote-refresh path that overrides them).
export const VOUCH_LOCALIZED_LINES = false;

// Always shown, in every country — the universal floor.
export const UNIVERSAL = {
  emergency: 'your local emergency number',
  directoryUrl: FIND_A_HELPLINE,
};

// ISO 3166-1 alpha-2 → { name, lines: [{ label, tel?, sms?, note?, hours? }] }
// tel/sms are bare digits for tel:/sms: hrefs; label is the human instruction.
export const BUNDLED_RESOURCES = {
  US: { name: 'United States', lines: [
    { label: 'Call or text 988', tel: '988', sms: '988', note: 'Suicide & Crisis Lifeline', hours: '24/7' },
    { label: 'Text HOME to 741741', sms: '741741', note: 'Crisis Text Line', hours: '24/7' },
  ] },
  CA: { name: 'Canada', lines: [
    { label: 'Call or text 988', tel: '988', sms: '988', note: 'Suicide Crisis Helpline', hours: '24/7' },
  ] },
  GB: { name: 'United Kingdom', lines: [
    { label: 'Call 116 123', tel: '116123', note: 'Samaritans (free)', hours: '24/7' },
    { label: 'Text SHOUT to 85258', sms: '85258', note: 'Shout', hours: '24/7' },
  ] },
  IE: { name: 'Ireland', lines: [
    { label: 'Call 116 123', tel: '116123', note: 'Samaritans (free)', hours: '24/7' },
    { label: 'Text HELLO to 50808', sms: '50808', note: 'Text About It', hours: '24/7' },
  ] },
  AU: { name: 'Australia', lines: [
    { label: 'Call 13 11 14', tel: '131114', note: 'Lifeline', hours: '24/7' },
  ] },
  NZ: { name: 'New Zealand', lines: [
    { label: 'Call or text 1737', tel: '1737', sms: '1737', note: 'Need to talk?', hours: '24/7' },
  ] },
  DE: { name: 'Germany', lines: [
    { label: 'Call 0800 111 0 111', tel: '08001110111', note: 'TelefonSeelsorge', hours: '24/7' },
    { label: 'or 116 123', tel: '116123', note: 'TelefonSeelsorge', hours: '24/7' },
  ] },
  IN: { name: 'India', lines: [
    { label: 'Call 14416', tel: '14416', note: 'Tele-MANAS (govt)', hours: '24/7' },
    { label: 'Call +91 98204 66726', tel: '+919820466726', note: 'AASRA', hours: '24/7' },
  ] },
};

// Coarse timezone → country, for when the locale region subtag is missing.
// Only common zones; anything else falls through to the directory.
const TZ_COUNTRY = {
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
  'America/Los_Angeles': 'US', 'America/Phoenix': 'US', 'America/Anchorage': 'US',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA',
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Berlin': 'DE',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Perth': 'AU',
  'Australia/Brisbane': 'AU', 'Pacific/Auckland': 'NZ',
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
};

const COUNTRY_OVERRIDE_KEY = 'ori_crisis_country';
const CACHE_KEY = 'cpi_crisis_db';
// Ops publishes the authoritative, updatable JSON here (served by the host).
export const CRISIS_DB_URL = '/crisis-resources.json';

// Best-effort country detection: explicit override → locale region → timezone.
// Never throws; null when unknown (caller still shows the universal directory).
export function detectCountry() {
  try {
    if (typeof localStorage !== 'undefined') {
      const o = localStorage.getItem(COUNTRY_OVERRIDE_KEY);
      if (o) return o.toUpperCase();
    }
  } catch { /* ignore */ }
  try {
    const locales = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
    for (const l of locales) {
      const m = /[-_]([A-Za-z]{2})(?:$|[-_])/.exec(l || '');
      if (m) return m[1].toUpperCase();
    }
  } catch { /* ignore */ }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && TZ_COUNTRY[tz]) return TZ_COUNTRY[tz];
  } catch { /* ignore */ }
  return null;
}

function isValidDb(db) {
  return !!db && typeof db === 'object' && typeof db.version === 'string'
    && db.countries && typeof db.countries === 'object';
}

// The active DB: the cached remote copy if present + valid, else the bundled
// floor. Synchronous and offline-safe.
export function loadDb() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isValidDb(parsed)) return parsed;
      }
    }
  } catch { /* ignore */ }
  return { version: CRISIS_DB_VERSION, countries: BUNDLED_RESOURCES };
}

// Best-effort remote refresh. Validates before caching; the bundled set is the
// floor, so a failed/garbage fetch never degrades the card. Never throws.
export async function refreshCrisisResources(url = CRISIS_DB_URL, fetchImpl) {
  try {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return false;
    const res = await f(url, { cache: 'no-cache' });
    if (!res || !res.ok) return false;
    const db = await res.json();
    if (!isValidDb(db)) return false;
    try { localStorage?.setItem(CACHE_KEY, JSON.stringify(db)); } catch { /* quota */ }
    return true;
  } catch {
    return false;
  }
}

// What the support card renders: the user's country entry (or null) plus the
// universal floor that is ALWAYS shown.
export function resourcesForUser(country) {
  const code = (country ?? detectCountry());
  const upper = code ? String(code).toUpperCase() : null;
  // Option A: until A3 clinical verification, never vouch for specific lines —
  // route everyone to the universal floor (emergency + findahelpline). The
  // country is still resolved (for copy/telemetry), but no numbers are rendered.
  if (!VOUCH_LOCALIZED_LINES) {
    return { country: upper, name: null, lines: [], universal: UNIVERSAL };
  }
  const db = loadDb();
  const entry = (upper && db.countries[upper]) || null;
  return { country: upper, name: entry?.name || null, lines: entry?.lines || [], universal: UNIVERSAL };
}
