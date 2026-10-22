## 11. Task-list search/pagination + Action Centre franchise picker (2026-09-21)

**Where this came from:** Apoorv's ask, once section 9's BOQ/Ops seed made a
single project's flat Tasks list ~724 rows long: search + "load 10 at a time"
on both the project page's Tasks section and the Action Centre, plus a
franchise picker on the Action Centre ("pehle choose krne ka option ki konsi
franchise ka dekhna hai" — tappable cards like "Tulsi Bengaluru", "Tulsi
Prayagraj").

What shipped:
- **`TaskList`** (`src/app/(app)/projects/[id]/task-list.tsx`) — new client
  component wrapping the project page's Tasks section. Search box filters
  client-side (title, description, module, stage, owner, created-by — all
  already fetched for the page, no new query) and resets pagination to 10 on
  every keystroke; a "Load 10 more" button reveals the next batch. `page.tsx`
  now maps `project.tasks` into `TaskList` instead of rendering `TaskCard`
  inline.
- **`ActionsList`** (`src/app/(app)/actions/actions-list.tsx`) — same
  pattern for the Action Centre's task list (search across title/module/
  stage/project, "Load 10 more").
- **Franchise picker** (`src/app/(app)/actions/page.tsx`) — tappable cards
  ("All Franchises" + one per franchise with an open task, each showing its
  open-task count), built from `?project=<id>` in the URL (same query-param
  filter convention as the audit log's `?project=` scoping) rather than
  client state, so the page stays a Server Component and the filter is
  shareable/bookmarkable. Only rendered when there's more than one franchise
  in view — hidden for a franchisee (always exactly their own project) and
  for Admin/Management when only one franchise currently has open tasks.
  Selecting a franchise also re-scopes the Critical/Overdue/Awaiting
  You/Completed-this-week stat cards to that franchise, not just the list
  below.
- Not asked explicitly whether page size should be configurable or whether
  the franchise picker should default to a specific franchise rather than
  "All" — went with a fixed 10-per-page and an "All Franchises" default,
  flagging here rather than blocking on it.

**Bug hit while verifying, not a product bug:** my own Playwright script's
`page.click('button[type="submit"]')` on the "New Project" form matched the
sidebar's hidden "Sign out" `button[type="submit"]` (renders earlier in the
DOM than the form) instead of "Create Project", logging the test session out
mid-flow — same class of test-script bug as section 9's earlier `/login`
mystery. Fixed by scoping to `getByRole("button", { name: "Create Project" })`;
left two throwaway "Tulsi — Prayagraj" projects behind from the confused
runs, cleaned up afterward through the app's own delete-project feature.

Verified against the real dev DB and a real browser session (Playwright):
project page — typed a search term, confirmed the visible list filtered and
the "Showing X of Y" count updated, confirmed "Load 10 more" grew the visible
set from 10 to 20, confirmed a deliberately-unmatchable search showed the
"No tasks match your search" state. Action Centre — created a second
throwaway project ("Tulsi — Prayagraj") to get more than one franchise in
view, confirmed the picker showed "All Franchises" + both franchise cards,
confirmed clicking "Tulsi — Prayagraj" scoped the subtitle and task list to
only that franchise's tasks (zero links into the other project's tasks),
confirmed "All Franchises" returned to the unscoped view, then deleted the
throwaway project through the delete-project feature to leave the DB as
found. `tsc --noEmit` and `eslint` both clean throughout.

**Same-day follow-up:** Apoorv asked for filters on top of the search —
category, status, and lifecycle stage, usable individually or combined
("combo of either two or three"), in both places. Shipped as a shared
`FilterSelect` dropdown (`src/components/filter-select.tsx`, one component
used by both `TaskList` and `ActionsList` rather than duplicating the same
three-dropdown markup twice) with three instances per list — Category
(built from whatever `Task.category` values are actually present, plus an
explicit "No category (lifecycle checklist)" bucket for the ~158 tasks
predating section 9's axis), Status, and Stage (both fixed lists from the
enums). Filters AND together with each other and with the search box; a
"Clear filters" button appears once any of the three is non-default. Action
Centre task rows now also show a category badge (previously only
module/stage) so the new axis is visible, not just filterable.

Verified against the real dev DB: on the project page, filtering to
category=Plumbing (a small, easy-to-check category) showed exactly 9 of 9
tasks, matching `ops-progress-tasks.ts`'s literal 9 Plumbing entries;
stacking status=Not Started narrowed further; stacking an unrelated
stage=Design on top correctly zeroed out to "No tasks match your search and
filters" (Plumbing tasks are all `CONSTRUCTION_EXECUTION`); Clear filters
returned to the full 724; category="No category" isolated exactly the 158
lifecycle-checklist tasks. Along the way, noticed the Action Centre now
aggregates 1,447 open tasks across two real projects — Apoorv had created a
second live project ("Tulsi — Ashok Vihar, New Delhi") during this session;
confirmed it's his own work via the DB (not a test artifact) and left it
untouched. `tsc --noEmit` and `eslint` both clean.

