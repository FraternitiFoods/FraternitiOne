## 22. Navigation/performance smoothing pass — retrospective documentation (2026-10-07)

Also undocumented at the time; written up the same way as section 21, from
`git show` diffs. Three commits, one pattern repeated across the app: replace
unbounded `findMany` + in-memory `.filter()`/`.length` counting with capped
queries and/or `count()` aggregates, and add a `loading.tsx` skeleton route
so Next.js streams a pulse-skeleton immediately on navigation instead of
blocking on a blank screen while the query resolves. A `prisma.count()` can't
silently disagree with a capped list the way manually filtering a
`take`-limited array would, so capping the table queries didn't also require
re-deriving the stat-tile math.

**Pass 1 — projects & store-onboarding (`183ec12`/`339faea`, 2026-10-07):**
- `src/lib/session.ts`: `CurrentUser` gained an optional `onboardingStatus`
  field, populated from `session.user.onboardingAsFranchisee?.onboardingStatus`
  inside the one query `requireUser()`/`getCurrentUser()` already runs.
  `src/app/(app)/layout.tsx` and `src/app/onboarding/layout.tsx` (pass 3
  below) now read `user.onboardingStatus` off that session object instead of
  each running their own separate `db.storeOnboarding.findUnique` on every
  single navigation — removes a DB round trip per page load for every
  `FRANCHISEE` request through either layout.
- `projects/page.tsx`: previously fetched **every** `FranchiseProject` row
  unbounded and computed the stat tiles (total/on-track/at-risk/critical/
  cities) by filtering that in-memory array — a query and a render that would
  both have gotten slower as the table grew without bound. Now runs a
  `Promise.all` of a capped `findMany({ take: 50 })` for the table alongside
  separate `count()` queries for the stat tiles.
- `store-onboarding/page.tsx`: same cap-and-count treatment.
- New `projects/loading.tsx` and `store-onboarding/loading.tsx` skeleton
  routes.

**Pass 2 — dashboard/complaints/documents/actions (`e395633`, 2026-10-07,
co-authored with Claude per the commit trailer):** `dashboard/page.tsx`'s
`InternalDashboard` switched its portfolio-health counts from
`db.franchiseProject.findMany({ select: { health: true } })` + a JS
`.filter().length` per health value, to four parallel `count()` queries run
in the same `Promise.all` as the existing `auditEvent.findMany` and
`getAdminWidgets()` calls. New `loading.tsx` for `actions/`, `complaints/`,
`dashboard/`, `documents/`. **Deliberately left untouched, by the commit's
own stated reasoning**: `/actions`' stat-tile queries, because they depend
on the `canActOnTask` authorization filter rather than a simple row cap — a
`count()` can't cheaply replace a query whose rows are filtered by a
per-row authorization check the same way it could replace a plain health
tally, so only a `loading.tsx` skeleton was added there, no query change.

**Pass 3 — franchisee onboarding portal (`bf888b4`, 2026-10-07):**
`src/app/onboarding/layout.tsx` dropped its own `db.storeOnboarding.
findUnique` call, mirroring pass 1 — reads `user.onboardingStatus` from the
session field pass 1 added instead. New `loading.tsx` for
`src/app/onboarding/`, `.../documents/`, `.../loi/`. Behavior at the `null`/
`LOI_COMPLETE` branch is unchanged (both still redirect to `/dashboard`),
just without the extra query on the way there.

**Housekeeping, same day (`714808a`, 2026-10-07):** added this repo's
`CLAUDE.md` (318 lines, the senior-engineer guidance file every session now
loads) and added it to `.gitignore` in the *same* commit — meaning this is
the one and only commit where `CLAUDE.md` is tracked in git history; any
edits to it after this commit won't appear in `git status` or future diffs,
which is worth knowing if `CLAUDE.md` content ever needs to be diffed or
rolled back.

**Note worth flagging forward, not yet reconciled**: section 23 below
(`169335b`, the very next day) adds a *new* `db.franchiseProject.findFirst`
query back into `src/app/(app)/layout.tsx` for every `FRANCHISEE` request —
a different query than the one pass 1 removed from that same file, but it
partially erodes the "no DB call in this layout for franchisees" property
pass 1 had just established. Not a bug — `isPreExisting` genuinely isn't
available on the session object the way `onboardingStatus` is — but if the
layout's per-request query count matters, it's one, not zero, again.

---

## Pass 4 — user-reported "page navigation super slow" diagnosis + fix (2026-10-29)

Diagnosed via three parallel read-only investigations (Next.js/data-fetching
architecture, Prisma/DB query patterns, build/bundle/assets) plus manual
verification of the highest-impact files and a direct check of Next.js 16's
own docs (`node_modules/next/dist/docs/`) for its caching/streaming model —
this app does **not** have `cacheComponents: true` set, so it's on the
"previous" rendering model, which is why `unstable_cache` (not `"use cache"`)
is the tool used below. Full diagnosis/plan: see the approved plan this
session worked from (not checked into the repo — summarized here).

