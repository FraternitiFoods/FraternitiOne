## 16. Mobile field interface — WhatsApp-style upload UI for site supervisors (decided 2026-09-24)

**Where this came from:** the founder wants the people who actually produce
progress data (site supervisors, later employees) to upload it from a
WhatsApp-feeling screen, not from the office web app. Reference: Linemate
(`Linemate WhatsApp-Based Frontline Operations Platform` deck) — its chat look
is a wrapper; the real work is structured, tap-to-answer forms. We copy that
idea. **We do not use WhatsApp or any WhatsApp service.** It only looks and
feels like it.

### Mental model

```
Supervisor phone                Same Fraterniti One app              Office
/m/... chat-style screens  →    Task, Document, AuditEvent   →    /boq, project page,
(new routes, same codebase)     (same DB, same B2 bucket)         Document Vault
```

Cause → effect: supervisor picks a task and uploads a photo/video → a
`Document` row is created and linked to that `Task` → `Task.status` becomes
`COMPLETED` → `AuditEvent` rows are written → the category tile on `/boq`
moves on its own. No sync job, no second system.

### Decisions (confirmed by Apoorv, 2026-09-24)

1. **No new web app.** Added as new routes (e.g. `/m/...`) inside the existing
   Next.js app. Same DB, same auth/session layer, same storage.
2. **Not real chat.** No free-text messaging, no group conversations, no
   supervisor-to-supervisor talk. It is a WhatsApp-like *look*: a list of
   project "chats", and inside one, a message-bubble style flow.
3. **One project = one "chat".** A supervisor sees only the projects they are
   assigned to.
4. **Upload flow (tagging is mandatory — no untagged uploads):**
   `open project chat → send photo/video → pick category (AC Work, Board Work,
   Fire Work...) → pick task inside it (checkbox-style list) → file saved
   against that Task`.
   The file cannot be submitted until both category and task are picked.
5. **Scope for now: BOQ only.** Categories offered are the BOQ-routed ones
   (`ops-route.ts`), same list `/boq` rolls up. Ops/Construction & Ops
   Progress categories are not offered to supervisors yet.
6. **Status rule (kept simple):** a successful upload sets the linked Task to
   `COMPLETED`. Existing `Task.status` enum is unchanged; no % field.
7. **Login: phone number + PIN.** Accounts are created by an Admin from the
   existing `/users/new` flow (extended with a phone field and role). No
   self-signup, no OTP/SMS, no DLT registration.
8. **No notifications.** No web push, SMS or email for this feature.
9. **Reversal of section 9, decision #5:** "no `Document.taskId` FK" is now
   overturned. A `Document` can belong to a specific Task (nullable FK, so the
   existing project-level vault documents keep working).
10. **PIN is 6 digits, admin-set at creation (confirmed 2026-09-24, during
    build order step 2).** No 4-digit option. The admin sets it directly in
    `/users/new` — there's no invite-link equivalent for a phone-only
    account, given decisions 7/8 already rule out OTP/SMS/email/notifications
    as a delivery channel.
11. **PIN lockout (confirmed 2026-09-24, during build order step 3):** 5
    consecutive wrong PINs locks that phone number for 15 minutes; the
    counter resets on a correct login, and the admin's "Reset PIN" action
    also clears an active lock immediately. This closes out the last open
    part of decision 10/PIN rules — nothing left open on PINs.
12. **"Work not on the list" (confirmed 2026-09-24, during build order steps
    4-6):** every BOQ category gets one reusable "Other (not on checklist)"
    task, not an admin-adds-it-first flow. Chosen over the recommended
    option specifically because it never blocks a supervisor waiting on the
    office. To keep decision 6 (upload → Task `COMPLETED`) true without
    exception, "Other" isn't special-cased to stay open — instead,
    `finalizeUpload` auto-creates a fresh replacement "Other" task the
    instant the previous one is used, in the same transaction, so the
    picker always has exactly one available. First created lazily, the
    first time a supervisor opens that category (self-healing for existing
    projects too — no separate backfill script needed).
13. **Upload size limit (confirmed 2026-09-24, during build order steps
    4-6):** 50MB per file, checked server-side before a presigned URL is
    issued (client-side checks the same limit first, for instant feedback,
    but the server check is the real gate). No client-side compression.

### What gets built (new vs reused)

Reused as-is: `Task`, `AuditEvent`, `Document` + B2 storage
(`src/lib/storage.ts`), `ops-route.ts` (BOQ/OPS split), category list, session
layer, admin user management.

