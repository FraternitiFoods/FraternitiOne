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

// Real site names (prisma/seed-data/site-tracker-steps.json) — used only as
// cosmetic text in StoreOnboarding.proposedLocation, which has no FK to the
// real Site table.
const REAL_SITE_NAMES = [
  "Tulsi Ahmedabad",
  "Tulsi Ayodhya",
  "Tulsi Ashok Vihar",
  "Tulsi Rcube",
  "Tulsi Jabalpur",
  "Tulsi Bhuvaneshwar",
  "Tulsi Indrapuram",
  "Tulsi Bhopal",
  "Tulsi Kanpur",
  "Tulsi Ujjain",
  "Tulsi Hisar",
  "Pavitra Vadodara",
  "Blink Mathura",
  "Tulsi Virar",
  "Tulsi Bangalore",
  "Tulsi Raipur",
  "Tulsi Indore",
  "Blink Kharar",
  "Tulsi R Cube Monad",
  "Zoca Ocus 24k",
  "Zoca Courtyard Cuttack",
  "Pavitra",
];

const ROSTER: { username: string; name: string }[] = [
  { username: "yashika", name: "Yashika" },
  { username: "sonali", name: "Sonali" },
  { username: "himanshu", name: "Himanshu" },
  { username: "km", name: "KM" },
  { username: "rahulrishi", name: "Rahul Rishi" },
  { username: "jyotsana", name: "Jyotsana" },
  { username: "kp", name: "KP" },
];

function pickRandomSite(): string {
  return REAL_SITE_NAMES[Math.floor(Math.random() * REAL_SITE_NAMES.length)];
}

function dummyPhone(seq: number): string {
  // Distinct, obviously-fake 10-digit numbers, one per seeded user.
  return `90000000${String(seq).padStart(2, "0")}`;
}

async function main() {
  const admin = await db.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });

  for (const [i, { username, name }] of ROSTER.entries()) {
    const email = `${username}@falana.com`;
    const password = `${username}123`;
    const passwordHash = await bcrypt.hash(password, 12);

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
      update: {},
      create: {
        brand: "Tulsi",
        format: "QSR",
        proposedLocation: pickRandomSite(),
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

    console.log(`Seeded ${name} — username: ${username}, password: ${password}, email: ${email}`);
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
