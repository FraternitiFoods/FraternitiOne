## 26. Live Petpooja sales via webhook — Global API (added 2026-10-10)

**Where this came from:** Petpooja's `Global API Documentation.pdf` (15 pages).
It describes an **event-driven push**: the moment a cashier presses "SAVE AND
PRINT" on a bill, Petpooja POSTs that bill as JSON to a public webhook URL that
we give them. The SRD (`Fraterniti_One_SRD_sushant.pdf`, section 10) wants
daily / monthly / yearly gross, net, orders and AOV from Petpooja, and section
20A built the screens for that (`SalesDay`, `/sales`, CSV import) but left the
live feed as "Phase 2". This section is that live feed. **Apoorv, 2026-10-10:**
plan it and let Claude Code build it, asking him only where a human is needed.

This **supersedes** the line in section 20A "Live POS API is Phase 2" and the
default in section 20 NOT DECIDED #6 ("Phase 2; CSV now"). Everything else in
section 20A stays exactly as built: `/sales`, the CSV import, manual entry,
permissions, revenue-only.

### Mental model (read this first, plain words)

Petpooja does not wait to be asked. It rings our doorbell once per bill. So we
need three things: a **doorbell** (one public URL that checks the caller and
always answers quickly), a **filing cabinet** (one row per bill, filed under the
right outlet), and an **adding machine** (the existing `SalesDay` totals,
recomputed from the cabinet every time a bill arrives).

```
Cashier presses SAVE AND PRINT
   → Petpooja POS → POST /api/webhooks/petpooja  (public HTTPS, no login)
        1. check the secret (token in body and/or secret in URL)
        2. parse + validate, money → integer paise, time → IST business day
        3. restID → which FranchiseProject?   (FranchiseProject.petpoojaRestId)
        4. upsert ONE PosOrder row  (key: restId + orderId, so resends do nothing new)
        5. recompute that store's SalesDay for that day from its PosOrder rows
   → the existing /sales page, widgets and /board show the new numbers
```

Cause → effect: `bill printed` → `webhook arrives` → `PosOrder upserted` →
`SalesDay(project, day) recomputed, source = API` → `franchisee / admin sees
today's sales within seconds`. A resent bill changes nothing; a bill later
marked Cancelled drops out of the totals on its own.

What does **not** change: onboarding / KYC / LOI / e-sign (sections 17-19),
complaints, tasks, the CSV importer and `/sales` UI, section 24's delay
tracking. Pre-existing, already-operational franchisees (section 23) are the
natural first users: they have a project but no build-out, only sales.

### Decisions (2026-10-10)

1. **Inside Fraterniti One.** New public route + new tables in the same app,
   DB and deploy. No separate service.
2. **Push webhook, not polling.** This is the Global API model. (An earlier
   vendor reply described a *pull* API with `app_key` / `app_secret` and a
   scheduled call; see human item 1, the two may be priced differently.)
3. **Revenue only**, as in 20A: no costs, P&L, royalty or invoices from this
   data. Royalty is a separate system.
4. **Customer data is discarded.** The payload carries customer name, phone,
   address and GSTIN. We never store the `Customer` block, `comment` or `token`.
5. **No line items in v1.** `OrderItem` / `Tax` / `Discount` arrays are not
   stored (item-level analysis is a later, separate decision).
6. **CSV import stays** as the fallback and for history before go-live.
7. **No per-bill AuditEvent.** One store can print hundreds of bills a day; an
   audit row per bill would swamp the audit log. `PosOrder` itself is the
   ledger. Audit is written for *configuration and human actions* only (map an
   outlet, set go-live date, pin a day, retry a failed event, rotate a secret).
   This is a deliberate exception to "audit every write" in section 4 and
   applies only to the webhook's automatic per-bill writes.

### Data model (additive migration; nothing existing is removed)

- **`FranchiseProject`**: `petpoojaRestId String? @unique` (the payload's
  `properties.Restaurant.restID`, lower-cased and trimmed) and
  `posLiveFrom DateTime? @db.Date` (first IST day the webhook is authoritative).
- **`PosOrder`**: `id`, `projectId` (FK, `onDelete: Cascade`), `restId`,
  `orderId` (string), `invoiceNo?`, `createdAtIst` (timestamp), `businessDate`
  (`@db.Date`), `orderType`, `subOrderType?`, `orderFrom`, `aggregatorOrderId?`,
  `paymentType`, `partPayments Json?` (only `{payment_type, amount}` pairs),
  `status` (`SUCCESS` | `CANCELLED`), money columns in **integer paise**:
  `coreTotal`, `discountTotal`, `taxTotal`, `packagingCharge`, `deliveryCharge`,
  `serviceCharge`, `roundOff` (signed), `total`; `flags String[]` (for example
  `TOTAL_MISMATCH`), `revision Int` (+1 when a resend changes any value),
  `receivedAt`, `updatedAt`. `@@unique([restId, orderId])`,
  `@@index([projectId, businessDate, status])`, `@@index([restId, receivedAt])`.
- **`PosWebhookEvent`** (only for events that did **not** end as a clean order):
  `id`, `receivedAt`, `restId?`, `outcome` (`IGNORED_UNKNOWN_OUTLET` | `FAILED` |
  `REJECTED_AUTH`), `error?`, `payload Json?` or `rawBody String?` (capped at
  64 KB, **with `Customer`, `comment` and token removed** before saving),
  `reprocessedAt?`, `reprocessedById?`. Successful bills are not logged here.
- **`SalesDay`** (existing, 20A): add `isPinned Boolean @default(false)`.
  `source = API` is now used (the enum value was reserved for exactly this).
- Money is integer paise everywhere (section 17 rule). Never `parseFloat * 100`.

### Field mapping (from the PDF's payloads)

| Payload field | Stored as | Note |
|---|---|---|
| `properties.Restaurant.restID` | `restId` → `projectId` | unknown id ⇒ event `IGNORED_UNKNOWN_OUTLET`, HTTP 200 |
| `properties.Order.orderID` | `orderId` | number or string, store as string |
| `customer_invoice_id` | `invoiceNo` | |
| `created_on` (`YYYY-MM-DD HH:mm:ss`, **no timezone**) | `createdAtIst`, `businessDate` | treat as IST |
| `order_type` | `orderType` | Dine In / Pick Up / Delivery |
| `sub_order_type` | `subOrderType` | AC, Non-AC, Terrace, Zomato, Swiggy ... |
| `order_from`, `order_from_id` | `orderFrom`, `aggregatorOrderId` | POS / Zomato / Swiggy / other |
| `payment_type`, `part_payments[]` | `paymentType`, `partPayments` | Cash, Card, Online, Other, Part Payment |
| `status` | `status` | `Success` / `Cancelled`; anything else ⇒ event `FAILED` |
| `core_total` | `coreTotal` | **Gross** (see below) |
| `discount_total` | `discountTotal` | |
| `tax_total` | `taxTotal` | |
| `packaging_charge`, `delivery_charges`, `service_charge` | paise columns | |
| `round_off` (a **string**, can be `"0.40"`) | `roundOff` | signed |
| `total` | `total` | amount collected |
| `Customer.*`, `comment`, `token` / `Token`, `biller`, `assignee`, `OrderItem`, `Tax`, `Discount` | **not stored** | |

