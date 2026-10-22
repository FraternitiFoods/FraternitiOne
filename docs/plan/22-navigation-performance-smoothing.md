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

