/**
 * Dev-only seed data: just enough users to exercise the Phase 1 vertical
 * slice (create a project -> see it on the dashboard -> add a task -> mark
 * it complete -> see it in the audit log) end to end, across a few
 * representative roles. Not meant to model a real org chart.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const DEV_PASSWORD = "KobeBryant//24";

async function upsertUser(input: {
  email: string;
  name: string;
  role: Parameters<typeof db.user.upsert>[0]["create"]["role"];
  department?: Parameters<typeof db.user.upsert>[0]["create"]["department"];
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
      department: input.department,
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

  const sales = await upsertUser({
    email: "sales.demo@fraterniti.co.in",
    name: "Sales Demo",
    role: "SALES",
    department: "SALES",
  });

  const pm = await upsertUser({
    email: "pm.demo@fraterniti.co.in",
    name: "Project Manager Demo",
    role: "PROJECT_MANAGER",
    department: "PROJECTS",
  });

  const legal = await upsertUser({
    email: "legal.demo@fraterniti.co.in",
    name: "Legal Demo",
    role: "LEGAL",
    department: "LEGAL",
  });

  const franchisee = await upsertUser({
    email: "franchisee.demo@fraterniti.co.in",
    name: "Franchisee Demo",
    role: "FRANCHISEE",
    department: "FRANCHISEE",
  });

  console.log("Seeded users (dev password for all: %s):", DEV_PASSWORD);
  for (const u of [admin, sales, pm, legal, franchisee]) {
    console.log(`  - ${u.email}  (${u.role})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
