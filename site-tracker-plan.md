# Site Tracker — Plan (branch `new`)

Separate from the Site BOQ plan. Goal: a **usable MVP fast**. Not picture-perfect.
Source: "Site Drawing Updates" Google Sheet, tab **Stage 7 – Construction Execution**. On the website this becomes **Site Tracker** (renamed, same content).

---

## 1. Mental model (simple)

- A restaurant site goes through construction. The work is split into **19 sections** (Site Handover, Civil Work, Flooring Work, ... Snag Closure).
- Each section has **steps** (177 steps total, e.g. `7.2.1`). The steps are the same for every site.
- For every site, every step has a **status**: Not started / In progress / Completed / Not required.
- **Completed needs proof**: at least one photo or video attached.
- At the top you **pick a site**; the page shows that site's tracker.
- Progress % = Completed ÷ (all steps − Not required). Same as the sheet. Checks: Pavitra 66/136, Indore 103/177, Bangalore 177/177.

## 2. Scope

**In MVP**
- Site selector at top (remembers last site).
- Overall progress bar + counts per status.
- 19 sections as accordions, each with its own progress.
- Step row: code + name, status dropdown (colored chip), assignee (text), remark, evidence count + gallery.
- Marking Completed opens a dialog that **forces an upload** (photo/video). No evidence, no Completed.
- Not required: optional reason.
- Filters: status filter, search by step name/code, "hide completed".
- "All sites" tab: one row per site with progress %.
- Mobile friendly (site engineers will use phones).
- Sidebar: Site Tracker becomes a live link to `/site-tracker`.

**Left out of MVP** (do not build)
"Shared?" flag, Deliverable links, section-level notes, template/step editor, bulk update, notifications, export, comments thread.

## 3. Data model (Prisma, Postgres)

Shared **Site** table with two flags: `usedInBoq`, `usedInTracker` (plus existing `isActive`). Site BOQ import must only touch `usedInBoq`, never `isActive` or `usedInTracker`. Tracker seed only sets `usedInTracker`.

- `TrackerSection`: id, name, order, isActive
- `TrackerStep`: id, sectionId, code (unique, e.g. "7.2.1"), name, order, isActive, synthetic (bool)
- `TrackerSiteStep`: id, siteId, stepId, status (enum NOT_STARTED / IN_PROGRESS / COMPLETED / NOT_REQUIRED), assignee, remark, notRequiredReason, completedAt, completedById, legacyCompleted (bool), updatedAt, updatedById. Unique (siteId, stepId). **Lazy rows**: no row = NOT_STARTED.
- `TrackerEvidence`: id, siteStepId, storageKey, fileName, mimeType, sizeBytes, kind (IMAGE | VIDEO), uploadedById, createdAt

Audit: reuse existing `AuditEvent` (check its action enum/migration; add values only if needed).

Seed from `prisma/seed-data/site-tracker-steps.json` (19 sections, 177 steps, 22 sites). Seed must be idempotent (upsert by step code / site name). Step codes are the sheet's own and non-contiguous; never renumber.

Site linking: tracker site names differ from BOQ names. JSON has optional `linkBoqNames`. Rule: if an existing Site matches a name in `linkBoqNames` (case-insensitive), reuse that Site and set `usedInTracker = true`; otherwise create a new Site. **Do not guess for Pavitra vs Pavitra Vadodara**: keep them as two separate sites and list them in the report for a human decision.

## 4. Rules (enforced on the server)

1. COMPLETED requires >= 1 evidence (already stored + sent in same request), unless `legacyCompleted = true`.
2. Moving away from COMPLETED is allowed; evidence stays. Completing again later needs existing evidence >= 1 (or new).
3. Evidence delete: Admin only. Cannot delete the last evidence of a COMPLETED, non-legacy step (change status first).
4. NOT_REQUIRED: no evidence needed, reason optional.
5. Progress = completed / (activeSteps − notRequired). If denominator is 0 show 0%.
6. Who can update: Admin + internal roles. External roles: no sidebar item, 403 on pages and APIs. Check how existing roles are modelled and reuse the same helper used for `/site-boq`.
7. Every status change / evidence add / evidence delete writes an audit event (who, when, site, step code, old -> new).

## 5. Evidence upload design

