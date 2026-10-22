## 18. Email domain whitelist + Complaint/Support module — adapted from a
separate investor-onboarding SRD (2026-09-30)

**Where this came from:** a third requirements document (a Sushant-authored
SRD PDF, distinct from both `Fraterniti_One_Software_Requirement_and_
Wireframes.pdf` and `Fraterniti_One_Phase1_Onboarding_LOI_SRD.pdf` this app
was actually built against) was shared this session, describing an "investor
onboarding, KYC, LOI, Petpooja sales, complaint management" platform with a
3-role model (Investor/Sales Team/Super Admin). Section-by-section comparison
against the real codebase found almost none of it matched as specified — no
`Investor` role/concept anywhere in `src/`, no email-domain whitelist, no
Sales/Petpooja tracking, no Complaint model; LOI/KYC exist but for a
different workflow (section 17 above), and the 15-role department-based RBAC
this app actually has doesn't resemble that document's 3-role table at all.

Apoorv's instruction after seeing that gap: not a rebuild — pull the
**core ideas** that fit cleanly onto the existing model and skip the rest,
"kohli idolised sachin but took his qualities into his own game, didn't
become a copycat." The load-bearing insight that came out of that framing:
that SRD's **"Investor" persona is this app's existing `FRANCHISEE` role** —
register, KYC, view LOI, track project, track sales, raise complaints is
exactly what a Franchisee already does end-to-end via the onboarding +
project-tracking flow (section 17 + sections 4/9). So this work extends the
existing Franchisee/FranchiseProject model rather than building a parallel
Investor system.

**Decisions confirmed by Apoorv (2026-09-30, via structured question, not
silently assumed):**
1. **No self-service investor registration** — the source SRD wants direct
   investor signup; this app's 2026-09-18 decision (admin-only account
   creation, plan.md section 5) stays as-is. Explicitly rejected, not an
   oversight.
2. **OTP login — accepted for later, not built yet.** Needs an SMS/OTP
   provider decision (e.g. MSG91/Twilio) before it can start; queued behind
   the rest of this list per Apoorv's own ordering.
3. **Build order**: (1) email domain whitelist, (2) Complaint/Support
   module, (3) Sales tracking (Petpooja/CSV import), (4) dashboard widgets +
   expanded KYC document types, (5) OTP login. This section covers 1 and 2.
4. **RBAC stays as-is** — the source SRD's 3-role table is not adopted; it's
   strictly less granular than the department-based system already in place,
   collapsing it would be a downgrade, not a fix.

### 18a. Email domain whitelist (`bbf7901`)

**What shipped**: `src/lib/email-domain.ts` — a hardcoded
`APPROVED_EMAIL_DOMAINS` list (`tulsi.world`, `fraterniti.co.in`,
`zoca.co.in`) and `isApprovedEmailDomain()`, same "hardcode for Phase 1,
swap later" pattern as `FranchiseProject.brand`'s `"Tulsi"` default (section
5) — deliberately not database-driven/Admin-configurable the way the source
SRD's section 4.3 asks, per Apoorv's "no major revamp" instruction. Wired
into the exact three places a *new* account-controlling email can enter the
system, all Server Actions (so the check runs server-side, not just in the
browser, per that SRD's own "backend validation is mandatory" rule):
`createUser` and `updateUser` (`src/app/(app)/users/actions.ts`), and
`createOnboarding`'s `workspaceEmail` (`src/app/(app)/store-onboarding/
actions.ts`). Uses the source SRD's exact error copy ("Invalid Email Domain.
Please use an authorized Fraterniti Group email address."). Does not touch
any existing account — enforcement is forward-only from this commit.

`tsc --noEmit` clean; not independently browser-verified in isolation (folded
into 18b's verification pass instead, since both shipped the same session).

**2026-10-17 — temporarily disabled per Apoorv.** `isApprovedEmailDomain()`
(`src/lib/email-domain.ts`) now unconditionally returns `true`. The
`APPROVED_EMAIL_DOMAINS` list and `INVALID_EMAIL_DOMAIN_MESSAGE` are left in
place and all three call sites (`users/actions.ts` ×2,
`store-onboarding/actions.ts`) are untouched, so re-enabling is a one-line
revert in this one file. No ticket/reason given beyond "for now" — revisit
before relying on this as an actual restriction again.

### 18b. Complaint/Support module (`c52f235`)

**What shipped** — new, but built entirely by mirroring the existing
Task/Document pattern rather than inventing a new one:

- **Schema**: `Complaint` + `ComplaintComment` models, `ComplaintCategory`
  (SRD's own 9-value list: Project/Construction/Interior/Equipment/Sales/
  Billing/Documentation/Support/Other) and `ComplaintStatus` enums (reuses
  the existing `TaskPriority` enum for priority rather than adding a
  duplicate one). Project-scoped exactly like `Task`/`Document`
  (`onDelete: Cascade` off `FranchiseProject`). Attachment is a single
  optional file stored directly via `storage.ts` (new
  `buildComplaintAttachmentKey`), not through the `Document` table — a
  one-off complaint photo doesn't fit that table's category/vault shape.
  Migration: `20260930101344_add_complaint_management`.
- **RBAC**: `src/lib/complaint-categories.ts`'s
  `COMPLAINT_CATEGORY_DEPARTMENT` maps each category to the `Department` that
  owns it (e.g. `CONSTRUCTION`→`PROJECTS`, `BILLING`→`ACCOUNTS`) — a
  best-effort inference, not documented in either source SRD, easy to adjust
  in that one file. `permissions.ts` gained `canCreateComplaint` (= same gate
  as `canViewProject` — raising a complaint isn't gated by category, a
  franchisee doesn't know which department owns their problem),
  `canManageComplaintCategory` (mirrors `canManageTaskModule` via
  `ownsDepartment`), and `canActOnComplaint` (mirrors `canActOnTask`'s exact
  shape: category owner, current assignee, or the franchisee on their own
  project). Assigning staff is gated narrower than "can act" —
  `canManageComplaintCategory` only — so the franchisee who raised a
  complaint can't reassign it to someone else.
- **Actions** (`src/app/(app)/complaints/actions.ts`): `createComplaint`
  (optional attachment, 15MB cap, PDF/JPG/PNG/WEBP only — same judgment-call
  shape as `document-actions.ts`), `updateComplaintStatus` (sets/clears
  `resolutionDate` on RESOLVED/CLOSED/REOPENED), `assignComplaint` (also
  auto-advances `OPEN`→`ASSIGNED`), `addComplaintComment`. All four audit
  CREATE/UPDATE via the existing `writeAuditEvent`; comments themselves
  aren't individually audited, same discipline as `addTaskComment`.
- **UI**: `ComplaintCard`/`NewComplaintForm`/`ComplaintList`
  (`src/app/(app)/complaints/`) mirror `TaskCard`/`NewTaskForm`/`TaskList`
  closely — collapsible card, status-update + assign + comment-thread inside,
  search/category/status filters with "load 10 more". Wired into the project
  detail page as a fourth section (`#complaints`, alongside Overview/Tasks/
  Documents) with a new "Open Complaints" stat tile, and into a new
  portfolio-wide `/complaints` page (mirrors `/documents`'s franchisee-
  isolation/`?project=` scoping) plus a sidebar entry.

