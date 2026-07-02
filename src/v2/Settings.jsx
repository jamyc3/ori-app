// Ori v2 — Settings.
//
// The design's Settings screen (group cards · srow rows · toggles), now
// carrying every v1 setting either natively (simple key-value settings
// write the same localStorage keys v1 reads) or routed (heavy flows —
// calendar feeds, journal import, Oura manage — open the classic view).
//
// Native here: theme, text size, garden name, signature, age, mode,
// letter time, WHO-5 quiet check-in reminder, sleep window.
// Routed: Connected sources (v2 screen), Export & privacy (v2 screen),
// How numbers are made (v2 screen), Import journals (classic).
// The "open classic settings" escape hatch is no longer surfaced in the UI;
// the v1 skin remains reachable directly via /?skin=v1.

import { useEffect, useState } from 'react';
import './styles/settings.css';
import { appleHealthGranted } from './appleHealth.js';
import {
  loadSelfReportedSleepWindow,
  saveSelfReportedSleepWindow,
  parseTimeToMinutes,
  minutesToTime,
  SLEEP_WINDOW_KEY,
} from '../sleep-window.js';
import { GARDEN_NAME_KEY, REFLECT_TIME_KEY, MODE_KEY } from '../engine.js';
import { REFLECT_LANG_KEY } from '../integrations/deepgram.js';
import { t } from './i18n.js';
import { dailyNudgeEnabled, setDailyNudgeEnabled, syncDailyNudge } from './dailyNudge.js';
import { syncJournalReminder, syncLetterReminder } from './letterNotify.js';
import { CrisisHelpFooter } from './CrisisSupport.jsx';
import { checkStoragePressure } from './storageHealth.js';

const SIGNATURE_KEY = 'cpi_signature';
const USER_AGE_KEY = 'cpi_user_age';
const TOD_KEY = 'cpi_v2_tod';
const RS_KEY = 'cpi_v2_read_scale';
// Engine inputs (same keys v1 writes — the analyze pipeline reads both).
const CHRONO_KEY = 'cpi_chronotype';
const LIFESTYLE_KEY = 'cpi_lifestyle';

const CHRONOTYPES = [
  { id: 'morning', label: 'Early bird' },
  { id: 'flexible', label: 'Flexible' },
  { id: 'evening', label: 'Night owl' },
];
const EXERCISE_LEVELS = [
  { id: 'none', label: 'None' },
  { id: 'light', label: 'Light' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'intense', label: 'Intense' },
];

function readLifestyle() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LIFESTYLE_KEY) || 'null');
    if (parsed && typeof parsed === 'object') return { hydration: 6, exercise: 'none', ...parsed };
  } catch { /* default below */ }
  return { hydration: 6, exercise: 'none' };
}

const THEMES = [
  { id: 'nightfall', label: 'Nightfall' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'day', label: 'Daybreak' },
];

const TIME_OPTIONS = ['8 PM', '9 PM', '10 PM', 'Sunrise'];
const SCALES = [
  { id: '', label: 'A', title: 'Default text size' },
  { id: 'large', label: 'A', title: 'Large text' },
  { id: 'larger', label: 'A', title: 'Larger text' },
];

