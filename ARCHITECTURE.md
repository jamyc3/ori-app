# Architecture — Ori (Cognitive Realization)

> **⚠️ Stale — see [`../ARCHITECTURE.md`](../ARCHITECTURE.md) for the canonical, current architecture.**
> This file documents the early single-file `CPI.jsx` prototype and predates the v2 skin,
> the Today/Letter/Parts surfaces, the WHO-5 instrument, and the three-theme design system.
> It's kept for the storage-shim, server-proxy, and gateway notes below, which are still accurate.

Last updated: 2026-04-21

Ori is a personal-wellness PWA that fuses journaling with wearable biometrics and surfaces AI-generated analysis. It runs as a single-user web app — no accounts, no server-side database, everything local to the user's device.

---

## Stack at a glance

| Layer | What it is |
| ----- | ---------- |
| Frontend | React 19 + Vite 8 SPA, one big file (`src/CPI.jsx`, ~6,500 LOC) plus a tiny storage helper |
| Server | Node 20 + Express on a Hetzner VPS — a thin proxy for third-party APIs |
| Storage | `localStorage` for tokens & settings, IndexedDB for large blobs (wearable history, journal repo) |
| AI | Claude Sonnet 4.6 for text/biometric intelligence, OpenAI gpt-4o-mini as fallback |
| Voice | Deepgram Nova 3 — prerecorded via server proxy, live via direct browser WebSocket |
| Wearable | Oura Ring API v2 (Personal Access Token), Apple Health ZIP import (parsed in browser) |
| Hosting | `talk-to-me.ideaflow.page`, behind the ideaflow.page gateway |
| PWA | Service worker for install + offline shell; never caches API traffic |

---

## Frontend

### Files

```
website/
├── src/
│   ├── CPI.jsx          # The entire app. Everything from biometrics parsing
│   │                    # to the UI lives here right now.
│   ├── storage.js       # IndexedDB wrapper + transparent localStorage shim.
│   └── main.jsx         # React root.
├── public/
│   ├── sw.js            # Service worker: caches the app shell, skips API calls.
│   ├── manifest.webmanifest
│   └── icon.svg, icon-{192,512}.png, apple-touch-icon.png
├── vite.config.js       # Dev proxy config (/proxy/* → real APIs).
├── server.js            # Production Express server (see next section).
└── .env.local           # Local dev keys. Mirrors the VPS .env.
```

### The monolith

`CPI.jsx` holds everything: the journal composer, the voice hook, the Oura client, the Apple Health parser, the biometrics engine, the dashboard, and the Integrations panel. It's intentionally one file for now — easier to ship, easier to move around — but it's grown past the point where splitting out a few domain modules (voice, biometrics, storage, integrations) would help.

### PWA / service worker

`public/sw.js` caches only the app shell (`/`, `/index.html`, `/icon.svg`, `/manifest.webmanifest`). API hosts (anthropic.com, openai.com, deepgram.com, and anything under `/oura`) are explicitly skipped so stale AI responses never get served. Cache key is versioned (`ori-shell-v4`) — bump to invalidate on deploys that touch the shell.

---

## Server (`server.js` on the VPS)

A deliberately minimal Express app whose only job is to hold the API keys and proxy requests.

| Route | Method | Purpose | Auth |
| ----- | ------ | ------- | ---- |
| `/proxy/anthropic` | POST | Claude Messages API | Server-side `ANTHROPIC_API_KEY` |
| `/proxy/openai` | POST | OpenAI Chat Completions | Server-side `OPENAI_API_KEY` |
| `/proxy/deepgram` | POST (raw audio) | Deepgram prerecorded transcription | Server-side `DEEPGRAM_API_KEY` |
| `/oura/*` | GET | Oura API v2 passthrough | Browser-provided PAT via `X-Oura-Auth` |
| `/*` | GET | Static `dist/` + SPA fallback | — |

The server intentionally has no database, no auth, no logging, no user model — it's just a key-holder. All app state lives in the user's browser.

### Deployment

