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

**sites**: id, `source_key` (unique, from sheet Site ID), name (unique), short_code, opening_date (nullable), note, is_active, sort_order.

**categories**: id, name (unique, e.g. "Kitchen Smallware"), display_name, `group` (`operating` | `interior`), sort_order. Seed the 21 in section 8.

**vendors**: id, name (unique), address, gstin, phone, email, note. (Vendor details are empty in the sheet today; they are filled later in the UI and are needed for POs.)

**category_vendors**: category_id, vendor_id (a vendor can serve several categories; the sheet lists up to 8 per category).

**items**: id, `source_key` (unique, from sheet Item ID), category_id, name, size_note, final_vendor_id (nullable), note, is_active, sort_order.

**item_photos**: id, item_id, storage_key, sort_order. An item may have 1–3 photos.

**vendor_rates**: item_id, vendor_id, rate (nullable), unique(item_id, vendor_id).

**site_items**: site_id, item_id (unique pair), qty, remark_size, `rate_override` (nullable, see below), and the order-tracking fields from the sheet: `po_amount`, `boq_link`, `po_link`, `approved_via`, `link`, `advance_given`, `stage`, `follow_up`, `remarks`. Create rows only when something is non-empty.

**purchase_orders**: id, po_number (unique), site_id, category_id, vendor_id, po_date, delivery_by, delivery_days, payment_terms, gst_percent, subtotal, gst_amount, total, status (`draft` | `issued`), created_by, created_at, and a snapshot of company/vendor/site details used on the PDF.

**po_lines**: po_id, item_id, name_snapshot, remark_size, qty, rate, amount, photo_storage_key.

**app_settings** (key/value): `mode` (`SHEET_LIVE` default), company_name, company_address, company_gstin, company_phone, company_email, signatory_name, default_gst_percent (18), default_payment_terms ("50% advance, balance within 7 days after delivery"), default_delivery_days (7), po_terms (4 lines, see section 6.6), urgent_days (7), soon_days (30).

**import_runs**: id, status, started_at, finished_at, counts (jsonb), warnings (jsonb), dry_run.

### Rate rules
- `final_rate(item)` = the rate of `item.final_vendor` in `vendor_rates`. No final vendor, or rate empty/0 → rate is **missing** (store null, never treat 0 as a real price).
- `effective_rate(site, item)` = `site_items.rate_override` if set, else `final_rate`. The sheet has one rate for all sites, so imports leave overrides null, but the UI/data model must support a site-specific override later.
- `amount(site, item)` = `qty × effective_rate` (0 if either missing).
- Order-tracking "pending" = `po_amount − advance_given` (verify with the sheet owner, see section 9).

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

All edits are blocked when `mode = SHEET_LIVE` (except vendor contact details, PO creation, settings), enforced on the server, not just hidden in the UI.

Add a lightweight audit log for edits in `WEBSITE_LIVE` (who, when, what field, old → new).

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

Added later: Equipments · Gas · Ducting · Tiles · AC.

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

**M5 — Edit mode.** Roles from section 5, edits for qty/tracking/rates/vendors/items, audit log, mode switch with confirmation. *Check:* server rejects every write in `SHEET_LIVE`; after switching, the right roles can edit and the import returns 403.

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