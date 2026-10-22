## 27. Five days of undocumented commits — production hardening, task/RBAC rework, user-category rework (2026-10-16/21)

**Process note, same gap sections 21/22/23 already flagged three times
before:** 15 commits shipped between 2026-10-16 and 2026-10-21 with no
corresponding plan.md entry at the time. The last plan.md edit before this
section was 2026-10-17 12:20 (`1467bcb`, documented inline in section 18a);
everything on `dev`/`main` after it went un-written-up until now. Written up
by reading `git show <hash>` diffs directly, not from memory, same discipline
as sections 21-23. **Nothing here was re-verified with a fresh Playwright
pass or browser check as part of writing this entry** — only confirmed by
reading the diffs, the current file contents, and (noted explicitly below) a
clean `tsc`/passing `vitest run` immediately after writing this section.

### A. Production reliability fixes (2026-10-16, found and fixed the same day)

**1. Prod 500 on every project creation (`0e53cf9`).**
`createProjectWithSeedTasks` (seeds ~963 lifecycle tasks + their audit rows)
measured 5.2-5.5s against the production DB — just over Prisma's implicit 5s
interactive-transaction timeout, so every `POST /projects/new` was failing
with `PrismaClientKnownRequestError P2028` ("Transaction already closed"),
shown to users as a generic "This page couldn't load" (digest `236841608`).
**Confirmed via actual Vercel production logs**, per the commit message —
the first direct evidence in this file that the app is being used against a
real production deployment, not only locally. Fixed with an explicit 20s
`$transaction` timeout on both callers (`projects/actions.ts`, and the esign
webhook's onboarding→project conversion path, which hits the same seed
logic).

**2. Sales dashboard off by one day around midnight IST (`3ba3533`).**
`computePeriodCards`/`computeDailyTrend`/`computeMonthlyBars`
(`src/lib/sales/aggregate.ts`) derived "today" from the server's UTC date
instead of IST, even though `SalesDay` rows are keyed by IST business date —
wrong for roughly the first 5.5 hours of every IST day. Fixed by reusing
`istTodayKey()` (already built for the POS layer, section 26) instead of
`toUtcDateKey()`.

**3. Six further production-risk gaps, same day (`b3c0ac8`):**
- **Petpooja webhook lost-update race**: `aggregateAndWriteSalesDay`
  (`src/lib/pos/webhook-processor.ts`) now takes a Postgres advisory
  transaction lock keyed on `(projectId, date)` before aggregating — without
  it, two webhook deliveries landing close together for the same outlet/day
  could each read a `PosOrder` snapshot missing the other's not-yet-committed
  insert, and whichever transaction committed last would silently overwrite
  `SalesDay` with an undercounted total. **This fix only matters if
  concurrent real bills are actually arriving** — worth reading next to the
  Vercel-logs point above and item 3 under "Open items" below.
- `getSalesThisMonth` (dashboard widgets) had the same UTC-vs-IST
  month-boundary bug as fix #2, independently fixed here.
- CSV sales import (`sales/import/actions.ts`) got the same 20s
  transaction-timeout treatment as fix #1, for the same reason (a large
  import's sequential row-upsert loop).
- Malware-scan `after()` callbacks (Document, Complaint attachment,
  OnboardingFile) now catch scan/DB failures and mark `scanStatus: ERROR`
  instead of leaving the row stuck at `PENDING` forever with no trace —
  `after()` has no caller watching it, so an unguarded throw there was
  previously silent and permanent (and, for `OnboardingFile`, permanently
  blocking KYC review, since the download route hard-blocks on `scanStatus
  !== "CLEAN"`).
- Login lockout counters (`login/actions.ts`, `m/login/actions.ts`) switched
  from read-then-write to an atomic DB `increment`, closing a race where
  concurrent wrong-password/PIN attempts could undercount toward the
  lockout threshold.
- `cron/board-digest`: a failure after the `BoardDigestRun` idempotency row
  is written now deletes that row in a `catch`, so a mid-run crash (PDF
  generation, Resend) no longer permanently blocks that week's retry behind
  the unique constraint.

### B. Email delivery was silently failing (2026-10-17, `e2c0402`)

