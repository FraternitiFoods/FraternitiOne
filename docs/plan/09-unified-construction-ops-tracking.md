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

