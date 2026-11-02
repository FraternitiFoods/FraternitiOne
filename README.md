This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy

This section covers taking the `new-main` branch live as its own, separate production app (separate Vercel project, separate hosted Postgres, its own domain). It assumes you already have accounts for Neon, Vercel, Backblaze B2 and Resend.

### 1. Database (Neon)

1. Create a Neon project (any region close to your users).
2. On the project's **Connection Details** panel, copy two different connection strings:
   - **Pooled connection** (the one with `-pooler` in the hostname) → this is `DATABASE_URL`.
   - **Direct connection** (no `-pooler`) → this is `DIRECT_URL`. Prisma's migration engine always uses `directUrl` over `url` when both are set (see `prisma/schema.prisma`), because running schema migrations over a pgbouncer pooled connection is unreliable.
3. Put both in your local `.env` (never commit it) to run the commands in step 2 below from your own machine, pointed at the new Neon database.

### 2. Apply migrations, seed, create the first Admin

Run these locally, with `.env` pointed at the **new Neon database** (not your Docker dev DB):

```bash
npm run db:migrate:prod   # prisma migrate deploy, using DIRECT_URL
npm run seed:prod         # categories, app_settings, Site Tracker steps — no fixtures, no users
npm run create-admin      # interactive: name, email, password (hidden) — creates your first Admin
```

All three are safe to re-run. `seed:prod` only fills in rows that don't exist yet; `create-admin` is idempotent by email (it offers to reset the password of an existing account rather than failing).

Migrations are intentionally **not** run automatically on every deploy — `npm run build` is just `next build`. Reasoning: running `prisma migrate deploy` on every Vercel build (the create-next-app default) means a schema change ships the moment you merge, with no chance to apply and verify it separately first, and a half-applied migration on a failed build can leave the DB ahead of what the deployed code expects. Instead, run `npm run db:migrate:prod` yourself right before deploying code that depends on the new schema.

### 3. Environment variables

Copy `.env.production.example` → set these in Vercel's Project Settings → Environment Variables (Production).

| Variable | Where to get it | Required |
| --- | --- | --- |
| `DATABASE_URL` | Neon → Connection Details → pooled connection string | Yes |
| `DIRECT_URL` | Neon → Connection Details → direct connection string | Yes |
| `SESSION_SECRET` | Generate: `openssl rand -base64 32`. App refuses to start in production without a real (non-placeholder) value. | Yes |
| `IMPORT_SECRET` | Generate: `openssl rand -base64 32`. Shared secret the sheet's Apps Script sends as `Authorization: Bearer <IMPORT_SECRET>`. App refuses to start in production without it. | Yes |
| `APP_URL` | The app's real URL, no trailing slash (e.g. `https://app.fraterniti.one`). Update when the domain changes. | Yes |
| `B2_ENDPOINT` | Backblaze B2 console → your bucket → bucket details (e.g. `s3.us-west-004.backblazeb2.com`) | Yes (once anyone uploads a photo/document/evidence file — the app errors clearly on that action if missing, it doesn't block startup) |
| `B2_KEY_ID` | Backblaze B2 console → App Keys → create a key scoped to the bucket | Yes (same as above) |
| `B2_APPLICATION_KEY` | Shown once when you create the App Key above — save it immediately | Yes (same as above) |
| `B2_BUCKET_NAME` | The bucket's name in the B2 console | Yes (same as above) |
| `RESEND_API_KEY` | [resend.com/api-keys](https://resend.com/api-keys) | Yes (once anyone needs an invite/password-reset email) |
| `EMAIL_FROM` | An address on a Resend-verified domain | Yes (same as above) |

Not needed in production (dev-only — see `.env.example` instead): `SHADOW_DATABASE_URL`, `SEED_DEV_PASSWORD`.

### 4. Vercel project

1. Create a **new** Vercel project from this repo (don't reuse the old app's project).
2. Project Settings → Git → **Production Branch** = `new-main`.
3. Project Settings → General → **Node.js Version** = 20.x (matches CI).
4. Build command: leave as the default (`next build` from `package.json`). Install command: default (`pnpm install`).
5. Add every environment variable from the table above under **Production**.
6. Deploy. Vercel will give you a temporary `https://<project>.vercel.app` URL — use that to test before any domain is attached.

### 5. B2 bucket CORS

The upload/download flow uses presigned URLs the browser talks to directly (phone/browser ↔ B2, never proxied through a Next.js route), so the bucket needs a CORS rule or those requests are blocked by the browser. In the B2 console, open the bucket → **CORS Rules** → paste:

```json
{
  "corsRuleName": "fraterniti-one-prod",
  "allowedOrigins": [
    "https://fraterniti.one",
    "https://app.fraterniti.one",
    "http://localhost:3000"
  ],
  "allowedOperations": ["s3_put", "s3_get", "s3_head"],
  "allowedHeaders": ["*"],
  "exposeHeaders": ["ETag"],
  "maxAgeSeconds": 3600
}
```

Before your domain exists yet, add your temporary `https://<project>.vercel.app` URL as an extra entry in `allowedOrigins` too, so you can test uploads on that URL — remove it (or leave it, it's harmless) once `app.fraterniti.one` is live.

### 6. Domain swap

1. First point **`app.fraterniti.one`** at this Vercel project (Project Settings → Domains → Add). Verify everything end-to-end on that subdomain before touching the bare domain.
2. Once confirmed, add **`fraterniti.one`** itself to this project and point its DNS here.
3. Update `APP_URL` to whichever is the primary domain, and add it to the B2 CORS `allowedOrigins` if it isn't already.

### 7. Rollback

If something's wrong after the domain swap, point the domain's DNS back at the **old** Vercel project (the one still serving `main`/`dev`). This new project and its Neon database are entirely separate from the old production app, so rolling back the domain doesn't touch or lose anything on either side.

### 8. Rollout day (flipping the sheet → website switch)

The Google Sheet is the live source of truth until rollout (`app_settings.mode = SHEET_LIVE`); the website is a read-only copy kept in sync by the sheet's Apps Script push. At rollout:

1. Confirm the latest sheet push has landed (Settings page shows the last import time/status).
2. **First-import check**: compare the website Overview page's grand total against the sheet's own Dashboard tab total — they must match before you flip anything.
3. As Admin, flip Settings → mode to `WEBSITE_LIVE`. From this moment the website accepts edits per the role matrix, and `/api/import/boq/*` starts rejecting the sheet's pushes with 403 (by design — nothing should overwrite website data once it's live).
4. Tell whoever owns the Apps Script to stop its scheduled push (or just let it keep failing with 403 — it's harmless, but better to turn it off).

### 9. Health check

`GET /api/health` returns `{"status":"ok"}` (200) if the app can reach its database, `{"status":"error"}` (503) otherwise. No auth required, no data or secrets in the response — safe to point Vercel/uptime monitoring at it directly.
