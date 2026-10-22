## 24. Delay tracking, approvals and vendor links — ideas adapted from Nodomo (proposed 2026-10-08)

**Where this came from:** the founder asked Apoorv to look at **Nodomo**
(nodomo.ai, by Amply), a workflow product for new-store-opening (NSO) projects
— pitch PDF `Nodomo for NSO Projects.pdf` (12 pages). **We are not buying or
integrating Nodomo.** Same stance as section 18: take a few good ideas and build
them our own way inside Fraterniti One. Caveat: all we have seen is a sales
pitch (its own numbers are marked "illustrative"); nobody has used the product,
so everything below is *our* design inspired by it, not a copy of how Nodomo
behaves.

**The pitch in one line:** stop chasing people on Excel and WhatsApp. Every task
has an owner and a time limit, and the system itself shows *which team or vendor
is holding up which store, and for how many days.*

**Status of this section: PROPOSAL.** Apoorv asked for it to be written into the
plan; the founder has not yet confirmed any of it. It pulls parts of FR-004
(approvals), FR-009 (reminders), FR-007/008 (dependencies) and the Phase 4
management view forward from the phasing in section 2. Working rule: steps S0-S3
are additive and low-risk, so they may start after Apoorv's OK; **S4 onward need
his explicit go** (and the founder's, for the policy items in the human-
intervention list).

### What we take, what we skip

| Nodomo idea | Fraterniti One today | Decision |
|---|---|---|
| Time limit per task ("SLA 5d") and "days late" | `Task` has owner, due date, status, module — no time limit, no start/finish time | **Take** (S1-S2) |
| "Which team is causing delay" dashboard | Per-project progress only; portfolio view is Phase 4 | **Take** (S3). `Task.module` already is the department, so this is mostly a new view |
| Reminders and escalation | Only onboarding emails (section 17) | **Take** (S4), as one daily digest, not one email per task |
| Approval gate; a decline goes back with a reason | KYC/payment already do "changes requested + mandatory reason"; tasks do not | **Take** (S5), only on a short list of key tasks |
| Vendor acts from an email link, no login | No vendor role; `/m` is for internal supervisors | **Take** (S6) |
| Revenue at risk, forecast opening | `targetOpening` exists; sales exist only for open stores | **Later, blocked on input** (S7) |
| Parallel branches / "wait for both" | Stages are independent by design (4b) | **Light version only** (S8): dependencies between ~20-30 milestone tasks |
| Visual drag-and-drop workflow canvas | 13-stage tiles + ~960 seeded tasks | **Skip** — huge build, no need |
| AI / voice workflow builder | Master checklists already exist (sections 9, 15) | **Skip** |
| Per-seat pricing (Admin/Member/Lite) | Not applicable | **Skip** |

### Mental model (read this first, plain words)

Today a task only knows *who*, *what* and *by when*. It does not know *when work
actually began* or *when it finished*, so the app cannot say "5 days late".
Everything in this section grows from adding those few facts and then computing
the rest.

```
EXISTING                                  NEW (section 24)
────────────────────────────              ──────────────────────────────────────────────
Task: owner, due date, status, module     + slaDays        (how many days it should take)
                                          + startedAt      (first time work began)
                                          + completedAt    (when it finished)
        │
        │   ALL status changes go through ONE helper (S1)  ──►  AuditEvent (already mandatory)
        ▼
lateness = computed on read, never stored (S2)
        │
        ├──► "Where is it stuck" per project + /delays portfolio view (S3)
        │        late days grouped by department (Task.module), by stage, by vendor
        ├──► one daily digest email per person: due soon / overdue / escalation (S4)
        ├──► approval gate on key tasks: submit ► approve, or decline + reason ► back to owner (S5)
        └──► vendor gets an email link: "Mark complete" / "Need more time", no login (S6)
```

Cause → effect in one line: `task starts` → `clock starts (startedAt)` → `time
limit passes` → `task shows "N days late", owner gets it in the morning digest`
→ `still late after N days` → `escalation to the project owner` → `management
sees which department caused most late days`.

What does **not** change: onboarding / KYC / LOI / e-sign (sections 17-19),
sales (20A), complaints (18b), pre-existing franchisees (section 23 — they have
no seeded tasks, so nothing here applies to them), the 13-stage and category
roll-ups (they keep reading the same `Task` rows).

### Data model additions (all additive; nothing existing is removed)

- **`Task`**: `slaDays Int?`, `startedAt DateTime?`, `completedAt DateTime?`.
  All nullable. **A task with no time limit and no manual due date is simply
  "not tracked"** — it never shows as late and is left out of every delay
  number. Check the real name of the existing due-date column in the schema
  (called "due" in section 4).
- **`TaskReminderRun`** (S4): `runDate` (unique), `status`, counts, `error` —
  guards against a double daily run.
