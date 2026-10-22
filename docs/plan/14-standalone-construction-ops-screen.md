## 14. Standalone Construction & Ops Progress screen + sidebar entry (2026-09-23)

**Where this came from:** Apoorv's follow-up, same day as section 13's
`12457c0` (category tiles becoming tappable) — the "Construction & Ops
Progress" grid only existed embedded partway down a project's Overview page;
he wanted it reachable directly from the sidebar as its own screen, not just
via a project's detail page.

What shipped:
- **`/progress`** (`src/app/(app)/progress/page.tsx`, new): franchisees land
  straight on their own project's category grid, same as the dashboard's
  auto-scoping. Internal roles (who work across many projects) get a project
  picker first, then `?project=<id>` scopes the grid — same query-param
  convention as `/audit`'s and the Action Centre's `?project=` filters
  (section 11), chosen so the page stays a Server Component and the URL is
  shareable/bookmarkable rather than needing client state. Deliberately no
  cross-project rollup: mixing categories from different projects' BOQ/Ops
  checklists into one grid wouldn't mean anything, unlike the portfolio-wide
  Phase 4 barometer view section 9 already scoped out.
- **Sidebar**: new "Construction Progress" entry (`app-sidebar.tsx`) linking
  to `/progress`. Not part of the original SRD wireframe nav list (section
  3a) — added the same way section 9's whole category axis was itself an
  addition beyond the original SRD scope.
- **Back-navigation fix** (same-day bug, caught by Apoorv from a live
  screenshot): tapping a tile from `/progress` opened the category detail
  page correctly, but its "← Back" link always pointed at the project's
  Overview page (`/projects/[id]`) regardless of where the tap came from —
  so going back from `/progress` dropped you on the wrong screen. Fixed by
  threading a `?back=<url>` param through: `CategoryTile` takes an optional
  `backHref` prop and appends it to the link it renders; the category page
  reads `?back` and uses it (falling back to `/projects/[id]` when absent,
  i.e. unchanged for the tile embedded on the project page itself) for both
  the "← Back" link and the `returnPath` its `TaskCard`s redirect to after an
  action, so the context survives a status update/comment too, not just the
  initial navigation.

Verification: `tsc --noEmit` and `eslint` clean after each change; the
already-running local `next dev` (Turbopack) picked up the new route with no
compile errors and registered it in the generated typed-routes manifest. Not
independently click-tested end-to-end by me this session (no fresh Playwright
pass) — Apoorv's own screenshots during the session are what surfaced the
back-navigation bug in the first place and confirmed the fix's intended
before/after, but a real verification pass (per the section 13 gap this
section itself repeats) is still worth doing before treating this as fully
closed.

