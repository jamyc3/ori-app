# Contributing to Ori

Thanks for wanting to help. Two things make this project unusual, and both
shape how contributions work.

## 1. The honesty discipline is not optional

Every number Ori shows a user maps to a labeled evidence layer (measured /
validated self-report / observed recurrence / interpretation), and
`npm run build` fails if a visible claim loses its proof. Any PR must pass
the full `npm run build` — the honesty audit and the behavioral eval suites
(crisis gating, letter honesty, acknowledgment tone) are the review bar, not
a formality. PRs that add clinical or medical claims, engagement dark
patterns, streak guilt, ad/analytics SDKs, or any off-device journal storage
will be declined regardless of code quality — these are product constitution,
not style preferences.

## 2. Licensing of contributions

Ori is licensed under PolyForm Noncommercial 1.0.0, and the maintainer
retains full commercial rights (this is what keeps the app free for
everyone). So that this remains possible:

**By submitting a contribution, you agree that:**

1. You certify the [Developer Certificate of Origin 1.1](https://developercertificate.org/)
   — that you wrote the contribution or otherwise have the right to submit
   it under this project's license. Sign your commits with
   `git commit -s` (`Signed-off-by: Your Name <you@example.com>`).
2. You grant the project maintainer a perpetual, worldwide, irrevocable,
   royalty-free license to use, modify, distribute, and **sublicense or
   relicense** your contribution as part of Ori, including under commercial
   terms. You keep the copyright to your work; this grant is what lets the
   project stay open while remaining sustainable.

If you can't agree to this, please open an issue describing the change
instead of a PR — ideas are welcome without any paperwork.

## Practical notes

- Run `npm install && npm run build` before opening a PR; a red build won't
  be reviewed.
- Keep PRs small and single-purpose. UI changes should include a screenshot.
- The v2 layout rules are locked — one gutter, no rubber-band scroll, no
  sideways pan. Read `ARCHITECTURE.md` before touching layout.
- Security issues: please use GitHub's private vulnerability reporting
  (Security tab → Report a vulnerability), not a public issue.

## What's most useful

- Accessibility fixes and testing on real devices
- Language/localization review (Bengali is live; Hindi is planned)
- Documentation and honest-copy improvements
- Bug reports with reproduction steps — even without a patch
