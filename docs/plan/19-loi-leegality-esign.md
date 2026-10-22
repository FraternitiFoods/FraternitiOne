## 19. LOI signing by Aadhaar eSign through Leegality (rewritten 2026-10-03; replaces the SMS OTP plan)

**Where this came from:** on 2026-10-03 Apoorv dropped SMS OTP signing ("sms
otp ko maar goli, we're doing aadhaar esign"). The company already has
**Leegality** with eSign credits loaded (production dashboard,
`https://dashboard.leegality.com`). The founder wants it done fast. So:

1. **Both signers sign the LOI with Aadhaar eSign on Leegality**: franchisee
   first, then the company signatory (role `COMPANY_SIGNATORY`, kept exactly as
   section 17 defines it).
2. **All SMS OTP signing is removed**, both from this plan and from the
   codebase. That includes the mock SMS flow, `/dev/mock-sms`, the OTP module,
   the OTP tables, the Fast2SMS plan, and the `SIGNING_METHOD` switch. Nothing
   about SMS stays in the app. SMS for anything else (for example OTP login,
   section 20E) is parked; Apoorv will decide on it later.
3. **New: a watermark on every page of the LOI PDF**, so the document looks
   official — resolved 2026-10-03 as the app's own crest logo (the same
   artwork as the favicon and the LOI header's wordmark), not text. (An
   earlier draft of this section said text reading "Fraterniti Foods Pvt.
   Ltd."; that was changed twice — first to "Fraterniti Luxury Pvt Ltd" text,
   matching the name the approved LOI actually uses throughout, then to the
   logo image per Apoorv's own follow-up call. See decision 7 and step L2.)
4. **New: the LOI can be edited before it is sent.** The LOI preparer can change
   the values and the wording of one store's LOI while it is a draft. Apoorv has
   an LOI template file and will hand it over when Claude Code asks for it.
5. **Kept: the franchisee can send the LOI back for changes** before signing.
   The `loi-feedback-form.tsx` added in commit `bccb75b` appears to be this
   feature. It is **not** SMS code and must survive the SMS removal.

**History, kept short on purpose.** From 2026-10-01 to 2026-10-03 this section
specified signing by a 6-digit SMS OTP (mock SMS first, Fast2SMS later). Commit
`bccb75b` ("sms otp mock flow") built the mock version. The Fast2SMS part was
plan-only. The full old text is in git history of `plan.md` if anyone needs it.
The list of what `bccb75b` added is reproduced in step L1 below, because it is
now the removal list.

### Mental model (read this first, plain words)

Think of Leegality as an **outside signing room**. Our app prepares the paper,
walks each signer to the door of that room, and waits for Leegality to ring a
bell (the webhook) saying "this person signed". Inside the room the signer
types their Aadhaar number, gets an OTP from UIDAI on the mobile linked to
their Aadhaar, and signs. **We never see the Aadhaar number or that OTP.**

```
OUR APP (Fraterniti One)                                LEEGALITY (outside)
────────────────────────────────────────────            ─────────────────────────────────
LOI preparer edits the draft LOI (values + wording)
   │  preview PDF, with the watermark
   ▼
Release → final PDF bytes → sha256 stored (immutable)
   │
Franchisee reviews it in /onboarding/loi
   ├─ "Request changes" (with a reason) → back to the preparer → new version
   │
   └─ gates OK (KYC + payment + released) → "Proceed to Aadhaar eSign"
         │
         ▼  POST /v3.0/sign/request  (one document, 2 invitees, fixed order)
         │  ────────────────────────────────────────▶  creates the document
         │  ◀── documentId + one signUrl per invitee
         ▼
      franchisee is sent to HIS signUrl  ──────────▶  Aadhaar number → UIDAI OTP → signed
                                                             │
      /api/webhooks/esign  ◀── webhook {documentId, mac, ...}┘
         │  1. check mac = HMAC-SHA1(documentId, private salt)
         │  2. ask Leegality "what is the real status?"  (document details API)
         │  3. franchisee attempt COMPLETED (existing processEsignEvent)
         ▼
      company signatory's button unlocks on /signing/[id]
         │  opens HIS signUrl  ───────────────────▶  Aadhaar eSign → signed
      /api/webhooks/esign  ◀── webhook ──────────────────────┘
         │  same 3 checks → company attempt COMPLETED
         ▼
      download signed PDF + audit trail (links live 15 seconds) → B2
         ▼
      LOI COMPLETE → existing conversion.ts → FranchiseProject + 963 tasks
```

Cause → effect in one line: `draft edited` → `released (hash fixed)` →
`franchisee clicks sign` → `Leegality document created` → `franchisee signs on
Leegality` → `webhook, verified, double-checked with Leegality` → `company
signatory signs` → `webhook, verified, double-checked` → `signed PDF + audit
trail saved` → `LOI COMPLETE` → `project created by the existing code`.

What does **not** change: KYC, payment review, roles, gate functions
(`canFranchiseeSignNow` / `canCompanySignNow`), `processEsignEvent`,
`conversion.ts`, the section 17 emails, `/admin/esign-events`, and the mock
e-sign provider (`ESIGN_PROVIDER=mock`, still used for free local testing).
Leegality is just the **real** provider behind the `EsignProvider` interface
that section 17 built for exactly this moment.

### Decisions (2026-10-03, Apoorv)

1. **Provider = Leegality, signature type = Aadhaar eSign** for both signers.
   This closes section 17 NOT DECIDED #1 (vendor), #6 (company also Aadhaar)
   and #12 (envelope shape, see decision 4).
2. **API = Leegality v3 with the "Legacy Auth Token".** Every call carries the
   header `X-Auth-Token: <token>` (not `Authorization: Bearer`, which is for
   their v4 OAuth APIs; v4 is not used). Base URLs: production
   `https://app1.leegality.com/api/`, sandbox `https://sandbox.leegality.com/api/`.
   Sandbox and production have **separate** tokens and salts.
3. **SMS OTP is removed completely** (code, tables, env vars, plan text, mock).
   The mock **e-sign** provider stays.
4. **One Leegality document per LOI version, two invitees, fixed signing
   order** (franchisee = invitee 1, company signatory = invitee 2). The final
   PDF then carries both signatures. Leegality keeps invitee 2's link inactive
   until invitee 1 has signed, which matches our own gate. Our two
   `EsignAttempt` rows (FRANCHISEE, COMPANY) share the same `documentId` and are
   told apart by each invitee's own `signUrl`.
5. **Our app is the front door.** Signers reach Leegality only through a button
   in our app, after login and after our gate check. Leegality's own invitation
   and reminder messages are switched **off** in the workflow. Leegality's
   mandatory messages cannot be switched off and are fine: the eSign
   confirmation, and the completion email with the signed PDF and audit trail
   to both signers.
6. **The webhook is a doorbell, not proof.** Leegality's `mac` only covers the
   `documentId` (see "Webhook" below), so a replayed real webhook would still
   pass the check. Therefore every verified webhook is followed by a call to
   Leegality's document-details API, and **only that answer** can mark an
   attempt `COMPLETED`. This is section 17 P1-07 applied to Leegality.
7. **Watermark: the app's crest logo** (resolved 2026-10-03 — Apoorv's final
   call; two earlier drafts of this decision said text first "Fraterniti
   Foods Pvt. Ltd.", then corrected to "Fraterniti Luxury Pvt Ltd" to match
   the approved LOI's actual franchisor name, before the logo replaced text
   entirely) on every page of every newly generated LOI PDF, drawn before
   hashing. Look confirmed by Apoorv on a sample PDF (step L2).
8. **LOI editable while it is a draft**; frozen once released (section 17 rule
   stays); a change after release = a new version.
9. **Franchisee "request changes" stays** (existing `loi-feedback-form.tsx`).
10. **Leave Leegality's "Whitelisted IPs" field empty.** Vercel functions have
    no fixed outgoing IP. Adding any IP there (for example a home or office IP)
    would most likely make Leegality refuse every call from Vercel. The docs do
    not say what an empty list means; the first real call from Vercel (step L6)
    proves it. If Leegality turns out to require an IP, that is a blocker
    (a fixed outgoing IP needs a paid Vercel add-on or a proxy, which is Apoorv's
    and Sushant ji's call), not something Claude Code works around.

### How Claude Code works with Apoorv (stop points)

Claude Code does everything that is free and needs no human. It **stops and
asks Apoorv only at these points**, each time saying exactly what it needs,
where to find it, and where to put it:

| When | What Claude Code asks for | Where Apoorv puts it |
|---|---|---|
| End of L0 | Go-ahead after the mental model; answers to the open questions it lists (one batch) | chat |
| Start of L1 | OK on the exact deletion list (files, tables, columns) and the row counts it found | chat |
| L2 | OK on a sample watermarked LOI PDF | chat |
| L3 | **The LOI template file** (and which text wins if it differs from the current `loi-template.ts`) | file in the repo root (`*.pdf` is gitignored) or attached |
| L4 | **Legacy Auth Token** and **Private Salt** (production; sandbox ones too if a sandbox account exists) | **`.env.local` only, never the chat** |
| L4 | **Workflow ID** (`profileId`) and the workflow's **downloaded API payload JSON** (it holds no secret) | chat or a file |
| L4 | Production domain for the webhook URL (`fraterniti.one` or `fraterniti-one.vercel.app`) | chat |
| L6 | Go-ahead before the **one real test** (it spends 2 eSign credits) | chat |
| L7 | Vercel env vars set, production migration run (Claude Code gives the exact list) | Vercel dashboard |
| any time | Anything else from Leegality that turns out to be needed (for example a support answer) | Claude Code says exactly what to ask Leegality |

Rules for secrets: Claude Code never asks for the token or salt in the chat,
never prints them, never commits them, never puts them in logs, audit rows or
error messages. To check they are set it prints only "set" / "not set" (and,
once, the result of a harmless call such as the wallet balance). **Warn
Apoorv:** clicking "Refresh" next to the Auth Token in Leegality makes a new
token (the old one stops working; Vercel and `.env.local` must then be
updated); the Private Salt can only be changed by disabling and re-enabling the
API, which also clears the whitelisted IPs.

Claude Code never creates Leegality accounts or workflows, buys credits, or
changes Leegality settings itself; it gives Apoorv click-by-click steps.

### Blockers (human steps) — merge into `BLOCKERS.md`, replacing all SMS rows

| # | Blocker | Who | Money? |
|---|---|---|---|
| 1 | **Leegality API enabled + Auth Token + Private Salt** put in `.env.local` (and later Vercel). Dashboard: ⚙️ Settings → API → Enable API. | Apoorv | No |
| 2 | **Leegality workflow "Fraterniti LOI"** set up as in "Workflow settings" below; give Claude Code its Workflow ID (`profileId`) and the downloaded API payload. | Apoorv | No |
| 3 | **Enough eSign credits.** Each LOI uses **2** Aadhaar eSign credits (one per signer); a retry after an expiry or failure can use more. Leegality's public Basic price is ₹25 per Aadhaar eSign (read 2026-10-03; the company's actual rate may differ). | Apoorv / Sushant ji | **Yes** (already bought; top up later) |
| 4 | **Production domain** for the webhook URL, and that domain live on Vercel. | Apoorv | No |
| 5 | **Vercel env vars** (list below) and **production DB migration** for this section's changes. | Apoorv | No |
| 6 | **Company signatory user** exists with the **exact legal name** as on their Aadhaar and a working email; assigned to the onboarding the way section 17 assigns it. | Apoorv / Admin | No |
| 7 | **Approved LOI template** file (step L3). | Apoorv | No |
| 8 | **One real end-to-end test** on production (2 credits), with Apoorv (or a colleague) signing a clearly-marked TEST LOI. | Apoorv | Yes, 2 credits |
| 9 | **Legal:** Aadhaar eSign is a recognised electronic signature in India, so the old "is a plain OTP enough" question is gone. Still worth one question to the lawyer: does this LOI need stamp duty / an e-stamp? (Leegality can attach e-stamps, but that is not built.) | Sushant ji / lawyer | Maybe |