Real bug, not hardening: the Resend SDK resolves `emails.send()` normally
even on API-level failures (bad key, unverified domain) — it never rejects
the promise. Both call sites (`src/lib/email.ts`'s password-setup/reset
email, `src/lib/onboarding/notify.ts`'s `sendOnboardingEmail`) ignored the
returned `{data, error}` shape, so a rejected send looked identical to
success: forgot-password emails could silently never arrive, and
onboarding/board-digest sends got logged `"SENT"` in `NotificationLog` even
when Resend had rejected them. Fixed by checking `error` and throwing, so
every existing caller's own catch/logging (P1-14 pattern) now actually fires
on a real failure instead of being bypassed.

### C. Nav/dashboard role gaps (2026-10-17, `1ae8726`, `1c190b8`)

- The sidebar's "Signing" link was shown to every `ONBOARDING_ROLES` member
  (Sales, KYC Reviewer, Accounts, LOI Preparer), not just the two roles
  `canCompanySign` actually allows — those users saw a link that immediately
  redirected them away. Narrowed to `["ADMIN", "COMPANY_SIGNATORY"]`.
- "BOQ"/"Operations" (construction-trade tabs) were visible to every role
  including ones with no construction stake (Legal, HR, Marketing had no
  reason to see them) — narrowed to `ADMIN`, `MANAGEMENT`, `FRANCHISEE`,
  `SALES`, `PROJECT_MANAGER`, `INTERIORS`, `OPERATIONS`, `CULINARY`.
- Added a minimal "My Department" widget (`getMyDepartmentWidgets`,
  `src/lib/dashboard/widgets.ts`) — open-task count + document count scoped
  to `Task.module`/`Document.category` — to the dashboard for the 8
  department-owning internal roles that previously saw zero tailored content
  (only Franchisee/Sales/Admin-Management had bespoke dashboard sections
  before this).
- **Separately**, project creation's bulk ~963-row audit-event write was
  drowning the "recent activity" glance widgets on both `FranchiseeDashboard`
  and `InternalDashboard` in near-identical seed rows. Tagged with a new
  exported constant (`SEED_TASK_AUDIT_REFERENCE`, `src/lib/project-seed.ts`)
  and excluded (NULL-safe) from those two queries only — `/audit`, the full
  FR-010 compliance log, is deliberately untouched and still shows every
  seeded row.

### D. Task/RBAC rework — a real policy change, not a bug fix (2026-10-17, `83ef816`, `1aec21a`)

**This is the one item in this section that changes stated behaviour from
section 4b, and is worth Apoorv's explicit sign-off rather than quiet
acceptance:**

- **Task creation and title-renaming are now Admin-only** (`canCreateTask`,
  `canEditTaskTitle`, both flat `role === "ADMIN"`, `src/lib/permissions.ts`)
  — narrower than section 4b's original design, where department owners used
  "the same `NewTaskForm` already on the page" to add their own ad-hoc
  tasks. Status changes, comments and reordering are untouched (`canActOnTask`
  unchanged). If this wasn't a deliberate tightening, non-admin department
  heads have lost the ability to add their own ad-hoc tasks, and that's
  worth flagging back rather than assuming it was intended.
- **New `User.additionalRoles: Role[]`** and **`User.category: String[]`**
  (migrated from a single optional string to an array two commits later,
  `949f50f`) — lets one account be scoped into more than one department
  ("multi-role delegation") and optionally narrowed to specific
  `Task.category` trade values within it. `ownsDepartment`/
  `getManageableModules`/`canActOnTask`/`canActOnDocument`/
  `canManageComplaintCategory` all now check the union of `role` +
  `additionalRoles`, not just the primary role. The primary `role` field is
  unchanged in meaning (still drives dashboard branch selection and nav
  baseline) — this is additive scope, not a replacement.
- **Action Centre can now change a task's status inline** (`action-row.tsx`
  gained the same status `<Select>` + evidence `<Input>` the project page's
  `TaskCard` already had) instead of only linking out to the project page.
- **Project detail page's lifecycle/BOQ/Ops tiles are now department-scoped**:
  only tappable for departments the viewer owns; the flat Tasks list is
  scoped to the viewer's department(s) + category. Portfolio stats and tile
  progress counts stay full/accurate for every viewer regardless
  (explicitly a read-only "live feed", not hidden data) —
  Admin/Management/a franchisee on their own project see everything
  unchanged.
- **Same-day follow-up (`1aec21a`): completing a task now requires
  evidence.** Centralized in the one status-change choke point
  (`applyTaskStatusChange`, section 24 S1) — needs either
  `completionEvidence` text (new or already on record) or at least one
  attached `Document`. The mobile `/m` upload path is never blocked (it
  always attaches its photo in the same transaction). Both web call sites
  (project page, Action Centre) now catch the thrown error and show it
  inline instead of the action crashing uncaught. 4 new unit tests in
  `task-status.test.ts`.

### E. Dashboard personalization (2026-10-17, `12579fb`)

