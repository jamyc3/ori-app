// Ori v2 — Connected sources.
//
// The design's "Connected sources" screen: what Ori reads from, with an
// honest status pill per source. Everything is native to v2 now:
//   · Oura — web connects via same-window OAuth; iOS opens the system
//     browser sheet and returns through the app.neon.ori:// deep link.
//   · Apple Health (iOS) — HealthKit permission + delta sync in place;
//     only the ZIP-export backfill remains a classic surface (web).
//   · Calendar — .ics feeds anywhere, device calendars on iOS.

import { useState } from 'react';
import './styles/sources.css';
import { startOuraConnect, startOuraConnectNative, initialOuraSync, isNativeIOS, takeOuraOAuthError } from './ouraConnect.js';
import {
  appleHealthGranted, connectAppleHealth, syncAppleHealthNow, disconnectAppleHealth,
} from './appleHealth.js';
import {
  loadFeeds, addFeed, removeFeed, syncFeed, MAX_FEEDS,
  nativeCalendarMeta, isNativeCalendarConnected,
  connectNativeCalendar, disconnectNativeCalendar, syncNativeCalendar,
} from '../calendar.js';
import {
  OURA_ACCESS_KEY, OURA_REFRESH_KEY, OURA_EXPIRES_KEY, OURA_LAST_SYNC_KEY,
} from '../engine.js';

const APPLE_HEALTH_KEY   = 'cpi_ah_seen_at';

function readKey(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lastSyncLine() {
  try {
    const raw = localStorage.getItem(OURA_LAST_SYNC_KEY);
    if (!raw) return null;
    const t = new Date(raw);
    if (isNaN(t.getTime())) return null;
    const days = Math.floor((Date.now() - t.getTime()) / 86400000);
    if (days <= 0) return 'synced today';
    if (days === 1) return 'synced yesterday';
    return `synced ${days}d ago`;
  } catch {
    return null;
  }
}

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4l-6 6 6 6" />
    </svg>
  );
}

