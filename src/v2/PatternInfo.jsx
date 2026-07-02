// Ori v2 — Pattern lens explainers.
//
// Tapping any Patterns tile opens this sheet: a plain-language account of how
// that lens is formed — what it reads, how the reading is made, and how to
// read the widget. It reuses the provenance sheet's styling and keeps the
// same discipline: only the user's own history, named sources, no clinical
// claims. The copy here is the single place each lens's "how it's made" lives,
// so the six tiles never explain themselves differently per screen.

import { useRef } from 'react';
import { createPortal } from 'react-dom';
import './styles/provenance.css';
import { useModalA11y } from './useModalA11y.js';

export const LENS_EXPLAINERS = {
  streaks: {
    title: 'Streaks',
    src: 'from your own days',
    how: [
      'The number is how many days in a row you’ve written, ending today. The grid is the last four weeks — a lit square is a day you showed up.',
      'It only ever looks at whether an entry exists that day. Not what you wrote, no read of the day — just the rhythm of returning.',
    ],
  },
  rhythms: {
    title: 'Rhythms',
    src: 'your days, sorted by weekday',
    how: [
      'Each bar is one weekday. Ori averages your daily read across every Monday, every Tuesday, and so on, then lights the weekday that usually sits highest for you.',
      'It needs a couple of weeks before the shape means anything — so it says “calibrating” until each weekday has been seen enough times.',
    ],
  },
  weather: {
    title: 'Weather',
    src: 'from your writing and check-ins',
    how: [
      'Every dot is one recent day — placed left-to-right by the mood your words carried, and bottom-to-top by your energy. The bright dot is today.',
      'Where the dots gather is the weather you’ve been living in lately. It’s not a forecast — just where your days have actually sat.',
    ],
  },
  returns: {
    title: 'Returns',
    src: 'from your letters this month',
    how: [
      'Ori counts which of your parts keep coming forward across this month’s letters, and names the one that returns most — with how many days it showed up.',
      'The small bar is the friction tone that recurs most alongside it. A part has to genuinely keep returning before it’s named here.',
    ],
  },
  drifts: {
    title: 'Drifts',
    src: 'from your wearable nights',
    how: [
      'The slow give-and-take in your sleep: hours of debt or surplus building against your own recent usual, and a rough estimate of how long until you’re back to normal.',
      'It reads only your own nights — the one thing your sleep is ever compared to is your own usual.',
    ],
  },
  threads: {
    title: 'Threads',
    src: 'across several of your days',
    how: [
      'A storyline Ori has followed across more than one day — a theme that kept surfacing — shown with the actual days that evidence it.',
      'If nothing has carried across days yet, it stays quiet rather than inventing a throughline.',
    ],
  },
  highlights: {
    title: 'Highlights',
    src: 'two real days from your weeks',
    how: [
      'Ori points back at the single brightest day and the single heaviest one across your recent weeks — chosen only by how each day read for you, nothing else.',
      'No score is shown and no claim is made about why. They’re just two days worth re-reading. It stays quiet until there’s a real spread of days to choose between.',
    ],
  },
};

export function LensExplainer({ lens, onClose }) {
  const data = LENS_EXPLAINERS[lens];

  // Escape-to-close + focus move-in / restore-on-close.
  const dialogRef = useRef(null);
  useModalA11y(Boolean(data), onClose, dialogRef);

  if (!data) return null;

  return createPortal(
    <div className="v2-prov-scrim" onClick={onClose} role="presentation">
      <div
        className="v2-prov-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`How ${data.title} is read`}
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="v2-prov-grab" aria-hidden="true" />
        <div className="v2-prov-eyebrow-head">How this lens is read</div>
        <h2 className="v2-prov-head">{data.title}</h2>
        <div className="v2-prov-row">
          <div className="v2-prov-body">
            <div className="v2-prov-src">{data.src}</div>
            {data.how.map((p, i) => (
              <p key={i} className="v2-prov-how">{p}</p>
            ))}
          </div>
        </div>
        <div className="v2-prov-foot">
          Every lens reads only your own history — and says “calibrating” until it has enough of it.
        </div>
        <button type="button" className="v2-prov-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default LensExplainer;
