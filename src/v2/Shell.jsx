// Ori v2 — app shell.
//
// Header (brand + Inbox icon), content slot, bottom 4-tab nav
// (Today · Journal · Patterns · Settings). Tabs swap the content slot;
// detail screens (Letter, Part, Ring, Day, Inbox, Capture flow, Settings
// sub-screens) render as overlays above the active tab.
//
// Navigation is history-backed: opening a view from the base pushes one
// browser-history entry, in-flow transitions (listen → check-in → handoff)
// swap state at the same depth, and every back affordance — the on-screen
// back rows, the browser button, iOS edge-swipe — pops that entry. The
// popstate handler closes the topmost open view.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './styles/tokens.css';
import './styles/shell.css';
import Today from './Today.jsx';
import Letter from './Letter.jsx';
import Parts from './Parts.jsx';
import PartDetail from './PartDetail.jsx';
import ReflectPage from './ReflectPage.jsx';
import { PARTS_LIB } from '../LetterReading.jsx';
import Journal from './Journal.jsx';
import Patterns from './Patterns.jsx';
import Settings from './Settings.jsx';
import Onboarding from './Onboarding.jsx';
import Capture from './Capture.jsx';
import Handoff from './Handoff.jsx';
import Listen from './Listen.jsx';
import Inbox from './Inbox.jsx';
import Decisions from './Decisions.jsx';
import { syncDecisionReminder, onDecisionReminderTap } from './decisionNotify.js';
import Day from './Day.jsx';
import HonestyLayers from './HonestyLayers.jsx';
import HowItWorks from './HowItWorks.jsx';
import FeatureTour, { tourSteps } from './FeatureTour.jsx';
import RingDetail from './RingDetail.jsx';
import PatternDetail from './PatternDetail.jsx';
import CheckIn from './CheckIn.jsx';
import Sources from './Sources.jsx';
import Privacy from './Privacy.jsx';
import ImportJournal from './ImportJournal.jsx';
import ImportPromo, { shouldShowImportPromo } from './ImportPromo.jsx';
import Backfill, { pendingBackfillDays } from './Backfill.jsx';
import { todayWho5 } from '../who5.js';
import { letterDueNow, writeTodaysLetter } from './letterEngine.js';
import { syncJournalReminder, cancelJournalReminder, onJournalReminderTap, notifyLetterReady, onLetterReadyTap, syncLetterReminder, cancelLetterReminder } from './letterNotify.js';
import { syncDailyNudge, onDailyNudgeTap } from './dailyNudge.js';
import { handleOuraCallbackHash, initialOuraSync, installNativeOAuthListener } from './ouraConnect.js';
// Last import so the glass widget treatment layers over each surface's card rule.
import './styles/glass.css';
import { syncAppleHealthIfDue } from './appleHealth.js';
import { syncRemoteConfig, voiceNoticeActive } from './remoteConfig.js';
import { usePullToRefresh } from './usePullToRefresh.js';

const TABS = [
  { id: 'today', label: 'Today', Component: Today },
  { id: 'journal', label: 'Journal', Component: Journal },
  { id: 'patterns', label: 'Patterns', Component: Patterns },
  { id: 'settings', label: 'Settings', Component: Settings },
];

function IconHome() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}
function IconBook() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z" />
      <path d="M4 16a4 4 0 0 1 4-4h12" />
    </svg>
  );
}
function IconWave() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0" />
    </svg>
  );
}
function IconGear() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
function IconInbox() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 13l3-9h12l3 9" />
      <path d="M3 13v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6" />
      <path d="M3 13h5l2 3h4l2-3h5" />
    </svg>
  );
}

const TAB_ICONS = {
  today: IconHome,
  journal: IconBook,
  patterns: IconWave,
  settings: IconGear,
};

// ── Refresh persistence ────────────────────────────────────────────────────
// A browser reload (or the hard pull-to-refresh) must land back on the SAME
// screen, not bounce to Today. We snapshot the navigable view state to
// sessionStorage on every change and restore it on mount.
//
// sessionStorage (not localStorage) is deliberate: reloading the current
// session is preserved, but a genuinely new session — a cold app launch, a new
// tab — still starts fresh on Today. The browser also keeps the pushState
// back-stack across a reload, so restoring the view verbatim (without
// re-pushing) keeps every back affordance unwinding exactly as it did before.
//
// Only navigable "places" are persisted. Transient capture / check-in / listen
// / handoff / onboarding flows are intentionally excluded — resuming mid-flow
// is worse than landing on the screen beneath them.
const NAV_KEY = 'ori_v2_nav';
function readNavSnapshot() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(NAV_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && typeof s === 'object' ? s : null;
  } catch { return null; }
}

