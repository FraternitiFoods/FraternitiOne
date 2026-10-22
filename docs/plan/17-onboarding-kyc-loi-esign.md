## 17. Franchise onboarding, KYC, payment proof and LOI e-sign (added 2026-09-25)

**Source:** `Fraterniti_One_Phase1_Onboarding_LOI_SRD.pdf` v1.0 (handoff for
Apur, 25 Sept 2026). Requirement IDs **P1-01 … P1-10** below are that
document's IDs. **Sir's instruction: build this inside Fraterniti One. No
separate web app, no second database, no second login.** Same Next.js app,
same Postgres, same B2 bucket, same session auth, same Resend account.

### Mental model (read this first)

```
BEFORE this section        NEW (section 17)                              EXISTING (sections 1-16)
─────────────────          ───────────────────────────────────────────   ───────────────────────────
Sushant makes the    →     StoreOnboarding record (F1-0001)         →    FranchiseProject
Workspace email            + franchisee User (role FRANCHISEE)            (created ONLY at LOI Complete)
(outside the app)          + KYC files + payment proof                    + ~963 seeded Tasks
                           + 2 reviewers (KYC, Accounts)                  + Document vault, Audit,
                           + LOI PDF (versioned, hashed)                    dashboards, /boq, /m ...
                           + Aadhaar e-sign x2 (franchisee, then company)
```

One-line cause → effect chain:

`Admin creates onboarding` → `franchisee gets invite link, sets password` →
`uploads KYC + receipt` → `KYC reviewer accepts` **and** `Accounts accepts` →
`franchisee e-sign button unlocks` → `provider webhook says signed` →
`company signatory button unlocks` → `provider webhook says signed` →
`LOI COMPLETE` → `FranchiseProject is created from the same record` → the
existing lifecycle takes over.

Why a **separate `StoreOnboarding` table** and not a `FranchiseProject` from
day one: creating a `FranchiseProject` seeds ~963 tasks (section 9) and puts
the store on dashboards / Action Centre. A store that never signs would
pollute all of that. So the project is created only when the LOI completes.
The Project ID is **reserved** on the onboarding record on day one and reused,
so there is never a duplicate (SRD section 1).

### Decisions (confirmed by Apoorv, 2026-09-25)

1. **Inside Fraterniti One** — new routes/tables in the existing app.
2. **Separate `StoreOnboarding` table**, `FranchiseProject` created at LOI
   Complete using the reserved Project ID. Existing projects/users are not
   touched or migrated (Bengaluru and Ashok Vihar keep their 963 tasks each).
3. **E-sign provider: adapter + mock first.** Build a provider-agnostic
   `EsignProvider` interface and a `mock` provider that exercises the whole
   flow locally. The real vendor is a later drop-in
   adapter; nothing outside `src/lib/esign/` may know the vendor.
4. **Four new roles:** `KYC_REVIEWER`, `ACCOUNTS`, `LOI_PREPARER`,
   `COMPANY_SIGNATORY`. Existing `SALES`, `ADMIN`, `FRANCHISEE` are reused.
   (Check the current `Role` enum first; add only what is missing.)
5. **LOI template: placeholder for now.** Build the template engine and the
   variable fields; ship a clearly-marked placeholder template. The approved
   text is swapped in later without code changes.

### What is reused vs new

Reused as-is: `User` + session auth, `/users/new` and the
`PasswordResetToken` invite flow (purpose `INVITE`, 7-day expiry), Resend
mailer, `src/lib/storage.ts` (B2, presigned PUT, signed downloads),
`writeAuditEvent`, `permissions.ts` pattern, `proxy.ts` route gating, the
`Document` vault (only at the very end, to file the signed LOI under the new
project), the sidebar/shell and Tailwind + shadcn/ui look.

New:
- Tables: `StoreOnboarding`, `OnboardingFile`, `KycSubmission`,
  `PaymentSubmission`, `LoiTemplate`, `LoiVersion`, `EsignAttempt`,
  `EsignEvent`, `EmailTemplate`, `NotificationLog`.
- Roles above + permission functions.
- Routes (below), the e-sign adapter, webhook route, LOI PDF generator,
  malware-scan hook, review queues.

**Do not put onboarding files in the `Document` table.** `Document` requires a
`project_id`, is visible to department roles through the existing matrix, and
the project does not exist yet. KYC files (especially Aadhaar) need a much
tighter access rule than the vault. Use `OnboardingFile` with its own B2 key
prefix `onboarding/{onboardingId}/...`.

### Data model (new entities)

Field lists are the SRD section 4 minimum; add indexes/constraints as
needed. Money is stored as integer paise (or Prisma `Decimal`), never float.

- **`StoreOnboarding`**: `id` (human ID like `F1-0001`, sequential, unique),
  `reservedProjectId` (unique; generated on create — inspect how
  `FranchiseProject.id` is generated today and pre-generate the same kind of
  value), `brand`, `format`, `proposedLocation`, `legalApplicantName`,
  `entityType` (`INDIVIDUAL` | `COMPANY`), `contactPhone`,
  `workspaceEmail` (**unique**, lower-cased, the canonical email),
  `franchiseeUserId` (**unique**, FK `User`), `salesOwnerId` (FK `User`),
  `accountStatus`, `onboardingStatus`, `kycStatus`, `paymentStatus`,
  `expectedAmount` (from LOI fee), `currentLoiVersionId`, `projectId`
  (nullable **unique**, set on conversion), timestamps.
  Hard rule (P1-01): one Workspace email = one store = one franchisee user.
  Enforce with DB unique constraints **and** a friendly error message.
- **`OnboardingFile`**: `onboardingId`, `kind` (`PAN`, `AADHAAR`,
  `COMPANY_DOC`, `SIGNATORY_PROOF`, `PAYMENT_RECEIPT`), `version`,
  `supersedesId`, `b2Key`, `fileName`, `mimeType`, `sizeBytes`, `sha256`,
  `scanStatus` (`PENDING` | `CLEAN` | `INFECTED` | `ERROR`), `uploadedById`.
  Version history like the vault: a re-upload supersedes, never deletes.
- **`KycSubmission`**: `onboardingId`, `panNumber`, `panName`,
  `aadhaarHolderName`, `aadhaarLast4` (**only** 4 digits — never the full
  number, never OTP/biometric), company fields when `COMPANY`,
  `authorisedSignatoryName`, `status` (`MISSING` | `SUBMITTED` |
  `CHANGES_REQUESTED` | `ACCEPTED`), `reviewerId`, `decisionReason`,
  `decidedAt`. PAN number is stored encrypted at app level (AES-GCM, key in
  env) and shown in full only to KYC_REVIEWER/ADMIN.
