# Fraterniti One — Build Plan (Phase 1: Foundation)

> **How to use this file (for whoever is implementing, including Claude Code):**
> This is a living plan, not a one-shot spec. Anything under "NOT DECIDED YET"
> must be asked about and confirmed before you write code that depends on it —
> do not silently pick a default. When a decision gets made, move it from
> "NOT DECIDED YET" into the relevant section above it and update this file.
>
> **Layout (2026-10-22):** this file holds sections 1-8 only — the evergreen
> scope, data model and standing decisions. Sections 9-27 (one dated feature
> slice each: mental model, decisions, build log, its own "NOT DECIDED YET")
> moved out to `docs/plan/NN-slug.md`, one file per section, same numbering —
> see the index at the end of section 8. This was a pure relocation (verified
> byte-for-byte against the pre-split file); no content was changed, and every
> existing "plan.md section N" reference in code comments/`BLOCKERS.md` still
> resolves to `docs/plan/N-*.md`. Section 9+ work still updates its own file
> the same way it used to update its section of this one.

---

## 1. Context

Fraterniti One replaces manual Excel trackers (site lifecycle tracker, vendor
status tracker, individual department sheets) with one system: one franchise
= one Project ID, everything else (tasks, documents, approvals, payments)
attaches to it. Full source spec: `Fraterniti_One_Software_Requirement_and_Wireframes.pdf`
(sections referenced below).

This plan covers **Phase 1 only**, per the SRD's recommended delivery phases (section 16):
Auth/RBAC, Project master, Lifecycle, Home dashboard, Action Centre, Documents, Tasks, Audit.

**Update 2026-09-25:** a second handoff document,
`Fraterniti_One_Phase1_Onboarding_LOI_SRD.pdf` (v1.0, 25 Sept 2026), adds
**franchise onboarding, KYC, payment-proof verification and LOI Aadhaar
e-sign**. Sir's instruction: this is built **inside Fraterniti One, not as a
separate web app**. It is specified in section 17. It runs *before* the
project lifecycle above: a store onboarding record reserves a Project ID and,
on LOI Complete, becomes the `FranchiseProject` (no duplicate).

**Update 2026-10-03:** LOI signing is by **Aadhaar eSign through Leegality**
(section 19). Both signers sign this way — the franchisee first, then the
company signatory (role `COMPANY_SIGNATORY`, kept exactly as section 17 defined
it). The short-lived SMS OTP plan (2026-10-01 to 2026-10-03) is dropped and its
mock code is being removed from the codebase. The LOI also gets a "Fraterniti
Foods Pvt. Ltd." watermark and can be edited while it is a draft.

**Update 2026-10-10:** live sales from the POS. Petpooja's Global API pushes
every printed bill to a webhook; **section 26** plans receiving it inside
Fraterniti One (one public route, one row per bill, the existing `SalesDay`
totals recomputed from it). It extends section 20A, which already has the
`/sales` screens and CSV import. Customer data in the payload is discarded.

## 2. Explicitly OUT of scope for this plan

Do not build these yet, even if referenced in the SRD:
- Sales/Legal/Interiors/Projects/DPR module screens (Phase 2)
- Approval workflow logic (FR-004) — full version is Phase 2; Phase 1 only needs
  a placeholder list view in Action Centre, not the approve/reject engine
- Payment schedules, invoices, CRM (FR-006) — Phase 2. (Section 17's
  verification of the *single initial LOI payment* is NOT this; it is only
  receipt + UTR review by Accounts, no schedules/invoices.)
- HR, Culinary, Procurement, Marketing modules — Phase 3
- Readiness score, blocker/dependency engine (FR-007, FR-008) — Phase 4
- Notifications (WhatsApp/email/SMS) (FR-009) — Phase 4/deferred. Exception:
  section 17 needs the small fixed set of onboarding **emails via Resend**
  (invitation, correction request, payment accepted/rejected, signing ready,
  franchise signed, company signed, LOI complete). No WhatsApp, no
  general notification engine. **No SMS at all (2026-10-03):** the LOI signing
  OTP by SMS was dropped; signing is Aadhaar eSign on Leegality (section 19),
  where UIDAI sends the signer's OTP, not us. Leegality's own invitation and
  reminder messages are switched off; its mandatory confirmation/completion
  emails are accepted.
