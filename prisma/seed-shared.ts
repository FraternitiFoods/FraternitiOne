/**
 * Shared seeding logic used by both prisma/seed.ts (dev) and
 * prisma/seed-prod.ts (production) — the 21 categories and app_settings
 * defaults every environment needs regardless of real import data (plan.md
 * milestone M1). Every write is an upsert that never overwrites a row a real
 * import or an Admin may have already touched, so running either caller
 * twice (or against a database that already has real data) is always safe.
 */
import type { PrismaClient } from "@prisma/client";
import { SEED_CATEGORIES } from "@/lib/boq-categories";
import { APP_SETTING_KEYS, DEFAULT_APP_SETTINGS } from "@/lib/app-settings";

export async function seedCategories(db: PrismaClient): Promise<number> {
  for (const category of SEED_CATEGORIES) {
    await db.category.upsert({
      where: { name: category.name },
      update: {},
      create: category,
    });
  }
  return SEED_CATEGORIES.length;
}

export async function seedAppSettings(db: PrismaClient): Promise<string> {
  for (const key of APP_SETTING_KEYS) {
    await db.appSetting.upsert({
      where: { key },
      update: {},
      create: { key, value: DEFAULT_APP_SETTINGS[key] },
    });
  }
  return DEFAULT_APP_SETTINGS.mode;
}
