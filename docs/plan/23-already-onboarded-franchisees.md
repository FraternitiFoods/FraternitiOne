## 23. "Already onboarded" / pre-existing franchisees (2026-10-08)

**Mental model (read this first):** every franchise onboarded through this
app so far goes through the full build-out lifecycle — KYC, LOI, then a
seeded checklist of ~1,450 construction/BOQ `Task` rows tracked to
completion before the store opens. This feature is for a different case:
a franchisee whose store was **already built and operating in the real
world** before anyone typed them into this app. For that franchisee there is
no build-out to track — only day-to-day operations (sales, complaints,
documents) — so seeding a construction checklist and showing a readiness %
for a store that's already open doesn't make sense and was actively
misleading on the dashboard.

**Schema** (`prisma/schema.prisma`, migration
`20261008054932_add_pre_existing_franchise_flags/`, plain additive
`ALTER TABLE ... ADD COLUMN ... BOOLEAN NOT NULL DEFAULT false` — safe for
existing rows, no backfill, no risk to any current franchisee's data):
- `User.isPreExistingFranchisee` — meaningful only for `role === FRANCHISEE`;
  set by an Admin at **user**-creation time (`/users/new`).
- `FranchiseProject.isPreExisting` — set at **project**-creation time
  (`createProjectWithSeedTasks`), normally copied from the franchisee's own
  flag above; this is the field that actually drives the UI branching below,
  not the `User` flag. The schema comment is explicit that this is deliberately
  distinct from `onboarding === null` — a brand-new build project created
  directly via `/projects/new` (skipping the onboarding wizard) also has no
  onboarding record, but still needs the full build-out UI, not this one.

**Why two separate flags instead of one**: user-creation and
project-creation are two separate Admin steps that can happen on different
days (an Admin might create the franchisee account before the project
exists at all), so the flag has to be set once and carried forward to
whichever project eventually gets created for that user — `User.
isPreExistingFranchisee` is that carry-forward value, `FranchiseProject.
isPreExisting` is the one actually consulted at render time.

**`src/lib/project-seed.ts`**: `createProjectWithSeedTasks` gained an
optional `seedTasks?: boolean` parameter, defaulting to `true` — so the
onboarding-wizard's own call site (`conversion.ts`, which never passes this
argument) is unaffected and still seeds the full checklist. When `seedTasks`
is `false`, the ~1,450-row lifecycle `Task.createMany` block (and its paired
`AuditEvent.createMany`) is skipped entirely, and `isPreExisting: !seedTasks`
is stamped onto the created project.

**Project creation UI** (`projects/new/new-project-form.tsx`,
`projects/new/page.tsx`, `projects/actions.ts`): the franchisee-picker query
now also selects `isPreExistingFranchisee`; the form adds a checkbox
("Already operational — skip the lifecycle-task checklist", `skipSeeding`)
that auto-checks itself via the franchisee `<Select>`'s `onValueChange` when
the chosen franchisee's flag is true — but it is **not** pre-checked before
an Admin actually picks someone, and an Admin can still uncheck it after
auto-check fires, so the project's own flag is the real source of truth, not
an assumption baked into the form. `createProject`'s action/schema gained
`skipSeeding: z.boolean().optional()`, translated to `seedTasks: !data.
skipSeeding` at the `createProjectWithSeedTasks` call site.

