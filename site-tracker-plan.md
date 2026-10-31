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