### Workflow settings in the Leegality dashboard (blocker 2, click-by-click for Apoorv)

Workflows → **+ Create** → name it `Fraterniti LOI`, then:

1. **Document:** upload one generated sample LOI PDF (Claude Code provides it in
   step L4). The real PDF is sent by the API each time; this sample is only for
   placing the signature boxes.
2. **Invitee 1 = "Franchisee"**: type **Signer**, eSign type **Aadhaar** only.
   **Invitee 2 = "Company Signatory"**: type **Signer**, eSign type **Aadhaar**
   only. Turn the **fixed signing order** toggle **on** (1 then 2).
3. **Signature boxes:** ☰ → custom coordinate → place invitee 1's box and
   invitee 2's box in the signature area of the **last page**. (Open point for
   Claude Code: confirm from the API payload or the docs how placement behaves
   when the real PDF has a different page count. The LOI PDF ends with a
   fixed-layout signature page for this reason; see step L2.)
4. **For each invitee → More Options → "Add custom URLs and webhooks":**
   Webhook URL **and** Error Webhook URL =
   `https://<production domain>/api/webhooks/esign`.
5. **Notifications for each invitee:** switch **off** the sign invitation and
   reminders (our app is the front door, decision 5).
6. **Rejection option:** off (changes are requested in our app before signing).
   Our code still handles a rejection if one ever arrives.
7. **Document settings → signing link expiry:** a number of days (default **7**),
   **not** 45 minutes and not end-of-day. If the expiry field is left empty
   Leegality uses 45 minutes, which would kill the company signatory's link.
8. **Save.** Then download the workflow's **API payload** and copy the
   **Workflow ID / `profileId`**. Give both to Claude Code.
9. **Settings → API → Whitelisted IPs: leave empty** (decision 10).

