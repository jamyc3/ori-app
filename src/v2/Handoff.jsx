// Ori v2 — captured / handoff confirmation (the witness moment).
//
// Shown the instant Capture/Listen saves — BEFORE any check-in. Its only job is
// to make the person feel HEARD in the moment they just set something down, not
// to confirm intake. So, deliberately:
//   · no "received" receipt language;
//   · no machinery — it used to say "I'll read it against your sleep and your
//     calendar", which is the wrong register here AND a lie in reflect mode (no
//     wearable = no sleep/calendar to read against), so it's gone;
//   · the letter timing is demoted to a quiet second line.
// The copy presumes nothing about the day — it witnesses the ACT of telling, so
// it reads right on a light night too.
//
// When today's WHO-5 isn't done yet, the screen OFFERS a quiet check-in as a
// declinable next step — never a wall between the person and being heard. The
// primary button is always the easy way home, and we don't auto-return while an
// offer is on screen (let the person choose at their own pace).

import { useEffect } from 'react';
import './styles/capture.css';

const AUTO_RETURN_MS = 6000;

// The letter time the user picked in onboarding ("9 PM", "Sunrise", …).
function letterTime() {
  try {
    return localStorage.getItem('cpi_reflect_time') || '9 PM';
  } catch {
    return '9 PM';
  }
}

function IconCheck() {
  return (
    <svg width="30" height="30" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 14.5l4.5 4.5L21 9" />
    </svg>
  );
}

export default function Handoff({ onDone, offerCheckIn = false, onCheckIn }) {
  // Auto-return only when there's nothing to decide. With a check-in on offer,
  // let the person take their time — the primary button is the easy way out.
  useEffect(() => {
    if (offerCheckIn) return undefined;
    const timer = setTimeout(() => {
      onDone?.();
    }, AUTO_RETURN_MS);
    return () => clearTimeout(timer);
  }, [offerCheckIn, onDone]);

  return (
    <div className="v2-handoff" role="dialog" aria-live="polite">
      <div className="v2-handoff-body">
        <span className="v2-handoff-check"><IconCheck /></span>
        <div>
          <h1 className="v2-handoff-title">That's down now.</h1>
          <p className="v2-handoff-sub">
            Thank you for telling me — you don't have to hold all of it tonight. Your letter comes around <b>{letterTime()}</b>.
          </p>
        </div>
      </div>
      <div className="v2-handoff-foot">
        <button type="button" className="v2-pill-btn" onClick={onDone}>
          Back to today
        </button>
        {offerCheckIn && (
          <button type="button" className="v2-handoff-secondary" onClick={onCheckIn}>
            A few quiet questions →
          </button>
        )}
      </div>
    </div>
  );
}