**Closes the Pass 3 "not yet reconciled" note above**: `isLegacyFranchisee`
is now folded into `getCurrentUser()`'s own session query
(`src/lib/session.ts`), the exact same pattern Pass 1 used for
`onboardingStatus` — `src/app/(app)/layout.tsx` is back to zero extra DB
round trips per navigation for `FRANCHISEE`, this time via a `CurrentUser`
field rather than a separate query.

**Resolves Pass 2's deliberate gap on Action Centre**: Pass 2 left
`/actions`' queries unbounded because `canActOnTask`'s authorization check
looked like it couldn't cheaply become a `where` clause. It can:
`canActOnTask` is `canManageTaskModule(user, task.module) OR task.ownerId
=== user.id OR task.createdById === user.id OR (FRANCHISEE on own project)`
— the module check is `getManageableModules(user)` (a pure, pre-computed
`Department[]`, no DB needed), so the whole thing becomes one `OR` in the
`where`. `actions/page.tsx` no longer fetches every open task in the
system for internal roles; the DB does the scoping that JS `.filter()` used
to.

**New findings/fixes this pass (prior passes didn't touch these):**
- Missing indexes added (migration `20261029060941_add_performance_indexes`):
  `Task.module`/`dueDate`/`completedAt`/`slaDays`,
  `StoreOnboarding.kycStatus`/`onboardingStatus`/`paymentStatus`,
  `PosOrder(projectId, receivedAt)`.
- `admin/pos/page.tsx`: the "last bill per outlet" `groupBy` had **no**
  `where` at all (full scan of the highest-volume table in the schema) —
  bounded to a 90-day lookback. The per-pinned-day `posOrder.count()` loop
  (real N+1) replaced with one `groupBy`.
- `projects/[id]/page.tsx` — the heaviest query in the app (a project can
  carry ~963 seeded tasks) — split into a fast header-only query (renders
  instantly: title, franchisee info, reclassify/delete buttons) plus a
  `<Suspense>`-streamed body carrying the full nested tasks/documents/
  complaints include. New dedicated `projects/[id]/loading.tsx`. This
  doesn't reduce the body's query cost, it changes *when* the
  already-fast header is allowed to reach the screen instead of waiting
  alongside the slowest piece. Same streaming treatment applied to
  `board/page.tsx` (fully static header, no data dependency). **Not**
  applied to `/actions`: its franchise-picker `redirect()` depends on the
  task query result, so moving that query into a Suspense-wrapped child
  would turn a clean HTTP redirect into a client-side one — a regression,
  not a win, for a page whose query was already fixed above.
- `sales/page.tsx`: merged a franchisee's two sequential queries (resolve
  id, then fetch fields) into one `findFirst`; bounded the `SalesDay`
  history fetch (previously a store's *entire* lifetime, unbounded) to
  whichever is earlier of "start of this year" or "~35 days ago" — the
  exact window every card/trend on the page actually reads (verified
  against `src/lib/sales/aggregate.ts`; the 35-day margin, not just "this
  year", matters because the 30-day trend can reach into December when
  today is early January).
- `getAdminWidgets()` (`dashboard/widgets.ts`) and `getBoardSummary()`
  (`board-summary.ts`) wrapped in `unstable_cache` (20s revalidate) — a
  deliberate, narrow exception to this file's documented "nothing cached"
  rule (plan.md section 20B), scoped to these two because they're
  portfolio-wide counts/sums called identically from 3 places
  (`/dashboard`, `/board`, the weekly digest cron) where ~20s of staleness
  changes no one's decision. `board-summary.ts`'s unbounded portfolio-wide
  task scan was **not** given a `take` cap the way Pass 1/2's table
  queries were — `summarizeDelays` needs every tracked task to compute
  correct on-track/overdue/finished-late totals, so truncating rows would
  have silently corrupted the founder's numbers; caching the whole
  computation was the safe lever instead.

**Verified**: `pnpm run typecheck && pnpm run lint && pnpm run test` all
green (274/274 tests). `prisma migrate dev` applied cleanly against local
Postgres. `scripts/ci-smoke.ts` run against local `pnpm dev` — all 25
checks pass, including task creation/status-choke-point/audit-trail on
`/projects/[id]` (the restructured page), a reclassify that seeds the full
963-task checklist (the exact data-volume scenario this pass targets), and
franchisee isolation. `/actions`, `/board`, `/admin/pos`, `/dashboard`
additionally checked manually (logged in as ADMIN): all HTTP 200, no
console errors, no error-overlay text.

**Not verified this session** — flagging forward rather than deferring
silently: whether production's `DATABASE_URL` uses a pooled connection
(Neon/Supabase pooler, PgBouncer, Prisma Accelerate) or a direct one. On
Vercel serverless, an unpooled connection adds a fresh TCP+TLS+auth
handshake to every request regardless of query optimization — this could
be as large a lever as everything above and should be checked in the
hosting dashboard, not from this repo.

---