New:
- **Role `SITE_SUPERVISOR`** plus a `ProjectMember` table (userId, projectId).
  Access rule for supervisors: only assigned projects, only BOQ-routed tasks,
  only "upload + mark complete". This is a new permission path — the existing
  role→department matrix does not fit because a supervisor spans many trades.
- **`User.phone`** (unique) and a PIN credential. `User.email` is currently a
  required unique field; it must become optional for supervisors who have no
  email (migration).
- **`Document.taskId`** nullable FK (migration).
- **`/m` route group**: project list ("chats") → project chat → category picker
  → task picker → upload/confirm. Mobile-first, installable as a PWA (home
  screen icon) purely for feel; not needed for notifications.
- **Upload path**: phone → B2 directly through a presigned upload URL (bucket
  CORS needed), then a server action records the `Document`, links the Task,
  sets status, writes AuditEvents in one transaction. Reason: Vercel request
  bodies are capped (about 4.5 MB per the platform docs — confirm), which a
  phone video will exceed.
- **Admin side**: `/users/new` gets phone, PIN and "assign to projects".
  Admin can reset a PIN.
- **Office side**: files show up inside the Task (category page and stage
  page), and in the Document Vault, using existing views.

### Cause → effect that must hold

- A supervisor upload without a chosen Task must be rejected server-side, not
  just hidden in the UI.
- Every upload writes a `Document` CREATE event, and the status change writes
  a Task UPDATE event (old → new value). Audit rule from section 4 applies.
- A supervisor can never see or touch a project they are not a member of, even
  by guessing a URL or id.

### Suggested build order — step 1 shipped (2026-09-24)

**Schema: `User.phone`, optional email, PIN, `SITE_SUPERVISOR`, `ProjectMember`,
`Document.taskId`.** Migration `20260924071435_add_supervisor_mobile_upload`,
applied to the real dev DB (Bengaluru/Ashok Vihar, 963 tasks each — both keep
working, nothing backfilled/touched). What shipped:
- `Role.SITE_SUPERVISOR` added to the enum.
- `User.email` is now nullable (still unique when present — Postgres allows
  multiple NULLs under a unique constraint). `User.phone` (nullable, unique)
  and `User.pinHash` (nullable, hashed like `passwordHash`) added.
- `ProjectMember` (new): `userId` + `projectId`, `@@unique` on the pair — the
  server-side "is this supervisor even allowed to see this project" gate for
  every future `/m` page/action, separate from (not a replacement for)
  `permissions.ts`'s existing department matrix.
- `Document.taskId` (new, nullable, `onDelete: SetNull`) — reverses section 9
  decision #5, per section 16 decision 9.
- Null-safety fallout from `User.email` going optional, fixed across the
  codebase so `tsc`/`eslint` stay clean: `CurrentUser.email` and
  `ValidatedResetToken.userEmail` are now `string | null`;
  `writeAuditEvent`'s `actorEmail` (still a required column — NFR-06 wants an
  immutable snapshot) falls back to `"(no email on file)"`; a few
  email-sending call sites (`resendInvite`, `forgot-password`) now guard or
  use the already-validated non-null value instead of re-reading the nullable
  column; `DEPARTMENT_OWNERS` and `ROLE_LABELS` (both `Record<Role, ...>`)
  gained a `SITE_SUPERVISOR` entry (empty department list — a supervisor's
  access is `ProjectMember`-scoped, not department-scoped).
- `/users/new` and `/users/[id]/edit`'s role dropdowns deliberately **exclude**
  `SITE_SUPERVISOR` for now — both forms only collect email+password;
  creating one today would leave phone/PIN null and permanently locked out.
  Build order step 2 extends `/users/new` with the fields a supervisor
  actually needs, at which point it gets re-added there.

**Two unplanned things found and fixed along the way, worth knowing about:**
1. **An orphaned, uncommitted migration already existed on the real dev DB.**
   `_prisma_migrations` had a row for `20260922000000_add_document_task_link`
   (dated two days before section 16 was even decided), and a same-named
   folder existed on disk — but empty, no `migration.sql` inside, not in git
   history, no branch/stash reference anywhere. The DB itself had already
   received a `Document.taskId` column from it — 0 rows affected (`Document`
   table was empty), but with `onDelete: CASCADE`, not the `SET NULL` this
   section's design calls for (a document should survive its task being
   deleted). Likely an earlier session's interrupted attempt at this exact
   feature that never got committed. Resolved by dropping that column/FK/index
   and its ledger row (verified zero data loss first), then generating this
   step's migration cleanly from a matching-git-history baseline — so the
   `SET NULL` behavior above is this build's own, not inherited from the
   orphan. Worth a "did anyone run migrate commands directly against dev
   without committing?" check with whoever else has touched this machine.
