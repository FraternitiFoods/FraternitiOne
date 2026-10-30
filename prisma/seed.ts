/**
 * Dev-only user seed (just enough to log in as an admin, plan.md milestone
 * M0) plus the Site BOQ baseline seed data that every environment needs
 * regardless of real import data: the 21 categories and app_settings
 * defaults (plan.md milestone M1).
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { SEED_CATEGORIES } from "@/lib/boq-categories";
import { APP_SETTING_KEYS, DEFAULT_APP_SETTINGS } from "@/lib/app-settings";

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

async function seedCategories() {
  for (const category of SEED_CATEGORIES) {
    await db.category.upsert({
      where: { name: category.name },
      // Seeding never overwrites a category already touched by a real
      // import — only fills in categories that don't exist yet.
      update: {},
      create: category,
    });
  }
  console.log(`Seeded ${SEED_CATEGORIES.length} categories.`);
}

async function seedAppSettings() {
  for (const key of APP_SETTING_KEYS) {
    await db.appSetting.upsert({
      where: { key },
      // Never overwrite a value an Admin may have already changed from
      // Settings — seeding only fills in keys that don't exist yet.
      update: {},
      create: { key, value: DEFAULT_APP_SETTINGS[key] },
    });
  }
  console.log(`Seeded app_settings (mode = ${DEFAULT_APP_SETTINGS.mode}).`);
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

  await seedCategories();
  await seedAppSettings();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
