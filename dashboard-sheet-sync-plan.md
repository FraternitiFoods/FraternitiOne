# Fraterniti One - Dashboard from the "Site Drawing Updates" sheet (handoff for Claude Code)

Owner: Abhishek. Read this whole file before touching anything.

## 0. Ground rules (non-negotiable)
1. Git: everything happens on the branch `new-main` (already checked out). Do NOT create, switch to, or merge any other branch. First command: `git branch --show-current`. If it is not `new-main`, STOP and tell me; do not switch it yourself. Make small commits on `new-main`. Do NOT push unless I say so (a push can redeploy the live site).
2. Google Sheet: all Apps Script work happens in a COPY of the sheet, never the original. The copy's Apps Script project (container-bound to the copy) is cloned locally with clasp (I give the Script ID, see the prompt). The existing `Code.gs` there is the v16.6 "Site Drawings Automation" script and must keep working exactly as it does today.
3. Do not touch the existing "Site Tracker" (Stage 7) page or the "Site BOQ" feature. Dashboard is a new, separate feature. You may READ the Site BOQ sync code to copy its pattern.
4. Read-only product: no editing of sheet data from the website.
5. If something needs a human (secret token, a Vercel env var, a DB migration on the hosted DB, `clasp push`, deploying the web app, pushing git), stop at that point, say exactly what you need (I am a beginner, give click-by-click steps), and keep doing everything that does not depend on it.

## 1. Mental model (what connects to what)
- The sheet is the boss. The website only shows a synced copy.
- Sheet (13 Stage tabs etc.) -> Apps Script reads it and builds JSON -> sends it to a secured website API (secret token) -> website saves it in Postgres (old data of that site is replaced) -> Dashboard pages read ONLY from Postgres.
- Two things start the same sync: a daily ~10 AM Apps Script trigger, and a "Sync with sheet" button on the website (the website calls the Apps Script web-app URL with the token, Apps Script then runs the push). Same pattern as the Site BOQ sync: mirror it.
- The website never talks to Google Sheets directly.
- Cause and effect: someone changes a status in the sheet -> nothing changes on the website until the next sync -> after sync the dashboard % and ranking change.

## 2. What the user decided
- Bring in: the 13 Stage tabs, Drive Folders, Department Links. Do NOT bring Department Access or Lists. The sheet's "Dashboard" tab is formulas: the website recomputes (section 5) and uses the sheet's numbers only as a check.
- Layouts tab: SKIP. It is retired (hidden after the "Move Layouts into Stage 5" migration); those 29 layouts are ordinary steps in Stage 5 now. If you find it is still live in the copy, ask me first.
- Layout: site-first. Dashboard home = ranking of sites -> click a site -> its 13 stages -> click a stage -> steps.
- Top of Dashboard: site-wise progress ranking (bars, sorted high to low).
- Steps: parent steps with expandable (+/-) sub-steps. "Not required" steps are dimmed and not counted in %.
- Sites: show every site exactly as in the sheet (including "trash" and the Zoca sites).
- Deliverables: clickable link opening the Google Drive file in a new tab.
- Read-only. Sync = daily ~10 AM + a "Sync with sheet" button (internal roles only).
- Access: internal roles see all sites; a franchisee sees only their own site; Admin assigns a site to a franchisee user inside the website (no mapping in the sheet). Enforce on the server, not only in the UI. Use the existing role/auth system.
- Style: dark navy, matching the app, slightly premium (glass cards, gradients).

## 3. Sheet shape (CONFIRMED from the v16.6 Code.gs; still run the dry run to double-check)
The sync code lives in the same Apps Script project, so it can call the helpers already in Code.gs (same global scope): `getSiteList()`, `stageBlockStart()`, `STAGE_INFO`, `smartSheet_()`, `scanStageLayout_()`, `readSiteFolderMap()`, `dashLayout_()`, `stageTabHasShared()`, `columnToLetter()`. Put your code in a NEW file `WebsiteSync.gs`. Do not edit Code.gs.

READ-ONLY RULE: the sync must never write to the sheet. Do NOT call `fixStageSheet_`, `refreshStageLayouts_`, `adoptStageLayout_`, `stageTabHasSubtasks`, `stageTabIsUpgraded`, `handleStageTabEdit` or any upgrade/menu function (they write to cells or to document properties).