function readString(key, fallback = '') {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function persist(key, value) {
  try {
    if (value === '' || value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch { /* quota */ }
}

// v1 stores "HH:MM" (21:00); v2 onboarding stores the chip value ("9 PM").
// Normalize for display + the chip row.
function displayLetterTime(raw) {
  const hm = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!hm) return TIME_OPTIONS.includes(raw) ? raw : '9 PM';
  const h = parseInt(hm[1], 10);
  if (h === 20) return '8 PM';
  if (h === 21) return '9 PM';
  if (h === 22) return '10 PM';
  return `${h}:${hm[2]}`;
}

function IconChevronRight() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

export default function Settings({ onOpenHonesty, onOpenSources, onOpenPrivacy, onOpenImport, onOpenOnboarding, onOpenParts, onOpenDecisions, onOpenHowItWorks, onReplayTour }) {
  const [gardenName, setGardenName] = useState(() => readString(GARDEN_NAME_KEY));
  const [signature, setSignature] = useState(() => readString(SIGNATURE_KEY));
  const [age, setAge] = useState(() => readString(USER_AGE_KEY));
  const [mode, setMode] = useState(() => readString(MODE_KEY, 'full'));
  const [reflectLang, setReflectLang] = useState(() => readString(REFLECT_LANG_KEY, 'en'));
  const [dailyNudge, setDailyNudge] = useState(() => dailyNudgeEnabled());
  const [letterTime, setLetterTime] = useState(() => displayLetterTime(readString(REFLECT_TIME_KEY, '9 PM')));
  const [sleepWin, setSleepWin] = useState(() => loadSelfReportedSleepWindow());
  const [chronotype, setChronotype] = useState(() => readString(CHRONO_KEY, 'flexible'));
  const [lifestyle, setLifestyle] = useState(readLifestyle);
  const ouraConnected = Boolean(readString('cpi_oura_access_token'));
  // Live grant, not the never-cleared "seen" marker — so disconnecting
  // Health actually drops it from the summary instead of lingering.
  const ahConnected = appleHealthGranted();
  // "Your day" only asks for inputs the current mode + setup actually USES, so
  // neither mode shows redundant fields:
  //   • Sleep window + Sharpest hours — manual fallbacks for the peak-hours /
  //     decision-timing model. A wearable supplies them, so hide when connected;
  //     a no-wearable user (full OR reflect) still needs them for decision timing.
  //   • Movement (exercise) — a body-reading signal a wearable already tracks, and
  //     NOT in Reflect's words-only whitelist (engine MODE_CAPABILITIES). So it's
  //     only asked in Full mode with no wearable.
  //   • Water (hydration) — a body-reading signal no wearable tracks, but still
  //     words-only-excluded. So it's asked in Full mode only.
  const hasWearable = ouraConnected || ahConnected;
  const isReflect = mode === 'reflect';

  // Apple requires a health app to surface its privacy policy in-app (5.1.2).
  // Opens the live policy — which names every processor (Anthropic, Deepgram,
  // OpenAI) and what leaves the device — in an in-app browser on iOS, new tab
  // on web. Distinct from "Export & privacy" below, which is the on-device
  // data-actions surface.
  const openPrivacyPolicy = async () => {
    const url = 'https://orijournal.app/privacy.html';
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // Categories collapse by default; tapping the header reveals the group (the
  // adjacent .v2-group is hidden via CSS sibling rule). Garden + Decisions share
  // one collapsible group ("Garden & decisions").
  const [openCats, setOpenCats] = useState(() => new Set());

  // Quiet storage-pressure note: browsers fail writes silently at quota, so
  // warn BEFORE that point. Rendered only when genuinely high — otherwise
  // nothing (honest empty state, no filler).
  const [storageHigh, setStorageHigh] = useState(false);
  useEffect(() => {
    let live = true;
    checkStoragePressure().then((p) => { if (live && p?.high) setStorageHigh(true); });
    return () => { live = false; };
  }, []);
  const toggleCat = (title) => setOpenCats((prev) => {
    const next = new Set(prev);
    if (next.has(title)) next.delete(title); else next.add(title);
    return next;
  });
  const catHeader = (key, label) => {
    const open = openCats.has(key);
    return (
      <button
        type="button"
        className={`v2-set-eyebrow tap${open ? ' open' : ''}`}
        onClick={() => toggleCat(key)}
        aria-expanded={open}
      >
        <span>{label ?? key}</span>
        <svg className="v2-set-caret" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
    );
  };

  // Theme follows the iOS system appearance now (handled in Shell), so there's
  // no theme/text-size control here to apply or persist.

  const handleMode = (next) => {
    setMode(next);
    persist(MODE_KEY, next);
    // Mode changes the nudge's wording — reschedule so it stays current.
    if (dailyNudge) syncDailyNudge();
  };

  // Reflect-mode language. 'bn' routes the seed voice (STT) AND the nightly
  // letter to Bengali; everything else stays English. Reflect-only.
  const handleReflectLang = (next) => {
    setReflectLang(next);
    persist(REFLECT_LANG_KEY, next);
  };

  const handleDailyNudge = (on) => {
    setDailyNudge(on);
    setDailyNudgeEnabled(on);
    syncDailyNudge();
    // The journal/letter reminders defer to the nudge when it's on (and resume
    // when it's off) — re-sync them now so the change takes effect this evening,
    // not just after the next foreground.
    syncJournalReminder();
    syncLetterReminder();
  };

  const handleLetterTime = (t) => {
    setLetterTime(t);
    persist(REFLECT_TIME_KEY, t);
    // Re-arm everything pinned to the letter hour so a time change takes effect
    // now, not on next launch: the "your letter is ready" reminder, the "you
    // haven't journalled yet" nudge, and (if on) the daily come-back nudge.
    syncLetterReminder();
    syncJournalReminder();
    if (dailyNudge) syncDailyNudge();
  };

  const handleSleep = (which, timeStr) => {
    const min = parseTimeToMinutes(timeStr);
    if (min == null) return;
    const bed = which === 'bed' ? min : sleepWin?.bedtimeMin ?? 1380;
    const wake = which === 'wake' ? min : sleepWin?.wakeMin ?? 420;
    saveSelfReportedSleepWindow(bed, wake);
    setSleepWin(loadSelfReportedSleepWindow());
  };
  const clearSleep = () => {
    try { localStorage.removeItem(SLEEP_WINDOW_KEY); } catch { /* ignore */ }
    setSleepWin(null);
  };

  const handleChronotype = (id) => {
    setChronotype(id);
    persist(CHRONO_KEY, id);
  };
  const handleLifestyle = (patch) => {
    const next = { ...lifestyle, ...patch };
    setLifestyle(next);
    try { localStorage.setItem(LIFESTYLE_KEY, JSON.stringify(next)); } catch { /* quota */ }
  };

  return (
    <section className="v2-settings">
      <h1 className="v2-set-title">{t('Settings', 'সেটিংস')}</h1>

      {storageHigh && (
        <p className="v2-set-storage-note">
          {t(
            'This device is running low on space for Ori. Your journal is safe right now — a backup from “Export & privacy” below keeps it that way.',
            'এই ডিভাইসে Ori-র জায়গা কমে আসছে। তোমার জার্নাল এখন নিরাপদ — নিচের “Export & privacy” থেকে একটা ব্যাকআপ নিয়ে রাখো।',
          )}
        </p>
      )}

      {/* Order follows a person's own mental model — you → your rhythm → what
          feeds it → what grows → how it's kept → what Ori is:
          Profile → Your day → Connections & data → Garden & decisions →
          Trust → About. Theme auto-follows the iOS appearance; text size is
          hidden for now (the old "Appearance" group is gone). */}
      {catHeader('Profile', t('Profile', 'প্রোফাইল'))}
      <div className="v2-group">
        <div className="v2-srow">
          <span className="v2-srow-l">{t('Garden name', 'বাগানের নাম')}</span>
          <input
            type="text"
            className="v2-srow-input"
            value={gardenName}
            maxLength={32}
            placeholder={t('My evenings', 'আমার সন্ধ্যেগুলো')}
            onChange={(e) => { setGardenName(e.target.value); persist(GARDEN_NAME_KEY, e.target.value); }}
          />
        </div>
        <div className="v2-srow">
          <div className="v2-srow-tx">
            <span className="v2-srow-l">{t('Signature', 'স্বাক্ষর')}</span>
            <span className="v2-srow-sub">{t('How the letter signs off to you.', 'চিঠি তোমাকে কীভাবে বিদায় জানায়।')}</span>
          </div>
          <input
            type="text"
            className="v2-srow-input italic"
            value={signature}
            maxLength={40}
            placeholder="— Ori"
            onChange={(e) => { setSignature(e.target.value); persist(SIGNATURE_KEY, e.target.value); }}
          />
        </div>
        <div className="v2-srow">
          <div className="v2-srow-tx">
            <span className="v2-srow-l">{t('Age', 'বয়স')}</span>
            <span className="v2-srow-sub">{t('Optional — sharpens reference ranges later.', 'ঐচ্ছিক — পরে তুলনার মাপ আরও নিখুঁত করে।')}</span>
          </div>
          <input
            type="number"
            className="v2-srow-input num"
            value={age}
            min={5}
            max={120}
            placeholder="—"
            onChange={(e) => { setAge(e.target.value); persist(USER_AGE_KEY, e.target.value); }}
          />
        </div>
      </div>

      {catHeader('Your day', t('Your day', 'তোমার দিন'))}
      <div className="v2-group">
        <div className="v2-srow">
          <div className="v2-srow-tx">
            <span className="v2-srow-l">{t('Mode', 'ধরন')}</span>
            <span className="v2-srow-sub">{t('Full reads your wearables · Reflect is words only.', 'ফুল তোমার ওয়্যারেবল পড়ে · রিফ্লেক্ট শুধু কথায়।')}</span>
          </div>
          <div className="v2-seg">
            <button type="button" className={mode !== 'reflect' ? 'on' : ''} onClick={() => handleMode('full')}>{t('Full', 'ফুল')}</button>
            <button type="button" className={mode === 'reflect' ? 'on' : ''} onClick={() => handleMode('reflect')}>{t('Reflect', 'রিফ্লেক্ট')}</button>
          </div>
        </div>
        <div className="v2-srow stack">
          <div className="v2-srow-tx">
            <span className="v2-srow-l">{t('Letter time', 'চিঠির সময়')}</span>
            <span className="v2-srow-sub">{t('Ori composes once a day, after your evening settles.', 'অরি দিনে একবার লেখে, তোমার সন্ধে থিতু হলে।')}</span>
          </div>
          <div className="v2-chiprow">
            {TIME_OPTIONS.map((t) => (
              <button
                key={t}
                type="button"
                className={`v2-chip${letterTime === t ? ' on' : ''}`}
                onClick={() => handleLetterTime(t)}
                aria-pressed={letterTime === t}
              >{t}</button>
            ))}
          </div>
        </div>
        <div className="v2-srow">
          <div className="v2-srow-tx">
            <span className="v2-srow-l">{t('Daily reminder', 'রোজকার মনে-করানো')}</span>
            <span className="v2-srow-sub">{t('A gentle nudge, at your time above.', 'উপরের সময়ে, একটা নরম মনে-করানো।')}</span>
          </div>
          <div className="v2-seg">
            <button type="button" className={dailyNudge ? 'on' : ''} onClick={() => handleDailyNudge(true)} aria-pressed={dailyNudge}>{t('On', 'চালু')}</button>
            <button type="button" className={!dailyNudge ? 'on' : ''} onClick={() => handleDailyNudge(false)} aria-pressed={!dailyNudge}>{t('Off', 'বন্ধ')}</button>
          </div>
        </div>
        {/* The old "Quiet check-in reminder" was web/service-worker only — it
            fired just while the app was open and never reached the lock screen.
            "Daily reminder" above replaces it with a real native notification
            (LocalNotifications, repeating at the user's hour, mode-aware). */}
        {!hasWearable && (<>
        <div className="v2-srow stack">
          <div className="v2-srow-tx">
            <span className="v2-srow-l">{t('Sleep window', 'ঘুমের সময়')}</span>
            <span className="v2-srow-sub">
              {t('A rough bed → up window. Used for your peak hours when no wearable fills it in.', 'মোটামুটি শোয়া → ওঠার সময়। ওয়্যারেবল না থাকলে তোমার সেরা সময় বের করতে কাজে লাগে।')}
            </span>
          </div>
          <div className="v2-sleeprow">
            <input
              type="time"
              className="v2-srow-input time"
              value={sleepWin ? minutesToTime(sleepWin.bedtimeMin) : ''}
              onChange={(e) => handleSleep('bed', e.target.value)}
              aria-label={t('Bed around', 'আনুমানিক শোয়ার সময়')}
            />
            <span className="v2-sleeparrow">→</span>
            <input
              type="time"
              className="v2-srow-input time"
              value={sleepWin ? minutesToTime(sleepWin.wakeMin) : ''}
              onChange={(e) => handleSleep('wake', e.target.value)}
              aria-label={t('Up around', 'আনুমানিক ওঠার সময়')}
            />
            {sleepWin && (
              <button type="button" className="v2-srow-clear" onClick={clearSleep}>{t('Clear', 'মুছে দাও')}</button>
            )}
          </div>
        </div>
        <div className="v2-srow stack">
          <div className="v2-srow-tx">
            <span className="v2-srow-l">{t('Sharpest hours', 'সবচেয়ে স্বচ্ছ সময়')}</span>
            <span className="v2-srow-sub">{t('When your mind usually peaks. The reading uses this when no wearable can tell.', 'যখন তোমার মন সাধারণত সবচেয়ে খোলে। ওয়্যারেবল বলতে না পারলে এটা কাজে লাগে।')}</span>
          </div>
          <div className="v2-seg">
            {CHRONOTYPES.map((c) => (
              <button key={c.id} type="button" className={chronotype === c.id ? 'on' : ''} onClick={() => handleChronotype(c.id)}>{c.label}</button>
            ))}
          </div>
        </div>
        </>)}
        {!isReflect && !hasWearable && (
        <div className="v2-srow stack">
          <div className="v2-srow-tx">
            <span className="v2-srow-l">{t('Movement', 'চলাফেরা')}</span>
            <span className="v2-srow-sub">{t("Your usual day's exercise, in your own words. It feeds the reading, gently.", 'তোমার রোজকার দিনের ব্যায়াম, নিজের কথায়। আস্তে করে পড়ায় যোগ হয়।')}</span>
          </div>
          <div className="v2-seg">
            {EXERCISE_LEVELS.map((x) => (
              <button key={x.id} type="button" className={lifestyle.exercise === x.id ? 'on' : ''} onClick={() => handleLifestyle({ exercise: x.id })}>{x.label}</button>
            ))}
          </div>
        </div>
        )}
        {!isReflect && (
        <div className="v2-srow">
          <div className="v2-srow-tx">
            <span className="v2-srow-l">{t('Water', 'জল')}</span>
            <span className="v2-srow-sub">{t('Glasses on a usual day.', "রোজকার দিনে ক'গ্লাস।")}</span>
          </div>
          <div className="v2-stepper">
            <button type="button" aria-label={t('Fewer glasses', 'কম গ্লাস')} onClick={() => handleLifestyle({ hydration: Math.max(0, (lifestyle.hydration ?? 6) - 1) })}>−</button>
            <span>{lifestyle.hydration ?? 6}</span>
            <button type="button" aria-label={t('More glasses', 'বেশি গ্লাস')} onClick={() => handleLifestyle({ hydration: Math.min(16, (lifestyle.hydration ?? 6) + 1) })}>+</button>
          </div>
        </div>
        )}
      </div>

      {catHeader('Connections & data', t('Connections & data', 'সংযোগ ও তথ্য'))}
      <div className="v2-group">
        <button type="button" className="v2-srow tap" onClick={() => onOpenSources?.()}>
          <span className="v2-srow-l">{t('Connected sources', 'সংযুক্ত উৎস')}</span>
          <span className="v2-srow-r">
            {[ouraConnected && 'Oura', ahConnected && 'Health'].filter(Boolean).join(' · ') || t('None', 'কোনোটি নয়')}
            <IconChevronRight />
          </span>
        </button>
        <button type="button" className="v2-srow tap" onClick={() => onOpenImport?.()}>
          <span className="v2-srow-l">{t('Import journals', 'জার্নাল আনো')}</span>
          <span className="v2-srow-r">{t('Paste · files · photos', 'পেস্ট · ফাইল · ছবি')} <IconChevronRight /></span>
        </button>
      </div>

      {catHeader('Garden & decisions', t('Garden & decisions', 'বাগান ও সিদ্ধান্ত'))}
      <div className="v2-group">
        <button type="button" className="v2-srow tap" onClick={() => onOpenParts?.()}>
          <span className="v2-srow-l">{t("Parts you've met", 'যে অংশগুলোর সঙ্গে দেখা হয়েছে')}</span>
          <span className="v2-srow-r">{t('The eight, by familiarity', 'আটটি, পরিচয়ের ক্রমে')} <IconChevronRight /></span>
        </button>
        <button type="button" className="v2-srow tap" onClick={() => onOpenDecisions?.()}>
          <span className="v2-srow-l">{t('Park a decision', 'একটা সিদ্ধান্ত সরিয়ে রাখো')}</span>
          <span className="v2-srow-r">{t('Made at a sharper hour', 'আরও স্বচ্ছ সময়ে নেওয়া হবে')} <IconChevronRight /></span>
        </button>
      </div>

      {catHeader('Trust', t('Trust', 'বিশ্বাস'))}
      <div className="v2-group">
        <button type="button" className="v2-srow tap" onClick={() => onOpenHonesty?.()}>
          <span className="v2-srow-l">{t('How numbers are made', 'সংখ্যাগুলো কীভাবে তৈরি হয়')}</span>
          <span className="v2-srow-r">{t('Honesty layers', 'সততার স্তর')} <IconChevronRight /></span>
        </button>
        <button type="button" className="v2-srow tap" onClick={() => onOpenPrivacy?.()}>
          <span className="v2-srow-l">{t('Export & privacy', 'রপ্তানি ও গোপনীয়তা')}</span>
          <span className="v2-srow-r">{t('On device', 'এই ডিভাইসেই')} <IconChevronRight /></span>
        </button>
        <button type="button" className="v2-srow tap" onClick={openPrivacyPolicy}>
          <span className="v2-srow-l">{t('Privacy policy', 'গোপনীয়তা নীতি')}</span>
          <span className="v2-srow-r">{t('Read online', 'অনলাইনে পড়ো')} <IconChevronRight /></span>
        </button>
      </div>

      {catHeader('About', t('About', 'পরিচিতি'))}
      <div className="v2-group">
        {/* One entry, not three — "How Ori works" replays the guided tour. (Was
            three near-duplicate rows: the deck, replay-the-tour, replay-the-intro.) */}
        {(onReplayTour || onOpenHowItWorks) && (
          <button type="button" className="v2-srow tap" onClick={() => (onReplayTour || onOpenHowItWorks)()}>
            <span className="v2-srow-l">{t('How Ori works', 'অরি কীভাবে কাজ করে')}</span>
            <span className="v2-srow-r">{t('Replay the tour', 'পরিচিতি আবার দেখো')} <IconChevronRight /></span>
          </button>
        )}
        <div className="v2-srow">
          <span className="v2-srow-l">{t('Language', 'ভাষা')}</span>
          <div className="v2-seg">
            <button type="button" className={reflectLang !== 'bn' ? 'on' : ''} onClick={() => handleReflectLang('en')}>English</button>
            <button type="button" className={reflectLang === 'bn' ? 'on' : ''} onClick={() => handleReflectLang('bn')}>বাংলা</button>
          </div>
        </div>
      </div>
      <CrisisHelpFooter />
    </section>
  );
}
