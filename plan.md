# Fraterniti One — Build Plan (Phase 1: Foundation)

> **How to use this file (for whoever is implementing, including Claude Code):**
> This is a living plan, not a one-shot spec. Anything under "NOT DECIDED YET"
> must be asked about and confirmed before you write code that depends on it —
> do not silently pick a default. When a decision gets made, move it from
> "NOT DECIDED YET" into the relevant section above it and update this file.

---

## 1. Context

Fraterniti One replaces manual Excel trackers (site lifecycle tracker, vendor
status tracker, individual department sheets) with one system: one franchise
= one Project ID, everything else (tasks, documents, approvals, payments)
attaches to it. Full source spec: `Fraterniti_One_Software_Requirement_and_Wireframes.pdf`
(sections referenced below).

This plan covers **Phase 1 only**, per the SRD's recommended delivery phases (section 16):
Auth/RBAC, Project master, Lifecycle, Home dashboard, Action Centre, Documents, Tasks, Audit.

## 2. Explicitly OUT of scope for this plan

Do not build these yet, even if referenced in the SRD:
- Sales/Legal/Interiors/Projects/DPR module screens (Phase 2)
- Approval workflow logic (FR-004) — full version is Phase 2; Phase 1 only needs
  a placeholder list view in Action Centre, not the approve/reject engine
- Payment schedules, invoices, CRM (FR-006) — Phase 2
- HR, Culinary, Procurement, Marketing modules — Phase 3
- Readiness score, blocker/dependency engine (FR-007, FR-008) — Phase 4
- Notifications (WhatsApp/email/SMS) (FR-009) — Phase 4/deferred
- Management Command Centre, portfolio-level views — Phase 4

## 3. Phase 1 scope — functional requirements in play

| FR ID  | Requirement                                                        |
|--------|---------------------------------------------------------------------|
| FR-001 | One Project ID created at onboarding; everything attaches to it     |
| FR-002 | Lifecycle stage, progress %, target opening, owner, next action on dashboard |
| FR-003 | Task workflow — owner, due date, priority, dependency, status, comments |
| FR-005 | Document vault with categories and version history                  |
| FR-010 | Full audit log — actor, timestamp, old/new value, reference          |

## 4. Data model (Phase 1 entities only)

Everything hangs off `FranchiseProject`. This is the one relationship that
must not break — every other entity references `project_id`.

```
                         ┌────────────────────────┐
                         │   FranchiseProject     │
                         │  project_id (PK)       │
                         │  brand, format,        │
                         │  franchisee_id,        │
                         │  location,             │
                         │  lifecycle_stage,      │
                         │  target_opening        │
                         └──────────┬─────────────┘
              ┌───────────┬─────────┼──────────┬──────────────┐
              │           │         │          │             │
         ┌────┴────┐  ┌────┴─────┐ ┌┴─────────┐┌┴──────────┐┌┴───────────┐
         │  Task   │  │Document  │ │ User/    ││AuditEvent ││ (Approval  │
         │task_id  │  │document  │ │ Org      ││event_id   ││ stub only, │
         │project_id│  │_id      │ │user_id   ││project_id ││ Phase 2)   │
         │owner,   │  │project_id│ │role,     ││actor,     │└────────────┘
         │due,     │  │category, │ │permission││action,    │
         │status,  │  │version,  │ │s         ││old/new,   │
         │priority,│  │status    │ │          ││timestamp  │
         │module   │  │          │ │          ││           │
         └─────────┘  └──────────┘ └──────────┘└───────────┘
```

`Task.module` = the department the task belongs to (e.g. Interiors, Legal,
Accounts). Added per Apoorv's review — not in the original draft diagram.

**Cause → effect that must hold:**
- A Task cannot exist without a `project_id`.
- Any create/update/delete on Task, Document, or Project must write an
  AuditEvent — this is not optional, not "add later" (SRD section 18 warns
  retrofitting audit later is expensive).
- Dashboard (FR-002) is a read-only view computed from Project + Task +
  Document — it is not its own data source.

**Status: reviewed and approved by Apoorv on 2026-09-15, with one addition
(`Task.module`, above). Schema/migration work may proceed.**

## 5. Decisions made (2026-09-15)

- **Tech stack**: Next.js + TypeScript (single codebase — React frontend +
  API routes/server actions in one app).
- **Database**: PostgreSQL.
- **Hosting / deployment**: Railway (app + Postgres together). No
  frontend/backend split — resolved by the Next.js-on-Railway choice.