- **`TaskApproval`** (S5): `taskId`, `round`, `approverId?`, `status`
  (`PENDING` | `APPROVED` | `DECLINED`), `reason` (mandatory on decline),
  `submittedById`, `submittedAt`, `decidedAt`. One row per round, history is
  kept (same discipline as `PaymentSubmission`).
- **`TaskExternalLink`** (S6): `taskId`, `vendorName`, `vendorEmail`,
  `tokenHash` (sha256 of the random token, same discipline as
  `PasswordResetToken`), `expiresAt`, `revokedAt?`, `lastUsedAt?`,
  `createdById`.
- **`TaskExtensionRequest`** (S6): `taskId`, `requestedBy` (user id or
  `vendor:<email>`), `reason`, `proposedDue`, `status`, `decidedById?`.
- **`TaskDependency`** (S8, optional): `taskId`, `dependsOnTaskId`.
- Config files, not DB: `src/lib/task-sla-defaults` (or an optional `slaDays`
  field on each entry of `STAGE_TASK_TEMPLATES` and
  `OPS_PROGRESS_TASK_TEMPLATES`), `src/lib/approval-gates.ts`,
  `src/lib/reminder-rules.ts`. **Numbers live in these files so they can be
  changed in one place. Claude Code must not invent SLA numbers** (see
  human-intervention list).

### Lateness rules (S2 — pure functions in `src/lib/task-timing.ts`, unit-tested)

- `effectiveDue(task)` = the manual due date if one is set; otherwise
  `startedAt + slaDays` if both exist; otherwise none (not tracked).
- Compare **IST calendar days**, not raw timestamps. The server runs in UTC;
  a naive compare is off by one around midnight IST.
- Open task: `OVERDUE` if today > `effectiveDue`, with `daysOverdue`;
  `DUE_SOON` if due today or tomorrow; else `ON_TRACK`.
- Done task: `LATE_DONE` if `completedAt` > `effectiveDue` (with `daysLate`),
  else `ON_TIME_DONE`.
- `CANCELLED` tasks, tasks that are not tracked, and tasks missing the
  timestamps they need are excluded — never guessed.
- **One choke point for status changes:** a single helper (for example
  `applyTaskStatusChange(tx, task, newStatus, actor)`) sets `startedAt` the
  first time a task leaves `NOT_STARTED`, sets `completedAt` on `COMPLETED`,
  clears `completedAt` if a task is reopened (keeps `startedAt`), and writes the
  `AuditEvent` with old → new. **Every path that changes status must use it**:
  the task status form, the mobile upload `finalizeUpload` (section 16), the
  approval decision (S5), the vendor link (S6), and the auto-created
  replacement "Other (not on checklist)" task (which stays untracked — no SLA).
- **Backfill existing tasks:** for tasks already `COMPLETED`/`IN_PROGRESS`,
  reconstruct `startedAt`/`completedAt` from the `AuditEvent` rows where the
  status changed (old → new + timestamp are already stored). If no such row
  exists, **leave it null**; do not guess. Script follows the
  `scripts/backfill-ops-tasks.ts` pattern: dry-run by default, `--apply` to
  write, per project.
- **Seeding new projects:** `createProjectWithSeedTasks` writes `slaDays` from
  the template config; empty means untracked. Existing projects get SLA values
  through a backfill script (title-matched, whitespace-normalised, same as
  section 15).

### What gets built (S-steps)

**S0. Recon, read-only.** Read sections 4, 9, 11, 15, 16, 17 (notify.ts, email
templates), 22, 23, `schema.prisma` (the real `Task` fields), `permissions.ts`,
`project-seed.ts`, the task status action, `finalizeUpload`, `/actions`,
`proxy.ts`, `package.json` scripts and whether a `vercel.json` exists. Append
"S0 — what I found" to the build log. Then give Apoorv the plain-words mental
model (above, in his words) and ask the blocking questions in **one** batch.
Wait for his go.

**S1. Schema + the status choke point + backfill.** Migration for the three
`Task` columns (+ index on `(projectId, status)` and one for the due/completed
dates if the dashboard query needs it). Build the helper, route every status
path through it, add unit tests. Backfill script, dry-run first. Export the
template list to a CSV (stage, category, title, module, `slaDays` blank) for
Apoorv and the ops heads to fill in — **ask for the numbers, do not make them
up**; start with ~20-30 milestone tasks (the ones the founder actually cares
about) and leave the rest untracked.

**S2. Lateness library + badges.** `task-timing.ts` + tests (boundaries: due
today, IST midnight, reopened task, untracked task, cancelled). Show a small
"3 days late" / "due tomorrow" badge on `TaskCard`, the stage/category pages
and `/actions`; sort `/actions` overdue-first by real days late. No new page.

**S3. "Where is it stuck" dashboards.**
- *Per project:* a card on the project page — overdue count, top 5 most-late
  tasks with owner, late days by department (`Task.module`) and by stage.