- **`PaymentSubmission`**: `onboardingId`, `declaredAmount`, `paymentDate`,
  `mode`, `utr`, `receiptFileId`, `status` (same four review statuses),
  `verifiedAmount`, `verifiedDate`, `bankReference`, `accountsActorId`,
  `decisionReason`, `flags` (`DUPLICATE_UTR`, `AMOUNT_MISMATCH`). A
  resubmission creates a new row; history is kept.
- **`LoiTemplate`**: `id`, `version`, `name`, `body` (with `{{variables}}`),
  `requiredFields` (JSON), `isApproved`, `isPlaceholder`.
- **`LoiVersion`**: `onboardingId`, `versionNo` (1.0, 1.1 …), `templateId`,
  `templateVersion`, `values` (JSON snapshot: parties, brand, location, fee,
  territory, commercial terms), `pdfB2Key`, `pdfSha256` (**immutable**),
  `status` (`DRAFT` | `RELEASED` | `SENT_FOR_SIGNING` | `FRANCHISE_SIGNED` |
  `SIGNED` | `VOID`), `generatedAt`, `releasedById`, `signedPdfB2Key`,
  `certificateB2Key`.
- **`EsignAttempt`**: `loiVersionId`, `signerRole` (`FRANCHISEE` |
  `COMPANY`), `attemptNo`, `provider`, `providerEnvelopeId`, `pdfSha256`
  (hash sent), `status` (`NOT_STARTED` | `SENT` | `IN_PROGRESS` |
  `COMPLETED` | `FAILED` | `EXPIRED` | `CANCELLED`), `signerUserId`,
  timestamps. A failed/expired attempt can be restarted as attempt n+1.
- **`EsignEvent`**: raw webhook/reconcile log: `provider`, `providerEventId`
  (**unique with provider** → idempotency), `envelopeId`, `payload`,
  `signatureValid`, `processingStatus` (`RECEIVED` | `PROCESSED` | `FAILED` |
  `IGNORED_LATE`), `error`, `receivedAt`.
- **`EmailTemplate`**: `key`, `subject`, `body`, `enabled`. **`NotificationLog`**:
  `templateKey`, `to`, `onboardingId`, `status`, `error`, `sentAt`.
- **Audit:** `AuditEvent` currently hangs off `project_id`, which does not
  exist during onboarding. Make `projectId` nullable and add a nullable
  `onboardingId`; require at least one. The project page's audit view must
  show events where `projectId = X` **or** `onboardingId` = that project's
  onboarding. `actorEmail` stays required; system actors use
  `system:esign`, `system:scanner`.

### State machines (server-side, one module, unit-tested)

Put every transition in `src/lib/onboarding/state.ts`. UI never sets a status
directly; actions call `transition(onboarding, event, actor)` which checks the
allowed-from state and writes the `AuditEvent`.

- **Account:** `INVITED → ACTIVE → SUSPENDED` (and back to `ACTIVE`).
- **Onboarding:** `AWAITING_KYC_PAYMENT → UNDER_REVIEW →
  (CORRECTIONS_REQUESTED | READY_FOR_SIGNATURE) → FRANCHISE_SIGNED →
  LOI_COMPLETE`. `CORRECTIONS_REQUESTED → UNDER_REVIEW` on resubmission.
  `READY_FOR_SIGNATURE` is derived: `kyc ACCEPTED && payment ACCEPTED &&
  LOI released`.
- **KYC and Payment review (independent):** `MISSING → SUBMITTED →
  (CHANGES_REQUESTED | ACCEPTED)`; `CHANGES_REQUESTED → SUBMITTED`.
- **E-sign attempt:** `NOT_STARTED → SENT → IN_PROGRESS → COMPLETED`, or
  `FAILED` / `EXPIRED` / `CANCELLED`.

Gate functions (single source of truth, used by UI **and** server actions):
- `canFranchiseSign(o)` = kyc ACCEPTED ∧ payment ACCEPTED ∧
  `verifiedAmount ≥ expectedAmount` ∧ current LOI RELEASED ∧ no open attempt.
- `canCompanySign(o)` = latest FRANCHISEE attempt COMPLETED on the **same**
  `loiVersionId` and `pdfSha256` ∧ actor role `COMPANY_SIGNATORY`.
- Rejected KYC or payment reopens **only the affected upload**; the other
  stays untouched.

### Roles and permissions (SRD section 3)

| Role | Can | Cannot |
|---|---|---|
| `FRANCHISEE` | own onboarding only: update draft, upload/re-upload requested files, see KYC/payment status + reasons, preview LOI, trigger own e-sign when `canFranchiseSign`, download final | see any other store; see internal notes |
| `SALES` | create/record intake and Workspace email, request provisioning, view progress | accept payment, company-sign, review KYC |
| `ADMIN` | create/disable accounts, map Workspace email, assign roles + signatory, manage template version, see e-sign failures, retry/reconcile | accept payment implicitly (needs `ACCOUNTS`) |
| `KYC_REVIEWER` | accept/reject/request resubmission with reason; open restricted identity files | payment decisions |
| `ACCOUNTS` | review receipt vs bank/ledger, accept/reject/request clarification, capture verification reference | approve a receipt **they uploaded** (no self-approval) |
| `LOI_PREPARER` | generate/verify commercial values, release LOI preview | edit a version already sent for signing |
| `COMPANY_SIGNATORY` | view final version, e-sign **only after** franchisee | sign before franchisee |

`MANAGEMENT`'s existing `hasFullOverride` must **not** grant any of the
above. Add explicit functions in `permissions.ts`: `canReviewKyc`,
`canReviewPayment`, `canPrepareLoi`, `canCompanySign`,
`canCreateOnboarding`, `canViewOnboarding(user, onboarding)`. A user may hold
one role; if the same person must do two jobs in a small team, that is an Admin
decision using two accounts, not an override.

### Routes

Franchisee (sidebar exactly as wireframes 01-07: Overview, KYC & documents,
Payment, LOI & e-sign, Help):
- `/onboarding` — home (wireframe 03): progress pills, next action.
- `/onboarding/documents` — submit documents (wireframe 04).
- `/onboarding/loi` — LOI preview + "Proceed to Aadhaar e-sign" (wireframe 06).

Internal:
- `/store-onboarding` list, `/store-onboarding/new` (wireframe 01),
  `/store-onboarding/[id]` detail with timeline + audit.
- `/reviews` queues: KYC, Payment, LOI prep (wireframe 05) — one page, three
  tabs, each visible only to the matching role.
- `/signing` — company signatory queue + `/signing/[id]` (wireframe 07).
- `/admin/esign-events` — webhook log, retry, reconcile (P1-10).
- `/admin/email-templates` — edit subject/body per event.
- `POST /api/webhooks/esign` — provider callback (public route, but
  signature-verified).
- Extend the existing signed-download Route Handler for `OnboardingFile`,
  `LoiVersion` PDFs and certificates (authorise on **every** request).

