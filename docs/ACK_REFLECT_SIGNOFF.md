# Reflect / Acknowledgment — launch enablement record

This is the live record the build gate reads (`scripts/check-ack-reflect-gate.mjs`).
The feature flag (`ACK_REFLECT_ENABLED` in `src/v2/AckReflect.jsx`) is **ON** as of
2026-06-15 under an **operator risk-acceptance** — recorded honestly below. This is
**not** a professional clinical or legal sign-off, and does not claim to be.

```
ENABLEMENT_MODE: operator-risk-acceptance
OPERATOR_RISK_ACCEPTANCE: yes
CLINICAL_SIGNOFF: no    # no professional clinical review was performed
LEGAL_SIGNOFF: no       # no professional legal review was performed
```

- **Accepted by:** Ori operator / maintainer (deploy + App Store Connect credential holder)
- **Acceptance date:** 2026-06-15
- **Build/tag this applies to:** web deploy from `main` @ 2026-06-15 (post Option A)

---

## What was accepted, and why it was judged low-harm

The operator, fully informed, enabled the reflect flow without waiting for the
clinical (A) and legal (B) reviews in `PHASE3_REVIEW_SCOPE.md`, on this basis:

1. **Option A removed the highest-stakes item.** The crisis card no longer vouches
   for specific phone numbers (`VOUCH_LOCALIZED_LINES = false`). It routes to the
   local emergency number + findahelpline.com — a professionally maintained,
   auto-localizing directory whose operators keep the numbers correct. A
   wrong-but-plausible number can no longer be shown. This makes clinical item **A3**
   (number accuracy) and legal item **B6** (remote JSON as crisis content) moot.
2. **No new data flow.** The sub-processors (the model for text; Deepgram for voice)
   are already live in the shipped app for letters and voice transcription. This flag
   adds distress detection + one mirrored line, not a new processor. Legal items
   **B1/B3** describe the app's existing posture, not new exposure from this flag.
3. **The residual is low-harm.** Distress detection can fail open offline (A1): a
   miss simply yields the normal mirror response — no worse than the feature not
   existing. A false positive shows the safe findahelpline card unnecessarily. The
   card copy (A2) is built to #chatsafe / WHO safe-messaging.

## What remains UNREVIEWED (open follow-ups, not closed by this record)

- **A1** — distress-detection adequacy, incl. the offline fail-open boundary.
- **A2** — the distress-card copy/tone.
- **A4/A5** — non-determinism; the no-assessment/no-escalation posture.
- **B1/B3** — Art. 9 basis + the model/Deepgram DPAs, transfer, retention terms
  (existing app posture; confirm regardless).
- **B4/B5/B7/B8/B9** — device classification, duty of care, minors, App Store,
  marketing claims.

These do not block the current operator-accepted enablement, but they are real and
should get a clinician + counsel pass when possible. The cheapest next step is a
single clinician hour on A1 + A2 (everything number-related is already moot).

## How to convert this to a professional sign-off later

When a clinician and counsel review, set `CLINICAL_SIGNOFF: yes` / `LEGAL_SIGNOFF: yes`
with their names/roles/dates here. The gate prefers the professional path and will
report it instead of the operator-acceptance warning. To **disable** the feature,
set `ACK_REFLECT_ENABLED = false` in `AckReflect.jsx` (the gate then needs nothing).

See `PHASE3_REVIEW_SCOPE.md` for the full checklist;
`CLINICAL_REVIEW_BRIEF.md` / `LEGAL_REVIEW_BRIEF.md` are the ready-to-send packets.