A `GreetingBanner` component + time-of-day-aware greeting, plus a one-line
role/department summary, added above the existing stat rows on `/dashboard`.
Purely additive UI, no new data source.

### F. Data-correctness backfill (2026-10-17, `5392f03`)

`OPS_PROGRESS_TASK_TEMPLATES`' "Marketing Promotion Offers" row — actually
part of Culinary's own pre-opening checklist — had carried the wrong
`module` (`MARKETING` instead of `OPERATIONS`) and `lifecycleStage`
(`PRE_LAUNCH_MARKETING` instead of `OPERATIONS_PREPARATION`) since an
earlier CULINARY block rebuild, giving the Marketing role write access to a
task it shouldn't own. Template fixed going forward;
`scripts/backfill-marketing-culinary-task.ts` (dry-run by default, `--apply`
to write, same convention as `backfill-ops-tasks.ts`) corrects every
already-seeded project's copy of that one row, with its own `AuditEvent`.

### G. User.category: single string → searchable multi-select (2026-10-21, `949f50f`, `030db14`)

`User.category` moved from `String?` to `String[] @default([])` — multiple
trades per user instead of one. New/Edit User forms replaced the freeform
text `Input` with a searchable multi-select combobox
(`src/components/ui/multi-combobox.tsx`, new, first 5 shown + "show more"),
options sourced dynamically from distinct `Task.category` values already in
use rather than a hardcoded list. Task-delegation matching and every
downstream read site updated to the array shape. **A real gap caught two
commits later, same day (`030db14`):** the array migration backfilled
existing NULLs to `{}` but never added the DB-level `NOT NULL` constraint, so
the Prisma schema's non-null `String[]` promise wasn't actually enforced — a
stale NULL row would have crashed `/users`' `.category.map()`. Closed with a
follow-up migration (`20261021123914_user_category_not_null`).

### H. Small fixes (2026-10-21)

- **`b661ee5`**: a blocked user-delete (the person owns a project/task/
  document — `ON DELETE RESTRICT`) crashed `/users` outright instead of
  showing the friendly "reassign these first" message, for every FK *except*
  the plain-FK-violation shape (`P2003`, SQLSTATE 23503). Postgres reports an
  explicit `RESTRICT` violation as SQLSTATE 23001 instead, which Prisma
  surfaces as an untyped `PrismaClientUnknownRequestError`, not `P2003` — the
  existing check only looked for `P2003`. Now also catches the
  unknown-error shape by message text.
- **`3c1a194`**: removed the "All Franchises" aggregate option from the
  Action Centre franchise picker — when more than one franchise exists and
  none is selected, the page now redirects to the first one instead of
  offering a combined view.
- **`389b2a1`**: cosmetic — dropped the "(plan.md section 17)"
  cross-reference from `/store-onboarding`'s subheading copy (user-facing
  text shouldn't cite an internal planning doc).

### What this section does NOT change

Nothing here touches onboarding/KYC/LOI/e-sign (sections 17-19), the
Petpooja webhook's parsing/ingestion logic itself (only its `SalesDay`
aggregation gained a lock, item A3), section 24 S4-S8 (still not built), or
section 25's WhatsApp gap (still not built).

### Open items this raises (ask Apoorv, don't assume)

1. **Is Admin-only task creation (`83ef816`) the final policy**, or did
   department heads lose a capability they're expected to get back some
   other way? Section 4b's original design explicitly gave them their own
   `NewTaskForm`.
2. **The email-domain whitelist is still disabled** (`1467bcb`, section
   18a — `isApprovedEmailDomain()` unconditionally `true` since
   2026-10-17) and nothing in this batch of commits re-enabled it.
   Four-plus days with no revisit; worth a direct ask rather than continuing
   to assume "for now" still holds.
3. **Is Petpooja actually live in production right now?** `0e53cf9`'s fix
   was confirmed against real Vercel logs, and `b3c0ac8`'s advisory-lock fix
   is explicitly for "concurrent Petpooja webhook deliveries" — both read as
   live-traffic symptoms, not synthetic-test findings. Section 26's own
   build log stops at P7 (the go-live checklist handed to Apoorv) with no
   entry confirming any outlet was actually mapped and enabled. This section
   does not resolve that either way — it only flags that the evidence points
   toward "probably yes" and plan.md has no record either way.

**Verified (for this write-up only, not a fresh build session):** `npx tsc
--noEmit` clean; `npx vitest run` — 274/274 passing (12 files), matching the
file/test counts the diffs themselves show. No new Playwright/browser pass
was run to produce this section — it is retrospective documentation, same
caveat as sections 21-23.
