# Fraterniti One — `new` branch plan: Site BOQ

> This file replaces the old `plan.md`. The `docs/` folder is deleted on this branch.
> Work ONLY on branch `new`. Never push to or merge into `main` or `dev`. Old code stays safe there.

---

## 1. Mental model (read this first)

Fraterniti One is the internal web app. On this branch we reuse its look, login, users/roles and layout, but the sidebar becomes small and the first real module is **Site BOQ**.

**Site BOQ = the "TULSI Rate Sheet" Google Sheet, rebuilt as a web module.**

Plain version of what the sheet does:

1. There is a list of **sites** (restaurants being fitted out): Ayodhya, Mumbai, Indore, Cuttack...
2. There is a list of **categories** (Uniforms, Kitchen Smallware, Furniture, Lighting, Ducting, AC...). 21 of them. They rarely change.
3. Each category has **items** (with photos). An item has **one rate per vendor**. One vendor is picked as **Final Vendor**, and that vendor's rate becomes the item's **final rate**.
4. For each **site**, we enter a **quantity** per item. (Rate belongs to the item, quantity belongs to the site.)
5. `Amount = final rate × qty`. Everything else is sums of that:
   - **Overview** = site × category order value.
   - **Site view** = for one site: what is missing a rate, what is not ordered yet, and how many days until opening.
6. Per site and item we also track the order: stage, PO link, advance given, pending, follow-up, remarks.
7. **Purchase Order**: pick site + category + vendor(s) → a PO is generated from the quantities → PDF for the vendor.

Cause and effect to keep in mind:
- Change an item's final vendor or rate → every site's amount and every dashboard total changes.
- Change a site's qty → only that site's amount changes (plus totals that include it).
- Set a site's opening date → "days left" and the urgency colour change on Site view.

### Two phases of life (important)

Until rollout, the **Google Sheet stays the live source of truth**. The website is a copy that gets refreshed by a "push" from the sheet. At rollout we flip a switch and the **website becomes the source of truth** (sheet is retired).

This is controlled by one setting, `mode`:

| mode | Website UI | Import/push endpoint |
|---|---|---|
| `SHEET_LIVE` (default now) | Read-only everywhere (viewing, filters, dashboards, PDF preview OK) | Enabled, overwrites BOQ data |
| `WEBSITE_LIVE` (set at rollout) | Editing enabled according to roles | Disabled (returns 403) so nothing overwrites website data |

Only an Admin can flip `mode`, from Settings, with a confirmation dialog explaining it is a one-way switch in practice.

---

## 2. Scope of this branch

### Keep
- Existing UI/UX: look and feel, components, design system, layout shell, header.
- Login/session auth, users, roles/permissions (RBAC), admin-only registration.
- Stack as it is in the repo (Next.js + TypeScript + PostgreSQL). Inspect the repo to confirm the ORM, migration tool and storage helpers before writing anything. Do not introduce a second ORM or UI library.

### Remove on this branch
- `docs/` folder and the old `plan.md`.
- Old module pages, API routes, components and DB models that are not needed for auth/users/roles/layout. Be careful: if you are not sure something belongs to auth or the shell, keep it and list it in your final report. Old code is safe on `main`/`dev`, so deleting here is fine.
- Old sidebar entries.

### Database
- `new` uses its **own, separate Postgres database**. Never point it at the dev database.
- Start a fresh migration history for this database: one baseline migration with the auth/users/roles tables plus the new BOQ tables below.
- Env vars needed (ask the human for values, do not invent): `DATABASE_URL` (new DB), `IMPORT_SECRET` (shared secret for the sheet push), and storage credentials for photos if the repo does not already have storage set up.

### Sidebar (exactly 4 items, in this order)
1. **Dashboard** — "Coming soon", not clickable.
2. **Site Tracker** — "Coming soon", not clickable.
3. **Site BOQ** — live, goes to `/site-boq`.
4. **Operations BOQ** — "Coming soon", not clickable.

"Coming soon" items: muted style, small "Coming soon" pill, no link, no route, `aria-disabled="true"`. After login, land on `/site-boq`.

Site BOQ is **internal only**. If the app has any external roles (franchisee-type), they must not see the sidebar item and must get 403 on `/site-boq/*` and `/api/boq/*`.

### Out of scope now
Dashboard, Site Tracker and Operations BOQ pages; sending POs by email/WhatsApp (PDF only); payments/accounts ledger; anything about the old modules.

---

## 3. Data model

Use the repo's ORM conventions. Money in `numeric(14,2)`. Quantities in `numeric(12,2)`. Soft-delete via `is_active`, never hard-delete imported rows.

**sites**: id, `source_key` (unique, from sheet Site ID), name (unique), short_code, opening_date (nullable), note, is_active, sort_order, `is_locked` (default false), `locked_at` (nullable), `locked_by` (nullable, the Admin user who locked it — see Site lock below).

**categories**: id, name (unique, e.g. "Kitchen Smallware"), display_name, `group` (`operating` | `interior`), sort_order. Seed the 21 in section 8.

**vendors**: id, name (unique), address, gstin, phone, email, note. (Vendor details are empty in the sheet today; they are filled later in the UI and are needed for POs.)

**category_vendors**: category_id, vendor_id (a vendor can serve several categories; the sheet lists up to 8 per category).

**items**: id, `source_key` (unique, from sheet Item ID), category_id, name, size_note, final_vendor_id (nullable), note, is_active, sort_order.

**item_photos**: id, item_id, storage_key, sort_order. An item may have 1–3 photos.

**vendor_rates**: item_id, vendor_id, rate (nullable), unique(item_id, vendor_id).

**site_items**: site_id, item_id (unique pair), qty, remark_size, `rate_override` (nullable, see below), `locked_rate` (nullable, see Site lock below), and the order-tracking fields from the sheet: `po_amount`, `boq_link`, `po_link`, `approved_via`, `link`, `advance_given`, `stage`, `follow_up`, `remarks`. Create rows only when something is non-empty.

**purchase_orders**: id, po_number (unique), site_id, category_id, vendor_id, po_date, delivery_by, delivery_days, payment_terms, gst_percent, subtotal, gst_amount, total, status (`draft` | `issued`), created_by, created_at, and a snapshot of company/vendor/site details used on the PDF.

**po_lines**: po_id, item_id, name_snapshot, remark_size, qty, rate, amount, photo_storage_key.

**app_settings** (key/value): `mode` (`SHEET_LIVE` default), company_name, company_address, company_gstin, company_phone, company_email, signatory_name, default_gst_percent (18), default_payment_terms ("50% advance, balance within 7 days after delivery"), default_delivery_days (7), po_terms (4 lines, see section 6.6), urgent_days (7), soon_days (30).

**import_runs**: id, status, started_at, finished_at, counts (jsonb), warnings (jsonb), dry_run.

### Rate rules
- `final_rate(item)` = the rate of `item.final_vendor` in `vendor_rates`. No final vendor, or rate empty/0 → rate is **missing** (store null, never treat 0 as a real price).
- `effective_rate(site, item)` = `site_items.rate_override` if set, else `final_rate`. The sheet has one rate for all sites, so imports leave overrides null, but the UI/data model must support a site-specific override later.
- `amount(site, item)` = `qty × effective_rate` (0 if either missing).
- Order-tracking "pending" = `po_amount − advance_given` (verify with the sheet owner, see section 9).

### Site lock
- Only Admin can lock or unlock a site (enforced on the server, section 5).
- On lock: copy every one of that site's `site_items.effective_rate` into `site_items.locked_rate`, and stamp `is_locked = true`, `locked_at`, `locked_by`. While locked, `amount(site, item) = qty × locked_rate` instead of `qty × effective_rate` — later changes to an item's final vendor/rate never change a locked site's numbers.
- While locked, the server rejects every edit to that site's `qty`, `remark_size`, `rate_override` and the order-tracking fields, for every role including Admin. Admin must unlock first.
- Unlock requires a confirmation dialog, then clears every `locked_rate` back to null on that site's `site_items` and writes an audit log entry (who, when, which site).
- Locked sites show a lock badge everywhere the site appears (Overview, Site view, Items & Qty, Sites). For now, locked sites are still included in "rates missing / not ordered" nagging counts unchanged — excluding them is deferred until the plan owner confirms that's wanted.
- Lock state is website-native data, not sheet data: the import (section 7) must never overwrite `is_locked`, `locked_at`, `locked_by` or `locked_rate`. Locking/unlocking is allowed in `SHEET_LIVE` mode (it is not a BOQ data edit), but while a site is locked, the sheet push skips that site's quantity/tracking fields and adds an import warning instead of overwriting them.

---

## 4. Screens (all under `/site-boq`, top sub-navigation)

Keep the existing UI style. Simple, clean, readable tables. Indian number format (`en-IN`, ₹, lakh/crore grouping). Sticky table headers, search box, and filters. Must work on a laptop first; phone-friendly is nice to have.

### 4.1 Overview (the sheet's "Dashboard")
- Table: rows = sites, columns = categories, cell = order value, plus a Site Total column and an All Sites total row.
- Insight cards: grand total, highest-value category, highest-value site, lowest-value site with any qty, average per site, number of sites, number of categories.
- Click a site name → Site view for that site.

### 4.2 Site view (the sheet's "Site Dashboard")
- Site selector.
- Banner counts for the selected site: items with missing rates, items not ordered, items ordered, total items (items = qty > 0).
- Category table for that site: items, rates missing, not ordered, ordered, order value, PO amount, advance given, pending, "Open" link to Items & Qty for that site+category.
- Opening reminder table for ALL sites: opening date, days left, items, ordered, rates missing, not ordered, order value, status chip:
  - no date → "No date"; date passed → "Opened"
  - days left ≤ `urgent_days` → red "Urgent"; ≤ `soon_days` → amber "This month"; else neutral.
- "What's pending" list for the selected site: every item with qty > 0 that has no rate or is not ordered; columns: item, qty, rate (or "No rate"), order status, category, vendor; filters by category and status.

### 4.3 Items & Qty (the sheet's `RM - <Category>` tabs)
- Selectors: category, site.
- Table: photo(s), item, remark/size (for the selected site), qty (for the selected site), final vendor, final rate, amount, then one column per vendor of that category showing their rate, notes. Row totals at the bottom; a "total across all sites" qty/cost column pair.
- Per-row drawer for the tracking fields (stage, PO link, BOQ link, approved via, advance, pending, follow-up, remarks).
- Editable cells only when `mode = WEBSITE_LIVE` and the role allows it (section 5). In `SHEET_LIVE` everything is visibly read-only with a small "Sheet is live — data syncs from the sheet" note.
- Admin can add an item (name, photo upload, vendor rates, final vendor) in `WEBSITE_LIVE`.

### 4.4 Vendors
List grouped by category. Vendor detail: name, address, GSTIN, phone, email (these feed POs). Editable by Admin only (also allowed in `SHEET_LIVE`, because the sheet has no data for these fields and the import must never overwrite them).

### 4.5 Purchase Orders
- Create: choose site, category, one or more vendors (or "all vendors"), PO date, delivery-by / days, GST %, payment terms. Lines = items for that site+category (qty > 0) whose final vendor is the chosen vendor. Preview on screen, then **Download PDF**.
- PO list with search by number, site, vendor; open → view/re-download.
- PO numbering: configurable prefix + running number, default `FF-PO-<YYYY>-<NNNN>`. Flag to the human that the real format must be confirmed.
- Allowed in both modes (POs are website-native data, not imported). Creating a PO never changes BOQ quantities.

### 4.6 Sites (Admin)
List, add, rename, opening date, short code, hide. In `SHEET_LIVE`, site names and opening dates come from the sheet; show them read-only there, with a note.

### 4.7 Settings (Admin)
Company details for PO header, PO defaults and terms, urgency thresholds, **mode switch**, and the **Import status** panel (last run time, counts, warnings, button to view warnings).

---

## 5. Roles

| Action | Admin | Other internal roles | External roles |
|---|---|---|---|
| View all Site BOQ screens | yes | yes | no |
| Edit qty, remark/size, order-tracking fields | yes | yes | no |
| Edit items, vendor rates, final vendor, add items | yes | **no** | no |
| Edit vendors, sites, settings, flip mode | yes | no | no |
| Create/download POs | yes | yes | no |
| Lock / unlock a site | yes | **no** | no |

All edits are blocked when `mode = SHEET_LIVE` (except vendor contact details, PO creation, settings), enforced on the server, not just hidden in the UI.

Site lock is a second, independent gate on top of the table above: while a site `is_locked`, nobody — not even Admin — can edit that site's qty, remark/size, rate_override or order-tracking fields in either mode; Admin must unlock the site first. Locking/unlocking itself is Admin-only in both modes.

Add a lightweight audit log for edits in `WEBSITE_LIVE` (who, when, what field, old → new). Unlocking a site always writes an audit log entry, in either mode.

---

## 6. Calculations and rules in detail