**Real bug found and fixed during verification**: `NewComplaintForm`'s field
`id`s (`category`, `priority`, `description`) collided with pre-existing
`id`s already on the same project detail page — `DocumentUploadForm` already
uses `id="category"`, `NewTaskForm` already uses `id="priority"` and
`id="description"`. Duplicate HTML `id`s broke `<Label htmlFor>` association
and made the form untestable by role/label. Fixed by prefixing every field in
the new form (`complaint-category`, `complaint-priority`,
`complaint-subject`, `complaint-description`, `complaint-attachment`) — no
other form in the app had this problem since each was built in isolation
before this one had to coexist on the same page.

**Verified against the real dev DB and a real browser session (Playwright)**,
same bar as every other section: logged in as `pm.demo@fraterniti.co.in`
(PROJECT_MANAGER — chosen because `CONSTRUCTION`→`PROJECTS` gives it
`canManageComplaintCategory` on the test category), confirmed `/complaints`
renders, opened a live project, raised a complaint end to end (category,
subject, description — attachment field present but not exercised in this
pass), confirmed it appears with a `CMP-00001`-style code and zero console
errors, assigned it (auto-advanced OPEN→ASSIGNED, confirmed in the DOM),
moved it to IN_PROGRESS, added a comment, confirmed all three persisted
across a hard reload. Not independently re-queried at the DB layer to
confirm the audit trail (unlike sections 9/10/11's DB-level spot checks) —
worth a quick check before treating this as fully closed, though the code
path is the same `writeAuditEvent` call already proven elsewhere.

**Incidental, same session**: the local Postgres shadow database (Docker,
port 5433 — see schema.prisma's own comment) wasn't running at session
start; starting it was needed before `prisma migrate dev` would work. Once
up, `prisma generate` hit a Windows `EPERM` file-lock on the Prisma query
engine `.dll` — caused by an already-running `npm run dev` (started before
this session) holding it open. Stopped those processes, regenerated
successfully, then restarted `npm run dev` for the Playwright pass above —
worth knowing if anyone else had that dev server open and lost it mid-session.

**Still open, per the build order in this section's own "Decisions"**: Sales
tracking (Petpooja/CSV import), dashboard widgets (profile completion %, LOI
status, sales/complaint summaries) + expanded KYC document types (Address
Proof/Photograph/Bank Statement/Cancelled Cheque/GST), and OTP login (blocked
on an SMS/OTP provider decision) — none of these four are built yet.

**Update 2026-10-01:** these remaining items are now specified in section 20
(OTP *login* is optional there; OTP for LOI *signing* is section 19).
**Update 2026-10-03:** LOI signing is now Aadhaar eSign on Leegality (section
19); there is no SMS in the app, so OTP login has no provider and is parked.

---

