# Ori — the journal that writes back

*Body and mind, read back to you each night.*

Ori is a cognitive-health journal. You speak or write your day; Ori reads your
words — and, if you connect them, your body's night (Oura Ring, Apple Health,
your calendar) — and writes you one honest letter each evening. Reflection,
not treatment: Ori never makes a clinical or medical claim.

- **App Store (iOS):** https://apps.apple.com/app/id6774742321
- **Website:** https://orijournal.app

## Why the client is open

Ori's promise is *free, private, for everyone*: your journal lives on your
device, there is no account, no ads, no data sale. The only way you can truly
verify a privacy promise is to read the code — so here is the code. This
repository is the complete client application: every screen, the analysis
engine, the letter prompts, and the honesty auditor that gates every build.

## What's in here

- `src/` — the full app: journal, voice capture, the three rings (Reserves /
  Demands / Form), Patterns, the nightly Letter, onboarding, crisis support,
  Bengali/English i18n.
- `src/engine.js` and friends — the local analysis engine (keyword signals,
  chronotype/circadian modulation, parts recurrence with Wilson 95% CIs).
- `src/v2/letterEngine.js` — how the letter is composed, including the exact
  prompts sent to the language model.
- `scripts/audit-honesty.mjs` — the build-time honesty auditor. Every number
  the app shows maps to a labeled evidence layer:

  | Layer | Example | Contract |
  |---|---|---|
  | L1 measured | Oura sleep, HRV | published sensor validation |
  | L2 validated self-report | WHO-5 check-in | published instrument |
  | L3 observed recurrence | pattern parts | counting math with disclosed CI |
  | L4 interpretation | the Letter | explicitly labeled as interpretation |

  `npm run build` fails if a visible claim loses its proof.
- `scripts/eval-*.mjs` — the behavioral eval suites (crisis gating, letter
  honesty, acknowledgment tone, entry dating) that also run on every build.

## What's not in here

The production server (API proxy, ephemeral voice-key minting, feedback
inbox) and the iOS wrapper project with its signing configuration. The client
talks to the backend only through a small `/proxy/*` surface you can read in
`vite.config.js` and `src/`.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # honesty audit + eval suites + vite build
```

The app runs fully word-only with no keys: journaling, rings, and patterns
work out of the box. Voice dictation and letter generation call external
APIs — copy `.env.example` to `.env.local` and add your own keys for local
development (`npm run dev` injects them server-side via the Vite proxy; they
never enter the browser bundle). Try `http://localhost:5173/?sim=1` to seed a
simulated persona's history and see the full experience without weeks of data.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md) — read it, run it, learn from it,
change it, use it personally; commercial use isn't licensed. This keeps the
app verifiable by anyone while keeping "free for everyone" sustainable.

## Crisis resources

Ori is not a crisis service. If you're struggling, the app's built-in
directory (`public/crisis-resources.json`) lists free, neutral resources —
in the US, call or text **988**.