6.1 Item counts on Site view use only items where `qty > 0` for that site.
6.2 **Order status** of a (site, item): the sheet derives "Ordered / Not ordered" in a way we have not seen. Until the sheet owner confirms the rule (section 9), implement it as a single isolated function `isOrdered(siteItem)` with the placeholder rule "stage is non-empty or `po_link` is non-empty", and keep the sheet's raw `stage` text visible.
6.3 Days left = `opening_date − today` in IST.
6.4 Currency display: `en-IN`, no decimals on dashboards, two decimals on item tables.
6.5 A "No rate" item with qty > 0 must be highlighted wherever amounts are shown.
6.6 PO terms (company's own wording, editable in Settings, shown on the PDF):
   1. Delivery within N days of the PO date.
   2. Goods must match the approved sample/photo; damaged or different goods are returned.
   3. Send goods with a GST invoice; the PO number must be written on the invoice.
   4. The company may cancel the PO if delivery is delayed.
   PO totals: subtotal, GST % (default 18), grand total. Header: company name, address, GSTIN/phone/email, signatory. Item photos appear on the PO lines.

---

## 7. Import from the sheet (push model)

An Apps Script in the sheet (written by Abhishek, see his brief) pushes data to the website. The whole workbook is too large to export in one go, so the push is **chunked and idempotent**.

All requests: `Authorization: Bearer <IMPORT_SECRET>`, JSON, HTTPS only. Reject with 403 when `mode = WEBSITE_LIVE`. Reject wrong/missing secret with 401. No user session involved.

### Endpoints
1. `POST /api/import/boq/begin` body `{ "dryRun": false }` → `{ "runId": "..." }`.
2. `POST /api/import/boq/chunk` body `{ "runId", "type", "data" }` where `type` is one of:
   - `sites`: `[ { siteKey, name, shortCode, openingDate } ]`
   - `vendors`: `[ { name, categories: ["Uniforms", ...] } ]`
   - `category`: one category per request:
     ```json
     {
       "category": "Kitchen Smallware",
       "group": "operating",
       "vendors": ["Gogia"],
       "items": [
         {
           "itemKey": "ITM-0001",
           "name": "GN PAN 1X2X6 WITH LID",
           "note": "",
           "finalVendor": "Gogia",
           "rates": { "Gogia": 605 },
           "sites": [
             { "siteKey": "S-001", "qty": 8, "remarkSize": "", "poAmount": null,
               "boqLink": "", "poLink": "", "approvedVia": "", "link": "",
               "advanceGiven": null, "stage": "", "followUp": "", "remarks": "" }
           ]
         }
       ]
     }
     ```
3. `POST /api/import/boq/photo` body `{ "runId", "itemKey", "index", "mimeType", "dataBase64" }` — one photo per request, store and link. Replace the item's photos on re-push (idempotent by `itemKey + index`).
4. `POST /api/import/boq/finish` body `{ "runId" }` → commits, soft-deactivates items/sites that were not seen in this run (`is_active = false`), writes `import_runs` with counts and warnings, returns the summary.

### Rules
- **Upsert by `itemKey` and `siteKey`** (stable IDs added to the sheet by Abhishek: a hidden Item ID column in every RM tab, a Site ID column in Sites). If an item arrives without `itemKey`, fall back to `category + name + occurrence index` and add a warning.
- The sheet does not hold vendor contact details; import must **never overwrite** vendor address/GSTIN/phone/email, or PO data.
- Treat rate 0 or empty as missing (null).
- Do not auto-merge duplicates; emit warnings (for example the same item name twice in one category, or the same name in two categories with different rates). Examples known today: "Japanese Cocktail Glass" ×3 in Glassware; "Cream Siphon" in both Kitchen Smallware (₹1,680) and FOH & Bar (₹2,400).
- Vendor names are imported as given, including entries that are really quotes (for example "Greenhouse – Mohali quote (16-Jul-26)", "Sharma Gas Service (Q-398, 21-Jul-26)") or placeholders ("Vendor 1 (confirm name)"); add a warning for names containing "confirm" or a quote/date pattern.
- A whole `finish` is one transaction per category chunk at minimum; a failed run must leave previous data intact.
- Photos: the sheet has in-cell images. Whether Apps Script can read them (e.g. via the cell image content URL) has to be verified in a spike (section 10, M4). If it works, push via the photo endpoint; if not, items import without photos and photos are uploaded in the UI by Admin. Photo storage: reuse the repo's existing storage helper if there is one; otherwise ask the human which storage to use.

### Import status UI
Settings → Import status: last run, duration, counts (sites, categories, items, rates, site_items, photos), warnings table.

---

## 8. Seed data

### Categories (21)
Operating: Uniforms · Probes (display "Probes & Table Decor") · POS & Printers · Kitchen Smallware · Glassware · DEWNOW (display "Glassware & Bar Accessories") · FOH & Bar (display "FOH & Bar Equipment") · Cutleries · Ceramic Studio · Decor · FFPL x Global (display "Printed Collaterals").

Interior: Planters (display "Artificial Plants & Tree") · Lighting · Furniture · Wallpaper & Decor · Photo Frames.

Added later (group: operating): Equipments · Gas · Ducting · Tiles · AC.

Note: the sheet also has hidden helper tabs ("MUM - FOH&Bar Gogia Rates", "IND - FOH&Bar Gogia Rates"). Ignore them.

### Sites today (15)
Ayodhya, Rcube Noida, Mumbai, Tulsi Indore (opens 15-Nov-2026), Bangalore, Pavitra (Vadodara) (opens 30-Oct-2026), Mohali, Agra, Ashok Vihar, Ahmedabad, Cuttack, ZOCA Raipur, Gurugram, Indirapuram, Tulsi Hissar. Max 30 in the sheet; no hard limit on the website.

### Reference numbers from the sheet (for sanity checks after the first import)
Read from the live sheet on 30 Oct 2026; they will drift if the sheet is edited, so compare against the sheet at the same moment.

- Grand total ₹14,314,647. Largest category: Furniture ₹4,320,638. Largest site: Bangalore ₹2,598,239.
- Site totals: Ayodhya 2,470,886 · Rcube Noida 1,858,986 · Mumbai 1,552,319 · Tulsi Indore 1,960,726 · Bangalore 2,598,239 · Pavitra 431,600 · Mohali 93,551 · Agra 195,136 · Ashok Vihar 517,688 · Ahmedabad 778,100 · Cuttack 178,500 · ZOCA Raipur 982,080 · Gurugram 95,020 · Indirapuram 601,814 · Tulsi Hissar 0.
- Rcube Noida: 331 items with qty, 19 with missing rates, 0 ordered.

---

## 9. Open questions that need a human (flag them, do not guess)

For the sheet owner (Abhishek):
1. How exactly does the sheet decide **Ordered vs Not ordered** (stage value? PO link present?)
2. Formula behind **Pending Amount**.
3. The thresholds behind the **Urgent** and **This month** labels.
4. Which values `Stage` can take (to make it a dropdown later).
5. Whether Apps Script can read the in-cell images.

For the founder: real PO number format; company GSTIN, address and signatory for the PO header; vendor GSTIN/addresses.

For the build: values for `DATABASE_URL`, `IMPORT_SECRET`, photo storage.

---

## 10. Build order and acceptance checks

**M0 — Clean slate.** Delete `docs/`; replace sidebar with the 4 items; remove old module pages/APIs/models; separate DB + fresh baseline migration; login still works; `/site-boq` loads an empty shell. *Check:* build passes, no references to removed modules, sidebar behaves as specified.

**M1 — Schema + seed + settings.** Tables from section 3, seed 21 categories and `app_settings` (`mode = SHEET_LIVE`). *Check:* migrations run on a clean DB.

**M2 — Import API.** Endpoints from section 7 with secret check, mode gating, chunking, warnings, `import_runs`. Include a small fixture JSON and a script to push it. *Check:* pushing the fixture twice gives identical data (idempotent); a wrong secret gives 401; mode `WEBSITE_LIVE` gives 403.

**M3 — Read-only screens.** Overview, Site view, Items & Qty (read-only), Vendors, Sites, Settings (read-only parts). *Check:* after importing real data, totals match section 8 numbers.

**M4 — Photos.** Spike on reading in-cell images from Apps Script with the sheet owner; photo endpoint, storage, thumbnails in tables; Admin upload in UI. *Check:* items show photos; re-push does not duplicate.

**M5 — Edit mode.** Roles from section 5, edits for qty/tracking/rates/vendors/items, audit log, mode switch with confirmation. Site lock: Admin-only lock/unlock UI with a confirmation dialog on unlock, lock badge on Overview/Site view/Items & Qty/Sites, server-side rejection of qty/remark_size/rate_override/tracking edits on a locked site for every role (Admin included), snapshot of `locked_rate` on lock and clearing it on unlock, audit log entry on unlock. *Check:* server rejects every write in `SHEET_LIVE`; after switching, the right roles can edit and the import returns 403; locking a site freezes its amounts even after its items' rates change; editing a locked site's qty/rate/tracking fields is rejected for every role, including Admin, until it is unlocked; unlocking requires confirmation and writes an audit log entry.

**M6 — Purchase Orders.** Create, preview, PDF, list. *Check:* PO for Cuttack + Furniture + one vendor sums correctly with 18% GST; PDF has header, photos, terms, signatory line.

**M7 — Polish.** Empty states, loading states, error pages, Indian formatting everywhere, the "No rate" highlighting, responsive check, README for env vars and the push flow.

Throughout: after every milestone, run lint/typecheck/build and report what a human must do next (secrets, Abhishek's script, decisions).

---

## 11. Dashboard ("Site Drawing Updates" sheet sync)

A separate module, own plan document: **`dashboard-sheet-sync-plan.md`**. Read that file for the full spec — sites, stages, steps, percentages, screens, build order (A-F), acceptance checks.

Quick orientation (detail lives in the other file, not duplicated here):
- Separate Google Sheet ("Site Drawing Updates" copy, own Apps Script project, own `WebsiteSync.gs`) from this file's Site BOQ ("TULSI Rate Sheet"). Fully read-only — no `SHEET_LIVE`/`WEBSITE_LIVE` mode, no edit path.
- Own Prisma models (`DashboardSite`, `DashboardStep`, `DashboardDeptLink`, `DashboardSiteAssignment`, `DashboardSyncRun`, `DashboardSyncStagingChunk`) — deliberately not sharing Site BOQ's `Site`/`ImportRun`/`BoqSyncStagingChunk` tables, so a bug in one sync can't touch the other's rows.
- Sync mechanics mirror section 7/the `docs/sheet-sync/` sheet-sync pattern (poll model: Apps Script polls `/api/dashboard-sync/pending` every ~1 min, never the other way — no web-app deployment needed), under its own `/api/dashboard-sync/*` routes, `src/lib/dashboard-sync/`, and `DASHBOARD_SYNC_SECRET`/`DASHBOARD_SYNC_ALERT_EMAIL` env vars, kept separate from Site BOQ's `SHEET_SYNC_SECRET`.
- Percentage rules live in `src/lib/dashboard-calc.ts` (pure, unit-tested in `dashboard-calc.test.ts`) — the one place "per stage = Completed / (leaf rows - Not required)" is implemented, reused by both the sync's sheet-vs-computed mismatch check and the eventual Dashboard UI.

---

## Progress log

### 2026-10-30 — M0 — Clean slate

**Verified:**
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run build` all pass clean.
- `pnpm run test` passes (no test files — every old `*.test.ts` was removed along with the module it covered; `vitest.config.ts` now sets `passWithNoTests` so this isn't a false green).
- Real Playwright pass against `pnpm dev` (`scripts/ci-smoke.ts`, also wired into CI's `e2e` job): anonymous request to `/site-boq` redirects to `/login`; admin login lands on `/site-boq` with the Site BOQ shell rendered; a FRANCHISEE test user hitting `/site-boq` gets a real 403; sidebar renders exactly the 4 specified items with "Coming soon" styling on the 3 disabled ones.
- Production build's route list matches the M0 scope exactly: `/`, `/login`, `/forgot-password`, `/reset-password/[token]`, `/site-boq`, `/users`, `/users/new`, `/users/[id]/edit`, `/api/auth/clear-session`.
- Fresh baseline migration (`20261030070747_init`) applied cleanly to a brand-new, separate database — `User`/`Session`/`PasswordResetToken`/`AuditEvent` only, `Role` enum trimmed to roles with no tie to a removed module.

**Still pending / needs a human:**
- DB location: the native Postgres role (`fraterniti`, port 5432) has no `CREATEDB`, so the new `fraterniti_one_boq` + shadow DB were created on the docker-compose Postgres (port 5433) instead, using the superuser already in `.env`. Running this branch locally now requires `docker compose up -d` / Docker Desktop running. Flag if you'd rather this live on native Postgres under a different role, or elsewhere entirely.
- `/users` (admin user management) has no sidebar entry per the literal "exactly 4 items" spec — reachable only by direct URL as of M0 (now addressed via the account menu, see the 2026-10-30 cleanup entry below).
- Real values still needed from you: `IMPORT_SECRET` (M2), B2/photo-storage credentials if different from what's already in `.env` (M4), real PO number format, company GSTIN/address/signatory, vendor GSTIN/addresses (M6).
- Sheet-owner answers still open (section 9): Ordered/Not-ordered rule, Pending Amount formula, Urgent/This-month thresholds, Stage's allowed values, whether Apps Script can read in-cell images.

### 2026-10-30 — Post-M0 cleanup

**Verified:**
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run build` all pass clean after the changes below.
- Real Playwright pass against `pnpm dev`: admin opens the new account menu, clicks "Manage users", lands on `/users`; reopens the menu and "Sign out" correctly ends the session and lands on `/login`. The admin-only conditional around "Manage users" is a plain `role === "ADMIN"` check (same pattern already covering the FRANCHISEE sidebar filter) — not separately re-tested per role.
- Mid-session, `DATABASE_URL` was briefly pointed at `localhost:5432/fraterniti_one_boq` (native Postgres) by hand — that database doesn't exist there and the `fraterniti` role still has no `CREATEDB` on that server, so `prisma migrate deploy` failed with "permission denied to create database". Reverted to port 5433 (the docker-compose Postgres set up in the M0 entry above) and the build went green again. Native-5432 is not an option without either creating the DB there first or granting `fraterniti` `CREATEDB` — see the M0 entry's DB-location note, still unresolved.

**What changed:**
- CLAUDE.md's verification-standard section: every `docs/plan/NN-*.md` reference replaced with `plan.md`; the "log what was verified" convention now points at this Progress log instead of the (deleted) `docs/plan/` folder.
- `/users` is reachable for Admins only via a "Manage users" item in a new account dropdown menu (desktop sidebar footer and mobile header, where sign-out already lived) — not the 4-item sidebar. Added `DropdownMenuLinkItem` to `src/components/ui/dropdown-menu.tsx` (wraps Base UI's `Menu.LinkItem`) since the existing `dropdown-menu.tsx` had no nav-item variant yet.

**Still pending / needs a human:** same open items as the M0 entry above (DB location, env values, sheet-owner answers) — nothing in this cleanup pass resolved any of those.

### 2026-10-30 — M1 + M2 — Schema, seed, import API

**Verified:**
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run test` (no DB-dependent vitest suite — see below) and `pnpm run build` all pass clean.
- Two migrations (`20261030091709_boq_schema`, `20261030100000_item_photo_unique_slot`) applied cleanly to both the existing dev DB and a throwaway clean DB (`fraterniti_one_boq_cleancheck`, dropped after) — M1's own acceptance check.
- `pnpm run db:seed` seeds 21 categories and all 13 `app_settings` keys (`mode = SHEET_LIVE`, defaults from section 3/6.6); re-running the seed never overwrites a row that already exists (so it's safe to run against a DB an Admin has already edited settings on).
- `scripts/fixtures/boq-import-fixture.json` (3 sites, 3 categories, 10 items — one duplicate pair "Japanese Cocktail Glass", one explicit-zero rate on "Ladle Steel", one item pushed with no `itemKey`) pushed end-to-end via `scripts/push-boq-fixture.ts` against a live `pnpm dev`: begin → chunk(sites) → chunk(vendors) → chunk(category)×3 → finish. Produced exactly the two expected warnings (missing-itemKey fallback, duplicate name) and no others.
- Pushed the same fixture a second time; diffed a full DB snapshot (sites, categories, vendors, items, vendorRates, siteItems, categoryVendors) ignoring `createdAt`/`updatedAt`/`lastSeenRunId` — byte-identical. Confirms idempotent upsert by `siteKey`/`itemKey`.
- Extended `scripts/ci-smoke.ts` (wired into CI's `e2e` job, which has a real Postgres service) with the M2 acceptance checks: wrong/missing bearer secret → 401 (checked before the mode check, so an unauthenticated caller can't learn the current mode); `mode = WEBSITE_LIVE` → 403 on `/api/import/boq/begin` (mode restored to `SHEET_LIVE` in a `finally` either way); re-pushing one site twice gives an identical row; a chunk whose second entry collides on a unique site name fails and rolls back **both** its own first (otherwise-valid) write and leaves an earlier, already-committed chunk in the same run untouched. All 13 checks (5 from M0 + 8 new) pass against the live dev server. Added `IMPORT_SECRET` to the `e2e` job's env in `.github/workflows/ci.yml` so this runs in CI, not just locally.
- Confirmed the rate-normalization rule directly: "Ladle Steel" pushed with `rates: { "Gogia": 0 }` is stored as `VendorRate.rate = null`, never `0`.
- Confirmed soft-deactivation directly (not in the user's 4 requested scenarios, but central to `finish`'s contract): pushed two sites in run 1, pushed only one of them in run 2, `finish` on run 2 correctly flipped the unseen site to `isActive = false` and left the seen one untouched.

**What was built (plan.md sections 3 and 7):**
- Full schema from section 3: `Site`, `Category`, `Vendor`, `CategoryVendor`, `Item`, `ItemPhoto`, `VendorRate`, `SiteItem`, `PurchaseOrder`, `PoLine`, `AppSetting`, `ImportRun` (PascalCase models/camelCase fields — the repo's existing Prisma convention, not section 3's snake_case prose names). `PurchaseOrder`/`PoLine` are schema-only until M6.
- `app_settings` modeled as a genuine key/value table (`AppSetting { key, value: Json }`) per section 3's own "(key/value)" label, not a fixed-column table — `src/lib/app-settings.ts` is the single place that knows the key names, types and defaults (money/identity fields like `companyGstin` default to `""`, intentionally not guessed — see section 9).
- `src/lib/boq-categories.ts` seeds the 21 categories from section 8. **One guess, self-correcting:** section 8 doesn't state a `group` for the 5 "added later" categories (Equipments, Gas, Ducting, Tiles, AC) — seeded as `INTERIOR` (closest to Furniture/Lighting) as a placeholder. Every real category chunk carries its own `group` and overwrites this on first import, so it's low-risk, but flagging it since it was a guess, not a fact from the plan.
- Import API (`src/lib/import/`, routes under `src/app/api/import/boq/`): `begin`/`chunk` (sites, vendors, category)/`photo`/`finish`, bearer-secret + mode gating via a shared `withImportGuard`, one DB transaction per chunk (and per `finish`) so a mid-chunk failure can't leave partial writes. Vendor contact fields are never touched on upsert; `SiteItem.rateOverride` is never written by import. Warnings implemented: duplicate item name within a category, item with no `itemKey` (falls back to `category::name::occurrence`), vendor name matching `confirm`/`quote`/a `(Q-###`/date-like pattern, reference to an unknown `siteKey` or `category`, same item name appearing in more than one category.
- `finish` soft-deactivates `Site`/`Item` rows not seen in the run (tracked via a `lastSeenRunId` column, never touching rows with `lastSeenRunId = null` — i.e. anything not created by import, which protects future manually-created rows once M5 lands). `dryRun` (accepted at `begin`) only skips this deactivation step — see the code comment on `finishImportRun` for why a true "commit nothing until confirmed" dry run isn't achievable across separate chunked HTTP requests, and section 7 doesn't actually specify chunk/finish behavior under `dryRun` beyond the one field on `begin`.
- Photo endpoint is implemented (`uploadImportPhoto`, idempotent by `itemKey + index` via a new `@@unique([itemId, sortOrder])` on `ItemPhoto`) but **not exercised** — B2 credentials in `.env` are still blank (section 9 already flags this), so it can't be tested until those are provided. `buildItemPhotoKey` added to `src/lib/storage.ts` alongside the existing key-builder helpers.
- No vitest (`pnpm run test`) coverage was added for the import API on purpose: CI's `verify` job (which runs `pnpm run test`) has no Postgres service, only the `e2e` job does, so a DB-dependent vitest suite would be permanently red in `verify`. All four of the user's requested test scenarios instead live in `scripts/ci-smoke.ts`, which already runs against a real Postgres in CI's `e2e` job.

**Still pending / needs a human:**
- Same DB-location note as M0 (native Postgres role has no `CREATEDB`; this branch's DB lives on the docker-compose Postgres, port 5433 — `docker compose up -d` required locally).
- B2/photo-storage credentials (`B2_ENDPOINT`, `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME` in `.env`) — needed to actually exercise the photo endpoint; it's implemented but untested without them.
- The `group` guess for Equipments/Gas/Ducting/Tiles/AC above — confirm or correct if it matters before M3's category-grouped screens ship.
- Sheet-owner answers (section 9) still open: Ordered/Not-ordered rule, Pending Amount formula, Urgent/This-month thresholds, Stage's allowed values, whether Apps Script can read in-cell images (the last one directly affects whether M4's photo flow even needs the endpoint built here).

### 2026-10-30 — Category group fix + Site lock (schema/import only) + M3 — Read-only screens

**Verified:**
- `pnpm run typecheck`, `pnpm run lint` and `pnpm run test` all pass clean (lint's one warning is pre-existing in `src/lib/email-domain.ts`, unrelated to this session). `pnpm run build` passes clean and lists all 6 new routes (`/site-boq`, `/site-boq/site-view`, `/site-boq/items`, `/site-boq/vendors`, `/site-boq/sites`, `/site-boq/settings`) as server-rendered.
- New migration `20261030103541_site_lock_fields` applied cleanly to the dev DB (and exercised by `prisma migrate deploy` during the build above).
- A real Playwright pass against `pnpm dev` (`scripts/tmp-e2e-m3-site-boq.ts` — the first `scripts/tmp-e2e-*.ts` file on this branch, kept per CLAUDE.md's convention, run with `npx tsx scripts/tmp-e2e-m3-site-boq.ts`) against `scripts/fixtures/boq-import-fixture.json`, hand-computed to a grand total of ₹4,30,800 (Site A ₹1,90,600, Site B ₹1,88,180, Site C ₹52,020; highest category Furniture ₹4,08,000; "Ladle Steel" correctly shows "No rate" from its explicit-zero rate). All 25 checks passed: Overview's totals/insight cards match those hand-computed numbers exactly; Site view's banner counts, opening-reminder table and "what's pending" list render correctly for the selected site; Items & Qty shows the right vendor-rate columns and the "No rate" highlight; Vendors/Sites/Settings render their respective data; every one of the 6 new `/site-boq/*` routes still 403s a FRANCHISEE user via the existing shared `forbidden.tsx` (confirming a segment-level `forbidden.tsx` covers newly-added nested routes without needing its own copy per route).
- A separate one-off script (not kept — backend-logic check, not a UI screen) verified the Site lock import protection directly: locked `Site` A, set a distinctive `qty`/`lockedRate` on one of its `SiteItem` rows, then re-pushed the fixture (which sends a different `qty` for that row). Confirmed: the import emits a warning naming the locked site instead of silently skipping it, `Site.isLocked`/`lockedById` are untouched by the push, and the locked `SiteItem`'s `qty`/`lockedRate` are **not** overwritten. Site A was then unlocked and the fixture re-pushed once more to leave the dev DB back in its normal (unlocked) state.
- Found and fixed a side effect of that same verification: the dev DB's `Site` rows had all gone `isActive = false` — a leftover from earlier M2 sessions' `ci-smoke.ts` runs, each of which starts its own fresh import run and (correctly, per `finish`'s own contract) soft-deactivates any site not touched by that run, including the fixture's sites. Re-pushed `scripts/fixtures/boq-import-fixture.json` via `scripts/push-boq-fixture.ts` to make it the latest run again. Not a bug in the import logic — a fixture freshness note for whoever runs `ci-smoke.ts` and the fixture push in the same dev DB: re-push the fixture last if you need it active for manual testing afterward.

**What changed:**
- **Category group fix** (plan.md section 8): "Equipments", "Gas", "Ducting", "Tiles", "AC" changed from the M1/M2 session's `INTERIOR` placeholder guess to `OPERATING`, per explicit instruction this session. Fixed in three places: `src/lib/boq-categories.ts` (the seed source), a direct `UPDATE` on the 5 already-seeded `Category` rows in the dev DB (seeding alone wouldn't have touched them — `prisma/seed.ts`'s `seedCategories()` intentionally never overwrites an existing row), and plan.md section 8's "Added later" line now says `(group: operating)` explicitly so this isn't an open guess for the next session.
- **Site lock — schema and import protection only** (plan.md sections 3, 5, and milestone M5; UI and enforcement are explicitly deferred to M5, per this session's instruction): `Site.isLocked`/`lockedAt`/`lockedById`(+`lockedBy` relation to `User`) and `SiteItem.lockedRate` added via migration `20261030103541_site_lock_fields`. `src/lib/import/boq-import.ts`'s `runCategoryChunk` now skips a locked site's `SiteItem` upsert entirely (qty/tracking fields) and emits one warning per locked site per chunk, rather than overwriting it; `runSitesChunk`'s site upsert already never mentioned the lock fields, so it needed no code change, just a comment recording the invariant. Documented in plan.md: a new "Site lock" subsection under section 3 (the rules), a new table row + paragraph in section 5 (Admin-only, overrides the mode-based permission table), and an expanded M5 bullet/check in section 10.
- **M3 — Read-only screens** (plan.md section 4 and milestone M3): built all 6 screens — Overview (`/site-boq`), Site view (`/site-boq/site-view`), Items & Qty (`/site-boq/items`), Vendors (`/site-boq/vendors`), Sites (`/site-boq/sites`), Settings read-only parts (`/site-boq/settings`) — against `scripts/fixtures/boq-import-fixture.json` (the real sheet push isn't ready yet; see "still pending" below). Shared plumbing added rather than duplicated per page: `src/lib/boq-calc.ts` (pure `finalRateOf`/`rateForAmount`/`amountOf`/`isOrdered`/`pendingAmount` functions — the single place the rate/amount/lock/ordered rules from sections 3 and 6.2 live), `src/lib/boq-data.ts` (`getComputedItems()` — one query that every screen derives its numbers from, so a rule can't drift between pages), `src/lib/site-boq-access.ts` (`requireSiteBoqUser()`, replacing the inline `requireUser()` + FRANCHISEE check that was only in `page.tsx` before — now shared across all 6 pages), `src/lib/permissions.ts`'s new `canViewSiteBoq()`, and `formatCurrency`/`formatNumber` added to `src/lib/format.ts` (en-IN, 0 decimals on dashboards / 2 on item tables per section 6.4 — this repo's first currency formatter). Three small reusable pieces under `src/app/(app)/site-boq/_components/`: `SiteBoqSubNav` (real links, replacing the M0 placeholder tab strip), `QuerySelect` (a plain native `<select>` that navigates via a query param — used for the site/category pickers), `SearchBox` (a zero-JS GET-form search input that preserves other query params). Overview's site-vs-category matrix table has sticky headers (`sticky top-0`/`sticky left-0`) and a search box filtering sites by name; Items & Qty and Vendors also got search boxes. The "Items & Qty" per-row tracking-field drawer and "Sites" add/rename UI from sections 4.3/4.6 were intentionally **not** built — both are edit-mode UI, explicitly milestone M5, not M3's "read-only screens."
- Order-tracking "pending" (section 3: `po_amount − advance_given`) implemented as the isolated `pendingAmount()` function per the same pattern section 6.2 already asked for `isOrdered()`, since it's equally unverified with the sheet owner (section 9).

**Still pending / needs a human:**
- Real sheet data: everything above was verified against the fixture (3 sites, 3 categories, 10 items), not the real sheet — section 8's actual reference numbers (grand total ₹1,43,14,647 etc.) can only be checked once the real Apps Script push (section 7) is live and `IMPORT_SECRET` is wired to it. The fixture numbers above are a correctness check on the calculation code, not a substitute for that real-data check plan.md's own M3 acceptance line asks for.
- Site lock's **UI and enforcement** (lock/unlock button + confirmation dialog, lock badge on every screen, server-side rejection of edits to a locked site, audit log entry on unlock) — all explicitly deferred to M5, as instructed. Only the schema fields and the import's "never overwrite, warn and skip instead" protection exist right now; there is no way to lock a site from the UI yet (the verification above set `isLocked` directly in the DB to simulate it).
- Same open items as every prior entry: DB location (docker-compose Postgres, port 5433), B2/photo-storage credentials, sheet-owner answers (section 9), real PO number format/company details (M6).
- `scripts/tmp-e2e-m3-site-boq.ts` depends on the fixture's 3 sites being the *latest* import run in whichever DB it's run against (see the "found and fixed" note above) — if `ci-smoke.ts` or another import test has run more recently against the same DB, re-run `npx tsx scripts/push-boq-fixture.ts` first.
- Real values still needed: PO number format, company GSTIN/address/signatory, vendor GSTIN/addresses (M6) — nothing in M1/M2 depended on these, so still open, not newly blocking.

### 2026-10-31 — M5 — Role/mode enforcement + edit mode UI (Purchase Orders and Site lock's own UI excluded)

**Verified:**
- `pnpm run typecheck`, `pnpm run lint` (same one pre-existing unrelated warning in `src/lib/email-domain.ts`), `pnpm run test` and `pnpm run build` all pass clean. `pnpm run build` lists the same 6 `/site-boq/*` routes as before, still server-rendered — no new routes, this milestone is all actions/UI on the existing ones.
- Two new unit-test files, `src/lib/permissions.test.ts` and `src/lib/site-boq-write-guard.test.ts` (10 tests total, all pass), covering the pure role-check functions against every row of plan.md section 5's table, and `isWriteAllowedInMode`/`isSiteItemEditableForLock` against section 1's mode table and the Site lock rule. Needed one infra change to make this possible: `permissions.ts` (pre-existing) and the new `site-boq-write-guard.ts` both start with `import "server-only"`, which throws under plain Node outside Next's bundler — added a `server-only` -> `src/test/server-only-shim.ts` alias in `vitest.config.ts` (a 2-line noop module) so these can be unit-tested directly, same trick Next's own bundler uses to strip that guard out of server bundles.
- A new Playwright script, `scripts/tmp-e2e-m5-site-boq-edit.ts` (run with `npx tsx scripts/tmp-e2e-m5-site-boq-edit.ts` against a running `pnpm dev`), 30/30 checks passing on three consecutive runs (confirmed non-flaky after fixing two real bugs it caught — see below): mode is read-only everywhere in `SHEET_LIVE` except vendor contact details and Settings; the mode-switch confirmation dialog's copy, and that confirming it actually flips the DB and the import endpoints start 403ing; every non-FRANCHISEE role can edit qty/remark/tracking once `WEBSITE_LIVE`, but item/vendor/site/settings management and the mode switch itself stay Admin-only (checked both for Admin and for a throwaway `SALES`-role user); a qty edit and a tracking-field edit both persist across a reload and both show up in the Settings audit log; a site with `isLocked = true` (set directly in the DB — there is still no lock/unlock UI, see "still pending") freezes its qty edits even for Admin in `WEBSITE_LIVE`. Re-ran `scripts/tmp-e2e-m3-site-boq.ts` afterward (25/25 checks) to confirm M3's read-only screens have no regressions from this milestone's changes to the same pages.
- Two real bugs the new e2e script caught and that got fixed before this was called done: (1) `TrackingDrawer` had no success-closes-the-dialog logic at all (the other 3 new dialogs did) — fixed by giving it the same outer/inner remount-on-reopen split described below. (2) The mode-switch check was racing `waitForLoadState("networkidle")` right after the click, which could resolve in a quiet gap before the mutation's own fetch had even landed — fixed by waiting for the confirmation dialog itself to close instead, which only happens once the action has actually resolved.

**What was built (the user's 5-point list this session, scoped to plan.md sections 1/4/5 as instructed — Purchase Orders (M6) and Site lock's own lock/unlock UI (left for its own M5 sub-scope, not asked for this round) are intentionally not part of this):**
1. **Server-side role enforcement** — `src/lib/permissions.ts` gained one function per row of section 5's table (`canEditSiteItemTracking`, `canEditItems`, `canEditVendors`, `canEditSites`, `canEditSettings`, `canFlipMode`, `canViewAuditLog`), each a pure `role` check reused by both the Server Actions and the pages that decide what to render.
2. **Server-side mode enforcement** — new `src/lib/site-boq-write-guard.ts`: `isWriteAllowedInMode(mode, area)` is the one place the section-1 exemption list (vendor contact details, settings; everything else needs `WEBSITE_LIVE`) lives, plus `isSiteItemEditableForLock(site)` for the Site-lock gate section 5 calls out as "a second, independent gate" on top of the role table — nobody, Admin included, edits qty/remark/rateOverride/tracking on a locked site. The import endpoints' own mode gate (`withImportGuard`, returns 403 in `WEBSITE_LIVE`) already existed from M2 and needed no change — re-verified by the new e2e script rather than rebuilt.
3. **Editing UI**, each wired through the two gates above plus its role check: `src/app/(app)/site-boq/items/actions.ts` (`updateSiteItemQty`/`updateSiteItemRemark` — two separate single-field actions, not one combined one, because an HTML `<table>` can't have one `<form>` spanning two `<td>`s; `updateSiteItemTracking` for the drawer's 9 fields; `createItem`/`updateItem` with per-category-vendor rate inputs and a final-vendor select, validated so a final vendor always has a rate) and matching UI (`qty-cell.tsx`/`remark-cell.tsx` — inline `<input>`s that auto-submit on blur, only when the value actually changed, so clicking in and out isn't a no-op audit event; `tracking-drawer.tsx`; `item-form-dialog.tsx`, with an "Add item" button gated to Admin + `WEBSITE_LIVE`). `src/app/(app)/site-boq/vendors/actions.ts` + `vendor-edit-dialog.tsx` (Admin, either mode). `src/app/(app)/site-boq/sites/actions.ts` + `site-form-dialog.tsx`/`site-active-toggle.tsx` (Admin, `WEBSITE_LIVE` only — section 1's "read-only everywhere" applies to sites, unlike vendors). All four add/edit dialogs (`item-form-dialog.tsx`, `site-form-dialog.tsx`, `vendor-edit-dialog.tsx`, and after the bugfix above, `tracking-drawer.tsx`) share one pattern: an outer component owns `open` state and a remount counter, an inner component (remounted via `key` on every open) owns the actual `useActionState` call and derives `open={open && !state?.success}` to auto-close on a successful save — this avoids a `setState`-in-`useEffect` (flagged by this repo's `react-hooks/set-state-in-effect` lint rule) and, unlike a plain `useEffect` close, never gets stuck unable to reopen by a stale `success` left over from a previous save.
4. **Mode switch** — `src/app/(app)/site-boq/settings/actions.ts`'s `setMode` (Admin only, deliberately has no mode-gate check on itself, since it's the switch that controls that gate) + `mode-switch.tsx`'s confirmation dialog, which states plainly what the import endpoints and editing will do on each side of the switch.
5. **Audit log** — reused the existing `AuditEvent` table/`writeAuditEvent` helper (already shared with User management) rather than a second table; every new action writes one event with the old/new values of whatever it touched. `getRecentBoqAuditEvents()` in `boq-data.ts` filters to the Site-BOQ-relevant `entityType`s so it doesn't mix in `User` audit noise, surfaced via `audit-log-table.tsx` (Admin-only, Settings page, raw before/after JSON tucked into a native `<details>` per row — "simple viewer" as asked, no new interactive framework).
- One schema-adjacent fix made along the way, not a new field: `boq-data.ts`'s `ComputedItem`/`ComputedSiteEntry` types were missing `note`, `approvedVia`, `link`, `followUp` and `remarks` (present in the DB, just never surfaced before M3 had no edit UI to need them) — added, since the item-edit dialog and tracking drawer both needed real values, not blanks that would silently wipe existing data on first save.

**Scope decisions made this session, not spelled out verbatim in plan.md, with the reasoning:**
- `SiteItem.rateOverride` has no edit path yet. Section 4.3's own column list for Items & Qty doesn't include it, and section 3 calls the per-site override something to "support later," not now — left schema-only, same as it already was.
- Vendor "management" was read as editing the contact fields section 4.4 names (name, address, GSTIN, phone, email, note); adding brand-new vendors or changing which categories one serves wasn't asked for and isn't mentioned as UI in section 4.4, so it's still importonly.
- Sites are read-only in `SHEET_LIVE` in full (name, short code, opening date, *and* note/hide) — section 4.6 only calls out name/opening-date by name, but section 1's "read-only everywhere" is the broader, stated rule and sites aren't on the short exemption list the way vendors/settings are.

**Still pending / needs a human:**
- Site lock's own lock/unlock UI (button, confirmation dialog, lock badge beyond the plain one already on the Sites list, audit entry on unlock) — not part of this session's 5-point ask, still simulated by setting `isLocked` directly in the DB for testing, same as the M3 session.
- Purchase Orders (M6) — untouched.
- Same open items as every prior entry: DB location (docker-compose Postgres, port 5433; Docker Desktop has to be running locally — it was not at the start of this session and had to be started to run the build/e2e pass), B2/photo-storage credentials, sheet-owner answers (section 9), real PO number format/company details, real sheet data for the section-8 reference numbers.

### 2026-10-31 — M5 follow-up — Site lock UI, frozen amounts, per-site rate override

**Verified:**
- `pnpm run typecheck`, `pnpm run lint` (same one pre-existing unrelated warning in `src/lib/email-domain.ts`), `pnpm run test` (15/15 — 5 new tests in `src/lib/boq-calc.test.ts` plus the 10 from the previous M5 session) and `pnpm run build` all pass clean. No schema migration was needed — `Site.isLocked/lockedAt/lockedById` and `SiteItem.lockedRate/rateOverride` were already added to the schema in the earlier "Category group fix + Site lock (schema/import only) + M3" session; this session only builds the UI and actions on top of fields that already existed.
- A new Playwright script, `scripts/tmp-e2e-m5-site-lock.ts` (`npx tsx scripts/tmp-e2e-m5-site-lock.ts` against a running `pnpm dev`), 34/34 checks passing on two consecutive runs: locking a site from the Sites page through the real confirmation dialog (copy checked for the exact "frozen" / "will not change this site's amounts" wording asked for); the lock badge appearing on Overview, Site view and Items & Qty (plus the pre-existing one on Sites); qty/remark cells becoming read-only with a `title="Site is locked"` tooltip; the tracking drawer's fields and the new rate-override field both disabling with the same tooltip and hiding their Save buttons; changing the item's catalog rate while the site is locked leaving the locked site's Amount cell byte-identical while an unlocked site's Amount cell picks up the new rate; setting a per-site rate override on an unlocked site showing an "Overridden"/"Override" marker in both the drawer and the main table and changing the amount; unlocking from the Site view page through its own (differently-worded) confirmation dialog, after which qty/remark/the rate override all become editable again and the amount resumes following the live rate; both the lock and unlock audit events showing up in Settings with the site's name; and locking/unlocking working in `SHEET_LIVE` too, not just `WEBSITE_LIVE` (plan.md section 3: "Locking/unlocking is allowed in SHEET_LIVE mode"). Re-ran `scripts/tmp-e2e-m5-site-boq-edit.ts` (30/30) and `scripts/tmp-e2e-m3-site-boq.ts` (25/25) afterward — both needed one one-line fix each (see "bugs" below) and then passed clean, confirming no regression to the role/mode edit UI or the read-only screens.
- One real bug the new script caught, in the test harness rather than the app: adding a second `<form>` (the rate-override form) inside the tracking drawer meant `scripts/tmp-e2e-m5-site-boq-edit.ts`'s existing `trackingDialog.getByRole("button", { name: "Save" })` became ambiguous (two "Save" buttons now exist in that dialog) and started throwing a Playwright strict-mode error. Fixed by scoping both scripts' override-vs-tracking Save clicks to `.locator("form").first()` / `.last()` (the override form renders before the tracking form in the drawer's markup) rather than changing either button's label — "Save" is the right label for both, this was a test-selector ambiguity, not a UI defect.
- DB left clean after the final run, checked directly: `mode` back to `SHEET_LIVE`, no `Site` rows with `isLocked = true`, no `SiteItem` rows with a non-null `rateOverride` or `lockedRate`, and "GN Pan 1x2x6 with Lid"'s Gogia rate back to its fixture value (₹605) after the cleanup re-push.

**What was built (the user's 6-point list this session, scoped to plan.md sections 3, 4.3 and 5 as instructed):**
1. **Lock/unlock UI** — `src/app/(app)/site-boq/_components/site-lock-button.tsx`, the same outer/inner remount-on-reopen pattern as every other M5 dialog (so a stale `state.success` from locking can't leave the dialog stuck closed the moment "Unlock" is clicked next). One shared component, used from both the Sites page (`sites/page.tsx`) and Site view (`site-view/page.tsx`) per the user's "(and on Sites in Settings)" phrasing — gated purely on the new `canLockSite(user)` (Admin-only), independent of `editable`/mode, since locking isn't a mode-gated BOQ edit. The lock dialog's copy is the exact sentence asked for ("This site's quantities and rates will be frozen. Later changes to item rates will not change this site's amounts."); the unlock dialog has its own, differently-worded confirmation.
2. **Lock/unlock Server Actions** — `lockSite`/`unlockSite` added to `src/app/(app)/site-boq/sites/actions.ts`. Both are Admin-only (`canLockSite`) and deliberately **not** gated by `checkModeAllowsWrite` at all — plan.md section 3 says locking is allowed in either mode, and it isn't a BOQ data edit. `lockSite` loops the site's `SiteItem` rows in one transaction, computing each one's pre-freeze effective rate via the same `rateForAmount`/`finalRateOf` functions every screen already reads amounts through (called with `isLocked: false` — "what the rate is right now, before freezing it") and writing it to `lockedRate`, then flips `Site.isLocked/lockedAt/lockedById` and writes one audit event naming the site. `unlockSite` clears every `lockedRate` on that site back to `null` (`updateMany`, since unlock doesn't need a per-row computed value) and flips the lock fields back, writing its own audit event.
3. **One shared effective-rate function, used everywhere** — this was already true going into this session: `rateForAmount()` (in `src/lib/boq-calc.ts`, built in the earlier Site-lock-schema session) is the single place `locked > rate_override > final_rate` precedence lives, and `getComputedItems()` in `boq-data.ts` — the one query every read screen (Overview, Site view, Items & Qty) derives its numbers from — was already calling it. Grepped the rest of `src/` to confirm there's no second, duplicate amount calculation anywhere (there isn't; M6's PO line builder doesn't exist yet). What this session added: `lockSite`'s own snapshot calculation (above) now also goes through `rateForAmount`/`finalRateOf` rather than re-deriving the rate inline, and a new `src/lib/boq-calc.test.ts` — the "change an item's rate after a site is locked" unit test the user asked for, plus four direct precedence tests for `rateForAmount` itself.
4. **Lock badge everywhere + read-only with a tooltip** — a shared `SiteLockBadge` component (`_components/site-lock-badge.tsx`) replaces the inline "Locked" `<Badge>` that already existed on the Sites page and is now also rendered on Overview (next to each site name in the matrix), Site view (next to the "By category"/"What's pending" headings and in the opening-reminder table's site column) and Items & Qty (next to the site selector). `QtyCell`/`RemarkCell` and the tracking drawer's fields (including the new rate-override field) already rendered read-only when a site is locked — from the earlier M5 session's `siteItemEditable` check — but had no visual explanation why; this session added a `locked` prop threaded through to a plain `title="Site is locked"` attribute on the read-only `<span>`s and disabled inputs. No new Tooltip component was introduced — the browser's native title tooltip was enough and keeps this on the "don't add an abstraction for one case" side of things.
5. **Per-site rate override** — `updateSiteItemRateOverride` (new action in `items/actions.ts`) and a new `canEditRateOverride` permission (Admin-only, kept as its own function from `canEditItems` since it's a `SiteItem` field, not an `Item` field, even though the actor is the same). `guardSiteItemEdit` was generalized into `guardSiteWrite(siteId, hasPermission)` so this action and the existing qty/remark/tracking actions can all share the same mode+lock plumbing while each supplying its own permission check. The tracking drawer gained a second, independent `<form>` above the tracking fields: an input defaulting to the current override (or blank), an "Overridden" badge when one is set, and its own Save button — visible/enabled only when `canEditRateOverride(user) && mode === "WEBSITE_LIVE" && !site.isLocked`. The main Items & Qty table also shows a small "Override" badge next to the Amount cell when a row has one, so it's visible without opening the drawer.
6. **Playwright coverage** — `scripts/tmp-e2e-m5-site-lock.ts`, described under "Verified" above.

**Scope decisions made this session, not spelled out verbatim in plan.md, with the reasoning:**
- The unlock confirmation dialog's exact wording wasn't given in the user's instruction (only the lock one was quoted verbatim) — wrote "This site's quantities, remarks and tracking fields become editable again, and its amounts will follow item rate changes once more," matching the lock copy's level of plainness.
- `rateOverrideEditable` is gated the same way as `siteItemEditable` (mode + lock) but with `canEditRateOverride` instead of `canEditSiteItemTracking` — Admin-only, unlike qty/remark/tracking which every internal role can edit. This follows section 5's existing row for "items, vendor rates, final vendor" being Admin-only, even though a per-site override is technically a `SiteItem` field rather than an `Item` field.
- No migration was written this session because every field the lock/override UI needed (`Site.isLocked/lockedAt/lockedById`, `SiteItem.lockedRate/rateOverride`) already existed in the schema from the earlier session that built the import-side lock protection.

**Still pending / needs a human:**
- Purchase Orders (M6) — untouched; once built, its line builder must read amounts through `rateForAmount`/`getComputedItems()` like every other screen, not re-derive the rate.
- Same open items as every prior entry: DB location (docker-compose Postgres, port 5433; Docker Desktop must be running locally), B2/photo-storage credentials, sheet-owner answers (section 9), real PO number format/company details, real sheet data for the section-8 reference numbers.

### 2026-10-31 — M6 — Purchase Orders

**Verified:**
- `pnpm run typecheck`, `pnpm run lint` (same one pre-existing unrelated warning in `src/lib/email-domain.ts`), `pnpm run test` (36/36 — 20 new tests across `src/lib/po-calc.test.ts`, `src/lib/po-number.test.ts`, `src/lib/po-pdf.test.ts` and one added case in `src/lib/permissions.test.ts`, plus the 16 from before) and `pnpm run build` all pass clean. No migration was needed — `PurchaseOrder`/`PoLine` were already modeled in the schema from the M1 session; this session only adds the `poNumberPrefix` app-setting key (seeded automatically, like every other key, by the existing `seedAppSettings()` loop) and builds the screens/actions/PDF on top.
- A new Playwright script, `scripts/tmp-e2e-m6-purchase-orders.ts` (`npx tsx scripts/tmp-e2e-m6-purchase-orders.ts` against a running `pnpm dev`), 21/21 checks passing on two consecutive runs: the create/preview page correctly filters Kitchen Smallware's items at Fixture Site A to qty > 0 lines whose final vendor is Gogia (3 lines: GN Pan, Ladle Steel, Tongs), shows a qty>0-but-missing-rate line ("Ladle Steel") as "No rate" rather than silently dropping it, and sums to the right subtotal/GST(18%)/grand total (₹5,320 / ₹957.60 / ₹6,277.60); creating the PO(s) redirects to the list with a "Created 1 purchase order" banner and a "New" badge; the list's search finds the new PO by number and shows an empty state for no match; the detail page repeats the same missing-fields notice; and the PDF route responds 200 with `Content-Type: application/pdf` and real `%PDF-` bytes. The same run also locks Fixture Site A (snapshotting `lockedRate` on its `SiteItem`s, mirroring what `lockSite` does) and then changes GN Pan's live Gogia rate from 605 to 900 before building the PO — the preview, the created PO's stored line, and the detail page all show the frozen 605/₹4,840, proving the PO line builder goes through the same locked-site rule as every other screen, not a live rate.
- `pnpm run test`'s new `po-pdf.test.ts` directly covers this session's other explicit ask — "if company/vendor details are empty, still generate the PDF and mark the missing fields clearly instead of failing" — with cases for every field blank, every field filled, zero lines, and 80 lines (forces pagination), asserting the output is always a well-formed PDF (`%PDF-` magic bytes) and that `collectMissingPoFields` lists exactly the blank ones.
- Re-ran `scripts/tmp-e2e-m5-site-lock.ts` (34/34), `scripts/tmp-e2e-m5-site-boq-edit.ts` (30/30) and `scripts/tmp-e2e-m3-site-boq.ts` (25/25) afterward with no fixes needed — no regression to Site lock, the role/mode edit UI, or the read-only screens from enabling the Purchase Orders sub-nav tab or the `boq-data.ts`/`site-boq-write-guard.ts` additions.
- DB left clean after the final run, checked directly: `mode` back to `SHEET_LIVE`, zero `PurchaseOrder` rows, zero locked sites, zero `SiteItem` rows with a `lockedRate` set, and GN Pan's Gogia rate back to ₹605.

**What was built (plan.md sections 4.5 and 6.6):**
1. **Create + preview** (`purchase-orders/new/page.tsx`) — one GET form (site, category, PO date, delivery days, GST %, payment terms, vendor checkboxes including an "All vendors" one) that re-renders the page with a live preview; a separate POST form (`CreatePoForm`, bound to the new `createPurchaseOrders` action) only submits the exact same selection as hidden fields, so changing a selector can never accidentally create a PO. "One or more vendors or all vendors" is implemented as **one PO per vendor that actually has qty > 0 lines** (the schema's `PurchaseOrder.vendorId` is a single vendor, not a list) — a vendor with none is silently skipped rather than producing an empty PO; this is spelled out in the action's own comment since the plan's wording ("vendor(s) or all vendors") doesn't say it outright.
2. **PO numbering** — `src/lib/po-number.ts`: `formatPoNumber`/`parseRunningNumber` are pure (unit-tested directly), and `nextPoRunningNumber(prefix, year)` derives the next running number from the highest existing `PurchaseOrder.poNumber` matching that prefix+year, rather than a separate counter row — numbers restart at 1 every year or whenever the prefix changes, with nothing extra to keep in sync. `createPurchaseOrders` retries the whole batch (recomputing the starting number) up to 5 times on a unique-constraint race, acceptable for this team's low write concurrency. `poNumberPrefix` (default `"FF-PO"`) is a new Settings field, editable alongside the other PO defaults — **the real prefix/format still needs founder confirmation (section 9), unchanged from every prior entry.**
3. **Shared effective-rate function, extended to POs** — `src/lib/po-calc.ts`'s `buildPoLineCandidates` reads `rate`/`amount` straight off each item's `ComputedSiteEntry` from `getComputedItems()` (the same locked-site-aware values every other screen uses) and never re-derives a rate itself; `src/lib/boq-calc.ts` was not touched. This was the specific thing flagged as "still pending" in the previous session's entry, and the e2e script's locked-site case above is the direct proof it holds.
4. **PDF** (`src/lib/po-pdf.ts`, using the existing `pdf-lib` dependency and the pre-existing `pdf-utils.ts` drawing helpers) — company header, PO number/date/delivery-by, vendor block, deliver-to site, one photo per line (`ItemPhoto` sortOrder 0, embedded via `pdf-lib`'s `embedJpg`/`embedPng`; webp/gif and any missing/misconfigured-storage photo are silently skipped rather than failing generation — B2 credentials are still one of the long-standing open items), amount columns with pagination, GST/grand total, the 4 terms, and a signature line. Regenerated fresh from the PO's own stored JSON snapshots on every download (`/api/site-boq/purchase-orders/[id]/pdf`), never from live Vendor/Site/Settings rows, so a re-download always matches what was true at creation time even if those have since changed.
5. **"Still generate, mark missing fields clearly"** — `collectMissingPoFields` (company name/address/GSTIN/phone/email/signatory + the chosen vendor's address/GSTIN/phone/email) is the single function both the PDF (renders `[Not set]` placeholders plus a red "Missing details" banner near the top) and the UI (a "Missing before sending: …" notice on both the preview and detail pages) use — so the two can't drift on what counts as missing. **What you must fill in before sending a real PO**, read straight off this fixture-only dev DB: Company name/address/GSTIN/phone/email, Signatory name (Settings → PO defaults) and every vendor's address/GSTIN/phone/email (Vendors page) — the sheet never had this data (plan.md section 7), so expect this list to be non-empty for every vendor until someone fills it in.
6. **List** (`purchase-orders/page.tsx`) — search by PO number/site name/vendor name (`getPurchaseOrders(q)`, a case-insensitive `OR` across the three), a "Create PO" button, and a "Download PDF" button per row; a `?created=id1,id2` query param (set by the redirect after creation) highlights the just-created row(s) with a "New" badge.
7. **Permissions/guards** — `canCreatePo` (Admin + every other internal role, not FRANCHISEE — same role set as `canViewSiteBoq`, kept as its own function per this file's one-function-per-plan-row convention) gates both creation and the PDF route. `"purchaseOrder"` was added to `site-boq-write-guard.ts`'s mode-exempt set (plan.md section 4.5: "Allowed in both modes") alongside `"vendor"`/`"settings"` — `createPurchaseOrders` still calls `checkModeAllowsWrite("purchaseOrder")` even though it's exempt, for the same reason `updateVendor`/`updateAppSettings` do: one place enforces the rule so it can't silently drift if the exemption list ever changes.
8. Enabled the "Purchase Orders" sub-nav tab (was a disabled "Coming soon" label since M0).

**Scope decisions made this session, not spelled out verbatim in plan.md, with the reasoning:**
- New POs are created directly as `status: "ISSUED"`, not `"DRAFT"` — plan.md section 4.5 describes "Create → Preview → Download PDF" as one flow with no separate "finalize a draft" step or screen, so a `DRAFT` state with no way to edit or issue it from the UI would be dead weight. `PurchaseOrderStatus.DRAFT` stays in the schema/enum in case a real draft-review workflow is wanted later.
- A PO with a missing-rate line (qty > 0, no final vendor rate) still gets a line in the PO at rate/amount 0, flagged "No rate" in the UI — matching `amountOf`'s existing "0 if rate is missing" rule rather than inventing a new one, and keeping the line visible (not silently dropped) so nobody ships a PO that's quietly short an item.
- The "All vendors" checkbox and the individual vendor checkboxes are not mutually exclusive via JS (this page stays a zero-JS GET form, consistent with `SearchBox`/`QuerySelect`'s existing convention) — checking "All vendors" simply overrides any individual selection server-side, with a one-line caption explaining this rather than adding client-side checkbox-linking logic for a rarely-hit edge case.

**Still pending / needs a human:**
- Same open items as every prior entry: DB location (docker-compose Postgres, port 5433; Docker Desktop must be running locally), B2/photo-storage credentials (also now the reason item photos won't appear on any real PO PDF yet), sheet-owner answers (section 9), real PO number format/company GSTIN/address/signatory, real vendor GSTIN/addresses, real sheet data for the section-8 reference numbers.

### 2026-11-02 — Bug fix — missing `nativeButton={false}` on anchor-rendered PO buttons

**Verified:**
- `pnpm run typecheck`, `pnpm run lint` (same one pre-existing unrelated warning in `src/lib/email-domain.ts`) and `pnpm run test` (48/48) all pass clean.
- Re-ran `scripts/tmp-e2e-m6-purchase-orders.ts` against the running `pnpm dev` — 21/21 checks still pass (no regression).
- A direct browser check (throwaway script, deleted after use — not one of the kept `tmp-e2e-*.ts` files since it only asserts on `console` events, nothing in the DB) logged in, loaded `/site-boq/purchase-orders`, and confirmed zero console messages mentioning `nativeButton` or containing "error" — the reported warning is gone.

**What was wrong and why:** Base UI's `Button` defaults `nativeButton` to `true`, which asserts the rendered element really is a `<button>`. Three `Button`s on the Purchase Orders list and detail pages used the `render` prop to swap in an `<a>`/`Link` (for "Create PO" and the two "Download PDF" buttons) without setting `nativeButton={false}`, so Base UI logged a console warning on every render. The repo already had the correct pattern elsewhere (`src/app/(app)/users/page.tsx`, with a comment explaining it) — these three call sites were just missed when Purchase Orders was built in the M6 session.

**Fix:** added `nativeButton={false}` to the three call sites in `src/app/(app)/site-boq/purchase-orders/page.tsx` (the "Create PO" button and the per-row "Download PDF" button) and `src/app/(app)/site-boq/purchase-orders/[id]/page.tsx` (the detail page's "Download PDF" button). No other `Button`+`render` call sites in the codebase were missing it (checked via grep across the repo).

### 2026-11-02 — Production-readiness pass for a separate `new-main` deployment (new Vercel project, new Neon DB, domain `fraterniti.one` later)

All work done on a new local branch `new-main` (branched from `new`), nothing pushed, nothing merged into `dev`/`main`, no old-app DB touched.

**Verified:**
- `pnpm run typecheck`, `pnpm run lint` (same one pre-existing unrelated warning in `src/lib/email-domain.ts`), `pnpm run test` (48/48) and `npx next build` all pass clean, both before and after every change below.
- **Empty-DB migration test, end to end**: started a brand-new throwaway Postgres container (`fo-prod-migration-test`, port 5434 — separate from the dev-DB container on 5433), ran `npm run db:migrate:prod` against it — all 5 migrations applied cleanly on a genuinely empty database. Ran `npm run seed:prod` against it (21 categories, 13 app_settings keys mode=SHEET_LIVE, 19 Site Tracker sections/177 steps/22 sites) and confirmed re-running it a second time is idempotent (same counts; the only change between runs is a pre-existing, unrelated seed-data quirk noted below). Ran `npm run create-admin` against it (piped input, driven with realistic typing delays since this harness's raw stdin piping has its own buffering quirks — see note below) — confirmed account creation, and separately confirmed the idempotent "reset an existing account's password" path, and independently verified the stored bcrypt hash with `bcrypt.compare`. Ran `next build && next start` pointed at this same DB — `/login` returned 200. Container removed afterward.
- **Boot-time secret validation** (`src/lib/env-validation.ts`, wired into `src/instrumentation.ts`'s `register()`): verified directly (unit-style, 4 cases) that it throws for a missing `SESSION_SECRET`/`IMPORT_SECRET` in production, throws for a known placeholder value, passes for real-looking values, and never runs outside `NODE_ENV=production`. Also verified end-to-end with a real `next start -p 3103` run with both secrets unset: Next logs `Failed to prepare server Error: ... SESSION_SECRET is not set ...` and the server never finishes preparing (every request fails) — confirmed `next build` itself is unaffected (register() isn't invoked at build time).
- Re-ran all 5 `scripts/tmp-e2e-*.ts` against the running local `pnpm dev` + dev DB: `tmp-e2e-m3-site-boq.ts` (26/26), `tmp-e2e-m5-site-boq-edit.ts` (31/31), `tmp-e2e-m5-site-lock.ts` (35/35), `tmp-e2e-m6-purchase-orders.ts` (21/21) all pass. `tmp-e2e-site-tracker.ts` has one pre-existing, deterministic (not flaky) failure — "Confirm enables once a file is uploaded" — unrelated to this session's changes (nothing here touched Site Tracker evidence/upload code): the check reads `confirmButton.isEnabled()` directly after a 300ms grace period and gets `false`, but the very next line clicks the button anyway and Playwright's built-in actionability auto-wait succeeds, and every downstream check in that same flow (step completes, evidence count, progress %, persistence) passes — so this is the test's own assertion margin being slightly too tight, not a product bug. Not fixed (out of scope for this session; flagging for whoever owns that script next).
- `ci-smoke.ts` was deliberately **not** run locally — its own header comment says it's for the CI throwaway-Postgres job only, never the real dev DB.

**What was built/changed:**
1. **`prisma/schema.prisma`** — added `directUrl = env("DIRECT_URL")` to the datasource block (Neon: pooled `DATABASE_URL` for the running app, direct `DIRECT_URL` for migrations — Prisma's migration engine prefers `directUrl` automatically whenever it's set).
2. **`package.json`** — `build` is now just `next build` (previously `prisma migrate deploy && next build`, which ran migrations on every single Vercel build/deploy with no separate review step). Added `db:migrate:prod` (`prisma migrate deploy`, run manually, uses `DIRECT_URL`), `seed:dev` (alias for the existing `db:seed`), `seed:prod` (new), `create-admin` (new). Added `dotenv` as an explicit devDependency (scripts were already relying on it being present transitively).
3. **Seed split** — extracted the categories/app_settings upserts out of `prisma/seed.ts` into `prisma/seed-shared.ts` (reused by both). `prisma/seed.ts` (dev: fixtures/demo users) now refuses to run with `NODE_ENV=production`. `prisma/seed-tracker.ts`'s functions are now exported (with an ESM `import.meta.url` entry-point guard so `npm run seed:tracker` still works standalone) instead of only runnable as a script, so the new `prisma/seed-prod.ts` can call them. `seed-prod.ts` seeds only categories + app_settings + Site Tracker sections/steps/sites (skipping the tracker part gracefully if `prisma/seed-data/site-tracker-steps.json` doesn't exist) — no fixtures, no users, ever.
4. **`scripts/create-admin.ts`** (new) — interactive terminal prompts (name/email/password, password masked via raw-mode stdin, never accepted as an argv/env value), idempotent by email (offers a password reset for an existing account). Reimplements bcrypt hashing directly (12 salt rounds, matching `src/lib/auth.ts`'s `hashPassword`) rather than importing it, because every file under `src/lib` that holds the app's real auth code (`auth.ts`, `session.ts`, `audit.ts`, `storage.ts`, `tracker-storage.ts`) starts with `import "server-only"`, which throws unconditionally outside Next's own bundler.
5. **`src/lib/env-validation.ts` + `src/instrumentation.ts`** (new) — boot-time gate: in production, refuses to start if `SESSION_SECRET` or `IMPORT_SECRET` is missing, a known dev/CI placeholder, or implausibly short. (Note: `SESSION_SECRET` isn't actually read anywhere else in `src/` — sessions are DB-backed opaque random tokens, not signed/JWT — so this is a guard rail on a currently-dormant variable, not something that changes runtime crypto behavior. Flagged plainly rather than silently wiring it into the token hash, which would have been security theater: the random token is already its own secret.)
6. **`next.config.ts`** — `poweredByHeader: false`; added `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and (production-only) `Strict-Transport-Security` response headers.
7. **`src/app/api/health/route.ts`** (new) — unauthenticated `GET /api/health`, `{"status":"ok"}`/200 if `SELECT 1` succeeds against the DB, `{"status":"error"}`/503 otherwise. No data/secrets in the response.
8. **README.md** — replaced the generic create-next-app "Deploy on Vercel" blurb with a full "Deploy" section: Neon setup (pooled vs direct URL), the migrate/seed/create-admin commands, the full production env-var table (name / where to get it / required y/n), Vercel project settings (Production Branch = `new-main`), the exact B2 native-CORS-rule JSON to paste in the B2 console, domain swap steps (`app.fraterniti.one` first, then `fraterniti.one`), rollback (repoint DNS at the old Vercel project), rollout-day steps (first-import check against the sheet's Dashboard total, then flip `mode` to `WEBSITE_LIVE`, then stop the Apps Script push), and the health check.
9. **`.env.production.example`** (new) — every production-required env var with comments, no real values. **`.env.example`** — added the new `DIRECT_URL` var.
10. **Repo clean-up** — `diff_err.log` (a stray committed stderr capture, zero content value) removed and `*.log` added to `.gitignore`. `scripts/tmp-e2e-*.ts` were deliberately **left in place** in `scripts/` rather than moved to a `scripts/e2e/` subfolder — this repo's own `CLAUDE.md` "Verification standard" explicitly names them by their current path as the established, reused-not-reinvented pattern for route/UI verification, so moving them would contradict a convention this same session is supposed to be following, not improve anything.

**Secret scan (git history + working tree, per `grep`/`git log -p -S` for `.env`, `SECRET`, `password`, `B2_`) — one real finding, needs rotation:**
- Two literal dev passwords were committed to `prisma/seed.ts` history and are reachable from **every** branch (`main`, `dev`, `new`, `new-main`): `"fraterniti-dev-2026"` (commit `b6c3354`, 2026-09-16) and `"KobeBryant//24"` (commit `2ec1e21`, 2026-09-17), fixed in commit `27940a2` (2026-09-19) by moving to `SEED_DEV_PASSWORD` in `.env`. The seed script applies whichever literal was current to the account `tech@fraterniti.co.in` — the real admin email. **Recommend rotating `tech@fraterniti.co.in`'s password** wherever it's live (the old production app, and anywhere else it might have been reused) — treat both strings as burned, never reuse either or anything derived from them as a real password anywhere. This predates this session and isn't something history-rewriting on `new-main` alone can fix (it's baked into `main`/`dev` too, which this session does not touch).
- No real `.env` file was ever committed (only `.env.example`, which never held real values). No literal B2/Resend/import-secret values were ever committed.
- Everything else asked for in this area was already correct and needed no change: the import API's 401 (bad/missing secret) → 403 (`WEBSITE_LIVE` mode) ordering (`src/lib/import/route-guard.ts`), session cookies already `httpOnly`/`secure` (in production)/`sameSite: lax` (`src/lib/session.ts`), the Site Tracker's dev-disk upload fallback already gated on `NODE_ENV !== "production"` with its own route 404ing otherwise (`src/lib/tracker-storage.ts`, `src/app/api/tracker/evidence/dev-upload/route.ts`), B2 already throwing a clear error on missing creds instead of a silent prod fallback, and zero `NEXT_PUBLIC_*` variables anywhere (nothing to leak into the client bundle).

**Scope decisions made this session, with reasoning:**
- Did not touch `scripts/configure-b2-cors.ts` — its hardcoded `PRODUCTION_ORIGINS` list (`fraterniti.one`, `one.fraterniti.co.in`, `fraterniti-one.vercel.app`) belongs to the **old** app's domains and uses the S3-compatible CORS schema (different wire format from the native-B2 JSON now in the README). Whether the new app gets its own B2 bucket or shares the old one is a decision for a human (not something I can provision — no B2 access), so changing this script's domain list preemptively would have been a guess either way.
- Did not attempt to fix the one pre-existing `tmp-e2e-site-tracker.ts` assertion-timing issue noted above — it's a test-margin problem, not a regression from this session's changes, and touching someone else's test timing without being asked risked masking a real future flake instead of just the current margin.

**Still pending / needs a human (see the final chat report for the full numbered checklist):**
- Create the Neon project and get both connection strings; run `db:migrate:prod`/`seed:prod`/`create-admin` against it.
- Create the new Vercel project (Production Branch = `new-main`), add every env var, deploy, test on the `.vercel.app` URL.
- Create (or decide whether to reuse) the B2 bucket, add its credentials, paste the CORS JSON.
- Add the domain(s), then rotate `tech@fraterniti.co.in`'s password wherever it's currently live.
- Decide whether `scripts/tmp-e2e-site-tracker.ts`'s timing margin is worth tightening in a future session.
- M7 — Polish (empty/loading/error states, responsive check, README for env vars) is the only milestone left per plan.md section 10.

### 2026-11-03 — Sheet sync (`docs/sheet-sync/CLAUDE_CODE_HANDOFF.md`): Apps Script push, Step 0 through a working end-to-end sync

Branch `new-main`. Implements the handoff doc's full `/api/sheet-sync/*` contract — a newer, stricter sibling to the M2 `/api/import/boq/*` push (staging + atomic commit, button/daily/menu triggers, failure email), left deliberately separate per Step 0's findings and the user's explicit decisions below.

**Step 0 findings (reported and approved before any code was written):** reused as-is, no schema change — `Site`/`Category`/`Vendor`/`CategoryVendor`/`VendorRate`/`Item` (its existing `sourceKey`-fallback-key idea is exactly the handoff's `itemKey` format), `SiteItem` (its columns already matched the payload's per-site fields ~1:1), `AppSetting`'s `mode` switch, the bearer-secret pattern (`src/lib/import/auth.ts`), `requireSiteBoqUser`/`permissions.ts`, `src/lib/email.ts`'s Resend plumbing, `ImportRun` (extended, not replaced). Genuinely new: one staging table, a few nullable `ImportRun` columns, a new `Site.sheetLocked` boolean (the sheet's own "order delivered" flag — distinct from the website-native `isLocked`), a new route group, a new Zod schema file, one new permission (`canTriggerSheetSync`), and the button/status UI.

**User's 5 conditions, all implemented:**
1. **Mode**: `/pending` returns `{pending:false}` (not 403) in `WEBSITE_LIVE`; `/request` rejects with a clear message; `/start`/`/chunk` 403 like the old importer; `/finish` re-checks mode and fails the run (not just the HTTP call) if it flipped mid-sync.
2. **Sheet is boss**: `commitRun` deletes a `SiteItem` row outright when the sheet no longer has data for that (site, item) — not just zeroed — and archives (`isActive=false`/`usedInBoq=false`) an item/site missing from the whole run, never deletes either. Two exclusions found and fixed during testing (test 7 below): a website-locked site's rows are frozen, not stale; a site that dropped out of `sites[]` entirely (archived) also keeps its old `SiteItem` rows frozen rather than losing them in the same sweep that clears a *present* site's missing-item data.
3. **Batched/bulk finish**: `commit.ts` pre-fetches Category/Vendor/Site once, then bulk-upserts `Item`/`VendorRate`/`SiteItem` via raw parameterized `INSERT ... ON CONFLICT` statements (250-row batches) instead of one Prisma call per row — a few dozen statements total for 680 items / ~3000 site entries, not thousands. `finish`'s route has `maxDuration = 300` and the transaction timeout is 180s.
4. **Atomic request claim**: `claimRequest` in `request-state.ts` uses `SELECT ... FOR UPDATE` inside one transaction on the `AppSetting` "sheetSyncRequest" singleton row — a real DB-level lock, not a read-then-write race. Verified: 5 concurrent `/request` calls produce exactly one `requestId`.
5. **Field mapping**: `trackedAmount→poAmount`, `advGiven→advanceGiven`, `remark→remarkSize`, `remarks→remarks` (these are two separate existing `SiteItem` columns, not the same field spelled two ways — confirmed by reading the handoff's own illustrative example, which has both in the same object), rest 1:1 by name.

**What was built:**
- `prisma/schema.prisma` — `Site.sheetLocked`; `ImportRun.trigger/requestId/errorMessage/sitesPayload`; new `BoqSyncStagingChunk` model (migration `20261103080853_sheet_sync_staging`).
- `src/lib/sheet-sync/`: `schema.ts` (Zod, verified field-for-field against `sample-payload.json`), `auth.ts`+`guard.ts` (bearer secret, separate `SHEET_SYNC_SECRET` from `IMPORT_SECRET`), `request-state.ts` (atomic singleton), `commit.ts` (bulk finish logic), `run.ts` (start/chunk/fail/pending/status + the reaper: >10min running → failed, >3min un-picked-up → one alert email), `errors.ts`.
- `src/app/api/sheet-sync/{pending,start,chunk,finish,fail,request,status}/route.ts`.
- `src/lib/email.ts` — added `sendSheetSyncFailureEmail` (reuses the existing `getClient`/`getFrom` Resend plumbing).
- `src/lib/permissions.ts` — `canTriggerSheetSync` (Admin only, matches handoff section 6 "admin only").
- `src/app/(app)/site-boq/_components/sync-with-sheet-button.tsx` + wired into the Overview page — polls `/status` only while active, exact copy from handoff section 6.
- `.env`/`.env.example`/`.env.production.example` — `SHEET_SYNC_SECRET`, `SHEET_SYNC_ALERT_EMAIL` (not added to `env-validation.ts`'s hard boot gate — same optional-degradation treatment as B2/Resend, not SESSION_SECRET/IMPORT_SECRET).
- `scripts/tmp-e2e-sheet-sync.ts` (new, kept per convention) — drives the real `docs/sheet-sync/sample-payload.json` through every one of handoff section 9's 9 tests, plus the user's stacking/atomicity/auth conditions, plus a real-browser Playwright pass of the button itself.

**Two real bugs found and fixed by the e2e pass (not just typecheck/lint):**
1. `/api/sheet-sync/request` and `/status` wrapped `requireUser()` (which uses Next's `redirect()` internally) inside a generic try/catch error-mapper — this swallowed `NEXT_REDIRECT` and turned a no-session request into a bogus 500 instead of a real redirect. Fixed by calling `requireUser()` unwrapped, outside the try/catch, matching the established pattern already used by `src/app/api/tracker/sites/route.ts`.
2. The sync button's polling only rescheduled itself once after a click (a single extra `setTimeout`, not a real loop) — it would stop polling after ~1-2 checks and never observe the eventual "Done" state. Fixed with one self-rescheduling `pollLoop` (via a ref, not a self-referencing `useCallback` — `eslint-plugin-react-hooks` correctly flagged the first attempt). Also found: a completed sync's "success" state is server-persisted (survives until the next request), but the handoff only wants "Done — N items, N sites" shown to whoever was actually watching — a fresh page load later should show "Last synced: ..." instead. Fixed by tracking the state transition client-side (`justFinished`), not by trusting the server's state string alone.

**Verified (`scripts/tmp-e2e-sheet-sync.ts`, 26/26 checks, against the real Neon dev DB + a running `pnpm dev`):**
- Happy path: start → 21 real chunks (incl. one deliberately retried chunk) → finish; 680/680 items, 17/17 sites, no duplication from the retry.
- Atomic: 10-of-21 chunks + `/fail` → live data byte-identical (same item/siteItem/vendor/site counts) to before. Full chunks + wrong `expected.items` → `/finish` rejects, run marked FAILED, live data unchanged.
- Idempotent retried chunk confirmed via DB count, not just the response.
- Duplicate-name items ("Japanese Cocktail Glass" ×3) land as 3 separate rows.
- A `rateMissing:true` item's stored rate resolves to `null` (renders "Rate pending").
- Auth: no/wrong secret → 401 on every script route; no admin session → real redirect (not 200/202) on `/request`.
- Stacking: 5 concurrent `/request` calls → exactly 1 `requestId`.
- A site removed from `sites[]` → archived (`usedInBoq=false`), not deleted; its prior `SiteItem` rows survive untouched (this is what caught bug-fix #2 under "Sheet is boss" above).
- Real browser (Playwright): button visible → click → "Waiting for the sheet…" → (simulated Apps Script picks it up via `/pending` → runs the full payload) → "Done — 680 items, 17 sites" → page reload shows "Last synced: ...".
- `pnpm run typecheck`, `pnpm run lint` (same one pre-existing unrelated `src/lib/email-domain.ts` warning), `pnpm run test` (48/48, no regressions), and `next build` all pass clean.
- Final DB state after the full test pass: all 17 real sites active, 680 real items from the actual 02-Nov sheet backup — this incidentally also completes plan.md's open item that the real sheet data had never been imported (only the fixture had).

**An unrelated environment issue found and fixed along the way (not a sheet-sync bug):** the local `.env`'s `DATABASE_URL` Neon project had a dangling, failed `_prisma_migrations` row (`20260915101650_init`, `finished_at=null`, error `type "Role" already exists`) — a stray leftover from an earlier session's migration attempt against the wrong migration set. The project's actual tables were already correct (this branch's real schema, 1 real admin user, 22 sites, 21 categories — not the old Phase-1 app's tables), so this was metadata corruption, not a wrong-database situation. Confirmed with the user, then resolved with `prisma migrate resolve --rolled-back` + removing the dangling row directly (both non-destructive to real tables/data) before running the new migration.

**Two things flagged, not built, per Step 0/the user's decisions:** the old `/api/import/boq/*` (M2) push path is untouched and still live in parallel — revisit once sheet-sync is proven in production, not this session. Photos are out of scope for sheet-sync v1 (handoff section 4) — no `ItemPhoto` changes.

**Still pending / needs a human:**
- `WebsiteSync.js` (the real Apps Script) was never run against this app — only the recorded `sample-payload.json` was. The real script still needs the human steps in handoff section 11: paste `SHEET_SYNC_SECRET` into the sheet's menu, add the script, run its trigger setup, test against a preview URL before the live sheet.
- Decide the fate of `/api/import/boq/*` once sheet-sync is proven (flagged above, deliberately not decided this session).
- M7 — Polish is still the only Site BOQ milestone left per section 10, unchanged by this session.

### 2026-11-04 — /site-boq/vendors crash + site-wide navigation slowness

**Diagnosis (not guessed — confirmed by reading the actual code and running it):**
- `/site-boq/vendors` crash: no deterministic bug found in `vendors/page.tsx`/`boq-data.ts`/`vendor-edit-dialog.tsx` — the real root cause is structural: **zero `error.tsx`/`global-error.tsx`/`loading.tsx` existed anywhere in `src/app`** (confirmed via glob), so any unhandled exception on any page — a transient Neon blip, anything — fell through to Next's bare generic crash screen with no diagnostic and no recovery. The original crash's exact stack trace could not be recovered (the dev log on disk predated it), so this fix addresses the confirmed structural gap rather than one specific guessed bug.
- Site-wide slowness, confirmed by the user on **both** local Docker Postgres and production Neon (`ap-southeast-1`) — ruling out "it's just dev-mode compiling" as the sole explanation: every navigation re-runs an uncached DB-backed session check (`(app)/layout.tsx` → `getCurrentUser()`) plus each page's own uncached Prisma queries, with **zero caching and zero `loading.tsx`/Suspense anywhere** (confirmed via grep/glob), so every click pays full round-trip latency behind a blank screen. `site-tracker/page.tsx` additionally did zero server-side data fetching, making the client do two sequential fetches before rendering anything.

**What changed:**
- `src/app/(app)/error.tsx`, `src/app/error.tsx`, `src/app/global-error.tsx` — new error boundaries using Next 16.3.5's stable `retry` prop (confirmed current API via `node_modules/next/dist/docs/.../error.md`'s version table before writing them).
- `src/app/(app)/loading.tsx`, `src/app/(app)/site-boq/loading.tsx` — new, so the sidebar shell paints instantly on nav instead of blocking on a page's own queries.
- `src/lib/boq-data.ts` — `getActiveCategories()` wrapped in `unstable_cache` (1hr revalidate, no invalidation wiring needed — confirmed via grep no mutation path ever writes `db.category`).
- `src/app/(app)/site-boq/vendors/page.tsx` — hand-picks scalar fields before passing `vendor` to the client edit dialog (matches the existing `items/page.tsx` convention) instead of passing the raw Prisma row.
- `src/app/(app)/site-tracker/page.tsx` + `_components/site-tracker-app.tsx` — page now SSR-fetches the sites list and the default site's summary (`getAllSitesProgress`/`getSiteTrackerSummary`, same functions the API routes already used); the client component seeds its state from props instead of fetching both on mount, skipping the redundant initial fetch via a ref-guarded effect while still honoring a different `localStorage`-remembered site.
- Deliberately not done (see plan file `first-of-all-ise-jolly-comet.md` for the reasoning): no caching added to the session check itself (would weaken the deliberate DB-backed-session revocation guarantee) or to `getAppSettings()` (sits on the write-authorization path); `src/proxy.ts` and `src/lib/db.ts` were confirmed already correct and left untouched.

**Verified:**
- `pnpm run typecheck`, `pnpm run lint` (clean except the one pre-existing unrelated `src/lib/email-domain.ts` warning), `pnpm run test` (48/48) all pass.
- New `scripts/tmp-e2e-nav-reliability.ts` (kept, not throwaway) against a live `pnpm dev`, using a throwaway ADMIN test user (deliberately *not* the real `tech@fraterniti.co.in` account, to avoid tripping its 5-attempt login lockout with a guessed password): `/site-boq/vendors` responds 200 with real content, not the crash screen; sub-nav click to Vendors works; Site Tracker renders and makes **0** client-side `/api/tracker/sites` requests on initial load (down from 2 sequential) — all checks pass.
- Directly proved the new error boundary works, not just that nothing happened to throw this time: temporarily added a forced `throw` in `vendors/page.tsx` behind a query param, hit it via Playwright, confirmed the contained "Something went wrong" card rendered with the sidebar/nav still intact (not the generic full-page crash screen), then reverted the temporary throw and re-ran typecheck + the full script to confirm a clean final state.

**Still pending / needs a human:**
- The *original* reported crash's exact trigger (transient Neon blip vs. something sheet-sync-related vs. something else) was never captured — the dev log on disk predated it and it didn't reproduce on demand. If `/site-boq/vendors` ever shows the new contained error card instead of loading, the error reference number logged in the server console (`console.error` in `error.tsx`) will have the real stack trace this time — capture and share that if it happens again.
- Whether production navigation actually feels faster now needs a real deploy + the user's own click-through — not verifiable from this session (local `pnpm dev` is inherently slower than a production build regardless of these fixes, so local testing alone won't show the full picture).
- `src/lib/sheet-sync/guard.ts`'s broad catch (swallows `NEXT_REDIRECT` into a generic 500, confirmed during diagnosis) was flagged as a related but separate issue, scoped to `/api/sheet-sync/*` only — not fixed in this pass, worth its own follow-up.

### 2026-11-05 — Follow-up: the `loading.tsx`/caching pass didn't actually fix the slowness

The user correctly called this out directly: "koi fark ni aya slowness mai... bas loading ka lga dia hai." The previous pass never *measured* anything — it improved the UX around the wait (spinners, no crash) without reducing the wait itself. This pass measured, found the real cause, fixed what could safely be fixed, and found a second, more serious issue that code can't fix.

**Root cause #1 (fixed): Prisma's default relation-loading strategy issues one SQL round trip per relation, not a SQL JOIN.** Confirmed directly with Prisma query-event logging against the real DB: `getComputedItems()`'s query (Item + finalVendor + vendorRates.vendor + siteItems.site) fired **6 separate sequential SQL queries** for one `findMany()` call. Every one of those pays full network latency to the remote Neon DB (`ap-southeast-1`). This is why every page felt slow regardless of the `loading.tsx` work — nothing was ever cached or reduced, just the wait was made less blank.

**Fix applied:** enabled Prisma's `relationJoins` preview feature (`prisma/schema.prisma` generator block) and added `relationLoadStrategy: "join"` to the queries where it was verified to give a **stable, repeatable** improvement:
- `src/lib/session.ts` `getCurrentUser()` (session+user — runs on every page load): 2 round trips → 1, measured consistently ~200ms.
- `src/lib/boq-data.ts` `getVendorsGroupedByCategory()`, `getPurchaseOrders()`, `getPurchaseOrderById()`: multiple round trips → 1 each, small/simple result sets, stable across repeated runs.
- `src/lib/tracker-data.ts` `getSiteTrackerSections()`: deepest nesting of all (4 levels), but filtered to one site so the actual row count per query stays small — measured stable at ~1000ms across 3 repeated runs.

**Deliberately NOT applied to `getComputedItems()` (Overview + Items pages) — and this matters, read carefully:** this is the one query with TWO separate one-to-many relations fanning out from the same 680 items (`vendorRates` and `siteItems`, ~745 and ~2996 rows respectively). Tested four different strategies against the real DB, repeatedly:
1. Prisma's default (6 sequential queries): stable at the start of this session, ~2.5s.
2. `relationLoadStrategy: "join"` (1 query): **6-20 seconds, every time it was tested, across multiple repeated runs** — worse than the baseline, not better.
3. Manual split into 3 parallel queries (`Promise.all`) with an `itemId IN (680 values)` filter: **2.8-7.5s, unstable**.
4. The same 3 queries run sequentially instead of parallel: **7.4-9.7s, unstable** — ruled out "concurrent connection contention" as the cause.

Across all four attempts, the common thread was the `SiteItem` table specifically (2996 rows) — a plain `db.siteItem.findMany()` with no filter at all measured 790-1459ms in isolation, but the moment it was filtered by a large `itemId IN (...)` list (any strategy, any concurrency pattern), response time became wildly inconsistent and got *worse*, not better, the more it was retested in this same session — simple unrelated queries (`db.category.findMany()`) stayed fast and stable (~80ms) throughout, so this isn't a general "the whole DB is slow" problem, it's specific to this one query's access pattern. This does not look like a code/query-shape problem anymore — it looks like a live instability on the Neon compute itself (autoscaling compute size, or contention from something else using the same branch), which is outside what a query rewrite can fix. Reverted `getComputedItems()` to Prisma's plain default (no `relationLoadStrategy`) — the one configuration with a confirmed non-catastrophic baseline — rather than ship something unproven that measured worse in testing.

**Verified:**
- `pnpm run typecheck && pnpm run lint && pnpm run test` (48/48) clean.
- `pnpm run build` clean, both before and after the `getComputedItems()` revert.
- Correctness of the join-strategy queries verified directly against real data before applying: row order preserved (`getComputedItems`'s sort order, tested in isolation), nested relation counts matched the non-join version exactly.
- Discovered along the way (unrelated to this fix, pre-existing): `.env.production.local` in this checkout has a Vercel-redacted placeholder `DATABASE_URL` (from an earlier `vercel env pull --environment=production`), which breaks `next start` locally with a `PrismaClientInitializationError`. Does not affect the real Vercel deployment (which reads its own dashboard-configured env vars, not this local file) — only affects testing a production build *locally* in this checkout. Had to inject the real `DATABASE_URL` via explicit env override to get `next start` running for this session's testing.
- Also discovered: an existing boot-time secret-strength check (from the "Production readiness" work, `src/instrumentation.ts`) correctly rejects a short `SESSION_SECRET` under `next start`/production mode — this is working as intended, not a bug, just something to know if testing production mode locally.

**Still pending / needs a human — this is the important one:**
- **Check the Neon dashboard**: compute size/autoscaling settings (is it on a plan/tier that scales to a very small compute, or to zero, between requests?), and whether anything else is concurrently using the same branch/compute. The `SiteItem`-table instability measured above (same query, same code, ranging from 790ms to 20+ seconds across repeated runs in one sitting, trending *worse* over the session) is the single biggest remaining lever for Overview/Items page speed, and it's not something a code change can fix without first understanding why Neon's response times for that access pattern are this unstable.
- Also still open from the previous entry: confirm the Vercel deployment's function region is set close to the Neon DB's `ap-southeast-1` — every round trip (including the now-optimized ones) pays extra latency if they're in different regions.
- If Neon's dashboard shows nothing unusual, the next diagnostic step would be an `EXPLAIN ANALYZE` on the raw SQL Prisma generates for the `siteItems`/`vendorRates` batch queries, run directly against the DB (e.g. via Neon's SQL editor) — not done this session, since the instability looked infrastructure-side rather than query-plan-side (a bad plan would be *consistently* slow, not 790ms one run and 6s the next on identical input).
### 2026-11-05 — Dashboard Phase A — Schema + ingest API + fixture

Branch `new-main`, confirmed via `git branch --show-current` before starting. New module per `dashboard-sheet-sync-plan.md` section 7 (build order A-F); this entry covers Phase A only — schema, ingest API, a fixture so UI work doesn't have to wait on the real Apps Script.

**One deliberate deviation from `dashboard-sheet-sync-plan.md` section 4, per the user's own rule 3 (mirror Site BOQ's sync pattern) overriding the plan where they disagree:** section 4 describes the website calling an Apps-Script web-app URL (`doPost`/deploy-as-web-app) to start a sync. The *live* Site BOQ sync (`docs/sheet-sync/`) actually works the opposite way — Apps Script polls the website every ~1 min, the website never calls Apps Script. Built the poll model instead: no web-app deployment, no public URL, one fewer human-dependent setup step. Flagged to the user before starting; they proceeded.

**What was built:**
- Schema (`prisma/schema.prisma`): `DashboardSite`, `DashboardStep`, `DashboardDeptLink`, `DashboardSiteAssignment`, `DashboardSyncRun`, `DashboardSyncStagingChunk`, `DashboardStepStatus` enum. Deliberately separate from Site BOQ's `Site`/`ImportRun`/`BoqSyncStagingChunk` (section 11 above explains why). Migration `20261105103354_dashboard_schema` applied to the Neon DB in `.env` — additive only, nothing existing touched. Required starting Docker Desktop (the shadow-DB step needs the docker-compose Postgres on port 5433, same as every prior session's migrations) and briefly stopping a `pnpm dev` that was holding the Prisma query-engine DLL open (Windows file lock) so `prisma generate` could run; restarted afterward.
- `src/lib/dashboard-sync/`: `schema.ts` (Zod), `auth.ts`+`guard.ts` (bearer secret, `DASHBOARD_SYNC_SECRET` — separate from both `IMPORT_SECRET` and `SHEET_SYNC_SECRET`), `request-state.ts` (atomic singleton under its own `AppSetting` key `dashboardSyncRequest`, isolated from Site BOQ's `sheetSyncRequest`), `commit.ts` (site upsert by normalized name + archive-if-missing; full delete+recreate of a site's `DashboardStep` rows per sync, matching the user's own "old data of that site is replaced" mental model — no merge-upsert needed since the sheet always sends a site's complete step list in one chunk; dept links fully replaced each run; sheet-vs-computed mismatch diffing), `run.ts` (pending/start/chunk/finish/fail/status + the same >10min-running / >3min-unpicked-up reaper timers as sheet-sync), `errors.ts`.
- `src/app/api/dashboard-sync/{pending,start,chunk,finish,fail,request,status}/route.ts` — script routes bearer-secret gated, `request`/`status` session-gated via the new `canTriggerDashboardSync` (internal roles, not Admin-only — unlike Site BOQ's equivalent button, per the plan's explicit "internal roles only" for this module).
- `src/lib/permissions.ts`: `canViewAllDashboardSites`, `canTriggerDashboardSync`, `canManageDashboardSiteAssignment`.
- `src/lib/dashboard-calc.ts` (+ `dashboard-calc.test.ts`, 7 tests): pure `computeSiteStats`/`deriveParentStatus` implementing section 5's percentage rule (per stage = Completed / (leaf rows - Not required), parents excluded) — the one place this lives, reused by the sync's mismatch check now and the Dashboard UI later.
- `sendDashboardSyncFailureEmail` added to `src/lib/email.ts`, reusing the existing Resend plumbing (same pattern as `sendSheetSyncFailureEmail`).
- `scripts/fixtures/dashboard-sync-fixture.json` (2 sites, hand-computed stage/status/shared/deliverable data) + `scripts/push-dashboard-sync-fixture.ts` (start → chunk-per-site → finish against a running `pnpm dev`).
- `.env.example`: `DASHBOARD_SYNC_SECRET`, `DASHBOARD_SYNC_ALERT_EMAIL` documented (blank placeholders, same convention as the other sync secrets).

**Verified:**
- `pnpm run typecheck`, `pnpm run lint` (same one pre-existing unrelated warning in `src/lib/email-domain.ts`), `pnpm run test` (55/55 — 7 new in `dashboard-calc.test.ts`, 48 pre-existing) and `pnpm run build` all pass clean. Build lists all 7 new `/api/dashboard-sync/*` routes; no existing route changed.
- Pushed `scripts/fixtures/dashboard-sync-fixture.json` through the real running `pnpm dev` against the Neon DB: `begin → chunk(Fixture Site A) → chunk(Fixture Site B) → finish` returned `{sites: 2, steps: 11, deptLinks: 1, deactivatedSites: 0}` with **zero warnings and zero mismatches** — the fixture's hand-computed `sheetSummary` numbers matched the website's own `computeSiteStats` output exactly, cross-checking both the fixture and the calc/commit code at once.
- Direct DB query after the push confirmed: both sites present with correct `driveFolderUrl`/`lastSyncedAt`; all 8 (Site A) + 3 (Site B) `DashboardStep` rows with correct per-row status (including the blank-status-means-Not-started rule and the parent row's `status = null`), `shared` flags, and a deliverable's `[{name,url}]` JSON intact; the dept link row correctly resolved `siteId` to Fixture Site A.
- Re-pushed the same fixture a second time: identical counts (11 steps total, not 22) — confirms idempotent replace, no duplication.
- Auth: `GET /api/dashboard-sync/pending` with a wrong or missing bearer secret → 401 (checked both).

**Still pending / needs a human:**
- `DASHBOARD_SYNC_SECRET`/`DASHBOARD_SYNC_ALERT_EMAIL` currently only have locally-generated dev values in `.env` (same convention as the other sync secrets already there) — real production values need to be set in Vercel when this is deployed, and the same secret needs pasting into the sheet copy's Apps Script Script Properties once `WebsiteSync.gs` exists (Phase B).
- Phase B: `WebsiteSync.gs` in the sheet copy at `C:\apps-script-copy` — not started yet. Per the user's rule 4, `dryRunWebsiteSync()` must be written and run by the user first, with the logged counts matched against the sheet's own Dashboard tab, before the real extractor is built.
- Phase C (UI), D (button + daily trigger wiring on the website side — the API already supports it), E (franchisee site assignment + access checks), F (polish) — all untouched.

### 2026-11-09 — Dashboard Phase C — UI/UX on fixture data (no real sheet yet)

Branch `new-main`, confirmed via `git branch --show-current` before starting. User asked for a fast UI/UX pass on the Dashboard pages built against the already-synced fixture data — the real sheet connection is intentionally deferred to Phase B/D, which the user will do with guidance later.

**What was built:**
- `src/lib/dashboard-data.ts`: read-only data layer — `getDashboardRanking()` (home page ranking, high to low, via `computeSiteStats`), `getSiteDetail()` (overall + per-stage %, dept links), `getStageDetail()` (parent/child step tree with `deriveParentStatus` applied, same rule `dashboard-calc.ts` already encodes), `getAssignedSiteName()` (franchisee → their one `DashboardSiteAssignment`).
- Pages, all under the existing `(app)` layout (auth already enforced there): `/dashboard` (home, ranking bars + "Sync with sheet" button for internal roles, franchisee auto-redirected to their assigned site or shown an empty state), `/dashboard/[site]` (overall progress, 13 stage cards, department links, Drive folder link), `/dashboard/[site]/[stage]` (step list with status badges, assigned-to, remark, deliverable link chips, expand/collapse on parent rows via a small client component `_components/step-list.tsx`, "Not required" rows dimmed).
- `src/app/(app)/dashboard/_components/dashboard-sync-button.tsx`: client component, byte-for-byte the same poll-while-active pattern as Site BOQ's `SyncWithSheetButton`, pointed at `/api/dashboard-sync/{status,request}` (both routes already existed from Phase A).
- Access control enforced server-side, not just hidden in the UI: `[site]` and `[site]/[stage]` call `forbidden()` if a FRANCHISEE's assigned site doesn't match the URL's site — matches `dashboard-sheet-sync-plan.md` section 8's "a direct URL to another site is refused by the server" acceptance check. No new permission functions needed — reused `canViewAllDashboardSites`/`canTriggerDashboardSync` from Phase A.
- `src/components/app-sidebar.tsx`: Dashboard's nav item changed from `href: null` ("Coming soon") to `href: "/dashboard"`, and — unlike Site BOQ/Site Tracker — left out of `INTERNAL_ONLY_LABELS`, since a franchisee must see this module (routed to their own site), just not Site BOQ/Site Tracker.

**Verified:**
- `pnpm run typecheck`, `pnpm run lint` (same one pre-existing unrelated warning in `src/lib/email-domain.ts`), `pnpm run test` (55/55, unchanged — no new test files this pass, pure UI on top of already-tested `dashboard-calc.ts`) all pass clean.
- Pushed `scripts/fixtures/dashboard-sync-fixture.json` into the local dev DB again via `npx tsx scripts/push-dashboard-sync-fixture.ts` against the running `pnpm dev` (zero warnings, zero mismatches, same as Phase A).
- Real browser pass (Claude in Chrome) as the existing System Admin session: `/dashboard` renders both fixture sites ranked by %, matching bars; `/dashboard/Fixture Site A` shows 50% overall (3 completed/2 in progress/1 not started/1 not required) and three stage cards at 50%/67%/0% — all matching `dashboard-calc.ts`'s own numbers; `/dashboard/Fixture Site A/2` shows the "Site Agreement" parent step correctly derived to "In progress" from its two children (one Completed, one In progress), the "Site Identified" leaf's deliverable chip links out, and the parent row's +/− toggle collapses/expands its children correctly.
- Did **not** browser-test the franchisee 403 path or the Admin site-assignment screen — no franchisee test user with a `DashboardSiteAssignment` exists yet in this DB, and the assignment admin UI is Phase E (not built this pass). The server-side `forbidden()` check was read-verified against the code, not click-verified.

**Still pending / needs a human:**
- Still Phase B (real `WebsiteSync.gs` in the sheet copy) and Phase D (daily trigger + button are already wired API-side, but need the real Apps Script sync to have anything real to push) — same as the Phase A entry above, unchanged.
- Phase E (franchisee site assignment admin screen) not built — today's franchisee-redirect/empty-state logic in `/dashboard` and the server-side 403 in `[site]`/`[site]/[stage]` are ready for it, but there's no UI yet for an Admin to actually create a `DashboardSiteAssignment` row; only a raw DB write could test the franchisee path right now.
- The two "Fixture Site A/B" rows pushed into the local dev DB for this verification pass were left in place (not deleted) so the user can open `/dashboard` themselves and see the real UI live, per their request.
- Fixture data (`Fixture Site A`/`Fixture Site B`) deliberately left in the dev DB (not cleaned up) — Phase C's UI work will build against it, same precedent as the Site BOQ M1-M3 sessions kept their fixture live between sessions.

### 2026-11-09 — Dashboard Phase B — Real `WebsiteSync.gs`, dry run + one real sync verified

Branch `new-main`, confirmed via `git branch --show-current` before starting. The user revealed `WebsiteSync.gs` already existed in `C:\apps-script-copy` (a prior session, 2026-11-05, same day as Phase A) but had never been verified end-to-end against the live sheet copy — this session ran that verification and found/fixed two real bugs before any real push happened.

**Bug 1 — stale cached shape (found via the first real `dryRunWebsiteSync()` run, 23/23 `MISMATCH`):** the prior `WebsiteSync.gs` read stage-tab shape from Code.js's cached `STAGE_MAP`/`STAGE_PARENT_ROWS` globals instead of calling `scanStageLayout_()` live, exactly the risk `dashboard-sheet-sync-plan.md` section 3 warned against ("Do NOT trust the cached STAGE_MAP values — they can be stale after hand-edited rows"). Stage 7 ("Construction Execution") — the largest, most hand-edited stage — had a stale cached leaf count (246 vs the real 177), overcounting ~46 phantom leaf rows per site including the "% Complete" marker row itself as a step (visible in the log as nonsense decimal "statuses" like `0.485294...` on row 198). Fixed by adding `getLiveStageData_()`, which calls `scanStageLayout_()` fresh per stage tab every sync. Re-ran the dry run: **23/23 MATCH**, grand total `T=9155 C=1460 P=261 N=7434 NR=91 Sh=314 NSh=8841` — exact match to `dashboard-sheet-sync-plan.md` section 8's documented acceptance numbers.

**Bug 2 — per-site re-reads blew past Apps Script's 6-minute limit (found via the first real `runWebsiteSync()` attempt):** `buildSitePayload_` read every stage's hidden block (status/remark/deliverable/assignedTo/shared) separately for each of the 23 sites — ~23 × 13 × 6 ≈ 1700 individual Sheets API calls — instead of the one-batch-per-tab pattern `dashboard-sheet-sync-plan.md` section 4 explicitly requires ("read each Stage tab ONCE with batch calls, then slice per site in memory — never read cell by cell"). Building just the first site's payload took long enough (~7 minutes) that by the time the first `/api/dashboard-sync/chunk` call actually fired, the local test tunnel (see below) had gone stale and the call failed with "Address unavailable". Fixed by extending `getLiveStageData_()` to also read every site's hidden-block columns in one `numRows × numSites` range call per stage (down to ~80 total Sheets calls, independent of site count); `buildSitePayload_` now does zero sheet reads of its own, only slices column `idx` out of the pre-read blocks in memory. Re-ran: the full 23-site sync (start → 23 chunks → finish) completed in under 2 minutes.

**Verified:**
- `dryRunWebsiteSync()` (real sheet copy, both before and after the shape fix): first run 23/23 MISMATCH as above; after the fix, 23/23 MATCH with grand totals matching the plan's documented numbers exactly.
- `runWebsiteSync('button', null)` (via `testRunWebsiteSync()`) against the **local dev DB**, tunneled through a `cloudflared` quick tunnel (`https://*.trycloudflare.com` → `localhost:3000`, since Apps Script can't reach `localhost` directly) with `WEBSITE_BASE_URL`/`DASHBOARD_SYNC_SECRET` set as Script Properties: `Dashboard sync OK (button): {"sites":23,"steps":10718,"deptLinks":336,"deactivatedSites":2}`. The two fixture sites from Phase A/C's verification were auto-deactivated (not present in the real site list) — the sync's own existing `lastSeenRunId` soft-deactivate logic (`commit.ts`, built in Phase A), not anything added this session.
- Real browser pass on `/dashboard` against this real data: ranking shows **Tulsi Bangalore 75%, Tulsi Indore 47%, Pavitra 43%** — exact match to `dashboard-sheet-sync-plan.md` section 8's acceptance numbers, and Tulsi Bangalore's own detail numbers (299/399 = 75%) match the dry run's per-site `mine{}` line for that site exactly (`T=399 C=299`). This end-to-end match (sheet → Apps Script → website ingest → `computeSiteStats` → UI) is strong evidence the whole pipeline agrees with itself, not just that each piece runs without error.
- `pnpm run typecheck`/`lint`/`test` unaffected — all changes this entry describes are in `WebsiteSync.gs`, outside the `Fraterniti One` git repo (it lives in `C:\apps-script-copy`, a separate clasp-managed project), so nothing to re-run on the website side.

**Still pending / needs a human:**
- `installWebsiteSyncTriggers()` (the every-minute poll + ~10 AM daily trigger) has **not** been run yet — deliberately held off since `WEBSITE_BASE_URL` currently points at a throwaway `cloudflared` quick tunnel tied to one local terminal session, not a stable URL. Installing the poll trigger now would mean Apps Script polls a URL that goes dead the moment that terminal closes. Decide first whether to (a) leave triggers uninstalled until a real deployed URL exists (Vercel project + domain, still pending per the 2026-11-02 entry), or (b) install them temporarily for more local testing and accept re-pointing `WEBSITE_BASE_URL` later.
- The real sync has only ever been pushed into the **local dev DB**, never production — no production Neon DB/Vercel project exists yet for `new-main` (same pending item as the 2026-11-02 entry).
- `WebsiteSync.gs` still lives only in the sheet COPY's Apps Script project — per the user's own rule 3, it gets copied into the **original** sheet's Apps Script project only after the user is satisfied with the copy's behavior; not done yet.
- Phase E (franchisee site assignment admin screen) — still not built, same as the Phase C entry above.

### 2026-11-09 — Correction: `new-main` was already live on `fraterniti.one`, and it's a single DB (not separate dev/prod)

**This corrects the "still pending" item above** (and the 2026-11-02 entry's framing) — both were written assuming no production deployment existed yet for `new-main`. It actually did, set up in a separate chat session on 2026-11-02 that this session had no memory of. Discovered mid-session while trying to get a stable `WEBSITE_BASE_URL` for `WebsiteSync.gs` (a `cloudflared` quick tunnel had just failed under load) — checked `vercel project ls` instead of assuming, which is what surfaced this.

**Actual state, confirmed via `vercel` CLI (already logged in) and the Neon console, not assumed:**
- Vercel project `fraterniti-foods/fraterniti-one-new` exists (created 2026-11-02), **Production Branch = `new-main`**, git-connected (auto-deploys on push — confirmed by a deployment timestamp matching this session's own `git push` to the minute). `fraterniti.one`/`www.fraterniti.one` are attached to **this** project — confirmed by matching `next.config.ts`'s production-only security headers (`Permissions-Policy`, `Strict-Transport-Security`, etc.) in the live site's response headers. The old `fraterniti-one` Vercel project (serving `main`/`dev`) is no longer attached to the domain.
- **Only one Neon project exists in the account** (`fraterniti-one-new`, `ap-southeast-1`/Singapore, created 2026-11-02) — confirmed via the Neon console (no CLI access). There is no separate dev database; local `.env`'s `DATABASE_URL`/`DIRECT_URL` point at the same database Vercel production uses. This means every sync/test this session (the Phase A/C fixture pushes, and Phase B's dry runs and real sync) landed in what is also the production database — not a mistake exactly (the data is real, not fake), but not something this session realized until checking.
- User's decision when asked: keep the single shared DB for now (no separate dev DB split today — revisit later if it becomes a problem), and wire the real sync straight at `https://fraterniti.one` rather than standing up a second environment just for this.

**What was done:**
- Added `DASHBOARD_SYNC_SECRET` and `DASHBOARD_SYNC_ALERT_EMAIL` to the `fraterniti-one-new` Vercel project's Production environment (`vercel env add`, values matching local `.env`) — previously only `SHEET_SYNC_SECRET`/`APP_URL`/`IMPORT_SECRET`/`SESSION_SECRET`/`DATABASE_URL`/`DIRECT_URL` were set; B2/Resend vars are still unset (not needed for the Dashboard sync path, only for file upload/email features — flagged, not fixed, out of scope today).
- Triggered a production redeploy so the new env vars took effect (`vercel redeploy <url> --target production` — run by the user; Claude's own attempt was blocked by the harness's "Production Deploy" safety check, as expected/correct). Confirmed healthy via `GET https://fraterniti.one/api/health` → `{"status":"ok"}`.
- User updated `WEBSITE_BASE_URL` in the sheet copy's Script Properties from the temporary `cloudflared` tunnel to `https://fraterniti.one`.

**Verified:**
- `testRunWebsiteSync()` against **real production** (`https://fraterniti.one`): `Dashboard sync OK (button): {"sites":23,"steps":10718,"deptLinks":336,"deactivatedSites":0}` — same counts as the earlier local-DB run (expected, same underlying database), completed in ~2.5 minutes (production network latency vs. the local tunnel, not a regression).
- Did **not** re-verify `/dashboard` by logging into `https://fraterniti.one` directly this session (no production credentials in hand, and login attempts against a live system aren't something to guess at) — asked the user to check it themselves in their own already-authenticated browser.

**Still pending / needs a human:**
- `installWebsiteSyncTriggers()` (every-minute poll + ~10 AM daily, now safe to point at a stable URL) has **not** been run yet — this was the original blocker (ephemeral tunnel) and is now resolved, but installing continuous automation against real production is its own decision, intentionally not made automatically this session.
- B2 (`B2_ENDPOINT`/`B2_KEY_ID`/etc.) and Resend (`RESEND_API_KEY`/`EMAIL_FROM`) env vars are still missing from Vercel's Production environment — not needed for anything Dashboard-related, but will surface as errors the first time anyone uses file upload or invite/reset emails on `fraterniti.one`.
- `tech@fraterniti.co.in`'s password rotation (flagged back in the 2026-11-02 entry, two old dev passwords were committed to git history pre-dating this branch) — still not done; now more pressing since this account is confirmed live on `fraterniti.one`, not just a future plan.
- `WebsiteSync.gs` still only lives in the sheet COPY's Apps Script project, not the original sheet — unchanged from above.
- Phase E (franchisee site assignment admin screen) — still not built, unchanged from above.
- Whether to eventually split dev/production into two separate databases — deliberately deferred per the user's call today, not forgotten.

### 2026-11-09 — Separated Vercel's Preview DB from Production (Neon branching)

Follow-up in the same session: Vercel's **Preview** environment (used by any git branch other than `new-main`, e.g. `new`) had `DATABASE_URL`/`DIRECT_URL` pointing at the exact same Neon database as **Production** — confirmed via `vercel env ls` (both scopes created 7d ago, same project, and the Neon console showed only one project with one branch, "production"). The user asked for this fixed specifically for the `new` branch, separate from the "keep one shared DB for now" call made earlier today about local dev vs. `new-main` production.

**What was done:**
- Created a Neon branch `preview` (parent: `production`, "Branch data and schema" — a point-in-time copy, independent going forward; auto-delete explicitly set to **Never**, not the dialog's 1-day default) under the same Neon project (console UI — no Neon CLI/API access available).
- User ran `vercel env rm DATABASE_URL preview` / `vercel env rm DIRECT_URL preview` then `vercel env add` for both, pointing them at the new `preview` branch's pooled/direct connection strings respectively, applied to all Preview branches (no git-branch scoping needed). Done in the user's own terminal — Claude never saw the new connection strings.
- Checked for an existing live deployment that would need an immediate redeploy to pick this up: the only Preview deployment in the project (6 days old) turned out to be a `new-main` preview build from before it became the Production Branch, not a `new` branch deployment — so nothing is currently serving stale Preview-DB config. No action needed; the next push to any non-`new-main` branch will automatically get the new `preview` Neon branch.

**Verified:** `vercel env ls` shows `DATABASE_URL`/`DIRECT_URL` under `Preview` with fresh 2-3 minute timestamps, distinct from `Production`'s untouched 7-day-old entries.

**Still pending:** nothing new from this — `new` branch itself has no code changes and no pending deploy; this was purely a Vercel/Neon configuration fix.

### 2026-11-10 — Dashboard: admin "New site" (website-created sites)

Branch `new`. Admin can create a Dashboard site on the website with the 402-task template (every task assigned to "Admin", all NOT_STARTED), optional Drive folder link and optional free-text department links (`interiors --> https://…`), both editable later via "Edit details". Admin can also change status/remark of steps — only on website-created sites. Website-created sites are skipped by the sheet sync (warning, never archived) and show a "Not synced with sheet" badge.

**What changed:** `DashboardSite.origin` (`SHEET`|`WEBSITE`) + `deptLinksText` (additive migration `20261110090000_dashboard_site_origin`); `src/app/(app)/dashboard/actions.ts` (`createDashboardSite`, `updateDashboardSiteDetails`, `updateDashboardStep`; admin-only via `canCreateDashboardSite`/`canEditDashboardSite`; audited); `src/lib/dashboard-site-input.ts`, `src/lib/dashboard-template.ts` (template source = user-provided `prisma/seed-data/dashboard-steps.json`, flat `{stages:[{stage,tasks}]}`, 13 stages / 402 tasks); create/edit dialogs; editable `step-list.tsx`; sync guard in `commit.ts` (`upsertSites` now exported for its test). Perf: `getDashboardRanking`/`getSiteDetail` now count leaf steps with a SQL `groupBy` instead of loading every step row (site query measured 2.6 s and ranking 2.4 s before, from this dev machine to Neon Singapore; not re-timed after the change).

**Verified:** `pnpm run typecheck` clean; `pnpm run lint` 0 errors (1 pre-existing warning, `email-domain.ts`); `pnpm run test` 77 passed (new: permissions, input validation/URL safety/linkify, template integrity = 402 tasks/13 stages, sync-guard `upsertSites` with a fake tx). Migration applied with `prisma migrate deploy` to the DB in local `.env` (`ep-dark-resonance…`, which the user states is the Neon *preview* branch — not independently verified by Claude; the attempt to compare against Vercel's env values was blocked). Playwright `scripts/tmp-e2e-dashboard-create-site.ts` against `pnpm dev`: ALL CHECKS PASSED — create from name only, 402 steps all "Admin"/NOT_STARTED, duplicate (case/space-insensitive) rejected, Drive link + dept links render, edit details, ranking badge, step status + remark persisted with audit events, non-admin has no New site/Edit/step editors, unassigned franchisee sees no site data. Timings from this machine: create (action + redirect + page) ~2.9 s warm / ~5 s first hit, step-status UI update ~0.25 s (optimistic), persisted ~1.3 s; these are dominated by DB round-trips (~150–200 ms each).

**Not verified:** the sync guard end-to-end (the e2e skips it when the DB has real sheet-synced sites, since a real sync would archive them — only the unit test covers it); `scripts/ci-smoke.ts` got a create-site check but CI has not run it; production migration not applied; nothing checked on a deployed URL. Pre-existing, not changed: the franchisee 403 returns HTTP 200 on dashboard routes (streams behind `(app)/loading.tsx`), though no site data is rendered.

**Pending / needs a human:** run `pnpm run db:migrate:prod` against production when ready (additive); consider setting Vercel function region to `sin1` (vercel.json is `{}`, so functions default to a US region while Neon is in Singapore — each DB round-trip costs more there).

### 2026-11-10 — Dashboard-created sites also appear in Site Tracker

Branch `new`. Creating a site on `/dashboard` now also creates a shared `Site` row (`usedInTracker = true`, `usedInBoq = false`, `sourceKey = WEB-<uuid>`) in the same transaction, so it shows in the Site Tracker dropdown and "All sites" tab with the normal sections at 0%. Tracker steps are lazy per-site rows, so nothing else is seeded. A name already used by any `Site` (case-insensitive) is rejected with "A tracker/BOQ site with this name already exists." No schema change.

**Also (speed):** `src/lib/tracker-data.ts` — `getAllSitesProgress` (3 sequential reads → 1 parallel round trip) and `getSiteTrackerSummary` (site lookup + sections now parallel), which speeds the `/site-tracker` page load and every site switch. Create flow: the new reads run in parallel with the existing one.

**Verified:** typecheck clean, lint 0 errors (same 1 old warning), 77 tests pass. `scripts/tmp-e2e-dashboard-tracker-link.ts` (throwaway admin, preview DB) all passed: tracker row exists and is tracker-only, name clash rejected, new site in dropdown at 0% with sections, in All sites, 0 leftover rows. `ci-smoke.ts` gained the same two checks (not run in CI).

**Not verified:** the speed gain is not measured before/after — the e2e timings (page 4.5 s, site switch 2.6 s) came from `next dev` with on-demand compilation, so they say nothing about production. Nothing checked on a deployed URL.

**Pending / needs a human:** "TULSI New Jersey" (a website-created site made earlier) has no tracker row; create-time linking only covers new sites — say if you want it backfilled. A later BOQ sheet sync with an identical name would match the tracker `Site` by name and switch it on in BOQ too. Vercel region `sin1` still not set.

### 2026-11-10 (evening) — Preview DB cleanup after a discarded chat session; code stays at `6f85a9f`

Branch `new`, HEAD `6f85a9f` (unchanged, working tree clean). A separate chat session (15:10–15:22 IST) built instant search + "Dashboard site also in Site BOQ", the user rejected it and ran `git restore` + `git clean -fd`. The code was gone but the **DB side-effects stayed** (git can't revert data): that session ran `scripts/tmp-e2e-m6-purchase-orders.ts` twice, whose `pushFixture()` goes through the real full-snapshot BOQ import against the `.env` DB (Neon *preview* branch). Result: all 680 real items `isActive=false`, the 17 real BOQ sites `usedInBoq=false`, and `Fixture Site A/B/C` + 10 fixture items/13 SiteItems/10 VendorRates/2 vendors/4 ImportRuns present, so Site BOQ showed only Fixture A/B/C. A one-off backfill also set `usedInBoq=true` on "TULSI New Jersey".

**Fixed (data only, preview DB, one guarded transaction with row-count asserts):** reactivated the 680 items and re-flagged the 17 sites (matched on the 2026-11-09 daily run's `lastSeenRunId`, whose counts had `deactivatedItems/Sites: 0`), deleted the fixture rows listed above, set "TULSI New Jersey" back to tracker-only. Production was not touched. Migration `20261110090000_dashboard_site_origin` belongs to commit `c29fc00` and was left as is.

**Verified (SQL):** items 680 active / 0 inactive / 0 `ITM-FIX-%`; 0 `S-FIX-%` sites; 17 BOQ-visible sites; vendors 38; siteItems 2996; vendorRates 745 (all equal to the 11-09 daily run's counts); latest ImportRun is the 11-09 daily; no ImportRun today. Only one `next dev` running, started 15:40 (after the revert), no stray test processes.

**Not verified / needs a human:** no browser pass (Chrome MCP disconnected mid-session): open `/site-boq`, `/site-boq/sites`, `/site-boq/items` and confirm Fixture A/B/C are gone (hard refresh). Categories Kitchen Smallware/Glassware/Furniture had `updatedAt` bumped by the fixture and their `displayName/group` originals are unknown; the next real sheet sync overwrites them. That `.env` DB is the Neon preview branch is the user's statement, not independently checked.

**Root cause fixed (same day):** `scripts/lib/require-fixture-opt-in.ts`, a side-effect import placed right after `import "dotenv/config"` in the six scripts that push a fixture through a full-snapshot import: `push-boq-fixture.ts`, `push-dashboard-sync-fixture.ts`, `tmp-e2e-m5-site-boq-edit.ts`, `tmp-e2e-m5-site-lock.ts`, `tmp-e2e-m6-purchase-orders.ts`, `tmp-e2e-sheet-sync.ts`. They now refuse (exit 1, message names the DB host) unless `E2E_ALLOW_FIXTURE_PUSH=1` is set for that one command; `E2E_FORBIDDEN_DB_HOSTS` still overrides the opt-in. It is opt-in on purpose (the old denylist was never configured, so it never fired). `ci-smoke.ts` and CI are unchanged (throwaway Postgres container). `push-tracker-fixture.ts` and `tmp-e2e-m3-site-boq.ts` are unguarded on purpose (the first resets only its own rows, the second only reads).

**Verified:** helper run directly in 3 modes (no opt-in -> exit 1, opt-in -> exit 0, forbidden host + opt-in -> exit 1); all six scripts run without opt-in -> exit 1 immediately, and the preview DB was unchanged afterwards (0 ImportRuns today, 0 `S-FIX-%` sites, 680 active items). `pnpm run typecheck` clean, `lint` 0 errors (same 1 old warning), `test` 77 passed. Note `scripts/` is excluded from `tsc` (`tsconfig.json`), so the typecheck does not cover these edits; the runs above do.

**Not verified / needs a human:** the guarded scripts have not been run *with* the opt-in against a real throwaway DB (that is the point). Still recommended: a dedicated Neon `test` branch for e2e (console-only; Claude has no Neon access), so these suites have a safe place to run.

### 2026-11-10 (night) — e2e scripts no longer log in as the real admin

First run of `tmp-e2e-m6-purchase-orders.ts` on a new Neon `test` branch (copy of preview) got through the opt-in guard and the fixture push, then timed out at login (`waitForURL` 10 s). Cause (confirmed by a local bcrypt compare, no secrets printed): `.env`'s `SEED_DEV_PASSWORD` does not match the real `tech@fraterniti.co.in` hash in the preview DB (password rotated); the scripts logged in as that account, so login never left `/login`. The same failure happened in the discarded chat session earlier that day.

**Changed:** `scripts/lib/throwaway-admin.ts` (create a per-script ADMIN `tmp-e2e-<script>-admin@example.com`; delete it in `finally`, together with the POs it created, since `PurchaseOrder.createdBy` is `Restrict`, and its audit rows). `tmp-e2e-m3-site-boq.ts`, `tmp-e2e-m5-site-boq-edit.ts`, `tmp-e2e-m5-site-lock.ts`, `tmp-e2e-m6-purchase-orders.ts` now use it instead of `tech@` + `SEED_DEV_PASSWORD`. In m5-edit the lock actor is now that throwaway admin, not "first ADMIN". Not changed: `ci-smoke.ts` (CI DB is seeded with `SEED_DEV_PASSWORD`, so `tech@` works there) and `tmp-e2e-site-tracker.ts` (still uses `tech@`, same latent problem, out of scope for now).

**Verified:** helper smoke test against the preview DB (create, idempotent re-create, ADMIN + active + password hash matches, delete leaves 0 user/0 audit rows; only a throwaway row, no fixture push). Edited scripts type-check with a temporary tsconfig (`scripts/` is excluded from the main `tsc`). `pnpm run typecheck` clean, `lint` 0 errors (same 1 old warning), `test` 77 passed; guard still refuses without `E2E_ALLOW_FIXTURE_PUSH=1`.

**Not verified:** none of the four scripts has been run end-to-end after this change (needs the test-branch connection strings, which only the user has). Whether m6's remaining steps pass on the test branch is unknown. `m3` also asserts fixture totals, so it needs the fixture pushed first (any guarded script does that).

**Follow-up (same night):** first full run of `tmp-e2e-m6-purchase-orders.ts` on the Neon `test` branch with the throwaway admin: 20 of 21 checks passed (login, fixture push, preview/PO totals, PDF, detail page). The one failure, "Search with no match shows the empty state", was a test timing bug, not an app bug: `page.goto` then an immediate `body.innerText` read can catch the `site-boq/loading.tsx` skeleton while the page streams (the page and `getPurchaseOrders` render `No purchase orders match "<q>"` correctly). The script now waits for the content (`waitFor` on the first row / the empty-state text, 15 s) for both search checks; no app code changed. **Not yet re-run** after this fix (needs the test-branch env in the user's terminal); the m3/m5 scripts have still not been run on the throwaway-admin version at all.

### 2026-11-11 — Dropped the Neon `test` branch; `.env` DB (preview) is the test DB, with mandatory cleanup

Branch `new`. The user decided against a separate test database (no real users on preview besides the owner) and will delete the Neon `test` branch. The earlier entries above that recommend or use a `test` branch (2026-11-10 evening/night) are history and are superseded by this one.

**Audit that prompted it (read-only, nothing changed in any DB):** `.env` `DATABASE_URL`/`DIRECT_URL` resolve to Neon endpoint `ep-dark-resonance-aos5r0gl` (project `delicate-grass-21702938`); no `DATABASE_URL` in the shell env, so every script and `pnpm dev` uses it. Read-only SELECTs: all 8 migrations applied incl. `20261110090000` (plan says prod does not have it yet), newest ImportRun 2026-11-09 04:35 UTC and DashboardSyncRun 2026-11-09 09:07 UTC, 1 user (ADMIN), 680 active items, 38 sites, 26 dashboard sites, 0 `tmp-e2e-%`/`ci-smoke-%` users, 0 POs. `.env.prod-check` / `.env.production.local` hold only the literal `[SENSITIVE]` (no prod URL on disk). `pnpm run test` run with `DATABASE_URL` pointed at a dead address: 77/77 passed, so unit tests never touch a DB.

**Changed:** `CLAUDE.md` gained "Test data and the `.env` database" (clean up everything created in the same task and prove it with count queries; snapshot then restore for the six guarded fixture-push scripts; never run `ci-smoke.ts` locally; never touch production or print secrets). `scripts/lib/require-fixture-opt-in.ts` error text no longer suggests a Neon `test` branch. No app code changed.

**Not verified / needs a human:** that `ep-dark-resonance-aos5r0gl` is the Neon *preview* branch is still evidence-based, not proven (Vercel env values are Sensitive/unreadable; the pull attempt was blocked and not worked around) — check the endpoint under the branch in the Neon console. Known remaining gaps, not fixed: `scripts/ci-smoke.ts` has no guard (only the CLAUDE.md rule), the opt-in guard is an env var Claude can set itself, `.claude/settings.json` allows `npx vercel *` and `npx tsx *`, `.env` holds live B2/Resend keys, and the sync secrets match production's. The `.env` Neon password was printed once in a tool output during the audit (masking regex bug); rotating `neondb_owner` is the user's call (it likely affects production too). `m3`/`m5`/`m6` e2e scripts have not been re-run since the throwaway-admin change and, if run, must follow the snapshot/restore rule.

### 2026-11-11 (later) — `scripts/db-restore.ts`: snapshot/restore around fixture-push scripts

Branch `new`. Automates rule 3 of CLAUDE.md's new "Test data and the `.env` database" section, so the full-snapshot fixture scripts (which deactivate every real item/site/dashboard site not in the fixture — 2026-11-10 incident) can run on the `.env` preview DB and leave it as it was.

**What it is:** `scripts/db-restore.ts` (CLI: `run <script> [args]` | `snapshot` | `diff` | `restore` | `drop`) + `scripts/lib/db-restore.ts`. Snapshot = server-side `CREATE TABLE ... AS TABLE` of 16 tables (Category, Vendor, Site, Item, CategoryVendor, ItemPhoto, VendorRate, SiteItem, PurchaseOrder, PoLine, ImportRun, AppSetting, DashboardSyncRun, DashboardSite, DashboardStep, DashboardDeptLink) into schema `e2e_snapshot` of the same database (survives a crashed script/closed terminal; refuses to overwrite an existing one). Restore is **in place by primary key** in one transaction (delete rows that are new, re-insert missing, update changed), re-checks live == snapshot before committing, rolls back and keeps the snapshot otherwise. Not delete-all/re-insert, because `Site` is cascade-referenced by tracker data. `run` and `snapshot` require the same `E2E_ALLOW_FIXTURE_PUSH=1` opt-in as the fixture scripts (and honour `E2E_FORBIDDEN_DB_HOSTS`); `diff`/`restore`/`drop` do not. Not covered (scripts clean these themselves): User, Session, AuditEvent, Tracker*, staging chunks (cascade with their run), DashboardSiteAssignment. Limit: a real user editing the covered tables during a run would be reverted too (single-owner preview DB).

**Verified — on a throwaway local Postgres 16 cluster (own data dir + port 55432, all migrations applied, seeded with 120 items/6 sites/3 dashboard sites/rates/photos/runs/settings; deleted afterwards), NOT on the Neon preview DB:** simulated damage (mass `isActive=false` on all items/BOQ sites/dashboard sites, note edit, a real SiteItem and a real VendorRate deleted, ImportRun `counts` jsonb and an AppSetting changed, new Vendor/Site/Item/SiteItem/VendorRate/ImportRun+staging chunk/DashboardSite+step/AppSetting added) run through `db-restore.ts run` with the child exiting 3: restore still ran, the wrapper returned 3, and an independent per-table md5 fingerprint (separate script, all 19 tables incl. User/TrackerSiteStep/staging) was identical to before. Crash path (`snapshot` -> damage -> `diff` exits 1 -> second `snapshot`/`run` refused and the script not started -> `restore` without opt-in) -> fingerprints identical again. Refusals without opt-in (exit 1). A TypeScript child with arguments runs via `--import tsx`. Scripts type-check (temporary tsconfig; `scripts/` is excluded from the main `tsc`). `pnpm run typecheck` clean, lint 0 errors (same 1 old warning), 77 tests pass. The Neon preview DB's table fingerprint is identical at the start and end of the session (nothing was written to it).

**Not verified:** never run against the Neon preview DB or through a real fixture script (`tmp-e2e-m6-*` etc.) — the auto-mode classifier blocked the first attempt (mass change on a cloud DB) and it was not worked around; the next real use is the first real-data test, so tell the user before it. The "restore failed -> rolled back, snapshot kept" branch is untested (could not provoke it). Neon pooler (`-pooler` host) behaviour for the `RepeatableRead` snapshot transaction and 120 s restore transaction is untested (the scratch DB is a direct Postgres connection); if it misbehaves, use `DIRECT_URL`'s host for the run.