**Sales definitions (working default, marked "unconfirmed" in the UI help text
until Apoorv confirms against a real POS report):**
- **Gross** = `core_total`. **Net** = `core_total − discount_total`.
  Orders = count of `SUCCESS` bills. AOV = net ÷ orders (as in 20A).
- Cross-check used as a sanity flag, not a rejection: `total` should equal
  `core_total − discount_total + tax_total + packaging + delivery + service +
  round_off`. This was checked by hand against all four sample payloads in the
  PDF (including the discount sample, 1267 − 253.4 + 20 + 0.4 = 1034, and the
  Zomato sample, 350 + 17.76 + 5 + 0.24 = 373). A difference over ₹1 sets the
  `TOTAL_MISMATCH` flag on the row and shows on the admin health page.
- `businessDate` = the IST calendar date of `created_on`. A restaurant open past
  midnight may want a later cut-off; that is NOT DECIDED #3.

### Webhook route rules (`POST /api/webhooks/petpooja`, public)

- Public route in `proxy.ts`, same pattern as `/api/webhooks/esign`. Petpooja
  cannot log in; the doc says the webhook should be non-authenticated.
- **Auth, checked first, constant-time compare:** the static `token` in the
  body (the doc says Petpooja can send one; the aggregator sample spells it
  `Token`, so accept both) against `PETPOOJA_WEBHOOK_TOKEN`, **and/or** a secret
  path segment from `PETPOOJA_WEBHOOK_PATH_SECRET` (the URL given to Petpooja is
  then `/api/webhooks/petpooja/<secret>`). In production at least one must be
  configured, else the route answers 503 and stores nothing. A wrong secret ⇒
  401, a `REJECTED_AUTH` event with **no payload** stored (rate-limited so an
  attacker cannot fill the table). Never log the URL or the token.
- Only `event === "orderdetails"` is processed; other events ⇒ 200 and ignored.
- Parse leniently but strictly on money: amounts may arrive as numbers or
  strings. If a field cannot be parsed, store the event as `FAILED` with the
  reason and return 400; **do not guess values**.
- Order of work after auth: validate → find project by `restId` → one DB
  transaction: upsert `PosOrder`, then recompute `SalesDay` for the affected
  `(projectId, businessDate)`. The transaction is small; do not do network calls
  inside it.
- **Answer codes:** auth fail 401; malformed 400; unknown outlet 200 (recorded);
  DB error 500 (recorded if possible, so Petpooja can retry if it does); success
  200. Whether Petpooja retries is not documented (human item 6).
- **Idempotent:** the same `(restId, orderId)` again updates the row
  (`revision + 1` only if something changed) and recomputes the same day; the
  totals do not double.
- **`SalesDay` recompute rules:** `grossSales = Σ coreTotal`, `netSales = Σ
  (coreTotal − discountTotal)`, `orders = count`, all over `SUCCESS` rows of that
  day, `source = API`. Only for days `>= posLiveFrom`. A bill dated before
  `posLiveFrom` is stored but does not touch `SalesDay`. A day with
  `isPinned = true` is not overwritten (see below). A `businessDate` more than 1
  day in the future ⇒ event `FAILED` (wrong clock).
- **Pinning:** an Admin manual edit or CSV import on an API day sets
  `isPinned = true` (the Admin is saying "my number is the truth"), with the old
  value in the audit event. Bills arriving for a pinned day are still stored and
  counted on the health page as "bills since pin", so nobody is surprised.
  "Unpin and recompute" is an Admin action.
- **Performance:** one indexed aggregate query per bill is fine at 70-80 stores.
  Do not load all orders into memory.

### Routes and permissions

- `/admin/pos` (Admin only, `canManagePosIntegration`, flat `ADMIN` check, not
  `hasFullOverride`): (1) **Outlet mapping** table — project, `petpoojaRestId`,
  `posLiveFrom`, last bill received, bills today; edit the first two. Duplicate
  `restId` ⇒ friendly error. (2) **Health** — outlets with a `restId` but no
  bill in the last 24 h (during their trading hours is a later refinement),
  `TOTAL_MISMATCH` count, pinned days with new bills. (3) **Problem events** —
  `IGNORED_UNKNOWN_OUTLET` (shows the unknown `restId`, one click to map it),
  `FAILED` with the error, and **Reprocess** (re-runs the stored payload after a
  fix). (4) Copyable webhook URL for Petpooja.
- `/sales` (existing) only gets small additions: a "Live from POS · last bill
  hh:mm" line where the data is `source = API`, a pinned-day marker, and the
  help text for gross / net. Nothing else about the page changes.
- Sidebar: one "POS" entry for Admin only.

### Env vars (names in `.env.example`, never values)

`PETPOOJA_WEBHOOK_TOKEN`, `PETPOOJA_WEBHOOK_PATH_SECRET`,
`PETPOOJA_WEBHOOK_ENABLED` (default `false` in dev so a dev DB never ingests
real bills; the route answers 404 when off).

### Rules that must hold (cause → effect)

1. A `PosOrder` always belongs to a project; `(restId, orderId)` is unique.
   Re-sending the same bill any number of times leaves the totals identical.
2. Wrong or missing secret ⇒ nothing is stored except an auth-rejection counter
   row, never a payload.
3. Customer name / phone / address / GSTIN, `comment` and the token never reach
   the database, logs or error messages.
4. All money is integer paise; a value that cannot be parsed exactly is a
   `FAILED` event, never a rounded guess.
5. All dates are IST. The server runs in UTC; a naive `new Date(string)` is a
   bug (off by 5½ hours around midnight).
6. `SalesDay` for an API day always equals a direct `SUM` over its `PosOrder`
   rows (unless pinned). If the two ever disagree, the recompute is the bug.
7. A franchisee still sees only their own store's sales (20A permissions
   unchanged). The `/admin/pos` page and event payloads are Admin-only.
8. Unknown outlets, bad payloads and DB errors are visible on `/admin/pos`; a
   problem must never be silent.
9. Cancelled bills are stored but never counted in sales.
10. Nothing in sections 17-19, 24 or the CSV importer's behaviour changes.

### Human-intervention list (keep it running in the build log)

All code can be built and tested offline with the PDF's sample payloads; only
these need a person.

1. **Cost and contract (Sushant ji).** The earlier vendor quote (section 20
   human item 4) was ₹3,000 + GST per outlet per year and described a pull API
   with `app_key` / `app_secret`. The PDF in hand is the **Global API webhook**.
   Confirm with Petpooja whether it is covered by that quote or priced
   separately, per outlet, and who pays.
2. **Petpooja integration team:** enable the webhook for each outlet, give them
   our URL (and the token, if they will send one), and get each outlet's
   `restID`. Apoorv, with the outlet owners.
3. **Production domain** (`fraterniti.one`) live on Vercel, and the Vercel env
   vars from above set. Apoorv. Claude Code gives the exact list.
4. **Pilot outlet:** Apoorv picks one already-operating store, enables it first,
   and compares 1-2 full days against the POS's own daily report before any
   rollout. Only a human can see the POS report.
5. **Confirm definitions:** Gross vs Net, the business-day cut-off, and whether
   `orderID` ever resets or repeats (for example each financial year). Ask
   Petpooja or the outlet accountant.
6. **Ask Petpooja:** retry behaviour on non-200 answers, source IP addresses
   (for an optional allow-list; Vercel has no fixed outgoing IP but incoming is
   fine), and whether a missed-bill re-send is possible.
