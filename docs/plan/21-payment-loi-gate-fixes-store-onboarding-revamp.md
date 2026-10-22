## 21. Payment/LOI gate fixes + store-onboarding admin revamp — retrospective documentation (2026-10-06/07)

**Process note, same gap sections 13/17/19 already flagged twice before:**
six commits shipped 2026-10-06/07 with no corresponding plan.md entry at the
time — `93058ef`/`344089f`, `c412120`/`4c72dbf`, `87fb014`/`bba8e59`,
`26fe670`/`d4902a7` (four logical changes, each landed once on `dev` and once
on `main`, byte-identical diffs), and `c782993`/`8d2d783` (one change, same
dev/main pattern). Written up now by reading the actual diffs
(`git show <hash>`), not from memory — every file/line below was confirmed
in the diff or the current file, not inferred from the commit message alone.

**1. LOI e-sign: require an "agree to terms" checkbox (`93058ef`, 2026-10-06).**
`src/app/onboarding/loi/franchisee-sign-button.tsx` gained a client-side
`agreed` checkbox state; the sign button is now
`disabled={!canSign || !agreed || pending}`. UI-only guard —
`canFranchiseeSignNow` (`src/lib/onboarding/state.ts`) is untouched, so this
adds a client-side click guard, not a new server-side eligibility rule.

**2. Show verified payment amount on the onboarding detail page (`c412120`,
2026-10-06).** `src/app/(app)/store-onboarding/[id]/page.tsx` started
rendering `payments[0].verifiedAmount` alongside the franchisee-declared
amount. Purely additive — before this, an Admin looking at a stuck
onboarding could see what the franchisee *claimed* they paid but not what
had actually been *verified*, making it impossible to diagnose from the UI
why the e-sign gate below stayed closed.

**3. LOI gate: sum verified amount across all accepted payments, not just the
latest (`87fb014`, 2026-10-06) — a real bug fix.** Root cause: a franchisee
paying the franchise fee in installments (e.g. ₹499 + ₹2 + ₹4,499) was
permanently blocked from signing the LOI, because both call sites that feed
`canFranchiseeSignNow` (`src/app/onboarding/loi/actions.ts` and `.../page.tsx`)
queried `payments: { orderBy: { createdAt: "desc" }, take: 1 }` and passed
only that single latest row's `verifiedAmount` into the gate — so an
installment payer's *total* verified amount never counted, only whichever
row happened to be most recent. Fixed by querying all of a franchisee's
`Payment` rows and computing `totalVerifiedAmount = payments.reduce((sum, p)
=> sum + (p.verifiedAmount ?? 0), 0)`, passed into the gate instead.
`canFranchiseeSignNow`'s own signature and logic in `state.ts` were not
changed — only what gets computed and handed to it.

**4. Allow resubmitting a payment when the total verified amount is still
short (`26fe670`, 2026-10-06) — companion bug fix to #3.**
`submitPaymentReceipt` (`src/app/onboarding/documents/actions.ts`) previously
blocked *any* new payment submission once the onboarding's `paymentStatus`
left `MISSING`/`CHANGES_REQUESTED` — so an installment payer whose first
partial payment got marked `ACCEPTED` could never submit the second
installment at all, directly conflicting with fix #3's premise that partial
payments should accumulate. New rule: block a new submission only if (a) a
payment is currently `SUBMITTED` (pending review — don't let a franchisee
spam submissions while one is still being checked), or (b) the cumulative
verified amount already meets `expectedAmount`. `documents/page.tsx` now
fetches all payment rows (not `take: 1`) to compute `totalVerifiedAmount`,
`hasPendingPayment`, and `paymentEditable`; `payment-section.tsx` gained a
`totalVerifiedAmount` prop, shows "Verified so far: ₹X — ₹Y remaining", and
pre-fills the new declared-amount field with the *remaining* balance rather
than the full `expectedAmount` (a franchisee re-entering the full amount a
second time would otherwise look like they're claiming to pay twice).
`src/lib/onboarding/recompute.ts` was switched the same way, from
`latestPayment?.verifiedAmount` to summing all payments, so
`deriveOnboardingStatus`'s stored `onboardingStatus` can't silently disagree
with the e-sign gate the way it could before. **Noted, not changed**:
`onboarding.paymentStatus` itself still mirrors only the *latest* payment
row's status — intentional, since `canFranchiseeSignNow` requires both
`paymentStatus === "ACCEPTED"` on the latest row *and* the cumulative amount
being sufficient; this wasn't re-verified end-to-end in a browser as part of
writing this entry, only confirmed by reading the diff and the current gate
logic together.

**5. Store onboarding admin revamp (`c782993`/`8d2d783`, 2026-10-07) — an
architecture change, not a bug fix.** Removed the standalone `/reviews`
KYC/payment review queue entirely (`src/app/(app)/reviews/page.tsx`,
`reviews/kyc/[id]/page.tsx`, `reviews/payment/[id]/page.tsx` — 402 lines
deleted) and replaced it with three dedicated drill-down pages nested under
the onboarding itself: `store-onboarding/[id]/kyc/page.tsx`,
`.../payment/page.tsx` (both new, ~383 lines combined, carrying over the
review logic from the deleted pages) and `.../loi/page.tsx` (new, 125 lines).
`store-onboarding/[id]/page.tsx` itself was simplified from inline
`LoiPrepPanel`/`LoiEditPanel` content to three clickable summary `Card`s
(KYC/Payment/LOI) that link to those sub-pages. `decision-form.tsx` and
`review-actions.ts` moved from `reviews/` into the `[id]/` folder alongside
the pages that now use them. Sidebar's "Reviews" nav item was removed
(`app-sidebar.tsx`). Both new `page.tsx` and `payment/page.tsx` compute
`totalVerified` the same summed-across-all-payments way as fix #3/#4 — the
revamp and the gate fixes agree with each other. Also touched:
`.claude/settings.json` was added in this commit (two Bash permission
allowlist entries, `node -e` and `xargs grep -l "/reviews"` — harness
tooling, not app behavior).

**Why this entry exists now rather than at the time**: same honest flag as
every prior "process note" in this file — these six commits shipped without
a plan.md write-up, so this section was written after the fact by reading
`git show` diffs directly, not from a live memory of building them. Nothing
here was re-verified with a fresh Playwright pass; if that matters before
relying on it further, that's still open.

---