Sites: `getSiteList()` = Lists!F2:F30, in order. The site's position (index) in this list is its column position inside every hidden block. Site name = key, exactly as written.

Stage tabs: the 13 canonical keys are `STAGE_INFO[i][0]` ("Stage 1 - Sales & Franchise Acquisition" ...). Find each tab with `smartSheet_(ss, key)` (tabs can be renamed; the live name is `sheet.getName()` - show that on the website; stage number = i+1).
- Row 2 is the header row, steps start at row 3 in column A, the row whose column A says "% Complete" ends the list.
- Get the real shape with the read-only `scanStageLayout_(sheet)` -> {last, pct, leaf, parents{row: subCount}, subOf{row: parentRow}}. Do NOT trust the cached `STAGE_MAP` values (they can be stale after hand-edited rows).
- Visible columns: A Step, B Assigned To, C Status, D Remark, E Deliverable, F Shared? , H2 = "Select Site" dropdown. These show only the currently picked site: never read per-site data from them.
- Hidden per-site blocks start at column 9 (I). With n = `getSiteList().length`, block k, site index s lives in column `9 + k*n + s` (use `stageBlockStart(n, k) + s`). Block 0 = Status, 1 = Remark, 2 = Deliverable, 3 = Assigned To, 4 = Shared (block 4 exists only when `stageTabHasShared(sheet)`, i.e. F2 = "Shared?"; tolerate tabs without it -> shared = false). Row 2 of each block holds the site name: sanity-check it against `getSiteList()` and abort that tab with a clear error if it does not match.
- Parent (header) rows: a step that has sub-rows whose names start with a code like "7.2.5 ...". Parents have NO status of their own in the hidden block (blank); the sheet shows a roll-up. They do not count in any %. The website should derive the parent's displayed status from its children (all non-"Not required" children Completed -> Completed; some Completed/In progress -> In progress; else Not started; all children "Not required" -> Not required). Only leaf rows (plain steps and sub-steps) count.
- Status values: Not started, In progress, Completed, Not required. A blank status on a leaf = Not started. Shared values: "Shared" / "Not Shared" (blank = Not Shared).
- Assigned To is free text and fixed per step (same on every site); still read it from the site's own column.
- Deliverable cells (hidden block 2) hold either `=HYPERLINK("url","file name")` (one file) or a rich-text cell with several links, one per line. Read with `getFormulas()` and `getRichTextValues()` in one batch per tab; parse the HYPERLINK formula, or walk `getRuns()` / `getLinkUrl()`. Store [{name, url}].
- Leaf count per site: Total + Not required = 402 for every site today (leaf rows only). Per stage % = Completed / (leaf rows - Not required).

Drive Folders tab: `readSiteFolderMap(smartSheet_(ss,'Drive Folders'))` -> {site: folderId}; folder URL = `https://drive.google.com/drive/folders/<id>`.
Department Links tab (key 'Department Links'): header Department | Site | Stage | Folder link, rows written by the sheet's own "Apply access". Read as plain values (skip if the tab is missing).
Dashboard tab (check only): `dashLayout_(smartSheet_(ss,'Dashboard'))` gives header/first/grand rows. Columns: A site, B Total, C Completed, D In progress, E Not started, F %, G Shared, H Not Shared, I..U per-stage % (13), V Not Required. Send each site's numbers as `sheetSummary`.