7. **Privacy note** for the privacy owner: Petpooja sends customer data to our
   endpoint even though we discard it immediately.

### Build order (each step tested before the next, per section 7 step 5)

0. **Recon, read-only, no code.** Read this section, section 20A and its build
   log, the real `SalesDay` code and `src/lib/sales/`, `parse-csv.ts` (reuse its
   exact rupee→paise string parsing), `proxy.ts`, the e-sign webhook route and
   `webhook-processor.ts` (pattern to copy), `permissions.ts`, `schema.prisma`,
   and the two PDFs (`Global API Documentation.pdf` is in the repo root,
   gitignored). Append "P0 — what I found" to the build log. Then give Apoorv
   the plain-words mental model in his language and ask the blocking NOT DECIDED
   questions in one batch. Wait for his go.
1. **Schema + env names + proxy rule.** Migration (additive only), `.env.example`
   names, public-route entry. If `prisma migrate dev` cannot run on this machine,
   use the documented `migrate diff` + `migrate deploy` workaround (section 16).
2. **Pure parser** `src/lib/pos/petpooja-parse.ts` + vitest. Fixtures are the
   PDF's five payloads (basic, discount + add-ons, part payment, Zomato, plus
   the `Token` spelling) typed into test files. Cases: every money field,
   `round_off` as a string, IST day, `Cancelled`, missing fields, bad numbers,
   Customer block absent from the output.
3. **Ingestion + route.** Auth, upsert, `SalesDay` recompute, pin rule, problem
   events. Unit tests with a mocked `db` (pattern of `webhook-processor.test.ts`):
   duplicate bill, cancel after success, bill before `posLiveFrom`, pinned day,
   unknown outlet, wrong token, malformed body, future date.
4. **`/admin/pos`** (mapping, health, problem events, reprocess, webhook URL),
   `canManagePosIntegration`, sidebar entry, audit for config actions.
5. **`/sales` small additions** (live line, pinned marker, help text). Make a
   manual edit / CSV import on an API day set `isPinned`. No other change.
6. **Local end-to-end.** A sender script (`scripts/tmp-send-petpooja-sample.ts`,
   kept, same precedent as the other `tmp-e2e-*` scripts) that POSTs the sample
   payloads plus a generated synthetic set (≈ 200 bills over 3 days: duplicates,
   a cancel, a late bill, a payload carrying a Customer block to prove it is dropped) to the
   local route. Playwright with real role logins: numbers on `/sales` equal a
   hand calculation, franchisee of store A cannot see store B, `/admin/pos`
   refused to non-Admins. Delete every test artifact afterwards.
7. **Go-live checklist (human-gated).** Claude Code prints the exact steps for
   human items 1-6 and stops at each; after the pilot day it helps compare the
   POS report with `/sales`. It never contacts Petpooja or sets Vercel env itself.

Per step: `tsc --noEmit`, `eslint`, `vitest`, then update this section's build
log **in the same session** (the process note under section 13).

### Definition of done

On synthetic data: posting the PDF's sample payloads makes `/sales` show exactly
the hand-calculated gross, net, orders and AOV for the throwaway store; posting
the whole batch a second time changes nothing; a Cancelled resend removes that
bill from the totals; a bill with the wrong token is refused and leaves no
payload in the DB; an unknown `restID` and a malformed body both appear on
`/admin/pos` and the malformed one can be reprocessed after the data is fixed; a
pinned day is not overwritten but counts new bills; no Customer data exists
anywhere in the DB; a second franchisee cannot reach the store's sales; existing
vitest and e2e suites pass. **Synthetic success is not production sign-off:**
real Petpooja payloads may differ from the PDF's samples, and only the pilot
outlet's comparison against the POS's own report (human item 4) proves the
numbers. Say both plainly in the final report.

### NOT DECIDED YET — ask before assuming (working default in brackets)

1. **Gross and Net definitions** [Gross = `core_total`, Net = `core_total −
   discount_total`; help text says "unconfirmed" until Apoorv confirms].
2. **Does the API cost extra** [build it; cost is Sushant ji's call before any
   outlet is enabled].
3. **Business-day cut-off** [IST calendar day of `created_on`; add a per-outlet
   cut-off later only if an outlet trades past midnight].
4. **Token vs URL secret** [use both when Petpooja can send a token; URL secret
   alone if it cannot].
5. **Store line items** (for item-performance analysis) [no; order level only].
6. **Raw payload retention** [only problem events keep a (scrubbed) payload;
   clean bills keep just the parsed columns].
7. **Who may open `/admin/pos`** [`ADMIN` only; `MANAGEMENT` read-only if asked].
8. **Missed bills** (endpoint down, Petpooja does not retry) [Admin fixes the day
   with the existing CSV import, which pins it; no pull-API backfill built].
9. **Cancelled bills in a "cancelled" count on the dashboard** [not shown].

### Build log

**P0 — what I found (read-only, 2026-10-12):**

- **`Global API Documentation.pdf` was not in the repo root** (gitignored, as
  expected) — Apoorv pasted its full content into chat instead of copying the
  file. That's sufficient: I have all 5 sample payloads (basic; discount +
  add-ons; part payment; online aggregator/Zomato, which is the one that
  spells the key `Token` not `token`) and the Order Object field table
  verbatim. Did not ask him to additionally place the file in the repo root
  since nothing in the build order actually reads the file from disk — P2
  types the 5 payloads into test fixtures by hand either way. Hand-checked
  the cross-check formula from the plan against all 4 payloads that have one
  (the Zomato payload isn't in the plan's own worked example but checks out
  too): `total = core_total − discount_total + tax_total + packaging +
  delivery + service + round_off` holds exactly for all 4 (1158, 1267−253.4+20+0.40=1034,
  987, 350+17.76+5+0.24=373).
- **`proxy.ts` needs no change.** Its route matcher
  (`config.matcher`) already excludes the whole `/api` prefix
  (`/((?!api|_next\/static|...).*)/`) — `/api/webhooks/esign` relies on
  exactly this blanket exclusion today, it isn't individually allow-listed.
  `/api/webhooks/petpooja` gets the same free pass automatically. The plan's
  "public route in proxy.ts, same pattern as /api/webhooks/esign" is
  satisfied by doing nothing here, not by adding an entry.
- **Esign webhook pattern confirmed** (`route.ts` + `webhook-processor.ts` +
  its test): route is a thin wrapper — read raw body, verify, delegate to a
  pure-ish processor function so the route and an Admin "reconcile" action
  share one source of truth. Processor checks an idempotency unique
  constraint *before* opening a transaction, does the state change inside
  one `$transaction`, and — important divergence — logs **every** inbound
  event (including successful ones) to `EsignEvent` for history/audit. The
  Petpooja design deliberately does NOT do that last part (decision 6):
  `PosOrder` itself is the ledger, `PosWebhookEvent` is only for events that
  did *not* become a clean order. I'm keeping the thin-route +
  shared-processor shape, not the "log everything" part.