Vercel request bodies are limited (~4.5 MB), so videos cannot go through our server. Use **presigned direct-to-B2 upload**:

1. Client asks `POST /api/tracker/evidence/presign` with siteId, stepId, fileName, mimeType, size. Server validates auth, role, MIME, size, returns `{ uploadUrl, storageKey }`.
2. Client PUTs the file straight to B2 with progress.
3. Client calls `POST /api/tracker/evidence/confirm` (siteId, stepId, storageKey, fileName, mimeType, size). Server HEADs the object to verify it exists and the size matches, then creates `TrackerEvidence`.
4. Viewing: `GET /api/tracker/evidence/[id]` checks auth then redirects to a short-lived signed GET URL.

Limits: images <= 15 MB, videos <= 100 MB. MIME allowed: image/jpeg, image/png, image/webp, video/mp4, video/quicktime, video/webm. (HEIC is not allowed in MVP; phones usually convert to JPEG on upload from the web picker. Show a clear error otherwise.)
Storage key: `site-tracker/<siteId>/<stepId>/<uuid>.<ext>`. Use the existing helper `src/lib/storage.ts`; extend it with presign functions if missing.
Client image compression before upload (max ~1920px, quality 0.8) is a nice-to-have, do it only if quick.

**Dev fallback**: if B2 credentials are blank and `NODE_ENV !== production`, store to local disk (`.local-uploads/`, gitignored) through a dev-only route so everything can be tested without B2. In production, missing creds = clear error, no silent fallback.

**B2 setup (human)**: B2 credentials are currently blank in `.env`. Needed: bucket + application key (env var names as in `storage.ts`) and a **CORS rule** on the bucket: origins `https://fraterniti.one` and `http://localhost:3000`; operations s3_put, s3_get, s3_head; allowed headers `*`; expose header `ETag`. Without this, browser uploads fail.

## 6. Screens

`/site-tracker` (single page)
- Top bar: Site selector (searchable), tabs **Tracker | All sites**.
- Summary card: overall % progress bar, chips with counts (Not started / In progress / Completed / Not required).
- Filters: status, search, hide completed.
- Sections list: accordion header = name + `done/total` + mini progress bar. Open by default: first section that is not 100%.
- Step row: `7.2.1  Step name` | status chip dropdown | assignee | remark | evidence icon with count (opens gallery: image lightbox, video player) | last updated by/at (small).
- Completed dialog: shows file picker (camera allowed on mobile: `accept="image/*,video/*"`, `capture` not forced), previews, upload progress, Confirm disabled until >= 1 file uploaded (or step already has evidence, then it just confirms).
- Edits save on change with optimistic UI and a toast on error.
- "All sites" tab: table site | % | completed | in progress | not started | not required; click opens that site's tracker.

Style: same look as the rest of the app (Tailwind v4 / shadcn). Colors: Not started grey, In progress amber, Completed green, Not required slate/blue-grey. Simple and clean.

## 7. Phase 2 (after MVP works): import current statuses from the live sheet

`POST /api/import/tracker` with bearer `IMPORT_SECRET`. Body: `{ rows: [{ siteName, stepCode, status, assignee, remark }] }`. Upsert by site name + step code. Imported COMPLETED -> `legacyCompleted = true` (exempt from evidence rule). Skip rows that were already edited on the website unless `overwrite: true`. Returns counts + warnings (unknown site, unknown step code). Abhishek pushes from the live sheet using Apps Script later (separate prompt). Not part of this MVP prompt except if time allows: build the endpoint, no sheet side.

## 8. Milestones

- T1: schema, migration, seed, Site flag change (no BOQ regression).
- T2: read APIs + `/site-tracker` UI (selector, progress, sections, rows, All sites tab), sidebar link.
- T3: status/assignee/remark edit APIs + roles + audit.
- T4: evidence upload (presign/confirm/view/delete) + Completed dialog + gallery.
- T5: e2e test, no-regression run, report.
- T6 (optional): import endpoint.

## 9. Acceptance numbers

- Seed: 19 sections, 177 steps, 22 sites; seeding twice gives identical counts.
- Progress examples from the sheet: Pavitra 66 completed, 41 not required of 177 steps -> 66 / 136 = 48.5%. Indore 103 / 177 = 58.2%. Bangalore 177 / 177 = 100%.
- COMPLETED without evidence is rejected with 4xx by the API (not just UI).
- External role gets 403.