## 4. Payload and sync mechanics
- Vercel request bodies are limited (about 4.5 MB). The whole workbook (about 23 sites x about 400 steps) can exceed that. Send ONE site per request, all tagged with the same syncRunId, then a final "finish" call. The website replaces data site by site inside a transaction, and marks the run complete only after "finish".
- Apps Script has a 6-minute run limit: read each Stage tab ONCE with batch calls (`getValues`, `getFormulas`, `getRichTextValues` over the whole block range), then slice per site in memory. Never read cell by cell.
- Auth: a shared secret token sent in a header, compared in constant time on the server. The token lives in Script Properties (Apps Script) and an env var (website). Never commit it.
- New scopes: `UrlFetchApp` needs the external-request permission. If `appsscript.json` lists explicit `oauthScopes`, add `https://www.googleapis.com/auth/script.external_request`. I will see a one-time "Review permissions" popup; tell me.
- Provide helper functions I can run from the editor (I am a beginner): `dryRunWebsiteSync()` (logs counts, no sending), `runWebsiteSync()` (the real push), `installDailySyncTrigger()` (creates the ~10 AM daily trigger, safe to run twice), and `doPost`/`doGet` for the button (token-checked; returns quickly with a "started" answer if the run takes long). Explain the web-app deployment click by click (Deploy > New deployment > Web app, execute as me, access: anyone, protected by the token).
- Apps Script runs on Google's servers, so it CANNOT call `http://localhost`. For testing against the local dev DB, use a public tunnel (ngrok or cloudflared) pointing at the local dev server and put that https URL in WEBSITE_URL; or test against a deployed preview. Tell me the exact steps and remind me to switch WEBSITE_URL to the real URL later.
- Keep config in Script Properties: WEBSITE_URL, SYNC_TOKEN. Never hardcode them. This keeps `WebsiteSync.gs` portable: later I copy it into the original sheet (which is also v16.6) and set the properties; no other change.
- Include per-site summary numbers from the sheet's Dashboard tab as `sheetSummary`. The website stores them and, after each sync, compares them with its own computed numbers and records any mismatch in SyncMeta (shown to internal roles only).

## 5. Website data (adapt to the existing ORM and naming)
- SyncSite: name (unique), sortOrder, driveFolderUrl, sheetSummary (json), lastSyncedAt
- SyncStep: siteName, stageNo, stageName (live tab name), stepKey, parentKey (null for parents), label, sortOrder, isParent, assignedTo, status, remark, shared (bool), deliverables (json [{name,url}])
- SyncDeptLink: department, siteName, stageFolderName, url
- SyncMeta: lastRunAt, lastRunStatus, error, mismatches
- SiteAssignment: userId -> siteName (Admin edits it)
- Percentages are computed on the website: per stage = Completed / (leaf rows - Not required); per site overall = same over all stages (leaf rows only, parents excluded). If your numbers do not match the sheet's Dashboard, find out why before going further.

## 6. Pages
- Dashboard home: ranking bars (site overall %, high to low), last-synced time, and a "Sync with sheet" button (internal roles only; shows running / done / error).
- Site page: header with overall %, Drive folder link, the 13 stages as cards with their %, department folder links.
- Stage page: steps with status badge, assigned to, Shared / Not Shared, remark, deliverable link buttons, expandable sub-steps, Not required dimmed.
- Franchisee: goes straight to their own site. Admin screen to assign a site to a franchisee user.
- Sidebar: replace the "Coming soon" tag on Dashboard. Leave Site Tracker, Site BOQ and Operations BOQ alone.

## 7. Build order (stop and report at each checkpoint)
A. Schema + ingest API + a small fixture JSON, so website work does not wait for Apps Script. Checkpoint: data visible via a simple query.
B. Apps Script in the sheet COPY: `dryRunWebsiteSync()` first (I paste you the log; counts must match the Dashboard tab), then the extractor, then the per-site push. Checkpoint: one real sync into the local DB.
C. Dashboard UI (home, site, stage) on real synced data.
D. "Sync with sheet" button + daily 10 AM trigger setup.
E. Franchisee site assignment + server-side access checks.
F. Polish, acceptance checks.

## 8. Acceptance checks (use the COPY's Dashboard tab as the truth; numbers below are from the original on 5 Nov 2026 and may differ)
- Grand totals: 9155 tasks, 1460 Completed, 261 In progress, 7434 Not started, 91 Not required, 16% overall, 314 Shared, 8841 Not Shared.
- Per site: Total + Not required = 402; Tulsi Bangalore 75%, Tulsi Indore 47%, Pavitra 43%, Tulsi Hisar 3%.
- Per-stage % per site matches the Dashboard tab's stage columns.
- A franchisee user sees exactly one site; a direct URL to another site is refused by the server.
- Re-running the sync does not duplicate anything; the sheet is unchanged after a sync (nothing written).
- Site Tracker and Site BOQ behave exactly as before; the existing Code.gs automation still works.

## 9. Open points
- Franchisee sees the same stage/step detail for their own site (assumed).
- Drive links open with the viewer's own Google permissions; franchisees probably lack Drive access to these folders and may hit "request access". Decide later: share folders or hide deliverable links from franchisees.
- Stage tab names can be renamed in the sheet; the website shows whatever the live tab name is.
- Stage 7 data now exists in two places (Site Tracker and Dashboard). Keep separate for now.