export default function V2Shell() {
  // Snapshot read once at mount; feeds the lazy initializers below so a reload
  // restores the screen the user was on (see NAV_KEY / readNavSnapshot).
  const boot = useMemo(() => readNavSnapshot(), []);
  const [activeTab, setActiveTab] = useState(() => (TABS.some((t) => t.id === boot?.activeTab) ? boot.activeTab : 'today'));
  const [partDetailId, setPartDetailId] = useState(() => boot?.partDetailId ?? null);
  // Paging context for parts opened *from a letter*: an ordered set of part ids
  // plus the page you're on. Lets the reader move Prev/Next through every part a
  // letter named, and keeps the letter open underneath so back returns to it.
  const [partPager, setPartPager] = useState(null);
  // The Reflect page ("say a little about this part"). Its own full-screen flow,
  // opened from a part's doorway or an Inbox tending nudge; back returns beneath.
  // Transient (not nav-persisted) — resuming mid-reflection is worse than landing
  // on the screen beneath it, same call as Capture/Listen.
  const [reflectPartId, setReflectPartId] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showLetter, setShowLetter] = useState(() => !!boot?.showLetter);
  const [showCapture, setShowCapture] = useState(false);
  const [showHandoff, setShowHandoff] = useState(false);
  const [showListen, setShowListen] = useState(false);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [captureSeed, setCaptureSeed] = useState('');
  const [showInbox, setShowInbox] = useState(() => !!boot?.showInbox);
  const [letterDateIso, setLetterDateIso] = useState(() => boot?.letterDateIso ?? null);
  const [dayDateIso, setDayDateIso] = useState(() => boot?.dayDateIso ?? null);
  const [showHonesty, setShowHonesty] = useState(() => !!boot?.showHonesty);
  const [showHowItWorks, setShowHowItWorks] = useState(() => !!boot?.showHowItWorks);
  // First-run feature tour (spotlight coachmarks on the live UI). Transient —
  // gated by the `cpi_feature_tour_seen` flag, triggered once after onboarding.
  const [showTour, setShowTour] = useState(false);
  const tourReflect = (() => { try { return localStorage.getItem('cpi_mode') === 'reflect'; } catch { return false; } })();
  const closeTour = () => {
    setShowTour(false);
    try { localStorage.setItem('cpi_feature_tour_seen', '1'); } catch { /* ignore */ }
  };
  const replayTour = () => {
    try { localStorage.removeItem('cpi_feature_tour_seen'); } catch { /* ignore */ }
    setActiveTab('today');
    setShowTour(true);
  };
  // Trigger the tour once: onboarding finished, the welcome gate is set, the user
  // is on Today, and they haven't seen it. A short delay lets Today mount so the
  // spotlight can measure the orb / inbox / tabs.
  useEffect(() => {
    if (showOnboarding) return undefined;
    let seen = false, welcomed = false;
    try { seen = localStorage.getItem('cpi_feature_tour_seen') === '1'; } catch { /* ignore */ }
    try { welcomed = localStorage.getItem('cpi_welcome_done') === '1'; } catch { /* ignore */ }
    if (welcomed && !seen && activeTab === 'today') {
      const t = setTimeout(() => setShowTour(true), 650);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [showOnboarding, activeTab]);
  const [ringBucketId, setRingBucketId] = useState(() => boot?.ringBucketId ?? null);
  const [lensDetailId, setLensDetailId] = useState(() => boot?.lensDetailId ?? null);
  const [showSources, setShowSources] = useState(() => !!boot?.showSources);
  const [showPrivacy, setShowPrivacy] = useState(() => !!boot?.showPrivacy);
  const [showImport, setShowImport] = useState(() => !!boot?.showImport);
  // The "read your past month" announcement + the post-import backfill screen.
  // Both are transient (not persisted in the nav snapshot) — driven by the mount
  // effect below from a seen-flag (promo) and a pending-flag (backfill).
  const [showImportPromo, setShowImportPromo] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);
  const [showParts, setShowParts] = useState(() => !!boot?.showParts);
  const [showDecisions, setShowDecisions] = useState(() => !!boot?.showDecisions);
  // The scrolling content slot — pull-to-refresh attaches its gesture here.
  const contentRef = useRef(null);
  // Pull-to-refresh is for the base tabs (re-sync data). On drill-down overlays
  // (Ring detail, Part, Day…) it just slides the whole page under the finger, so
  // we disarm it there. Set to chromeVisible each render (kept live via the ref).
  const ptrEnabledRef = useRef(true);

  // Persist the navigable view state on every change so a reload restores it.
  // Transient flows (capture/listen/check-in/handoff/onboarding) are excluded
  // by design — the snapshot reflects the screen beneath them.
  useEffect(() => {
    try {
      if (typeof sessionStorage === 'undefined') return;
      sessionStorage.setItem(NAV_KEY, JSON.stringify({
        activeTab, partDetailId, showLetter, letterDateIso, showInbox,
        showHonesty, showHowItWorks, showSources, showPrivacy, showImport, showParts,
        showDecisions, dayDateIso, ringBucketId, lensDetailId,
      }));
    } catch { /* private mode / quota — refresh simply won't restore */ }
  }, [
    activeTab, partDetailId, showLetter, letterDateIso, showInbox,
    showHonesty, showHowItWorks, showSources, showPrivacy, showImport, showParts,
    showDecisions, dayDateIso, ringBucketId, lensDetailId,
  ]);

  // Theme + skin attributes live on <html> so the tokens cascade reaches
  // the page background too ([data-skin="v2"][data-tod="…"] must match a
  // single element — putting data-tod anywhere else silently kills the
  // day theme). The theme now AUTO-FOLLOWS the iOS/OS appearance: dark mode →
  // nightfall, light mode → daybreak. No manual picker — and it flips live
  // when the user changes their system appearance.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-skin', 'v2');
    const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    const applyTheme = () => {
      const dark = mq ? mq.matches : true;
      root.setAttribute('data-tod', dark ? 'nightfall' : 'day');
    };
    applyTheme();
    if (mq) {
      if (mq.addEventListener) mq.addEventListener('change', applyTheme);
      else if (mq.addListener) mq.addListener(applyTheme); // older WebKit
    }
    try {
      const rs = localStorage.getItem('cpi_v2_read_scale');
      if (rs === 'large' || rs === 'larger') root.setAttribute('data-rs', rs);
    } catch { /* default scale */ }
    return () => {
      if (mq) {
        if (mq.removeEventListener) mq.removeEventListener('change', applyTheme);
        else if (mq.removeListener) mq.removeListener(applyTheme);
      }
      root.removeAttribute('data-skin');
      root.removeAttribute('data-tod');
      root.removeAttribute('data-rs');
    };
  }, []);

  // Demo deep-link: `?letter=sample` opens the crafted sample letter straight
  // away (and skips the first-run gate), so the nightly letter — and its parts
  // pager — can be shown on any device without real data. Mirrors `?sim=1` /
  // `?skin=v1`. The param is stripped from the URL so a refresh stays put.
  const sampleLetterRequested = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get('letter') === 'sample'; }
    catch { return false; }
  }, []);

  // First-run gate: if v1's WELCOME_DONE_KEY is missing, route the user into
  // v2 onboarding immediately. Persisting `cpi_welcome_done` flips the gate
  // for both v1 and v2 going forward (the same key v1's WelcomeGarden uses).
  // Auto-opened, so it gets no history entry of its own. The sample deep-link
  // bypasses it — there's nothing to onboard for a one-off preview.
  useEffect(() => {
    if (sampleLetterRequested) {
      setLetterDateIso('sample');
      setShowLetter(true);
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('letter');
        window.history.replaceState({}, '', url);
      } catch { /* sandboxed — the param just lingers, harmless */ }
      return;
    }
    try {
      const done = localStorage.getItem('cpi_welcome_done');
      if (!done) { setShowOnboarding(true); return; }
      // Past onboarding: a just-finished import flags a pending read — show the
      // backfill screen so the upload actually produces the promised letters.
      // Otherwise, surface the "read your past month" announcement — once per day,
      // capped over a few days, then it stops (shouldShowImportPromo).
      const pending = localStorage.getItem('cpi_v2_backfill_pending') === '1';
      if (pending && pendingBackfillDays().length > 0) {
        setShowBackfill(true);
      } else if (pending) {
        // Flagged but nothing left to read (all days already analyzed) — clear
        // the flag so it can't linger as stale state across future launches.
        try { localStorage.removeItem('cpi_v2_backfill_pending'); } catch { /* fine */ }
        if (shouldShowImportPromo()) setShowImportPromo(true);
      } else if (shouldShowImportPromo()) {
        setShowImportPromo(true);
      }
    } catch { /* storage unavailable — skip onboarding gracefully */ }
  }, [sampleLetterRequested]);

  // Oura OAuth return: the server redirects back with tokens in the URL
  // hash. v1 parses it in CPI; in v2 the shell does, then runs the same
  // initial history sync so the rings fill in without a manual step.
  // On iOS the return arrives as an app.neon.ori:// deep link instead —
  // the listener parses the same hash shape and runs the same sync.
  useEffect(() => {
    const token = handleOuraCallbackHash();
    if (token) initialOuraSync(token);
    installNativeOAuthListener();
  }, []);

  // Apple Health delta sync — v1 runs this inside CPI's focus tick, which
  // never executes under the v2 shell. Same age gate, same merge path.
  useEffect(() => {
    syncAppleHealthIfDue().catch(() => { /* fail-quiet like v1 */ });
  }, []);

  // Remote killswitches — mirror the operator's /proxy/config flags once per
  // boot (fire-and-forget; offline keeps the last mirrored state). Also
  // carries the voice-outage service notice; see remoteConfig.js.
  const [voiceNotice, setVoiceNotice] = useState(voiceNoticeActive());
  useEffect(() => {
    syncRemoteConfig().then(() => setVoiceNotice(voiceNoticeActive()));
  }, []);

  // Calendar sources sync once per launch. Feed events live in a session
  // cache (never persisted — quota), so every reload starts empty; without
  // this the Demands contributors read zero events until the user visits
  // Sources and syncs by hand. Stale-or-empty feeds and the native Apple
  // Calendar (iOS) both refresh, then the rings are told to re-read.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { syncStaleFeeds } = await import('../calendar.js');
        const synced = await syncStaleFeeds();
        if (live && synced > 0) window.dispatchEvent(new Event('cpi:calendar-synced'));
      } catch { /* offline — contributors fall back to journal-only */ }
    })();
    return () => { live = false; };
  }, []);

  // The letter clock. In v1 the nightly analysis is triggered from the
  // Analyze tab; in v2 nothing else owns it, so the shell checks once a
  // minute (and on mount) whether today's letter is due — entries exist,
  // letter time passed, no letter yet — and writes it via the shared
  // engine pipeline. Failures back off inside letterEngine.
  useEffect(() => {
    const tick = () => {
      if (letterDueNow()) writeTodaysLetter();
    };
    tick();
    const id = setInterval(tick, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Letter delivery reminder. The tick above only fires while the app is open
  // (iOS suspends the timer in the background), so a letter due at 8 PM never
  // appears if the app is closed then. This schedules a LOCAL notification at
  // the letter hour whenever today has words and no letter yet — recomputed on
  // launch and every foreground, cancelled once the letter is written. Tapping
  // it opens the app, which writes the letter and jumps to it. Native-only;
  // a no-op (and never an error) on web.
  useEffect(() => {
    syncJournalReminder();
    syncLetterReminder();
    const onForeground = () => {
      if (document.hidden) return;
      syncJournalReminder();
      syncLetterReminder();
      // Resume the letter clock the instant the app returns — don't strand the
      // user on the next 60s tick (or a manual tap) after an earlier attempt was
      // interrupted by a screen-lock / app-switch. Respects the retry backoff.
      if (letterDueNow()) writeTodaysLetter();
    };
    // The letter just landed: both reminders are moot — cancel the pending
    // letter-hour banner so it can't fire later — and if the user isn't looking,
    // tell them it's ready now (when Ori is open the screen already shows it, so
    // a banner would just be noise).
    const onWritten = () => {
      cancelJournalReminder();
      cancelLetterReminder();
      if (document.hidden) notifyLetterReady();
    };
    const offReminderTap = onJournalReminderTap(() => openView(() => { setCaptureSeed(''); setShowCapture(true); }));
    const offReadyTap = onLetterReadyTap(() => openView(() => { setLetterDateIso(null); setShowLetter(true); }));
    window.addEventListener('focus', onForeground);
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('cpi:letter-written', onWritten);
    return () => {
      window.removeEventListener('focus', onForeground);
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('cpi:letter-written', onWritten);
      offReminderTap();
      offReadyTap();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Parked-decision resurface reminder — sibling of the letter reminder above.
  // The schedule is set when a decision is parked; this re-syncs it on launch
  // and on foreground (so it stays current), and wires the tap so opening the
  // reminder lands on the Decisions surface. Native-only; a no-op on web.
  useEffect(() => {
    syncDecisionReminder();
    const onForeground = () => { if (!document.hidden) syncDecisionReminder(); };
    const offTap = onDecisionReminderTap(() => openView(() => setShowDecisions(true)));
    window.addEventListener('focus', onForeground);
    document.addEventListener('visibilitychange', onForeground);
    return () => {
      window.removeEventListener('focus', onForeground);
      document.removeEventListener('visibilitychange', onForeground);
      offTap();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Daily "show up" nudge — a repeating native reminder at the user's chosen
  // hour, worded for their mode (toggled in Settings → Your day). Re-synced on
  // launch and foreground so the copy/time stay current; tapping it opens
  // Capture so the reminder leads straight to writing. Native-only; no-op on web.
  useEffect(() => {
    syncDailyNudge();
    const onForeground = () => { if (!document.hidden) syncDailyNudge(); };
    const offTap = onDailyNudgeTap(() => openView(() => { setCaptureSeed(''); setShowCapture(true); }));
    window.addEventListener('focus', onForeground);
    document.addEventListener('visibilitychange', onForeground);
    return () => {
      window.removeEventListener('focus', onForeground);
      document.removeEventListener('visibilitychange', onForeground);
      offTap();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pull-to-refresh's soft pull: re-run the same source syncs the shell does on
  // launch (Apple Health, calendars, Oura), then tell every mounted surface to
  // re-read — the exact events their focus handlers already listen for. Capped
  // so a slow network can't strand the spinner. (A harder pull reloads outright;
  // that's handled inside the hook.)
  const refreshAll = useCallback(async () => {
    const tasks = [];
    tasks.push(syncAppleHealthIfDue().catch(() => {}));
    tasks.push((async () => {
      try {
        const { syncStaleFeeds } = await import('../calendar.js');
        const n = await syncStaleFeeds();
        if (n > 0) window.dispatchEvent(new Event('cpi:calendar-synced'));
      } catch { /* offline — contributors fall back to journal-only */ }
    })());
    try {
      const token = localStorage.getItem('cpi_oura_access_token');
      if (token) tasks.push(Promise.resolve(initialOuraSync(token)).catch(() => {}));
    } catch { /* no token */ }
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise((resolve) => { setTimeout(resolve, 2600); }),
    ]);
    try { if (letterDueNow()) await writeTodaysLetter(); } catch { /* backs off in engine */ }
    for (const evt of ['focus', 'cpi:wearable-synced', 'cpi:who5-updated', 'cpi:letter-written', 'cpi:calendar-synced']) {
      try { window.dispatchEvent(new Event(evt)); } catch { /* noop */ }
    }
  }, []);

  const { pull, busy: refreshing, dragging: pulling, phase: pullPhase } = usePullToRefresh(contentRef, refreshAll, ptrEnabledRef);
  const pullLabel = pullPhase === 'busy' ? 'Refreshing…'
    : pullPhase === 'hard' ? 'Release to reload'
    : pullPhase === 'ready' ? 'Release to refresh'
    : 'Pull to refresh';

  // Closes the topmost open view. Order mirrors the render-priority chain
  // below. Returns false when nothing was open (base tab view).
  const closeTopView = () => {
    if (reflectPartId) { setReflectPartId(null); return true; }
    if (showHandoff) { setShowHandoff(false); return true; }
    if (showCheckIn) { setShowCheckIn(false); return true; }
    if (showListen) { setShowListen(false); return true; }
    if (showCapture) { setShowCapture(false); setCaptureSeed(''); return true; }
    if (showOnboarding) { setShowOnboarding(false); return true; }
    if (partPager) { setPartPager(null); return true; }
    if (showLetter) { setShowLetter(false); setLetterDateIso(null); return true; }
    if (showInbox) { setShowInbox(false); return true; }
    if (showHonesty) { setShowHonesty(false); return true; }
    if (showHowItWorks) { setShowHowItWorks(false); return true; }
    if (showSources) { setShowSources(false); return true; }
    if (showPrivacy) { setShowPrivacy(false); return true; }
    if (showImport) { setShowImport(false); return true; }
    if (showDecisions) { setShowDecisions(false); return true; }
    if (partDetailId && showParts) { setPartDetailId(null); return true; }
    if (showParts) { setShowParts(false); return true; }
    if (ringBucketId) { setRingBucketId(null); return true; }
    if (lensDetailId) { setLensDetailId(null); return true; }
    if (dayDateIso) { setDayDateIso(null); return true; }
    if (partDetailId) { setPartDetailId(null); return true; }
    return false;
  };
  const closeTopViewRef = useRef(closeTopView);
  closeTopViewRef.current = closeTopView;
  // Refs the one-time gesture listener reads at touch time (state changes
  // between renders; the listener is installed once).
  const goBackRef = useRef(() => {});
  const canSwipeBackRef = useRef(false);

  useEffect(() => {
    const onPop = () => { closeTopViewRef.current(); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Edge-swipe back — a rightward drag that begins at the left edge goes to
  // the previous screen, on any open sub-view (mirrors the iOS back gesture).
  // Installed once; guarded by refs so it only fires when a view is open.
  useEffect(() => {
    let startX = 0, startY = 0, tracking = false;
    const onStart = (e) => {
      const t = e.touches && e.touches[0];
      if (!t || !canSwipeBackRef.current) return;
      if (t.clientX > 30) return;            // must begin at the left edge
      startX = t.clientX; startY = t.clientY; tracking = true;
    };
    const onMove = (e) => {
      if (!tracking) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (dx > 72 && dy < 48) { tracking = false; goBackRef.current(); }
    };
    const stop = () => { tracking = false; };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', stop, { passive: true });
    window.addEventListener('touchcancel', stop, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', stop);
      window.removeEventListener('touchcancel', stop);
    };
  }, []);

  // Open a view from the base: apply the state change, then push one
  // history entry so back (button, key, edge-swipe) closes it.
  const openView = (apply) => {
    apply();
    try { window.history.pushState({ oriV2: true }, ''); } catch { /* sandboxed */ }
  };

  // Every back affordance routes through history so the entry count stays
  // balanced; popstate does the actual closing.
  const goBack = () => {
    try { window.history.back(); } catch { closeTopViewRef.current(); }
  };
  goBackRef.current = goBack;

  // After an entry is captured, the design's quiet check-in (WHO-5) runs
  // before the handoff — but only once a day; skip straight to the handoff
  // when today's check-in already exists. Same history depth: these are
  // swaps, not new entries.
  const afterCapture = () => {
    // A fresh entry means today now has words — clear the "note your day"
    // reminder and arm the "your letter is ready" one for the letter hour.
    // (syncJournalReminder cancels itself once anything's written; the letter
    // reminder only arms now that there are words to write a letter from.)
    syncJournalReminder();
    syncLetterReminder();
    // Witness FIRST: the handoff shows immediately, before any check-in, so
    // being heard never waits behind a questionnaire. The handoff itself offers
    // the (optional) WHO-5 afterwards, on days it isn't done yet.
    setShowHandoff(true);
  };

  let body;
  if (reflectPartId) {
    // The Reflect page sits above whatever opened it (a part detail, or the
    // Inbox). Back (chevron / edge-swipe / browser) pops the pushed entry and
    // closeTopView clears reflectPartId, revealing that screen again.
    body = (
      <ReflectPage
        part={PARTS_LIB[reflectPartId]}
        backLabel="Back"
        onBack={goBack}
        onLanded={() => { /* lands locally; the screen beneath re-reads on focus */ }}
      />
    );
  } else if (showHandoff) {
    body = (
      <Handoff
        onDone={goBack}
        offerCheckIn={!todayWho5()}
        onCheckIn={() => { setShowHandoff(false); setShowCheckIn(true); }}
      />
    );
  } else if (showCheckIn) {
    // Reached only from the handoff's optional offer now (witness → then this).
    // Either finishing or skipping just returns home.
    body = (
      <CheckIn
        onDone={goBack}
        onSkip={goBack}
      />
    );
  } else if (showListen) {
    body = (
      <Listen
        onBack={goBack}
        onSubmitted={() => {
          setShowListen(false);
          afterCapture();
        }}
        onWriteInstead={(text) => {
          setShowListen(false);
          setCaptureSeed(text || '');
          setShowCapture(true);
        }}
      />
    );
  } else if (showCapture) {
    body = (
      <Capture
        seedText={captureSeed}
        onBack={goBack}
        onSubmitted={() => {
          setShowCapture(false);
          setCaptureSeed('');
          afterCapture();
        }}
      />
    );
  } else if (showOnboarding) {
    body = <Onboarding onDone={() => setShowOnboarding(false)} />;
  } else if (showImportPromo) {
    body = (
      <ImportPromo
        onUpload={() => { setShowImportPromo(false); openView(() => setShowImport(true)); }}
        onClose={() => setShowImportPromo(false)}
      />
    );
  } else if (showBackfill) {
    body = (
      <Backfill
        onClose={() => { setShowBackfill(false); setActiveTab('journal'); }}
        onOpenInbox={() => { setShowBackfill(false); setShowInbox(true); }}
      />
    );
  } else if (partPager && partPager.ids[partPager.index]) {
    // Rendered above the (still-open) letter. Prev/Next swap the part in place;
    // back (chevron/edge-swipe) pops the one pushed entry → the letter returns.
    const { ids, index } = partPager;
    body = (
      <PartDetail
        partId={ids[index]}
        onBack={goBack}
        backLabel="Letter"
        onListen={() => openView(() => setShowListen(true))}
        onReflect={(id) => openView(() => setReflectPartId(id))}
        pager={{
          index,
          total: ids.length,
          onPrev: index > 0 ? () => setPartPager((p) => ({ ...p, index: p.index - 1 })) : null,
          onNext: index < ids.length - 1 ? () => setPartPager((p) => ({ ...p, index: p.index + 1 })) : null,
        }}
      />
    );
  } else if (showLetter) {
    body = (
      <Letter
        dateIso={letterDateIso}
        onClose={goBack}
        onOpenPart={(id, ids) => {
          // Keep the letter open underneath; push one history entry so back
          // returns to it. The pager swaps parts in place (no extra entries).
          const list = Array.isArray(ids) && ids.length ? ids : [id];
          const index = Math.max(0, list.indexOf(id));
          openView(() => setPartPager({ ids: list, index }));
        }}
      />
    );
  } else if (showInbox) {
    body = (
      <Inbox
        onClose={goBack}
        onOpenLetter={(iso) => {
          setShowInbox(false);
          setLetterDateIso(iso);
          setShowLetter(true);
        }}
        onOpenReflect={(id) => {
          // Swap in place (no new history entry) like onOpenLetter: back from
          // reflect pops the inbox's entry → the screen beneath the inbox.
          setShowInbox(false);
          setReflectPartId(id);
        }}
      />
    );
  } else if (showHonesty) {
    body = <HonestyLayers onBack={goBack} />;
  } else if (showHowItWorks) {
    body = <HowItWorks onBack={goBack} />;
  } else if (showSources) {
    body = <Sources onBack={goBack} />;
  } else if (showPrivacy) {
    body = <Privacy onBack={goBack} />;
  } else if (showImport) {
    body = (
      <ImportJournal
        onBack={goBack}
        onDone={() => {
          setShowImport(false);
          // If the upload left unread days, go straight to the read screen so
          // the promo's promise — a letter for your last 30 days — is kept.
          if (pendingBackfillDays().length > 0) setShowBackfill(true);
          else setActiveTab('journal');
        }}
      />
    );
  } else if (ringBucketId) {
    body = <RingDetail bucketId={ringBucketId} onBack={goBack} onCheckIn={() => setShowCheckIn(true)} />;
  } else if (lensDetailId) {
    body = (
      <PatternDetail
        patternId={lensDetailId}
        onBack={goBack}
        onOpenDay={(iso) => {
          setLensDetailId(null);
          setDayDateIso(iso);
        }}
        onOpenPart={(id) => {
          setLensDetailId(null);
          setPartDetailId(id);
        }}
      />
    );
  } else if (dayDateIso) {
    body = (
      <Day
        dateIso={dayDateIso}
        onBack={goBack}
        onOpenLetter={(iso) => {
          setDayDateIso(null);
          setLetterDateIso(iso);
          setShowLetter(true);
        }}
        onOpenPart={(id) => {
          setDayDateIso(null);
          setPartDetailId(id);
        }}
      />
    );
  } else if (partDetailId) {
    body = (
      <PartDetail
        partId={partDetailId}
        onBack={goBack}
        onListen={() => openView(() => setShowListen(true))}
        onReflect={(id) => openView(() => setReflectPartId(id))}
      />
    );
  } else if (showParts) {
    body = (
      <Parts
        onBack={goBack}
        onOpenPart={(id) => openView(() => setPartDetailId(id))}
      />
    );
  } else if (showDecisions) {
    body = <Decisions onClose={goBack} />;
  } else {
    const tab = TABS.find((t) => t.id === activeTab) ?? TABS[0];
    const Surface = tab.Component;
    body = (
      <Surface
        onOpenPart={(id) => openView(() => setPartDetailId(id))}
        onOpenParts={() => openView(() => setShowParts(true))}
        onOpenLetter={() => openView(() => setShowLetter(true))}
        onOpenOnboarding={() => openView(() => setShowOnboarding(true))}
        onOpenDay={(iso) => openView(() => setDayDateIso(iso))}
        onOpenHonesty={() => openView(() => setShowHonesty(true))}
        onOpenHowItWorks={() => openView(() => setShowHowItWorks(true))}
        onReplayTour={replayTour}
        onOpenSources={() => openView(() => setShowSources(true))}
        onOpenPrivacy={() => openView(() => setShowPrivacy(true))}
        onOpenImport={() => openView(() => setShowImport(true))}
        onOpenRing={(bucketId) => openView(() => setRingBucketId(bucketId))}
        onOpenLens={(id) => openView(() => setLensDetailId(id))}
        onListen={() => openView(() => { setShowCapture(false); setShowListen(true); })}
        onCapture={() => openView(() => {
          setShowListen(false);
          setCaptureSeed('');
          setShowCapture(true);
        })}
        onOpenInbox={() => openView(() => setShowInbox(true))}
        onOpenDecisions={() => openView(() => setShowDecisions(true))}
      />
    );
  }

  const chromeVisible =
    !reflectPartId
    && !showOnboarding && !showLetter && !partDetailId && !partPager
    && !showCapture && !showHandoff && !showListen && !showCheckIn
    && !showInbox && !dayDateIso && !showHonesty && !showHowItWorks && !ringBucketId
    && !showSources && !showPrivacy && !showImport && !showParts && !lensDetailId
    && !showDecisions && !showImportPromo && !showBackfill;

  // Pull-to-refresh only on the base tabs — never on a drill-down overlay, where
  // the pull-translate makes the whole graph/page slide around (Ring detail etc.).
  ptrEnabledRef.current = chromeVisible;

  // Today renders its own greeting header (design's .hdr) — the shell's
  // brand bar would double up, so it only shows on the other tabs.
  const brandBarVisible = chromeVisible && activeTab !== 'today';

  // Swipe-back is live whenever a sub-view is open — i.e. not on the base
  // tabs and not in onboarding (which has its own Back / Continue).
  canSwipeBackRef.current = !chromeVisible && !showOnboarding;

  return (
    // No data-skin here — the attribute lives on <html> (set in main.jsx /
    // the mount effect). Re-declaring it on an inner element would shadow
    // the html-level [data-tod] theme overrides with nightfall defaults.
    <div>
      <div className={`v2-frame${chromeVisible ? ' has-tabbar' : ''}`}>
        {brandBarVisible && (
          <header className="v2-header">
            <span className="v2-brand">Ori</span>
            <button
              type="button"
              className="v2-inbox"
              aria-label="Open Inbox"
              onClick={() => openView(() => setShowInbox(true))}
            >
              <IconInbox />
            </button>
          </header>
        )}

        {/* Service notice — shown only while the operator flag is up (voice/STT
            provider outage). Chrome strip like the header, not a surface root:
            its own gutter-matched padding is the header's, not v2-content's. */}
        {voiceNotice && (
          <div className="v2-svc-note" role="status">
            Voice is having technical difficulties and may not work right now.
            Writing works as always — this note will disappear the moment voice is back.
          </div>
        )}

        {/* Scroll wrapper holds the pull-to-refresh indicator above the content
            and clips the content as it's drawn down. It's a transparent flex
            passthrough — the content box (and the safe-area frame math) is
            unchanged. */}
        <div className="v2-scrollwrap">
          <div
            className={`v2-ptr ${pullPhase}`}
            style={{ height: `${Math.max(pull, refreshing ? 54 : 0)}px`, opacity: pull > 4 || refreshing ? 1 : 0 }}
            aria-hidden={pull <= 0 && !refreshing}
          >
            <div className="v2-ptr-in">
              <span className="v2-ptr-spin" aria-hidden="true" />
              <span className="v2-ptr-label">{pullLabel}</span>
            </div>
          </div>
          <main
            ref={contentRef}
            className="v2-content"
            style={{
              transform: pull > 0 ? `translateY(${pull}px)` : undefined,
              transition: pulling ? 'none' : 'transform .32s cubic-bezier(.22, 1, .36, 1)',
            }}
          >
            {body}
          </main>
        </div>

        {chromeVisible && (
          <nav className="v2-tabbar" aria-label="Primary">
            {TABS.map((tab) => {
              const Icon = TAB_ICONS[tab.id];
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-tour={`tab-${tab.id}`}
                  className={`v2-tab${activeTab === tab.id ? ' on' : ''}`}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  aria-label={tab.label}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon />
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {showTour && chromeVisible && activeTab === 'today' && (
        <FeatureTour steps={tourSteps(tourReflect)} onClose={closeTour} />
      )}
    </div>
  );
}