export default function Sources({ onBack }) {
  const [ouraOn, setOuraOn] = useState(() => Boolean(readKey(OURA_ACCESS_KEY)));
  const [ouraBusy, setOuraBusy] = useState(false);
  const [ouraNote, setOuraNote] = useState(() => {
    const err = takeOuraOAuthError();
    return err
      ? `Last Oura connection didn't finish (${err}). Tap to try again.`
      : '';
  });
  const [feeds, setFeeds] = useState(() => loadFeeds());
  const [feedOpen, setFeedOpen] = useState(false);
  const [feedLabel, setFeedLabel] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [feedCat, setFeedCat] = useState('work');
  const [feedNote, setFeedNote] = useState('');
  const ahOn = Boolean(readKey(APPLE_HEALTH_KEY));
  const ouraSync = lastSyncLine();
  const [ahGranted, setAhGranted] = useState(() => appleHealthGranted());
  const [ahBusy, setAhBusy] = useState(false);
  const [ahNote, setAhNote] = useState('');

  const handleAhConnect = async () => {
    if (ahBusy) return;
    setAhBusy(true);
    setAhNote('Asking iOS for Health access…');
    try {
      const r = await connectAppleHealth();
      setAhGranted(appleHealthGranted());
      setAhNote(r.ok
        ? `Connected — ${r.days} day${r.days === 1 ? '' : 's'} read. Data stays on this device.`
        : (r.error || "Couldn't connect Health."));
    } finally {
      setAhBusy(false);
    }
  };

  const handleAhSyncNow = async () => {
    if (ahBusy) return;
    setAhBusy(true);
    setAhNote('Reading recent days…');
    try {
      const r = await syncAppleHealthNow();
      setAhNote(r.ok
        ? `Done — ${r.days} day${r.days === 1 ? '' : 's'} read.`
        : (r.error || "Health didn't answer."));
    } finally {
      setAhBusy(false);
    }
  };

  const handleAhDisconnect = () => {
    const ok = window.confirm('Stop reading Apple Health? Days already merged stay — you can delete them in Export & privacy.');
    if (!ok) return;
    disconnectAppleHealth();
    setAhGranted(false);
    setAhNote('Disconnected. iOS keeps the underlying permission — manage it in the Health app.');
  };

  const openClassic = () => {
    window.location.assign('/?skin=v1#integrations');
  };

  // ── Oura: native manage ────────────────────────────────────────
  const handleOuraSyncNow = async () => {
    const token = readKey(OURA_ACCESS_KEY);
    if (!token || ouraBusy) return;
    setOuraBusy(true);
    setOuraNote('Syncing your nights…');
    try {
      const merged = await initialOuraSync(token);
      const total = merged ? Object.keys(merged).length : 0;
      setOuraNote(total > 0
        ? `Done — ${total} night${total === 1 ? '' : 's'} on this device now.`
        : "Oura answered but sent no nights — check the ring has synced to Oura's own app first.");
    } catch {
      setOuraNote("Couldn't reach Oura just now — it will retry on its own.");
    } finally {
      setOuraBusy(false);
    }
  };

  const handleOuraDisconnect = () => {
    const ok = window.confirm(
      'Disconnect Oura? New nights stop syncing. The history already here stays — you can delete it in Export & privacy.'
    );
    if (!ok) return;
    try {
      localStorage.removeItem(OURA_ACCESS_KEY);
      localStorage.removeItem(OURA_REFRESH_KEY);
      localStorage.removeItem(OURA_EXPIRES_KEY);
    } catch { /* storage unavailable */ }
    setOuraOn(false);
    setOuraNote('Disconnected. Your synced history stays on this device.');
  };

  // ── Calendar feeds: native add / remove / sync ─────────────────
  const handleAddFeed = async () => {
    // Apple's public-calendar links come as webcal://; the server fetches over
    // https, so normalise it here (a no-op for https / Google .ics links).
    const url = feedUrl.trim().replace(/^webcal:\/\//i, 'https://');
    if (!url) return;
    try {
      const feed = addFeed({ label: feedLabel.trim() || 'Calendar', category: feedCat, url });
      setFeeds(loadFeeds());
      setFeedLabel('');
      setFeedUrl('');
      setFeedOpen(false);
      setFeedNote('Added — fetching events…');
      try {
        await syncFeed(feed.id);
        setFeedNote('Feed connected and synced.');
      } catch {
        setFeedNote("Saved, but the feed didn't answer yet — it will retry.");
      }
      setFeeds(loadFeeds());
    } catch (e) {
      setFeedNote(e?.message || 'Could not save that feed.');
    }
  };

  const handleRemoveFeed = (id) => {
    removeFeed(id);
    setFeeds(loadFeeds());
    setFeedNote('Feed removed.');
  };

  // ── Apple Calendar (iOS): native connect / sync / disconnect ───
  const [nativeCal, setNativeCal] = useState(() => nativeCalendarMeta());
  const [nativeCalBusy, setNativeCalBusy] = useState(false);
  const [nativeCalNote, setNativeCalNote] = useState('');

  const handleNativeCalConnect = async () => {
    if (nativeCalBusy) return;
    setNativeCalBusy(true);
    setNativeCalNote('Asking iOS for calendar access…');
    try {
      const r = await connectNativeCalendar('work');
      setNativeCal(nativeCalendarMeta());
      if (r.ok) {
        setNativeCalNote(`Connected — ${r.count} event${r.count === 1 ? '' : 's'} in view. Only counts and durations are read; titles never leave the device.`);
        window.dispatchEvent(new Event('cpi:calendar-synced'));
      } else {
        setNativeCalNote(r.error || "Couldn't connect the calendar.");
      }
    } finally {
      setNativeCalBusy(false);
    }
  };

  const handleNativeCalSync = async () => {
    if (nativeCalBusy) return;
    setNativeCalBusy(true);
    setNativeCalNote('Reading your calendar…');
    try {
      const r = await syncNativeCalendar();
      setNativeCal(nativeCalendarMeta());
      if (r.ok) {
        setNativeCalNote(`Done — ${r.count} event${r.count === 1 ? '' : 's'} in view.`);
        window.dispatchEvent(new Event('cpi:calendar-synced'));
      } else {
        setNativeCalNote(r.error || "The calendar didn't answer.");
      }
    } finally {
      setNativeCalBusy(false);
    }
  };

  const handleNativeCalDisconnect = () => {
    const ok = window.confirm('Disconnect Apple Calendar? Meeting-load signals stop reading from this device.');
    if (!ok) return;
    disconnectNativeCalendar();
    setNativeCal(null);
    setNativeCalNote('Disconnected.');
    window.dispatchEvent(new Event('cpi:calendar-synced'));
  };

  return (
    <section className="v2-src">
      <button type="button" className="v2-backrow" onClick={onBack} aria-label="Back to Settings">
        <IconChevronLeft />
        <span>Settings</span>
      </button>

      <h1 className="v2-src-title">Connected sources</h1>
      <p className="v2-src-sub">
        What Ori reads from, so your numbers stay measured — not guessed. Disconnect anything, anytime.
      </p>

      {/* ── Oura ── */}
      <div className="v2-src-group">
        {ouraOn ? (
          <>
            <div className="v2-src-row static">
              <span className="v2-src-tx">
                <span className="v2-src-l">Oura Ring</span>
                <span className="v2-src-s">
                  Sleep, resting heart rate, heart rhythm, daytime stress.{ouraSync ? ` Last ${ouraSync}.` : ''}
                </span>
              </span>
              <span className="v2-src-status connected">Connected</span>
            </div>
            <div className="v2-src-row static">
              <span className="v2-src-del">
                <button type="button" className="v2-src-mini" onClick={handleOuraSyncNow} disabled={ouraBusy}>
                  {ouraBusy ? 'Syncing…' : 'Sync now'}
                </button>
                <button type="button" className="v2-src-mini clay" onClick={handleOuraDisconnect}>
                  Disconnect
                </button>
              </span>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="v2-src-row"
            onClick={isNativeIOS() ? startOuraConnectNative : startOuraConnect}
          >
            <span className="v2-src-tx">
              <span className="v2-src-l">Oura Ring</span>
              <span className="v2-src-s">Sleep, resting heart rate, heart rhythm, daytime stress. Tap to connect.</span>
            </span>
            <span className="v2-src-status">Not connected</span>
          </button>
        )}
        {ouraNote && <p className="v2-src-foot" role="status">{ouraNote}</p>}
      </div>

      {/* ── Apple Health — native on iOS; classic keeps the ZIP import ── */}
      <div className="v2-src-group">
        {isNativeIOS() ? (
          ahGranted ? (
            <>
              <div className="v2-src-row static">
                <span className="v2-src-tx">
                  <span className="v2-src-l">Apple Health</span>
                  <span className="v2-src-s">Sleep, heart, activity — read on this device. Only a daily summary travels with your letter.</span>
                </span>
                <span className="v2-src-status connected">Connected</span>
              </div>
              <div className="v2-src-row static">
                <span className="v2-src-del">
                  <button type="button" className="v2-src-mini" onClick={handleAhSyncNow} disabled={ahBusy}>
                    {ahBusy ? 'Syncing…' : 'Sync now'}
                  </button>
                  <button type="button" className="v2-src-mini clay" onClick={handleAhDisconnect}>
                    Disconnect
                  </button>
                </span>
              </div>
            </>
          ) : (
            <button type="button" className="v2-src-row" onClick={handleAhConnect} disabled={ahBusy}>
              <span className="v2-src-tx">
                <span className="v2-src-l">Apple Health</span>
                <span className="v2-src-s">Sleep, heart, activity from this iPhone. Tap to set up.</span>
              </span>
              <span className="v2-src-status">{ahBusy ? 'Connecting…' : 'Not connected'}</span>
            </button>
          )
        ) : (
          <button type="button" className="v2-src-row" onClick={openClassic}>
            <span className="v2-src-tx">
              <span className="v2-src-l">Apple Health</span>
              <span className="v2-src-s">On the web, import a Health export file — that flow lives in classic.</span>
            </span>
            <span className={`v2-src-status${(ahGranted || ahOn) ? ' connected' : ''}`}>
              {(ahGranted || ahOn) ? 'Connected' : 'Not connected'}
            </span>
          </button>
        )}
        {ahNote && <p className="v2-src-foot" role="status">{ahNote}</p>}
      </div>

      {/* ── Calendar feeds ── */}
      <div className="v2-src-eyebrow">Calendar</div>
      <div className="v2-src-group">
        {/* Apple Calendar — native device calendars, iOS app only. */}
        {isNativeIOS() && (
          isNativeCalendarConnected() && nativeCal ? (
            <>
              <div className="v2-src-row static">
                <span className="v2-src-tx">
                  <span className="v2-src-l">Apple Calendar</span>
                  <span className="v2-src-s">
                    This device&apos;s calendars · counts and durations only, titles never stored
                  </span>
                </span>
                <span className="v2-src-status connected">Connected</span>
              </div>
              <div className="v2-src-row static">
                <span className="v2-src-del">
                  <button type="button" className="v2-src-mini" onClick={handleNativeCalSync} disabled={nativeCalBusy}>
                    {nativeCalBusy ? 'Syncing…' : 'Sync now'}
                  </button>
                  <button type="button" className="v2-src-mini clay" onClick={handleNativeCalDisconnect}>
                    Disconnect
                  </button>
                </span>
              </div>
            </>
          ) : (
            <button type="button" className="v2-src-row" onClick={handleNativeCalConnect} disabled={nativeCalBusy}>
              <span className="v2-src-tx">
                <span className="v2-src-l">Apple Calendar</span>
                <span className="v2-src-s">Meeting load from this device&apos;s calendars — counts and durations only, titles never stored.</span>
              </span>
              <span className="v2-src-status">{nativeCalBusy ? 'Connecting…' : 'Not connected'}</span>
            </button>
          )
        )}
        {nativeCalNote && <p className="v2-src-foot" role="status">{nativeCalNote}</p>}

        {feeds.map((f) => (
          <div key={f.id} className="v2-src-row static">
            <span className="v2-src-tx">
              <span className="v2-src-l">{f.label || 'Calendar'}</span>
              <span className="v2-src-s">
                {f.category === 'personal' ? 'Personal' : 'Work'}
                {f.lastSyncStatus === 'ok' ? ' · syncing fine' : f.lastSyncStatus === 'error' ? " · feed didn't answer" : ''}
                {' '}· titles never stored
              </span>
            </span>
            <button type="button" className="v2-src-mini" onClick={() => handleRemoveFeed(f.id)}>Remove</button>
          </div>
        ))}

        {feedOpen ? (
          <div className="v2-src-row static">
            <span className="v2-src-tx v2-src-feedform">
              <input
                type="text"
                className="v2-src-input"
                placeholder="Label — e.g. Work"
                value={feedLabel}
                onChange={(e) => setFeedLabel(e.target.value)}
              />
              <input
                type="url"
                className="v2-src-input"
                placeholder="Calendar address (.ics URL)"
                value={feedUrl}
                onChange={(e) => setFeedUrl(e.target.value)}
                autoFocus
              />
              <span className="v2-src-del">
                <button type="button" className={`v2-src-mini${feedCat === 'work' ? ' on' : ''}`} onClick={() => setFeedCat('work')}>Work</button>
                <button type="button" className={`v2-src-mini${feedCat === 'personal' ? ' on' : ''}`} onClick={() => setFeedCat('personal')}>Personal</button>
                <button type="button" className="v2-src-mini" onClick={() => setFeedOpen(false)}>Cancel</button>
                <button type="button" className="v2-src-mini on" onClick={handleAddFeed} disabled={!feedUrl.trim()}>Add</button>
              </span>

              {/* How to get the secret .ics link — shown right where you need it. */}
              <div className="v2-src-ics">
                <div className="v2-src-ics-h">Where do I find this link?</div>

                <div className="v2-src-ics-grp">
                  <div className="v2-src-ics-app">Apple Calendar · on iPhone</div>
                  <ol className="v2-src-ics-steps">
                    <li>Open <b>Calendar</b>, tap <b>Calendars</b> at the bottom.</li>
                    <li>Tap the <b>ⓘ</b> beside the calendar you want.</li>
                    <li>Turn on <b>Public Calendar</b>, then <b>Share Link → Copy</b>.</li>
                    <li>Paste it in the field above.</li>
                  </ol>
                </div>

                <div className="v2-src-ics-grp">
                  <div className="v2-src-ics-app">Google Calendar · on the web</div>
                  <ol className="v2-src-ics-steps">
                    <li>Open <b>Settings</b>, then pick your calendar.</li>
                    <li>Under <b>Integrate calendar</b>, copy the <b>Secret address in iCal format</b>.</li>
                    <li>Paste it in the field above.</li>
                  </ol>
                </div>

                <div className="v2-src-ics-note">Read-only — titles are never stored, only meeting load and context shifts.</div>
              </div>
            </span>
          </div>
        ) : (
          feeds.length < MAX_FEEDS && (
            <button type="button" className="v2-src-row" onClick={() => setFeedOpen(true)}>
              <span className="v2-src-tx">
                <span className="v2-src-l">Add a calendar</span>
                <span className="v2-src-s">Paste a secret .ics address — meeting load and context shifts, titles never stored.</span>
              </span>
              <span className="v2-src-status">Add</span>
            </button>
          )
        )}
        {feedNote && <p className="v2-src-foot" role="status">{feedNote}</p>}
      </div>

      <p className="v2-src-foot">
        Everything here writes the same keys classic uses — flip between the two and nothing is lost.
      </p>
    </section>
  );
}
