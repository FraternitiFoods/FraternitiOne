// Persistent demo accounts for the sales team to click through the
// franchisee-facing onboarding portal themselves. Unlike scripts/tmp-e2e-*.ts,
// this script is NOT cleaned up after running — these 7 accounts are meant to
// stay in the database indefinitely. Safe to re-run (idempotent via upsert).
//
// Run with: npx tsx scripts/seed-sales-demo-users.ts
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const ADMIN_EMAIL = "tech@fraterniti.co.in";

// Site names the owner picked for the seeded demo accounts — split into
// {brand, location} so the Store Onboarding list's "{brand} {proposedLocation}"
// label doesn't end up duplicated (e.g. a flat "TULSI Cuttack" string combined
// with the default brand "Tulsi" rendered as "Tulsi TULSI Cuttack"). Cosmetic
// only — StoreOnboarding has no FK to the real Site table.
const SITE_OPTIONS: { brand: string; location: string }[] = [
  { brand: "TULSI", location: "Cuttack" },
  { brand: "TULSI", location: "Los Angeles" },
  { brand: "TULSI", location: "New Jersey" },
  { brand: "Pavitra", location: "Aurangabad" },
  { brand: "TULSI", location: "Kolkata" },
  { brand: "TULSI", location: "Goa" },
  { brand: "Pavitra", location: "Trivandrum" },
  { brand: "Pavitra", location: "Chennai" },
];

function shuffledSites(): { brand: string; location: string }[] {
  const arr = [...SITE_OPTIONS];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const ROSTER: { username: string; name: string }[] = [
  { username: "yashika", name: "Yashika" },
  { username: "sonali", name: "Sonali" },
  { username: "himanshu", name: "Himanshu" },
  { username: "km", name: "KM" },
  { username: "rahulrishi", name: "Rahul Rishi" },
  { username: "jyotsana", name: "Jyotsana" },
  { username: "kp", name: "KP" },
];

function dummyPhone(seq: number): string {
  // Distinct, obviously-fake 10-digit numbers, one per seeded user.
  return `90000000${String(seq).padStart(2, "0")}`;
}

async function main() {
  const admin = await db.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  const sites = shuffledSites(); // one unique site per user, 8 options for 7 users

  for (const [i, { username, name }] of ROSTER.entries()) {
    const email = `${username}@falana.com`;
    const password = `${username}123`;
    const passwordHash = await bcrypt.hash(password, 12);
    const { brand, location } = sites[i];

    const user = await db.user.upsert({
      where: { username },
      update: { passwordHash, isActive: true, role: "FRANCHISEE" },
      create: {
        name,
        email,
        username,
        role: "FRANCHISEE",
        passwordHash,
        isActive: true,
      },
    });

    await db.storeOnboarding.upsert({
      where: { franchiseeUserId: user.id },
      update: { brand, proposedLocation: location },
      create: {
        brand,
        format: "QSR",
        proposedLocation: location,
        legalApplicantName: name,
        entityType: "INDIVIDUAL",
        contactPhone: dummyPhone(i + 1),
        workspaceEmail: email,
        franchiseeUserId: user.id,
        salesOwnerId: admin.id,
        expectedAmount: 50_000_00, // paise = ₹5,00,000
      },
    });

    const onboarding = await db.storeOnboarding.findUniqueOrThrow({
      where: { franchiseeUserId: user.id },
    });
    const kyc = await db.kycSubmission.findUnique({ where: { onboardingId: onboarding.id } });
    if (!kyc) {
      await db.kycSubmission.create({ data: { onboardingId: onboarding.id } });
    }

    console.log(
      `Seeded ${name} — username: ${username}, password: ${password}, email: ${email}, site: ${brand} ${location}`
    );
  }

  console.log(`\nDone. ${ROSTER.length} demo franchisee accounts ready. Log in at /login with any username above.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