- Management Command Centre, portfolio-level views — Phase 4
- **Exception (proposal, 2026-10-08):** section 24 pulls a *small slice* of
  FR-004 (approval gates), FR-007 (delay/blocker view) and FR-009 (one daily
  reminder email via Resend) forward. It is a PROPOSAL until the founder
  confirms; do not build any of it before that.

## 3. Phase 1 scope — functional requirements in play

| FR ID  | Requirement                                                        |
|--------|---------------------------------------------------------------------|
| FR-001 | One Project ID created at onboarding; everything attaches to it     |
| FR-002 | Lifecycle stage, progress %, target opening, owner, next action on dashboard |
| FR-003 | Task workflow — owner, due date, priority, dependency, status, comments |
| FR-005 | Document vault with categories and version history                  |
| FR-010 | Full audit log — actor, timestamp, old/new value, reference          |
| P1-01 … P1-10 | Onboarding, KYC, payment proof, LOI, two-stage Aadhaar e-sign, audit, statuses — see **section 17** (from `Fraterniti_One_Phase1_Onboarding_LOI_SRD.pdf`) |

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
- **Hosting / deployment**: ~~Railway~~ **Vercel**, switched 2026-09-21
  (undocumented at the time — see section 12). App is deployed to Vercel;
  where production Postgres now lives (still Railway, moved to Vercel
  Postgres, or elsewhere) is **not confirmed from the repo** — no
  `vercel.json`/IaC file commits it either way. Worth confirming with
  Apoorv rather than assuming. No frontend/backend split — Next.js API
  routes/server actions stay in the one app either way.
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
- **E-sign provider (2026-10-03)**: **Leegality, Aadhaar eSign**, v3 API with
  the "Legacy Auth Token" in the `X-Auth-Token` header (`ESIGN_PROVIDER=
  leegality`, `LEEGALITY_BASE_URL`, `LEEGALITY_AUTH_TOKEN`,
  `LEEGALITY_PRIVATE_SALT`, `LEEGALITY_PROFILE_ID` in `.env`; the mock e-sign
  provider stays for local testing). The company already holds Leegality
  credits; each LOI uses 2. Workflow setup, credits and secrets are human steps
  tracked in section 19 and `BLOCKERS.md`; Claude Code never does them. No SMS
  provider is in use (the 2026-10-03 Fast2SMS decision was withdrawn the same
  day).

## 6. NOT DECIDED YET — ask before assuming

(No open items for sections 1-16 as of 2026-09-21 — the six section 9
sub-decisions below were all resolved this date. See section 9 for the
resolved list and section 5 for where standing decisions live.)

**Section 17 (onboarding / KYC / LOI e-sign, added 2026-09-25)** has its own
open items — e-sign vendor, approved LOI template, KYC list per entity type,
signatory, Workspace method, partial payments, Aadhaar retention. Each has a
**working default** so the build is not blocked; see section 17 "NOT DECIDED
YET". Build to the defaults, keep them behind config/adapters, and ask before
treating any of them as final.

**Section 19 (LOI signing, rewritten 2026-10-03 for Leegality Aadhaar
eSign)** has its own open items. The provider is **decided: Leegality**, and
the company signatory **stays** and signs the same way after the franchisee.
Still open there: signing-link expiry, a sandbox account, whether `ADMIN` may
company-sign, Aadhaar name/last-4 checks, company seal, the exact watermark,
what is editable in a draft LOI, and stamp duty. See section 19 "NOT DECIDED
YET" and `BLOCKERS.md`.