2. **`prisma migrate dev` can't run against the real dev DB at all** — the
   native Postgres role backing `DATABASE_URL` (port 5432) doesn't have
   `CREATEDB`, which the shadow-database step requires, and the interactive
   confirmation prompt it also wants doesn't work in a non-interactive shell
   either way. Worked around by pointing a new `SHADOW_DATABASE_URL` at the
   docker-compose Postgres (port 5433 — already in the repo per this file's
   own step 3 setup notes, just unused by this particular machine's `.env`)
   whose role is a real superuser, and applying the generated SQL via
   `prisma migrate diff` + `prisma migrate deploy` instead of the interactive
   `migrate dev` flow. `.env.example` now documents `SHADOW_DATABASE_URL`.
   Future migrations on this machine need the same two-step (`migrate diff`
   piped into a new migration folder, then `migrate deploy`) unless the
   native role is granted `CREATEDB`.

Verified: `tsc --noEmit` and `eslint` both clean. Real browser session
(Playwright, logged in as Admin against the live dev DB): `/users`,
`/users/new`, `/projects`, a real project detail page (franchisee email still
renders correctly), `/projects/new`, a user edit page, and the delete-user
confirm dialog — all 200s, zero console/page errors. No `/m` pages exist yet
(step 3), so no phone-viewport check this step.

### Suggested build order — step 2 shipped (2026-09-24)

**Admin: create supervisor with phone + PIN + project assignment.** Asked
about the one open item this step actually needed (PIN length, item 3 of
"NOT DECIDED YET") before writing code — **confirmed: 6 digits** (plan.md's
own recommendation over 4). The rest of item 3 (lockout, who sets the first
PIN) wasn't asked yet: the top-level task instructions explicitly say to ask
about brute-force/lockout at step 3 (login), and "who sets the first PIN" turns
out not to be a real open choice — decisions 7/8 (no OTP/SMS, no
notifications) leave no channel to send a "set your PIN" link through, so the
admin setting it directly at creation is the only workable mechanism, not a
judgment call.

What shipped:
- `/users/new`'s role dropdown now includes **Site Supervisor** (excluded in
  step 1). Picking it swaps the form: Phone number, PIN + Confirm PIN (both
  6-digit, `pattern="[0-9]{6}"`), and a checkbox list of every project to
  assign — replacing the Email + Department fields the other roles use.
  Submitting requires at least one project checked.
- `createUser` (`src/app/(app)/users/actions.ts`) branches on role via a
  `superRefine`-validated schema, then hands off to a new `createSupervisor`:
  creates the `User` (phone + hashed PIN, no email/department) and every
  `ProjectMember` row in one transaction, writing a `User` CREATE AuditEvent
  and one `ProjectMember` CREATE AuditEvent per project assigned — the
  section 4 audit rule technically only mandates this for Task/Document/
  Project, but a security-scoping grant like this seemed worth the same
  discipline, flagging in case that's more than wanted.
- `hashPin`/`verifyPin` added to `lib/auth.ts` — same bcrypt mechanism as
  passwords, named separately so call sites read as what they are.
- **Reset PIN** (`reset-pin-button.tsx` + `resetPin` action): admin-only,
  the phone+PIN equivalent of "Resend invite" — sets a new PIN immediately
  (no link to send), writes a `User` UPDATE AuditEvent. Shown on `/users` for
  active supervisor rows.
- `/users` list: Email column renamed "Contact" (shows email or phone),
  status badge no longer shows "Invite pending" for supervisors (they're
  never mid-invite — the PIN is live the moment they're created), and a new
  column shows each supervisor's assigned projects (or non-supervisors'
  department, as before).
