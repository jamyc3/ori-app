// Ori v2 — Onboarding.
//
// Seven-scene welcome flow per the design (v2-preview.html onboard-1…6):
// welcome → name → source fork → connect wearable (Full mode only) →
// letter time → two promises (+ an optional opt-in) → ready. Collects a name,
// a mode (Full vs Reflect), an optional wearable preference, and a
// reflect time. "Skip onboarding" finishes immediately with defaults.
//
// Honesty: the connect scene shows real connection state only —
// Oura reads cpi_oura_access; nothing is ever shown as "Connected"
// unless the integration actually is. Tapping a card records a
// preference; the OAuth itself lives in Settings → Connections.
//
// Persists to the same localStorage keys v1's WelcomeGarden uses, so the
// shared engine reads the resulting profile identically. Setting
// WELCOME_DONE_KEY flips the "first run" gate for both v1 and v2.

import { useState, useEffect } from 'react';
import './styles/onboarding.css';
import { isNativeIOS, startOuraConnect, startOuraConnectNative } from './ouraConnect.js';
import { connectAppleHealth, appleHealthAvailable, appleHealthGranted } from './appleHealth.js';
import { grantDataConsent } from './acknowledgmentEngine.js';
import HowItWorks from './HowItWorks.jsx';
import {
  GARDEN_NAME_KEY, REFLECT_TIME_KEY, MODE_KEY, WELCOME_DONE_KEY, OURA_ACCESS_KEY,
} from '../engine.js';

// Seed from any existing profile so replaying the intro (Settings → Replay
// the intro) preserves the current name/mode/time instead of resetting them.
function readExisting(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

// Stored values stay in v1's "9 PM" format (the engine parses them);
// the chips display the design's "9:00 PM" label.
const TIME_OPTIONS = [
  { store: '8 PM',    label: '8:00 PM' },
  { store: '9 PM',    label: '9:00 PM' },
  { store: '10 PM',   label: '10:00 PM' },
  { store: 'Sunrise', label: 'Sunrise' },
];

const PROMISES = [
  {
    id: 'medical',
    head: 'Ori is not a medical tool.',
    body: "It's a private journal that listens — never a diagnosis, prescription, or mental-health assessment.",
  },
  {
    id: 'sources',
    head: 'Only what I share is read.',
    body: 'My words, and the signals I connect. Nothing is scraped or guessed about me.',
  },
  // The data-flow promise (where the words go to write the Letter) was removed
  // from onboarding by request — that disclosure lives in Settings → Privacy and
  // in the reflect flow's point-of-use consent card. We deliberately do NOT
  // replace it with a "stays on this device" line: words ARE sent to AI to write
  // the Letter, so an implied-local claim here would be dishonest.
];

// One optional, opt-in choice — deliberately separate from the promises so it is
// never a gate (GDPR Art. 9 consent must be freely given). Acknowledging it
// pre-grants the reflect/distress consent; skipping it simply defers that ask to
// the first time the user reflects on a part (the reflect flow asks then).
const CHOICES = [
  {
    id: 'distress',
    head: 'Notice when things feel heavy.',
    body: 'When I reflect on a part, Ori can send what I write to its AI model to mirror it back, look for signs of distress, and offer support resources. This one is my choice — I can turn it on here, turn it off anytime, or wait until the first time I reflect.',
  },
];

function persist(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — onboarding still completes; engine treats
    // missing values as defaults.
  }
}

function ouraConnected() {
  try {
    return Boolean(localStorage.getItem(OURA_ACCESS_KEY));
  } catch {
    return false;
  }
}

