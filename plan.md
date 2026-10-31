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
- M7 — Polish (empty/loading/error states, responsive check, README for env vars) is the only milestone left per plan.md section 10.