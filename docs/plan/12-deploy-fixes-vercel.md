## 12. Deploy fixes — Vercel (2026-09-21/22)

**Where this came from:** not logged at the time. Reconstructed from commit
messages/diffs on 2026-09-23 while catching this file up — see section 13.
Both commits are plain Vercel-build breakage fixes, no product behavior
change, but they document a hosting decision this file hadn't caught up on:
section 5's "Hosting: Railway" is stale — the app is deploying to **Vercel**
now (`80adcc2`/`58b0696`'s commit messages both reference "Vercel's ...
build" directly; `0a068dd` "Trigger preview deployment for dev branch" is
consistent with Vercel's branch-preview flow, not a Railway concept). Section
5 has been corrected accordingly. When/why the Railway → Vercel switch
actually happened is not recoverable from the repo — ask Apoorv if it
matters for the record.

What shipped:
- **`80adcc2`**: `pnpm-lock.yaml` was out of sync with `package.json` (the
  `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, and `resend`
  dependencies — all from earlier steps, B2 storage and Resend email — had
  been added to `package.json` without a lockfile update), which broke
  Vercel's frozen-lockfile install. Regenerated the lockfile.
- **`58b0696`**: added a `postinstall: "prisma generate"` script to
  `package.json`. Without it, Vercel's build installs deps but never
  generates the Prisma client, so `next build` failed with hundreds of "has
  no exported member" TypeScript errors against `@prisma/client`. Local dev
  didn't hit this because `prisma generate` had always been run manually at
  some point on every dev machine.

Neither commit was verified against a live Vercel deploy in this repo's
history as far as can be told from the commit messages alone — worth
confirming the current `dev`/`main` Vercel deployments are actually green
before treating this as closed.