// "Sam's evenings" → "Sam" for the all-set salutation.
function firstNameFrom(name) {
  const m = name.trim().match(/^(.+?)['’]s\s+evenings$/i);
  return m ? m[1] : name.trim();
}

function timeLabel(store) {
  return TIME_OPTIONS.find((t) => t.store === store)?.label || store;
}

function IconLeaf() {
  return (
    <svg viewBox="0 0 120 120" width="34" height="34" fill="none" stroke="var(--forest)" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M59 16 C 40 44, 36 78, 50 106 C 74 82, 82 46, 59 16 Z" />
      <path d="M50 106 C 54 74, 56 44, 59 16" />
    </svg>
  );
}
function IconCheckBig() {
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="var(--sage)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12.5l5 5 11-11" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--forest)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function IconJournal() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--sage)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M16 4v4h3" />
    </svg>
  );
}
function IconOura() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#b16a18" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" fill="#b16a18" />
    </svg>
  );
}
function IconAppleHealth() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="#e63946" stroke="none" aria-hidden="true">
      <path d="M12 21s-7-4.35-7-10a4.5 4.5 0 0 1 8-2.83A4.5 4.5 0 0 1 21 11c0 5.65-9 10-9 10z" />
    </svg>
  );
}
function IconAckCheck() {
  return (
    <svg className="chk" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9.5l4 4L15 5" />
    </svg>
  );
}

