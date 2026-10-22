## 13. UX polish pass — task cards, project page nav, document upload,
tile styling (2026-09-22/23)

**Where this came from:** not logged at the time (this whole section, like
section 12, is a same-day reconstruction on 2026-09-23 — see the note at the
top of this section's parent commit sweep). None of these five commits
touch the data model, permissions, or seeding — all UI/UX on top of already-
shipped features (sections 4, 4b, 9, 11).

What shipped:
- **Collapsible task cards** (`8dc0aad`, `task-card.tsx`): the status-update
  form and comment thread on every `TaskCard` — previously always rendered
  open — now sit behind a "Comment"/"Update status / comment" toggle
  (comment count shown inline when collapsed). Direct response to section
  11's own "Still open" flag about the 724-task flat list being a real UX
  problem: collapsing each card's body doesn't reduce the *count* rendered,
  but cuts the vertical footprint of each one substantially.
- **Smooth in-page navigation** (`e1370b9`, project detail page): a sticky
  Overview/Tasks/Documents nav pinned to the top of the project detail page,
  jumping to `#overview`/`#tasks`/`#documents` anchors; `scroll-smooth` added
  globally in `layout.tsx`. Same page, same data — navigation aid only, for
  a page that's grown long since sections 9/11 added the category grid and
  724-task list.
- **Document Vault upload from the vault page itself** (`581ea70`): previously
  the only way to upload a document was from inside a specific project's
  detail page (`createDocument`, project pre-bound by the URL). New
  `AddDocumentDialog` on `/documents` (portfolio-wide vault) lets a user pick
  *which* project to upload into via a dropdown, backed by a new
  `createVaultDocument` action — same validation/permission checks
  (`canManageDocumentCategory`) and same `Document` + `AuditEvent`
  transaction as the existing path, just redirects back to `/documents`
  instead of into the project. Gated the same way as before: only shown to
  users with at least one manageable document category
  (`getManageableModules(user).length > 0`).
- **Category tile styling — reverted same week it shipped**: `703d0be`
  (2026-09-22) deliberately flattened `CategoryTile` (no border, no hover,
  no `Link`) specifically *because* section 9 called it "read-only, no
  drill-down page" — the comment in that commit says so explicitly. One day
  later, `12457c0` (2026-09-23) reversed that call: category tiles are now
  clickable, linking to a new `/projects/[id]/categories/[category]` page
  (mirrors the existing `/projects/[id]/stages/[stage]` drill-down — same
  `TaskCard` list, scoped by `Task.category` instead of `Task.lifecycleStage`).
  This directly closes section 9's own "Flagged here in case Apoorv wants
  tap-through later" note. Both tiles now share a `ProgressTile` component
  (`progress-tile.tsx`, new) instead of duplicating the border/hover/badge
  markup — `StageTile` and `CategoryTile` are now thin wrappers around it.
  **This supersedes section 9's UI description** ("Deliberately not
  tappable/no drill-down page") — that line is now inaccurate; category
  tiles behave like stage tiles.

None of these five commits carry the section 4/9/10/11 verification write-up
(real DB + real browser session) in their commit messages — cannot confirm
from the repo alone whether they were click-tested the same way. Worth
checking with Apoorv or doing a pass before the next real-site load (step 6).

**Process note for next time:** all eight commits in sections 12–13 (`50cb62d`
through `12457c0`) landed without a plan.md update alongside them, unlike
every prior step in this file. Re-establishing the habit — updating this
file in the same commit or same session as the change, not after the fact —
avoids needing a reconstruction sweep like this one again.