Login and redirects:
- Existing `/login` stays the login for email + password. After login a
  `FRANCHISEE` **with** a non-complete `StoreOnboarding` goes to
  `/onboarding`; a `FRANCHISEE` without one (existing seeded/real users) keeps
  today's behaviour. **Do not regress existing franchisee/project flows.**
- `canViewProject` currently special-cases `FRANCHISEE`; onboarding needs its
  own `canViewOnboarding` check (`franchiseeUserId === user.id`). Direct URL or
  server-action access to another store returns the same `notFound()` as a
  missing record (P1-03).
- Add `proxy.ts` rules for the new routes, same pattern as `/m`.
- Email + password login needs **rate limiting and lockout** (P1-02). Reuse
  the mobile PIN pattern (5 failures → 15 min lock, reset on success, Admin
  reset clears it) if the web login does not already have one — check first.

### Behaviour that must hold (cause → effect)

1. **P1-01** Duplicate Workspace email, duplicate store, or a second user on
   the same store → blocked with a clear message, no partial records.
2. **P1-02** Passwords are never shown to staff or stored in plain text. Only
   the one-time invite/reset link (expires). The Admin screen never displays
   a password or the link itself.
3. **P1-03** Franchisee reaches only its own onboarding by UI, URL, server
   action or API.
4. **P1-04** Uploads: PDF/JPG/PNG only, server-checked size and MIME **and
   magic bytes**, KYC files ≤ 10 MB (receipts ≤ 10 MB), malware scan, version
   history. Aadhaar shows only last 4 digits everywhere except the KYC
   reviewer's file view; every open of an Aadhaar file writes an
   `AuditEvent`. Files stay unreadable to reviewers until `scanStatus =
   CLEAN`.
5. **P1-05** A receipt upload only *creates a review item*. Only an `ACCOUNTS`
   decision changes `paymentStatus`. Duplicate UTR (across all onboardings)
   and declared-vs-verified mismatch are flagged on the review item. The
   uploader cannot decide their own item.
6. **P1-06** LOI generates only from an approved template (or the placeholder,
   see below), every required field validated, PDF `sha256` stored, release
   needs `LOI_PREPARER`.
7. **P1-07** Franchise e-sign button is disabled in the UI **and** rejected
   server-side unless `canFranchiseSign`. No local "I agree" checkbox may
   substitute for provider confirmation. Completion only from a verified
   provider callback/reconcile.
8. **P1-08** Company sign only on the same version + hash after the franchisee
   completed. Signed PDF and certificate appear only after **both** complete.
9. **P1-09** Audit rows for: invitation, login/reset, file upload + version,
   review decision, LOI generate/release/void, e-sign send/callback/complete,
   conversion, reconcile. Actor + time + version on each.
10. **P1-10** Franchise home and internal queues always show status + next
    action. A failed callback is stored, visible to Admin, and retryable.
11. **Changed terms after signing started:** LOI preparer edits → new
    `LoiVersion` (1.1), old envelope `VOID` via provider, both signers sign the
    new version. Old signed copies are **never overwritten**.
12. **Fee changes after payment accepted:** if `expectedAmount` rises above
    `verifiedAmount`, `paymentStatus` drops back to `SUBMITTED` for Accounts
    to re-confirm and e-sign disables again.
13. **Reject reason is mandatory** whenever a reviewer requests changes or
    rejects. Franchisee sees the reason.
14. **Failure of email/notification never fails the business action.** Log to
    `NotificationLog` and continue.

### E-sign adapter (the tricky part)

`src/lib/esign/provider.ts`:

```ts
interface EsignProvider {
  createEnvelope(i: { attemptId: string; signer: {name: string; email: string; phone?: string; role: 'FRANCHISEE'|'COMPANY'};
                      pdf: Buffer; pdfSha256: string; authMode: 'AADHAAR_ESIGN' | string }): Promise<{ envelopeId: string; signingUrl: string }>;
  getStatus(envelopeId: string): Promise<{ status: 'SENT'|'IN_PROGRESS'|'COMPLETED'|'FAILED'|'EXPIRED'|'CANCELLED'; documentSha256?: string }>;
  voidEnvelope(envelopeId: string): Promise<void>;
  parseAndVerifyWebhook(rawBody: string, headers: Headers): Promise<{ eventId: string; envelopeId: string; status: ...; documentSha256?: string }>; // throws if signature invalid
  fetchSignedPdf(envelopeId: string): Promise<Buffer>;
  fetchCertificate(envelopeId: string): Promise<Buffer>;
}
```

- `ESIGN_PROVIDER=mock` (default in dev) → `MockProvider`. It serves a fake
  signing page at `/dev/mock-esign/[envelopeId]` with "Complete" / "Fail" /
  "Expire" buttons that POST a **HMAC-signed** webhook to our own route, so the
  real webhook code is exercised. Mock can also fire the same event twice and
  a late event, to test idempotency.
- **Safety:** if `NODE_ENV=production` and provider is `mock`, refuse to
  start e-sign and show Admin an error. Mock signatures have no legal value.
  A mock-signed LOI must be watermarked "TEST SIGNATURE" and never counted as
  production sign-off.
- Real vendor later = one new file implementing the interface + env vars.
  Company signer auth mode is configurable (`COMPANY_SIGN_MODE`, default
  `AADHAAR_ESIGN`) because the SRD leaves it open.
- **Webhook route rules:** read the raw body; verify signature first; look up
  attempt by `envelopeId`; check that the reported/returned document hash equals
  the attempt's `pdfSha256`; insert `EsignEvent` with unique
  `(provider, providerEventId)` (duplicate → 200, no state change); if the
  attempt is already `VOID`/`CANCELLED` or a newer attempt exists → mark
  `IGNORED_LATE`; process in one DB transaction; on any error store
  `FAILED` with the message and return a retryable status. Never mark
  `COMPLETED` from an unverified payload.
- **Manual reconcile (Admin):** calls `getStatus`; marks complete **only if**
  the provider itself reports `COMPLETED` and the hash matches. Otherwise it
  records the discrepancy and changes nothing.
- Fetch the signed PDF + certificate into B2 at completion, store their
  hashes, never overwrite an existing signed copy.

### LOI engine

- `LoiTemplate` body uses `{{variables}}`: `brand`, `storeLocation`,
  `applicantLegalName`, `entityType`, `companyName`, `feeAmount`,
  `feeInWords`, `territory`, `commercialTerms`, `issueDate`, `versionNo`,
  plus mandatory-field validation before generate.
- Render to PDF with a **serverless-friendly** library (`pdf-lib` or
  `@react-pdf/renderer`). **No headless Chrome/Puppeteer** — Vercel function
  size limits (section 12). Compute `sha256` of the final bytes.
- **Placeholder template:** seed one with `isPlaceholder = true`, stamped
  "PLACEHOLDER — NOT APPROVED LEGAL TEXT" on every page. In production, block
  `RELEASED`/send-for-signing on a placeholder unless
  `ALLOW_PLACEHOLDER_LOI=true`. Admin manages template versions; only
  `isApproved` templates release without the flag.