Managed by `cortex-runports` (the Hetzner/Ideaflow platform's process manager) on port 3004, fronted by the `ideaflow.page` gateway. Secrets live in `/root/workspace/talk-to-me/.env` and are read via Node's `--env-file` flag. Deploy recipe: [`.claude/commands/deploy.md`](.claude/commands/deploy.md).

### Gateway quirks worth knowing

The `ideaflow.page` gateway sits between the public URL and the Express server. It has three documented behaviours that have caused real bugs:

1. **`/api/*` is blocked.** All proxy routes are named `/proxy/*`.
2. **The `Authorization` header is stripped.** For routes that need a browser-supplied Bearer token (Oura), we use `X-Oura-Auth` and rebuild the header server-side.
3. **POST at root is blocked.** All POST endpoints sit under `/proxy/*`.

When something "works locally but not in prod", check the gateway first — not the frontend.

---

## Storage

Two stores, split by how the data grows.

### localStorage (~5 MB quota, capped)

Used for anything tiny and bounded. Survives page reloads but can be cleared by the user or (on iOS) by OS-level eviction after 7 days of inactivity.

Keys include: API access tokens (`cpi_oura_access_token`), user settings (`cpi_chrono`, `cpi_lifestyle`), check-ins, cached Claude output (`cpi_lore`, `cpi_insights`), and small status flags.

### IndexedDB (tens to hundreds of MB, the "big store")

Added 2026-04-21. Holds the two blobs that grow unboundedly:

- `cpi_oura_history` — the merged wearable data map (Oura + Apple Health), keyed by date. Can be multiple MB after an "All" Apple Health import.
- `cpi_journal_repo` — journal entries. Grows with every entry.

### The shim

`src/storage.js` installs a transparent shim over `localStorage.{getItem, setItem, removeItem}` so that all 15+ existing callsites reading/writing the two large keys route through IDB instead — no rewrites to CPI.jsx were needed. Flow:

1. App mount calls `hydrateStorage()`, which pulls the two large blobs from IDB into an in-memory cache. If IDB is empty but localStorage has data, it migrates the data across once (the localStorage copy is left as a rollback backup).
2. Subsequent `localStorage.getItem(cpi_oura_history)` reads hit the cache synchronously (same shape as before).
3. Writes go to the cache and fire-and-forget to IDB. If IDB is unavailable (Private mode), they fall back to localStorage with a quota catch.

This keeps every other file in the codebase ignorant of the change.

---

## External services

| Service | How we talk to it | Auth path |
| ------- | ---------------- | --------- |
| Anthropic (Claude Sonnet 4.6) | Browser → `/proxy/anthropic` → Anthropic | Server-side key |
| OpenAI (fallback) | Browser → `/proxy/openai` → OpenAI | Server-side key |
| Deepgram (prerecorded) | Browser → `/proxy/deepgram` → Deepgram | Server-side key |
| Deepgram (live voice) | Browser → `wss://api.deepgram.com/v1/listen` directly | `VITE_DEEPGRAM_API_KEY` shipped in bundle — WebSockets can't be proxied through the gateway, so this key's blast radius is higher. Rotate independently. |
| Oura Ring | Browser → `/oura/*` → Oura API v2 | User's PAT, forwarded via `X-Oura-Auth` |
| Apple Health | User exports ZIP on iPhone, drops into Integrations panel | Parsed entirely in browser via JSZip; never uploaded |

---

## Data flow — daily user path

```
  USER                                                  ORI
  ────                                                  ───
  Morning voice note ───────── mic ──────── wss direct → Deepgram  ──► text
                                                              │
                                                              ▼
  Context: last night's Oura/AH biometrics                CPI.jsx
  (already in IDB from overnight sync) ──────────────► composes prompt
                                                              │
                                                              ▼
                               POST /proxy/anthropic ──► Claude Sonnet 4.6
                                                              │
                                                              ▼
                                                     analysis + lore + signal
                                                              │
                                                              ▼
                                                   persisted to local storage
                                                     (IDB for the big stuff,
                                                      localStorage for small)
```

Overnight / 15-min refresh: a silent sync pulls `/oura/*` and merges new days into the history blob without the user doing anything.

---

## Build & deploy

### Dev

```
cd website
npm install      # first time only
npx vite         # http://localhost:5173 — Vite dev server with hot reload
```

The dev server proxies `/proxy/*` and `/oura/*` to the real third-party APIs, injecting the keys server-side from `.env.local` so nothing sensitive is in the browser bundle during dev.

### Prod

See [`.claude/commands/deploy.md`](.claude/commands/deploy.md) for the full deploy recipe. The short version:

1. `npx vite build` → `dist/`
2. rsync `dist/` to VPS (with `--delete` to prune stale assets)
3. rsync `server.js` + `package.json` (never `.env`)
4. `cortex-runports stop/start` on port 3004
5. curl the site + each proxy endpoint to verify

---

## Known gaps / design limits

These are deliberate for a prototype, but worth having eyes-open on:

- **No multi-device sync.** One browser = one dataset. Clearing browser data wipes everything.
- **No cloud backup.** Device loss = data loss.
- **No auth / no multi-user.** One account per browser profile.
- **iOS PWA 7-day eviction risk.** IndexedDB is less aggressively evicted than localStorage, but Apple still reserves the right to clear it. Users who go dormant for weeks may come back to a blank slate.
- **Live-voice Deepgram key ships in the browser.** WebSockets can't be proxied through the gateway, so `VITE_DEEPGRAM_API_KEY` is in the bundle. Rotate on a separate cadence from the server-side keys.
- **The single big `CPI.jsx` file is a refactor deferred.** Splitting into `voice.js`, `biometrics.js`, `storage.js` (already done), `integrations.jsx`, `dashboard.jsx` would help once anyone besides Jamee touches the code.

### When these become urgent

- **20+ active users** → build a real backend (Postgres on the VPS + a minimal auth flow). Handles sync, backup, multi-device, and account deletion in one go. Estimated 1–2 weeks of work.
- **Any health/employer customer conversation** → HIPAA-adjacent compliance becomes a real scope item. Consult before agreeing to anything.

---

## Repo layout

```
Cognitive realization/
└── website/                   # THE actual app — work here
    ├── src/
    │   ├── CPI.jsx              # Everything user-facing
    │   ├── storage.js           # IDB + localStorage shim
    │   └── main.jsx             # React root
    ├── public/                  # Service worker, manifest, icons
    ├── server.js                # Production Express proxy
    ├── vite.config.js           # Dev server + proxies
    ├── package.json
    ├── .env.local               # Dev keys (mirrors VPS .env)
    ├── .env.local.example       # Template for onboarding
    ├── ARCHITECTURE.md          # This file
    ├── README.md
    ├── UCD_MODEL_SPEC.md
    └── .claude/commands/
        └── deploy.md            # /deploy — full recipe + gateway notes
```