**User creation UI** (`users/new/new-user-form.tsx`, `users/actions.ts`):
when `role === "FRANCHISEE"` is selected, a checkbox appears ("This
franchisee already has an operational store"); `createUser`'s schema/action
gained `isPreExistingFranchisee`, written to the new `User` column only when
`role === "FRANCHISEE"` (left undefined for every other role, where the
field has no meaning).

**Dashboard** (`dashboard/page.tsx` + new `legacy-franchisee-home.tsx`):
`FranchiseeDashboard` now checks `project.isPreExisting` and, if true, renders
`<LegacyFranchiseeHome>` instead of the normal build-out tracker. That
component shows a welcome card, three stat tiles (Sales This Month via the
existing `getSalesThisMonth`, Open Complaints, Documents count) and a
"Latest Updates" feed of the 6 most recent `AuditEvent` rows for the project
— deliberately no readiness %, lifecycle progress bar, or onboarding/KYC/LOI
widgets, since none of those apply to a store that's already running.

**Sidebar** (`app-sidebar.tsx` + `(app)/layout.tsx`): `AppSidebar` gained an
`isLegacyFranchisee?: boolean` prop; when true, the "BOQ" and "Operations"
nav items (construction-only modules) are filtered out of the list, same
pattern already used there for `ONBOARDING_ROLES`/People-Admin-only entries.
`(app)/layout.tsx` computes this with a new `db.franchiseProject.findFirst({
where: { franchiseeId: user.id }, select: { isPreExisting: true },
orderBy: { createdAt: "desc" } })`, run only when `user.role ===
"FRANCHISEE"` — see section 22's closing note: this is a new per-request
query on the same layout file section 22 had just removed a *different*
query from the day before, so that layout is no longer free of DB calls for
franchisees, even though neither change is wrong on its own.

### NOT DECIDED YET — ask before assuming

1. **Backfill for real already-operational franchisees who predate this
   feature.** Both new columns default to `false` on every existing row —
   any franchisee in production today whose store is, in fact, already
   built and running will still see the normal build-out dashboard (with a
   seeded task checklist that may already be fully/partially complete from
   earlier manual data entry, or just stale) until an Admin manually sets
   their flags. There is **no UI to flip either flag after creation** —
   both are only settable at user-creation / project-creation time in the
   diffs read for this entry. If any current production franchisee needs
   reclassifying, that's either a one-off DB update or a small "edit
   franchisee" UI addition — neither exists yet. Worth confirming with
   Apoorv/Sushant ji whether this is "new franchises only, going forward" by
   design (plausible — matches the "two separate manual Admin decisions"
   shape of the rest of this feature) or an oversight.
2. **What happens to an existing, non-preexisting project's seeded Tasks if
   an Admin picks the wrong checkbox at creation time and wants to undo it
   later** — not covered by any diff read for this entry; presumably "delete
   and recreate the project" (the existing delete-project flow), but not
   confirmed.

**Honesty note on how this section was written**: like sections 21-22, this
is retrospective documentation of an already-shipped commit (`169335b`,
2026-10-08), written by reading `prisma/schema.prisma`, the new migration
SQL, `legacy-franchisee-home.tsx` in full, and the diffs to every other file
listed above — not from a live build session. No fresh Playwright/browser
verification was run as part of writing this entry; the "NOT DECIDED YET"
backfill question above is a real open gap, not a hedge.

### Reclassify-after-creation (closes NOT DECIDED #2, 2026-10-23)

NOT DECIDED #2 above asked what happens when an Admin picks the wrong
checkbox at project-creation time. This adds the small "edit" UI that #1
also flagged as missing — for the **project**-level flag only; #1's
user-creation-time backfill question is still open.

**`src/lib/permissions.ts`**: `canReclassifyProject` — flat `user.role ===
"ADMIN"` check, same narrow shape as `canDeleteProject` (a system-
classification change, not a cross-department content override).

**`src/lib/project-seed.ts`**: the ~963-task lifecycle+BOQ/Ops seed block
was extracted out of `createProjectWithSeedTasks` into a standalone exported
`seedLifecycleAndOpsTasks(tx, project, actor)`, so the same real seeding
logic (not a second copy of it) can run again later against an *existing*
project row, not only at creation time.

**`src/app/(app)/projects/actions.ts`**: `reclassifyProject(projectId, ...)`
— toggles `FranchiseProject.isPreExisting` to whatever it currently isn't
(no form field needed beyond the id). One `$transaction` (20s timeout, same
reasoning as the creation path: the seed alone measures 5.2-5.5s against
production): flips the column, writes an `AuditEvent` (old/new value), and —
only on the build-out direction, and only `if (project._count.tasks === 0)`
— calls `seedLifecycleAndOpsTasks`. Marking a project "already operational"
never touches its existing `Task` rows either way; deleting them isn't this
action's call (still "delete and recreate the project" per #2's own
presumption).

**`src/app/(app)/projects/[id]/reclassify-project-button.tsx`** +
`projects/[id]/page.tsx`: one `Button` + confirmation `Dialog`, gated by
`canReclassifyProject(user)`, next to the existing Delete button. Label and
dialog copy flip with the current `isPreExisting` value, so the UI never
shows an ambiguous "toggle" control — an Admin always reads "Mark as already
operational" or "Mark as build-out project", whichever direction they're
about to cause, and the dialog explicitly says whether tasks will be seeded
or left alone.

**Verified**: `tsc --noEmit`, `eslint .` (9 pre-existing warnings, 0 new, 0
errors), `vitest run` (274/274, no regressions — no new unit tests added;
this is a server action with no existing dedicated test file to extend, same
precedent as section 26 P4/P5) all clean.

Real-browser pass (`scripts/tmp-e2e-reclassify-project.ts`, kept per the
`tmp-e2e-*` precedent, real Chromium against the local dev DB, cleanup in a
`finally`): one throwaway build-out project created through the real UI
(~963 tasks seeded), then through the actual button — flip to "already
operational" (task rows survive, audit event's old/new values captured,
admin dashboard unaffected), flip back to build-out (no double-seed, since
tasks never left), tasks deleted directly and flipped operational-then-
build-out again (this time correctly re-seeds ~963 tasks from zero), and a
non-Admin (`SALES`) confirmed not to see the button at all. **15/15 checks
passed.** One real bug caught and fixed while writing the script itself, not
in the app: `page.waitForURL` resolves immediately when the target path
equals the page's *current* path (true here — the server action redirects
back to the same `/projects/[id]` URL) — an early version of the script read
the DB right after that no-op wait and saw stale state, scrambling the
flip order across the three steps. Fixed by waiting for the button's own
label to flip to the opposite text instead (proof the RSC re-render landed),
not for a URL change. A second, unrelated flakiness — reusing one Playwright
page across a long run occasionally left it hung on a later `goto("/login")`
— hit the exact same symptom `tmp-e2e-sales.ts` already documented; fixed
the same way, a fresh `page` for that one step.

Also found while preparing to run this: the local dev DB's seeded-user
passwords no longer matched the current `.env`'s `SEED_DEV_PASSWORD` (login
failed with "Incorrect email or password" before any app code was touched).
`prisma/seed.ts` only ever upserts the 5 fixed dev users and re-applies
whatever `SEED_DEV_PASSWORD` currently is — no projects/tasks touched — so
re-running it was safe. Re-run via `npx tsx prisma/seed.ts` directly, not
`pnpm run db:seed`: the latter triggers pnpm's own dependency-status check
first, which tried to rewrite the Prisma query-engine `.dll` while `next
dev` still had it open, failing with `EPERM` on Windows. Unrelated to this
feature; noting it here so a future session recognizes the symptom instead
of chasing it as a real bug.

---