- A released version is immutable. Any change = new version. The preparer
  cannot edit a version whose status is `SENT_FOR_SIGNING` or later.
- LOI may be generated/previewed while payment is still under review (SRD
  sequence rule). Only the **sign** step waits for the gates.

### Conversion to FranchiseProject (LOI Complete)

In **one transaction**, idempotent (skip if `StoreOnboarding.projectId`
already set):
1. Create `FranchiseProject` with `id = reservedProjectId`, brand, location,
   `franchiseeId = franchiseeUserId`, first lifecycle stage. **Call the
   existing project-creation code path** (the one that seeds tasks) rather than
   duplicating it — find it first; do not reimplement task seeding.
2. Set `StoreOnboarding.projectId`, `onboardingStatus = LOI_COMPLETE`.
3. File the signed LOI + certificate under the new project as `Document`
   rows (category Legal) pointing at the same B2 objects.
4. Write `AuditEvent`s (project CREATE, document CREATE, onboarding UPDATE).
5. From then on the franchisee sees the normal project pages. KYC files stay
   in `OnboardingFile` with restricted access.

### Emails (Resend, small fixed set)

Keys: `invitation`, `correction_request`, `payment_accepted`,
`payment_rejected`, `signing_ready`, `franchise_signed`, `company_signed`,
`loi_complete`. Seeded into `EmailTemplate`, editable by Admin, `{{vars}}`
for name/store/reason/link. Send to `workspaceEmail` unless the open
"mailbox control" item decides otherwise (then use `invitationEmail`, nullable
column, and nothing else changes). Reminder from section 5: `EMAIL_FROM` must
be on a Resend-verified domain to reach real recipients.

### Env vars (add to `.env.example`, never commit values)

`ESIGN_PROVIDER` (`mock`|vendor), `ESIGN_WEBHOOK_SECRET`,
`COMPANY_SIGN_MODE`, `ALLOW_PLACEHOLDER_LOI`, `PAN_ENCRYPTION_KEY`,
`MALWARE_SCANNER` (`basic`|`clamav`|`api`), vendor keys when known.

### Malware scan

Interface `scanFile(buffer|stream) → CLEAN | INFECTED | ERROR`. Files start
`PENDING`; nothing is reviewable until `CLEAN`. Dev/`basic` scanner: type +
magic-byte check + the EICAR test string, so the reject path is testable.
Production scanner (ClamAV service or a scanning API) is an open item; **do
not** ship a "always clean" stub silently — in production with `basic`, show
an Admin banner "malware scanning not configured".

### Build order (each step tested before the next, per section 7 step 5)

0. **Read first, change nothing:** `prisma/schema.prisma`, `permissions.ts`,
   `writeAuditEvent`, `storage.ts`, the invite/`PasswordResetToken` flow,
   `proxy.ts`, the project-creation action, how project IDs are generated, the
   current web login (lockout?). Append a short "What I found" note under this
   section. Confirm the reserved-ID approach works with the real ID type.
1. **Schema + roles + permissions + state machine.** Migration for the new
   tables, nullable `AuditEvent.projectId` + `onboardingId`, four roles,
   permission functions, `state.ts` with unit tests for every allowed and
   forbidden transition and both gate functions.
2. **Provisioning + login.** `/store-onboarding/new`, duplicate blocking
   (P1-01), reuse invite flow, web-login lockout (P1-02), franchisee redirect
   to `/onboarding`, isolation tests (P1-03).
3. **Franchisee portal + uploads.** Home, documents page, presigned upload,
   type/size/magic-byte checks, scan hook, version history, submit for review.
4. **Review queues.** KYC + Payment + LOI-prep tabs, reasons, no self-approval,
   duplicate-UTR and mismatch flags, reopen only the affected upload.
5. **LOI engine.** Template, placeholder, generate, hash, release, preview,
   versioning, fee-change rule.
6. **E-sign.** Adapter, mock provider + dev signing page, franchisee sign,
   webhook route, idempotency/late/duplicate handling, company sign, void +
   new version, reconcile, `/admin/esign-events`.
7. **Completion + conversion + final download** (transactional, idempotent).
8. **Emails + template admin, hardening, responsive mobile pass** for every new
   screen (SRD: same actions on mobile), sidebar/nav, empty/error states.
9. **End-to-end verification** in a real browser (Playwright, desktop and
   phone-sized) covering the Definition of Done below, plus negative tests.
   Delete every test artifact afterwards (test users, onboardings, files in B2)
   and confirm the real projects still have their baseline (Bengaluru and Ashok
   Vihar 963 tasks each). Log results in this section like sections 15-16.

### Definition of done (SRD section 8)

One test store completes the whole flow with **real role separation** (six
different logins): invite → password → KYC + receipt → receipt rejected with a
reason and re-uploaded (KYC untouched) → both accepted → LOI released →
franchisee signs (mock) → company signs → LOI Complete → signed PDF,
certificate and audit trail downloadable → `FranchiseProject` exists with the
reserved ID and its tasks. Then: changed LOI terms mid-signing create version
1.1 and require both signatures again; a second franchisee cannot open the
first store by URL or API; duplicate webhook is harmless; failed webhook is
visible to Admin and retryable. **Mock/sandbox success is not production
sign-off** — say so in the final report.

### NOT DECIDED YET — ask before assuming (working default in brackets)

1. **E-sign vendor, pricing, contract, sandbox** [mock provider; real adapter
   later]. Still open — `ESIGN_PROVIDER=mock` is what's wired up, watermarked
   "TEST SIGNATURE — NOT LEGALLY BINDING" on everything it produces. One
   change since this was first written: a new `ALLOW_MOCK_ESIGN_IN_PRODUCTION`
   env flag (2026-09-28, see build log below) lets mock run on the production
   deployment too, for pre-launch testing before a real vendor is live — off
   by default, must be unset again before any real franchisee signature needs
   to be enforceable.
   **2026-10-01:** briefly superseded by an SMS OTP plan (old section 19).
   **2026-10-03: resolved — Leegality, Aadhaar eSign** (section 19). The SMS OTP
   plan and its `SIGNING_METHOD` switch are dropped; this adapter is the only
   signing path again, with a real `leegality` provider beside `mock`.
2. **Approved LOI template text and variable fields** — **resolved
   2026-09-28.** `src/lib/onboarding/loi-template.ts` now ships the real,
   director-signed Tulsi LOI text verbatim (not a placeholder) —
   `isApproved: true`, `isPlaceholder: false`. See build log below.
3. **KYC document list per entity type** [INDIVIDUAL: PAN + Aadhaar.
   COMPANY: PAN + Aadhaar of signatory + certificate of incorporation +
   company PAN + board resolution / authorisation letter. Configurable in one
   file `kyc-requirements.ts`].
