## 25. Founder/board summary screen + weekly digest (2026-10-09)

**Where this came from:** the founder/board are non-technical and had no
single at-a-glance view of the portfolio — they'd have had to piece it
together from `/dashboard`, `/delays`, and `/sales` separately. Two asks,
built together since the second reuses the first's data: a `/board` screen,
and a weekly emailed PDF digest of the same numbers.

**Decisions made with the user this session** (not in plan.md until now):
- `/board`'s first version shows **only data already computed elsewhere**
  (portfolio health, onboarding funnel, sales-this-month, open complaints,
  the existing delay/lateness summary) — no new revenue/stage logic
  invented, since the founder hasn't signed off on any new figures.
- Digest recipients are a **fixed env-var list**
  (`FOUNDER_DIGEST_RECIPIENTS`), not "every ADMIN/MANAGEMENT user" — those
  two roles are also used by internal ops staff, not just the founder/board.
- **WhatsApp delivery is deferred, documented but not built** — see below.

### What got built

- **`src/lib/dashboard/widgets.ts`**: `getAdminWidgets()` moved here from
  being a private function inside `dashboard/page.tsx`, so `/board` and the
  digest can reuse the exact same onboarding/sales/complaints figures
  `/dashboard` already shows ADMIN/MANAGEMENT — one function, three callers.
- **`src/lib/board-summary.ts`** (new, `server-only`): `getBoardSummary()` —
  recombines project-health counts (same `franchiseProject.count()` queries
  as `/dashboard`), `getAdminWidgets()`, and a portfolio delay summary (same
  bounded "opted into tracking" `Task` query `/delays` uses, fed into the
  existing `summarizeDelays()`). One aggregator feeds both the live screen
  and the PDF, so they can't drift apart.
- **`canViewBoardSummary`** (`permissions.ts`) — flat `ADMIN`/`MANAGEMENT`
  check, identical shape to `canViewDelaysDashboard` (no separate
  founder/board `Role` exists in the schema to gate on instead).
- **`/board`** (new route + `loading.tsx`) — health tiles, onboarding
  pipeline tiles, sales-this-month, a condensed delay snapshot (5 top-level
  numbers + top-5 most-overdue list) with a "View full delay breakdown →"
  link to `/delays` rather than duplicating its by-department/by-stage
  tables. Added to the sidebar behind the same `ADMIN`/`MANAGEMENT` mirror
  list `/delays` uses.
- **`src/lib/pdf-utils.ts`** (new) — `wrapText`, `toWinAnsiSafe`, and the A4
  page-size constants extracted out of `onboarding/loi-pdf.ts` once a second
  PDF generator needed the exact same text-wrapping/Unicode-sanitizing logic.
  `loi-pdf.ts` now imports from here; behavior unchanged, `loi-pdf.test.ts`
  passes unmodified.
- **`src/lib/board-digest-pdf.ts`** + test (new) — `generateBoardDigestPdf()`,
  plain pdf-lib text rows (no table/chart library — none exists in the repo
  and this content doesn't need one), same pagination style as
  `loi-pdf.ts`'s closures, rewritten fresh since those aren't exported. No
  watermark, no legal branding — this isn't a legal document.
- **`onboarding/notify.ts`**: added `"board_digest"` to `EmailKey` + a
  default template; made `sendOnboardingEmail`'s `onboardingId` optional
  (already-nullable column, now actually usable as such) and added an
  `attachments` passthrough to Resend's `emails.send` (the installed SDK
  already supported it; no call site had ever used it). Same reuse section
  24 S4 already anticipated for its own `task_digest`/`task_escalation` keys.
- **`BoardDigestRun`** model (new table, migration
  `20261009071934_add_board_digest_run`) — `weekStart @unique` is the
  insert-first idempotency guard against a double cron trigger sending the
  digest twice in the same week. Purely additive (new table only, no
  existing-table changes).
