// Ori v2 — "How Ori works": a calm, plain-language tour of the app, opened from
// Settings → About. Mobile-first vertical flow (not the desktop mind map), in
// the app's own voice — no technical or clinical jargon.
//
// The hero reuses the Today page's EXACT orb (aura + ring + core) so Ori looks
// like itself everywhere; only the mic is swapped for the wordmark.

import './styles/today.css'; // the .v2-orb cosmic orb (aura / ring / core)
import './styles/howitworks.css';

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4l-6 6 6 6" />
    </svg>
  );
}

// Plain, benefit-led copy — the same human language the marketing page uses.
const SECTIONS = [
  { ac: 'leaf',  eyebrow: 'Tell it your day', title: 'However it comes out',
    lines: ['Speak it or type it — whatever’s easier', 'A few gentle questions, never a quiz', 'It quietly notices your sleep and rhythm', 'No scores to chase, no streak to guard'] },
  // "A clear read" is built per-mode in the component (the rings differ): Full
  // shows Reserves · Demands · Form, Reflect shows Form only. See ringCard below.
  { ac: 'gold',  eyebrow: 'The letter', title: 'A note about your day',
    lines: ['Written from your own words, each evening', 'Like a friend who was paying attention', 'Warm and kind — never a diagnosis', 'Always yours to disagree with'] },
  { ac: 'bloom', eyebrow: 'The sides of you', title: 'Gently noticed',
    lines: ['The many voices inside a day', 'The planner, the worrier, the gentle one', 'Say a little back to any of them', 'No labels — just you, seen kindly'] },
  { ac: 'sage',  eyebrow: 'Hard choices', title: 'At your clearest hour',
    lines: ['Park a tough call for later', 'It comes back when your head is clear', 'A quick gut-check before you commit', 'And later: glad you did?'] },
  { ac: 'sky',   eyebrow: 'Over time', title: 'Your story, unfolding',
    lines: ['Every day kept in one calm place', 'The rhythms across your weeks', 'Your reflections, all in one home', 'Nothing is ever lost'] },
  { ac: 'honey', eyebrow: 'Always honest', title: 'It never overclaims',
    lines: ['Every read says where it came from', 'It never pretends to know more than it does', 'No clinical labels, ever', 'Your own sense of the day always wins'] },
  { ac: 'slate', eyebrow: 'Yours alone', title: 'Private by default',
    lines: ['Your words stay on your phone', 'Nothing sold, nothing shared', 'No accounts to make, no tracking', 'A quiet, safe place to be honest'] },
];

export default function HowItWorks({ onBack, mode, backLabel = 'Settings' }) {
  // The "clear read" section names the rings, and the rings differ by mode:
  // Full reads body + words (Reserves · Demands · Form); Reflect reads words
  // only (Form), and is honest that the other two wait for a wearable. `mode`
  // can be passed in (e.g. from onboarding, before cpi_mode is persisted);
  // otherwise we read the saved mode.
  const reflect = mode != null
    ? mode === 'reflect'
    : (() => { try { return localStorage.getItem('cpi_mode') === 'reflect'; } catch { return false; } })();
  const ringCard = reflect
    ? { ac: 'amber', eyebrow: 'A clear read', title: 'One ring, for now',
        lines: ['Form — how you feel, in your own words', 'That’s the honest extent of words alone', 'Connect a wearable to add Reserves and Demands', 'Ori never guesses what it can’t see'] }
    : { ac: 'amber', eyebrow: 'A clear read', title: 'How you’re really doing',
        lines: ['Reserves — how rested and recovered you are', 'Demands — how much the day asked of you', 'Form — how you feel, in your own words', 'And always — where each reading comes from'] };
  // Insert the ring card right after the opening "Tell it your day" section.
  const sections = [SECTIONS[0], ringCard, ...SECTIONS.slice(1)];

  return (
    <section className="v2-hiw">
      <button type="button" className="v2-backrow" onClick={onBack} aria-label="Go back">
        <IconChevronLeft />
        <span>{backLabel}</span>
      </button>

      <div className="v2-hiw-hero">
        <div className="v2-orb hiw-orb" aria-hidden="true">
          <span className="v2-orb-aura" />
          <span className="v2-orb-ring" />
          <span className="v2-orb-core"><img className="hiw-icon" src="/icon.svg" alt="Ori" /></span>
        </div>
        <h1 className="v2-hiw-h">End each day a little more <em>understood.</em></h1>
        <p className="v2-hiw-sub">
          Ori turns your own words into a short, kind letter about your day —
          every evening. Here’s how it works.
        </p>
      </div>

      <div className="v2-hiw-list">
        {sections.map((s) => (
          <div key={s.eyebrow} className="v2-hiw-card" data-accent={s.ac}>
            <div className="v2-hiw-eyebrow">{s.eyebrow}</div>
            <div className="v2-hiw-title">{s.title}</div>
            <ul>{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </div>
        ))}
      </div>

      <div className="v2-hiw-foot">Notice your day honestly, in your own words — that’s Ori.</div>
    </section>
  );
}
