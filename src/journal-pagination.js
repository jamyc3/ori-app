// Pure logic for the Journal "Living Book" pager.
//
// buildPages(mergedEntries, todayISO, { datesPerPage = 10 } = {})
//   → { pages: PageDescriptor[], indexOfCurrentMonth: number }
//
// PageDescriptor shapes:
//   { kind: "month-first",    year, month, pageOfMonth, totalPagesOfMonth,
//     dateGroupsOnThisPage: [{ date, entries[] }], entriesOnThisPage,
//     monthAllEntries, monthTotalEntries }
//   { kind: "month-continue", ...same shape as month-first }
//   { kind: "volunteer-first",    pageOfVolunteer, totalPagesOfVolunteer, entriesOnThisPage }
//   { kind: "volunteer-continue", ...same shape }
//
// Pagination is now PER-DATE for month pages: a date with N entries renders
// as a single date-group / bucket and counts as one unit toward datesPerPage.
// Volunteer pages stay per-entry (no dates to group by).
//
// Ordering: current month first → oldest month last → volunteer pages last.
// Future-dated entries are excluded outright (the journal is for what's happened).
// indexOfCurrentMonth is the page index of "today's" month's page-1. If there
//   are zero entries for the current month, a single empty month-first page is
//   still produced and indexOfCurrentMonth points to it.

function parseYmd(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m: m - 1, d };
}

function ymdGT(a, b) { return a > b; } // string compare works for ISO YYYY-MM-DD

export function buildPages(mergedEntries, todayISO, opts = {}) {
  // Accept the legacy `entriesPerPage` name too — older callers/tests passed
  // it before pagination switched to per-date. Both map to the same slice
  // size; per-date semantics apply regardless.
  const perPage = opts.datesPerPage != null ? opts.datesPerPage
    : opts.entriesPerPage != null ? opts.entriesPerPage
    : 10;

  const today = parseYmd(todayISO);
  const currentY = today.y;
  const currentM = today.m;

  // Partition: dated past/today entries vs undated
  const undated = [];
  const datedByMonth = new Map(); // key "YYYY-MM" → entries[]
  for (const e of mergedEntries) {
    if (!e) continue;
    if (!e.date) { undated.push(e); continue; }
    if (ymdGT(e.date, todayISO)) continue; // future-dated entries excluded
    const key = e.date.slice(0, 7);
    if (!datedByMonth.has(key)) datedByMonth.set(key, []);
    datedByMonth.get(key).push(e);
  }

  // Ensure the current month always has an entry list (even if empty)
  const currentKey = `${currentY}-${String(currentM + 1).padStart(2, "0")}`;
  if (!datedByMonth.has(currentKey)) datedByMonth.set(currentKey, []);

  // Sort months newest → oldest
  const sortedMonths = Array.from(datedByMonth.keys()).sort((a, b) => b.localeCompare(a));

  const pages = [];
  let indexOfCurrentMonth = 0;

  for (const key of sortedMonths) {
    const [y, mPlus1] = key.split("-").map(Number);
    const monthIdx = mPlus1 - 1;
    // Sort entries within the month by date desc; same-date entries stay in
    // their incoming relative order so the Day view shows them in input order.
    const monthEntries = [...datedByMonth.get(key)].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    // Group entries by date (newest date first). Same-date entries cluster.
    const dateGroups = [];
    let cur = null;
    for (const e of monthEntries) {
      if (!cur || cur.date !== e.date) {
        cur = { date: e.date, entries: [] };
        dateGroups.push(cur);
      }
      cur.entries.push(e);
    }

    const totalPagesOfMonth = Math.max(1, Math.ceil(dateGroups.length / perPage));
    for (let p = 0; p < totalPagesOfMonth; p++) {
      const groupSlice = dateGroups.slice(p * perPage, (p + 1) * perPage);
      const flatSlice = groupSlice.flatMap(g => g.entries);
      const pageDesc = {
        kind: p === 0 ? "month-first" : "month-continue",
        year: y,
        month: monthIdx,
        pageOfMonth: p + 1,
        totalPagesOfMonth,
        dateGroupsOnThisPage: groupSlice,
        entriesOnThisPage: flatSlice,
        monthAllEntries: monthEntries,
        monthTotalEntries: monthEntries.length,
      };
      if (key === currentKey && p === 0) indexOfCurrentMonth = pages.length;
      pages.push(pageDesc);
    }
  }

  // Volunteer pages at the very end. Undated entries can't be grouped by
  // date, so these stay paginated per-entry.
  if (undated.length > 0) {
    const totalPagesOfVolunteer = Math.max(1, Math.ceil(undated.length / perPage));
    for (let p = 0; p < totalPagesOfVolunteer; p++) {
      const slice = undated.slice(p * perPage, (p + 1) * perPage);
      pages.push({
        kind: p === 0 ? "volunteer-first" : "volunteer-continue",
        pageOfVolunteer: p + 1,
        totalPagesOfVolunteer,
        entriesOnThisPage: slice,
      });
    }
  }

  return { pages, indexOfCurrentMonth };
}