4. **Who is the company signatory and who approves commercial terms**
   [Admin assigns a `COMPANY_SIGNATORY` user; `LOI_PREPARER` releases].
5. **Workspace ID creation** — manual by Sushant vs Google Admin API [manual;
   Admin types the email in]. **Does the franchisee really control that
   mailbox?** [invite goes to `workspaceEmail`; `invitationEmail` column ready
   if not].
6. **Company also Aadhaar e-sign, or another approved mode** [same as
   franchisee, configurable]. **Resolved 2026-10-03: yes, Aadhaar eSign on
   Leegality** (section 19).
7. **Accounts reconciliation source; partial payments** [manual check against
   bank statement; full LOI amount required, no partial].
8. **Aadhaar retention/access policy** (legal + privacy owner) [restricted to
   KYC_REVIEWER/ADMIN, audited, no auto-delete yet]. **Real Aadhaar
   documents must not be uploaded in production until this is settled.**
9. **Production malware scanner** [basic checks + Admin warning banner].
   **Resolved 2026-10-09: real scanner is Cloudmersive Virus Scan API**
   (`MALWARE_SCANNER=api`), adapter pattern mirroring `src/lib/esign/` — see
   build log below.
10. **Official product spelling and domain** [use "Fraterniti One"].
11. **Whether foreign/NRI applicants are ever onboarded** [no; India-only, PAN
    + Aadhaar. Flag to Apur/Sushant, nothing built for it].
12. **Company sign flow shape** — one two-signer envelope vs two separate
    envelopes [two attempts, adapter hides the difference]. **Resolved
    2026-10-03: one Leegality document with two invitees in fixed order; still
    two `EsignAttempt` rows** (section 19 decision 4).

### Build log

**Step 0 — what I found (read-only, 2026-09-25):**