- **Editing a supervisor is explicitly not supported yet** — `/users/[id]/edit`
  shows a plain message instead of the (email-only) edit form for
  `SITE_SUPERVISOR` rows, and `updateUser` rejects it server-side too
  (both directions: can't edit an existing supervisor through this form, and
  can't turn any other role into one through it). This wasn't asked about —
  it's outside what step 2's own scope ("create... with phone + PIN + project
  assignment") covers, and building a second, phone-based edit form felt like
  scope creep for this step. Flagging in case project (re)assignment after
  creation turns out to be needed sooner than expected — there's currently no
  way to add/remove a supervisor's projects short of deleting and recreating
  the account.

Verified against the real dev DB and a real browser session (Playwright,
Admin login): mismatched PIN/confirm-PIN correctly blocked with "PINs don't
match." and no row created; a real supervisor created successfully with one
project assigned (confirmed via DB: the `User`, `ProjectMember`, and all
three expected `AuditEvent` rows — `User` CREATE, `ProjectMember` CREATE,
`User` UPDATE from the PIN reset that followed — landed exactly as designed);
Reset PIN succeeded end to end; a duplicate-phone attempt was correctly
rejected with no second row created. `tsc --noEmit` and `eslint` both clean.
Test account deleted afterward through the app's own delete-user feature
(confirmed 0 rows left in the DB). No `/m` pages exist yet (step 3), so no
phone-viewport check this step either.

### Suggested build order — step 3 shipped (2026-09-24)

**Phone + PIN login and the `/m` project list (access control first).** Asked
about the one remaining open PIN-rules question first (lockout, deferred here
from step 2 per the top-level instructions) — **confirmed: lock a phone
number for 15 minutes after 5 consecutive wrong PINs**, resetting on a
correct login, with the admin's existing Reset PIN action also clearing the
lock immediately.

What shipped:
- **`User.pinFailedAttempts`/`pinLockedUntil`** (new, migration
  `20260924080015_add_pin_lockout`): tracks the lockout above. Reset to
  `0`/`null` on a correct login and by `resetPin` (step 2's action, updated).
- **`/m/login`**: phone + PIN form (`src/app/m/login/`). `loginSupervisor`
  mirrors the desktop `login()`'s "don't reveal which case it was" discipline
  for wrong-phone/wrong-PIN/inactive/no-PIN-set (all get "Incorrect phone
  number or PIN.") — lockout gets its own distinct message, since a
  supervisor genuinely needs to know why they're blocked, unlike a single
  wrong guess. Writes a `User` LOGIN AuditEvent with `source: "mobile"`.
- **`/m`**: the project list ("chats", decision 3) — queries `ProjectMember`
  for the signed-in user only, so isolation is structural (a supervisor
  physically cannot query another project's row into this list), not a
  filter that could be bypassed. Rows aren't links yet — the destination
  (category → task picker) is step 4, not this one.
- **`src/app/m/layout.tsx`**: shell only (phone-width column), no auth check
  — same reasoning as the (auth) group having no shared layout: `/m/login`
  must render inside it while staying public, so each authenticated page
  under `/m` checks `requireUser()` + the `SITE_SUPERVISOR` role itself.
- **Sign out** (`logoutSupervisor`): same shape as the desktop `logout()`,
  kept as its own function only because the redirect target differs
  (`/m/login`, not `/login`).
- **Desktop lockout closed, not just `/m`**: `(app)/layout.tsx` now redirects
  a `SITE_SUPERVISOR` session to `/m` before rendering anything — without
  this, a supervisor's valid session cookie could otherwise reach
  `/projects/[id]` for *any* project, since `permissions.ts`'s
  `canViewProject` only special-cases `FRANCHISEE`, not the new role. This
  wasn't explicitly asked for (the task instructions scoped the isolation
  requirement to "every `/m` page and action"), but leaving every desktop
  route wide open to a role that has no business there was a one-line fix
  for a real gap, not scope creep.
- **`proxy.ts` and `/api/auth/clear-session` updated for the `/m` prefix**:
  an unauthenticated hit on any `/m/*` route now bounces to `/m/login` (not
  `/login`), and an authenticated hit on `/m/login` bounces to `/m` (not
  `/dashboard`) — same pathname-prefix convention on both sides.

**Real bug found and fixed during verification**: a stale-but-cookied `/m`
visit (e.g., right after signing out) was landing on the desktop `/login`
instead of `/m/login`. Root cause: `requireUser()`'s existing stale-cookie
fallback (`/api/auth/clear-session`, built before this section existed —
see its own comment for the proxy.ts/DB-check disagreement it papers over)
always redirected to `/login`, with no way to know which "side" of the app
the failing request came from. Fixed by having `proxy.ts` forward the
request path via an `x-pathname` header on every request, which
`requireUser()` reads and passes to `clear-session` as a `next` param;
`clear-session` now picks `/m/login` vs `/login` the same way `proxy.ts`
already does. Caught by an explicit re-visit-`/m`-after-logout check in the
Playwright pass below — first surfaced as a genuine bug, not a test artifact
(see the note on flaky test attempts, next paragraph).

Verified against the real dev DB and a real browser session (Playwright,
phone-sized viewport, 390×844): created a live test supervisor assigned to
exactly one of two projects; logging in at `/m/login` with the wrong PIN
correctly showed "Incorrect phone number or PIN." for 4 tries, the 5th wrong
try switched to "Too many wrong attempts..." and set `pinLockedUntil` in the
DB to +15 minutes from then (confirmed directly in Postgres, not just the UI
message); a 6th attempt using the *correct* PIN was still correctly rejected
while locked; admin's Reset PIN cleared both the PIN and the lock, and login
with the new PIN succeeded immediately after. The project list showed only
the one assigned project, never the second (real) project the account wasn't
a member of. A supervisor session hitting `/dashboard` or `/projects`
redirected straight back to `/m`. Sign-out landed on `/m/login`, and
re-visiting `/m` afterward stayed on `/m/login` (the bug above, confirmed
fixed). Zero console/page errors throughout. `tsc --noEmit` and `eslint`
both clean. Test accounts deleted afterward via direct SQL (the ones created
mid-debugging) and the app's own delete-user feature (the final one).

**Note on the verification process itself**: several early attempts at the
lockout test showed no error text or wrong attempt counts — traced to the
test script reading the DOM before a Server Action's pending state (React's
`useActionState` transition, not a full page navigation) had actually
settled, so it sometimes read a stale, leftover error paragraph from the
*previous* attempt rather than the current one. Confirmed non-issue by
checking `pinFailedAttempts`/`pinLockedUntil` directly in Postgres after a
version of the script that waits for the submit button's pending state to
clear before reading anything — same class of test-script flakiness plan.md
has hit before (sections 9 and 11), not a product bug. Flagging the pattern
in case it recurs: for a Server Action + `useActionState` form, wait for the
pending indicator to resolve (or the resulting DOM text to actually change),
not just `networkidle` or a fixed timeout.

### Suggested build order — steps 4-6 shipped (2026-09-24)

**Category → task picker, upload with presigned B2 URL, and end-to-end
verification** — built and verified together in one session at Apoorv's
request ("sab krde bhai" — just get it all done). Asked about the two open
items that actually blocked this work first (see decisions 12-13): the
"Other" task for unlisted work, and the 50MB upload size limit.

What shipped:
- **`/m/[id]`**: the project "chat" screen. The real access gate is here —
  `db.projectMember.findUnique({ userId_projectId })` — a project id typed
  into the URL that the signed-in supervisor isn't a member of gets the same
  `notFound()` as a project that doesn't exist, matching this section's own
  "cause -> effect that must hold." Shows this supervisor's own upload
  history for the project as WhatsApp-style bubbles (decision 2's "look"),
  and hands off to a single client component for the actual send flow.
- **`UploadFlow`** (`upload-flow.tsx`): one linear state machine matching
  decision 4's exact order — pick photo/video (native file/camera picker,
  `capture="environment"`) → pick category → pick task (search box included,
  per the ~278-item CULINARY category) → confirm → send. Nothing is
  selectable out of order; category/task lists are fetched only once the
  file is already chosen, not preloaded for all ~28 categories up front.
- **Upload mechanics** (`src/app/m/[id]/actions.ts`, `lib/storage.ts`):
  `getPresignedUpload` re-validates everything server-side (membership,
  file size ≤50MB, `image/*`/`video/*` only, task belongs to this project
  and is BOQ-routed) before issuing a short-lived presigned B2 PUT URL —
  the client then PUTs the file bytes straight to B2, never through a
  Next.js route (Vercel's ~4.5MB body cap, per this section's own note).
  `finalizeUpload` creates the `Document` (linked via `taskId`, `category`
  copied from `task.module`), flips the `Task` to `COMPLETED`, and (for an
  "Other" task) creates its replacement — all in one transaction, with a
  `CREATE`/`UPDATE`/`CREATE` `AuditEvent` trail (`source: "mobile"`).
- **B2 bucket CORS configured** for real (`scripts/configure-b2-cors.ts`,
  idempotent, `--apply` to write) — this section's own architecture note
  ("bucket CORS needed") flagged this as required for a browser to PUT
  directly to B2; applied for `http://localhost:3000` today, needs the real
  deployed origin added once one exists (still just `localhost` in `.env`
  per section 12's unresolved hosting question).
- **Office side**: `TaskCard` (used by the project page, stage pages, and
  category pages alike) now lists any `Document`s linked to a task, each a
  download link through the existing signed-download Route Handler — this
  was explicitly called out in this section's own "What gets built" list
  and had no prior UI at all (the FK didn't exist before step 1).

**Real bug found and fixed during verification**: the very first live test
of `/m/[id]` 500'd — including the negative-test visit to an *unassigned*
project, which should have been a clean 404. Root cause: `actions.ts` is a
`"use server"` file, and Next.js requires every export from such a file to
be an async function — `OTHER_TASK_TITLE` was exported as a plain string
constant, which broke the entire module (cascading into the page that
imports it transitively). Fixed by simply not exporting it (a `"use server"`
file can have private, non-exported constants freely — the restriction is
only on what's exported). `tsc --noEmit` did not catch this, since it's a
Next.js/SWC build-time rule, not a TypeScript type rule — worth remembering
for any future `"use server"` file that wants a shared constant.

Verified against the real dev DB, the real B2 bucket, and a real browser
session (Playwright, phone-sized viewport, a real 1×1 PNG test file): a test
supervisor assigned to only one of the two real projects (Bengaluru,
Ashok Vihar) — visiting the *other* one by URL correctly 404'd; opening the
assigned one showed its categories; sent a photo through the full flow
against the "Other (not on checklist)" task specifically (to exercise the
respawn path) — confirmed directly in Postgres, not just the UI: the
original task flipped to `COMPLETED`, a fresh replacement "Other" task
appeared (`NOT_STARTED`), and all three expected `AuditEvent` rows landed in
the right order. Confirmed the file actually reached B2 (not just that the
client called PUT) by following the same download route the office side
uses — 307 redirect to a live signed URL. Confirmed office-side visibility
separately: the project's category page now lists and links the uploaded
file via `TaskCard`. On a second, fresh page load (not just the
post-upload `router.refresh()`), the chat history correctly showed the sent
file as a bubble. Zero console/page errors (aside from the one 404 the bug
itself caused, before the fix). `tsc --noEmit` and `eslint` both clean. Test
artifacts (the test supervisor, the test `Document`, and both "Other" task
rows created during testing) were deleted afterward via direct SQL, restoring
the Bengaluru project to exactly 963 tasks — its documented baseline from
section 15.

**Still open** (deliberately not built this session — see "NOT DECIDED
YET"): video compression, storage billing once B2's free tier fills, retry/
queue for uploads on a dropped connection, and which other roles (beyond
`SITE_SUPERVISOR`) might get a similar mobile flow later. The negative test
this section's own step 6 called for ("supervisor cannot open an unassigned
project") is done — see above — closing out the last item in the original
6-step build order.

### NOT DECIDED YET — ask before assuming

1. **Upload = completed, even mid-work.** Decision 6 means a photo of work
   still in progress will mark the task done. Options: accept it (office
   corrects by hand), or add one "Complete / Still in progress" tap on the
   confirm screen. Decision was "keep it simple"; revisit if progress numbers
   on `/boq` start looking too optimistic.
2. **Video limits — partially resolved 2026-09-24.** Max file size:
   **50MB**, confirmed (see decision 12). **Still open:** whether to compress
   on the phone (not built — Phase 1 has no client-side compression at all),
   and how storage is paid for once B2's free 10GB fills up.
3. **Which other roles get this UI later** (HR/ops employees, other
   departments) and whether they will also be limited to uploads.
4. **Weak site network.** Retry/queue for failed uploads in v1, or later —
   not built yet (a failed upload just shows an error with a "Try again"
   button, no queue/persistence across a dropped connection).

### Suggested build order (each step tested before the next, per section 7 step 5)

1. ~~Schema: `User.phone`, optional email, PIN, `SITE_SUPERVISOR`, `ProjectMember`, `Document.taskId`.~~ Done.
2. ~~Admin: create supervisor with phone + PIN + project assignment.~~ Done.
3. ~~Phone + PIN login and the `/m` project list (access control first).~~ Done.
4. ~~Category → task picker (read-only) for one project.~~ Done.
5. ~~Upload with presigned B2 URL, Document link, status change, audit.~~ Done.
6. ~~Verify end to end in a real browser on a phone-sized viewport, including a
   negative test: supervisor cannot open an unassigned project.~~ Done.

All six original build-order steps are shipped as of 2026-09-24. See "NOT
DECIDED YET" above for what's deliberately still open (video compression/
billing, retry queue, other roles), and section 16's own build-log entries
above for what was verified at each step.

---