- *Portfolio:* `/delays` for `ADMIN` / `MANAGEMENT` (flat role check, not
  `hasFullOverride` — same style as `canViewSales`): tiles (running on time,
  running overdue, finished on time, finished late, average days overdue), a
  table "late days by department", filters for project / stage / date range.
  This is the screen the founder is most likely to want.
- Computed with SQL `groupBy`/`count`, **not** by loading all tasks into memory
  (~960 tasks × 70-80 stores). Follow the cap-and-count pattern of section 22.
- Tasks in `AWAITING_FRANCHISEE` count in a separate "Franchisee" bucket, so
  internal teams are not blamed for franchisee delays (default, see NOT DECIDED).
- A franchisee sees only their own project's overdue count, **not** the
  department breakdown (internal information).
- Every number must equal a direct DB query. Nothing stored (rule 3 below).

**S4. Reminders and escalation (needs go).**
- A Vercel Cron job calls `/api/cron/task-reminders`, protected by a
  `CRON_SECRET` bearer check. Runs once a day (morning IST).
- **One digest email per person per day** listing their due-soon and overdue
  tasks (not one email per task — with ~960 tasks per store that would be
  spam). A second email type, escalation, goes to the project owner when a task
  has been overdue more than N days (default 3). Rules live in
  `reminder-rules.ts`.
- Uses the existing Resend mailer and the `EmailTemplate` / `notify.ts`
  pattern (new keys `task_digest`, `task_escalation`); a failed email never
  fails anything else (P1-14 pattern) and is logged.
- Safe by default: `TASK_REMINDERS_ENABLED` is **off** outside production so a
  dev database can never email real people. `TaskReminderRun.runDate` unique →
  a double trigger sends nothing twice. Inactive users and cancelled/completed
  tasks are skipped.
- Internal recipients only in this step — no emails to franchisees, no
  WhatsApp, no SMS (section 2 stays true).

**S5. Approval gate on key tasks (needs go).**
- `approval-gates.ts` lists the tasks that need approval:
  `{stage, category?, title, approverRole, tatHours}`. Apoorv / the founder
  supply the list (aim for 15-20, for example commercial approval, design
  sign-off). Everything else behaves exactly as today.
- Flow: owner clicks "Submit for approval" → `TaskApproval` row `PENDING`,
  task status `AWAITING_INTERNAL` (existing enum value) → the approver sees it
  in `/actions` → **Approve** → `COMPLETED`, or **Decline with a mandatory
  reason** → back to `IN_PROGRESS`, same owner, reason added as a task comment.
  Each round is a new `TaskApproval` row; every step is audited.
- A gated task **cannot** go straight to `COMPLETED` — enforced in the choke
  point on the server, not just hidden in the UI. This includes the mobile
  upload (section 16 decision 6 says upload ⇒ `COMPLETED`): for a gated task the
  upload attaches the file and **submits for approval** instead. Flag this to
  Apoorv when it comes up.
- New narrow permission `canDecideTaskApproval(user, task)`: role must match the
  gate's `approverRole`; **no self-approval**; not routed through
  `hasFullOverride`.