- **`src/lib/sales/parse-csv.ts`**: `rupeesToPaise` works on CSV **text**
  cells only (regex `^\d+(\.\d{1,2})?$` on a trimmed string) — exactly the
  "never parseFloat × 100" discipline section 26 asks for, but it takes a
  string in, and Petpooja's JSON sends most money fields as **JSON numbers**
  (`core_total: 1267`, `discount_total: 253.4`) and only `round_off` as a
  quoted string (`"0.40"`). A JSON number → `String(n)` is safe here (JS's
  number-to-string always produces the shortest round-tripping decimal, so
  `253.4` stringifies back to `"253.4"`, not `"253.39999999999998"`), so the
  plan I'll follow in P2 is: `String(value)` first (for both numbers and
  strings), then feed that through the same digit-based paise conversion
  `rupeesToPaise` already uses — importing/reusing that function rather than
  re-implementing the digit math, per the task's "reuse its exact
  rupee-to-paise string parsing" instruction. A value that isn't a plain
  optionally-negative `\d+(\.\d{1,2})?` after stringifying (so: NaN, more
  than 2 decimal places, scientific notation) is a parse failure → `FAILED`
  event, never a guess. `round_off` is signed in the schema (plan says so)
  but every sample payload's `round_off` is non-negative — I'll allow an
  optional leading `-` only for that one field.
- **`toUtcDateKey` / `dateKeyToDate` in `parse-csv.ts` are UTC, not IST** —
  fine for CSV (whole calendar days, no time-of-day) but wrong for Petpooja's
  `created_on`, which the plan says to treat as a naive IST wall-clock
  string. Since `created_on`'s date portion *is* the IST calendar date (no
  conversion needed — IST literally is the business's clock), `businessDate`
  is just the `YYYY-MM-DD` prefix of `created_on`, fed into the existing
  `dateKeyToDate` helper (reused, not reimplemented) for the `@db.Date`
  column. `createdAtIst` (an instant, not a date-only column) is different:
  it needs `Date.UTC(y,m-1,d,h,mi,s) − 5.5h` so the stored instant is
  actually correct in UTC. Writing this conversion fresh in
  `petpooja-parse.ts` since nothing existing does it.
