## 15. BOQ/Construction & Ops Progress split + Excel-accurate fill (2026-09-24)

**Where this came from:** section 9's original seed (`boq_ops_master_checklist.csv`,
cleaned/classified from the founder's raw BOQ + Operations_List sheets) turned
out to have real gaps against the source Excel
(`Complete BOQ Turnkey for Fraterniti.xlsx`) — a row-by-row audit this session
found whole line items dropped across ~15 categories, one entire category
missing ("Dismantling and Demolishing"), and three sheets (Barware, Uniforms,
Stationary) with zero representation anywhere in the app. The founder also
wanted the BOQ-sourced content separated from the process checklists
(Interior/OPERATION/MARKETING/HR, plus CULINARY's pre-opening steps) that were
never part of that Excel to begin with — those aren't the same kind of
"progress" and were getting rolled up together.

What shipped:
- **`OPS_PROGRESS_TASK_TEMPLATES`** (`src/lib/ops-progress-tasks.ts`) grew from
  566 to 805 entries: gaps filled in existing categories (e.g. Plumbing 9→17,
  Music 3→11, Integrations 4→10), 4 new categories added (Dismantling and
  Demolishing, Water Work, Uniforms, Stationary), and CULINARY's
  equipment/utensils/crockery content filled out plus the full Barware sheet
  (77 items) added. Every new row was generated straight from a parsed dump of
  the Excel (not hand-retyped) and cross-checked against the old file before
  writing — caught two bugs pre-commit: an over-aggressive dedup step that
  would have silently merged two genuinely distinct sheet rows ("DOUBLE
  OVERHEAD SHELF" vs "DOUBLE OVER HEAD SHELF"), and one pre-existing item
  ("Marketing Promotion Offers") that picked up the wrong `lifecycleStage`/
  `module` during the CULINARY block rebuild.
- **`src/lib/ops-route.ts`** (new): classifies each `(category, title)` pair as
  `"BOQ"` or `"OPS"` — a lookup, not a DB column, so no migration/backfill of a
  new field across the ~1,600 existing Task rows was needed. `OPERATION`,
  `MARKETING`, `HR`, and `Interior` are OPS-only categories; CULINARY splits at
  the task level (15 named pre-opening process titles are OPS, everything else
  in CULINARY — equipment, utensils, crockery, barware — is BOQ).
  `computeCategoryProgress` (`category-progress.ts`) takes a `route` param and
  filters through it before grouping.
- **Route split**: `/progress` renamed to **`/boq`** (title "BOQ", BOQ-routed
  categories only); new **`/construction-ops`** page (title "Construction &
  Ops Progress", OPS-routed categories only) added alongside it. Sidebar's
  single "Construction Progress" entry became two: "BOQ" and "Construction &
  Ops Progress". The project detail page's embedded grid (section 14) is
  likewise now two cards instead of one.
- **`scripts/backfill-ops-tasks.ts`** (new, one-off): template changes only
  seed new projects (section 9) — the two existing dev projects
  (Bengaluru, Ashok Vihar) wouldn't have picked up any of this retroactively.
  Diffs each project's existing tasks against the current template
  (whitespace-normalized title matching, to avoid re-inserting an item as
  "new" just because its raw-Excel formatting fidelity changed) and inserts
  what's missing, appended to the end of its `(project, lifecycleStage)` order
  sequence rather than spliced in — splicing would mean renumbering every task
  sharing that stage across every category. Run with `--apply` against both
  projects: +239 tasks each (963 total, up from 724).

Not shipped: Uniforms' source rows repeat "Chef coat LOGO" ×7 and "PANT" ×3
verbatim (looks like a sizing chart where the actual sizes never got typed
into the Description column) — kept as literal duplicates for fidelity to the
sheet rather than guessing and collapsing them.

Verification: `tsc --noEmit` and `next build` both clean (all 20 routes,
including `/boq` and `/construction-ops`, registered correctly). Ran
`computeCategoryProgress` directly against live DB data for both routes on the
Bengaluru project: 28 BOQ categories + 5 OPS categories, CULINARY correctly
appears on both (278 BOQ + 15 OPS = 293), and BOQ-total + OPS-total exactly
equals the count of tasks carrying a category (805) — nothing lost, nothing
double-counted outside the intentional CULINARY overlap. Not click-tested in a
browser this session (no Playwright pass, same gap as section 14).