export default function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(() => readExisting(GARDEN_NAME_KEY));
  const [mode, setMode] = useState(() => readExisting(MODE_KEY) || 'full');
  const [time, setTime] = useState(() => readExisting(REFLECT_TIME_KEY) || '9 PM');
  const [acked, setAcked] = useState(() => new Set());

  // Live connection state — the connect scene links Oura / Apple Health right
  // here (not "later in Settings"), so these reflect the real grant.
  const [ouraLive, setOuraLive] = useState(() => ouraConnected());
  const [ahLive, setAhLive] = useState(() => appleHealthGranted());
  const [ahBusy, setAhBusy] = useState(false);
  const [connectNote, setConnectNote] = useState('');
  const [connectAdvancing, setConnectAdvancing] = useState(false);
  // The finish screen offers an optional "quick tour" — the mode-aware How Ori
  // Works deck, shown right after they've chosen Reflect/Full so it matches.
  const [showTour, setShowTour] = useState(false);

  // Re-read after an OAuth round-trip. On iOS, Oura returns via the system
  // browser sheet → Shell's appUrlOpen listener stores tokens and runs the
  // first sync, firing cpi:wearable-synced; we just refresh the badge here.
  useEffect(() => {
    const refresh = () => {
      setOuraLive(ouraConnected());
      setAhLive(appleHealthGranted());
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('cpi:wearable-synced', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('cpi:wearable-synced', refresh);
    };
  }, []);

  const handleConnectOura = () => {
    if (ouraLive) return;
    // iOS opens a browser sheet (app stays mounted, onboarding is preserved);
    // web does a same-window redirect back to this page.
    if (isNativeIOS()) startOuraConnectNative();
    else startOuraConnect();
  };

  const handleConnectAppleHealth = async () => {
    if (ahLive || ahBusy) return;
    setAhBusy(true);
    setConnectNote('');
    try {
      const res = await connectAppleHealth();
      if (res?.ok) {
        setAhLive(true);
        setConnectNote(res.days ? `Apple Health connected — ${res.days} days read.` : 'Apple Health connected.');
      } else {
        setConnectNote(res?.error || 'Couldn’t connect Apple Health.');
      }
    } catch (e) {
      setConnectNote(e?.message || 'Couldn’t connect Apple Health.');
    }
    setAhBusy(false);
  };

  // The connect scene only appears in Full mode (design's onboard-3b).
  const scenes = mode === 'full'
    ? ['welcome', 'name', 'mode', 'connect', 'time', 'promises', 'ready']
    : ['welcome', 'name', 'mode', 'time', 'promises', 'ready'];
  const scene = scenes[Math.min(step, scenes.length - 1)];

  // Five progress pips per the design; mode + connect share the third.
  const PIP_OF = { welcome: 0, name: 1, mode: 2, connect: 2, time: 3, promises: 4 };
  const pip = PIP_OF[scene];

  const goNext = () => setStep((s) => Math.min(s + 1, scenes.length - 1));
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  // Apple 5.1.1(iv): the connect scene is the custom message that precedes the
  // iOS Health permission, so its forward button must LEAD TO the permission
  // request — never skip past it (Apple re-rejected "Continue" advancing with no
  // prompt). On iOS, if no source is connected yet, "Continue" fires the Health
  // permission sheet, then advances once it resolves (grant or deny — the user's
  // real choice is made in the system prompt, exactly as Apple intends). If a
  // source is already connected (Oura via its OAuth tap, or Health), or we're not
  // on iOS, it just advances — no forced/duplicate prompt for Oura users.
  const handleConnectNext = async () => {
    if (appleHealthAvailable() && !ahLive && !ouraLive) {
      setConnectAdvancing(true);
      try { await handleConnectAppleHealth(); } catch { /* sheet dismissed */ }
      setConnectAdvancing(false);
    }
    goNext();
  };

  const persistProfile = () => {
    persist(GARDEN_NAME_KEY,  name.trim() || 'My evenings');
    persist(REFLECT_TIME_KEY, time);
    persist(MODE_KEY,         mode);
    persist(WELCOME_DONE_KEY, '1');
    // The optional distress opt-in is the informed consent the reflect/distress
    // flow relies on; record it only if the user chose it, so an un-opted user
    // is asked at point of use instead. The required promises grant nothing —
    // writing the Letter runs under service-necessity, not this consent.
    if (acked.has('distress')) grantDataConsent();
  };

  const handleFinish = () => {
    persistProfile();
    onDone?.();
  };

  const toggleAck = (id) => {
    setAcked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Only the required promises gate advancing; the optional opt-in never does.
  const reqAcked = PROMISES.filter((p) => acked.has(p.id)).length;

  const canAdvance = (() => {
    if (scene === 'name') return name.trim().length > 0;
    if (scene === 'promises') return reqAcked === PROMISES.length;
    return true;
  })();

  const ctaLabel = (() => {
    if (scene === 'welcome') return 'Begin';
    // Apple 5.1.1 (HealthKit): the connect scene precedes the iOS Health
    // permission, so its forward button is a neutral "Continue" — never a
    // "Later"/skip exit — and (see handleConnectNext) it LEADS TO the permission
    // request: on iOS with nothing connected yet, Continue fires the Health
    // sheet before advancing. (Opting out of wearables happens earlier, at the
    // mode step.) Tapping a source directly also goes straight to the iOS sheet.
    if (scene === 'connect') return 'Continue';
    if (scene === 'time') return time === 'Sunrise' ? 'Set Sunrise' : `Set ${timeLabel(time)}`;
    if (scene === 'promises') {
      if (reqAcked === 0) return 'Tap each to acknowledge';
      if (reqAcked < PROMISES.length) return `Acknowledged ${reqAcked} of ${PROMISES.length}`;
      return 'Continue';
    }
    return 'Continue';
  })();

  // Optional tour overlay from the finish screen. Pass the chosen mode (cpi_mode
  // isn't persisted until "Begin") so the rings shown match what they picked.
  if (showTour) {
    return <HowItWorks mode={mode} backLabel="Back" onBack={() => setShowTour(false)} />;
  }

  return (
    <section className="v2-ob">
      {scene !== 'ready' && (
        <div className="v2-ob-prog" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} className={i === pip ? 'on' : ''} />
          ))}
        </div>
      )}

      <div className="v2-ob-body">
        {scene === 'welcome' && (
          <>
            <div className="v2-ob-mark">
              <span className="a1" />
              <span className="a2" />
              <span className="core"><IconLeaf /></span>
            </div>
            <h1 className="v2-ob-title">A letter to yourself,<br />every evening.</h1>
            <p className="v2-ob-sub">
              Talk or write through your day. Ori reads it back to you at night — gently, and only from what you share.
            </p>
          </>
        )}

        {scene === 'name' && (
          <>
            <p className="v2-ob-eyebrow">A private place</p>
            <h1 className="v2-ob-title">What do you prefer<br />to be called?</h1>
            <p className="v2-ob-sub">It's just for you — the name you'll see each night.</p>
            <input
              type="text"
              className="v2-ob-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Moss"
              autoFocus
            />
          </>
        )}

        {scene === 'mode' && (
          <>
            <h1 className="v2-ob-title sm">Where should Ori<br />read from?</h1>
            <p className="v2-ob-sub">You can change this anytime. It decides how much body data colours your readings.</p>
            <div className="v2-ob-modes">
              <button
                type="button"
                className={`v2-ob-mode${mode === 'full' ? ' on' : ''}`}
                onClick={() => setMode('full')}
                aria-pressed={mode === 'full'}
              >
                <span className="v2-ob-mode-head">
                  <span className="v2-ob-mode-ic"><IconClock /></span>
                  <span className="v2-ob-mode-h">Connect a wearable</span>
                  <span className="v2-ob-mode-tag">Full</span>
                </span>
                <span className="v2-ob-mode-p">Oura or Apple Health. Your rings lean on sleep, heart rate and recovery — the richest reading.</span>
              </button>
              <button
                type="button"
                className={`v2-ob-mode${mode === 'reflect' ? ' on' : ''}`}
                onClick={() => setMode('reflect')}
                aria-pressed={mode === 'reflect'}
              >
                <span className="v2-ob-mode-head">
                  <span className="v2-ob-mode-ic sage"><IconJournal /></span>
                  <span className="v2-ob-mode-h">Just words, for now</span>
                  <span className="v2-ob-mode-tag sage">Reflect</span>
                </span>
                <span className="v2-ob-mode-p">No wearable. Ori reads your words and a couple of things you tell it. Rings are lighter — never guessed.</span>
              </button>
            </div>
          </>
        )}

        {scene === 'connect' && (
          <>
            <p className="v2-ob-eyebrow">Sources</p>
            <h1 className="v2-ob-title sm">Let's connect<br />your body data.</h1>
            <p className="v2-ob-sub">It links and syncs right here — your rings start with real readings, not guesses.</p>
            <div className="v2-ob-modes">
              <button
                type="button"
                className={`v2-ob-mode${ouraLive ? ' on' : ''}`}
                onClick={handleConnectOura}
                disabled={ouraLive}
                aria-pressed={ouraLive}
              >
                <span className="v2-ob-mode-head">
                  <span className="v2-ob-mode-ic oura"><IconOura /></span>
                  <span className="v2-ob-mode-h">Oura Ring</span>
                  <span className={`v2-ob-mode-status${ouraLive ? ' connected' : ''}`}>
                    {ouraLive ? 'Connected' : 'Set up'}
                  </span>
                </span>
                <span className="v2-ob-mode-p">Opens Oura to sign in, then pulls sleep, heart rhythm, resting heart rate and daily stress.</span>
              </button>
              <button
                type="button"
                className={`v2-ob-mode${ahLive ? ' on' : ''}`}
                onClick={handleConnectAppleHealth}
                disabled={ahLive || ahBusy || !appleHealthAvailable()}
                aria-pressed={ahLive}
              >
                <span className="v2-ob-mode-head">
                  <span className="v2-ob-mode-ic apple"><IconAppleHealth /></span>
                  <span className="v2-ob-mode-h">Apple Health</span>
                  <span className={`v2-ob-mode-status${ahLive ? ' connected' : ''}`}>
                    {ahLive ? 'Connected' : ahBusy ? 'Syncing…' : appleHealthAvailable() ? 'Set up' : 'iOS app'}
                  </span>
                </span>
                <span className="v2-ob-mode-p">
                  {appleHealthAvailable()
                    ? 'Syncs straight from this iPhone — sleep, heart, activity. Stays on your device; only a daily summary travels with your letter.'
                    : 'Available in the iOS app — connect there for sleep, heart and activity.'}
                </span>
              </button>
            </div>
            {connectNote && <p className="v2-ob-connect-note" role="status">{connectNote}</p>}
          </>
        )}

        {scene === 'time' && (
          <>
            <p className="v2-ob-eyebrow">Wind-up time</p>
            <h1 className="v2-ob-title">When should your<br />letter arrive?</h1>
            <p className="v2-ob-sub">Ori composes once a day, after your evening has settled.</p>
            <div className="v2-ob-chips">
              {TIME_OPTIONS.map((t) => (
                <button
                  key={t.store}
                  type="button"
                  className={`v2-ob-chip${time === t.store ? ' on' : ''}`}
                  onClick={() => setTime(t.store)}
                  aria-pressed={time === t.store}
                >{t.label}</button>
              ))}
            </div>
          </>
        )}

        {scene === 'promises' && (
          <>
            <h1 className="v2-ob-title sm">Two promises<br />before we begin</h1>
            <p className="v2-ob-sub">Take a moment with each. Tap to acknowledge.</p>
            <div className="v2-ob-acks">
              {PROMISES.map((p, i) => {
                const on = acked.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`v2-ob-ack${on ? ' on' : ''}`}
                    onClick={() => toggleAck(p.id)}
                    aria-pressed={on}
                  >
                    <span className="v2-ob-ack-num">
                      <span className="num">{i + 1}</span>
                      <IconAckCheck />
                    </span>
                    <span className="v2-ob-ack-tx">
                      <span className="v2-ob-ack-h">{p.head}</span>
                      <span className="v2-ob-ack-p">{p.body}</span>
                    </span>
                  </button>
                );
              })}

              {/* One optional opt-in — visually set apart, never required to continue. */}
              <p className="v2-ob-acks-opt-label">Optional — your choice</p>
              {CHOICES.map((c) => {
                const on = acked.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`v2-ob-ack optional${on ? ' on' : ''}`}
                    onClick={() => toggleAck(c.id)}
                    aria-pressed={on}
                  >
                    <span className="v2-ob-ack-num">
                      <span className="num">+</span>
                      <IconAckCheck />
                    </span>
                    <span className="v2-ob-ack-tx">
                      <span className="v2-ob-ack-h">{c.head}</span>
                      <span className="v2-ob-ack-p">{c.body}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {scene === 'ready' && (
          <>
            <div className="v2-ob-mark">
              <span className="a1" />
              <span className="a2" />
              <span className="core"><IconCheckBig /></span>
            </div>
            <h1 className="v2-ob-title">
              You're all set{firstNameFrom(name) ? <>,<br />{firstNameFrom(name)}</> : ''}
            </h1>
            <p className="v2-ob-sub">
              Tonight, around <b>{timeLabel(time)}</b>, your first letter will land. Until then — your home is waiting.
            </p>
          </>
        )}
      </div>

      <div className="v2-ob-foot">
        {scene === 'ready' ? (
          <>
            <button type="button" className="v2-ob-pill" onClick={handleFinish}>
              Begin
            </button>
            <button type="button" className="v2-ob-ghostlink" onClick={() => setShowTour(true)}>
              Take a quick tour first
            </button>
          </>
        ) : (
          <button
            type="button"
            className="v2-ob-pill"
            onClick={scene === 'connect' ? handleConnectNext : goNext}
            disabled={!canAdvance || connectAdvancing}
          >
            {ctaLabel}
            {scene === 'promises' && (
              <span className="v2-ob-pips" aria-hidden="true">
                {PROMISES.map((p, i) => (
                  <i key={p.id} className={i < reqAcked ? 'on' : ''} />
                ))}
              </span>
            )}
          </button>
        )}
        {step > 0 && scene !== 'ready' && (
          <button type="button" className="v2-ob-ghostlink" onClick={goBack}>Back</button>
        )}
      </div>
    </section>
  );
}