- **`src/app/api/cron/board-digest/route.ts`** (new) — `GET`, bearer-checked
  against `CRON_SECRET`, no-ops unless `BOARD_DIGEST_ENABLED=true`, computes
  the current IST week's Monday, tries to insert `BoardDigestRun` (skips if
  it already exists), then emails every address in
  `FOUNDER_DIGEST_RECIPIENTS` the generated PDF via `sendOnboardingEmail`.
- **`vercel.json`** (new — repo had none before this) — one cron entry,
  Monday 09:30 IST (`0 4 * * 1`).
- **`.env.example`** / `.env`: added `CRON_SECRET`, `BOARD_DIGEST_ENABLED`
  (default `"false"`), `FOUNDER_DIGEST_RECIPIENTS` (empty by default — the
  digest cannot send to anyone until this is filled in, same "off by
  default" safety convention S4 laid out for `TASK_REMINDERS_ENABLED`).

### WhatsApp delivery — documented, not built (needs founder/Apoorv go)

The user asked for this explicitly, but real WhatsApp delivery needs
infrastructure that doesn't exist yet and that only a human can set up —
the same reason Leegality (section 19) needed its own credentials step
before any code could call it:

1. **Why not yet:** sending an automated WhatsApp message outside a live,
   user-initiated chat window requires a **pre-approved message template**
   (Meta reviews these, typically ~24–48h turnaround) and a **business-
   verified WhatsApp sender** — neither exists. This isn't a "we didn't get
   to it" gap; plan.md has independently ruled out WhatsApp integration
   three separate times already (section 2: "No WhatsApp, no general
   notification engine"; section 16: "We do not use WhatsApp or any
   WhatsApp service" — that one's about the mobile upload UI's *look*, not
   messaging; section 24 S4: "no WhatsApp, no SMS"). Building it now would
   reverse a standing decision, not just add a feature.
2. **Provider options**, for Apoorv/the founder to pick between — figures
   below are *indicative only*, not quoted: WhatsApp Business pricing is
   conversation-category-based (utility vs. marketing) and changes
   periodically, so confirm the current rate card at decision time rather
   than trusting any number written here.
   - **Meta Cloud API directly** — no platform fee from Meta itself beyond
     its own per-conversation rate; you own business verification, the
     dedicated number, and template submission yourself. Cheapest long-run,
     more setup work up front.
   - **A reseller (Twilio, Gupshup, etc.)** — faster onboarding, a
     dashboard, support — but adds their own markup on top of Meta's rate,
     and usually a monthly platform fee.
3. **Steps required, in order:** Meta Business Manager verification → a
   WhatsApp Business Account + a phone number dedicated to it (that number
   can no longer also run the regular WhatsApp app) → submit the digest
   message template for approval → pick a provider (or go direct) → obtain
   API credentials. Only once all of that exists does a
   `sendBoardDigestWhatsApp()`-style function have anything real to call —
   nothing stubbed or half-built in code until then, per the "no
   half-finished implementations" rule.

**Update (2026-10-09) — a concrete provider is now available:** the user has
a free subscription to **BigRadar** (`bigradar.io`, a WhatsApp Business
Solution Provider built on Meta's Cloud API), via a personal contact who
owns it. Confirmed by reading `bigradar.io/docs` directly (not from training
data) — this changes step 3 above from "several weeks of manual Meta
verification" to something much faster:

- **Connection is fast, not a lengthy manual process**: `Settings →
  Integrations → Connect with Facebook` in the BigRadar dashboard triggers
  Meta's *embedded signup* flow — no separate Meta Business Manager setup
  needed beforehand, docs quote "no separate Meta Business Manager setup
  required beforehand" and estimate **~10 minutes** end to end. BigRadar
  automatically registers as a Meta tech partner, wires the webhook, and
  subscribes to WhatsApp events on the user's behalf.
- **Prerequisites** (still real, still needed, not eliminated — just
  faster): a **dedicated phone number** not currently active on WhatsApp or
  WhatsApp Business (a new SIM, effectively), a business display
  name + business email, a Facebook login to authenticate the signup, and
  confirmation that the account is on BigRadar's **"Pro" plan** (the docs
  gate WhatsApp connection behind it — worth confirming with Ethan whether
  the free account already includes this).
- **Template approval is still required** — this is a WhatsApp/Meta
  platform rule, not something any provider can skip: "an approved template
  can be sent even when the customer has not messaged you in the last 24
  hours," but *un*-approved freeform messages can't be sent outside that
  24h window at all. The weekly digest, sent cold every Monday with no
  prior franchisee-side message, would always need an approved template.
- **API shape** (`POST https://api.bigradar.io/api/public/v1/messages`,
  `Authorization: Bearer <API key>`): sending a document takes a `type:
  "document"` payload with `media.link` — **a public HTTPS URL**, not raw
  attached bytes like Resend's `attachments` field takes today. This is the
  one real code-shape difference from the email path: the generated PDF
  would need to be uploaded to B2 (already used for Document/LOI storage —
  `src/lib/storage.ts`) and a (presigned or public) URL obtained, then
  passed to BigRadar instead of a `Buffer`. `generateBoardDigestPdf()` itself
  (`src/lib/board-digest-pdf.ts`) needs no changes — only the delivery step
  differs.
- **Pricing**: not published in the docs (nothing found under
  `/docs/templates`, `/docs/send-message`, or `/docs/guides`) — since this
  account is a free favor from a personal contact, get actual terms (does
  "free" mean free forever, free trial, or free API access with Meta's own
  per-conversation cost still passed through?) confirmed with Ethan directly
  before relying on it for anything production-facing.

**Still not built** — this is now a *much* shorter path than originally
scoped, but still needs the user to: (a) get a dedicated WhatsApp number and
confirm the Pro-plan/pricing terms with Ethan, (b) actually run the ~10-min
Meta embedded signup, (c) decide the digest's template wording and get it
submitted for Meta approval, (d) hand over a BigRadar API key. Once those
four exist, the code change is small (a B2-upload step + one HTTP call) —
not attempted yet since none of the four exist yet, same "no half-finished
implementations" reasoning as above.

**Verified**: `tsc --noEmit`, `eslint`, `vitest run` clean (including the new
`board-digest-pdf.test.ts`; `loi-pdf.test.ts` unchanged and still passing);
`next typegen` run for the new `/board` route and `/api/cron/board-digest`
before type-checking; `prisma migrate dev` applied the new
`BoardDigestRun` migration cleanly against the local dev DB (confirmed
additive-only — new table, no column changes to any existing table).
**Not verified**: no live dev-DB/browser check of `/board`'s actual rendered
numbers, and no real end-to-end Resend send with a real PDF attachment —
same honesty caveat as S2/S3: the real dev DB still has no SLA data filled
in, so `/board`'s delay section renders the same correct empty state
`/delays` does today.

**Housekeeping found and fixed in passing (local dev environment only, not
app code):** several `prisma/migrations/*/migration.sql` files had been
silently flipped from LF to CRLF line endings by a prior `git checkout`
(Windows + `core.autocrlf=true`), which made `prisma migrate dev`'s
checksum-drift check fail with "migration was modified after it was
applied." Fixed by normalizing those files back to LF (content identical —
confirmed via `git diff`, zero-byte diff) and removing one stale
rolled-back-attempt row left in the local dev DB's own `_prisma_migrations`
bookkeeping table from the original S1 session. Neither change touched any
application data or any committed file content. **This will very likely
recur on the next fresh checkout** unless a `.gitattributes` rule forces LF
on `prisma/migrations/**/*.sql` — not added here since it's a repo-wide
convention change outside this task's scope, flagged for a separate,
explicit decision.

---