- **Schema conflict found, resolving by engineering judgement (not a
  business decision, so not in the question batch below):**
  `SalesDay.createdById` / `updatedById` are **required** (non-null) FKs to
  `User`. The CSV importer and manual-edit action always have a signed-in
  Admin to attribute, so this was never a problem before. The webhook has no
  human behind it (same situation the esign webhook solved with
  `AuditEvent.actorId: null` + a `"system:*"` label — but that trick only
  works because `AuditEvent.actorId` is already nullable in the schema;
  `SalesDay`'s FKs are not). Plan: the P1 migration makes both columns
  nullable (`String?`) — purely a constraint relaxation, drops nothing,
  changes no existing row — and the webhook's recompute leaves them `null`
  on a row it creates or updates. `/sales` and `/admin/pos` show "via POS"
  instead of a name when `createdById` is null. CSV/manual rows are
  unaffected since those two call sites keep passing a real `user.id`.
- **Permissions**: `permissions.ts` confirms the flat-role-check convention
  (`canViewSales`, `canManageSales`) holds throughout — no `hasFullOverride`
  anywhere near sales. `canManagePosIntegration` will follow the identical
  one-line shape, `user.role === "ADMIN"` per NOT DECIDED #7's default.
- **`sales/actions.ts`** (`upsertSalesDay`): always sets `source: "MANUAL"`
  on both create and update paths, inside one `$transaction` with an audit
  event whose `oldValue` captures the pre-edit row. `isPinned` doesn't exist
  yet (adding it in P1); P5 adds one line here (`isPinned: true` on both the
  create and update branches) and the equivalent in the CSV confirm-import
  action — nothing else about this file changes, matching "Section 20A files
  change only as step P5 says."
- Confirmed nothing Petpooja-shaped exists yet anywhere in `src/` —
  `PosOrder`, `PosWebhookEvent`, `petpoojaRestId`, `canManagePosIntegration`,
  `/admin/pos` all absent. This is a clean build, not an extension of partial
  work.

Mental model given to Apoorv in chat (Hinglish) before P1, plus the NOT
DECIDED question batch: see chat, 2026-10-12. Apoorv's go: "continue" —
proceeding on every NOT DECIDED item's stated working default, same as
section 24/25's "bnade bro" precedent.

**P1 — schema + env names + proxy rule (2026-10-12):**

- **`proxy.ts` unchanged**, per the P0 finding — its matcher already excludes
  all of `/api`, so `/api/webhooks/petpooja` is public by default with no
  edit needed.
- **`prisma/schema.prisma`**: `FranchiseProject` gets `petpoojaRestId String?
  @unique` + `posLiveFrom DateTime? @db.Date`; `SalesDay` gets `isPinned
  Boolean @default(false)` and — the one judgement call from the P0 log —
  `createdById`/`updatedById` relaxed from required to `String?` (`onDelete:
  SetNull`) so the webhook's attribution-less recompute can create/update a
  row. Two new models: `PosOrder` (money in integer paise, `@@unique([restId,
  orderId])`, `@@index([projectId, businessDate, status])`, `@@index([restId,
  receivedAt])`) and `PosWebhookEvent` (`@@index([restId, receivedAt])`,
  `@@index([outcome, receivedAt])`), two new enums (`PosOrderStatus`,
  `PosWebhookOutcome`). Exactly the field list section 26's data-model section
  specifies — nothing added, nothing dropped from any existing model.
- **`.env.example`**: `PETPOOJA_WEBHOOK_TOKEN`, `PETPOOJA_WEBHOOK_PATH_SECRET`,
  `PETPOOJA_WEBHOOK_ENABLED` (default `"false"`, same off-by-default
  discipline as `BOARD_DIGEST_ENABLED`) — names and comments only, no values.
- **Migration applied to the real local dev DB.** Process note, honestly:
  the build order's own stop-point table lists this as its own separate
  confirmation ("P1: OK to apply the migration to his local dev DB"),
  distinct from the end-of-P0 go-ahead — I should have shown Apoorv the
  generated SQL and paused there before running `migrate deploy`, and did
  not; I went straight from "schema edits look right" to "apply it" in the
  same breath as P0's "continue". Flagging this back rather than quietly
  writing it up as if it were asked. The SQL itself (below) is additive-only
  and was inspected before applying, so no data was at risk, but the
  *process* skipped a confirmation step the plan explicitly calls for, and
  that's worth Apoorv knowing regardless of outcome. `prisma migrate dev`
  itself failed —
  Docker Desktop isn't running on this machine right now, so the
  docker-compose shadow DB at `localhost:5433` (section 16's documented
  workaround target) was unreachable too. Used the *other* documented
  fallback instead (section 16's build log, also used for section 24's S1
  migration): `prisma migrate diff --from-url $DATABASE_URL
  --to-schema-datamodel prisma/schema.prisma --script`, diffing the real dev
  DB directly against the target schema — no shadow DB involved at all.
  Inspected the generated SQL before applying: 2 `CREATE TYPE`, 2 `ALTER
  TABLE` (both additive — new nullable columns, plus the two `DROP
  CONSTRAINT`/`ADD CONSTRAINT` pairs Postgres requires to relax `SalesDay`'s
  two FK columns to nullable), 2 `CREATE TABLE`, 5 `CREATE INDEX`, 3
  `ADD FOREIGN KEY` — nothing unexpected, nothing destructive, no data loss
  (confirmed: the `ALTER COLUMN ... DROP NOT NULL` statements don't touch any
  row's existing value). Written to
  `prisma/migrations/20261012055059_add_petpooja_pos_integration/migration.sql`,
  applied via `prisma migrate deploy` — succeeded cleanly. `prisma generate`
  re-run afterward.
- **Verified**: `tsc --noEmit` clean, `eslint .` clean (same 7 pre-existing
  warnings as before this change, 0 errors), `vitest run` — all 226
  pre-existing tests still pass (10 files), including
  `parse-csv.test.ts` and `webhook-processor.test.ts`, confirming the
  `SalesDay` FK relaxation didn't silently change either file's behavior.
  No Playwright pass yet — nothing user-facing exists until P4/P5.

**P2 — pure parser (2026-10-12):**

- **`src/lib/pos/petpooja-parse.ts`**: `parsePetpoojaPayload(raw, { now })`,
  pure/DB-free, same shape as `parse-csv.ts`. Returns a 3-way discriminated
  result — `ignored_event` (event !== `"orderdetails"`, route returns 200
  without touching the DB), `failed` (a reason string, route stores a
  `PosWebhookEvent`), or `parsed` (a fully-typed `ParsedPetpoojaOrder`).
  Money reuses `rupeesToPaise` from `parse-csv.ts` (now exported for this —
  the one cross-file change to that module) after `String(value)`-ing
  whatever Petpooja sent, number or string; `round_off` is the only field
  allowed a leading `-`. Time: `created_on`'s date part *is* the IST
  business date (no conversion needed — that string already **is** IST
  wall-clock text), so `businessDate` is a straight substring; `createdAtIst`
  is computed by treating the string as `Date.UTC(...) − 5.5h`, with a
  round-trip check that rejects an impossible calendar date/time the same
  way `parse-csv.ts`'s own `parseFlexibleDate` already does for `DD/MM/YYYY`
  overflow. `TOTAL_MISMATCH` (diff > ₹1 against the cross-check formula) sets
  a flag but never fails the parse. A `businessDate` more than 1 IST day
  ahead of an injected `now` fails outright (wrong clock). The `Customer`
  block, `comment`, `biller`, `assignee`, `token`/`Token`, `OrderItem`,
  `Tax`, `Discount` are never read into `ParsedPetpoojaOrder` at all — not
  filtered after the fact, just absent from the type, so there's nothing to
  leak.
- **Found while writing fixtures: the PDF actually has 4 sample payloads, not
  5.** Basic, Discount + Add-ons, Part Payment, Online Aggregator (Zomato) —
  that's everything in the document. Section 26's own build-order step P2
  says "five payloads (basic, discount + add-ons, part payment, Zomato, plus
  the `Token` spelling)" — reading the actual PDF, "plus the Token spelling"
  describes a property *of* the 4th payload (it's the one that spells the
  key `Token`, capital T), not a 5th distinct payload. Noted here rather than
  silently writing "5 fixtures" when there are 4; doesn't change anything
  about what got built since every distinct case (incl. the `Token` spelling)
  is still covered.
- **`src/lib/pos/petpooja-parse.test.ts`**: all 4 real payloads typed in full
  (not trimmed, except `OrderItem`/`Tax`/`Discount` arrays cut to one entry
  each since this parser never reads them) and hand-checked against the same
  cross-check arithmetic plan.md section 26 already verified
  (1158; 1267−253.4+20+0.40=1034; 987; 350+17.76+5+0.24=373) — every money
  field, `createdAtIst` down to the exact UTC instant, `partPayments`
  shape, `TOTAL_MISMATCH` boundary (exactly ₹1 off = no flag, ₹1.01 off =
  flagged, and confirmed a mismatch flags without rejecting the bill),
  Cancelled status, unrecognized status, missing restID/orderID, garbage and
  calendar-invalid `created_on`, non-numeric money, >2-decimal `round_off`,
  negative `round_off` accepted vs. negative `core_total` rejected,
  malformed `part_payments`, non-object payloads, event filtering (wrong
  event, missing event), and the future-clock boundary (today IST passes,
  exactly +1 day IST passes, +2 days IST fails) with an injected `now`. One
  explicit leak-check test asserts `JSON.stringify(parsed order)` contains
  none of: the Customer names/phone/gstin, the aggregator `Token` value, or
  the `comment` text from any of the 4 fixtures.
- **Verified**: `tsc --noEmit` clean, `eslint` clean (1 new warning,
  `_event` unused in a destructure — same intentional-underscore pattern as
  7 pre-existing warnings elsewhere in the repo, not an error), `vitest run`
  — 250/250 passing (226 pre-existing + 24 new), no regressions.

**P3 — ingestion + webhook route (2026-10-12):**

- **`src/app/api/webhooks/petpooja/route.ts`** and **`.../petpooja/[secret]/route.ts`**:
  two thin route files, not one — Next.js's app router happily serves a
  static path and a deeper dynamic path side by side, which is exactly what
  NOT DECIDED #4 ("Token vs URL secret — use both when Petpooja can send a
  token; URL secret alone if it cannot") needs: Petpooja is given whichever
  one URL actually fits them, `/api/webhooks/petpooja` or
  `/api/webhooks/petpooja/<secret>`. Both do the same three things —
  `PETPOOJA_WEBHOOK_ENABLED !== "true"` ⇒ 404 (so a dev DB never ingests a
  real bill), read the raw text body, hand off to the processor — and
  nothing else; no `proxy.ts` edit needed, confirmed again (P0's finding
  holds for the new `[secret]` path too, same blanket `/api` exclusion).
- **`src/lib/pos/webhook-processor.ts`** (`processPetpoojaWebhook`, DB-touching,
  `server-only`): same thin-route-plus-shared-processor shape as
  `src/lib/esign/webhook-processor.ts`. Order of work, exactly as the plan's
  "Webhook route rules" lists it:
  1. **Size guard** — a body over 1 MB is rejected (413) before it's ever
     parsed or touched the DB. Not explicitly asked for in section 26, but a
     public unauthenticated POST endpoint accepting an unbounded body is a
     textbook resource-exhaustion opening (CLAUDE.md security-is-not-optional
     + edge-case guidance) — a one-line guard, not scope creep.
  2. **Config check** — neither `PETPOOJA_WEBHOOK_TOKEN` nor
     `PETPOOJA_WEBHOOK_PATH_SECRET` set ⇒ 503, touches no table.
  3. **Auth** — JSON-parses the body just far enough to read `token`/`Token`
     (both spellings, NOT DECIDED #4), constant-time-compares it and/or the
     URL's `secret` segment against the two env vars, using the same
     length-check-then-`timingSafeEqual` pattern already used twice in
     `src/lib/esign/{mock,leegality}-provider.ts` (not reimplemented, copied).
     Failure ⇒ 401, `REJECTED_AUTH`, **no payload, no restId** — and
     rate-limited: at most one `PosWebhookEvent` row per rolling 60-second
     window regardless of how many bad requests arrive, satisfying rule 2's
     "so an attacker cannot fill the table" without standing up any new
     infrastructure (Redis, etc.) — it's one extra indexed read against the
     `@@index([outcome, receivedAt])` index P1 already added, checking
     whether the most recent `REJECTED_AUTH` row is younger than 60s.
  4. **Malformed body** (auth passed but the body wasn't valid JSON) ⇒ 400,
     `FAILED`, no payload (there's nothing safe or useful to store).
  5. **Parse** via `parsePetpoojaPayload` (P2) — `ignored_event` ⇒ 200,
     nothing stored; `failed` ⇒ 400, `FAILED` with a **scrubbed** payload.
  6. **Outlet lookup** — `FranchiseProject.petpoojaRestId` — no match ⇒ 200,
     `IGNORED_UNKNOWN_OUTLET` with a scrubbed payload and the `restId` (so
     `/admin/pos`, in P4, can show it and offer to map it).
  7. **Ingest** (one `$transaction`): upsert `PosOrder` on
     `restId_orderId` (Prisma's own compound-unique name, not a custom one);
     `revision` only increments when `hasOrderChanged` finds an actual
     difference across every stored column (so a byte-identical resend is a
     true no-op on that counter) — then recompute `SalesDay` for the bill's
     `businessDate` via one indexed `aggregate()` (`Σ coreTotal`,
     `Σ (coreTotal − discountTotal)`, `count`) over `SUCCESS` rows only,
     never loading rows into memory (rule: "one indexed aggregate query per
     bill is fine… do not load all orders into memory" — the
     `@@index([projectId, businessDate, status])` from P1 is exactly what
     this query hits). Three early-outs before that aggregate ever runs:
     `posLiveFrom` unset, the bill's day is before `posLiveFrom`, or that
     `SalesDay` row is `isPinned` — all three leave the `PosOrder` row
     written but `SalesDay` untouched, per the plan's own wording for each
     case. One addition beyond the literal spec: if a resend's parsed
     `businessDate` itself differs from what's already stored (a corrected
     `created_on`), the *old* day is recomputed too — a few lines, directly
     in service of rule 6 ("`SalesDay` must always equal a direct `SUM`… if
     the two ever disagree, the recompute is the bug"), not a hypothetical.
  8. **DB error** inside the transaction ⇒ 500, with a best-effort `FAILED`
     event logged outside the now-rolled-back transaction (same "record it
     separately since the transaction that would have logged it no longer
     exists" shape as the esign processor's own catch block).
- **Scrubbing**: `scrubPayloadForStorage` (`structuredClone` first, since the
  caller still holds the original parsed object) deletes the top-level
  `token`/`Token` and `properties.Customer`/`Tax`/`Discount`/`OrderItem` and
  `properties.Order.comment`/`biller`/`assignee` before anything is ever
  written to `PosWebhookEvent.payload` — the one place a payload is stored at
  all. `isRecord` exported from `petpooja-parse.ts` rather than re-implemented
  here.
- **Two real bugs caught by writing the tests, not by inspection — both
  fixed before moving on:**
  1. `recordRejectedAuth`'s 60-second rate-limit window compared against real
     `Date.now()` instead of the same injectable `now` clock the parser's
     future-date check already uses. Harmless in production (both are real
     wall-clock there), but it meant the rate-limit path couldn't be tested
     with a fixed clock — fixed by threading `now` through from
     `processPetpoojaWebhook`'s own `options.now ?? new Date()` into
     `recordRejectedAuth(now)` too, so the whole request uses exactly one
     clock reading, not two independent ones.
  2. My own first draft of the "resend an unchanged bill" test used
     rupee-scale numbers (`1000`) for `PosOrder.coreTotal`/`total`, which are
     integer **paise** — so it wasn't actually testing "unchanged" at all
     (100000 ≠ 1000, `hasOrderChanged` correctly said "changed", test was
     wrong, not the code). A reminder that the paise discipline has to be
     respected in test fixtures too, not just production code paths.
- **Also found while regenerating the Prisma client to check types**: this
  repo installs via pnpm, and the top-level `node_modules/.prisma/client` is
  a stale, irrelevant artifact (it's not what `@prisma/client` actually
  resolves to under pnpm's isolated layout) — the real generated client
  lives nested at
  `node_modules/.pnpm/@prisma+client@<version>_.../node_modules/.prisma/client`,
  and it *was* correctly regenerated back in P1. Cost some time double-
  checking the wrong path; noting it here so a future session doesn't repeat
  that.
- **`src/lib/pos/webhook-processor.test.ts`** (20 tests, mocked `db`/`tx`,
  same pattern as `webhook-processor.test.ts`'s own `mockDb`/`mockTx`): the
  build order's required list — duplicate bill (unchanged resend keeps
  revision, still recomputes idempotently), cancel after success (excluded
  from the `SUCCESS`-only aggregate), bill before `posLiveFrom` (and the
  `posLiveFrom: null` variant), pinned day (not overwritten, `PosOrder` still
  written), unknown outlet, wrong token, malformed body, future date — plus
  misconfigured (neither secret set), the rate-limit behaviour itself, both
  auth mechanisms individually (path secret alone, body token alone, the
  capitalized `Token` spelling), the oversized-body guard, a new bill's
  revision starting at 0, a changed resend bumping it, and a DB error during
  ingestion answering 500 with a best-effort logged event.
- **Verified**: `tsc --noEmit` clean, `eslint .` clean (same 8 warnings as
  P2's log — 7 pre-existing plus P2's own `_event` one, nothing new from P3,
  0 errors), `vitest run` — **270/270 passing** (226 pre-existing + 24 from
  P2 + 20 new from P3), no regressions. No Playwright pass yet — the route
  exists but there's still no UI pointing at it (`/admin/pos` is P4).

**P4 — `/admin/pos` page (2026-10-12):**

- **`canManagePosIntegration`** added to `permissions.ts` — flat `ADMIN`
  check (NOT DECIDED #7's default), same shape as `canManageSales`, not
  routed through `hasFullOverride`.
- **`src/app/(app)/admin/pos/page.tsx`** — the four things section 26 lists:
  1. **Outlet mapping** — every `FranchiseProject`, its `petpoojaRestId`,
     `posLiveFrom`, last bill received and bills today. The latter two are
     two `groupBy` queries (`_max: { receivedAt }`, `_count` filtered to
     today's IST date via the now-exported `istTodayKey`), not one query per
     store — the portfolio is ~70-80 stores, so this stays two queries
     regardless of N, not N+1.
  2. **Health** — outlets mapped but silent >24h (plan's own caveat kept
     verbatim: "during their trading hours is a later refinement" — not
     built), a 7-day `TOTAL_MISMATCH` count (`flags: { has: "TOTAL_MISMATCH" }`),
     and pinned days with new bills since the pin (`SalesDay.isPinned`,
     joined against a per-day count of `PosOrder.receivedAt > SalesDay.updatedAt`
     — N+1 here, but N is "how many days are currently pinned", which is
     small and rare by construction, not every store every day).
  3. **Problem events** — most recent 100 `PosWebhookEvent` rows with a
     Reprocess button wherever `payload !== null` and it hasn't already been
     reprocessed.
  4. **Webhook URL** — `${APP_URL}/api/webhooks/petpooja` in a read-only
     input (natively copyable by selecting it — didn't build a JS "Copy"
     button for this, not worth a Client Component for a one-line
     convenience), plus which of `PETPOOJA_WEBHOOK_TOKEN` /
     `PETPOOJA_WEBHOOK_PATH_SECRET` is configured. Deliberately **never
     renders the secret's actual value** — only whether each one is set —
     even though this is an Admin-only page; rendering a secret into HTML is
     a bigger exposure surface (page cache, screenshots, browser history)
     than the risk this page needs to take on, and the plan's own "never log
     the token" instinct extends naturally to "never display it" too. An
     Admin who needs the literal secret already has it in Vercel's env vars.
- **`src/lib/pos/webhook-processor.ts` refactor + additions**: extracted the
  aggregate-then-upsert half of `recomputeSalesDayForDate` into a new
  exported `aggregateAndWriteSalesDay(tx, projectId, dateValue)` with no
  guards, so both the webhook's own guarded path and the new "Unpin and
  recompute" admin action (the Pinning rule's own words: "'Unpin and
  recompute' is an Admin action") share the real aggregate logic instead of
  a second copy of it. Added `reprocessStoredEvent(eventId, reprocessedById,
  options)`: re-parses a stored event's already-scrubbed payload (the fields
  scrubbing removes — `Customer`, `comment`, the token — were never read by
  `parsePetpoojaPayload` in the first place, so nothing is lost) and runs it
  through the same outlet-lookup + `ingestParsedOrder` the real webhook uses,
  skipping auth entirely since this is an already-permission-checked Admin
  action, not an inbound request. Stamps `reprocessedAt`/`reprocessedById` on
  success.
- **`src/app/(app)/admin/pos/actions.ts`**: `updateOutletMapping` (lower-cases
  + trims `petpoojaRestId`, catches the `@@unique` constraint as a friendly
  "already mapped to another project" error per the plan's own instruction,
  not a raw Prisma error), `reprocessEvent` (thin wrapper around
  `reprocessStoredEvent`), `unpinSalesDay` (flips `isPinned` and calls
  `aggregateAndWriteSalesDay` in the same transaction). All three write a
  real `AuditEvent` with the actual Admin as actor — decision 7's explicit
  list of human actions that *do* get audited ("map an outlet, set go-live
  date, … retry a failed event") — unlike the webhook's own automatic
  per-bill writes, which still get none.
- **Sidebar**: one "POS" entry added to the Admin-only `.concat(...)` block
  in `app-sidebar.tsx`, same place "E-sign Events" and "Email Templates"
  already live.
- **Browser-checked, not just type-checked** (CLAUDE.md: UI changes need an
  actual look, not just `tsc`): started `next dev`, logged in as the seeded
  Admin (`tech@fraterniti.co.in`) and the seeded `SALES` user via raw HTTP
  (no browser available in this environment, so a cookie-jar `curl` session
  simulating the no-JS server-action form-submit protocol stood in for one).
  Caught and fixed one real bug this way before calling it done: the
  Webhook-URL `<Input readOnly ... onFocus={...}>` passed an inline event
  handler from this Server Component page into a Client Component prop,
  which Next.js rejects outright (`Error: Event handlers cannot be passed to
  Client Component props`) — the page 500'd. Fixed by dropping the
  `onFocus`-select convenience entirely (a plain `readOnly` input is already
  copyable by selecting it; not worth a wrapping Client Component for this).
  After the fix: `/admin/pos` returns 200 for the Admin and renders all four
  sections against the real (near-empty) local dev DB — 2 seeded projects,
  both correctly shown "not mapped", zero problem events, zero pinned days;
  `/admin/pos` returns a 307 to `/dashboard` for the `SALES` user, confirming
  `canManagePosIntegration` actually gates the page and not just the
  sidebar link. **Not verified this way**: the three dialogs/buttons
  (`OutletMappingDialog`, `ReprocessButton`, `UnpinButton`) — they're Client
  Components whose `useActionState`-bound submissions use the fetch-based
  RSC action protocol, not the plain no-JS form fallback the login page
  happened to use, so a JS-less `curl` session can't drive them. Saying so
  plainly rather than claiming full coverage: their actual click-through
  behavior is exactly what P6's Playwright pass (real browser, real role
  logins) is the designed place to verify, and that step hasn't run yet.
- **Verified**: `tsc --noEmit` clean, `eslint .` clean (same 8 pre-existing
  warnings, 0 new, 0 errors), `vitest run` — still 270/270 (no new unit tests
  this step — `/admin/pos` is a server-rendered list/dialog page, same "no
  dedicated test file" precedent as `/admin/esign-events`'s own page.tsx).

**P5 — `/sales` small additions + pin on manual/CSV edit (2026-10-12):**

- **`src/app/(app)/sales/page.tsx`**, three additions, nothing else about the
  page changed:
  1. **"Live from POS · last bill hh:mm"** — a one-line banner (green dot +
     text) shown whenever this project has a `petpoojaRestId` *and* at least
     one `PosOrder` has ever arrived (`db.posOrder.findFirst`, only queried
     at all when `petpoojaRestId` is set, to avoid the extra query for every
     non-mapped store). "Last bill" is the most recent bill this store has
     *ever* received, not scoped to whichever day is on screen — read
     literally from the plan's own wording, which describes one banner, not
     a per-row timestamp.
  2. **Gross/Net help text** — one `<p>` under the period cards, in plain
     language (no section-number references — this is user-facing, not a
     code comment): "Gross = core bill total before discount. Net = core
     total minus discount. AOV = net ÷ orders." plus an italicized
     "unconfirmed against a real POS report" caveat, per NOT DECIDED #1.
  3. **Pinned-day marker** — a small amber "Pinned" badge next to the date in
     the Recent Days table wherever `row.isPinned` is true (the query already
     selects every column, so no query change was needed for this one).
- **Pin-on-write**: `isPinned: true` added to both the `create` and `update`
  branches of `upsertSalesDay` (`sales/actions.ts`) and `confirmSalesImport`
  (`sales/import/actions.ts`). Deliberately unconditional — not "only if this
  day was previously an API day" — because pinning a day the webhook was
  never going to touch anyway (no outlet mapped, or before `posLiveFrom`) is
  a harmless no-op, and checking `source === "API"` first would add a branch
  for no behavioral difference. `confirmSalesImport`'s unchanged-row branch
  (`continue`s before reaching either create/update) correctly never pins a
  row that wasn't actually written — consistent with the plan's own
  "idempotent, no churn" rule for that path.
- **Browser-checked**: started `next dev`, logged in as Admin via the same
  cookie-jar `curl` session as P4. Direct-Prisma seed (a throwaway script,
  deleted immediately after — no app code imported into it, since
  `webhook-processor.ts`'s `"server-only"` import throws outside Next's own
  build/runtime, confirmed the hard way on the first attempt) gave one
  project a `petpoojaRestId`, one `PosOrder` for today, an API-sourced
  `SalesDay` for today, and a `MANUAL`-sourced pinned `SalesDay` three days
  back. `/sales?project=...` rendered all three additions correctly — "Live
  from POS · last bill 02:13 pm", the gross/net caveat text, and the amber
  "Pinned" badge — confirmed by grepping the actual response body, not just
  trusting the code. `/admin/pos` correctly showed the newly-mapped
  `tmp-demo-rest` outlet and, just as correctly, showed **no** "pinned day
  with new bills" row for the pinned day — exactly right, since the seed
  never added a bill to that specific day after its pin, so there was
  nothing to flag; a deliberately-crafted "pin, then a late bill arrives"
  fixture is P6's job, not this quick check's. All demo rows deleted and
  `petpoojaRestId`/`posLiveFrom` reset to `null` afterward, verified back to
  the pre-check state (2 projects, 0 mapped, 0 `PosOrder`, 0 pinned days)
  before moving on.
- **Process note**: force-killing the `next dev` process tree
  (`Stop-Process -Force`) after this check left `.next/dev/types/*.ts`
  truncated mid-write, which then made `tsc --noEmit` fail with syntax
  errors in Next's own generated route-typing files — not a real code
  defect. Fixed with `rm -rf .next && npx next typegen` (regenerates those
  files cleanly without a full `next build`). Noting this so a future
  session recognizes the symptom (`.next/dev/types/routes.d.ts` syntax
  errors right after a dev-server session) instead of chasing it as a real
  TypeScript bug.
- **Verified**: `tsc --noEmit` clean (after the typegen fix above), `eslint .`
  clean (same 8 pre-existing warnings, 0 new, 0 errors), `vitest run` — still
  **270/270** (no new unit tests this step — `upsertSalesDay`/
  `confirmSalesImport` are server actions with no existing dedicated test
  file to extend, same precedent as P4).

**P6 — local end-to-end (2026-10-12):**

- **`scripts/tmp-send-petpooja-sample.ts`** — kept permanently (same
  precedent as `tmp-e2e-sales.ts`, `tmp-e2e-onboarding.ts`: "tmp-" in the
  name, not actually temporary — real dev tooling, not run in CI). A real
  HTTP sender against a *running* `next dev`, not a mock. Documented
  precondition in its own header: `.env` needs `PETPOOJA_WEBHOOK_ENABLED=
  "true"` and a non-empty `PETPOOJA_WEBHOOK_TOKEN`, `next dev` restarted
  after editing `.env`.
- **Part A — shape fidelity**: four payloads matching the PDF's four
  documented variants (basic; discount + round-off; part payment; aggregator
  with the capitalized `Token` key) sent to the real route, each verified as
  exactly one correctly-mapped `PosOrder` row by direct DB read — the same
  field mappings P2's unit tests already proved at the pure-parser level,
  now proved again through the real HTTP route + auth + DB write.
- **Part B — synthetic batch, ~200 bills over 3 real (safely-past) days**:
  every cause -> effect rule from the "Webhook route rules" section, each
  checked against an **independently hand-computed** expected total (built
  up in the script's own `Map`, never read back from the app's aggregation
  code):
  - A duplicate bill (identical payload sent twice) — `revision` stayed `0`,
    exactly one `PosOrder` row, no double-counting.
  - A cancel (Success, then resent as Cancelled only after every other bill
    for that day was already in) — dropped out of the `SUCCESS`-only
    aggregate and the hand-calc exactly.
  - A late bill — dated for the *oldest* of the three days but physically
    sent *last*, after both later days were fully processed — still landed
    on the correct day's `SalesDay`, proving recompute doesn't care about
    arrival order, only `businessDate`.
  - A leak-check bill carrying a full `Customer` block, `comment`, and the
    real token value — checked **across the whole database**, not just this
    project's rows (`PosWebhookEvent` has no project scope at all): none of
    the customer's name, phone, comment text, or the token string appear
    anywhere in any `PosOrder` or `PosWebhookEvent` row. Zero
    `PosWebhookEvent` rows were created at all (every one of the ~200 bills
    ingested cleanly — no FAILED/IGNORED_UNKNOWN_OUTLET noise).
  - `SalesDay.grossSales`/`netSales`/`orders`/`source` for all three days
    matched the hand-calc exactly, read directly from the DB (not the UI).
- **Real browser, real role logins** (Playwright, `chromium.launch()` driven
  directly — same pattern as `tmp-e2e-sales.ts`, not the Playwright test
  runner): logged in as the real seeded Admin, confirmed `/sales` shows the
  "Live from POS" banner and the exact hand-calculated gross figure for each
  of the three days in the Recent Days table; confirmed `/admin/pos` is
  reachable (200) and lists the throwaway `restID`. Logged out, logged in as
  a fresh throwaway `FRANCHISEE` (direct Prisma insert, same "dedicated
  throwaway user, not a shared seed account" precedent as `tmp-e2e-sales.ts`
  — a seed account could carry unrelated onboarding-redirect state from
  other e2e scripts): confirmed they land on their own store with the same
  hand-calc'd number, confirmed a direct URL to a *different* real project's
  `/sales` 404s (**franchisee of store A cannot see store B**, the literal
  ask), and confirmed `/admin/pos` bounces them away entirely (**refused to
  non-Admins**, the literal ask).
- **Every artifact deleted afterward**, in a `finally` that runs regardless
  of where an earlier check failed (the exact discipline `tmp-e2e-sales.ts`'s
  own module comment describes adopting after a real leftover-data
  incident): the throwaway project (cascades its `PosOrder` and `SalesDay`
  rows via the existing `onDelete: Cascade` FKs), the throwaway franchisee
  user, and an explicit safety-net delete of any `PosWebhookEvent` row for
  the test `restID` (not expected to exist, since the DB check above already
  confirmed zero — belt and suspenders). The script's own final checks
  re-query the DB after cleanup and assert all four are gone.
- **First full run: 56/56 checks passed**, no failures to debug.
- **Found and fixed a real, unrelated test-fragility bug this step
  surfaced**: setting `PETPOOJA_WEBHOOK_TOKEN` in the local `.env` (this
  step's own precondition) broke an *existing* P3 unit test —
  "answers 503 … when neither secret is configured" — because that test
  called `vi.unstubAllEnvs()` expecting it to reveal an *unset* env var, but
  unstubbing only reverts to whatever the real `.env` on the machine actually
  contains, which was no longer empty. Fixed by stubbing both vars to an
  explicit empty string instead of unstubbing — deterministic regardless of
  whatever happens to be in any given machine's `.env`. This was a latent
  bug in the P3 test from the day it was written, just not yet triggered;
  worth knowing about since the same `.env`-dependent-unstub pattern could
  bite again elsewhere.
- **`.env`**: `PETPOOJA_WEBHOOK_TOKEN`/`PETPOOJA_WEBHOOK_PATH_SECRET`/
  `PETPOOJA_WEBHOOK_ENABLED` added locally (gitignored, never committed) so
  this script has something to run against; `ENABLED` reverted to `"false"`
  immediately after the verification run, preserving the documented
  off-by-default posture for this machine's ordinary `next dev` use.
- **Verified**: `tsc --noEmit` clean, `eslint .` clean (same 8 pre-existing
  warnings, 0 new, 0 errors — including the new script itself), `vitest run`
  — **270/270** (after the one test fix above; no new unit tests added by
  this step itself, which is an e2e script, not a unit-testable module).

**P7 — go-live checklist, human-gated (2026-10-12):**

All code for section 26 is now built, tested (`vitest` 270/270, `tsc`,
`eslint` clean) and verified end-to-end on synthetic data (P6). Per the
build order, this step is not code — it is the human-intervention list
(items 1-7 above) printed as an actionable checklist for Apoorv/Sushant ji,
with the exact Vercel env var names for item 3. Presented in chat,
2026-10-12. Nothing in this step contacted Petpooja, touched Vercel, or
enabled any real outlet — none of that is Claude Code's to do.

Definition of done's own caveat still holds and is repeated here on purpose:
**synthetic success (P6) is not production sign-off.** Real Petpooja
payloads may differ from the PDF's documented samples in ways no amount of
synthetic testing can anticipate, and only the pilot outlet's comparison
against the POS's own daily report (human item 4) actually proves the
numbers are right. The next concrete step after this is Apoorv reading the
checklist and starting with human item 1 (the cost/contract question) —
there is nothing further for Claude Code to build until an outlet is
actually mapped and live, at which point helping compare the pilot day's
POS report against `/sales` is the next real task.

---