Optional, ask Sushant ji (NOT DECIDED #4, #5): Aadhaar name or last-4-digit
verification for the franchisee; company seal for invitee 2.

### Leegality API contract (what the adapter calls)

All calls: header `X-Auth-Token: <LEEGALITY_AUTH_TOKEN>`, `Content-Type:
application/json`, base URL from `LEEGALITY_BASE_URL`. Every response has
`status` (`1` = success, `0` = failure) and `messages[]` (`code`, `message`).
**Success = HTTP 2xx and `status === 1`.** Anything else is a failure; the
signer sees a plain sentence, the Admin sees the Leegality `messages`.

| Adapter method (section 17 interface) | Leegality call |
|---|---|
| `createEnvelope` | `POST /v3.0/sign/request` with `profileId`, `file: { name, file: <base64 PDF, max 15 MB> }`, `invitees: [ {name, email, phone?}, {name, email, phone?} ]`, `irn: <LoiVersion id>`. Response `data.documentId`, `data.invitees[].signUrl`, `expiryDate`. |
| `getStatus` | `GET /v3.3/document/details?documentId=…` → `data.document.status` (e.g. `COMPLETED`) and per invitee `data.invitations[].invitationStatus.signed`, `signDate`, `failureReason`. Do **not** request `invitations_certificateData` (it returns Aadhaar-derived name, gender, state). |
| `fetchSignedPdf` | `GET /v3.3/document/fetchDocument?documentId=…&documentDownloadType=DOCUMENT` → `data.file` is a CDN URL that **expires in 15 seconds**; download it at once, server side, store in B2 with its sha256. |
| `fetchCertificate` | same, `documentDownloadType=AUDIT_TRAIL` → Leegality's audit trail PDF is our "certificate". |
| `voidEnvelope` | `DELETE /v3.0/sign/request?documentId=…` — "permanently deletes a document and all associated data". So **first** download whatever exists (document + audit trail) into B2, then delete. |
| (new, small) wallet line | `GET /v3.0/wallet/balance/details` → `data.unused` credits. Admin banner when below `LEEGALITY_LOW_CREDITS` (default 10). Cached 5 minutes; failure is ignored; never blocks signing. |
| (not used) | v4 APIs, `activate-invitation` (out-of-turn signing), templates `fields`, stamps, payload encryption, mTLS, custom webhook headers. |

Field facts to respect: `profileId` required; invitee needs `name` and email or
phone (phone = 10 digits); invitee names with odd special characters are
rejected ("Signer/Reviewer name is invalid"), so send the legal name as stored.
After signing, the signer can be sent back to our app by appending
`?redirectUrl=https://<domain>/onboarding/loi` (company: `/signing/[id]`) to the
signUrl; a redirect URL set inside the workflow overrides this. Open the
signUrl in the same tab (no iframe).

**Integrity (replaces section 17's "returned hash must equal pdfSha256" for
this provider).** Leegality does not return a hash of the document we uploaded,
and the signed PDF's bytes necessarily differ from ours. So: we store the
sha256 of the exact bytes we upload (`EsignAttempt.pdfSha256`, as today); the
`documentId` ties the Leegality document to that attempt; the signed PDF and
audit trail get their own sha256 when stored. Do not invent a comparison that
cannot hold.

### Webhook (`POST /api/webhooks/esign`, existing public route)

- Configured per invitee inside the workflow (not per API call). Two URLs per
  invitee: success events and error events; we point both at the same route.
- Body (JSON): `webhookType` (`Success` | `Error`), `documentId`,
  `documentStatus` (`Draft` | `Sent` | `Completed`), `irn`, `mac`, `messages`,
  `verification` (Aadhaar-derived name, yob, gender, state, pincode, title),
  `request` { `inviteeType`, `name`, `email`, `phone`, `invitationUrl`,
  `active`, `action` (`Signed` | `Rejected` | null), `error`, `expired`,
  `expiryDate`, `rejectionMessage`, `signType` (`AADHAAR` …) }.
- **Verify:** `mac === HMAC-SHA1(key = LEEGALITY_PRIVATE_SALT, message =
  documentId)`, lowercase hex (Leegality's examples are 40-character hex);
  compare in constant time. Wrong → 401, nothing processed.
- **Then confirm** with `getStatus(documentId)` (decision 6) and act only on
  what that returns.
- **Which signer:** match `request.invitationUrl` to the `signUrl` stored on
  each attempt (fallback: invitee email). Unknown document → store as ignored.
- **Idempotency key** (Leegality sends no event id): `leegality:<documentId>:<FRANCHISEE|COMPANY>:<signed|rejected|expired|failed>`
  into the existing unique `(provider, providerEventId)`.
- **Store less:** before saving the raw payload in `EsignEvent`, remove the
  `verification` object and the `invitationUrl` (a sign link is a bearer
  secret). Never log the URL either.
- Error events: `action = Rejected` → attempt `CANCELLED`, the
  `rejectionMessage` becomes LOI feedback for the preparer and the sales owner;
  `expired = true` → attempt `EXPIRED` (Admin can start attempt n+1, which means
  a new Leegality document, see "Edge cases"); certificate verification failed
  → attempt `FAILED` with Leegality's message.
- Leegality retries a non-2xx answer 3 times (immediately, after 1 h, after
  3 h more). Keep the existing route behaviour (record, then 200); the Admin
  reconcile button on `/admin/esign-events` (calls `getStatus`) covers anything
  missed, and is also how local development tests a real document, since
  Leegality cannot reach `localhost`.
- (For reference only, not used for trust: Leegality's webhook source IPs are
  production `15.207.242.28`, `3.6.114.195`, `3.7.137.254`, sandbox
  `65.2.154.131`, plus DR IPs; the `mac` and the details call are the check.)

### Edge cases (cause → effect)

1. **Terms change after signing started** (section 17 rule 11): new LOI version
   → old Leegality document: download what it holds into B2, then delete it →
   both signers sign the new version on a new Leegality document. Old signed
   copies are never overwritten.
2. **Franchisee signed, company link expired:** the old document holds a
   franchisee signature but cannot be completed. Default: keep its files in B2,
   delete it, and start a new document for the same LOI version, which means
   **the franchisee signs again** (2 more credits). Claude Code checks
   Leegality's "reactivate document" API page first; if it revives an expired
   link without re-signing, use that instead and log the finding.
3. **Leegality down / timeout on create:** no automatic retry (it could create
   two documents and spend credits twice). Attempt → `FAILED`, signer sees
   "Could not start eSign, please try again", Admin sees the reason.
4. **Credits run out:** the create call fails; Admin banner. The low-credit
   banner should usually warn first.
5. **Same person on both sides:** not allowed (section 17: one user, one role).
   Company signatory email must differ from the franchisee's Workspace email.
6. **A non-signatory clicks the company button:** the company signUrl is shown
   only to the user who was invited as invitee 2. `ADMIN` can see status but,
   by default, cannot open that link (NOT DECIDED #3).

### What gets built (L-steps)

**L0. Recon, read-only.** Read `src/lib/esign/*` (interface, `index.ts`
gate, mock provider), `webhook-processor.ts`, `startFranchiseeEsign` /
`startCompanyEsign`, `/onboarding/loi`, `/signing/[id]`, `/admin/esign-events`,
`conversion.ts`, `loi-pdf.ts`, `loi-template.ts`, the LOI prep panel and
actions, `loi-feedback-form.tsx` and where it is wired, `state.ts`,
`permissions.ts`, `proxy.ts`, `.env.example`, `BLOCKERS.md`,
`schema.prisma`. Run `git show --stat bccb75b` and list every SMS/OTP file,
table, column, enum, env var and test. Count rows in dev (and, read-only, in
production if Claude Code has access; otherwise ask Apoorv to run the count
query it prints) for `OtpChallenge`, `LoiAcceptance`, and `EsignAttempt` with
`provider = 'sms_otp'` by status, and whether any `LOI_COMPLETE` onboarding
was signed via `sms_otp`. Append "L0 — what I found" to the build log. Then give
Apoorv the plain-words mental model (above, in his words) plus the open
questions in **one** batch, and **wait for his go-ahead**.

**L1. Remove SMS OTP.** Show Apoorv the exact deletion list first and wait for
OK. Expected list (from section 20's recon of `bccb75b`; confirm in L0):
- Delete: `src/lib/otp/` (challenge, core + test, phone + test, consent,
  limits, request-meta), `src/lib/sms/` (provider, mock-provider, index), the
  `/dev/mock-sms` page, `otp-sign-panel.tsx`, `acceptance-certificate.ts`,
  `signing-method.ts`, `scripts/tmp-e2e-otp-signing.ts`, any `fast2sms` file if
  one exists, OTP server actions (`requestLoiOtp` / `verifyLoiOtp`).
- Undo: the `sms_otp` branch in `webhook-processor.ts`'s
  `handleAttemptCompleted` (back to fetching signed PDF + certificate from the
  provider); the `SIGNING_METHOD` branching in the start actions and UI ("Sign
  LOI with OTP" → back to "Proceed to Aadhaar eSign"); `proxy.ts` entries for
  SMS routes; SMS env names in `.env.example`.
- **Keep:** `loi-feedback-form.tsx` and its action (franchisee request
  changes), the mock **e-sign** provider and `/dev/mock-esign`, the optional
  explicit provider-name parameter on `processEsignEvent` (harmless and useful
  for labelling Leegality events), `User.phone` (it existed before, for
  supervisors). If `bccb75b` made phone **required** in the user forms only for
  OTP, make it optional again.
- Schema: **one new migration** (never edit old migrations) dropping
  `OtpChallenge`, `LoiAcceptance`, `NotificationLog.channel` +
  `NotificationChannel` enum, and `LoiVersion.franchiseePreviewOpenedAt` /
  `companyPreviewOpenedAt`, **only if** nothing outside the OTP flow uses them.
  **Stop and ask** if production has any of these rows tied to a real
  onboarding, or if any `LOI_COMPLETE` store was signed via `sms_otp`: that is
  signed evidence and must not be dropped without Apoorv's decision.
  `EsignAttempt` rows with `provider = 'sms_otp'` are history and stay; any
  still `SENT`/`IN_PROGRESS` → `CANCELLED` with an audit event ("signing method
  changed to Leegality Aadhaar eSign"), and that onboarding falls back to
  `READY_FOR_SIGNATURE`.
- `BLOCKERS.md`: close every SMS row with "dropped 2026-10-03 — LOI signing
  moved to Leegality Aadhaar eSign", add the Leegality rows above.
- Check: `tsc --noEmit`, `eslint`, `vitest`, the existing
  `scripts/tmp-e2e-onboarding.ts` on the mock e-sign provider still passes,
  `grep -ri "otp\|sms\|fast2sms" src/` shows nothing left except unrelated
  words (for example the mobile PIN login, which is not OTP — leave it).

**L2. Watermark.** In `loi-pdf.ts`, on every page: the app's gold crest logo
(resolved 2026-10-03, see decision 7 — the same artwork as the favicon and
the LOI header's wordmark, not text) diagonal (about 45°), centred, low
opacity (about 0.08-0.12), sized to the page; drawn **before** the sha256 is
taken so the hash covers it. It must not hide text or signature boxes. The
LOI ends with a signature page of fixed layout (franchisee block, then the
director/"For Franchisor" company block, which the approved template
already has; no legal wording changed for this step).
Already-released
versions are not regenerated. The mock provider's "TEST SIGNATURE — NOT LEGALLY
BINDING" stamp stays on mock output. Generate a sample PDF, send it to Apoorv,
adjust once if he asks. Unit test: page count unchanged, watermark text present
on each page, hash computed after drawing.

**L3. Edit the LOI before sending.** Ask Apoorv for his LOI template file now.
Compare it with `loi-template.ts` (the director-signed Tulsi LOI transcribed in
`727d9b9`); show him the differences in plain words; he decides which text wins.
Never invent or "improve" legal text. Then:
- A `DRAFT` `LoiVersion` gets an **Edit** screen for `LOI_PREPARER` (plus
  `ADMIN` only if `canPrepareLoi` already allows it): every template variable as
  a field, and the text of each LOI section (the `§` sections in `loi-pdf.ts`)
  in a plain multi-line box with "reset to template" per section.
- Store per-version edits on the version (for example `LoiVersion.bodyOverrides`
  JSON, section key → text, next to the existing `values` snapshot). The
  template itself is never changed by an edit.
- "Preview" regenerates the watermarked PDF from template + values + overrides.
- "Release" freezes it: final bytes, sha256, status `RELEASED`; no further edits.
  Editing after release = "New version from this" (copies values and overrides
  into a new `DRAFT`, `versionNo` +0.1); if the old one was sent for signing,
  edge case 1 applies.
- Audit: each save (which fields / sections changed, not the full text), release,
  new version.
- **Franchisee request changes:** confirm `loi-feedback-form.tsx` still works
  after L1 (franchisee writes a mandatory reason → preparer sees it in the LOI
  prep tab, sales owner sees it on the onboarding page → preparer makes a new
  version). Fix wiring only if L1 broke it.

**L4. Leegality provider (no real call yet).** `src/lib/esign/leegality-provider.ts`
implementing the existing interface, selected by `ESIGN_PROVIDER=leegality` in
`getEsignProvider()`; the gate refuses it with a clear Admin error if
`LEEGALITY_AUTH_TOKEN`, `LEEGALITY_PRIVATE_SALT`, `LEEGALITY_PROFILE_ID` or
`LEEGALITY_BASE_URL` is missing. Adapt the interface minimally for decision 4
(the franchisee start creates the one document with both invitees and stores
both signUrls; the company start reuses that document and opens invitee 2's
link). Add `EsignAttempt.providerSignUrl` (nullable, server-only; never sent to
the wrong user, never logged) if no suitable column exists. Vitest with a
mocked `fetch`: exact URL, headers and body; success only on 2xx and
`status === 1`; `status: 0` → failure with messages; timeout (15 s) → failure,
no retry; `mac` check with Leegality-shaped fixtures (right, wrong, missing);
details mapping per invitee; 15-second download handled; token never appears
in any log line or error. Add the wallet line. Here Claude Code asks Apoorv for
the token and salt (into `.env.local`), the Workflow ID, the API payload JSON,
and the production domain, and gives him the sample PDF for the workflow.
Compare the downloaded payload with the request this section describes and
report any difference before L6.

**L5. Wire the webhook + start actions for Leegality.** Webhook rules above;
start actions call the provider and redirect to the signUrl (with
`redirectUrl`); `/signing/[id]` shows the company button only after the
franchisee attempt is `COMPLETED` and only to invitee 2; on company completion
download signed PDF + audit trail into B2 (sha256 each), then the existing
conversion runs; on franchisee completion also download the half-signed
document into B2 (it is lost if the Leegality document is later deleted). Tests
with fixtures: duplicate webhook harmless; replayed webhook with a valid `mac`
but a document that the details API says is unsigned changes nothing;
rejection becomes feedback; expiry handled; company cannot start before the
franchisee; the `verification` object is never stored.

**L6. One real test (human-gated, 2 credits).** Only after blockers 1-2 and
Apoorv's go. Run locally against production Leegality (webhooks cannot reach
`localhost`, so use the Admin reconcile button), or on a Vercel preview with
the env vars set. Use a TEST onboarding whose LOI says TEST. Apoorv (or a
colleague) signs as franchisee, a second person as company signatory. Log:
create response, both signUrls, signing experience, webhook (if reachable),
details response shape, downloaded files, credits used, and whether the empty
IP whitelist was accepted. Then delete the TEST onboarding and its files
(not the Leegality audit, which we cannot delete without losing it; note its
documentId).

**L7. Go live.** Apoorv sets in Vercel: `ESIGN_PROVIDER=leegality`,
`LEEGALITY_BASE_URL=https://app1.leegality.com/api`, `LEEGALITY_AUTH_TOKEN`,
`LEEGALITY_PRIVATE_SALT`, `LEEGALITY_PROFILE_ID`, optional
`LEEGALITY_LOW_CREDITS`; **unsets** `ALLOW_MOCK_ESIGN_IN_PRODUCTION`; removes any
SMS/OTP variables (`SIGNING_METHOD`, `SMS_PROVIDER`, `OTP_HMAC_SECRET`,
`ALLOW_MOCK_SMS_IN_PRODUCTION`, `FAST2SMS_*`); runs the production migration.
Claude Code gives the exact list and the migration command, and checks the
deployed `/admin/esign-events` shows the wallet line.

**L8. Verify and log.** Playwright (desktop + phone) on the **mock** e-sign
provider: the whole section 17 Definition of Done still passes, plus: draft
edit → preview shows watermark → release freezes edits; franchisee request
changes → new version; replay/duplicate webhook fixtures. Delete every test
artifact; confirm Bengaluru and Ashok Vihar still have 963 tasks each. Write the
build log here **in the same session** (section 13 process note). Final report:
what works on mock, what was proven on real Leegality (L6), open blockers with
money items marked.

### Env vars (names in `.env.example`, never values)

`ESIGN_PROVIDER` (`mock` | `leegality`), `LEEGALITY_BASE_URL`,
`LEEGALITY_AUTH_TOKEN`, `LEEGALITY_PRIVATE_SALT`, `LEEGALITY_PROFILE_ID`,
`LEEGALITY_LOW_CREDITS` (optional, default 10). Existing and unchanged:
`ESIGN_WEBHOOK_SECRET` (mock only), `ALLOW_MOCK_ESIGN_IN_PRODUCTION` (must be
unset in production once Leegality is live), `ALLOW_PLACEHOLDER_LOI`,
`PAN_ENCRYPTION_KEY`, `MALWARE_SCANNER`. `COMPANY_SIGN_MODE` becomes unused
(the workflow decides the eSign type); remove it if nothing reads it.
Removed: every SMS/OTP variable listed in L7.

### Definition of done

On the mock provider, one test store completes the full flow with real role
separation, including: preparer edits a draft (a value and one section's
wording) → preview shows the watermark → release → franchisee requests changes
→ new version → franchisee signs → company signs → signed PDF and audit trail
downloadable → `FranchiseProject` created with the reserved ID. Negative tests:
company before franchisee refused; edit after release refused; wrong `mac`
refused; valid `mac` but unsigned per details API changes nothing; duplicate
webhook harmless; a second franchisee cannot reach the first store; no SMS/OTP
code, table, route or env name left. Then L6 on real Leegality once.
**Mock success is not production sign-off**, and a mocked-`fetch` test is not
proof that Leegality accepts the request; only L6 is. Say both plainly in the
final report.

### NOT DECIDED YET — ask before assuming (working default in brackets)

1. **Signing link expiry** [7 days, set in the workflow].
2. **Leegality sandbox account for free testing** [none known; mock for daily
   tests, one real production test in L6; ask Leegality support if a sandbox
   is wanted].
3. **May `ADMIN` company-sign?** Commit `4691e70` let `ADMIN` pass
   `canCompanySignNow`. With Leegality the company link belongs to the invited
   signatory and the Aadhaar signature will name whoever signs. [Only the user
   invited as invitee 2 may open it; ask Sushant ji before real use.]
4. **Aadhaar checks for the franchisee** (Leegality can verify name, year of
   birth, last 4 Aadhaar digits, etc.; a mismatch blocks signing). We hold
   `aadhaarLast4` from KYC. [off for the first release, to keep it simple;
   recommended to turn on last-4 after L6 if Sushant ji agrees; exact
   `aadhaarConfig` field names to be read from the create-request docs or the
   downloaded payload].
5. **Company seal / organisation name on the company signature** [off; the
   signature page already names the franchisor via the director/"For
   Franchisor" block].
6. **Exact watermark content and look — resolved 2026-10-03.** The app's
   gold crest logo (same artwork as the favicon and the LOI header's
   wordmark) — not text. Two earlier drafts said text ("Fraterniti Foods
   Pvt. Ltd.", then corrected to "Fraterniti Luxury Pvt Ltd" to match the
   approved LOI's actual franchisor name) before Apoorv asked for the logo
   instead. Diagonal, ~45°, opacity ~0.1. See step L2's build log.
7. **What exactly is editable in a draft LOI** [all template variables + the
   wording of each section for that one LOI; the template file itself only
   changes when Apoorv provides a new approved one].
8. **Stamp duty / e-stamp on the LOI** [none; lawyer to confirm].
9. **Leegality's own completion email to the franchisee** (mandatory, carries
   the signed PDF) [accepted as is].
10. **Aadhaar retention and Leegality as a data processor** [Leegality holds
    the signed PDF and audit trail; we do not store the webhook's Aadhaar-derived
    fields; privacy owner to note alongside section 17 item 8].

### Build log

**Leegality docs read (2026-10-03, docs only; no account touched, no call
made, no code changed).** From `https://knowledge.leegality.com` (`llms.txt`
index and the `.txt` pages): Document Execution API overview (base URLs),
Quick Start, Authentication (v3 `X-Auth-Token`; v4 OAuth not used; separate
sandbox/production token and salt), How to enable API (Refresh regenerates the
token; salt only by disable/enable), Create an eSigning Request (`POST
/v3.0/sign/request`; `profileId`, `file`, `invitees`, `irn`; 15 MB; signUrl
expiry 45 minutes when null), Check Document Details (`GET /v3.3/document/details`),
Fetch Document (`GET /v3.3/document/fetchDocument`, 15-second URLs), Delete
Document (`DELETE /v3.0/sign/request`), Activate Invitation (`PUT
/v3.1/invitation/activate`, not used), Get Wallet Balance (`GET
/v3.0/wallet/balance/details`), Webhook Introduction (per-invitee success and
error URLs set in the workflow; 3 retries: immediately, +1 h, +3 h), Verify
Webhook Request (`HMAC-SHA1(documentId, privateSalt)` vs `mac`), event pages
Signer Signs / Signer Rejects / Document Expired (payload fields as listed
above), IP Whitelisting (IPv4 only, webhook source IPs; empty-list behaviour
**not documented**), Custom Webhook Headers (needs an email to Leegality
support; not used), Customise Signing Journey (`redirectUrl`), Error Reference
(auth, missing `profileId`/file/invitees, invalid names), Create a Workflow
(signers, Aadhaar type, fixed order, coordinates, link expiry, notification
channels), Aadhaar eSign type (UIDAI OTP to the Aadhaar-linked mobile; up to 3
OTP requests and 3 wrong tries; optional name/YOB/last-4 checks), Invitee
Notifications (which can be switched off and which cannot).
**Not read / not documented, so to confirm in L4-L6:** what an empty IP
whitelist means; how workflow signature coordinates behave on an API-uploaded
PDF with a different page count; the exact `aadhaarConfig` field names; the
"Reactivate Document" page (read it in L5 for edge case 2).

**L0 — what I found (recon, read-only, 2026-10-03; no code changed, no
Leegality call made).**

- **`git show --stat bccb75b`** — exact file list for the deletion in L1:
  new files `src/lib/otp/{challenge,consent,core,core.test,limits,phone,
  phone.test,request-meta}.ts`, `src/lib/sms/{index,mock-provider,
  provider}.ts`, `src/app/dev/mock-sms/{page,refresh-button}.tsx`,
  `src/components/otp-sign-panel.tsx`, `src/lib/onboarding/
  acceptance-certificate.ts`, `src/lib/onboarding/signing-method.ts`,
  `scripts/tmp-e2e-otp-signing.ts`; modified files with an OTP-only branch to
  undo: `src/lib/esign/webhook-processor.ts` (the `attempt.provider ===
  "sms_otp"` branch in `handleAttemptCompleted`, using
  `acceptance-certificate.ts` + `isMockSmsActive()`), `src/app/onboarding/
  loi/page.tsx` + `actions.ts` (the `currentSigningMethod()` ternary and
  `requestFranchiseeLoiOtp`/`verifyFranchiseeLoiOtp`), `src/app/(app)/
  signing/[id]/page.tsx` + `../actions.ts` (same shape:
  `requestCompanyLoiOtp`/`verifyCompanyLoiOtp`), `src/app/(app)/admin/
  esign-events/page.tsx` (the "Signing method" / "SMS provider" badges and
  the `sms_otp` special-casing in the table), `src/proxy.ts` (the
  `/dev/mock-sms` entry in `ALWAYS_REACHABLE_ROUTES`), `.env.example`
  (`SIGNING_METHOD`, `SMS_PROVIDER`, `OTP_HMAC_SECRET`,
  `ALLOW_MOCK_SMS_IN_PRODUCTION`); no `fast2sms` file exists anywhere (the
  Fast2SMS plan stayed plan-only, confirmed). `scripts/tmp-e2e-onboarding.ts`
  has zero otp/sms references already — confirmed independent of the removal.
  No `.gitignore` entries are OTP/SMS-specific.
- **Schema** (`prisma/schema.prisma`): `OtpChallenge`, `LoiAcceptance`,
  `OtpChallengeStatus` enum, `NotificationChannel` enum +
  `NotificationLog.channel` column, `LoiVersion.franchiseePreviewOpenedAt` /
  `companyPreviewOpenedAt` all match the plan's deletion list exactly.
  Grepped every other reference to the two `LoiVersion` preview-opened
  columns: both are set **only** by `GET /api/loi-versions/[versionId]/
  download` (as the OTP flow's "did they open the preview before verifying"
  precondition) and read **only** by `requestFranchiseeLoiOtp`/
  `verifyFranchiseeLoiOtp`/`requestCompanyLoiOtp`/`verifyCompanyLoiOtp` —
  nothing outside the OTP flow uses them, so the plan's "only if nothing
  outside the OTP flow uses them" condition is satisfied; safe to drop, and
  the download route's two `db.loiVersion.update` calls that set them come
  out too.
- **`User.phone` was made conditionally required, not left optional**:
  `bccb75b` added a `required={role === "COMPANY_SIGNATORY"}` field to both
  `new-user-form.tsx` and `edit-user-form.tsx`, plus matching Zod
  `superRefine` checks in `users/actions.ts` (`createUser`/`updateUser`) that
  reject a missing/malformed phone for `COMPANY_SIGNATORY` (and validate it
  if present for `ADMIN`, "so they can also countersign LOIs by OTP"). The
  column itself (`User.phone`) was already nullable before `bccb75b` (section
  16, site-supervisor PIN login) and stays nullable in the schema — only the
  **form/action-level requirement** is OTP-specific and needs reverting to
  optional for `COMPANY_SIGNATORY` in L1, per the prompt's "make it optional
  again" instruction. The ADMIN-can-countersign copy ("standing in for the
  company signatory") also needs removing since it's OTP-specific framing.
- **`EsignAttempt`/envelope shape finding, relevant to L4 (flagging now so
  it isn't a surprise later, not acting on it yet):** today's adapter model
  is **one envelope per attempt** — `startFranchiseeEsign` and
  `startCompanyEsign` (two separate files) each independently call
  `provider.createEnvelope()` and store the result on their own
  `EsignAttempt.providerEnvelopeId`; `webhook-processor.ts` looks up the
  attempt with `where: { providerEnvelopeId: parsed.envelopeId }` — a 1:1
  envelope-to-attempt lookup. Section 19 decision 4 needs **one Leegality
  `documentId` shared by both attempts**, told apart by `signUrl` (or
  invitee email) instead. `webhook-processor.ts`'s attempt lookup will need
  to change from "envelope id is unique to this attempt" to "envelope id
  (documentId) is shared, disambiguate by signer" — this is what L4's own
  "adapt the interface minimally for decision 4" line is flagging; confirmed
  by reading the code, not assumed.
- **Row counts, local dev DB only** (no production access from this
  environment — only a local-Postgres `DATABASE_URL` exists in `.env`;
  someone with Vercel/production DB access needs to run the equivalent query
  there):
  - `OtpChallenge`: 1 `SUPERSEDED`, 1 `VERIFIED` (2 total).
  - `LoiAcceptance`: 1.
  - `EsignAttempt` with `provider = 'sms_otp'`: 1, `COMPLETED`, role
    `FRANCHISEE`.
  - That one `sms_otp` attempt belongs to the dev DB's **only**
    `StoreOnboarding` row (brand Tulsi, "Bengaluru", `workspaceEmail
    franchisee.demo@fraterniti.co.in`) — `onboardingStatus = FRANCHISE_SIGNED`
    (not `LOI_COMPLETE`), `projectId` still null. So: **no `LOI_COMPLETE`
    onboarding signed via `sms_otp` in dev**, and this looks like a
    development test account (`...demo@...`), not a real franchisee — per
    the plan's own rule this is history that stays as-is (not a `SENT`/
    `IN_PROGRESS` attempt needing cancellation), so nothing here blocks L1
    by itself. Flagging for Apoorv's OK anyway since the question explicitly
    asks for row counts before proceeding.
  - **Unrelated but worth flagging now**: the dev DB currently has exactly
    **one** `FranchiseProject` ("Junagadh, Gujarat", 963 tasks) and **zero**
    rows matching "Bengaluru" or "Ashok Vihar" as a `FranchiseProject` (only
    the one `StoreOnboarding` test row above uses "Bengaluru" as a
    *proposed* location, never converted). `prisma/seed.ts` doesn't mention
    either name. So the repeated regression check this plan asks for after
    L1 and at L8 ("confirm Bengaluru and Ashok Vihar still have 963 tasks
    each") **cannot be performed against this local dev database as it
    stands** — those two projects either live only in a different
    environment (production?) or under different names here. Need to ask
    Apoorv which is true before L1's "ran the existing e2e script, nothing
    broke" check can be read as covering this plan's actual regression bar.
- **Legal-text discrepancy, found while reading `loi-pdf.ts`/
  `loi-template.ts` for L0's required reading, relevant to L2's watermark and
  L3's "don't invent legal text" rule — this is the most important thing in
  this report:** the director-signed, approved LOI (both the clause text in
  `loi-template.ts` line 28 and the bank-details block at line 78, plus the
  signature-block director names rendered in `loi-pdf.ts`) names the
  franchisor as **"Fraterniti Luxury Pvt Ltd"** throughout — not "Fraterniti
  Foods Pvt. Ltd." The header wordmark drawn on every page is "Fraterniti
  Luxury" / "FRATERNITY LUXURY PVT LTD" too. Section 19 decision 7 and the
  prompt both specify a **"Fraterniti Foods Pvt. Ltd." watermark**, and L3
  describes a signature block reading "For and on behalf of Fraterniti Foods
  Pvt. Ltd." if the approved template already has that wording — it does
  not; the approved template consistently says Fraterniti **Luxury**, never
  Fraterniti **Foods**. This needs Apoorv's call before L2: watermark the
  entity actually named in the approved LOI ("Fraterniti Luxury Pvt Ltd"),
  or is "Fraterniti Foods Pvt. Ltd." a different, correct legal name (e.g. a
  renamed/merged entity, or the actual signing entity versus a trading name)
  that should also start appearing in the LOI body text itself, not just the
  watermark? Not assuming either way — this is exactly the "never invent or
  reword legal wording" rule the prompt sets, applied to a watermark that
  would sit on top of every page of the clause text decided above.
- **Baseline checks, before any change (per the prompt's "test each step"
  instruction, run once now so L1's diff is measurable against a known-good
  baseline):** `tsc --noEmit` clean (no errors). `vitest run`: 5 files, 177
  tests, all passing (`otp/phone.test.ts` and `otp/core.test.ts` are 2 of
  those 5 files and will be deleted in L1 — expect 159 tests / 3 files after).
  `eslint .`: 0 errors, 7 pre-existing warnings (all unused-var warnings,
  none OTP/SMS-related, none introduced by this recon). `grep -ri "otp\|sms"
  src/` confirms the file list above is complete — no stray references
  outside it and outside the mobile PIN login (`pinHash`/`pinFailedAttempts`,
  which the prompt explicitly says to leave alone — confirmed unrelated,
  phone+PIN not phone+OTP).
- **`BLOCKERS.md`** currently holds 7 SMS-only rows (real SMS provider
  account, India DLT registration, prod env vars, prod DB migration, legal
  sign-off on OTP sufficiency, company signatory's phone number, a
  real-phone test) — all to be replaced per L1 with "dropped 2026-10-03" plus
  section 19's own 9-row Leegality blockers table.

Gave Apoorv the plain-words mental model and the open questions above in one
batch in chat; waiting for go-ahead before starting L1.

**L1 — SMS OTP removed (2026-10-03).** Apoorv's answers to L0: the dev-only
`sms_otp` test row is harmless (leave it); production row counts skipped
("no new users yet, chill out" — Apoorv's words); the Bengaluru/Ashok Vihar
regression check against this dev DB — "leave it"; the pre-existing
uncommitted plan.md rewrite + section 20D work — "commit them safely." Both
committed first (`77e7e31` section 20D search/export, `67affa8` plan.md
rewrite + L0 recon), confirming neither broke `tsc`/`vitest`/`eslint` before
touching any OTP code.

Deleted exactly the files L0 listed: `src/lib/otp/` (8 files),
`src/lib/sms/` (3 files), `src/app/dev/mock-sms/` (2 files),
`src/components/otp-sign-panel.tsx`, `src/lib/onboarding/
acceptance-certificate.ts`, `src/lib/onboarding/signing-method.ts`,
`scripts/tmp-e2e-otp-signing.ts`. No `fast2sms` file existed to delete
(confirmed in L0).

Edited (undoing the OTP-only branch in each, kept everything else):
`webhook-processor.ts` (`handleAttemptCompleted`'s `sms_otp` branch removed
— the real-provider path, previously the `else`, is now unconditional);
`onboarding/loi/actions.ts` (removed `requestFranchiseeLoiOtp`/
`verifyFranchiseeLoiOtp` + their now-unused imports, kept
`startFranchiseeEsign` and `submitLoiFeedback` — the franchisee "request
changes" feature — untouched); `onboarding/loi/page.tsx` (removed the
`currentSigningMethod()` ternary — `FranchiseeSignButton` ["Proceed to
Aadhaar e-sign"] always renders now, `OtpSignPanel` import gone);
`signing/actions.ts` (removed `requestCompanyLoiOtp`/`verifyCompanyLoiOtp` +
`loadCompanySigningContext`, kept `startCompanyEsign`); `signing/[id]/
page.tsx` (same ternary removal, `CompanySignButton` always renders,
collapsed the two `isOtpInFlight`/`isVendorInFlight` flags into one
`isSigningInFlight`); `admin/esign-events/page.tsx` (dropped the "Signing
method" / "SMS provider" badges and the `sms_otp` special-casing in the
events table — every row now shows its provider plainly); `proxy.ts`
(removed the `/dev/mock-sms` entry and `ALWAYS_REACHABLE_ROUTES` — nothing
else used that mechanism); `api/loi-versions/[versionId]/download/route.ts`
(removed the two `franchiseePreviewOpenedAt`/`companyPreviewOpenedAt` writes
— L0 had already confirmed nothing outside the OTP flow read them).

**`User.phone` requirement reverted to optional** for `COMPANY_SIGNATORY`
(and the `ADMIN` stand-in case), per the prompt's explicit instruction — in
both `new-user-form.tsx`/`edit-user-form.tsx` (dropped `required={...}`,
replaced the OTP-specific help text with a plain "Contact number on file")
and `users/actions.ts` (both `CreateUserSchema` and `UpdateUserSchema` now
only *format*-validate the phone, 10 digits, when one is actually provided
— never require it). The column itself was already nullable before
`bccb75b` (section 16) and is unchanged.

**Schema**: one new migration, `20261003160000_remove_loi_otp_signing`
(hand-written, not generated — the dev shadow-database container
(`docker compose`) wasn't running and Docker Desktop itself wasn't
reachable in this environment, so the usual `prisma migrate dev` flow
wasn't available; wrote the exact reverse of `20261001062755_
add_loi_otp_signing`'s SQL by hand, applied it with `prisma db execute`,
then marked it applied with `prisma migrate resolve --applied` so
`_prisma_migrations` stays authoritative, same end state `migrate dev`
would have produced). Drops `LoiAcceptance`, `OtpChallenge`,
`OtpChallengeStatus` enum, `NotificationChannel` enum +
`NotificationLog.channel`, and `LoiVersion.franchiseePreviewOpenedAt`/
`companyPreviewOpenedAt` — exactly L0's list, nothing more. Also applied
the already-committed, still-pending `20261003150000_add_export_audit_
action` migration in the same pass (unrelated to section 19, just hadn't
been run yet). `prisma generate` + `prisma migrate status` confirm the dev
DB is clean. No production access from this environment either way — per
Apoorv's answer to L0 question 2, this is deliberately not chased right
now.

**`.env.example`**: removed `SIGNING_METHOD`, `SMS_PROVIDER`,
`OTP_HMAC_SECRET`, `ALLOW_MOCK_SMS_IN_PRODUCTION`; added the names (no
values) for `LEEGALITY_BASE_URL`, `LEEGALITY_AUTH_TOKEN`,
`LEEGALITY_PRIVATE_SALT`, `LEEGALITY_PROFILE_ID`, `LEEGALITY_LOW_CREDITS`
ahead of step L4, since section 19's own env-var list calls for the names
to be documented regardless of which step wires them up; no secrets
involved since all values are empty. `COMPANY_SIGN_MODE` is untouched —
it's section 19's own L4-era cleanup item ("remove if nothing reads it"),
not part of the OTP deletion list, so left alone this step.

**`BLOCKERS.md`**: replaced in full — every SMS row closed with "dropped
2026-10-03", replaced with section 19's 9-row Leegality blockers table
(Leegality API+token+salt, workflow setup, credits, production domain,
Vercel env vars + migration, company signatory's legal name, the approved
template / Luxury-vs-Foods naming question, the one real L6 test, and the
stamp-duty legal question).

**Checks**: `tsc --noEmit` clean (after regenerating `.next/dev/types`,
which this session's own `rm -rf .next/dev/types` had wiped — a self-
inflicted gap, not a real break: Next's ambient `PageProps`/`RouteContext`
types live there and aren't checked into git). `eslint .`: 0 errors, same 7
pre-existing unrelated warnings as L0's baseline. `vitest run`: 3 files,
150 tests, all passing (down from L0's baseline of 5 files/177 tests by
exactly the 2 deleted OTP test files/27 tests — `otp/phone.test.ts` had 9,
`otp/core.test.ts` had 18, matching L0's prediction once corrected: 177-27 =
150, not the "159" L0 guessed from a wrong subtraction). `grep -ri
"otp\|sms" src/` afterward: only two pre-existing, unrelated hits left
(`User.phone`'s own doc-comment "no OTP/SMS" referring to supervisor PIN
login, and `aadhaarLast4`'s "never OTP/biometric" comment on
`KycSubmission`) plus one stale comment this step also fixed (`parse-csv.ts`
referenced the now-deleted `otp/core.ts` as a precedent example — repointed
to `state.ts` alone).

**`scripts/tmp-e2e-onboarding.ts` — could not be run to a passing result,
for two reasons unrelated to this step's own changes, not a regression it
caused:**
1. The script hardcodes logging in as `tech@fraterniti.co.in` using
   `SEED_DEV_PASSWORD`. That account is seeded with the dev password at
   `seed.ts` time, but it is also the real Admin's actual login (the
   address this plan's own front-matter lists as "the user's email") — its
   live password no longer matches the seed default, almost certainly
   because the real Admin changed it since the last seed run. Confirmed
   with a standalone login-only check: real login + a real password works
   and sets a cookie correctly (so nothing in this step's `proxy.ts`/
   session-touching edits broke auth); the seed password against that
   specific account does not. Did **not** touch or reset that account's
   password (a real person's live credential), and did not run `npm run
   db:seed` either, since the one `upsert` for that user would silently
   overwrite that same password back to the dev default. Worked around it
   for this one diagnostic run only by minting a disposable
   `e2e-admin@example.com` ADMIN account (same pattern the script already
   uses for its other throwaway accounts), running once, then `git
   checkout`-ing the script back to its committed form and deleting the
   temp account — nothing about this is left in the repo.
2. With that unblocked, the very next step — admin fills the "New Store
   Onboarding" form — also failed: the form no longer matches the script
   (`git log` shows `src/app/(app)/store-onboarding/new/new-onboarding-
   form.tsx` was reshaped by `e73ca2a` "can add existing user in an
   onboarding form", a commit with no connection to section 19, to support
   picking an existing user instead of only creating one). The script was
   never updated to match.

Both issues predate this session's section 19 work and sit upstream of
every line this step touched (login/session code and the onboarding-create
form are both outside this step's edit list). Section 17's own build log
already flagged this exact script as "code-complete but unverified... never
run to a passing result" before today — this is further confirmation of
that gap, not a new one. **Did not attempt to fix the onboarding-form drift
or touch the real Admin's password** — both are out of scope for an SMS-OTP
removal step and the second one needs Apoorv's steer on which form shape is
now correct. Everything this step *could* verify without that script —
unit tests, typecheck, lint, a real login+cookie round trip, and a close
manual read of every touched file — passed clean.

**Cleanup**: no test artifacts left behind (the one partial e2e run's users/
onboarding were deleted by the script's own `finally` block even though the
run failed partway; confirmed zero `e2e-*`/`@example.com` rows and the
`StoreOnboarding` count back to the pre-run baseline of 1 afterward). One
unrelated, pre-existing stray row noticed in passing and **not** touched:
a `LoiTemplate` named "Tulsi Standard LOI" that predates this session (not
created by today's partial run, which never got far enough to create a
template) — flagging it, not cleaning it, since its origin isn't known.

Committed as its own step (not yet pushed, per standing instruction).

**Open for Apoorv, carried forward to L2:** the "Fraterniti Luxury Pvt Ltd"
vs. "Fraterniti Foods Pvt. Ltd." naming question from L0 — not yet
answered, still blocking the watermark text choice.

**L2 — Watermark (2026-10-03).** Apoorv's first answer: use "Fraterniti
Luxury Pvt Ltd" as the watermark text (resolved — see decision 7 and NOT
DECIDED #6 above, updated in place rather than left as a dangling "Foods"
reference). Worth noting for the record: the approved template's own UPI
handle (`loi-template.ts` line 81,
`fraternitifoodspvtlt.63002677@hdfcbank`) reads as "fraterniti foods pvt
lt" once run together — almost certainly where "Fraterniti Foods Pvt. Ltd."
crept into this section's original draft, even though the legal name used
everywhere else in the same template (the §INTRO clause, the bank account
name, both directors' blocks in `loi-pdf.ts`) is consistently "Fraterniti
Luxury Pvt Ltd." No legal wording was changed anywhere.

A first version built exactly that — a diagonal text watermark reading
"Fraterniti Luxury Pvt Ltd" — but before it was committed Apoorv asked for
a different look: use the same gold crest logo already used for the app's
favicon (`src/app/favicon.ico`) instead of text. Confirmed the favicon's
largest embedded icon frame and `loi-assets.ts`'s existing
`FRATERNITI_LOGO_PNG_BASE64` (already used, unrotated and opaque, in the
LOI's own page header) are the same crest artwork, so no new asset was
needed — just reused the image already embedded once per page for the
header, drawn a second time as the watermark.

`loi-pdf.ts`: `drawWatermark(page, logo: PDFImage)` (replacing the earlier
text version) draws that logo diagonal at 45°, opacity 0.1, sized to ~55%
of the page's shorter side. Centering a *rotated image* needed its own
geometry, different from text: `drawImage`'s `x`/`y` is the image's
bottom-left corner *before* rotation, not its visual center, so landing the
rotated image's center on the page's center means walking back from the
page center by the *rotated* offset of the image's own local center
(`(w/2, h/2)` relative to its corner) — documented inline with the
rotation-matrix math, since it's not obvious from the pdf-lib API alone.
Still called once per page via `doc.getPages()`, **after** all
content/pages are drawn and **before** `doc.save()`/the sha256 is computed,
so the hash covers it (decision 7's own requirement) — that part of the
design didn't change when text became an image.

`loi-pdf.test.ts` (3 tests, the exact three the plan asked for) had to be
rewritten once the watermark stopped being searchable text. What's tested
now: page count is unchanged and deterministic across two identical calls;
the returned `sha256` matches an independent hash of the exact returned
bytes *and* every page of those same bytes carries the watermark's
rotation signature (proving the hash covers it, not just that a hash
exists); `drawWatermark` leaves that same signature on an isolated blank
document exactly once per page (ruling out the header's own, unrotated
copy of the same logo as a false positive). The signature used is the
`cos(45°) = sin(45°) ≈ 0.70710678` constant in the image's `cm` rotation
matrix — nothing else in `loi-pdf.ts` rotates anything, so it's a reliable,
content-independent fingerprint; one watermark draw call produces exactly
4 occurrences of that digit string (the matrix has it twice as `cos`, twice
as `±sin` — the sign doesn't change the substring), which is what the
isolated-page test asserts. Getting this working surfaced two mechanics
worth recording: (1) `loi-pdf.ts` carries `import "server-only"`
(deliberate — guards against accidental client-bundling — left untouched);
outside Next's own bundler that package unconditionally throws, so the
test file stubs it via `vi.mock("server-only", () => ({}))`, scoped to
that one file. (2) pdf-lib flate-compresses page content streams by
default, so nothing is a plain substring of the saved bytes either way —
the test decodes each page's own `/Contents` stream through pdf-lib's own
filter decoder (`decodePDFRawStream`, the exact inverse of what it just
compressed) rather than hand-rolling PDF parsing.

Generated a real sample twice via a throwaway script (loaded the actual
approved "Tulsi Standard LOI" template from the dev DB — read-only,
confirmed both times the DB's `LoiTemplate` table was untouched, both its
rows predate this session, 2026-09-26 and 2026-09-28), wrote `sample-loi-
watermarked.pdf` to the repo root (`*.pdf` is gitignored) each time,
deleted the throwaway script after. Visually confirmed on all 4 pages of
the final (logo) version: the crest reads clearly, diagonal, doesn't hide
any clause text, the signature blocks, the bank details, or the payment
QR; the near-empty page 3 (just a trailing sentence) is watermarked too,
confirming it isn't somehow skipped on sparse pages.

Checks: `tsc --noEmit` clean, `eslint .` 0 errors (same 7 pre-existing
warnings), `vitest run` 153/153 passing (150 carried over from L1 + 3 new).
Already-released versions are not regenerated by this change (L2's own
rule) — `generateLoiPdf` is only ever called to produce a *new* version;
nothing re-saves an existing `LoiVersion.pdfB2Key`.

Committed as its own step.

**L3 — Edit screen built; template-file comparison still outstanding
(2026-10-05).** Built the generic "edit a DRAFT's wording/values" machinery
this step describes. Did **not** yet do the step's own first instruction —
"ask Apoorv for his LOI template file, compare it with `loi-template.ts`,
show the differences" — that's a separate, orthogonal deliverable (it's
about whether the *approved template's own text* should change) from the
override machinery below (which lets a DRAFT's *per-version* wording be
customized without ever touching the template). Built the machinery first
since it needs no input from Apoorv; now stopping at the plan's own L3 stop
point to ask for the template file before calling L3 done.

**Schema**: `LoiVersion.bodyOverrides Json?` — section marker (e.g. `FEES`,
`SERVICES`) to replacement text; an absent key means "use the template's
own text." New migration `20261005120000_add_loi_version_body_overrides`
(hand-written again — Docker Desktop/the shadow DB container still isn't
reachable in this environment, same workaround as L1: `prisma db execute`
then `prisma migrate resolve --applied`). Grepped every other `Json`/`Json?`
column in the schema first to confirm the column type (`JSONB`, not `JSON`)
matches the existing convention (`AuditEvent.oldValue`/`newValue`,
`LoiTemplate.requiredFields`, `LoiVersion.values`,
`SalesImportBatch.errors` all use `JSONB`) — it does. `prisma generate`
initially failed with `EPERM` on the query engine `.dll` because a `next
dev` server left running from earlier in this session (started to
regenerate `.next/dev/types` after L1) still held a lock on it; killed that
process, then `generate` succeeded cleanly.

**`loi-pdf.ts`**: exported `LOI_SECTION_LABELS` (the ordered §SECTION keys
with human labels an editor should show — `TITLE`, `INTRO`, `DEFS`, `FEES`,
`SERVICES`, `ROYALTY`, `CONFIDENTIAL`, `GOVERNING`, `BANK`) and
`getTemplateSectionDefaults(templateBody, values)` (the template's own
rendered text per section — the "reset to template" target).
**Deliberately excluded `FIELDS`** from `LOI_SECTION_LABELS` — it's the one
section whose rendered text is `{{aadhaarMasked}}` interpolated directly,
and letting it be freely overridden would be a back door around
`maskAadhaar()`'s P1-04 hard rule, not just a wording tweak. `generateLoiPdf`
now accepts an optional `sectionOverrides?: Record<string, string>`;
applied after the template's own sections are rendered, with a second,
belt-and-suspenders guard inside `generateLoiPdf` itself that drops a
`FIELDS` key even if one somehow arrived in `sectionOverrides` — the hard
rule is enforced where the PDF is actually drawn, not only in the one
caller that currently respects it.

**`loi-actions.ts`**: three new actions.
- `updateLoiDraft` — edits a DRAFT's variables (territory, fee amount →
  `feeAmount`/`feeInWords`, issue date, company name for `entityType ===
  "COMPANY"`; never `aadhaarMasked` [KYC-derived] or `versionNo`
  [system-assigned]) and section text, regenerates the PDF **in place**
  over the same `pdfB2Key` (a DRAFT's bytes were never sent anywhere, so
  overwriting is a plain replace, same as any other B2 `PutObjectCommand`),
  re-hashes, and only stores a section as an override when its submitted
  text actually differs from `getTemplateSectionDefaults`'s text for that
  key — keeps `bodyOverrides` matching its own documented "absence = use
  template" semantics instead of silently copying every section on every
  save. Audits which *fields*/*sections* changed, never the full text (the
  step's own instruction).
- `resetLoiSection` — deletes one section's override key, regenerates,
  re-hashes, audits.
- `newLoiVersionFromCurrent` — "New version from this": for a RELEASED+
  version (immutable per P1-11, so `updateLoiDraft` refuses it), copies
  `values` and `bodyOverrides` verbatim into a fresh DRAFT at `versionNo
  +0.1`, reusing `generateLoiVersion`'s existing void-current-version-and-
  cancel-its-non-terminal-attempts logic rather than duplicating it.

**New UI**: `loi-edit-panel.tsx` (client component) + wired into
`store-onboarding/[id]/page.tsx` next to the existing `LoiPrepPanel`, shown
only when `canPrepareLoi(user)` and a `currentLoiVersion` exists. DRAFT:
the variable fields plus one `Textarea` per non-`FIELDS` section with a
"Reset to template" button next to any section currently overridden.
RELEASED+: just the "New version from this" button. `page.tsx` computes
`sectionDefaults` server-side via `getTemplateSectionDefaults` against the
**version's own linked template** (`currentLoiVersion.template.body`), not
whatever template is newly "active" — matters if a different template gets
approved later, since `updateLoiDraft`/`resetLoiSection` also regenerate
against the version's own template, and the edit screen's "reset" target
has to match what regeneration will actually produce. One real bug caught
and fixed before this was reported done: each `Textarea` is uncontrolled
(`defaultValue`), so clicking "Reset to template" — which changes state on
the *server*, not inside that input's own DOM node — would otherwise leave
the stale text on screen after the page revalidates; fixed by keying each
`Textarea` on override-presence (`` `${key}-${key in bodyOverrides ?
"override" : "default"}` ``) so React remounts it with the right text
exactly when that presence flips, and leaves it alone (no flicker) on a
plain save where the DOM already matches what was just submitted.

**Confirmed unaffected**: `loi-feedback-form.tsx` and its
`submitLoiFeedback` wiring — read both in full, neither references
anything this step or L1 touched.

**Checks**: `tsc --noEmit` clean. `eslint` on every touched/new file: 0
errors, 0 warnings (matched the existing `// eslint-disable-next-line
@typescript-eslint/no-unused-vars` convention on `newLoiVersionFromCurrent`'s
unused `_prevState`/`_formData`, same as the pre-existing
`releaseLoiVersion`). `vitest run`: still 153/153 (no new test file this
step — the new logic is server actions wired to `requireUser()`/B2/Prisma,
which the existing `loi-pdf.test.ts` pattern can't exercise without a
request context; covered instead by a manual trace confirming every
`formData.get(...)` key in `loi-actions.ts` matches the `name`/`name={...}`
attributes `loi-edit-panel.tsx` actually submits). **Not run: a live
browser/Playwright check of the new edit screen** — no browser-automation
tool is available in this session (checked; `@playwright/test` is a
devDependency but no Playwright config or test files exist in the repo), so
this UI has only been verified by typecheck, lint, and manual code reading,
not by actually clicking through it. Flagging this explicitly rather than
claiming it's been seen working.

Committed as its own step (not pushed, per standing instruction).

**Stop point hit — the plan's own first L3 instruction, not yet
answered:** need Apoorv's actual LOI template file to compare against
`loi-template.ts`'s `TULSI_LOI_BODY` before L3 can be called done.

**Apoorv's answer (2026-10-05): "haa go"** — confirmed, no separate
template file to reconcile; `loi-template.ts`'s current text stands as-is.
**L3 done.**

**L4 — Leegality provider adapter, no real call made (2026-10-05).** Read
`src/lib/esign/{provider,index,mock-provider,webhook-processor}.ts`, both
start actions (`onboarding/loi/actions.ts`'s `startFranchiseeEsign`,
`signing/actions.ts`'s `startCompanyEsign`), `/admin/esign-events`, the
public webhook route, and section 19's own API-contract/webhook/edge-case
text in full before writing anything, per this step's own instruction.

**Interface change, scoped deliberately narrow.** Decision 4 (one shared
Leegality document, two invitees, fixed order) cannot be expressed by
today's `createEnvelope(signer) -> {envelopeId, signingUrl}`, called
independently by each start action. The *full* fix — both start actions
sharing one document, and `webhook-processor.ts`'s attempt lookup changing
from "`providerEnvelopeId` is 1:1 with one attempt" to "shared, disambiguate
by signer" — is explicitly step L5's own heading ("wire the start actions
... webhook rules above"), not this one. Rewiring that now, without L5's
matching-logic fix landing in the same change, would have put two
`EsignAttempt` rows behind the same `providerEnvelopeId` while
`webhook-processor.ts`'s `findFirst` lookup stayed non-deterministic between
them — a real regression risk to the mock flow, which must keep passing.
So the interface change here is **additive only**: `CreateEnvelopeInput`
gained optional `coSigner`/`reference`; the return type gained optional
`coSigningUrl`; `ParsedWebhookEvent` gained optional `invitationUrl`/
`inviteeEmail`. Every existing caller (both start actions, the mock
provider) is unaffected — they don't pass or read the new fields, so
`tsc`/the full `vitest run` are byte-for-byte unchanged from L3's baseline
except for the new test file below. `LeegalityProvider.createEnvelope`
*requires* `coSigner` and throws a clear error without it (a single-invitee
document would violate decision 4) — L5 is what actually makes a start
action pass it.

**`src/lib/esign/leegality-provider.ts` (new)** implements the full
"Leegality API contract" table: `createEnvelope` (`POST /v3.0/sign/request`,
both invitees, `irn`), `getStatus` (`GET /v3.3/document/details`, maps
`document.status` to our `EnvelopeStatus` — conservatively, since the docs
only pin down `Draft`/`Sent`/`Completed`; unrecognized values fall back to
`SENT` rather than guessing a terminal state), `voidEnvelope` (`DELETE
/v3.0/sign/request` — just the delete; downloading whatever exists *first*
is the caller's job per edge cases 1-2, not this method's), `fetchSignedPdf`/
`fetchCertificate` (`GET /v3.3/document/fetchDocument`, the two
`documentDownloadType`s, downloading the 15-second CDN URL immediately),
`parseAndVerifyWebhook` (mac = `HMAC-SHA1(privateSalt, documentId)`,
constant-time compare — decision 6: this only proves the doorbell rang, so
it returns `invitationUrl`/`inviteeEmail` for L5 to actually match against
a stored attempt, not a final per-signer idempotency key yet), and
`getLeegalityWalletBalance()` (5-minute cache, `null` on any failure,
exported standalone since it isn't part of `EsignProvider`). Every request
goes through one shared `leegalityRequest()` helper: `X-Auth-Token` header,
15s timeout via `AbortController` with **no retry** (edge case 3 — a retried
create could spend credits twice), success = HTTP 2xx **and** `status ===
1`, and every thrown error message is built only from Leegality's own
`messages`/HTTP status — the auth token and private salt are never
interpolated into a log line or error, checked by a dedicated test.

**`src/lib/esign/index.ts`**: `getEsignProvider()` now has a `leegality`
branch, gated on `LEEGALITY_AUTH_TOKEN`/`LEEGALITY_PRIVATE_SALT`/
`LEEGALITY_PROFILE_ID`/`LEEGALITY_BASE_URL` all being set (this step's own
instruction) — missing any of them throws one clear Admin-facing error
naming exactly which are missing, checked once here rather than scattered
across every `LeegalityProvider` method.

**Schema**: `EsignAttempt.providerSignUrl String?` (server-only; this
step's own instruction — "if no suitable column exists," and none did) —
holds the co-signer's signUrl once L5 actually wires `createEnvelope`'s
`coSigner` path, so `startCompanyEsign` can reuse it instead of a second
provider call. New migration `20261005140000_add_esign_attempt_provider_
sign_url` (hand-written again, same `prisma db execute` + `migrate resolve`
workaround as L1/L3 — the shadow DB still isn't reachable in this
environment). Nothing writes to this column yet.

**`/admin/esign-events`**: added the wallet-balance banner this step's own
text calls for ("Add the wallet line") — shown only when the configured
provider is `leegality` and the (cached, failure-tolerant)
`getLeegalityWalletBalance()` call returns a number below
`LEEGALITY_LOW_CREDITS` (default 10).

**Generated a sample LOI PDF** for the Leegality workflow setup ("Document:
upload one generated sample LOI PDF (Claude Code provides it in step L4)")
via a throwaway script — read-only against the dev DB's active template
(confirmed untouched afterward), deleted the script after running it.
Written to the repo root as `leegality-workflow-sample.pdf` (`*.pdf` is
gitignored).

**Tests** (`leegality-provider.test.ts`, 22 new): exact URL/method/headers/
body for `createEnvelope`/`getStatus`/`voidEnvelope`; `status: 0` failure
surfaces Leegality's own message; non-2xx fails even if the body claims
`status: 1`; 15s timeout with no retry (`vi.useFakeTimers` +
`AbortSignal`-driven fetch mock, advanced synthetically rather than waiting
15 real seconds); the auth token/private salt never appear in a thrown
error's message; `fetchSignedPdf`/`fetchCertificate` make exactly two fetch
calls (the API call, then the CDN URL) and return the CDN body's actual
bytes; `parseAndVerifyWebhook` accepts a correctly-signed fixture and
rejects a wrong or missing `mac`, and maps `Rejected`/`expired` correctly;
wallet balance caches across a second call and returns `null` (never
throws) on failure. One real bug caught by this suite and fixed before it
was reported done, worth recording since it's a classic trap: the
`fetchSignedPdf` test's own mock originally built its fake CDN response
via `Buffer.from("signed-bytes").buffer` — Node pools small `Buffer`
allocations, so `.buffer` can expose the whole shared pool (unrelated
memory from elsewhere in the process) rather than a tightly-sized
`ArrayBuffer`; the test was intermittently reading back garbage. Fixed by
building the fixture with `new TextEncoder().encode(...)` instead, which
isn't pooled — a test-fixture bug only, `downloadDocumentFile`'s own
production code was never wrong (a real `Response.arrayBuffer()` is always
correctly sized).

**Checks**: `tsc --noEmit` clean. `eslint` on every touched/new file: 0
errors, 0 warnings. `vitest run`: 175/175 (153 carried over + 22 new).

**Not done in this step, by design — carried to L5/L6 per the plan's own
split:** `startFranchiseeEsign`/`startCompanyEsign` still call
`createEnvelope` without `coSigner` (so selecting `ESIGN_PROVIDER=leegality`
today would hit `LeegalityProvider`'s own "needs both signers" error on the
very first real call); `webhook-processor.ts`'s attempt lookup is still
`providerEnvelopeId` 1:1; the webhook route doesn't yet re-derive the final
`leegality:<documentId>:<ROLE>:<event>` idempotency key; no redirect-URL
construction; edge cases 1-2's "download then void" orchestration doesn't
exist yet. All explicitly L5's own listed work, not deferred by omission.

Committed as its own step (not pushed, per standing instruction).

**Stop point hit — this step's own instructions:** need from Apoorv (batched
in chat, per the stop-points table):
1. **Legacy Auth Token** and **Private Salt** (production; sandbox too if a
   sandbox account exists) — into `.env.local` only, never this chat.
2. **Workflow ID** (`profileId`) and the workflow's **downloaded API payload
   JSON**, after setting up the "Fraterniti LOI" workflow per this section's
   "Workflow settings" list — `leegality-workflow-sample.pdf` (repo root) is
   the sample document for placing signature boxes.
3. **Production domain** for the webhook URL (`fraterniti.one` or
   `fraterniti-one.vercel.app`).

Once given, L4 compares the real downloaded payload against this section's
documented request/response shapes (`createEnvelope`'s exact field names,
`getStatus`'s `document.status` values, etc.) and reports any difference
before L6 — then L5 can actually wire the start actions and webhook.

**L4 closed out (2026-10-05).** Apoorv set up the "Fraterniti LOI" workflow
in the Leegality dashboard by hand (Invitees screen → Franchisee + Company
Signatory, both Aadhaar-only, fixed signing order on; Custom URLs on both
invitees pointing at `https://fraterniti.one/api/webhooks/esign`; Advanced
Options → Expiry → 7 days; signature fields placed on the sample PDF's last
page, franchisee's on the blank "For Franchisee" line, company signatory's
near the "For Franchisor" block). Confirmed along the way: `/document/invite`
and `/workflow/invite` are different Leegality flows (the former is a
one-off real send, the latter — the one we need — a reusable template);
Leegality's own Aadhaar-options panel defaults (OTP/BIO/IRIS/FACE all on,
"Verify details with Certificate Details" off) need no changes; "Don't add
user name in Signature Appearance" exists but there's no documented way to
remove Leegality's own branding text from the visible signature stamp
(checked `knowledge.leegality.com` and `leegality.com/customisation` — not
listed among the things that can be white-labeled; flagged to Apoorv as a
"ask Leegality support directly if it matters" item, not resolved).

**Workflow ID = `sFExiJi`.** The downloaded API payload
(`Fraterniti LOI.json`) matches this section's documented request shape
**exactly** — `profileId` (top-level string), `file: {name, file}`,
`invitees: [{name, email}, {name, email}]`, `irn` (top-level string) — no
difference to reconcile, no adapter changes needed.
`.env.local` confirmed holding all four (`LEEGALITY_BASE_URL` — printed to
confirm it reads exactly `https://app1.leegality.com/api`, the documented
production URL, not a secret so safe to check directly; `LEEGALITY_AUTH_
TOKEN`/`LEEGALITY_PRIVATE_SALT`/`LEEGALITY_PROFILE_ID` — confirmed "set"
only, values never read or printed). Production domain confirmed:
`fraterniti.one`.

**L4 is now fully done** — every item in its own stop point is answered.
Next is L5 (wire the start actions + webhook for the shared-document
model), which touches currently-working code (`startFranchiseeEsign`/
`startCompanyEsign`, `webhook-processor.ts`'s attempt lookup) and is
substantial enough that it's worth Apoorv's explicit go-ahead before
starting, same as L2→L3 and L3→L4's own handoffs this session.

**L5 (2026-10-05) — wire the start actions + webhook for Leegality.**
Apoorv's go-ahead given in chat. Still entirely proof-of-code-path only —
no real Leegality call has been made (that's L6) — every path below is
verified against a mocked `fetch`/mocked `db`, not the real vendor.

- **`startFranchiseeEsign` (`src/app/onboarding/loi/actions.ts`)** now looks
  up the single active `COMPANY_SIGNATORY` user (errors clearly if zero or
  more than one exist — the app has no per-onboarding assignment for this
  role, section 17 never built one, so "exactly one active user with the
  role" is the one supported configuration for now; more than one is
  surfaced to Admin rather than guessed at) and passes them as `coSigner` to
  `createEnvelope`, so Leegality creates ONE shared document with both
  invitees in the one call (decision 4). The returned `signingUrl` goes to
  the franchisee now; the returned `coSigningUrl` is stored on a COMPANY
  `EsignAttempt` row created in the same transaction — pre-created, status
  `SENT`, `signerUserId` = the resolved signatory — so `startCompanyEsign`
  never needs a second Leegality call later. Both URLs get Leegality's
  `?redirectUrl=` appended (`/onboarding/loi`, `/signing/[id]`) per the API
  contract. `providerSignUrl` is now stored on the FRANCHISEE attempt's own
  row too (not just the company's), since the webhook processor needs each
  invitee's own signUrl to tell the two apart later. All of this is gated on
  `currentProviderName() === "leegality"` — the mock path (no `coSigner`,
  no pre-created COMPANY row) is byte-for-byte unchanged.
- **`startCompanyEsign` (`src/app/(app)/signing/actions.ts`)**: for
  Leegality, reuses the pre-created attempt's stored `providerSignUrl`
  directly — no provider call, no new `EsignAttempt` row, no extra credits.
  If that row or its signUrl is somehow missing (data anomaly, or the
  default edge-case-2 path after an expired link — see below), it returns a
  clear error telling Admin to check e-sign status, rather than inventing a
  parallel creation path that would restart franchisee signing from inside
  the company action. The mock path (`provider.createEnvelope` without
  `coSigner`, synchronous auto-complete) is unchanged.
- **`canCompanySignNow` (`state.ts`)** gained `actorUserId` /
  `invitedSignerUserId`. When Leegality has pinned a specific invitee 2
  (`EsignAttempt.signerUserId`), only that exact user may sign — ADMIN
  included (edge case 6: "can see status but, by default, cannot open that
  link"). `SENT` is deliberately *not* treated as "an attempt already in
  progress" for the pinned signatory — it's the one legitimate state in
  which they're meant to retrieve their stored link, not a second start to
  block. Both callers (`startCompanyEsign`, `/signing/[id]/page.tsx`) pass
  the new fields; when `invitedSignerUserId` is null (mock, or no row yet)
  behaviour is byte-for-byte what it was before L5.
- **`webhook-processor.ts`** — the core rewrite:
  - `resolveLeegalityEvent()` (Leegality only, runs before any DB
    transaction — a network call must never sit inside an interactive
    Postgres transaction): finds every `EsignAttempt` sharing the event's
    `providerEnvelopeId` (now up to two, FRANCHISEE + COMPANY, since they
    share one document), picks the one whose own `providerSignUrl` matches
    the webhook's `invitationUrl` (falls back to invitee email; if only one
    candidate exists, uses it), then — decision 6, "the webhook is a
    doorbell, not proof" — calls `getStatus(documentId)` and uses **only**
    that confirmed status downstream, never the webhook body's own claim.
    Builds the real idempotency key `leegality:<documentId>:<ROLE>:<kind>`
    from the matched signer's role and the confirmed status. A
    resolution failure (unknown document, ambiguous match, Leegality
    unreachable) is recorded as a `FAILED` `EsignEvent` using the
    provisional id, same visible-to-Admin/retryable discipline as every
    other failure path here (P1-10).
  - `processWithinTransaction` now takes the resolved idempotency key and an
    optional `attemptIdHint` — when present (Leegality), the attempt lookup
    is a precise `findUnique(id)` instead of the old `findFirst` by
    envelope, which would otherwise return an arbitrary one of the two
    rows that now share an envelope id. Mock (no hint) is unchanged.
  - **Store less**: a new `redactForStorage()` strips `invitationUrl` (a
    bearer secret) from every payload written to `EsignEvent`, at all four
    write sites. `verification` never needs stripping — it never reaches
    `ParsedWebhookEvent` in the first place (confirmed by a new explicit
    test).
  - **Rejection → LOI feedback**: a `Rejected` webhook (`rejectionMessage`
    added to `ParsedWebhookEvent`, populated by
    `LeegalityProvider.parseAndVerifyWebhook`) now writes a `LoiFeedback`
    system-actor audit event and emails the LOI preparer(s) + sales owner +
    Admin — the same `loi_feedback` channel `submitLoiFeedback` uses for a
    franchisee's own pre-signing note, labelled with which signer rejected.
  - **Franchisee-completion backup (edge case 2)**: the first time a
    FRANCHISEE attempt reaches `COMPLETED` under Leegality, the half-signed
    document is fetched and stored on two new `LoiVersion` columns
    (`franchiseeSignedPdfB2Key`/`franchiseeSignedPdfSha256` — migration
    `20261005150000_add_loi_version_franchisee_signed_backup`, applied) —
    insurance against the shared document later being voided. Guarded so it
    only runs once per version; mock path untouched.
  - Expiry needed no new code — once the right attempt is identified and
    the status is confirmed `EXPIRED`, the existing generic transition table
    handles it exactly as it always has.
- **Edge case 1 (terms change mid-signing)**: `newLoiVersionFromCurrent`
  (`store-onboarding/[id]/loi-actions.ts`) now calls
  `backupAndVoidLeegalityEnvelopes()` *before* generating the new version's
  PDF or opening any transaction — for every distinct Leegality
  `providerEnvelopeId` still `SENT`/`IN_PROGRESS` on the superseded version,
  best-effort downloads whatever document/audit-trail bytes exist (not
  fatal if there's nothing signed yet) into B2 under a `superseded-*` key,
  then calls `voidEnvelope`. If Leegality can't be reached at all, the
  action returns an error and the new version is **not** created — so a
  stale, still-open signing link for superseded terms can never linger
  (P1-11). The void results are logged into the VOID audit event's
  `newValue` for traceability. Mock path (no Leegality envelopes) is a
  no-op, confirmed by `currentProviderName() === "leegality"` gating.
- **Deferred, flagged rather than guessed at**: edge case 2's "Reactivate
  Document" API research (does it revive an expired company link without
  re-signing?) was not done this session — it needs reading a Leegality
  docs page not yet reviewed. Until then, an expired company-signing link
  falls to the plan's own stated default: Admin restarts signing manually
  (a fresh FRANCHISEE attempt, which re-invites both signers on a new
  shared document — 2 more credits). Also not built: a UI to pick a company
  signatory when more than one active one exists (errors out instead,
  per the "ask Admin to resolve" behaviour above) — not asked for, and the
  company currently has at most one such user per blocker 6.
- **Tests**: `leegality-provider.test.ts` gained `rejectionMessage`
  passthrough + an explicit "`verification` never reaches
  `ParsedWebhookEvent`" check. `state.test.ts` gained the
  `invitedSignerUserId`/`actorUserId` gate cases (allows the exact invitee,
  blocks a different signatory, blocks ADMIN from opening the link, no
  restriction when nothing is pinned yet). New `webhook-processor.test.ts`
  (11 tests, first-ever unit test for this file — needed a `vitest.config.ts`
  path-alias entry mirroring tsconfig's own `@/*`, since this is the first
  test to import a module with `@/` imports; purely additive, no existing
  test was affected) covers: disambiguation by `invitationUrl` across two
  attempts sharing an envelope, the `leegality:<documentId>:<ROLE>:<kind>`
  key format, duplicate-webhook no-op, decision 6 (webhook says COMPLETED
  but `getStatus` still says unsigned → nothing changes), unknown-envelope
  FAILED, `invitationUrl` never persisted, expiry handled, rejection →
  feedback (audit + both emails), franchisee-completion backup (and that it
  doesn't re-run once already backed up), and that the mock path never
  calls `getStatus`/`resolveLeegalityEvent` at all and keys off the
  webhook's own `eventId` exactly as before. `tsc --noEmit`, `eslint .`
  (same 7 pre-existing unrelated warnings, zero new ones), and the full
  `vitest run` (192 tests) all green.
- **Not done in this step** (by design, same reasoning as L4): the one real
  Leegality call (L6), going live (L7), and the full Playwright pass (L8).

---