- **Auth mechanism**: Session-based auth, email + password. No SSO for
  Phase 1.
- **UI framework / styling**: Tailwind CSS + shadcn/ui.
- **File/document storage**: Backblaze B2 (S3-compatible object storage),
  for document vault + version history (FR-005). Not Railway local volume —
  durability matters for a document vault. Originally planned as Cloudflare
  R2 (decided 2026-09-15); switched to B2 on 2026-09-17 because R2 requires
  a credit card on file to activate even for free-tier usage and Apoorv
  declined to provide one — B2's free tier (10GB, no egress-heavy limits)
  does not require a card. Both are S3-compatible, so `src/lib/storage.ts`
  is the only code that's provider-specific; swapping again later is cheap.
- **Multi-brand support**: Hardcode single brand for Phase 1. `brand` stays
  a plain string field on `FranchiseProject`, not a separate `Brand` entity.
  Can be normalized into its own table later without breaking the
  `project_id` relationship.
- **Permission granularity**: Role-based, module-level for Phase 1 (e.g.
  "Legal: read/write Documents, read-only Tasks"). No field-level rules yet.
- **Account provisioning (2026-09-18)**: No self-service signup. Accounts are
  created only by an Admin, via `/users/new`. `canManageUsers` (permissions.ts)
  is scoped to the `ADMIN` role specifically — narrower than
  `hasFullOverride` (which also grants MANAGEMENT broad task/document
  access) — because provisioning accounts is a system-administration action,
  not a cross-department content override.
- **Password set-up (2026-09-18)**: An admin-created user starts with no
  password (`User.passwordHash` is nullable) and is emailed a one-time
  "set your password" link (`PasswordResetToken`, purpose `INVITE`, 7-day
  expiry). The same token model/route (`/reset-password/[token]`) backs
  self-service "Forgot password" (purpose `RESET`, 1-hour expiry) — one
  mechanism, not two. This replaces `prisma/seed.ts`'s shared
  `DEV_PASSWORD` pattern for real users going forward; the seed script
  itself is unchanged (dev/demo accounts only).
- **Transactional email**: Resend (`RESEND_API_KEY`, `EMAIL_FROM` in `.env`
  — Apoorv already has an account). Used only for invite/reset emails so
  far. `EMAIL_FROM` must be on a Resend-verified domain to send to arbitrary
  recipients — the sandbox sender `onboarding@resend.dev` only delivers to
  the Resend account's own signup address, fine for local testing, not for
  real users (e.g. the Tulsi Agra contact in step 6).

## 6. NOT DECIDED YET — ask before assuming

(No open items as of 2026-09-21 — the six section 9 sub-decisions below were
all resolved this date. See section 9 for the resolved list and section 5 for
where standing decisions live.)

## 7. Step-by-step plan

1. ~~Review this plan and the data model diagram — confirm before any code.~~
   Done 2026-09-15 — stack/infra decisions (section 5) and data model
   sign-off (section 4) both confirmed by Apoorv.
2. ~~Decide tech stack~~ — done, see section 5.
3. ~~Build one thin vertical slice~~ — **done and verified 2026-09-15**:
   create a Project → see it on dashboard → add a Task → mark it complete →
   see the change in the audit log. Verified end-to-end in a real browser
   (Playwright), not just type-checked. Implementation notes:
   - App lives at the repo root (Next.js App Router, `src/` layout).
   - Local dev DB: `docker compose up -d` (Postgres on host port **5433**,
     not 5432 — this machine already runs a native Postgres on 5432).
   - Seed users: `npm run db:seed` (creates Admin/Sales/PM/Legal/Franchisee
     dev accounts — see `prisma/seed.ts` for emails; shared dev password
     documented there, not repeated here).
   - Pinned `prisma`/`@prisma/client` to `6.19.3` (exact) rather than
     whatever `npm install prisma` resolves to — the `latest` dist-tag
     currently points at an unstable `8.0.0-rc.*` with a materially
     different (driver-adapter-based) client architecture; 6.19.3 is the
     current stable line.
   - Real bug caught and fixed during verification: this project's shadcn/ui
     is Base UI-based (not Radix), and Base UI's `<Select.Value>` shows the
     raw selected `value` unless given an explicit value→label render
     function — every `<SelectValue>` in the app now passes one.
