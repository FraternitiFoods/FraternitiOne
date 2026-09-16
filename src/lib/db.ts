import { PrismaClient } from "@prisma/client";

// Standard Next.js dev-mode singleton: without this, hot-reload would create
// a new PrismaClient (and a new DB connection pool) on every file save.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