## 10. Human to-dos

1. B2 bucket + keys + CORS rule (section 5).
2. Decide Pavitra vs Pavitra Vadodara, verify `linkBoqNames` guesses.
3. Later: ask Abhishek to push current statuses (Phase 2).

## Progress log
(Claude Code appends here after each milestone.)

### 2026-11-02 — T1 through T6 — Site Tracker MVP built end-to-end

**Verified:**
- `pnpm run test` (48/48, 12 new in `src/lib/tracker-calc.test.ts` against this file's own section 9 numbers — Pavitra 66/136=48.5%, Indore 103/177=58.2%, Bangalore 177/177=100%, plus the evidence/completion rules), `pnpm run lint` (clean — the one warning is the pre-existing unrelated one in `src/lib/email-domain.ts`), `pnpm run typecheck` (clean, including `next typegen` for the new routes) and `pnpm run build` (clean; lists all 7 new `/api/tracker/*` routes, `/api/import/tracker` and `/site-tracker`) all pass.
- Migration `20261031113912_site_tracker_schema` applied cleanly to the dev DB.
- `npm run seed:tracker` run twice against the dev DB: 19 sections, 177 steps, 22 tracker sites both times (byte-identical on the second run) — matches section 9's acceptance numbers exactly. Against this DB's actual data (only `scripts/fixtures/boq-import-fixture.json`'s 3 fixture sites, not the real sheet), **0 of the 22 tracker sites linked to a BOQ site** — none of the fixture's site names ("Fixture Site A/B/C") match any `linkBoqNames` entry, so all 22 were created fresh as tracker-only `Site` rows (`usedInBoq: false, usedInTracker: true`). "Pavitra" and "Pavitra Vadodara" have no `linkBoqNames` in the seed JSON and were correctly created as two separate sites, per this file's own instruction not to guess. **This will look different once the real sheet data is imported** — re-run the seed after that import and check the linked-sites list again (plan's human to-do #2).
- A real Playwright pass against `pnpm dev`, `scripts/tmp-e2e-site-tracker.ts` (`npx tsx scripts/tmp-e2e-site-tracker.ts`), 20/20 checks passing on two consecutive runs, using the "Pavitra" site and 4 of its "Site Handover" steps (reset before/after, safe to re-run): Admin can select a site and see its name reflected in the selector; picking "Completed" with no evidence opens the forced-upload dialog with Confirm disabled, not an immediate save; a **direct API call** (`PATCH /api/tracker/site-steps`, bypassing the UI entirely) to mark a fresh step Completed with no evidence is rejected with a 4xx; uploading a small image (via the dev-disk fallback — B2 credentials are configured in `.env` but the bucket's CORS rule isn't set yet, see below) enables Confirm, and confirming sets the step Completed with evidence count 1; a different step set to Not required shrinks the progress denominator and persists server-side; a directly-seeded `legacyCompleted` row shows as Completed with 0 evidence with no forced dialog, and can be re-confirmed Completed via the API with 0 evidence; a non-admin internal role (SALES) can open Site Tracker and edit but gets 403 attempting to `DELETE` an evidence row (Admin-only); an external role (FRANCHISEE) gets 403 on both the page and `/api/tracker/sites`, and has no `<a href="/site-tracker">` link in the sidebar at all.
- Re-ran all four existing Site BOQ e2e scripts after re-pushing `scripts/fixtures/boq-import-fixture.json` (to pick up the `usedInBoq` change): `tmp-e2e-m3-site-boq.ts` (25/25), `tmp-e2e-m5-site-boq-edit.ts` (30/30), `tmp-e2e-m5-site-lock.ts` (34/34), `tmp-e2e-m6-purchase-orders.ts` (21/21) — all pass, confirming **no regression** from switching Site BOQ's site-visibility/deactivation logic from `isActive` to the new `usedInBoq` flag. DB left clean afterward (`mode = SHEET_LIVE`, 0 locked sites, 0 purchase orders, `usedInBoq`: 3 sites, `usedInTracker`: 22 sites, 0 overlap).
- T6 (optional, built since T1–T5 all passed cleanly and quickly): `scripts/push-tracker-fixture.ts` (kept, like `push-boq-fixture.ts` — `npx tsx scripts/push-tracker-fixture.ts` against a running `pnpm dev`), 10/10 checks: wrong bearer secret → 401; unknown site/unknown step code → warnings + `skippedUnknown` count, not a hard failure; an imported `COMPLETED` row gets `legacyCompleted: true` with 0 evidence and stays valid; a row a real user already edited on the website (`updatedById` set) is left alone on re-push unless `overwrite: true`, in which case it's processed.
- One genuine UI bug the e2e script caught and this session fixed: `SiteSelector`'s `<SelectValue>` had no children, so Base UI's Select fell back to showing the raw `site.id` (a cuid) in the trigger instead of the site's name — fixed by passing a render function (`{(value) => sites.find(...).name}`), matching the pattern this repo's own `new-user-form.tsx`/`edit-user-form.tsx`/`filter-select.tsx` already use for every other `<SelectValue>` with dynamic content. `StatusSelect`'s `<SelectValue>` happened to work already since its children are a static label lookup, not a value→label search.

**What was built (site-tracker-plan.md's full T1–T6 scope):**
1. **Schema** (section 3): `TrackerSection`, `TrackerStep`, `TrackerSiteStep` (lazy — no row means `NOT_STARTED`), `TrackerEvidence`, `TrackerStepStatus`/`TrackerEvidenceKind` enums; `Site.usedInBoq` (default `true`) and `Site.usedInTracker` (default `false`). No new `AuditAction` values were needed — `CREATE`/`UPDATE`/`DELETE` already cover every Tracker write.
2. **Site BOQ import fix**: `runSitesChunk` now sets `usedInBoq: true` on every pushed site instead of `isActive: true`; `finishImportRun` now flips `usedInBoq: false` (not `isActive: false`) for a site missing from the run. `isActive` is no longer touched by the BOQ import at all — it's purely the Admin's manual "hide" toggle on the Sites page now, independent of either module's own on/off flag. `getActiveSites`/`getAllSites`/`getComputedItems` in `boq-data.ts` now all filter on `usedInBoq` too, so a Tracker-only site can never leak into a Site BOQ screen.
3. **Seed**: `prisma/seed-tracker.ts` (`npm run seed:tracker`), reading the already-present `prisma/seed-data/site-tracker-steps.json`. Links by case-insensitive exact match on `linkBoqNames`; otherwise upserts a new `Site` by the tracker's own exact name (idempotent — a second run reuses the same row instead of hitting the `Site.name` unique constraint).
4. **Read helpers**: `src/lib/tracker-calc.ts` (pure: `trackerProgressPercent`, `canMarkCompleted`, `canDeleteEvidence`), `src/lib/tracker-data.ts` (`getSiteTrackerSummary`, `getAllSitesProgress`, `getTrackerSites` — the last deliberately ignores `isActive`, since hiding a site from Site BOQ shouldn't also pull it out of the Tracker), `src/lib/permissions.ts` (`canViewSiteTracker`/`canEditSiteTracker`/`canDeleteTrackerEvidence`), `src/lib/site-tracker-access.ts` (`requireSiteTrackerUser`, the page-level 403 gate).
5. **UI** (`src/app/(app)/site-tracker/`): a single page, client-driven (unlike Site BOQ's Server-Action/query-param convention — this module needed real REST endpoints anyway for the presigned-upload flow, so the whole page fetches from `/api/tracker/*` and manages state client-side, with optimistic updates + `sonner` toasts on error). Site selector remembers the last site via `localStorage` (wrapped in try/catch); Tracker/All sites tabs; summary card with the overall % and status-count chips; filters (status, search, hide-completed); sections as native `<details>` accordions (no new UI-primitive dependency), auto-opening the first section under 100%; step rows with the status chip dropdown, assignee/remark inline fields (save-on-blur, uncontrolled `defaultValue`+`key` pattern — same convention as Site BOQ's `qty-cell.tsx`, needed to satisfy the `react-hooks/set-state-in-effect` lint rule), and an evidence icon+count that opens a dialog serving double duty as both the gallery (image lightbox, native `<video controls>`) and the forced-upload "Completed" dialog. Sidebar: "Site Tracker" is now a live link; the external-role filter was generalized from a single `"Site BOQ"` string check to an `INTERNAL_ONLY_LABELS` list covering both.
6. **Edit API**: `PATCH /api/tracker/site-steps` (lazy TrackerSiteStep creation, server-side rule 1 enforcement, audit event per change). Evidence: `POST /api/tracker/evidence/presign` + `/confirm` (HEAD-verify size/existence before creating the row), `GET`/`DELETE /api/tracker/evidence/[id]` (view redirects to a signed B2 GET or streams the local dev file; delete is Admin-only and blocked on the last evidence of a Completed non-legacy step). `src/lib/storage.ts` gained the B2 primitives (presigned PUT/GET, HEAD, DELETE, `isB2Configured`); `src/lib/tracker-storage.ts` composes those with the local-disk dev fallback (`.local-uploads/`, gitignored, strict key-shape validation before touching the filesystem) and a dev-only `PUT /api/tracker/evidence/dev-upload` route that 404s whenever B2 is actually configured or `NODE_ENV === production`.
7. **T6 (optional)**: `POST /api/import/tracker` (section 7 Phase 2) — same `IMPORT_SECRET` bearer mechanism as `/api/import/boq/*`, no mode gate (the Tracker has no `SHEET_LIVE`/`WEBSITE_LIVE` concept). Upserts by site name + step code; "already edited on the website" is detected via `TrackerSiteStep.updatedById` being non-null (only the website's own `PATCH` route ever sets it — this import never does), no new schema field needed.

**Scope decisions made this session, not spelled out verbatim in the plan, with the reasoning:**
- Evidence storage object deletion on `DELETE /api/tracker/evidence/[id]`: the plan only asked for the DB row rule, but leaving orphaned files in B2/disk forever seemed like an obvious expectation of "delete," so the route also deletes the underlying object (best-effort, logged not thrown, so a storage hiccup never blocks the DB delete the user actually asked for).
- `isActive` vs `usedInBoq`/`usedInTracker`: `isActive` is now purely the Admin's manual Sites-page "hide" toggle, untouched by either module's import/seed. Each module's own visibility is its own flag, checked independently — a site hidden from one module stays fully visible in the other unless an Admin also unticks its own flag (no UI for that yet in either module beyond BOQ's existing hide toggle; Tracker has no hide UI at all, matching "left out of MVP").
- No audit events from the Phase 2 bulk import, matching the Site BOQ import's own precedent (`boq-import.ts` writes none either) — `AuditEvent.actorEmail/actorName/actorRole` are non-nullable, and a bearer-secret push has no real user to attribute them to.
- `legacyCompleted` is sticky once set by an import — a later website edit to the same step (changing assignee/remark, or even moving status away and back) never clears it. Simplest safe behavior; the plan doesn't say otherwise.

**Still pending / needs a human (plan section 10):**
1. **B2 CORS rule** — credentials are now filled into `.env` (they were blank in earlier Site BOQ sessions), confirmed reachable (`npx tsx scripts/configure-b2-cors.ts` connects fine), but **no CORS rule is configured on the bucket yet** (confirmed via that same script's read-only check). Needed before a real browser can PUT evidence straight to B2: origins `https://fraterniti.one` and `http://localhost:3000`; operations `s3_put`, `s3_get`, `s3_head`; allowed headers `*`; expose header `ETag`. Env var names (already used by `src/lib/storage.ts`, unchanged by this session): `B2_ENDPOINT`, `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME`. This session's own evidence-upload testing used the local-disk dev fallback specifically to avoid touching the live bucket's CORS config without your say — `scripts/configure-b2-cors.ts` exists but serves a different (older, Phase 1) feature's origin list, so it wasn't reused or run with `--apply` here.
2. **Pavitra vs Pavitra Vadodara / linkBoqNames guesses** — not actually guessable yet: the dev DB only has 3 fixture BOQ sites, none matching any real sheet name, so 0 of 22 tracker sites linked this run. Re-run `npm run seed:tracker` after the real Site BOQ sheet data is imported and sanity-check the linked-vs-created list printed by the seed at that point.
3. Phase 2 (T6): the endpoint and its fixture test exist; Abhishek's Apps Script side is still not started, per the plan's own scoping ("no sheet-side work").