- **`FranchiseProject.id` is a `cuid()` string, not the human "FR-00001" code.**
  The human code is a *separate* `seq Int @unique @default(autoincrement())`,
  formatted at the application layer (`formatProjectCode`, `src/lib/format.ts`).
  So "reserve the Project ID on day one and reuse it" means: generate a plain
  unique string on `StoreOnboarding.reservedProjectId` at onboarding-create
  time (does not need to replicate Prisma's own cuid algorithm — any unique
  string works, since it's inserted explicitly, not left to `@default`), then
  at conversion pass `id: reservedProjectId` into `franchiseProject.create`.
  `StoreOnboarding.id` (the human `F1-0001` code) needs its own `seq`
  autoincrement int, same pattern as `FranchiseProject.seq`.
- **Project creation + task seeding lives in `createProject`**
  (`src/app/(app)/projects/actions.ts`) — one function that both builds the
  `FranchiseProject` row and seeds ~963 tasks (158 lifecycle checklist + ~805
  BOQ/Ops) via `createManyAndReturn`/`auditEvent.createMany`. It's a Server
  Action (reads `FormData`, calls `redirect()`), so it can't be called
  directly from the onboarding-conversion transaction. Plan: extract the
  transaction body (create project + seed both task sets + audit) into a
  plain exported function (e.g. `createProjectWithSeedTasks(tx, {...})` in a
  new shared lib) that `createProject` and the new conversion action both
  call, rather than duplicating the seeding logic (build-order step 7's own
  instruction: "do not reimplement task seeding").
- **`permissions.ts` pattern to follow**: `hasFullOverride` = `MANAGEMENT` +
  `ADMIN`; but several functions (`canManageUsers`, `canForceCompleteStage`,
  `canDeleteProject`) are deliberately narrower — `ADMIN`-only, bypassing
  `hasFullOverride` — for actions that are system-administration calls, not
  cross-department content overrides. Section 17 decision 4 ("`MANAGEMENT`'s
  override must not grant any of these powers") means every new onboarding
  permission function (`canReviewKyc`, `canReviewPayment`, `canPrepareLoi`,
  `canCompanySign`, `canCreateOnboarding`, `canViewOnboarding`) follows the
  same narrow pattern — role-list checks, no `hasFullOverride` call.
- **`writeAuditEvent`** (`src/lib/audit.ts`) already takes `projectId?:
  string | null` (nullable today, for the mobile-upload `SetNull` cascade
  case) — needs widening to accept an optional `onboardingId` too, and the
  schema's `AuditEvent.projectId` needs to stay nullable while adding a
  nullable `onboardingId` column, with app-level (not DB-level) enforcement
  that at least one is set, since Prisma has no declarative "at least one of"
  constraint.
- **`storage.ts`** already has everything section 17 needs, generically:
  `getSupervisorUploadUrl`/`buildDocumentKey` (presigned PUT pattern, reusable
  for `OnboardingFile` with a `10MB` cap instead of the mobile flow's `50MB`)
  and `getDocumentDownloadUrl` (takes any `key`/`fileName`, so it already
  works for `OnboardingFile`, `LoiVersion` PDFs and certificates without
  changes — just need onboarding-side authorization wrapping it).
- **`proxy.ts`** is pathname-prefix based (`PUBLIC_ROUTES` exact-match +
  `PUBLIC_ROUTE_PREFIXES` prefix-match, redirect target chosen by whether the
  path starts with `/m`). New public entries needed: `/api/webhooks/esign`
  (unauthenticated by design, signature-verified inside the route itself —
  same trust model as any provider webhook) and `/dev/mock-esign/` (dev-only
  signing page; the provider-safety check inside the route/page itself, not
  proxy.ts, is what actually blocks it in production per the "mock must
  refuse to run outside dev" rule).
- **No web login lockout exists today** — confirmed by reading
  `src/app/(auth)/login/actions.ts`: wrong-password and no-such-user return
  the same message, but there is no attempt counter anywhere. P1-02 needs one
  — mirroring the mobile PIN pattern already shipped (`User.pinFailedAttempts`
  / `pinLockedUntil`, 5 wrong attempts → 15 min lock, reset on success, admin
  reset clears it) with new `User.loginFailedAttempts`/`loginLockedUntil`
  columns for email+password.
- **No test runner is installed** (no `vitest`/`jest` in `package.json`).
  Section 17 build-order step 1 requires unit tests for the state machine and
  gate functions — adding `vitest` as a dev dependency (lightest-weight
  option, no config beyond a `test` script, already TypeScript-native).
- **No PDF/crypto library installed yet** — adding `pdf-lib` (serverless-safe,
  no headless Chrome, per the LOI engine's own constraint) for LOI rendering.
  PAN encryption (AES-GCM) uses Node's built-in `crypto`, no new dependency.
  Mock e-sign webhook HMAC signing likewise uses built-in `crypto`.

**Mental model (plain words):**

An onboarding record is a waiting room, not a project. `StoreOnboarding` holds
a reserved (but not yet real) Project ID and fans out to five independent
things that all have to go green before anything graduates: KYC files +
review, a payment receipt + review, an LOI document that gets versioned and
released, and two sequential e-sign attempts (franchisee, then company) tied
to that exact LOI version and its PDF hash. Nothing in this waiting room is
visible through the existing app's project pages, dashboards, or `/boq` —
those all key off `FranchiseProject`, which doesn't exist yet. The state
machine (`src/lib/onboarding/state.ts`) is the only thing allowed to move any
of these five tracks forward; every UI button and every server action calls
the same gate functions it exports, so there is exactly one place that knows
"is franchisee-sign allowed right now" — not a UI check here and a server
check there that could drift apart. The moment all five tracks are green
(KYC accepted, payment accepted with a high-enough verified amount, LOI
released, franchisee signed, company signed), one transaction promotes the
onboarding into a real `FranchiseProject` using the already-reserved ID and
the existing task-seeding code path — at that instant the store starts
existing for every other part of the app (dashboard, `/boq`, Action Centre,
`/m`) exactly the way Bengaluru and Ashok Vihar already do, and the onboarding
record becomes a historical artifact (KYC files stay restricted, not moved
into the vault). Money changing after the fact (fee raised) or terms changing
after signing started (new LOI version) both work the same way: they don't
mutate history, they re-open exactly the one gate that's now stale and leave
everything already completed (old signed PDFs, prior review decisions)
untouched and re-fetchable.

**Steps 1-8 — shipped, logged retroactively (2026-09-29).** This entry is a
reconstruction, same as sections 12/13 — the commits below landed without a
build-log write-up at the time, which is exactly the gap section 13's own
"process note" flagged and asked not to repeat. Reconstructed from
`prisma/schema.prisma`, `permissions.ts`, and every file under
`src/lib/onboarding/`, `src/app/onboarding/`, `src/app/(app)/store-onboarding/`,
`src/app/(app)/reviews/`, `src/app/(app)/signing/`, `src/lib/esign/`, and
`src/app/api/webhooks/esign/` — not from a fresh verification pass, so **no
claim below should be read as "click-tested this session."**

Commits covered: `b710c83` "loi signoff flow" (2026-09-26, the commit that
also wrote this section's build order/Definition of Done/NOT DECIDED YET
above — it shipped the code for steps 1-8 in the same commit but never logged
the results), `727d9b9` "loi template" (2026-09-28), `61557a7` "esign mock
flow" (2026-09-28), `4691e70` "company sign mock flow" (2026-09-28).

- **Step 1 (schema + roles + permissions + state machine) — done.** Migration
  in `b710c83` adds every enum/model this section's data model called for
  (`StoreOnboarding`, `KycSubmission`, `PaymentSubmission`, `OnboardingFile`,
  `LoiVersion`, `LoiTemplate`, `EsignAttempt`, `EsignProcessingEvent`,
  `NotificationLog`, `EmailTemplate`) plus the three new roles
  (`KYC_REVIEWER`, `LOI_PREPARER`, `COMPANY_SIGNATORY`) and
  `AuditEvent.onboardingId` (nullable, alongside the existing nullable
  `projectId`, app-level "at least one" enforcement per step 0's own note).
  `permissions.ts` gates every new action with its own narrow, role-list-only
  function (`canCreateOnboarding`, `canReviewKyc`, `canReviewPayment`,
  `canPrepareLoi`, `canCompanySign`, `canViewOnboarding`) — none routed
  through `hasFullOverride`, matching decision 4. `src/lib/onboarding/state.ts`
  implements all five state machines (Account, Review, LoiVersion,
  EsignAttempt, plus the derived `OnboardingStatus`) and both sign-gate
  functions (`canFranchiseeSignNow`, `canCompanySignNow`) as pure functions,
  with unit tests in `state.test.ts` (extended again in `4691e70`, see below).
- **Step 2 (provisioning + login) — done.** `/store-onboarding/new` →
  `createOnboarding` (`store-onboarding/actions.ts`) enforces P1-01 (one
  Workspace email = one store = one franchisee user) by checking both
  `StoreOnboarding.workspaceEmail` and `User.email` for a collision before
  creating anything, inside a transaction, with a `P2002` fallback in case of
  a race; reserves the eventual `FranchiseProject` id up front
  (`generateReservedProjectId`) and reuses the existing invite-email
  mechanism. P1-02 (web-login lockout) added `User.loginFailedAttempts` /
  `loginLockedUntil` to `(auth)/login/actions.ts` — same 5-attempts/15-minute
  shape as the mobile PIN lockout (section 16 step 3), a separate pair of
  columns so the two login paths can't interfere with each other.
- **Step 3 (franchisee portal + uploads) — done.** `src/app/onboarding/`
  (documents, layout, page) plus `src/lib/onboarding/malware-scan.ts` — a real
  (not stubbed) `basic` scanner: magic-byte match against the declared MIME
  type, plus an EICAR-string check, so the reject path is genuinely
  exercisable. `isProductionWithoutRealScanner()` is meant to drive an Admin
  warning banner in production until a real scanner (open item 9) is wired
  in — worth confirming that banner actually renders somewhere; not traced
  during this reconstruction.
- **Step 4 (review queues) — done.** `src/app/(app)/reviews/actions.ts` —
  `decideKyc`/`decidePayment`, both requiring a non-empty reason on
  `REQUEST_CHANGES` (P1-13) and both driving `transitionReview` +
  `recomputeOnboardingStatus` inside one transaction. P1-05 (no
  self-approval) is enforced on payment review (`payment.uploadedById ===
  user.id` check) — worth double-checking the same guard exists on the KYC
  side, since `decideKyc` as read during this reconstruction did not show an
  equivalent uploader-vs-reviewer check.
- **Step 5 (LOI engine) — done, and materially revised in `727d9b9`.** The
  original `b710c83` LOI template was a placeholder (per this section's own
  "NOT DECIDED YET" #2 at the time). `727d9b9` replaced it with the real,
  approved Tulsi LOI — transcribed from a director-signed reference PDF
  (`Tulsi LOI Format.pdf`, gitignored, not committed) into
  `loi-template.ts` (`isApproved: true`, `isPlaceholder: false`), added a
  logo/brand-asset file (`loi-assets.ts`), and reworked `loi-pdf.ts`'s
  renderer (+301/-more lines) to lay out the approved clause structure
  (§TITLE/§FIELDS/§INTRO/§DEFS/... section markers). This also changed the
  LOI's actual field set: the free-text "commercial terms" textarea on
  `loi-prep-panel.tsx` was removed (the approved template has fixed clauses,
  not freeform terms), and the franchisee's masked Aadhaar
  (`maskAadhaar(kyc.aadhaarLast4)`) is now one of the values baked into the
  PDF. **This is a live, user-facing content change worth flagging to Apoorv
  explicitly** — the LOI a franchisee actually signs now reads differently
  than whatever was reviewed (if anything was) against the placeholder.
- **Step 6 (e-sign) — done, and extended twice on 2026-09-28.** `b710c83`
  shipped the adapter (`src/lib/esign/`, `getEsignProvider()` as the single
  gate — refuses `ESIGN_PROVIDER=mock` in production unless explicitly
  overridden), `MockProvider`, the `/dev/mock-esign/[envelopeId]` dev signing
  page, the webhook route (`api/webhooks/esign`, signature-verified,
  idempotent via `EsignProcessingEvent`, always 200s once recorded so a
  provider won't retry-storm a logged event), `/signing` (franchisee +
  company sign pages) and `/admin/esign-events` (manual reconcile for a
  failed/missed webhook, P1-10). Both later commits are testing-convenience
  additions, not new capability: `61557a7` added `ALLOW_MOCK_ESIGN_IN_
  PRODUCTION` (env-gated, watermark-preserving — see NOT DECIDED YET #1
  above) and made both `startFranchiseeEsign`/`startCompanyEsign` call
  `processEsignEvent` directly (same code path the real webhook and the
  admin reconcile action use) instead of requiring a trip through
  `/dev/mock-esign` when `ESIGN_PROVIDER=mock` — surfaced to the user as a
  `window.alert("You have esigned!!")`. `4691e70` widened
  `canCompanySignNow`'s actor check from `COMPANY_SIGNATORY`-only to also
  accept `ADMIN`, matching `permissions.ts`'s `canCompanySign` (which already
  let ADMIN reach the signing page) — closes a gap where an ADMIN could open
  `/signing/[id]` but the gate function would still reject the actual sign
  action; test coverage for this was added to `state.test.ts` in the same
  commit.
- **Step 7 (completion + conversion) — done.** `src/lib/onboarding/
  conversion.ts` — one transaction, idempotent (`if (onboarding.projectId)
  return { converted: false }`), calls the shared `createProjectWithSeedTasks`
  (not a reimplementation, per step 0's own instruction), files the signed
  LOI + certificate as `Document` rows under the new project (category
  Legal), and writes the project/document/onboarding-update audit trail.
  Triggered from the webhook processor the instant company-sign completes —
  never from a user-facing action directly.
- **Step 8 (emails + template admin) — done; hardening/mobile-responsive pass
  status unconfirmed.** `src/lib/onboarding/notify.ts` sends all eight
  section-17 email keys via Resend, self-seeding `EmailTemplate` rows on
  first send (editable after that at `/admin/email-templates`, per the same
  file's own comment), and logs every attempt — success or failure — to
  `NotificationLog` rather than throwing (P1-14: a failed email must never
  fail the business action). **Not confirmed during this reconstruction**:
  whether a responsive-mobile pass was actually done on the new onboarding
  screens (this step's own scope explicitly includes it, "SRD: same actions
  on mobile") — no commit message or code comment claims this was done.
- **Step 9 (end-to-end verification) — NOT confirmed done; this is the real
  gap.** `scripts/tmp-e2e-onboarding.ts` exists and its shape matches this
  section's own Definition of Done closely (creates KYC/Accounts/LOI-
  preparer/Company-signatory/second-franchisee test users, drives a real
  Playwright browser, cleans up B2 objects and DB rows afterward) — but
  nothing in the commit history, plan.md, or the script's own output confirms
  it was actually **run to a passing result** on real infrastructure, the
  way sections 9-11 and 14-16 each explicitly logged (pass/fail counts, DB
  confirmation, zero console errors, artifact cleanup verified). Until that
  run happens and its result is logged here, section 17 should be treated as
  **code-complete but unverified**, not shipped — this is the concrete next
  step, not a formality.

**Also unlogged, unrelated to section 17** — five small commits between
`b710c83` and now that this reconstruction is also filling in, since none of
them touched plan.md either: `b9c815e` favicon updated; `12b1bdd` added
`opengraph-image.png` for WhatsApp/social link previews; `cb9d25d` added
`themeColor`/OG meta tags to `layout.tsx` for the WhatsApp preview card;
`a7751c3` excluded `opengraph-image.png` from `proxy.ts`'s auth-gate matcher
(crawlers were being redirected to `/login` instead of getting the image).
Plus three infra-only fixes already partly covered by section 12's pattern:
`3a2f2c2` synced `pnpm-lock.yaml` (playwright/vitest/pdf-lib/server-only had
been added to `package.json` without it), `3106132` made the password-reset
link fall back to `VERCEL_URL` when `APP_URL` is unset (production reset
emails had been linking to `localhost:3000`), and `a9590e5` fixed a prod
build break (a non-async export from a `"use server"` file) and excluded
`scripts/` from the production typecheck.

**Process note, again:** this is the second time this file has needed a
same-day reconstruction sweep (first time was section 13, 2026-09-23) because
real feature commits — including one that shipped most of this entire
section — landed without a build-log entry alongside them. The habit section
13 asked for still isn't sticking; worth treating "update plan.md in the same
session" as a hard requirement for section 17's remaining work (step 9 and
whatever comes after), not a nice-to-have.

**Third reconstruction sweep (2026-09-30):** two more section-17 commits
landed after the above without a build-log entry — filling them in here
rather than editing the "Process note" above, since that note was itself
accurate at the time it was written.

- **`712c281` "store gets created after onboarding"**: once LOI Complete
  conversion runs, the three screens that previously only showed the
  *reserved* Project ID or a bare "Signed." now link straight through to the
  resulting `FranchiseProject` — `/signing/[id]` (a "View project →" link
  once the company signature completes), `/store-onboarding/[id]` (swaps
  "Reserved Project ID: `<code>`" for a live link once `projectId` is set),
  and `/store-onboarding` (a new "Project" column). Also fixed in the same
  commit: `webhook-processor.ts`'s post-conversion `loi_complete` email only
  ever notified the franchisee — the sales owner tied to that onboarding had
  no way to discover the project now existed, so it's included as a second
  `loi_complete` recipient, mirroring the pattern already used for the
  franchisee/company signatories elsewhere in the same function.
- **`b9b1d17` "delete button in store onboarding"**: two separate things,
  despite the one commit message. (1) `deleteOnboarding` action +
  `DeleteOnboardingButton` on `/store-onboarding` — Admin-only
  (`canManageOnboardingAdmin`), hard delete (`OnboardingFile`/
  `KycSubmission`/`PaymentSubmission`/`LoiVersion` all cascade), refuses once
  `projectId` is set ("this onboarding already converted to a live project —
  delete the project instead"), same confirm-dialog pattern as
  `DeleteProjectButton`. (2) `deleteUser`'s failure path got real teeth: a
  blocked delete used to return one generic sentence ("owns a project, task,
  or document"); `findDeletionBlockers` now queries every FK that actually
  restricts the delete (projects owned/franchiseed, tasks owned/created,
  documents owned, onboardings as franchisee/sales-owner, plus a note for
  comment/file counts) and `DeleteUserButton` renders each as a clickable
  link straight to the offending record, capped at 5 per category
  (`BLOCKER_LIST_LIMIT`) so it stays a "here's where to go" list, not a full
  report. `task-card.tsx`/`document-card.tsx` gained `id={`task-${id}`}` /
  `id={`document-${id}`}` + `scroll-mt-16` anchors in this same commit so
  those blocker links can deep-link straight to the row, not just the page.
  Also: `.gitignore` widened from two explicitly-named PDFs to `*.pdf` —
  spec/reference PDFs dropped into the repo root generally shouldn't be
  committed, not just those two.

**Malware scanner (2026-10-09) — resolving NOT DECIDED YET #9.** Rollout
review found the gap was worse than the item's own one-line description:
the "basic" magic-byte+EICAR checker only ran on the KYC/payment-proof
path — Document Vault (project PDFs/Word/Excel/PowerPoint) and Complaint
attachments had zero scanning, not even a `scanStatus` column. Fixed all
three (the `/m` mobile supervisor upload-evidence flow is a deliberate
scope cut, below).

- **Adapter pattern**, mirroring `src/lib/esign/`'s own shape: new
  `src/lib/malware-scan/` — `provider.ts` (interface), `basic-scanner.ts`
  (today's check, moved as-is, extended with magic bytes for webp/Office
  formats so Document Vault's wider type list doesn't always come back
  INFECTED in dev), `cloudmersive-scanner.ts` (real adapter), `index.ts`
  (`getMalwareScanner()` factory + `currentScannerName()`). Deleted the old
  `src/lib/onboarding/malware-scan.ts` and its dead
  `isProductionWithoutRealScanner()` (zero call sites anywhere). The admin
  banner (`/admin/esign-events`) now calls `currentScannerName()` instead of
  re-implementing its own inline, `NODE_ENV`-blind env check.
- **Real scanner: Cloudmersive Virus Scan API** (`MALWARE_SCANNER=api`,
  `POST /virus/scan/file`, native `fetch`, same AbortController/15s-timeout/
  no-retry convention as `leegality-provider.ts`). `MALWARE_SCANNER=basic`
  now throws in production unless `ALLOW_BASIC_SCANNER_IN_PRODUCTION=true`
  — same shape as `ALLOW_MOCK_ESIGN_IN_PRODUCTION`, turning the old silent
  gap into an explicit opt-in.
- **Async via `after()`**: neither `vercel.json` nor `next.config.ts` sets
  `maxDuration` anywhere, and this project is confirmed on Vercel's Hobby
  plan (`vercel teams ls`) — a third-party scan call risked timing out an
  upload action. Every write now starts at `scanStatus: PENDING` (already
  the schema default, previously unused in practice) and the real scan runs
  in `after()`, updating the row once it resolves. `maxDuration = 20` added
  to the three pages hosting these Server Actions
  (`onboarding/documents/page.tsx`, `projects/[id]/page.tsx`,
  `documents/page.tsx`) — Next's docs say Server Action timeouts are
  page-level config, not per-action.
- **Schema**: `Document` gained `scanStatus`/`scanError` (same shape as
  `OnboardingFile`); `Complaint` gained nullable `attachmentScanStatus`/
  `attachmentScanError` (nullable since the attachment itself is optional).
  Migration `add_document_complaint_scan_status`, additive-only.
- **Two call sites explicitly set `scanStatus: CLEAN` instead of leaving the
  PENDING default**: the signed-LOI and signing-certificate `Document` rows
  in `onboarding/conversion.ts` — bytes come straight from Leegality's API
  response, not a user upload, so scanning doesn't apply (same reasoning
  section 19 already uses for not scanning other vendor-fetched PDFs).
  Leaving them at PENDING would have made them unreviewable by anyone but
  the owner forever, since nothing would ever scan them.
- **Deliberate scope cut, flagged to and confirmed with the user**: the
  `/m` mobile supervisor upload-evidence flow (`finalizeUpload`,
  `src/app/m/[id]/actions.ts`, photos **and videos** up to 50MB) is a real
  user upload that is **not** wired to a scanner in this pass — Cloudmersive's
  free-tier 10MB cap vs this flow's 50MB allowance needs its own decision
  once real account limits are known, and silently scanning-then-blocking
  routine field videos at ERROR felt like the wrong default to pick
  unilaterally. These Documents stay at the PENDING default forever by
  design; the new download-route gate exempts them via `taskId !== null`
  (the schema's existing signal for "this Document came from `/m`," not a
  new field) rather than silently making working functionality
  unreviewable.
- **Download-route gates added** (mirroring the existing
  `onboarding-files/[fileId]/download` pattern — owner always allowed,
  everyone else waits for CLEAN): `projects/[id]/documents/[documentId]/
  download/route.ts` (owner = `Document.ownerId`) and `projects/[id]/
  complaints/[complaintId]/attachment/route.ts` (owner =
  `Complaint.raisedById`). Neither had any scan-status check before this.
- **New human-gated item, same shape as BLOCKERS.md's Leegality entries**
  (not added to BLOCKERS.md itself — that file's own header scopes it to
  section 19/Leegality only): **what's blocked** — `CLOUDMERSIVE_API_KEY`;
  **why** — Claude Code doesn't create accounts or enter payment info;
  **who** — the user; **cost** — free tier is 600 calls/month, 10MB/file,
  no expiration (checked directly against cloudmersive.com, 2026-10); not
  confirmed whether signup needs a card, or what paid pricing looks like
  past the free tier — confirm both at signup, don't assume; **exact
  steps** — sign up at cloudmersive.com, get an API key, set
  `CLOUDMERSIVE_API_KEY` (and `MALWARE_SCANNER=api`) in Vercel production;
  **built meanwhile** — everything above is fully built and tested against
  a mocked `fetch` (`cloudmersive-scanner.test.ts`), same order Leegality's
  L1-L5 followed before its own real key existed.
- **Verified**: `tsc --noEmit`, `eslint`, `vitest run` clean — 226/226
  tests passing (7 new, in `cloudmersive-scanner.test.ts`: clean, infected,
  non-2xx, missing-field, timeout, no-key-leak, missing-API-key). `prisma
  migrate dev` applied the new migration cleanly against the local dev DB.
  **Not verified**: no live dev-DB/browser click-through of any of the four
  upload paths with a real file (the dev server was running throughout —
  stopped once, with the user's explicit go-ahead, only to clear a Windows
  file lock blocking `prisma generate`, then restarted immediately after);
  no real Cloudmersive account exists yet, so the "api" path has only ever
  been exercised against a mocked `fetch`, never a real request — same
  "mock success is not production proof" caveat section 19 states plainly
  for Leegality.