**Section 24 (delay tracking, approvals and vendor links, proposed 2026-10-08)**
has 11 open items of its own — SLA numbers, which tasks need approval and who
approves, escalation recipient, daily revenue per store, digest time, vendor
link expiry, and more. Each has a working default; SLA numbers are never
invented (they come from Apoorv and the ops heads). See section 24 "NOT DECIDED
YET".

**Section 26 (live Petpooja sales webhook, added 2026-10-10)** has 9 open
items of its own — Gross/Net definitions, API cost, business-day cut-off,
token vs URL secret, line items, payload retention and more. Each has a working
default; the Petpooja enablement, cost approval and pilot comparison are human
steps. See section 26 "NOT DECIDED YET".

**Section 20 (remaining investor-SRD items, added 2026-10-01)** has its own
open items — POS export layout, mandatory new KYC documents, per-document
review, extra profile fields, OTP login. Same rule: each has a working default,
ask before treating it as final.

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

### Feature section files (sections 9-27)

9. [Founder request (2026-09-21) — unified construction/ops progress tracking](docs/plan/09-unified-construction-ops-tracking.md)
10. [Admin delete-project + old demo data cleanup (2026-09-21)](docs/plan/10-admin-delete-project-cleanup.md)
11. [Task-list search/pagination + Action Centre franchise picker (2026-09-21)](docs/plan/11-task-search-franchise-picker.md)
12. [Deploy fixes — Vercel (2026-09-21/22)](docs/plan/12-deploy-fixes-vercel.md)
13. [UX polish pass — task cards, project page nav, document upload, tile styling (2026-09-22/23)](docs/plan/13-ux-polish-pass.md)
14. [Standalone Construction & Ops Progress screen + sidebar entry (2026-09-23)](docs/plan/14-standalone-construction-ops-screen.md)
15. [BOQ/Construction & Ops Progress split + Excel-accurate fill (2026-09-24)](docs/plan/15-boq-construction-ops-split.md)
16. [Mobile field interface — WhatsApp-style upload UI for site supervisors (decided 2026-09-24)](docs/plan/16-mobile-field-interface.md)
17. [Franchise onboarding, KYC, payment proof and LOI e-sign (added 2026-09-25)](docs/plan/17-onboarding-kyc-loi-esign.md)
18. [Email domain whitelist + Complaint/Support module — adapted from a separate investor-onboarding SRD (2026-09-30)](docs/plan/18-email-whitelist-complaint-support.md)
19. [LOI signing by Aadhaar eSign through Leegality (rewritten 2026-10-03; replaces the SMS OTP plan)](docs/plan/19-loi-leegality-esign.md)
20. [Remaining investor-SRD items — sales tracking, dashboard widgets, KYC document types, search/export, OTP login (added 2026-10-01)](docs/plan/20-remaining-investor-srd-items.md)
21. [Payment/LOI gate fixes + store-onboarding admin revamp — retrospective documentation (2026-10-06/07)](docs/plan/21-payment-loi-gate-fixes-store-onboarding-revamp.md)
22. [Navigation/performance smoothing pass — retrospective documentation (2026-10-07)](docs/plan/22-navigation-performance-smoothing.md)
23. ["Already onboarded" / pre-existing franchisees (2026-10-08)](docs/plan/23-already-onboarded-franchisees.md)
24. [Delay tracking, approvals and vendor links — ideas adapted from Nodomo (proposed 2026-10-08)](docs/plan/24-delay-tracking-approvals-vendor-links.md)
25. [Founder/board summary screen + weekly digest (2026-10-09)](docs/plan/25-founder-board-summary-weekly-digest.md)
26. [Live Petpooja sales via webhook — Global API (added 2026-10-10)](docs/plan/26-petpooja-live-sales-webhook.md)
27. [Five days of undocumented commits — production hardening, task/RBAC rework, user-category rework (2026-10-16/21)](docs/plan/27-undocumented-commits-production-hardening.md)

