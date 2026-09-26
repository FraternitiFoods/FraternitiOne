import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const db = new PrismaClient();

const DEMO_PASSWORD = "Demo@12345";

async function main() {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const targets = [
    { email: "tech@fraterniti.co.in", role: "ADMIN" as const, name: "Fraterniti Admin" },
    { email: "sales.demo@fraterniti.co.in", role: "SALES" as const, name: "Sales Demo" },
    { email: "franchisee.demo@fraterniti.co.in", role: "FRANCHISEE" as const, name: "Franchisee Demo" },
    { email: "signatory.demo@fraterniti.co.in", role: "COMPANY_SIGNATORY" as const, name: "Company Signatory Demo" },
    { email: "kyc.demo@fraterniti.co.in", role: "KYC_REVIEWER" as const, name: "KYC Reviewer Demo" },
    { email: "accounts.demo@fraterniti.co.in", role: "ACCOUNTS" as const, name: "Accounts Demo" },
    { email: "loi.demo@fraterniti.co.in", role: "LOI_PREPARER" as const, name: "LOI Preparer Demo" },
  ];

  for (const t of targets) {
    await db.user.upsert({
      where: { email: t.email },
      update: { passwordHash: hash, isActive: true, role: t.role, loginFailedAttempts: 0, loginLockedUntil: null },
      create: { email: t.email, name: t.name, role: t.role, passwordHash: hash, isActive: true },
    });
    console.log(`OK  ${t.role.padEnd(18)} ${t.email}`);
  }

  console.log(`\nAll demo passwords set to: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
