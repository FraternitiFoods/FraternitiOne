/**
 * Dev-only seed: fixtures/demo data, starting with just enough of a user to
 * log in as an admin (plan.md milestone M0). Never run this in production —
 * use `npm run seed:prod` (prisma/seed-prod.ts) there instead, which seeds
 * only the baseline data (categories, app_settings, tracker steps) and never
 * creates a dev/demo user.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedCategories, seedAppSettings } from "./seed-shared";

if (process.env.NODE_ENV === "production") {
  console.error(
    "prisma/seed.ts is the DEV seed (fixtures/demo data) — refusing to run with NODE_ENV=production. Use `npm run seed:prod` instead."
  );
  process.exit(1);
}

const db = new PrismaClient();

// Never hardcode this — it was a committed literal until 2026-09-19 (plan.md
// section 7, step 4a) and one of the accounts it seeds shares tech@'s real
// admin address. Set SEED_DEV_PASSWORD in .env (gitignored) instead. Read
// via an IIFE (rather than a bare `const` + `if` guard) so the result type
// is `string`, not `string | undefined` — the guard alone doesn't narrow
// across the closures in `upsertUser` below.
const DEV_PASSWORD: string = (() => {
  const value = process.env.SEED_DEV_PASSWORD;
  if (!value) {
    throw new Error(
      "SEED_DEV_PASSWORD is not set. Add it to .env (see .env.example) before running the seed script."
    );
  }
  return value;
})();

async function upsertUser(input: {
  email: string;
  name: string;
  role: Parameters<typeof db.user.upsert>[0]["create"]["role"];
}) {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);
  return db.user.upsert({
    where: { email: input.email },
    // Re-running the seed against existing rows must also re-apply
    // DEV_PASSWORD — an empty `update` here would silently leave old
    // passwordHashes in place the next time DEV_PASSWORD changes.
    update: { passwordHash },
    create: {
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash,
    },
  });
}

async function main() {
  const admin = await upsertUser({
    email: "tech@fraterniti.co.in",
    name: "Fraterniti Admin",
    role: "ADMIN",
  });

  console.log("Seeded users (dev password for all: %s):", DEV_PASSWORD);
  for (const u of [admin]) {
    console.log(`  - ${u.email}  (${u.role})`);
  }

  const categoryCount = await seedCategories(db);
  console.log(`Seeded ${categoryCount} categories.`);
  const mode = await seedAppSettings(db);
  console.log(`Seeded app_settings (mode = ${mode}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
