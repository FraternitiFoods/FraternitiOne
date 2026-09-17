# Fraterniti One — Build Plan (Phase 1: Foundation)

> **How to use this file (for whoever is implementing, including Claude Code):**
> This is a living plan, not a one-shot spec. Anything under "NOT DECIDED YET"
> must be asked about and confirmed before you write code that depends on it —
> do not silently pick a default. When a decision gets made, move it from
> "NOT DECIDED YET" into the relevant section above it and update this file.

---

## 1. Context

Fraterniti One replaces manual Excel trackers (site lifecycle tracker, vendor
status tracker, individual department sheets) with one system: one franchise
= one Project ID, everything else (tasks, documents, approvals, payments)
attaches to it. Full source spec: `Fraterniti_One_Software_Requirement_and_Wireframes.pdf`
(sections referenced below).

This plan covers **Phase 1 only**, per the SRD's recommended delivery phases (section 16):
Auth/RBAC, Project master, Lifecycle, Home dashboard, Action Centre, Documents, Tasks, Audit.

## 2. Explicitly OUT of scope for this plan

Do not build these yet, even if referenced in the SRD:
- Sales/Legal/Interiors/Projects/DPR module screens (Phase 2)
- Approval workflow logic (FR-004) — full version is Phase 2; Phase 1 only needs
  a placeholder list view in Action Centre, not the approve/reject engine
- Payment schedules, invoices, CRM (FR-006) — Phase 2
- HR, Culinary, Procurement, Marketing modules — Phase 3
- Readiness score, blocker/dependency engine (FR-007, FR-008) — Phase 4
- Notifications (WhatsApp/email/SMS) (FR-009) — Phase 4/deferred
- Management Command Centre, portfolio-level views — Phase 4

## 3. Phase 1 scope — functional requirements in play

| FR ID  | Requirement                                                        |
|--------|---------------------------------------------------------------------|
| FR-001 | One Project ID created at onboarding; everything attaches to it     |
| FR-002 | Lifecycle stage, progress %, target opening, owner, next action on dashboard |
| FR-003 | Task workflow — owner, due date, priority, dependency, status, comments |
| FR-005 | Document vault with categories and version history                  |
| FR-010 | Full audit log — actor, timestamp, old/new value, reference          |

## 4. Data model (Phase 1 entities only)

Everything hangs off `FranchiseProject`. This is the one relationship that
must not break — every other entity references `project_id`.

```
                         ┌────────────────────────┐
                         │   FranchiseProject     │
                         │  project_id (PK)       │
                         │  brand, format,        │
                         │  franchisee_id,        │
                         │  location,             │
                         │  lifecycle_stage,      │
                         │  target_opening        │
                         └──────────┬─────────────┘
              ┌───────────┬─────────┼──────────┬──────────────┐
              │           │         │          │             │
         ┌────┴────┐  ┌────┴─────┐ ┌┴─────────┐┌┴──────────┐┌┴───────────┐
         │  Task   │  │Document  │ │ User/    ││AuditEvent ││ (Approval  │
         │task_id  │  │document  │ │ Org      ││event_id   ││ stub only, │
         │project_id│  │_id      │ │user_id   ││project_id ││ Phase 2)   │
         │owner,   │  │project_id│ │role,     ││actor,     │└────────────┘
         │due,     │  │category, │ │permission││action,    │
         │status,  │  │version,  │ │s         ││old/new,   │
         │priority,│  │status    │ │          ││timestamp  │
         │module   │  │          │ │          ││           │
         └─────────┘  └──────────┘ └──────────┘└───────────┘
```

`Task.module` = the department the task belongs to (e.g. Interiors, Legal,
Accounts). Added per Apoorv's review — not in the original draft diagram.

**Cause → effect that must hold:**
- A Task cannot exist without a `project_id`.
- Any create/update/delete on Task, Document, or Project must write an
  AuditEvent — this is not optional, not "add later" (SRD section 18 warns
  retrofitting audit later is expensive).
- Dashboard (FR-002) is a read-only view computed from Project + Task +
  Document — it is not its own data source.

**Status: reviewed and approved by Apoorv on 2026-09-15, with one addition
(`Task.module`, above). Schema/migration work may proceed.**

## 5. Decisions made (2026-09-15)

- **Tech stack**: Next.js + TypeScript (single codebase — React frontend +
  API routes/server actions in one app).
- **Database**: PostgreSQL.
- **Hosting / deployment**: Railway (app + Postgres together). No
  frontend/backend split — resolved by the Next.js-on-Railway choice.
- **Auth mechanism**: Session-based auth, email + password. No SSO for
  Phase 1.