- Pending approvals past `tatHours` show in the S4 digest.
- Default: a decline does **not** restart the SLA clock (the lateness keeps
  counting; see NOT DECIDED #3). Rework loops are one of the delay causes the
  founder wants to see.

**S6. Vendor email link (needs go).**
- An internal user with access to the task clicks "Send to vendor", enters
  vendor name + email → a `TaskExternalLink` is created and Resend emails a
  link `/v/<token>`. The token is 32 random bytes, only its sha256 is stored,
  default expiry 14 days (`VENDOR_LINK_TTL_DAYS`), revocable.
- `/v/[token]` is a public route (same pattern as `/api/webhooks/esign` in
  `proxy.ts`). It shows **only**: task title, store name and city, due date,
  instructions. It never shows other tasks, the franchisee, costs or documents.
  An invalid, expired or revoked token gets the same generic "link not valid"
  page (no hint which case).
- Vendor actions: **Mark complete** (optional note + up to 3 photos/PDFs via a
  presigned B2 upload, ≤ 15 MB each, magic-byte check, same rules as section
  17) and **Request more time** (reason + proposed date → a
  `TaskExtensionRequest` for the task owner to accept or reject; the vendor is
  emailed the result).
- A vendor "Mark complete" moves the task to `AWAITING_INTERNAL`; the internal
  owner confirms with one tap → `COMPLETED` (default; NOT DECIDED #5). Lateness
  for these tasks should be measured to the vendor's "done" time, not the
  owner's confirmation time — settle where that timestamp is stored in S0/S6 and
  tell Apoorv.
- `Document.ownerId` is a required FK to `User` and a vendor is not a user.
  Recon decides the least-change fix (default: attribute the file to the task's
  internal owner, and record `vendor:<email>` as the audit actor, as
  `system:esign` is used in section 17).
- Security: rate-limit per token and per IP, link never logged, one task per
  link, every vendor action written to the audit log.

**S7. Revenue at risk + forecast opening (blocked on input).** Needs an expected
daily revenue per store (integer paise, a new nullable `FranchiseProject`
column) and an agreed definition of "slip days". Proposed: slip = the longest
current overdue among the project's flagged milestone tasks; revenue at risk =
slip × expected daily revenue; always labelled **"estimate"**. Do not build
until the founder gives the revenue figure and agrees the definition.

**S8. Milestone dependencies (optional, last).** Flag ~20-30 tasks per project
as milestones; `TaskDependency` between them with "wait for all" meaning. A
task whose dependencies are not `COMPLETED` cannot start, and shows "waiting on
<task>". Cycle check on create. This is task-level only; stages stay
independent (4b). Not a general dependency engine.

### Rules that must hold (cause → effect)

1. Untracked tasks (no SLA, no manual due date) never appear as late and never
   enter a delay number. Nothing is guessed or defaulted into tracking.
2. Every status change goes through the one helper, and every change writes an
   `AuditEvent` (old → new). No second code path may set `COMPLETED`.
3. All lateness, counts and dashboards are computed on read. If a number is
   stored anywhere, that is a bug.
4. All date comparisons use IST calendar days.
5. Existing projects and tasks keep working untouched until a backfill is run
   and approved; migrations only add nullable columns.
6. A decline always carries a reason; nobody approves their own submission;
   a gated task cannot be completed any way except approval.
7. Vendor links: hashed token, expiry, revocable, one task, minimal
   information, uniform "not valid" page, rate-limited, fully audited.
8. Reminders: one digest per person per day, safe to run twice, off outside
   production, internal recipients only, email failure never breaks a business
   action.
9. A franchisee never sees internal department blame.
10. Money (S7) is integer paise; no float arithmetic.
11. This section does not modify anything under `src/lib/onboarding/`,
    `src/lib/esign/`, sales, or complaints.

### Env vars (names in `.env.example`, never values)

`CRON_SECRET`, `TASK_REMINDERS_ENABLED`, `VENDOR_LINK_TTL_DAYS` (optional,
default 14). Existing `RESEND_API_KEY` and `EMAIL_FROM` are reused; reminder
emails to real staff need `EMAIL_FROM` on a Resend-verified domain (section 5).

### Human-intervention list (keep it running in the build log)

1. **SLA numbers** for the first ~20-30 milestone tasks — Apoorv with the ops
   heads (Claude Code exports the CSV, they fill the `slaDays` column).
2. **Founder go-ahead** to pull approvals, reminders and the management delay
   view forward from later phases — Founder / Sushant ji.
3. **Approval gates** (which tasks) and their **approvers** — Founder.
4. **Who gets escalations**, and after how many days — Founder.
5. **Expected daily revenue per store** (S7 only) — Founder / Finance.
6. **Vercel plan and cron limits** (a free Hobby plan may allow only once-per-day
   crons; add `vercel.json` / set `CRON_SECRET` in Vercel) — Apoorv.
7. **Resend**: verified sending domain and monthly email limit — Apoorv.
8. **Real vendor emails** for one real test, and confirmation vendors are
   willing to work from an email link — Apoorv.

### Definition of done

On synthetic data: a task given a 5-day SLA, started 7 days ago, shows "2 days
late"; completing it records `completedAt` and moves it to "finished late"; the
department table and the per-project card both equal a direct DB `groupBy`;
a reopened task clears `completedAt` but keeps `startedAt`; an untracked task
appears in no delay number; the digest sends once per person even if the cron is
triggered twice and sends nothing in dev; a gated task cannot be completed
directly (UI **and** direct server-action call), a decline needs a reason and
returns it to the same owner, a self-approval is refused; a vendor link works
once for its own task, shows nothing else, and an expired/revoked/unknown token
looks identical; a franchisee cannot see the department breakdown. Existing
vitest and e2e suites still pass; every test artifact (users, projects, links,
B2 files) is deleted afterwards. **Synthetic-data success is not production
sign-off**: the real SLA numbers, approvers and escalation rules still come from
the founder.

### NOT DECIDED YET — ask before assuming (working default in brackets)

1. **SLA per task or per stage** [per task, nullable, only for the milestone
   tasks Apoorv names; everything else untracked].
2. **Who owns delay when a task waits on the franchisee** [separate "Franchisee"
   bucket, not charged to the internal department].
3. **Does a decline restart the SLA clock** (Nodomo restarts it) [no — the clock
   keeps running, so rework shows as delay; ask the founder].
4. **Escalation recipient and threshold** [project owner after 3 days overdue].
5. **Vendor "Mark complete": instant `COMPLETED` or internal confirmation**
   [internal confirmation via `AWAITING_INTERNAL`].
6. **Who may see `/delays`** [`ADMIN`, `MANAGEMENT`; per-project card for anyone
   who can view the project, department breakdown internal only].
7. **Reminder timing** [one digest at about 9 AM IST; "due soon" = within 1
   day].
8. **Vendor link expiry** [14 days].
9. **Moving task templates into the database** so SLA/owner changes need no
   deploy [not now; numbers live in code config and a change needs a deploy —
   accepted for the first version, revisit if the ops team edits them often].
10. **Revenue at risk definition and the daily revenue figure** [not built until
    given; label as estimate].
11. **Extension requests: does an accepted extension forgive lateness** [no —
    the dashboard also shows how many extensions a department/vendor needed].

### Build log

**S0 — recon, read-only (2026-10-08).** No code written. Findings:

- **Every place `Task.status` changes today:**
  1. `src/app/(app)/projects/[id]/actions.ts:123-175` (`updateTaskStatus`) — the
     desktop task-card status form. The only call site that is already fully
     general (any status → any status), gated by `canActOnTask`.
  2. `src/app/m/[id]/actions.ts:198-201` (inside `finalizeUpload`) — the mobile
     upload path (section 16). Always sets `COMPLETED` directly via
     `tx.task.update`, bypassing (1) entirely. This is the second, separate
     code path S1 must route through the new helper.
  - Not a status-change site (checked and ruled out): `forceCompleteStage`/
    `revertStageOverride` (`actions.ts:310-383`) only write `ProjectStageOverride`
    rows, never touch `Task.status`. `moveTask` only changes `Task.order`.
    `createTask`/seed paths (`project-seed.ts`, `actions.ts:createTask`,
    `m/[id]/actions.ts`'s "Other" respawn) only ever create tasks at the enum
    default `NOT_STARTED` — never an update. `scripts/backfill-ops-tasks.ts`
    only reads `status` (for an audit snapshot of newly-inserted rows), never
    sets it. `prisma/seed.ts` never touches `Task.status` at all.
  - So: **two** call sites need to route through `applyTaskStatusChange`, not
    more. Both are plain, un-exported `"use server"` functions — safe to edit
    directly.

- **Schema shapes confirmed** (`prisma/schema.prisma`):
  - `Task` (line 498): has `module` (Department enum, RBAC), `lifecycleStage`,
    `category` (nullable String, free-text ~28 values), `order`, `ownerId`,
    `createdById`, `dueDate` (`DateTime?` — **this is the "due" column**
    plan.md section 4's diagram calls `due`), `priority`, `status`
    (`TaskStatus`), `dependsOnId`/`dependents` (self-relation, already exists
    — relevant to S8), `completionEvidence`, `completedAt` (`DateTime?`,
    **already exists**, already set/cleared by `updateTaskStatus` today — S1
    only needs to add `startedAt`/`slaDays`, not `completedAt`). Indexes exist
    on `projectId`, `ownerId`, `status`, `lifecycleStage`, `category` — no
    `(projectId, status)` composite yet, matches S1's planned addition.
  - `FranchiseProject` (line 425): no revenue/forecast-slip field yet (relevant
    to S7, correctly scoped out for now).
  - `AuditEvent` (line 711): `projectId`/`onboardingId` both nullable, "at
    least one" enforced only in app code (`writeAuditEvent`, not a DB
    constraint) — confirmed this already supports S1's plan to reconstruct
    `startedAt`/`completedAt` from old→new status rows with timestamps.
  - `Document.ownerId` (line 598-621): confirmed **required** FK to `User`,
    exactly as section 24 S6 flagged — a vendor has no `User` row, so S6's
    "attribute the file to the task's internal owner" default is the only fit
    without a schema change.
  - `PasswordResetToken` (line 394): hashed `tokenHash` (unique), `purpose`
    enum, `expiresAt`, `usedAt` — confirmed as the exact pattern S6's
    `TaskExternalLink` should follow (hash the token, never store it raw).

- **`src/lib/project-seed.ts`** (`createProjectWithSeedTasks`): seeds from
  `STAGE_TASK_TEMPLATES` (`Record<LifecycleStage, string[]>` — **titles only,
  no object shape**, module comes from a separate `STAGE_DEFAULT_DEPARTMENT`
  map) and `OPS_PROGRESS_TASK_TEMPLATES` (`{ category, title, lifecycleStage,
  module }[]`). Neither has a `slaDays` field today — S1's "add an optional
  `slaDays` field on each template entry" is additive to both shapes (the
  string-array one would need to become `{ title, slaDays? }[]` or a parallel
  lookup keyed by title — a real design choice for S1, not decided here).
  Tasks are inserted via `createManyAndReturn` + `auditEvent.createMany` (2
  round trips, not ~1,450) — any S1 schema default for `slaDays`/`startedAt`
  must stay compatible with that bulk path.

- **`notify.ts` / `EmailTemplate` / Resend — confirmed reusable as designed:**
  `src/lib/onboarding/notify.ts` self-seeds `EmailTemplate` rows keyed by a
  `key: EmailKey` string union on first send (`db.emailTemplate.upsert`), logs
  every attempt to `NotificationLog` (whose `onboardingId` is **already
  nullable** — a non-onboarding key like `task_digest`/`task_escalation` can
  log with `onboardingId: null`, no schema change needed), and never throws on
  failure (P1-14). `getClient()` returns `null` when `RESEND_API_KEY` is
  unset. S4 can add `task_digest`/`task_escalation` to the `EmailKey` union and
  `DEFAULT_EMAIL_TEMPLATES` the same way, or a sibling `notifyTasks.ts` if
  mixing task-reminder keys into the onboarding-named file reads wrong —
  worth a quick call at S4, not blocking now.

- **Cron / `vercel.json`:** confirmed **no `vercel.json` exists anywhere in
  the repo** (`Glob` for `vercel.json` returned nothing), and `.env.example`
  has no `CRON_SECRET`/`TASK_REMINDERS_ENABLED`/`VENDOR_LINK_TTL_DAYS` yet —
  matches section 24's own "NOT DECIDED YET #6" and env-var list exactly. S4
  will need to create `vercel.json` from scratch, not edit an existing one.

- **Permissions style confirmed:** `src/lib/permissions.ts` has a clear
  precedent for "narrow, not `hasFullOverride`" gates — `canManageUsers`,
  `canForceCompleteStage`, `canDeleteProject` are all flat `user.role ===
  "ADMIN"` checks; `canViewSales` is the closest shape to what `/delays`
  (S3) and `canDecideTaskApproval` (S5) should follow (a `switch`/`includes`
  on role, no `hasFullOverride` call). `canActOnTask` (line 173) is the
  existing task-mutation gate `applyTaskStatusChange`'s callers already use
  today — S1 does not need a new permission function, only the new helper
  itself.

- **Backfill/export script convention confirmed:** `scripts/backfill-ops-
  tasks.ts` is dry-run-by-default (`APPLY = process.argv.includes("--apply")`),
  run via `npx tsx scripts/<name>.ts`, whitespace-normalizes title matching
  before treating something as "new". S1's SLA-backfill and template-CSV
  export scripts should follow this exact shape.

Mental model and the NOT DECIDED YET batch sent to Apoorv in the same session,
in Hinglish, per S0's own instruction. Apoorv's go: "bnade bro jesa bhi hai
first plan" — proceed on S1 using the section's own working defaults rather
than blocking on every open item individually.

**S1 — schema + the status choke point + backfill + CSV export (2026-10-08).**
What shipped:
- **Migration** `20261008170755_add_task_sla_timing`: `Task.slaDays Int?`,
  `Task.startedAt DateTime?`, `@@index([projectId, status])`. Generated via
  `prisma migrate diff --from-url $DATABASE_URL ... --script` (diffing the
  real dev DB directly, not the shadow DB — the shadow DB turned out to be
  stale, missing section 23's migration, which would have produced a diff
  with unrelated statements) + `prisma migrate deploy`, per the documented
  workaround (section 16's build log) for this machine's Postgres role
  lacking `CREATEDB`. Applied cleanly to the real dev DB.
- **`src/lib/task-status.ts`** — the one choke point,
  `applyTaskStatusChange(tx, task, newStatus, actor, opts)`. Sets `startedAt`
  once, the first time a task leaves `NOT_STARTED`; sets/clears `completedAt`
  exactly as the two pre-existing call sites already did (completing sets it,
  anything else nulls it — behavior-preserving, since `completedAt` could
  only ever be non-null after a prior completion); keeps `completionEvidence`
  unless actively completing; always writes one `Task` `UPDATE` `AuditEvent`
  via the existing `writeAuditEvent`. 6 unit tests
  (`src/lib/task-status.test.ts`, mocked `tx`, same pattern as
  `webhook-processor.test.ts`).
- **Both call sites now route through it**: `updateTaskStatus`
  (`src/app/(app)/projects/[id]/actions.ts`) and `finalizeUpload`
  (`src/app/m/[id]/actions.ts`). No third call site existed — confirmed in
  S0's recon. No UI changes; both forms' contracts are unchanged.
- **`src/lib/task-sla-defaults.ts`** (new): `TASK_SLA_DEFAULTS` starts
  **empty** — no SLA numbers invented, per the standing rule.
  `normalizeTaskTitle` matches `scripts/backfill-ops-tasks.ts`'s existing
  whitespace-normalization idea, scoped to title only (that script's own
  `key()` also folds in category, a different concern — left untouched).
  Wired into `project-seed.ts`'s `createProjectWithSeedTasks`: every newly
  seeded task now gets `slaDays` from this lookup (currently always `null`,
  since the map is empty).
- **`scripts/export-task-sla-template.ts`** (new, read-only): wrote
  `task-sla-template.csv` — 963 rows (158 lifecycle-checklist +
  805 BOQ/Ops, matching section 15's documented total exactly), columns
  `stage, category, title, module, slaDays` (last always blank). 12 titles
  contain literal newlines (raw-Excel fidelity, same precedent as section
  15's "kept as literal duplicates") — correctly RFC4180-quoted as
  multi-line fields, confirmed by spot-check; a plain `wc -l`-style raw line
  count looks higher than 964 for this reason, which is not a bug.
  `task-sla-template.csv` added to `.gitignore` (a handoff deliverable, not
  source) and left in the repo root for Apoorv/the ops heads to fill in and
  hand back.
- **`scripts/backfill-task-sla.ts`** / **`scripts/backfill-task-timing.ts`**
  (new): same dry-run/`--apply`, per-project, `tech@fraterniti.co.in`-actor
  shape as `backfill-ops-tasks.ts`, each writing its own `Task` `UPDATE`
  `AuditEvent` per row (section 4's audit rule). `backfill-task-timing.ts`
  reconstructs `startedAt` only (per plan.md's "never guess" rule — no
  matching AuditEvent means it stays null); deliberately does **not** touch
  `completedAt`, since both status-change call sites have always set that
  correctly already — there is nothing there to reconstruct.
- **Real dev DB state at the time of this step**: one real project ("Tulsi —
  Junagadh, Gujarat", 963 tasks, all still `NOT_STARTED`) plus one empty
  pre-existing-franchisee project ("Tulsi — Demo City", 0 tasks — section 23,
  unrelated to this step). Both backfill scripts correctly reported nothing
  to do against this real data: `backfill-task-sla.ts` because
  `TASK_SLA_DEFAULTS` is still empty, `backfill-task-timing.ts` because no
  task in the real DB has ever left `NOT_STARTED` yet. Confirmed this is
  accurate (not a script bug) by querying `Task.groupBy` directly — 963/963
  rows are `NOT_STARTED`.

**Real bug hit and fixed during verification, same class as sections 9/11's
own flagged pattern**: my first Playwright script's `waitForURL` predicate
(`/^\/projects\/[a-z0-9]+$/i`) matched `/projects/new` itself — "new" is
valid `[a-z0-9]+` — so it resolved instantly on the pre-submission URL
instead of waiting for the real redirect, exactly the class of bug
`tmp-e2e-sales.ts`'s own comments already warn about (and explicitly guard
against with a `!path.endsWith("/new")` check I'd omitted). Second: after
fixing that, a `waitForURL` on the *status-update* form also resolved
instantly for a different reason — `redirect()` targets the same pathname
the page is already on (just without the `#tasks` hash), so the predicate
was trivially true from the start, and a soft App Router navigation doesn't
reliably remount the client component either (local `useState` like
`expanded` can survive it), so waiting for the card to visually collapse
isn't a safe signal. Fixed by waiting on the one prop that's always
freshly re-rendered regardless of remount behavior: the status `Badge`
showing the new label.

Verified against the real dev DB, the real B2 bucket, and a real browser
(Playwright, throwaway project created and deleted through the real UI, same
precedent as `tmp-e2e-sales.ts`): desktop path — `NOT_STARTED → IN_PROGRESS →
COMPLETED → IN_PROGRESS` through the actual task-card form, confirmed in
Postgres at each step (`startedAt` set once and held, `completedAt` set then
cleared, `completionEvidence` saved then kept across the reopen, exactly 3
`UPDATE` `AuditEvent` rows with the correct old→new chain). Mobile path — a
throwaway `SITE_SUPERVISOR` created via the real `/users/new` form, logged
into `/m` in an independent browser context, uploaded a real 1×1 PNG against
the "Other (not on checklist)" task under "AC Work" (same task chosen as
section 16's own verification, to exercise the respawn path): confirmed the
original task flipped to `COMPLETED` with both `startedAt`/`completedAt` set,
the replacement "Other" task was auto-created `NOT_STARTED`, the `Document`
row linked correctly, and the mobile `AuditEvent` carries `source: "mobile"`.
21/21 checks passed. All test artifacts removed afterward: the uploaded B2
object deleted directly, the throwaway project/franchisee/supervisor deleted
(confirmed zero rows remaining via a direct DB query), the Playwright script
itself and a stray debug screenshot deleted from the repo. `tsc --noEmit`,
`eslint`, and `vitest` (198 tests, +6 new) all clean after every change.

**Not done in this step, by design**: no UI badges/dashboards (S2/S3), no
reminders/cron (S4), no approval gates (S5), no vendor links (S6) — all still
need their own separate go per the top-level task instructions. SLA numbers
are still all `null` in the real dev DB; nothing is counted as "late" yet
because S2 (the lateness-computation library) doesn't exist yet either.

**S2 — lateness library + badges, and S3 — delay dashboards (2026-10-09).**
Apoorv's go: continue past S1 into S2/S3 (both already pre-authorized by this
section's own working rule — "S0-S3 are additive and low-risk, so they may
start after Apoorv's OK"). What shipped:

- **`src/lib/task-timing.ts`** (new, no DB access, deliberately not
  `"server-only"` so it stays importable from anywhere): `effectiveDue`,
  `getTaskTiming` (the `OVERDUE`/`DUE_SOON`/`ON_TRACK`/`LATE_DONE`/
  `ON_TIME_DONE`/`UNTRACKED`/`CANCELLED` verdict, IST-calendar-day compare per
  rule 4, `now` injectable for tests), `formatTaskTimingBadge` (label +
  Tailwind class, `null` for every state not worth flagging), and
  `summarizeDelays` (on-read aggregation into tiles + by-department/by-stage
  buckets + top-N most-late, rule 9's `AWAITING_FRANCHISEE` → `"FRANCHISEE"`
  bucket handled by `delayBucketKey`). 18 unit tests
  (`src/lib/task-timing.test.ts`): IST-midnight rollover, due-today vs
  due-tomorrow, untracked-despite-startedAt, cancelled-overrides-everything,
  reopened-task-keeps-original-clock (no restart, matching rule/definition of
  done), late-done vs on-time-done, and the department-bucketing + topLate-
  ranking rules in `summarizeDelays`.
- **Badges are computed server-side, not in `TaskCard`**: every page that
  renders a task (`projects/[id]/page.tsx`, `stages/[stage]/page.tsx`,
  `categories/[category]/page.tsx`, `actions/page.tsx`) already has
  `slaDays`/`startedAt`/`completedAt` on the `Task` row for free (plain
  `include`, no `select`, confirmed before writing any query changes — no
  query changes were needed). Each calls `getTaskTiming` + `formatTaskTimingBadge`
  and passes the already-formatted `{label, className} | null` down as a
  plain prop. Deliberate choice over computing `now` inside the client
  `TaskCard`: avoids a server/client clock mismatch and a hydration diff.
  `/actions`' sort is now overdue-first **by real days late** (SLA- or
  due-date-derived), not just "has a due date in the past" — ties among
  non-overdue tasks still fall back to the existing priority/due-date order.
- **Per-project card** (`projects/[id]/delay-summary-card.tsx`): tiles +
  by-department + by-stage + top-5-most-late, computed from the project's
  own already-fetched `tasks` (no extra query). Renders nothing at all when
  the project has zero trackable tasks (true for every real project today —
  see below). Rule 9/NOT DECIDED #6 default: a `FRANCHISEE` viewer sees only
  the overdue count, never the breakdown or the named most-late list — a
  separate, narrower branch in the same component, not a permission gate
  (this card is not behind `canViewDelaysDashboard`; any role that can
  already view the project sees at least the count).
- **Portfolio `/delays`** (new route + `loading.tsx`): gated by the new
  `canViewDelaysDashboard` (`permissions.ts`, flat `ADMIN`/`MANAGEMENT`
  check, same shape as `canViewSales` — not `hasFullOverride`, per S3's own
  spec). Query filters to only tasks with a manual `dueDate` or a `slaDays`
  at the DB level (`OR: [...]`, excludes `CANCELLED`) — this is what keeps
  the row count bounded without a raw-SQL `groupBy`, since lateness itself
  (IST day-math against `effectiveDue`) isn't expressible as a plain SQL
  aggregate; project/stage filters also push down to the DB query, while the
  due-date-range filter runs in JS against `effectiveDue` (a DB-level filter
  there could only ever see the manual-`dueDate` half of trackable tasks).
  Tiles, by-department table, by-stage table, and a top-10 most-overdue table
  (with store name — the one list `summarizeDelays`'s generic shape doesn't
  carry, computed separately here). Added to the sidebar
  (`app-sidebar.tsx`) behind the same `ADMIN`/`MANAGEMENT` mirror list the
  other role-gated nav items already use.

**Verified**: `tsc --noEmit` clean, `eslint` clean on every new/changed file,
`vitest run` — 216/216 passed (18 new). **Not verified, unlike S1**: no live
dev-DB/browser check this time — S0's own recon already established the real
dev DB has 963/963 tasks `NOT_STARTED` with `slaDays` still `null` everywhere
(blocker: the SLA CSV hasn't come back from Apoorv/the ops heads yet), so
every screen built in this step currently renders its correct **empty**
state (per-project card renders nothing, `/delays` shows all-zero tiles and
"Nothing overdue right now.") against real data — there is no overdue task
to visually confirm a badge or a department row against yet. That's expected
given rule 1, not a sign something's broken, but it does mean the actual
"3 days late" / department-blame rendering has only been exercised by the
unit tests' synthetic timestamps, not by a real task in the real app.
**Still needed before this is actually useful to the founder**: the filled-in
`task-sla-template.csv` (human-intervention #1) — until that lands, `/delays`
is a correctly-empty screen, not yet a populated one.

**Not done in this step, by design**: reminders/cron (S4), approval gates
(S5), vendor links (S6) — each still needs its own separate go.