3a. **UI/UX pass — match SRD wireframe pack visually** — done 2026-09-16, at
    Apoorv's explicit request. Existing Phase 1 pages (dashboard, projects,
    project detail, audit log, login) were restyled to match the wireframe
    pack's look: dark navy left sidebar with the exact wireframe nav item
    list (items with no Phase 1 page yet — Lifecycle, Actions, Documents,
    Payments, People, Culinary, Marketing — render disabled/"Soon" rather
    than linking to non-existent pages), violet brand accent, top-right
    "FRANCHISEE PORTAL"/"INTERNAL" pill (wireframes 01-18 vs 19-24), stat-card
    rows, and a 13-stage lifecycle timeline grid on the project detail page
    (wireframe 02). No new fake data was introduced — every number shown
    (progress %, readiness, days to launch, per-module progress bars, "Latest
    Updates"/"Live Department Feed") is computed from real Task/AuditEvent
    rows, same placeholder-formula caveats as before (see step 3 above).
    Bugs found and fixed during verification: `humanize()` (built for
    SCREAMING_SNAKE_CASE enum values) was mangling AuditEvent.entityType
    (stored PascalCase, e.g. "FranchiseProject") into "Franchiseproject" —
    added `splitPascalCase()` instead; and a Base UI console warning on the
    "New Project" button (`nativeButton` expects a real `<button>`, but it
    renders a `<Link>`) — fixed with `nativeButton={false}`.
4. ~~Build out remaining Phase 1 FR items~~ — **FR-005 (Document Vault) done
   2026-09-17**, the last FR-table item (section 3) that wasn't yet built.
   Every Phase 1 FR (001, 002, 003, 005, 010) now has real pages/actions
   behind it — none left in this list as of this date. What shipped:
   - **Storage**: `src/lib/storage.ts` wired to Backblaze B2 (provider
     decision in section 5) — upload, and time-limited signed download URLs
     regenerated fresh per request (NFR-05: no public bucket URLs), not
     pre-signed at page-render time, so authorization is re-checked on every
     download attempt.
   - **Upload**: category-scoped upload form (Legal/Interiors/etc., gated by
     the same role→department matrix as Tasks) on each project's detail
     page. Creates a `Document` row and an `AuditEvent` in one transaction.
   - **List view**: a portfolio-wide `/documents` page (sidebar "Documents"
     link, previously disabled/"Soon", now live) — grouped by category, one
     row per lineage (current head only; superseded versions are collapsed
     into history, not hidden entirely), with a "Latest approved" badge and
     a client-side search box (title/file name/project — no server
     round-trip, Phase 1 document counts don't need real full-text search).
   - **Version history**: uploading a new version sets `supersedesId` on the
     new row and flips the previous row's status to `SUPERSEDED`, rather
     than deleting it — both changes write their own `AuditEvent`.
   - Verified live against the real B2 bucket and DB (upload/download
     round-trip, authorization allow/deny paths, version-chain state after a
     new upload), not just type-checked; the actual upload/version/search UI
     flows were click-tested in a real browser by Apoorv.
   - Bugs found and fixed during verification: (1) B2's own
     `b2-content-disposition` validator is stricter than RFC 6266 — it
     rejects punctuation like `(` even inside a quoted `filename` param, and
     separately JS's `encodeURIComponent` doesn't escape `! * ' ( )` at all,
     so a literal `(` in a real uploaded filename broke every download until
     both were fixed. (2) A redirect loop (`ERR_TOO_MANY_REDIRECTS`) on
     `/dashboard` in a session with a stale cookie: `proxy.ts`'s optimistic
     cookie-presence check let the request through, but `requireUser()`
     couldn't clear the invalid cookie itself (Next.js only allows
     `cookies().delete()` in a Server Function/Route Handler, not during
     Server Component render) — fixed by redirecting to a dedicated
     `/api/auth/clear-session` Route Handler that clears the session before
     bouncing to `/login`.
4a. **Forgot password + admin user creation** — done 2026-09-18. Built ahead
    of loading real site data (step 6) because step 6 needs real people
    (a real franchisee + a real internal owner, both required, non-nullable
    FKs on `FranchiseProject`) to exist as `User` rows first, and until this
    step there was no way to create one except the DB seed script. What
    shipped:
    - `PasswordResetToken` model (hashed-token, same discipline as
      `Session`) backs both flows — see section 5, "Password set-up".
    - `/forgot-password` → `/reset-password/[token]`: self-service reset.
      Deliberately reports the same generic "check your inbox" result
      whether or not the email matches an account (and swallows email-send
      failures the same way) — matches the existing login() discipline of
      never revealing which case it was.
    - `/users` (list, Admin-only) and `/users/new` (create form): name,
      email, role, and an optional free-text "department" label. Module
      access is **not** manually assigned here — it's entirely determined by
      the existing hardcoded role→department matrix
      (`src/lib/role-departments.ts`, extracted from `permissions.ts` so the
      client-side form can show "this role manages: ..." without importing a
      `server-only` file). The department field on the form is informational
      only.
    - New user creation emails an invite link immediately (purpose
      `INVITE`); a "Resend invite" button on `/users` re-sends it for anyone
      who hasn't set a password yet — added because the first real test of
      this flow will likely happen before `RESEND_API_KEY`/`EMAIL_FROM` are
      filled in, and that failure needed a clean recovery path instead of a
      crashed server action.
    - Sidebar "People" link now points at `/users` for Admin only; unchanged
      ("Soon") for every other role.
    - **Delete user** (added 2026-09-18, same day, after Apoorv's follow-up
      request): confirm-dialog delete on `/users`. Hard delete — every
      ownership FK on `User` (`FranchiseProject.franchiseeId/ownerId`,
      `Task.ownerId/createdById`, `Document.ownerId`, `TaskComment.authorId`)
      is `ON DELETE RESTRICT` and non-nullable, so a user who owns anything
      genuinely cannot be deleted; the resulting Postgres FK error is caught
      and shown as a clear message instead of crashing. Self-delete blocked.
      Writes a `DELETE` AuditEvent before the row goes.
    - **Edit + deactivate/reactivate user** (added 2026-09-18, same day):
      `/users/[id]/edit` — name, email, role, department, same "this role
      manages: ..." hint as the create form. `/users` also gets a
      Deactivate/Reactivate toggle using the pre-existing `User.isActive`
      field (no migration needed) — reversible, unlike delete. Both actions
      guard against locking the system out: can't change the last active
      `ADMIN`'s role away from Admin, and can't deactivate the last active
      `ADMIN`. Self-edit is allowed but self-deactivate/self-delete stay
      blocked (own row never shows those buttons). Deactivation takes effect
      immediately, not just at next login — `session.ts`'s `getCurrentUser()`
      already rejected `isActive: false` users on every request, so this
      needed no new session plumbing. Every change writes an `UPDATE`
      AuditEvent (old → new value).
    - **Not done / still open**: no deploy tooling yet (Railway is decided
      per section 5 but not wired up — still relevant once step 6 involves a
      real external user, not just Apoorv testing locally).
4b. **Lifecycle rework — independent, tappable, task-driven stages**
    (2026-09-18/19, at Apoorv's request). The original single
    `FranchiseProject.lifecycleStage` field modeled "the one current stage"
    for the whole project, assumed strict sequence, had no per-stage task
    checklist, and its status (In Progress/Completed) wasn't actually
    settable anywhere in the UI — a real gap, since in practice 3-4 stages
    run in parallel and each needs its own checklist. What shipped:
    - **Stages renamed/regrouped to 13**, matching the franchise lifecycle
      tracker sheet exactly (`Sales & Franchise Acquisition` → `Post
      Opening`) — replacing the previous ad-hoc 13-stage list. Old
      standalone stages not on the sheet (Accounts/HR/Culinary &
      Procurement as stages) are gone; the sheet's structure is now the
      source of truth (`src/lib/lifecycle-stage-tasks.ts`).
    - `FranchiseProject.lifecycleStage` **removed entirely** (and with it
      the FR-002 "Lifecycle stage" dropdown/field). A stage's status is now
      *derived*, not stored: `Task.lifecycleStage` (new, required) tags
      every task with one of the 13 stages, and
      `src/lib/lifecycle-stage-status.ts` computes Upcoming/In
      Progress/Completed from that stage's tasks (no task started →
      Upcoming; all done → Completed; otherwise → In Progress). Stages are
      independent — no sequence/dependency enforcement between them.
    - **`ProjectStageOverride`** (new model): Admin-only escape hatch to
      force a stage to Completed even with tasks still open (e.g. 7/11) —
      row present = forced; deleting it reopens the stage.
      `canForceCompleteStage` in `permissions.ts` is intentionally Admin-only
      (narrower than `hasFullOverride`).
    - **Tappable stage tiles**: each of the 13 tiles on the project detail
      page (`stage-tile.tsx`) opens a dialog listing only that stage's
      tasks, using the existing `TaskCard`/status/comment UI. Every new
      project auto-seeds ~150 tasks (one per sheet checklist item) across
      the 13 stages via `STAGE_TASK_TEMPLATES`; extra ad-hoc tasks beyond
      the checklist use the same `NewTaskForm` already on the page, now
      stage-scoped when opened from inside a stage dialog.
    - **Swappable + editable tasks** (2026-09-19 follow-up, same feature —
      Apoorv flagged this was missing from the first pass): task titles are
      editable inline (`updateTaskTitle`) from both the stage dialog and the
      flat Tasks list. Ordering within a stage is a new `Task.order` int
      column — seeded tasks get the sheet's own order, ad-hoc tasks append
      to the end, and ▲/▼ buttons in the stage dialog (`moveTask` action)
      swap a task with its neighbor. Reorder controls only render in the
      stage-scoped dialog (`stage-tile.tsx` passes `canMoveUp`/`canMoveDown`
      by array position), not the flat project-wide Tasks list, since that
      list spans all 13 stages and has no single order to swap within.
    - **Dummy/test data reset** (2026-09-19): the 3 seed-era projects (1
      task, 2 documents) were deleted outright rather than migrated, per
      Apoorv's explicit call — they predated the sheet-based stage
      structure and were actively confusing verification. `AuditEvent` rows
      for them were kept (their `projectId` FK is `ON DELETE SET NULL`, by
      original design — NFR-06 wants an immutable audit history even after
      the entity it describes is gone).
4c. **Removed the hardcoded `DEV_PASSWORD` from `prisma/seed.ts`** (2026-09-19)
    — closes the "not done" item flagged in 4a. The literal password string
    was a git-committed source file, not a `.env` value, so it stayed in
    history on every clone/fork regardless of `.gitignore`; one of the
    accounts it seeded shares `tech@fraterniti.co.in`'s real admin address.
    Seed script now reads `SEED_DEV_PASSWORD` from the environment and
    throws immediately if it's unset — `.env.example` documents the
    variable (empty placeholder), `.env` (gitignored) holds the real value
    for this machine. No behavior change for local dev beyond the one-time
    step of setting the env var; this does not rewrite git history, so the
    old literal is still recoverable from past commits — worth a `git log -p`
    sweep before this repo is ever made public.
4d. **Action Centre placeholder (FR-004)** (2026-09-19) — was scoped into
    Phase 1 (section 2: "Phase 1 only needs a placeholder list view in
    Action Centre, not the approve/reject engine") but never built; sidebar
    "Actions" rendered "Soon" like the genuinely-deferred Phase 2/3/4 items.
    What shipped: `/actions` — a read-only queue built entirely from `Task`
    (the only actionable-item entity Phase 1 actually has; Approval/Payment
    are still Phase 2), reusing `canActOnTask` for the same
    module-ownership/owner/franchisee-isolation rules as everywhere else.
    Stat cards (Critical / Overdue / Awaiting You / Completed This Week) and
    a sorted list (overdue first, then priority, then due date) link each
    task straight to its existing stage page — no new mutation logic, no
    approve/reject engine, matching the Phase 1 scope note exactly. Sidebar
    "Actions" now points at it for every role. Verified against the real DB
    over an authenticated session (not just type-checked): both an internal
    (Admin) and a Franchisee session render 200 with correct data and no
    server errors, franchisee view confirmed scoped to their own project.
5. **Test/review each ticket** before starting the next one.
6. **Load one real site's data** (e.g. an active Tulsi site) — now the
   natural next step, since every Phase 1 FR is built and dummy/seed data is
   the main thing standing between this and a real pilot.

## 8. Reference

Full detail in source SRD: sections 4 (functional requirements), 8 (full data
model — all entities, Phase 2+ included), 16 (delivery phases), 18 (handoff
notes for Apoorv).

## 9. Founder request (2026-09-21) — unified construction/ops progress tracking

**Where this came from:** the founder's ask, in his own words (paraphrased
from a voice note) — one platform where every team uploads how far its own
work has reached, and the system rolls that up into a completion
"barometer": *construction itna pahunch gya, woodwork itna hogya* (how far
construction has reached, how far woodwork has reached), per category and
per site, instead of each team filling its own spreadsheet.

**What it's replacing** — seven files reviewed, which turn out to be one
fragmented workflow, not seven separate things:
- `BOQ_Format_for_costing.xlsx` — master reference list, ~400 construction
  line items (RCC, masonry, tiling, plumbing, electrical, ducting, AC,
  lighting, furniture...) with unit/qty/rate/amount.
- `Operations_List.xlsx` — master reference checklist, ~430 ops tasks by
  department (Admin, Legal, HR, Marketing, Culinary...), tagged Pre/Post
  Opening.
- `Construction_Gantt_Report_Format_Fraterniti_Foods.xlsx` /
  `Operation_Gantt_Report_Fraterniti_Foods.xlsx` — the two lists above,
  copy-pasted per site into a Vertex42 Gantt template (~300 and ~360 rows),
  each task with a manually-typed 0–1 Progress fraction. Site name was never
  filled in on either — nothing ties a copy back to which site it's for.
- `Site_Status_Fraterniti_Foods.xlsx` — 22 sites × 13 milestone columns,
  meant to be the summary of the two Gantts above, but almost entirely blank
  — because nothing links it to the detail sheets; someone would have to
  manually re-tally ~700 progress cells into 13 checkboxes.

**The good news:** most of the mechanism this needs already exists in the
app, built for the lifecycle-stage rework (step 4b) — this is an extension
of that pattern, not a new module:

| Founder's ask | Already built as |
|---|---|
| Teams see/update only their own slice | RBAC role→department matrix (section 5) — already scopes Task access by module |
| Master checklist cloned onto each new site | `STAGE_TASK_TEMPLATES` auto-seeding ~150 tasks per project (step 4b) |
| Progress rolls up automatically, nobody hand-tallies | `lifecycle-stage-status.ts` deriving Upcoming/In Progress/Completed from a stage's tasks (step 4b) — the barometer mechanism already works, just at the 13-SOP-stage level, not yet at trade/category level |
| Every update accountable | AuditEvent on every Task change (already mandatory, section 4) |
| Category tag (construction trade / ops department) | `Task.module` (section 4) — already the right field for "woodwork", "electrical", etc. |

So the shape of the work is: feed the BOQ (~400) and Ops (~430) master lists
into the same seeding mechanism as `STAGE_TASK_TEMPLATES`, tagged by
`Task.module`, and add a `Task.module`-level roll-up next to the existing
`Task.lifecycleStage`-level one. **Not** a new tracker, new permissions
system, or new upload mechanism.

**Decisions (confirmed by Apoorv, 2026-09-21)** — all six items resolved,
after verifying against the actual schema first (`Task.status` today is
`NOT_STARTED/IN_PROGRESS/AWAITING_FRANCHISEE/AWAITING_INTERNAL/BLOCKED/
COMPLETED/CANCELLED`; `Document` has no task-level FK, only `projectId`):

1. **Task volume/granularity**: one Task per BOQ/Ops line item — ~830 extra
   tasks/site, seeded the same way `STAGE_TASK_TEMPLATES` seeds the existing
   ~150.
2. **Progress granularity**: keep the existing `Task.status` enum. No new
   numeric `progressPercent` field/migration.
3. **Category-level roll-up**: confirmed as a second axis alongside the
   existing lifecycle-stage roll-up, the same way `Task.lifecycleStage`
   drives `lifecycle-stage-status.ts` today. Both roll-ups read the same Task
   rows; neither replaces the other. Originally scoped as "`Task.module`
   drives it" — revised once the real data arrived and showed ~28 distinct
   trade/department categories, too granular for the 13-value `Department`
   enum `module` uses for RBAC; shipped as a new `Task.category` field
   instead (see the "Shipped" write-up below). `module` is unchanged.
4. **Portfolio-wide barometer view**: stays in Phase 4, per section 2. Phase
   1 (this section) ships per-project only — no cross-site view now.
5. **Task-level photo/document attachment**: no `Document.taskId` FK, no
   migration. "Upload progress" is satisfied by the existing project-level
   Document vault (category/module-tagged) plus Task comments/
   `completionEvidence`.
6. **BOQ ₹ rate/amount data**: confirmed out of scope. Only quantity/line
   item/status comes in from the BOQ; rate, amount, and all costing stays
   out of Fraterniti One until Phase 2 (FR-006).

**Shipped 2026-09-21**, ahead of step 6 (Apoorv's call when asked to sequence
the two) — following the existing step 4b pattern (`STAGE_TASK_TEMPLATES`
seeding + a derived roll-up alongside `lifecycle-stage-status.ts`), not a
parallel mechanism. One revision to decision #3 above, made mid-build after
seeing the real data: **the roll-up axis is a new `Task.category` field, not
`Task.module`** — the real BOQ/Ops master checklist carries ~28 distinct
trade/department categories (AC Work, Electrical, Carpentry, Culinary, HR,
...), too granular for the 13-value `Department` enum `module` uses for RBAC.
`module` is untouched and still drives RBAC as before.

What shipped:
- **Real seed data, not fabricated**: Apoorv supplied the actual BOQ/Ops
  master checklist (`boq_ops_master_checklist.csv`, 658 rows). Cleaned
  (mojibake fixed, spreadsheet-artifact/junk rows dropped, costing-only rows
  dropped per decision #6, exact + within-batch duplicates deduped against
  both the existing ~150-item checklist and each other) and classified
  (rule-based stage/department mapping) down to 566 real line items, reviewed
  by Apoorv row-by-row in a published filterable/searchable artifact before
  anything was seeded. Two corrections came back from that review (a
  within-batch dedupe pass catching 6 cross-category duplicates; moving
  "Royalty & Service Fee Bill Generation"/"Royalty Follow-ups" from
  Operations Preparation to Post Opening, since royalty billing only starts
  once a site is trading) — both applied before this build started.
- **`Task.category`** (nullable `String`, indexed): migration
  `20260921075143_add_task_category`. Nullable because the original ~150-item
  lifecycle checklist predates this axis and has no category of its own.
- **`src/lib/ops-progress-tasks.ts`**: `OPS_PROGRESS_TASK_TEMPLATES`, one
  entry per reviewed line item (category, title, lifecycleStage, module) —
  same shape/spirit as `STAGE_TASK_TEMPLATES`.
- **Seeding**: `createProject` (`src/app/(app)/projects/actions.ts`) now
  seeds both the lifecycle checklist and the BOQ/Ops list on every new
  project — **158 + 566 = 724 tasks/site**. Ops tasks continue each stage's
  existing `order` counter (checklist items first, ops items appended),
  matching the "ad-hoc tasks append to the end" convention `order` already
  had.
- **`src/lib/category-progress.ts`**: `computeCategoryProgress`, the second
  roll-up axis — same Upcoming/In Progress/Completed derivation as
  `computeStageStatus`, grouped by `category` instead of `lifecycleStage`.
  Tasks with no category (the original checklist) are excluded from this
  view, same way stage 0 has always been unaffected by this axis.
- **UI**: a "Construction & Ops Progress" card on the project detail page,
  below the existing 13-tile lifecycle grid — one read-only tile per
  category (~28 of them) with a progress bar. Deliberately **not**
  tappable/no drill-down page, unlike stage tiles: the founder's ask was a
  rolled-up percentage ("construction itna pahunch gya"), not a new place to
  manage tasks — those are still managed from the existing stage
  pages/flat Tasks list. Flagged here in case Apoorv wants tap-through later.

Real bug hit and fixed during verification: the original per-row
`tx.task.create` + `tx.writeAuditEvent` loop (steps 4b's pattern) does two
sequential DB round trips per task — fine at ~150 tasks/site, but at 724
tasks/site that's ~1,450 round trips inside one interactive transaction,
comfortably over Prisma's default 5s transaction timeout. Confirmed this
would have silently broken project creation once real data replaced the demo
checklist. Fixed by switching both the checklist and ops seeding to
`tx.task.createManyAndReturn` + `tx.auditEvent.createMany` (2 round trips
total) — still one CREATE AuditEvent per Task (plan.md section 4's audit rule
is unchanged), just issued in bulk. This also changes the pre-existing
158-task seeding path, not just the new one — worth knowing if `git blame`
on that block looks surprising later.

Verified against the real dev DB and a real browser session (Playwright,
same bar as every other step): logged in as Admin, created a live test
project end to end through the actual `/projects/new` form, confirmed 724
tasks were created (158 + 566, matching exactly), confirmed all 13 stage
tiles and all ~28 category tiles rendered with the expected counts (e.g.
Construction Execution 283 = 269 ops + 14 checklist; Grand Launch 11 = 1 ops
+ 10 checklist), zero browser console errors, then exercised the write path
live — flipped one AC Work task from Not Started to Completed through the
real status-update form and confirmed the AC Work category tile updated from
"Upcoming · 0/48" to "In Progress · 1/48" on a fresh page load. Test project
deleted afterward (same precedent as step 4b's dummy-data cleanup — Task rows
cascade-deleted, AuditEvent rows kept via `SetNull`, per NFR-06).

Also hit, unrelated to this feature: the pre-existing local `next dev`
process had gone into a bad state (routes 404ing) after being interrupted
mid-session — cleared `.next` and restarted it, back to normal. Not a code
bug, noted only because it cost real debugging time before the actual cause
(a test-script bug — my Playwright script's submit-button selector was
matching the sidebar's "Sign out" button, not "Create Project") was found.

**Still open, now more pressing**: the stage-tile/flat-Tasks-list volume
concern flagged when this section was first scoped (Construction Execution
and Operations Preparation stage dialogs already had 269/228 tasks; the flat
project-wide Tasks list now renders all 724 in one page) was **not**
addressed in this build — no UI grouping/pagination was added, since that
wasn't part of the six confirmed decisions and is a real design call, not an
obvious one. It rendered correctly in testing (no crash, no console errors)
but a 724-card scroll is a real UX problem for daily use. Needs Apoorv's
input before the next real site is loaded (step 6).

## 10. Admin delete-project + old demo data cleanup (2026-09-21)

**Where this came from:** Apoorv's ask — clear out the pre-existing "Tulsi —
Bengaluru" demo project (created 2026-09-19, before section 9 shipped, so it
only ever had the 158-task lifecycle checklist, not the real 724-task
BOQ/Ops seed) so he could create a fresh project himself and see the full
section 9 seeding live, and give Admin a project-delete option for this going
forward — deliberately *not* hardened against misclicks (his words: keep it
simple, no extra checks), just a plain confirm step, same as the existing
`DeleteUserButton` pattern.

What shipped:
- **`canDeleteProject`** (`src/lib/permissions.ts`) — ADMIN only, same
  narrowness as `canManageUsers`/`canForceCompleteStage` (not extended to
  MANAGEMENT via `hasFullOverride`). Not an explicit ask which roles beyond
  Admin should get this — narrowest reasonable default; flag if Apoorv wants
  Management to have it too.
- **`deleteProject`** (`src/app/(app)/projects/actions.ts`) — hard delete.
  Every child row (Task, TaskComment, Document, ProjectStageOverride)
  cascades via the existing `onDelete: Cascade` FKs; `AuditEvent.projectId`
  is `onDelete: SetNull`, so the audit trail — including this action's own
  DELETE event with an oldValue snapshot of the project — survives the
  project itself being gone (NFR-06).
- **`DeleteProjectButton`** (`src/app/(app)/projects/[id]/delete-project-button.tsx`)
  — a "Delete project" button next to "Audit trail →" in the project detail
  page header, visible to Admin only. Clicking it opens a confirm dialog
  (name of the project, one-line warning, Cancel/Delete).
- **Revision same day**: Apoorv asked for a type-to-confirm gate after all —
  the dialog now requires typing the exact phrase `Delete project: {brand}
  {location}` (e.g. `Delete project: Tulsi Bengaluru`) before the Delete
  button enables; it's disabled by default and stays disabled on any
  non-matching text. Client-side only (`confirmText === confirmPhrase`), on
  top of the same server-side `canDeleteProject` check — the phrase includes
  the project's own name so it can't be muscle-memory-typed against the
  wrong project.

No real bug hit this time — verified clean on the first pass.

Verified against the real dev DB and a real browser session (Playwright):
logged in as Admin, opened the live "Tulsi — Bengaluru" project, clicked
"Delete project", confirmed the dialog text, submitted, landed back on
`/dashboard` with the project no longer listed, zero console errors. Confirmed
at the DB layer: 0 `FranchiseProject` rows and 0 `Task` rows remain, and the
project's own audit trail (CREATE from 2026-09-19, DELETE from this run) is
still queryable with `projectId: null` and the DELETE event's `oldValue`
snapshot intact. Database is now empty of projects — ready for a fresh one to
be created live through the app.

Re-verified after the confirm-gate revision, against a throwaway test project
(created directly via Prisma, deleted afterward through the feature itself):
button disabled on dialog open, stayed disabled with a deliberately-wrong
confirm string, enabled only once the exact phrase was typed, delete
succeeded, zero console errors. Left the real "Tulsi — Bengaluru" project
Apoorv created himself in the meantime untouched (724 tasks, 566 with a
category — matches expected seeding).
