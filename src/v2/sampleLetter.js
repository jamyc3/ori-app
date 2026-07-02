// Ori v2 — the sample letter.
//
// New users have no letter until their first evening, so they can't see
// the product's heart: the nightly letter with its tappable parts. This
// is one crafted example, always labeled as a sample, never stored, and
// never mixed into the real journal. The part references use the real
// PARTS_LIB ids so tapping them opens the same PartDetail screen a real
// letter would.

export const SAMPLE_DATE = 'sample';

export const SAMPLE_LETTER = {
  result: {
    a: {
      letter: {
        headline: 'You kept the thread through a loud day.',
        paragraphs: [
          'You wrote tonight the way someone writes when the day has finally let go of them — short sentences, no performance. The morning belonged to the planner: three lists before nine, the calendar already argued with. It held the day together, and it cost you the slow start you said you wanted.',
          "Mid-afternoon, something softer. The walk home shows up in your words again — it keeps being the place where your shoulders drop. That was the tender one asking for ten unscheduled minutes, and for once it got them.",
          "One thing keeps returning: the review. You dreaded it for three days, and tonight you wrote that it went better than the story you told yourself. The watcher wrote that story; you're the one who noticed the gap. That noticing is the work.",
        ],
        parts: [
          { id: 'planner', volume: 'loud' },
          { id: 'tender', volume: 'present' },
          { id: 'watcher', volume: 'brief' },
        ],
      },
      insights: [],
      driverScores: {},
    },
    h: { HCPI: null },
  },
};