- **UI framework / styling**: Tailwind CSS + shadcn/ui.
- **File/document storage**: Backblaze B2 (S3-compatible object storage),
  for document vault + version history (FR-005). Not Railway local volume —
  durability matters for a document vault. Originally planned as Cloudflare
  R2 (decided 2026-09-15); switched to B2 on 2026-09-17 because R2 requires
  a credit card on file to activate even for free-tier usage and Apoorv
  declined to provide one — B2's free tier (10GB, no egress-heavy limits)
  does not require a card. Both are S3-compatible, so `src/lib/storage.ts`
  is the only code that's provider-specific; swapping again later is cheap.
- **Multi-brand support**: Hardcode single brand for Phase 1. `brand` stays
  a plain string field on `FranchiseProject`, not a separate `Brand` entity.
  Can be normalized into its own table later without breaking the
  `project_id` relationship.
- **Permission granularity**: Role-based, module-level for Phase 1 (e.g.
  "Legal: read/write Documents, read-only Tasks"). No field-level rules yet.

## 6. NOT DECIDED YET — ask before assuming

None outstanding. All tech/infra questions (section 5) and the data model
sign-off (section 4) are resolved as of 2026-09-15.

## 7. Step-by-step plan

1. ~~Review this plan and the data model diagram — confirm before any code.~~
   Done 2026-09-15 — stack/infra decisions (section 5) and data model
   sign-off (section 4) both confirmed by Apoorv.
2. ~~Decide tech stack~~ — done, see section 5.
3. ~~Build one thin vertical slice~~ — **done and verified 2026-09-15**:
   create a Project → see it on dashboard → add a Task → mark it complete →
   see the change in the audit log. Verified end-to-end in a real browser
   (Playwright), not just type-checked. Implementation notes:
   - App lives at the repo root (Next.js App Router, `src/` layout).
   - Local dev DB: `docker compose up -d` (Postgres on host port **5433**,
     not 5432 — this machine already runs a native Postgres on 5432).
   - Seed users: `npm run db:seed` (creates Admin/Sales/PM/Legal/Franchisee
     dev accounts — see `prisma/seed.ts` for emails; shared dev password
     documented there, not repeated here).
   - Pinned `prisma`/`@prisma/client` to `6.19.3` (exact) rather than
     whatever `npm install prisma` resolves to — the `latest` dist-tag
     currently points at an unstable `8.0.0-rc.*` with a materially
     different (driver-adapter-based) client architecture; 6.19.3 is the
     current stable line.
   - Real bug caught and fixed during verification: this project's shadcn/ui
     is Base UI-based (not Radix), and Base UI's `<Select.Value>` shows the
     raw selected `value` unless given an explicit value→label render
     function — every `<SelectValue>` in the app now passes one.
3a. **UI/UX pass — match SRD wireframe pack visually** — done 2026-09-16, at
    Apoorv's explicit request. Existing Phase 1 pages (dashboard, projects,
    project detail, audit log, login) were restyled to match the wireframe
    pack's look: dark navy left sidebar with the exact wireframe nav item
    list (items with no Phase 1 page yet — Lifecycle, Actions, Documents,
    Payments, People, Culinary, Marketing — render disabled/"Soon" rather
    than linking to non-existent pages), violet brand accent, top-right
    "FRANCHISEE PORTAL"/"INTERNAL" pill (wireframes 01-18 vs 19-24), stat-card
    rows, and a 13-stage lifecycle timeline grid on the project detail page
    (wireframe 02). No new fake data was introduced — every number shown
    (progress %, readiness, days to launch, per-module progress bars, "Latest
    Updates"/"Live Department Feed") is computed from real Task/AuditEvent
    rows, same placeholder-formula caveats as before (see step 3 above).
    Bugs found and fixed during verification: `humanize()` (built for
    SCREAMING_SNAKE_CASE enum values) was mangling AuditEvent.entityType
    (stored PascalCase, e.g. "FranchiseProject") into "Franchiseproject" —
    added `splitPascalCase()` instead; and a Base UI console warning on the
    "New Project" button (`nativeButton` expects a real `<button>`, but it
    renders a `<Link>`) — fixed with `nativeButton={false}`.
4. **Build out remaining Phase 1 FR items** (section 3) as separate tickets,
   one FR at a time — do not build multiple FRs in one pass. Document
   create/upload UI (FR-005) is next: the Prisma schema already has the
   `Document` model, but no pages/actions exist for it yet.
5. **Test/review each ticket** before starting the next one.
6. **Load one real site's data** (e.g. an active Tulsi site) once Phase 1 is
   stable, instead of continuing with dummy data.

## 8. Reference

Full detail in source SRD: sections 4 (functional requirements), 8 (full data
model — all entities, Phase 2+ included), 16 (delivery phases), 18 (handoff
notes for Apoorv).
