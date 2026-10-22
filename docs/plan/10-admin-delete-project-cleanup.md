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

